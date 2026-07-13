import "server-only";

import {
  ExternalScheduler,
  MemberRole,
  OutputStatus,
  Platform,
  type AgencyIntegration,
} from "@prisma/client";
import { NotFoundError, ValidationError } from "@/server/auth/errors";
import { requireReadRole, requireRole, type TenantContext } from "@/server/auth/tenant";
import {
  decryptToken,
  encryptToken,
  isTokenVaultAvailable,
  TokenVaultDecryptError,
} from "@/server/crypto/token-vault";
import {
  BufferError,
  listOrganizationsAndChannels,
  refreshAccessToken,
  type BufferAuthRefresher,
} from "@/server/integrations/buffer";
import { prisma } from "./client";

/**
 * Per-agency integration wiring for the scheduling surface.
 *
 * `AgencyIntegration.accessToken` is stored encrypted at rest via
 * `server/crypto/token-vault.ts`. Every access route in this module reads
 * through `decryptToken`; a decrypt failure surfaces as "integration not
 * available" (same as no row) so callers can fall through to MANUAL mode.
 */

const CONNECT_ROLES = [MemberRole.OWNER, MemberRole.ADMIN] as const;
const READ_ROLES = [
  MemberRole.OWNER,
  MemberRole.ADMIN,
  MemberRole.EDITOR,
  MemberRole.REVIEWER,
] as const;

/**
 * Buffer supports these four social platforms; everything else stays in
 * MANUAL mode even when Buffer is connected.
 */
export const BUFFER_SUPPORTED_PLATFORMS: readonly Platform[] = [
  Platform.TWITTER,
  Platform.LINKEDIN,
  Platform.INSTAGRAM,
  Platform.TIKTOK,
];

export function isBufferSupportedPlatform(platform: Platform): boolean {
  return BUFFER_SUPPORTED_PLATFORMS.includes(platform);
}

/**
 * Buffer bookkeeping stored on `AgencyIntegration.meta`.
 *
 * - `organizationIds` — every Buffer org the token can reach. Buffer
 *   scopes channels to orgs; we need the org id both to publish (implicit,
 *   channel already carries it) and to poll recent posts on the sync cron.
 * - `profiles` — Platform → Buffer channel id. First-match-wins if the
 *   same platform appears in multiple orgs on the same account.
 * - `channelToOrg` — reverse lookup so a scheduled post can find its parent
 *   organization at sync time without re-enumerating channels.
 */
export type BufferIntegrationMeta = {
  organizationIds: string[];
  profiles: Partial<Record<Platform, string>>;
  channelToOrg: Record<string, string>;
};

export type ResolvedBufferIntegration = {
  id: string;
  accessToken: string;
  meta: BufferIntegrationMeta;
  autoMarkPublished: boolean;
  lastSyncedAt: Date | null;
  lastSyncError: string | null;
};

/**
 * Read-only public view of an integration — safe to return to the UI. Never
 * includes the decrypted token.
 */
export type IntegrationSummary = {
  provider: ExternalScheduler;
  connectedByMemberId: string | null;
  connectedByName: string | null;
  connectedByEmail: string | null;
  autoMarkPublished: boolean;
  meta: BufferIntegrationMeta | null;
  lastSyncedAt: Date | null;
  lastSyncError: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export async function listIntegrationsForAgency(ctx: TenantContext): Promise<IntegrationSummary[]> {
  requireReadRole(ctx, READ_ROLES);
  const rows = await prisma.agencyIntegration.findMany({
    where: { agencyId: ctx.agencyId },
    include: {
      connectedBy: { select: { id: true, name: true, email: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => ({
    provider: r.provider,
    connectedByMemberId: r.connectedByMemberId,
    connectedByName: r.connectedBy?.name ?? null,
    connectedByEmail: r.connectedBy?.email ?? null,
    autoMarkPublished: r.autoMarkPublished,
    meta: (r.meta as BufferIntegrationMeta | null) ?? null,
    lastSyncedAt: r.lastSyncedAt,
    lastSyncError: r.lastSyncError,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
}

/**
 * How close to `expiresAt` we start refreshing. 60 s gives enough runway for
 * a subsequent Buffer call to complete before Buffer's own clock rolls the
 * token over on us.
 */
const REFRESH_SKEW_MS = 60_000;

/**
 * Given a raw `AgencyIntegration` row (with the `accessToken` still
 * encrypted), return a usable plaintext access token — proactively
 * refreshing via `refreshAccessToken` when the stored expiry is within
 * `REFRESH_SKEW_MS`. Persists the rotated tokens on success.
 *
 * Returns `null` for any state that means "this integration can't service a
 * request right now" — vault unavailable, decrypt failure, refresh rejected
 * by Buffer (i.e. reconnect required). On refresh rejection we stamp
 * `lastSyncError` so the settings UI can nudge the OWNER/ADMIN. Callers
 * treat `null` identically to "no integration row" — schedule surfaces fall
 * through to MANUAL mode, the sync cron downgrades in-flight rows.
 *
 * Concurrency caveat: parallel callers within the skew window will each
 * attempt a refresh. Buffer may reject the second one if it treats refresh
 * tokens as single-use — one request errors, the other succeeds. Adding a
 * per-agency lock is out of scope for the current bug fix; the failing
 * caller surfaces the standard "reconnect Buffer" nudge, which corrects on
 * the next request once the winning refresh has persisted new tokens.
 */
async function resolveFreshAccessToken(row: {
  agencyId: string;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
}): Promise<string | null> {
  let currentToken: string;
  try {
    currentToken = decryptToken(row.accessToken);
  } catch (err) {
    if (err instanceof TokenVaultDecryptError) return null;
    throw err;
  }

  // Not close to expiring → use as-is. Rows created before we started
  // persisting `expiresAt` land here too (Buffer sends `expires_in` on every
  // token response, so any post-fix connect will populate it).
  if (!row.expiresAt || row.expiresAt.getTime() - Date.now() > REFRESH_SKEW_MS) {
    return currentToken;
  }

  // Expired but no refresh token on file → nothing we can do. Old rows
  // written before the OAuth 2 rollout may fall through here. Return the
  // stale token and let the downstream 401 nudge the reconnect.
  if (!row.refreshToken) return currentToken;

  const clientId = process.env.BUFFER_CLIENT_ID;
  const clientSecret = process.env.BUFFER_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    // Dev/misconfigured env — we can't refresh without the OAuth client
    // creds. Return the stale token so at least sample-data-mode flows and
    // tests don't blow up on missing env.
    return currentToken;
  }

  try {
    const fresh = await refreshAccessToken({
      refreshToken: row.refreshToken,
      clientId,
      clientSecret,
    });
    await prisma.agencyIntegration.update({
      where: {
        agencyId_provider: { agencyId: row.agencyId, provider: ExternalScheduler.BUFFER },
      },
      data: {
        accessToken: encryptToken(fresh.accessToken),
        // Buffer may rotate the refresh token or leave it stable. When
        // present, replace; when absent, keep the existing one.
        ...(fresh.refreshToken ? { refreshToken: fresh.refreshToken } : {}),
        expiresAt: fresh.expiresAt,
        lastSyncError: null,
      },
    });
    return fresh.accessToken;
  } catch (err) {
    // Refresh rejected — refresh token was revoked, rotated past, or the
    // OAuth app was disabled on Buffer's side. Stamp so the UI can prompt a
    // reconnect. Fire-and-forget so a follow-up write failure never masks
    // the underlying refresh error in the caller.
    const message =
      err instanceof BufferError
        ? `Buffer token refresh failed (${err.status}). Disconnect and reconnect Buffer in Settings › Integrations.`
        : err instanceof Error
          ? `Buffer token refresh failed: ${err.message}. Reconnect Buffer to continue.`
          : "Buffer token refresh failed. Reconnect Buffer to continue.";
    void prisma.agencyIntegration
      .updateMany({
        where: { agencyId: row.agencyId, provider: ExternalScheduler.BUFFER },
        data: { lastSyncError: message },
      })
      .catch(() => undefined);
    return null;
  }
}

/**
 * Reactive companion to `resolveFreshAccessToken`. When Buffer 401s at
 * request time — either an HTTP 401 or a `code: UNAUTHENTICATED` GraphQL
 * error on a 200 — the API helpers in `server/integrations/buffer.ts` call
 * this to get a fresh access token, then retry once. Covers the failure
 * mode the proactive path can't reach: rows where `expiresAt` is `null`
 * (Buffer didn't emit `expires_in`, or the row predates OAuth 2), an
 * externally-revoked token, or a wall-clock drift between us and Buffer.
 *
 * Reads the DB row fresh on every call so parallel requests each see the
 * latest refresh_token — a concurrent winner has already rotated it.
 *
 * Returns `null` when a refresh is impossible (no refresh_token, missing
 * OAuth client creds, or Buffer rejected the refresh grant). On rejection
 * we stamp `lastSyncError` for the settings UI, matching `resolveFreshAccessToken`.
 */
export function makeBufferAuthRefresher(agencyId: string): BufferAuthRefresher {
  return {
    onUnauthenticated: async () => {
      if (!isTokenVaultAvailable()) return null;
      const row = await prisma.agencyIntegration.findUnique({
        where: {
          agencyId_provider: { agencyId, provider: ExternalScheduler.BUFFER },
        },
        select: { refreshToken: true },
      });
      if (!row?.refreshToken) return null;
      const clientId = process.env.BUFFER_CLIENT_ID;
      const clientSecret = process.env.BUFFER_CLIENT_SECRET;
      if (!clientId || !clientSecret) return null;
      try {
        const fresh = await refreshAccessToken({
          refreshToken: row.refreshToken,
          clientId,
          clientSecret,
        });
        await prisma.agencyIntegration.update({
          where: {
            agencyId_provider: { agencyId, provider: ExternalScheduler.BUFFER },
          },
          data: {
            accessToken: encryptToken(fresh.accessToken),
            ...(fresh.refreshToken ? { refreshToken: fresh.refreshToken } : {}),
            expiresAt: fresh.expiresAt,
            lastSyncError: null,
          },
        });
        return fresh.accessToken;
      } catch (err) {
        const message =
          err instanceof BufferError
            ? `Buffer token refresh failed (${err.status}). Disconnect and reconnect Buffer in Settings › Integrations.`
            : err instanceof Error
              ? `Buffer token refresh failed: ${err.message}. Reconnect Buffer to continue.`
              : "Buffer token refresh failed. Reconnect Buffer to continue.";
        void prisma.agencyIntegration
          .updateMany({
            where: { agencyId, provider: ExternalScheduler.BUFFER },
            data: { lastSyncError: message },
          })
          .catch(() => undefined);
        return null;
      }
    },
  };
}

/**
 * Resolve the Buffer integration for the current agency — decrypts the
 * token, returns `null` if there's no row OR if the vault can't decrypt
 * (missing key, ciphertext tampered, key rotated). Missing key = feature
 * disabled; callers fall through to MANUAL mode.
 *
 * Proactively refreshes the OAuth 2 access token via `resolveFreshAccessToken`
 * when it's within `REFRESH_SKEW_MS` of expiry — without this, Buffer's
 * ~1-hour token TTL bricks every downstream surface until a manual reconnect.
 */
export async function getBufferIntegrationForAgency(
  ctx: TenantContext,
): Promise<ResolvedBufferIntegration | null> {
  requireReadRole(ctx, READ_ROLES);
  if (!isTokenVaultAvailable()) return null;
  const row = await prisma.agencyIntegration.findUnique({
    where: {
      agencyId_provider: { agencyId: ctx.agencyId, provider: ExternalScheduler.BUFFER },
    },
  });
  if (!row) return null;
  const accessToken = await resolveFreshAccessToken({
    agencyId: row.agencyId,
    accessToken: row.accessToken,
    refreshToken: row.refreshToken,
    expiresAt: row.expiresAt,
  });
  if (!accessToken) return null;
  return {
    id: row.id,
    accessToken,
    meta: ((row.meta as BufferIntegrationMeta | null) ?? {
      organizationIds: [],
      profiles: {},
      channelToOrg: {},
    }) as BufferIntegrationMeta,
    autoMarkPublished: row.autoMarkPublished,
    lastSyncedAt: row.lastSyncedAt,
    lastSyncError: row.lastSyncError,
  };
}

export type ConnectBufferInput = {
  memberId: string;
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: Date | null;
  meta: BufferIntegrationMeta;
};

/**
 * Upsert the Buffer integration for the current agency. Overwrites any
 * prior connection (same OWNER/ADMIN re-connects, or a member handoff).
 */
export async function connectBufferIntegration(
  ctx: TenantContext,
  input: ConnectBufferInput,
): Promise<AgencyIntegration> {
  requireRole(ctx, CONNECT_ROLES);
  if (!isTokenVaultAvailable()) {
    throw new ValidationError(
      "Token vault is not configured (INTEGRATION_ENCRYPTION_KEY missing). Connect Buffer from a properly-configured environment.",
    );
  }
  const encrypted = encryptToken(input.accessToken);
  return prisma.agencyIntegration.upsert({
    where: {
      agencyId_provider: { agencyId: ctx.agencyId, provider: ExternalScheduler.BUFFER },
    },
    update: {
      accessToken: encrypted,
      refreshToken: input.refreshToken ?? null,
      expiresAt: input.expiresAt ?? null,
      meta: input.meta as unknown as object,
      connectedByMemberId: input.memberId,
      lastSyncError: null,
    },
    create: {
      agencyId: ctx.agencyId,
      provider: ExternalScheduler.BUFFER,
      accessToken: encrypted,
      refreshToken: input.refreshToken ?? null,
      expiresAt: input.expiresAt ?? null,
      meta: input.meta as unknown as object,
      connectedByMemberId: input.memberId,
    },
  });
}

/**
 * Disconnect Buffer for the current agency. Also downgrades any in-flight
 * SCHEDULED outputs on Buffer to MANUAL (they can't be synced anymore, so
 * the calendar surface shows a "verify posted" nudge on those rows).
 */
export async function disconnectBufferIntegration(ctx: TenantContext): Promise<{
  disconnected: boolean;
  downgradedOutputs: number;
}> {
  requireRole(ctx, CONNECT_ROLES);
  const existing = await prisma.agencyIntegration.findUnique({
    where: {
      agencyId_provider: { agencyId: ctx.agencyId, provider: ExternalScheduler.BUFFER },
    },
    select: { id: true },
  });
  if (!existing) return { disconnected: false, downgradedOutputs: 0 };

  const [, downgraded] = await prisma.$transaction([
    prisma.agencyIntegration.delete({ where: { id: existing.id } }),
    prisma.generatedOutput.updateMany({
      where: {
        status: OutputStatus.SCHEDULED,
        externalScheduler: ExternalScheduler.BUFFER,
        episode: { show: { client: { agencyId: ctx.agencyId } } },
      },
      data: {
        externalScheduler: ExternalScheduler.MANUAL,
        // Preserve externalPostId + externalPostUrl so operators can chase
        // the Buffer post manually if they need to; sync just won't touch it.
      },
    }),
  ]);

  return { disconnected: true, downgradedOutputs: downgraded.count };
}

/**
 * Re-enumerate the connected Buffer account's organizations + channels
 * and overwrite `meta` with the fresh mapping. Called from the
 * `/api/integrations/buffer/refresh` route when a user adds a new social
 * channel in Buffer (e.g. connects LinkedIn *after* already connecting
 * Buffer to Repodcast) and needs Repodcast to pick it up without
 * disconnecting and reconnecting.
 *
 * Returns a summary the UI can render into a success banner.
 */
export async function refreshBufferChannels(ctx: TenantContext): Promise<{
  organizationCount: number;
  channelCount: number;
  profiles: Partial<Record<Platform, string>>;
}> {
  requireRole(ctx, CONNECT_ROLES);
  const integration = await getBufferIntegrationForAgency(ctx);
  if (!integration) throw new IntegrationNotFoundError(ExternalScheduler.BUFFER);

  let organizations: Array<{ id: string; name: string }>;
  let channels: Array<{
    id: string;
    service: string;
    organizationId: string;
    platform: Platform | null;
  }>;
  try {
    const result = await listOrganizationsAndChannels(
      integration.accessToken,
      makeBufferAuthRefresher(ctx.agencyId),
    );
    organizations = result.organizations;
    channels = result.channels;
  } catch (err) {
    // Stamp the failure on the integration so the settings card can
    // surface it, but re-throw so the API route returns a non-2xx.
    await stampIntegrationSync(
      ctx.agencyId,
      ExternalScheduler.BUFFER,
      err instanceof Error ? err.message : "channel refresh failed",
    );
    throw err;
  }

  const profileMap: Partial<Record<Platform, string>> = {};
  const channelToOrg: Record<string, string> = {};
  for (const c of channels) {
    channelToOrg[c.id] = c.organizationId;
    if (c.platform && !profileMap[c.platform]) profileMap[c.platform] = c.id;
  }
  const meta: BufferIntegrationMeta = {
    organizationIds: organizations.map((o) => o.id),
    profiles: profileMap,
    channelToOrg,
  };

  await prisma.agencyIntegration.update({
    where: {
      agencyId_provider: { agencyId: ctx.agencyId, provider: ExternalScheduler.BUFFER },
    },
    data: {
      meta: meta as unknown as object,
      lastSyncedAt: new Date(),
      lastSyncError: null,
    },
  });

  return {
    organizationCount: organizations.length,
    channelCount: channels.length,
    profiles: profileMap,
  };
}

export async function setAutoMarkPublished(
  ctx: TenantContext,
  value: boolean,
): Promise<AgencyIntegration> {
  requireRole(ctx, CONNECT_ROLES);
  return prisma.agencyIntegration.update({
    where: {
      agencyId_provider: { agencyId: ctx.agencyId, provider: ExternalScheduler.BUFFER },
    },
    data: { autoMarkPublished: value },
  });
}

export async function stampIntegrationSync(
  agencyId: string,
  provider: ExternalScheduler,
  err: string | null,
): Promise<void> {
  // No tenant guard — cron path. Callers are Inngest workers.
  await prisma.agencyIntegration.updateMany({
    where: { agencyId, provider },
    data: { lastSyncedAt: new Date(), lastSyncError: err },
  });
}

/**
 * Non-tenant-scoped read used by the sync cron. Decrypts the token, or
 * returns null if the vault can't decrypt (which the cron logs + skips).
 * Same proactive-refresh path as the tenant-scoped getter — the cron
 * consumes tokens at 5-minute cadence, so many polls fall inside the
 * refresh skew window.
 */
export async function getBufferIntegrationForAgencyRaw(
  agencyId: string,
): Promise<ResolvedBufferIntegration | null> {
  if (!isTokenVaultAvailable()) return null;
  const row = await prisma.agencyIntegration.findUnique({
    where: {
      agencyId_provider: { agencyId, provider: ExternalScheduler.BUFFER },
    },
  });
  if (!row) return null;
  const accessToken = await resolveFreshAccessToken({
    agencyId: row.agencyId,
    accessToken: row.accessToken,
    refreshToken: row.refreshToken,
    expiresAt: row.expiresAt,
  });
  if (!accessToken) return null;
  return {
    id: row.id,
    accessToken,
    meta: ((row.meta as BufferIntegrationMeta | null) ?? {
      organizationIds: [],
      profiles: {},
      channelToOrg: {},
    }) as BufferIntegrationMeta,
    autoMarkPublished: row.autoMarkPublished,
    lastSyncedAt: row.lastSyncedAt,
    lastSyncError: row.lastSyncError,
  };
}

export class IntegrationNotFoundError extends NotFoundError {
  constructor(provider: ExternalScheduler) {
    super(`No ${provider} integration connected for this agency.`);
  }
}

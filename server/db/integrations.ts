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
import { listOrganizationsAndChannels } from "@/server/integrations/buffer";
import { prisma } from "./client";

/**
 * Phase 3.3 — per-agency integration wiring for the scheduling surface.
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
 * Resolve the Buffer integration for the current agency — decrypts the
 * token, returns `null` if there's no row OR if the vault can't decrypt
 * (missing key, ciphertext tampered, key rotated). Missing key = feature
 * disabled; callers fall through to MANUAL mode.
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
  let accessToken: string;
  try {
    accessToken = decryptToken(row.accessToken);
  } catch (err) {
    if (err instanceof TokenVaultDecryptError) return null;
    throw err;
  }
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
    const result = await listOrganizationsAndChannels(integration.accessToken);
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
  let accessToken: string;
  try {
    accessToken = decryptToken(row.accessToken);
  } catch (err) {
    if (err instanceof TokenVaultDecryptError) return null;
    throw err;
  }
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

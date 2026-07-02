import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

// (`cookies` from `next/headers` is used only to READ + DELETE — deletion
// mid-handler is fine; the SET on `/connect` is what needed the response-
// object pattern in Next 16.)
import { MemberRole, Platform } from "@prisma/client";
import { requireAuthContext, assertRole } from "@/server/auth/context";
import { toTenantContext } from "@/server/auth/tenant";
import { connectBufferIntegration, type BufferIntegrationMeta } from "@/server/db/integrations";
import {
  exchangeCode,
  listOrganizationsAndChannels,
  BufferError,
} from "@/server/integrations/buffer";
import { TokenVaultUnavailableError } from "@/server/crypto/token-vault";
import { resolveAppBase } from "../connect/route";

/**
 * Buffer OAuth callback. All redirects anchor on `resolveAppBase()` — the
 * shared canonical origin — so we never emit `https://localhost:3000/...`
 * or a proxy-mangled URL when running behind ngrok / Vercel preview.
 */

const STATE_COOKIE = "buffer_oauth_state";
const VERIFIER_COOKIE = "buffer_oauth_verifier";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireAuthContext();
  assertRole(auth, [MemberRole.OWNER, MemberRole.ADMIN]);
  const ctx = toTenantContext(auth);

  const appBase = resolveAppBase();
  const backTo = (qs: string) => NextResponse.redirect(`${appBase}/settings/integrations?${qs}`);

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  const jar = await cookies();
  const savedState = jar.get(STATE_COOKIE)?.value ?? null;
  const codeVerifier = jar.get(VERIFIER_COOKIE)?.value ?? null;
  jar.delete(STATE_COOKIE);
  jar.delete(VERIFIER_COOKIE);

  console.log(
    `[buffer callback] host=${req.headers.get("host")} appBase=${appBase} savedState=${savedState ? "yes" : "MISSING"} verifier=${codeVerifier ? "yes" : "MISSING"} code=${code ? "yes" : "MISSING"}`,
  );

  if (!code) return backTo("error=missing_code");
  if (!codeVerifier) return backTo("error=missing_verifier");
  if (!state || !savedState || !constantTimeEqualStr(state, savedState)) {
    return backTo("error=bad_state");
  }

  const stateSecret = process.env.INTEGRATION_ENCRYPTION_KEY;
  if (!stateSecret) return backTo("error=missing_encryption_key");
  const parts = state.split(".");
  if (parts.length !== 3) return backTo("error=bad_state");
  const [agencyId, nonce, sig] = parts;
  const expectedSig = createHmac("sha256", stateSecret)
    .update(`${agencyId}.${nonce}`)
    .digest("base64url");
  if (!constantTimeEqualStr(sig!, expectedSig)) return backTo("error=bad_state");
  if (agencyId !== auth.agency.id) return backTo("error=bad_state");

  const clientId = process.env.BUFFER_CLIENT_ID;
  const clientSecret = process.env.BUFFER_CLIENT_SECRET;
  const redirectUri = process.env.BUFFER_REDIRECT_URI
    ? process.env.BUFFER_REDIRECT_URI
    : `${appBase}/api/integrations/buffer/callback`;
  if (!clientId) return backTo("error=missing_buffer_client_id");
  if (!clientSecret) return backTo("error=missing_buffer_client_secret");

  console.log(
    `[buffer callback] exchanging code, redirect_uri="${redirectUri}", token_url="${process.env.BUFFER_TOKEN_URL ?? "https://auth.buffer.com/token"}"`,
  );

  let accessToken: string;
  let refreshToken: string | null;
  let expiresAt: Date | null;
  try {
    const result = await exchangeCode({
      code,
      codeVerifier,
      clientId,
      clientSecret,
      redirectUri,
    });
    accessToken = result.accessToken;
    refreshToken = result.refreshToken;
    expiresAt = result.expiresAt;
  } catch (err) {
    if (err instanceof BufferError) {
      // Log the raw response — this is the ONLY signal we get for why the
      // token endpoint rejected us (wrong URL, wrong grant_type, wrong
      // redirect_uri byte-match, PKCE mismatch, etc.).
      console.error(
        `[buffer callback] token exchange failed status=${err.status} body="${err.body}"`,
      );
      return backTo(`error=token_exchange_failed&status=${encodeURIComponent(String(err.status))}`);
    }
    throw err;
  }

  // Enumerate the account's orgs + channels via GraphQL and build the
  // meta bag. `channelToOrg` is the reverse lookup the sync cron uses so
  // it can query `posts(input: {organizationId})` for a given scheduled
  // post's channel without walking orgs every time.
  let meta: BufferIntegrationMeta = { organizationIds: [], profiles: {}, channelToOrg: {} };
  try {
    const { organizations, channels } = await listOrganizationsAndChannels(accessToken);
    const profileMap: Partial<Record<Platform, string>> = {};
    const channelToOrg: Record<string, string> = {};
    for (const c of channels) {
      channelToOrg[c.id] = c.organizationId;
      if (c.platform && !profileMap[c.platform]) profileMap[c.platform] = c.id;
    }
    meta = {
      organizationIds: organizations.map((o) => o.id),
      profiles: profileMap,
      channelToOrg,
    };
  } catch (err) {
    console.error("Buffer channels enumeration failed on connect", err);
  }

  try {
    await connectBufferIntegration(ctx, {
      memberId: auth.member.id,
      accessToken,
      refreshToken,
      expiresAt,
      meta,
    });
  } catch (err) {
    if (err instanceof TokenVaultUnavailableError) {
      return backTo("error=token_vault_unavailable");
    }
    throw err;
  }

  return backTo("buffer=connected");
}

function constantTimeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

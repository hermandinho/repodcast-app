import { randomBytes, createHmac, createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { MemberRole } from "@prisma/client";
import { requireAuthContext, assertRole } from "@/server/auth/context";

/**
 * Kick off Buffer OAuth 2.0 (endpoint at `auth.buffer.com`).
 *
 * All redirect targets (both the OAuth redirect_uri and the error / success
 * bounces back to /settings/integrations) are derived from the same
 * canonical `appBase` — `NEXT_PUBLIC_APP_URL` or a direct override. We
 * NEVER derive from `req.url` because behind ngrok / Cloudflare / Vercel
 * preview URLs, Next's internal `req.url` can combine `x-forwarded-proto`
 * with an internal Host header (localhost:3000) and produce garbage like
 * `https://localhost:3000/...` — unreachable in every browser.
 */

const STATE_COOKIE = "buffer_oauth_state";
const VERIFIER_COOKIE = "buffer_oauth_verifier";
const STATE_MAX_AGE_SEC = 10 * 60;
const BUFFER_AUTHORIZE_URL = "https://auth.buffer.com/auth";
const BUFFER_SCOPES =
  "posts:write posts:read ideas:read ideas:write account:read account:write offline_access";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAuthContext();
  assertRole(auth, [MemberRole.OWNER, MemberRole.ADMIN]);

  const appBase = resolveAppBase();
  const backTo = (qs: string) => NextResponse.redirect(`${appBase}/settings/integrations?${qs}`);

  const clientId = process.env.BUFFER_CLIENT_ID;
  const stateSecret = process.env.INTEGRATION_ENCRYPTION_KEY;
  const redirectUri = resolveRedirectUri(appBase);
  if (!stateSecret) return backTo("error=missing_encryption_key");
  if (!clientId) return backTo("error=missing_buffer_client_id");

  console.log(`[buffer connect] emitting redirect_uri="${redirectUri}"`);

  // PKCE: code_verifier is 43+ random base64url chars; code_challenge is
  // base64url(sha256(verifier)). Buffer requires S256 method.
  const codeVerifier = randomBytes(32).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");

  // State: `<agencyId>.<nonce>.<hmacSig>` so the callback can verify the
  // round-trip wasn't tampered with and re-derive the agency without
  // trusting the caller's session alone.
  const nonce = randomBytes(16).toString("base64url");
  const payload = `${auth.agency.id}.${nonce}`;
  const sig = createHmac("sha256", stateSecret).update(payload).digest("base64url");
  const state = `${payload}.${sig}`;

  const authorizeUrl = new URL(BUFFER_AUTHORIZE_URL);
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("scope", BUFFER_SCOPES);
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("code_challenge", codeChallenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  authorizeUrl.searchParams.set("prompt", "consent");

  // Attach cookies to the response directly — `cookies().set()` from
  // `next/headers` doesn't always propagate through a
  // `NextResponse.redirect(...)` return value in Next 16. Setting on the
  // response object is the reliable pattern for handler responses that
  // both mutate cookies AND redirect.
  const response = NextResponse.redirect(authorizeUrl.toString());
  const cookieOpts = {
    httpOnly: true,
    // Ngrok terminates HTTPS at the tunnel, so the browser sees the app
    // over HTTPS even in dev. `secure: true` is safe on ngrok and mandatory
    // for `SameSite=Lax` cookies to survive cross-site OAuth in modern
    // browsers. If you drop ngrok and run raw localhost:3000, this needs
    // to flip to false for that non-HTTPS origin — the appBase check below
    // handles that.
    secure: appBase.startsWith("https://"),
    sameSite: "lax" as const,
    path: "/",
    maxAge: STATE_MAX_AGE_SEC,
  };
  response.cookies.set(STATE_COOKIE, state, cookieOpts);
  response.cookies.set(VERIFIER_COOKIE, codeVerifier, cookieOpts);
  return response;
}

/**
 * Canonical origin the whole OAuth flow anchors on. `NEXT_PUBLIC_APP_URL`
 * MUST match what's registered in the Buffer app dashboard and match the
 * origin the user is currently browsing from — otherwise cookies set on
 * one host won't be visible on the other and PKCE breaks.
 */
export function resolveAppBase(): string {
  const raw =
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
  return raw.replace(/\/$/, "");
}

/**
 * Buffer redirect_uri. `BUFFER_REDIRECT_URI` (full URL override) wins; else
 * we derive from `appBase`. In both branches this is a stable string that
 * MUST byte-match the callback URL registered in the Buffer app.
 */
function resolveRedirectUri(appBase: string): string {
  if (process.env.BUFFER_REDIRECT_URI) return process.env.BUFFER_REDIRECT_URI;
  return `${appBase}/api/integrations/buffer/callback`;
}

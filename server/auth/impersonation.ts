import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

/**
 * Phase 3.6.6 — read-only impersonation envelope.
 *
 * A platform admin (SystemAdmin) can drop into a tenant view as if they
 * were a specific Member. The envelope is held in an HMAC-signed cookie:
 * no DB round-trip on every page render, no Clerk session swap, no risk
 * of accidentally persisting the impersonation across sessions.
 *
 * Read-only is enforced via `requireRole` in `server/auth/tenant.ts` —
 * any role-gated write throws `ForbiddenError` when the context carries
 * a read-only impersonation. Write-mode impersonation (ROOT only) lands
 * in a later slice; the `mode` discriminator is in place so the shape
 * doesn't need to change.
 *
 * Cookie format: `<base64url(jsonPayload)>.<base64url(hmacSha256)>`. Both
 * halves are required, signature is checked in constant time.
 */

export const IMPERSONATION_COOKIE = "repodcast_impersonate";
export const IMPERSONATION_TTL_MS = 60 * 60 * 1000; // 60 minutes

export type ImpersonationMode = "read" | "write";

export type ImpersonationPayload = {
  /** SystemAdmin row id that opened the envelope. */
  systemAdminId: string;
  /** Member row the admin is acting as. */
  asMemberId: string;
  /** Agency the impersonated member belongs to. */
  agencyId: string;
  mode: ImpersonationMode;
  /** ISO timestamp. Expiry is computed as `startedAt + IMPERSONATION_TTL_MS`. */
  startedAt: string;
};

function getSigningKey(): Buffer | null {
  const raw = process.env.IMPERSONATION_SIGNING_KEY;
  if (!raw || raw.length < 32) return null;
  return Buffer.from(raw, "utf8");
}

function base64urlEncode(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(input: string): Buffer | null {
  try {
    const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
    return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
  } catch {
    return null;
  }
}

function sign(payloadB64: string, key: Buffer): string {
  return base64urlEncode(createHmac("sha256", key).update(payloadB64).digest());
}

/**
 * Encode + sign an impersonation payload into a cookie value. Returns null
 * when the signing key is not configured — callers should surface a clean
 * "impersonation is disabled" error rather than minting an unsigned cookie.
 */
export function encodeImpersonationCookie(payload: ImpersonationPayload): string | null {
  const key = getSigningKey();
  if (!key) return null;
  const payloadB64 = base64urlEncode(Buffer.from(JSON.stringify(payload), "utf8"));
  const sig = sign(payloadB64, key);
  return `${payloadB64}.${sig}`;
}

/**
 * Verify + decode an impersonation cookie value. Returns null on any failure
 * (missing key, malformed, bad signature, expired). Never throws — a tampered
 * cookie should look identical to no cookie at all.
 */
export function decodeImpersonationCookie(raw: string | undefined): ImpersonationPayload | null {
  if (!raw) return null;
  const key = getSigningKey();
  if (!key) return null;

  const dot = raw.indexOf(".");
  if (dot < 1 || dot === raw.length - 1) return null;
  const payloadB64 = raw.slice(0, dot);
  const sigB64 = raw.slice(dot + 1);

  const expected = sign(payloadB64, key);
  const a = base64urlDecode(sigB64);
  const b = base64urlDecode(expected);
  if (!a || !b || a.length !== b.length || !timingSafeEqual(a, b)) return null;

  const payloadBuf = base64urlDecode(payloadB64);
  if (!payloadBuf) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(payloadBuf.toString("utf8"));
  } catch {
    return null;
  }

  if (!isImpersonationPayload(payload)) return null;

  const startedAtMs = Date.parse(payload.startedAt);
  if (Number.isNaN(startedAtMs)) return null;
  if (Date.now() - startedAtMs > IMPERSONATION_TTL_MS) return null;

  return payload;
}

function isImpersonationPayload(value: unknown): value is ImpersonationPayload {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.systemAdminId === "string" &&
    typeof v.asMemberId === "string" &&
    typeof v.agencyId === "string" &&
    (v.mode === "read" || v.mode === "write") &&
    typeof v.startedAt === "string"
  );
}

/**
 * Read the current request's impersonation cookie (if any) and return the
 * verified payload. Server components / actions / route handlers can call
 * this freely.
 */
export async function readImpersonationPayload(): Promise<ImpersonationPayload | null> {
  const store = await cookies();
  return decodeImpersonationCookie(store.get(IMPERSONATION_COOKIE)?.value);
}

/**
 * Set the impersonation cookie. Caller is responsible for having verified
 * the SystemAdmin role + target Member upstream; this helper only handles
 * the cookie attributes (httpOnly, secure, lax, 60-min maxAge).
 *
 * Throws when the signing key is unset — failing closed beats minting an
 * unverifiable cookie.
 */
export async function setImpersonationCookie(payload: ImpersonationPayload): Promise<void> {
  const value = encodeImpersonationCookie(payload);
  if (!value) {
    throw new Error(
      "IMPERSONATION_SIGNING_KEY is unset (or shorter than 32 bytes). Impersonation is disabled.",
    );
  }
  const store = await cookies();
  store.set(IMPERSONATION_COOKIE, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(IMPERSONATION_TTL_MS / 1000),
  });
}

export async function clearImpersonationCookie(): Promise<void> {
  const store = await cookies();
  store.delete(IMPERSONATION_COOKIE);
}

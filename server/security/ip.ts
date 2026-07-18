import "server-only";

import { createHash } from "node:crypto";
import { headers } from "next/headers";

/**
 * Resolve the caller's client IP from the request headers Vercel /
 * Cloudflare / most proxies forward. Returns `null` when nothing
 * plausible is present — the caller decides whether that's fatal.
 *
 * We check headers in the order proxies most reliably set them:
 *   1. `cf-connecting-ip` — Cloudflare's canonical header
 *   2. `x-real-ip` — nginx / most reverse proxies
 *   3. `x-forwarded-for` — first entry (client) of the chain
 */
export async function getClientIp(): Promise<string | null> {
  const h = await headers();
  const cf = h.get("cf-connecting-ip");
  if (cf) return cf.trim();
  const real = h.get("x-real-ip");
  if (real) return real.trim();
  const fwd = h.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  return null;
}

/**
 * Salted SHA-256 hash of an IP. Used on `SupportTicket.ipHash` so we can
 * answer "is this address spamming us?" without storing raw PII. The salt
 * comes from `IP_HASH_SALT` — a random 32+ byte value set per environment.
 * Rotating the salt intentionally severs the ability to correlate old
 * rows with new submissions, which is the trade you want at rotation time.
 *
 * When the salt is unset we still hash (so the column is populated), but
 * we log a warning — an unsalted hash is trivially rainbow-tableable
 * against an IP range, so prod should always set it.
 */
export function hashIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const salt = process.env.IP_HASH_SALT;
  if (!salt) {
    console.warn("[security] IP_HASH_SALT not set — hashing IP unsalted");
  }
  return createHash("sha256")
    .update(`${salt ?? ""}:${ip}`)
    .digest("hex");
}

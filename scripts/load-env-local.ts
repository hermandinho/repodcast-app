import { readFileSync } from "node:fs";

/**
 * Shared dotenv loader for CLI scripts.
 *
 * Next.js auto-loads `.env.local` in `next dev` / `next build`, but the
 * Prisma CLI + raw `tsx` scripts don't — they only read `.env`. This helper
 * fills the gap so seed scripts, the validation harness, and `prisma.config`
 * all see the same secrets the app sees in dev.
 *
 * Precedence (highest first): existing `process.env` → `.env.local` → `.env`.
 * Wrapping single/double quotes are stripped. Comments + blank lines ignored.
 *
 * Idempotent: calling more than once is a no-op for already-set keys.
 */
export function loadEnvLocal(path = ".env.local"): void {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return;
  }
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Z_][A-Z0-9_]*$/i.test(key)) continue;
    if (process.env[key]) continue;
    let value = line.slice(eq + 1).trim();
    const quoted = value.match(/^(['"])(.*)\1$/);
    if (quoted) value = quoted[2];
    process.env[key] = value;
  }
}

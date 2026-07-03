import { DEFAULT_TRUSTED_BY, LANDING_TRUSTED_BY_KEY } from "./landing-trusted-by";

/**
 * Registry of every `SystemConfig` key the codebase reads at runtime. Powers
 * the "Known configs" panel at `/root/config` so a fresh deployment surfaces
 * a checklist of keys the app expects — instead of silently falling back to
 * built-in defaults while operators wonder why the copy on the landing looks
 * off.
 *
 * Adding a new key: create the const in the same module that reads it (see
 * `lib/landing-trusted-by.ts`), then append one entry here.
 *
 * Fields:
 * - `key`         — matches `SystemConfig.key` (UPPER_SNAKE_CASE, 2-64 chars).
 * - `label`       — short human name for the panel header.
 * - `purpose`     — one-sentence description of what the value drives.
 * - `readAt`      — where in the code the key is consumed (file path). Helps
 *                   an operator confirm they've configured the right thing.
 * - `defaultBehavior` — what the app does when the key is missing. Rendered
 *                   verbatim in the panel so the operator can decide whether
 *                   the fallback is acceptable for their deployment.
 * - `example`     — the value stored under this key when the operator picks
 *                   "Configure with defaults". Must satisfy the reader's Zod
 *                   schema.
 * - `docHref?`    — optional deep-link (e.g. relative anchor into a docs
 *                   page) shown next to the panel entry.
 */
export type KnownConfigEntry = {
  key: string;
  label: string;
  purpose: string;
  readAt: string;
  defaultBehavior: string;
  example: unknown;
  docHref?: string;
  /**
   * Route paths that render this value and must be revalidated when the key
   * is written or deleted. Without this the DB row updates but the CDN keeps
   * serving stale HTML for the affected page(s).
   */
  revalidatePaths?: readonly string[];
};

export const KNOWN_SYSTEM_CONFIG: readonly KnownConfigEntry[] = [
  {
    key: LANDING_TRUSTED_BY_KEY,
    label: "Landing “Trusted by” strip",
    purpose:
      "Studios listed under the hero on the marketing landing page. Operators edit this without a redeploy.",
    readAt: "lib/landing-trusted-by.ts",
    defaultBehavior:
      "Renders a placeholder set of studio names so the strip isn't broken — replace on a real deployment before launch.",
    example: DEFAULT_TRUSTED_BY,
    revalidatePaths: ["/"],
  },
];

/** Look up a catalog entry by its `SystemConfig.key`. */
export function findKnownConfig(key: string): KnownConfigEntry | undefined {
  return KNOWN_SYSTEM_CONFIG.find((entry) => entry.key === key);
}

/**
 * Merge the catalog with the persisted SystemConfig rows so the UI can show
 * per-key status without cross-referencing on the render side. The catalog
 * order is preserved; unknown DB keys (ad-hoc entries added by an operator)
 * are omitted — the "Platform config" section below already lists those.
 */
export function mergeKnownConfigStatus(
  configured: readonly { key: string }[],
): Array<KnownConfigEntry & { isConfigured: boolean }> {
  const configuredKeys = new Set(configured.map((r) => r.key));
  return KNOWN_SYSTEM_CONFIG.map((entry) => ({
    ...entry,
    isConfigured: configuredKeys.has(entry.key),
  }));
}

export function countMissingKnownConfigs(configured: readonly { key: string }[]): number {
  const configuredKeys = new Set(configured.map((r) => r.key));
  return KNOWN_SYSTEM_CONFIG.reduce((n, entry) => (configuredKeys.has(entry.key) ? n : n + 1), 0);
}

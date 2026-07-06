/**
 * Tiny helper that answers "are we backed by a real database?" — extracted
 * from `server/data/source.ts` so callers that only need this flag don't
 * pull the whole source module (and its transitive `server/db/*` imports)
 * through their build-time import graph.
 *
 * Kept free of `import "server-only"` so it's safe to import from any
 * server context — including thin routing shims like `after-sign-in/
 * page.tsx` where dragging in `source.ts` triggered CI-only Turbopack
 * failures via the `server/db/outputs.ts` chain.
 */
export function isLiveDb(): boolean {
  return !!process.env.DATABASE_URL;
}

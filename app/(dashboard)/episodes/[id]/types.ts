/**
 * Shared type surface for the episode-detail route.
 *
 * Lives in its own module (not the `"use server"` actions file) so
 * client components can import these types without dragging the whole
 * server-actions module — and its `server/db/outputs.ts` transitive
 * imports — through the browser bundle's type-resolution graph. Some
 * production Turbopack builds fail on that chain even when the imports
 * are `type`-only.
 */

/**
 * One row in the output version-history switcher. Emitted by
 * `listOutputVersionsAction` and consumed by the drawer's version
 * dropdown. Kept string-only + date-as-ISO so it round-trips cleanly
 * from server action to client state.
 */
export type OutputVersionSummary = {
  id: string;
  version: number;
  status: string;
  content: string;
  quality: number | null;
  lastInstruction: string | null;
  createdAt: string;
  isCurrent: boolean;
};

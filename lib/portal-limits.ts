/**
 * Client-safe shared limits for the `/portal/[token]` surface.
 *
 * Split out from `server/db/client-portal.ts` because the portal's
 * feedback form (`components/portal/output-card.tsx`) is a client
 * component that needs the body-length cap for its counter + textarea
 * clamp. Importing anything from `server/db/client-portal.ts` would drag
 * `import "server-only"` (and the whole Prisma tree) into the client
 * bundle — Next 16 errors at build time.
 *
 * The server-side authoritative check lives in `submitPortalFeedbackInput`
 * (zod schema in `server/db/client-portal.ts`) which reads this same
 * constant. Keep the numbers in sync there.
 */

/** Max characters a client may submit in a single feedback body. */
export const PORTAL_FEEDBACK_BODY_MAX = 2000;

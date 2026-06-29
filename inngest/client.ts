import { Inngest } from "inngest";

/**
 * The Inngest client. Event-data typing is per-function via the payload
 * types in `inngest/events.ts` (Inngest 4 dropped the `EventSchemas` API;
 * we annotate `event.data` at the handler level instead).
 */
export const inngest = new Inngest({
  id: "repodcast",
});

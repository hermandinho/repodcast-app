import { Inngest } from "inngest";

/**
 * The Inngest client. Event-data typing is per-function via the payload
 * types in `inngest/events.ts` (Inngest 4 dropped the `EventSchemas` API;
 * we annotate `event.data` at the handler level instead).
 *
 * Prod runs against a self-hosted Inngest server behind Cloudflare Access
 * (see `infra/inngest/`). The SDK proves it's this app by attaching a
 * Service Token to every outbound call (event send AND `/fn/register` from
 * the serve handler — both flow through `client.fetch`). Staging + local
 * dev leave the env vars unset and fall through to Inngest Cloud with the
 * default fetch.
 */
const cfAccessHeaders =
  process.env.CF_ACCESS_CLIENT_ID && process.env.CF_ACCESS_CLIENT_SECRET
    ? {
        "CF-Access-Client-Id": process.env.CF_ACCESS_CLIENT_ID,
        "CF-Access-Client-Secret": process.env.CF_ACCESS_CLIENT_SECRET,
      }
    : null;

export const inngest = new Inngest({
  id: "repodcast",
  baseUrl: process.env.INNGEST_BASE_URL,
  fetch: cfAccessHeaders
    ? (input, init) =>
        fetch(input, {
          ...init,
          headers: { ...init?.headers, ...cfAccessHeaders },
        })
    : undefined,
});

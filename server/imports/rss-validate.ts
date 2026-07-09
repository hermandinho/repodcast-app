import "server-only";

/**
 * Lightweight RSS/Atom reachability check used at show-creation time — before
 * we persist an `rssUrl` onto a `Show` we want to know the URL actually
 * resolves to something that parses as a feed. This is not a full RSS parse:
 * we sniff the first couple of KB for an XML declaration or a feed root
 * element. Podcast Index does the heavier lifting later, when the wizard
 * imports episodes.
 */

const FETCH_TIMEOUT_MS = 10_000;
const SNIFF_BYTES = 4096;
const USER_AGENT = "Repodcast/1.0 (+https://repodcastapp.com)";
const ACCEPT =
  "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5";

export type RssValidationResult = { ok: true } | { ok: false; error: string };

/**
 * Fetch `rssUrl` with a hard timeout and confirm the response looks like an
 * RSS or Atom feed. Any 4xx/5xx, network error, timeout, or non-feed body
 * comes back as `{ ok: false, error }` — callers surface the message to the
 * user without throwing.
 */
export async function validateRssUrl(rssUrl: string): Promise<RssValidationResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(rssUrl, {
      signal: controller.signal,
      redirect: "follow",
      cache: "no-store",
      headers: { "User-Agent": USER_AGENT, Accept: ACCEPT },
    });
    if (!res.ok) {
      return { ok: false, error: `RSS feed returned ${res.status} ${res.statusText}.` };
    }
    if (!res.body) {
      return { ok: false, error: "RSS feed responded with an empty body." };
    }

    const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
    const sniff = (await readPrefix(res, SNIFF_BYTES)).trim();
    const lowered = sniff.toLowerCase();

    const contentTypeLooksFeedy =
      contentType.includes("xml") || contentType.includes("rss") || contentType.includes("atom");
    const bodyLooksFeedy =
      lowered.startsWith("<?xml") ||
      lowered.includes("<rss") ||
      lowered.includes("<feed") ||
      lowered.includes("<channel");

    if (!contentTypeLooksFeedy && !bodyLooksFeedy) {
      return { ok: false, error: "URL doesn't look like an RSS or Atom feed." };
    }
    if (!bodyLooksFeedy) {
      return { ok: false, error: "URL responded but doesn't contain an RSS or Atom feed." };
    }
    return { ok: true };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { ok: false, error: "RSS feed didn't respond in 10 seconds." };
    }
    const detail = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Couldn't reach RSS feed: ${detail}` };
  } finally {
    clearTimeout(timer);
  }
}

async function readPrefix(res: Response, maxBytes: number): Promise<string> {
  const reader = res.body!.getReader();
  const chunks: Uint8Array[] = [];
  let seen = 0;
  try {
    while (seen < maxBytes) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        seen += value.byteLength;
      }
    }
  } finally {
    // Cancelling the reader frees the socket without draining the rest of
    // the body — we only need the first few KB to sniff the feed root.
    await reader.cancel().catch(() => undefined);
  }
  const merged = new Uint8Array(seen);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(merged.subarray(0, maxBytes));
}

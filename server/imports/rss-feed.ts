import "server-only";

import { XMLParser } from "fast-xml-parser";
import {
  isPodcastIndexConfigured,
  listEpisodesByFeedId,
  lookupFeedByUrl,
  PodcastIndexError,
  type PodcastIndexEpisode,
  type PodcastIndexFeed,
  type PodcastIndexTranscript,
} from "@/server/imports/podcastindex";

/**
 * Phase 2.8 followup — direct RSS parser and fallback resolver.
 *
 * Podcast Index doesn't crawl every feed (Substack, Patreon, self-hosted
 * publishers routinely absent), so when its lookup misses, we fetch the RSS
 * ourselves and parse it into the same PodcastIndex* shapes the rest of the
 * pipeline consumes. Scope is RSS 2.0 with the `itunes:` and `podcast:`
 * namespace extensions — the de-facto standard for podcast feeds.
 *
 * The feed and episode ids come back as `0` when we produced them from a
 * direct parse (Podcast Index uses 0 for "not indexed" too). Downstream
 * callers already treat `id: 0` as "no PI lookup available" — see
 * parseFeedEnvelope's null-collapse for `id === 0`.
 */

const FETCH_TIMEOUT_MS = 15_000;
const USER_AGENT = "Repodcast/1.0 (+https://repodcastapp.com)";
const ACCEPT = "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8";

export class RssFeedError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "RssFeedError";
  }
}

export type FeedSource = "podcast-index" | "direct-rss";

export type ResolvedFeed = {
  source: FeedSource;
  feed: PodcastIndexFeed;
  episodes: PodcastIndexEpisode[];
};

/**
 * Fetch an RSS URL and parse it into feed + episodes. Throws `RssFeedError`
 * on network failure, non-2xx response, or unparseable XML.
 *
 * Empty `episodes[]` is a legitimate result — a brand-new feed with zero
 * items posted still parses fine.
 */
export async function fetchAndParseRssFeed(rssUrl: string): Promise<ResolvedFeed> {
  const xml = await fetchFeedXml(rssUrl);
  return parseRssFeedXml(xml, rssUrl);
}

/**
 * Try Podcast Index first when configured — its numeric feed id enables the
 * cheaper byfeedid pagination and it normalises transcript URLs across
 * publishers — then fall through to a direct RSS parse. Returns `null` only
 * when both paths agree the feed doesn't exist (or when the feed URL is
 * unreachable and PI has never seen it).
 */
export async function resolveFeed(
  rssUrl: string,
  maxEpisodes: number,
): Promise<ResolvedFeed | null> {
  if (isPodcastIndexConfigured()) {
    try {
      const feed = await lookupFeedByUrl(rssUrl);
      if (feed) {
        const episodes = await listEpisodesByFeedId(feed.id, maxEpisodes);
        return { source: "podcast-index", feed, episodes };
      }
    } catch (err) {
      // 5xx / auth errors are worth surfacing — let the caller decide. 4xx
      // "unknown feed" already becomes null upstream, so anything thrown
      // here is a genuine problem talking to PI.
      if (err instanceof PodcastIndexError && err.status >= 500) {
        throw err;
      }
      // Non-PodcastIndexError (network glitch) — also fall through and let
      // the direct-parse path try. If both fail, the direct parse's error
      // is what the user sees.
    }
  }

  const resolved = await fetchAndParseRssFeed(rssUrl);
  return {
    source: "direct-rss",
    feed: resolved.feed,
    episodes: resolved.episodes.slice(0, maxEpisodes),
  };
}

async function fetchFeedXml(rssUrl: string): Promise<string> {
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
      throw new RssFeedError(`RSS feed returned ${res.status} ${res.statusText} for ${rssUrl}`);
    }
    return await res.text();
  } catch (err) {
    if (err instanceof RssFeedError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new RssFeedError(`RSS feed at ${rssUrl} didn't respond in ${FETCH_TIMEOUT_MS}ms`);
    }
    const detail = err instanceof Error ? err.message : String(err);
    throw new RssFeedError(`Couldn't reach RSS feed at ${rssUrl}: ${detail}`, { cause: err });
  } finally {
    clearTimeout(timer);
  }
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  trimValues: true,
  parseAttributeValue: false,
  // Keep numeric-looking text as strings; we cast per-field so a guid like
  // "12345" doesn't get silently coerced and lose the leading zeroes.
  parseTagValue: false,
});

/**
 * Parse an RSS 2.0 document into feed + episodes. Exported for tests — the
 * production paths call through `fetchAndParseRssFeed`.
 *
 * `sourceUrl` is the URL we fetched from; used as a fallback for the
 * canonical feed URL when the document doesn't carry an `<atom:link
 * rel="self">`.
 */
export function parseRssFeedXml(xml: string, sourceUrl: string): ResolvedFeed {
  let doc: unknown;
  try {
    doc = parser.parse(xml);
  } catch (err) {
    throw new RssFeedError(`Feed at ${sourceUrl} is not parseable XML`, { cause: err });
  }
  const channel = extractChannel(doc);
  if (!channel) {
    throw new RssFeedError(`Feed at ${sourceUrl} has no <rss><channel> — not an RSS 2.0 document`);
  }

  const feed: PodcastIndexFeed = {
    id: 0,
    title: extractText(channel.title) ?? "",
    url: pickSelfLink(channel) ?? sourceUrl,
    originalUrl: sourceUrl,
    description: extractText(channel.description),
    author: extractText(channel["itunes:author"]) ?? extractText(channel.managingEditor),
    image: pickChannelImage(channel),
  };

  const rawItems = toArray(channel.item);
  const episodes: PodcastIndexEpisode[] = [];
  for (const raw of rawItems) {
    const ep = mapItem(raw);
    if (ep) episodes.push(ep);
  }
  feed.episodeCount = episodes.length;

  return { source: "direct-rss", feed, episodes };
}

// ------------------------- helpers -------------------------

type Bag = Record<string, unknown>;

function extractChannel(doc: unknown): Bag | null {
  if (!isBag(doc)) return null;
  const rss = doc.rss;
  if (!isBag(rss)) return null;
  const channel = rss.channel;
  if (!isBag(channel)) return null;
  return channel;
}

function isBag(v: unknown): v is Bag {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function toArray<T>(v: T | T[] | undefined | null): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

/**
 * fast-xml-parser leaves leaf text as a plain string when the element has
 * no attributes, and as `{ "#text": "value", ...attrs }` when it does.
 * Normalise to the underlying string.
 */
function extractText(v: unknown): string | undefined {
  if (typeof v === "string") return v.length > 0 ? v : undefined;
  if (typeof v === "number") return String(v);
  if (isBag(v) && typeof v["#text"] === "string") return v["#text"];
  return undefined;
}

function pickSelfLink(channel: Bag): string | undefined {
  const links = toArray(channel["atom:link"] as Bag | Bag[] | undefined);
  for (const link of links) {
    if (isBag(link) && link.rel === "self" && typeof link.href === "string") {
      return link.href;
    }
  }
  return undefined;
}

function pickChannelImage(channel: Bag): string | undefined {
  const itunesImg = channel["itunes:image"];
  if (isBag(itunesImg) && typeof itunesImg.href === "string") return itunesImg.href;
  // Traditional RSS <image><url>...</url></image>
  const rssImg = channel.image;
  if (isBag(rssImg)) {
    const urlText = extractText(rssImg.url);
    if (urlText) return urlText;
  }
  return undefined;
}

function mapItem(item: unknown): PodcastIndexEpisode | null {
  if (!isBag(item)) return null;
  const guid = extractText(item.guid);
  const enclosure = item.enclosure;
  if (!guid || !isBag(enclosure)) return null;
  const enclosureUrl = typeof enclosure.url === "string" ? enclosure.url : undefined;
  if (!enclosureUrl) return null;

  const publishedMs = parsePubDate(extractText(item.pubDate));
  const enclosureLength = parsePositiveInt(enclosure.length);
  const duration = parseDurationSeconds(extractText(item["itunes:duration"]));

  const transcripts: PodcastIndexTranscript[] = [];
  for (const t of toArray(item["podcast:transcript"] as Bag | Bag[] | undefined)) {
    if (isBag(t) && typeof t.url === "string" && typeof t.type === "string") {
      transcripts.push({ url: t.url, type: t.type });
    }
  }

  return {
    id: 0,
    title: extractText(item.title) ?? "Untitled episode",
    guid,
    datePublished: new Date(publishedMs),
    description: extractText(item.description) ?? extractText(item["content:encoded"]),
    enclosureUrl,
    enclosureType: typeof enclosure.type === "string" ? enclosure.type : undefined,
    enclosureLength,
    duration,
    transcripts,
  };
}

function parsePubDate(raw: string | undefined): number {
  if (!raw) return Date.now();
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : Date.now();
}

function parsePositiveInt(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : undefined;
}

/**
 * `<itunes:duration>` comes in three flavours: seconds ("1502"), MM:SS
 * ("25:30"), or HH:MM:SS ("1:23:45"). Anything else — undefined.
 */
function parseDurationSeconds(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    return n > 0 ? n : undefined;
  }
  const parts = raw.split(":").map((p) => Number(p));
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) return undefined;
  let seconds = 0;
  if (parts.length === 2) {
    seconds = parts[0]! * 60 + parts[1]!;
  } else if (parts.length === 3) {
    seconds = parts[0]! * 3600 + parts[1]! * 60 + parts[2]!;
  } else {
    return undefined;
  }
  return seconds > 0 ? Math.trunc(seconds) : undefined;
}

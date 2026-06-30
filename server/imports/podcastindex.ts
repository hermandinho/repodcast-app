import "server-only";

import { createHash } from "node:crypto";

/**
 * Phase 2.8 — Podcast Index REST client. Used by the RSS import path to
 * resolve an RSS feed URL to its episodes, look up a specific episode, and
 * surface transcript URLs when the publisher exposes them.
 *
 * We avoid `podcastindex-js` for the same reason we avoid `@deepgram/sdk`:
 * the SDK pulls in Node-only deps that bloat the Inngest function bundle,
 * and we only call three endpoints from one place.
 *
 * Auth: Podcast Index uses a custom three-header scheme — `X-Auth-Key` is
 * the API key, `X-Auth-Date` is a Unix-seconds timestamp, and
 * `Authorization` is the SHA-1 hex of `key + secret + timestamp`. The
 * request must also include a `User-Agent`.
 *
 * Reference: https://podcastindex-org.github.io/docs-api/
 */

const BASE_URL = "https://api.podcastindex.org/api/1.0";
const USER_AGENT = "Repodcast/1.0 (+https://repodcast.app)";

export type PodcastIndexFeed = {
  /** Podcast Index numeric feed id — stable, used to fetch episodes. */
  id: number;
  title: string;
  url: string;
  /** Owner-supplied RSS feed URL — may differ from `url` after redirects. */
  originalUrl?: string;
  description?: string;
  author?: string;
  /** Cover artwork (square). */
  image?: string;
  /** Episode count reported by the index — useful for the connect UI. */
  episodeCount?: number;
};

export type PodcastIndexEpisode = {
  /** Podcast Index numeric episode id. */
  id: number;
  title: string;
  /** Publisher-supplied GUID — what we store on `Episode.externalUrl`. */
  guid: string;
  /** ISO timestamp of the episode publication. */
  datePublished: Date;
  description?: string;
  /** Direct audio URL (typically MP3). Empty for video-only episodes. */
  enclosureUrl: string;
  /** MIME type of the enclosure (`audio/mpeg`, `audio/x-m4a`, etc.). */
  enclosureType?: string;
  enclosureLength?: number;
  /** Duration in seconds when reported by the feed. */
  duration?: number;
  /**
   * Publisher-attached transcripts (Podcasting 2.0 `<podcast:transcript>` tag).
   * Empty array when the publisher exposes none.
   */
  transcripts: PodcastIndexTranscript[];
};

export type PodcastIndexTranscript = {
  url: string;
  /** MIME type — `text/plain`, `text/vtt`, `application/srt`, `application/json`. */
  type: string;
};

export class PodcastIndexError extends Error {
  readonly status: number;
  readonly body: string;
  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = "PodcastIndexError";
    this.status = status;
    this.body = body;
  }
}

type RawFeedEnvelope = {
  status?: string | boolean;
  feed?: RawFeed | RawFeed[];
  description?: string;
};

type RawEpisodeEnvelope = {
  status?: string | boolean;
  items?: RawEpisode[];
  count?: number;
  description?: string;
};

type RawFeed = {
  id?: number;
  title?: string;
  url?: string;
  originalUrl?: string;
  description?: string;
  author?: string;
  image?: string;
  artwork?: string;
  episodeCount?: number;
};

type RawEpisode = {
  id?: number;
  title?: string;
  guid?: string;
  datePublished?: number;
  description?: string;
  enclosureUrl?: string;
  enclosureType?: string;
  enclosureLength?: number;
  duration?: number;
  transcripts?: Array<{ url?: string; type?: string }>;
  transcriptUrl?: string;
};

/**
 * Builds the three auth headers Podcast Index requires.
 *
 * Exported for the unit tests — production paths always call through
 * `podcastIndexFetch`. The timestamp must match between `X-Auth-Date` and
 * the hash input, so callers pass one in (rather than each helper minting
 * its own and risking a 1-second skew on slow paths).
 */
export function buildAuthHeaders(
  apiKey: string,
  apiSecret: string,
  unixTimestamp: number,
): Record<string, string> {
  const hash = createHash("sha1")
    .update(apiKey + apiSecret + String(unixTimestamp))
    .digest("hex");
  return {
    "X-Auth-Key": apiKey,
    "X-Auth-Date": String(unixTimestamp),
    Authorization: hash,
    "User-Agent": USER_AGENT,
  };
}

function requireConfig(): { key: string; secret: string } {
  const key = process.env.PODCAST_INDEX_KEY;
  const secret = process.env.PODCAST_INDEX_SECRET;
  if (!key || !secret) {
    throw new Error(
      "Podcast Index is not configured — set PODCAST_INDEX_KEY and PODCAST_INDEX_SECRET.",
    );
  }
  return { key, secret };
}

export function isPodcastIndexConfigured(): boolean {
  return Boolean(process.env.PODCAST_INDEX_KEY && process.env.PODCAST_INDEX_SECRET);
}

async function podcastIndexFetch<T>(path: string, params: Record<string, string>): Promise<T> {
  const { key, secret } = requireConfig();
  const timestamp = Math.floor(Date.now() / 1000);
  const url = `${BASE_URL}${path}?${new URLSearchParams(params).toString()}`;
  const res = await fetch(url, { headers: buildAuthHeaders(key, secret, timestamp) });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new PodcastIndexError(
      `Podcast Index returned ${res.status} ${res.statusText} for ${path}`,
      res.status,
      body,
    );
  }
  return (await res.json()) as T;
}

/**
 * Resolve a feed URL to a Podcast Index feed entry. Returns null when no
 * feed matches — the index keeps its own crawl, and brand-new feeds may
 * not be present until the next scan.
 */
export async function lookupFeedByUrl(rssUrl: string): Promise<PodcastIndexFeed | null> {
  const raw = await podcastIndexFetch<RawFeedEnvelope>("/podcasts/byfeedurl", { url: rssUrl });
  return parseFeedEnvelope(raw);
}

/**
 * Fetch the most-recent `max` episodes for a feed. Episodes come back in
 * reverse-chronological order (newest first), matching the UI's "pick the
 * latest one" affordance.
 */
export async function listEpisodesByFeedId(
  feedId: number,
  max = 20,
): Promise<PodcastIndexEpisode[]> {
  const raw = await podcastIndexFetch<RawEpisodeEnvelope>("/episodes/byfeedid", {
    id: String(feedId),
    max: String(max),
  });
  return parseEpisodeEnvelope(raw);
}

/**
 * Resolve a specific episode by its publisher GUID. We need the parent
 * feed URL because GUIDs are only unique within a feed (publishers
 * routinely reuse short ids).
 */
export async function lookupEpisodeByGuid(
  guid: string,
  feedUrl: string,
): Promise<PodcastIndexEpisode | null> {
  const raw = await podcastIndexFetch<RawEpisodeEnvelope>("/episodes/byguid", {
    guid,
    feedurl: feedUrl,
  });
  const items = parseEpisodeEnvelope(raw);
  return items[0] ?? null;
}

/**
 * Parse a feed envelope. Podcast Index returns `feed` as either an object
 * or an array depending on the endpoint, and as `false`/`[]` when nothing
 * matched — normalise to `null` so callers don't have to remember which.
 *
 * Exported for tests.
 */
export function parseFeedEnvelope(raw: RawFeedEnvelope): PodcastIndexFeed | null {
  const feed = Array.isArray(raw.feed) ? raw.feed[0] : raw.feed;
  if (!feed || typeof feed.id !== "number" || feed.id === 0) return null;
  return {
    id: feed.id,
    title: feed.title ?? "",
    url: feed.url ?? "",
    originalUrl: feed.originalUrl,
    description: feed.description,
    author: feed.author,
    image: feed.image ?? feed.artwork,
    episodeCount: feed.episodeCount,
  };
}

/**
 * Parse an episode list envelope into the typed shape. Skips rows that
 * lack the fields we depend on (id, guid, enclosureUrl) so callers can
 * trust every returned row is import-ready.
 *
 * Exported for tests.
 */
export function parseEpisodeEnvelope(raw: RawEpisodeEnvelope): PodcastIndexEpisode[] {
  const items = raw.items ?? [];
  return items
    .filter(
      (it): it is RawEpisode & { id: number; guid: string; enclosureUrl: string } =>
        typeof it.id === "number" &&
        typeof it.guid === "string" &&
        it.guid.length > 0 &&
        typeof it.enclosureUrl === "string" &&
        it.enclosureUrl.length > 0,
    )
    .map((it) => {
      // `datePublished` is Unix seconds; multiply for the Date ctor. Some
      // older feeds report 0 — fall back to "now" so the UI still sorts.
      const publishedMs =
        typeof it.datePublished === "number" && it.datePublished > 0
          ? it.datePublished * 1000
          : Date.now();

      const transcripts: PodcastIndexTranscript[] = [];
      for (const t of it.transcripts ?? []) {
        if (t.url && t.type) transcripts.push({ url: t.url, type: t.type });
      }
      // Older `transcriptUrl` shape (pre-2.0). Treat as plain text — the
      // download path defaults to text/plain when type is missing.
      if (transcripts.length === 0 && it.transcriptUrl) {
        transcripts.push({ url: it.transcriptUrl, type: "text/plain" });
      }

      return {
        id: it.id,
        title: it.title ?? "Untitled episode",
        guid: it.guid,
        datePublished: new Date(publishedMs),
        description: it.description,
        enclosureUrl: it.enclosureUrl,
        enclosureType: it.enclosureType,
        enclosureLength: it.enclosureLength,
        duration: it.duration,
        transcripts,
      };
    });
}

/**
 * Pick the best transcript URL from a Podcast Index episode. Preference
 * order: VTT → SRT → plain text → JSON. Returns null when the publisher
 * exposes none — the importer falls back to the audio pipeline in that
 * case.
 *
 * Exported for tests + the importer.
 */
export function pickTranscriptUrl(
  transcripts: PodcastIndexTranscript[],
): PodcastIndexTranscript | null {
  if (transcripts.length === 0) return null;
  const order = ["text/vtt", "application/srt", "text/srt", "text/plain", "application/json"];
  for (const mime of order) {
    const match = transcripts.find((t) => t.type.toLowerCase().startsWith(mime));
    if (match) return match;
  }
  return transcripts[0]!;
}

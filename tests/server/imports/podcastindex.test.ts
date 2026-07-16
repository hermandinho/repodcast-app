import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  buildAuthHeaders,
  lookupEpisodeByGuid,
  lookupFeedByUrl,
  parseEpisodeEnvelope,
  parseFeedEnvelope,
  pickTranscriptUrl,
  PodcastIndexError,
} from "@/server/imports/podcastindex";

describe("buildAuthHeaders", () => {
  it("hashes key+secret+timestamp with SHA-1 and sets the four required headers", () => {
    const headers = buildAuthHeaders("KEYABC", "SECRETXYZ", 1_700_000_000);
    const expected = createHash("sha1").update("KEYABCSECRETXYZ1700000000").digest("hex");

    expect(headers["X-Auth-Key"]).toBe("KEYABC");
    expect(headers["X-Auth-Date"]).toBe("1700000000");
    expect(headers.Authorization).toBe(expected);
    // User-Agent is required by the API even though it's not part of the hash.
    expect(headers["User-Agent"]).toMatch(/Repodcast/);
  });

  it("produces a fresh hash for every distinct timestamp", () => {
    const a = buildAuthHeaders("k", "s", 100);
    const b = buildAuthHeaders("k", "s", 101);
    expect(a.Authorization).not.toBe(b.Authorization);
  });
});

describe("parseFeedEnvelope", () => {
  it("returns the feed shape when the index has one", () => {
    const feed = parseFeedEnvelope({
      status: "true",
      feed: {
        id: 75075,
        title: "The Founders Frequency",
        url: "https://feeds.example.com/ff.xml",
        originalUrl: "https://founders.example.com/feed.xml",
        author: "Maya Chen",
        image: "https://cdn.example.com/cover.jpg",
        episodeCount: 42,
      },
    });
    expect(feed).toEqual({
      id: 75075,
      title: "The Founders Frequency",
      url: "https://feeds.example.com/ff.xml",
      originalUrl: "https://founders.example.com/feed.xml",
      description: undefined,
      author: "Maya Chen",
      image: "https://cdn.example.com/cover.jpg",
      episodeCount: 42,
    });
  });

  it("unwraps `feed` when the endpoint returns it as an array", () => {
    const feed = parseFeedEnvelope({
      status: "true",
      feed: [{ id: 1, title: "A", url: "u" }],
    });
    expect(feed?.id).toBe(1);
  });

  it("returns null when the index has no matching feed (id 0)", () => {
    // Podcast Index's "not found" response carries `id: 0`. The wrapper
    // must collapse that to null so callers can branch cleanly.
    expect(parseFeedEnvelope({ status: "true", feed: { id: 0 } })).toBeNull();
  });

  it("returns null when `feed` is missing entirely", () => {
    expect(parseFeedEnvelope({ status: "false", description: "no match" })).toBeNull();
  });

  it("falls back to `artwork` when `image` is absent", () => {
    const feed = parseFeedEnvelope({
      feed: { id: 5, title: "T", url: "u", artwork: "https://cdn.example.com/art.jpg" },
    });
    expect(feed?.image).toBe("https://cdn.example.com/art.jpg");
  });
});

describe("parseEpisodeEnvelope", () => {
  it("maps Unix seconds to a Date and surfaces enclosure metadata", () => {
    const rows = parseEpisodeEnvelope({
      items: [
        {
          id: 10,
          title: "Hire four",
          guid: "ff-001",
          datePublished: 1_700_000_000,
          enclosureUrl: "https://cdn.example.com/ep001.mp3",
          enclosureType: "audio/mpeg",
          enclosureLength: 123456,
          duration: 1820,
        },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.datePublished).toEqual(new Date(1_700_000_000 * 1000));
    expect(rows[0]?.enclosureType).toBe("audio/mpeg");
    expect(rows[0]?.duration).toBe(1820);
  });

  it("drops rows missing id, guid, or enclosureUrl — they're not import-ready", () => {
    const rows = parseEpisodeEnvelope({
      items: [
        // Missing enclosure — Podcast Index sometimes lists chapter-only feeds.
        { id: 1, guid: "ok", enclosureUrl: "" },
        // Missing guid — can't dedupe on import.
        { id: 2, guid: "", enclosureUrl: "https://x" },
        // Valid.
        {
          id: 3,
          guid: "g3",
          enclosureUrl: "https://cdn.example.com/ep3.mp3",
          datePublished: 1_700_000_500,
        },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(3);
  });

  it("hoists Podcasting-2.0 transcripts as typed entries", () => {
    const rows = parseEpisodeEnvelope({
      items: [
        {
          id: 1,
          guid: "g",
          enclosureUrl: "https://x",
          datePublished: 1_700_000_000,
          transcripts: [
            { url: "https://t/v.vtt", type: "text/vtt" },
            { url: "https://t/s.srt", type: "application/srt" },
          ],
        },
      ],
    });
    expect(rows[0]?.transcripts).toEqual([
      { url: "https://t/v.vtt", type: "text/vtt" },
      { url: "https://t/s.srt", type: "application/srt" },
    ]);
  });

  it("surfaces episode-specific image only when it differs from the feed cover", () => {
    const rows = parseEpisodeEnvelope({
      items: [
        // Distinct per-episode image — carry it through.
        {
          id: 1,
          guid: "g1",
          enclosureUrl: "https://x/1",
          datePublished: 1_700_000_000,
          image: "https://cdn.example.com/ep1.jpg",
          feedImage: "https://cdn.example.com/cover.jpg",
        },
        // PI echoed the feed cover as the episode image — drop it so callers
        // can distinguish "no per-episode art" from a duplicate.
        {
          id: 2,
          guid: "g2",
          enclosureUrl: "https://x/2",
          datePublished: 1_700_000_100,
          image: "https://cdn.example.com/cover.jpg",
          feedImage: "https://cdn.example.com/cover.jpg",
        },
      ],
    });
    expect(rows[0]?.image).toBe("https://cdn.example.com/ep1.jpg");
    expect(rows[1]?.image).toBeUndefined();
  });

  it("falls back to legacy `transcriptUrl` as a single text/plain entry", () => {
    const rows = parseEpisodeEnvelope({
      items: [
        {
          id: 1,
          guid: "g",
          enclosureUrl: "https://x",
          datePublished: 1_700_000_000,
          transcriptUrl: "https://legacy.example.com/transcript.txt",
        },
      ],
    });
    expect(rows[0]?.transcripts).toEqual([
      { url: "https://legacy.example.com/transcript.txt", type: "text/plain" },
    ]);
  });

  it("defaults missing datePublished to a recent timestamp (so list sort doesn't break)", () => {
    const before = Date.now();
    const rows = parseEpisodeEnvelope({
      items: [{ id: 1, guid: "g", enclosureUrl: "https://x" }],
    });
    const after = Date.now();
    expect(rows[0]?.datePublished.getTime()).toBeGreaterThanOrEqual(before);
    expect(rows[0]?.datePublished.getTime()).toBeLessThanOrEqual(after);
  });
});

describe("podcastIndexFetch — 400 as not-found", () => {
  // Podcast Index signals "we don't know this feed" with 400 + a JSON body of
  // `{"status":"false","description":"Feed url not found."}` instead of 404.
  // The client must collapse that to a normal empty envelope so callers see
  // `null` instead of a thrown PodcastIndexError.
  const ORIGINAL_KEY = process.env.PODCAST_INDEX_KEY;
  const ORIGINAL_SECRET = process.env.PODCAST_INDEX_SECRET;

  beforeEach(() => {
    process.env.PODCAST_INDEX_KEY = "test-key";
    process.env.PODCAST_INDEX_SECRET = "test-secret";
  });

  afterEach(() => {
    process.env.PODCAST_INDEX_KEY = ORIGINAL_KEY;
    process.env.PODCAST_INDEX_SECRET = ORIGINAL_SECRET;
    vi.unstubAllGlobals();
  });

  function stubFetch(response: Response): void {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response),
    );
  }

  it("returns null from lookupFeedByUrl on 400 + status:'false' (feed not indexed)", async () => {
    stubFetch(
      new Response(JSON.stringify({ status: "false", description: "Feed url not found." }), {
        status: 400,
        statusText: "Bad Request",
        headers: { "content-type": "application/json" },
      }),
    );
    await expect(lookupFeedByUrl("https://feeds.example.com/unknown.xml")).resolves.toBeNull();
  });

  it("returns null from lookupEpisodeByGuid on 400 + status:'false'", async () => {
    stubFetch(
      new Response(JSON.stringify({ status: "false", description: "No items." }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
    );
    await expect(
      lookupEpisodeByGuid("unknown-guid", "https://feeds.example.com/x.xml"),
    ).resolves.toBeNull();
  });

  it("still throws PodcastIndexError on non-JSON 400 bodies", async () => {
    stubFetch(new Response("upstream is on fire", { status: 400 }));
    await expect(lookupFeedByUrl("https://feeds.example.com/x.xml")).rejects.toBeInstanceOf(
      PodcastIndexError,
    );
  });

  it("still throws on 500-class responses (real server errors, not not-found)", async () => {
    stubFetch(new Response("internal error", { status: 502, statusText: "Bad Gateway" }));
    await expect(lookupFeedByUrl("https://feeds.example.com/x.xml")).rejects.toBeInstanceOf(
      PodcastIndexError,
    );
  });
});

describe("pickTranscriptUrl", () => {
  it("prefers VTT over SRT over plain text", () => {
    const result = pickTranscriptUrl([
      { url: "https://x/a.txt", type: "text/plain" },
      { url: "https://x/a.srt", type: "application/srt" },
      { url: "https://x/a.vtt", type: "text/vtt" },
    ]);
    expect(result?.url).toBe("https://x/a.vtt");
  });

  it("falls through to plain text when VTT/SRT aren't on offer", () => {
    const result = pickTranscriptUrl([{ url: "https://x/a.txt", type: "text/plain" }]);
    expect(result?.url).toBe("https://x/a.txt");
  });

  it("returns null on an empty list", () => {
    expect(pickTranscriptUrl([])).toBeNull();
  });

  it("matches case-insensitively (publisher headers vary)", () => {
    const result = pickTranscriptUrl([{ url: "https://x/a.vtt", type: "TEXT/VTT" }]);
    expect(result?.url).toBe("https://x/a.vtt");
  });
});

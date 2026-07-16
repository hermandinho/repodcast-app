import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchAndParseRssFeed,
  parseRssFeedXml,
  resolveFeed,
  RssFeedError,
} from "@/server/imports/rss-feed";

// ============================================================
// Fixture — a minimal but realistic RSS 2.0 podcast feed
// ============================================================

const FEED_URL = "https://feeds.example.com/show.xml";

const FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"
     xmlns:podcast="https://podcastindex.org/namespace/1.0"
     xmlns:atom="http://www.w3.org/2005/Atom"
     xmlns:content="http://purl.org/rss/1.0/modules/content/"
     xmlns:media="http://search.yahoo.com/mrss/"
     version="2.0">
  <channel>
    <title><![CDATA[The Founder's Cut]]></title>
    <description><![CDATA[Basic conversations with founders.]]></description>
    <link>https://example.com/show</link>
    <atom:link href="https://feeds.example.com/canonical.xml" rel="self" type="application/rss+xml"/>
    <atom:link href="https://example.com/hub" rel="hub"/>
    <itunes:author>Maya Chen</itunes:author>
    <itunes:image href="https://cdn.example.com/cover.jpg"/>
    <item>
      <title>Episode Two — MM:SS duration</title>
      <guid isPermaLink="false">substack:post:200</guid>
      <pubDate>Fri, 10 Jul 2026 13:07:39 GMT</pubDate>
      <enclosure url="https://cdn.example.com/ep2.mp3" length="12345678" type="audio/mpeg"/>
      <itunes:duration>25:30</itunes:duration>
      <itunes:image href="https://cdn.example.com/ep2-cover.jpg"/>
      <description><![CDATA[<p>Second episode.</p>]]></description>
      <podcast:transcript url="https://t.example.com/ep2.vtt" type="text/vtt"/>
      <podcast:transcript url="https://t.example.com/ep2.srt" type="application/srt"/>
    </item>
    <item>
      <title><![CDATA[Episode One — seconds duration & no attrs on guid]]></title>
      <guid>episode-one-plain</guid>
      <pubDate>Mon, 06 Jul 2026 09:00:00 GMT</pubDate>
      <enclosure url="https://cdn.example.com/ep1.mp3" length="9876543" type="audio/mpeg"/>
      <itunes:duration>1502</itunes:duration>
    </item>
    <item>
      <title>Episode Three — HH:MM:SS duration</title>
      <guid>episode-three</guid>
      <pubDate>Wed, 01 Jul 2026 00:00:00 GMT</pubDate>
      <enclosure url="https://cdn.example.com/ep3.mp3" length="0" type="audio/mpeg"/>
      <itunes:duration>1:02:03</itunes:duration>
      <media:thumbnail url="https://cdn.example.com/ep3-thumb.jpg"/>
    </item>
    <item>
      <title>Chapter-only, no enclosure — must be dropped</title>
      <guid>ep-no-enclosure</guid>
    </item>
  </channel>
</rss>`;

// ============================================================
// parseRssFeedXml — pure parser
// ============================================================

describe("parseRssFeedXml — channel-level fields", () => {
  it("extracts title, description, author, and image with CDATA + itunes namespace", () => {
    const { feed } = parseRssFeedXml(FIXTURE, FEED_URL);
    expect(feed.title).toBe("The Founder's Cut");
    expect(feed.description).toBe("Basic conversations with founders.");
    expect(feed.author).toBe("Maya Chen");
    expect(feed.image).toBe("https://cdn.example.com/cover.jpg");
  });

  it("prefers atom:link rel=self over the URL we fetched from", () => {
    const { feed } = parseRssFeedXml(FIXTURE, FEED_URL);
    expect(feed.url).toBe("https://feeds.example.com/canonical.xml");
    expect(feed.originalUrl).toBe(FEED_URL);
  });

  it("falls back to sourceUrl when there is no atom:link rel=self", () => {
    // Strip the rel=self line (character class had to allow / for the URL).
    const xml = FIXTURE.replace(/<atom:link[^>]*rel="self"[^>]*\/>/, "");
    const { feed } = parseRssFeedXml(xml, FEED_URL);
    expect(feed.url).toBe(FEED_URL);
  });

  it("uses episode count as episodeCount (drops rows missing enclosure)", () => {
    const { feed } = parseRssFeedXml(FIXTURE, FEED_URL);
    // 3 valid + 1 dropped (missing enclosure)
    expect(feed.episodeCount).toBe(3);
  });

  it("marks source as direct-rss", () => {
    const { source } = parseRssFeedXml(FIXTURE, FEED_URL);
    expect(source).toBe("direct-rss");
  });
});

describe("parseRssFeedXml — episode mapping", () => {
  it("extracts guid from both attributed and plain <guid> shapes", () => {
    const { episodes } = parseRssFeedXml(FIXTURE, FEED_URL);
    const guids = episodes.map((e) => e.guid);
    expect(guids).toContain("substack:post:200");
    expect(guids).toContain("episode-one-plain");
  });

  it("parses itunes:duration in seconds, MM:SS, and HH:MM:SS", () => {
    const { episodes } = parseRssFeedXml(FIXTURE, FEED_URL);
    const byGuid = Object.fromEntries(episodes.map((e) => [e.guid, e.duration]));
    expect(byGuid["episode-one-plain"]).toBe(1502);
    expect(byGuid["substack:post:200"]).toBe(25 * 60 + 30);
    expect(byGuid["episode-three"]).toBe(1 * 3600 + 2 * 60 + 3);
  });

  it("extracts enclosure url/type/length; length of 0 becomes undefined", () => {
    const { episodes } = parseRssFeedXml(FIXTURE, FEED_URL);
    const ep2 = episodes.find((e) => e.guid === "substack:post:200")!;
    expect(ep2.enclosureUrl).toBe("https://cdn.example.com/ep2.mp3");
    expect(ep2.enclosureType).toBe("audio/mpeg");
    expect(ep2.enclosureLength).toBe(12345678);
    const ep3 = episodes.find((e) => e.guid === "episode-three")!;
    expect(ep3.enclosureLength).toBeUndefined();
  });

  it("parses pubDate as a Date", () => {
    const { episodes } = parseRssFeedXml(FIXTURE, FEED_URL);
    const ep2 = episodes.find((e) => e.guid === "substack:post:200")!;
    expect(ep2.datePublished.toISOString()).toBe("2026-07-10T13:07:39.000Z");
  });

  it("collects podcast:transcript entries (single and multiple)", () => {
    const { episodes } = parseRssFeedXml(FIXTURE, FEED_URL);
    const ep2 = episodes.find((e) => e.guid === "substack:post:200")!;
    expect(ep2.transcripts).toEqual([
      { url: "https://t.example.com/ep2.vtt", type: "text/vtt" },
      { url: "https://t.example.com/ep2.srt", type: "application/srt" },
    ]);
    const ep1 = episodes.find((e) => e.guid === "episode-one-plain")!;
    expect(ep1.transcripts).toEqual([]);
  });

  it("drops rows missing guid or enclosure — they can't be imported", () => {
    const { episodes } = parseRssFeedXml(FIXTURE, FEED_URL);
    expect(episodes.some((e) => e.guid === "ep-no-enclosure")).toBe(false);
  });

  it("extracts per-item <itunes:image> and <media:thumbnail>", () => {
    const { episodes } = parseRssFeedXml(FIXTURE, FEED_URL);
    const byGuid = Object.fromEntries(episodes.map((e) => [e.guid, e.image]));
    expect(byGuid["substack:post:200"]).toBe("https://cdn.example.com/ep2-cover.jpg");
    expect(byGuid["episode-three"]).toBe("https://cdn.example.com/ep3-thumb.jpg");
    // Item without either tag stays undefined — the caller falls back to the
    // channel image on its own.
    expect(byGuid["episode-one-plain"]).toBeUndefined();
  });

  it("defaults pubDate to now when missing (matches PI parser behaviour)", () => {
    const xml = `<?xml version="1.0"?>
<rss version="2.0"><channel><title>t</title>
<item><title>x</title><guid>g</guid>
<enclosure url="https://x/y.mp3" type="audio/mpeg"/></item>
</channel></rss>`;
    const before = Date.now();
    const { episodes } = parseRssFeedXml(xml, "https://x/feed");
    const after = Date.now();
    expect(episodes[0]!.datePublished.getTime()).toBeGreaterThanOrEqual(before);
    expect(episodes[0]!.datePublished.getTime()).toBeLessThanOrEqual(after);
  });
});

describe("parseRssFeedXml — error paths", () => {
  it("throws RssFeedError on documents without <rss><channel>", () => {
    expect(() => parseRssFeedXml("<html><body>oops</body></html>", FEED_URL)).toThrow(RssFeedError);
  });

  it("returns empty episodes[] for a channel with zero items", () => {
    const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>Empty</title></channel></rss>`;
    const { episodes, feed } = parseRssFeedXml(xml, FEED_URL);
    expect(episodes).toEqual([]);
    expect(feed.episodeCount).toBe(0);
    expect(feed.title).toBe("Empty");
  });
});

// ============================================================
// fetchAndParseRssFeed + resolveFeed — network layer
// ============================================================

function xmlResponse(xml: string, init?: ResponseInit): Response {
  return new Response(xml, {
    status: 200,
    headers: { "content-type": "application/rss+xml" },
    ...init,
  });
}

function stubFetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      return handler(url, init);
    }),
  );
}

describe("fetchAndParseRssFeed", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("fetches the URL and parses the response body", async () => {
    stubFetch(() => xmlResponse(FIXTURE));
    const resolved = await fetchAndParseRssFeed(FEED_URL);
    expect(resolved.source).toBe("direct-rss");
    expect(resolved.feed.title).toBe("The Founder's Cut");
    expect(resolved.episodes).toHaveLength(3);
  });

  it("throws RssFeedError on 4xx origin responses", async () => {
    stubFetch(() => new Response("nope", { status: 404, statusText: "Not Found" }));
    await expect(fetchAndParseRssFeed(FEED_URL)).rejects.toBeInstanceOf(RssFeedError);
  });

  it("throws RssFeedError on 5xx origin responses", async () => {
    stubFetch(() => new Response("boom", { status: 503, statusText: "Service Unavailable" }));
    await expect(fetchAndParseRssFeed(FEED_URL)).rejects.toBeInstanceOf(RssFeedError);
  });

  it("throws RssFeedError when the response is not XML", async () => {
    stubFetch(() => new Response("not xml at all", { status: 200 }));
    await expect(fetchAndParseRssFeed(FEED_URL)).rejects.toBeInstanceOf(RssFeedError);
  });
});

describe("resolveFeed — Podcast Index preferred, direct parse as fallback", () => {
  // Match the PI auth endpoint prefix to route stubbed fetch calls.
  const PI_HOST = "api.podcastindex.org";

  const ORIGINAL_KEY = process.env.PODCAST_INDEX_KEY;
  const ORIGINAL_SECRET = process.env.PODCAST_INDEX_SECRET;

  afterEach(() => {
    process.env.PODCAST_INDEX_KEY = ORIGINAL_KEY;
    process.env.PODCAST_INDEX_SECRET = ORIGINAL_SECRET;
    vi.unstubAllGlobals();
  });

  function configurePi(configured: boolean): void {
    if (configured) {
      process.env.PODCAST_INDEX_KEY = "test-key";
      process.env.PODCAST_INDEX_SECRET = "test-secret";
    } else {
      delete process.env.PODCAST_INDEX_KEY;
      delete process.env.PODCAST_INDEX_SECRET;
    }
  }

  it("uses Podcast Index when it knows the feed", async () => {
    configurePi(true);
    stubFetch((url) => {
      if (url.includes(PI_HOST) && url.includes("byfeedurl")) {
        return new Response(
          JSON.stringify({ status: "true", feed: { id: 42, title: "PI Title", url: FEED_URL } }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes(PI_HOST) && url.includes("byfeedid")) {
        return new Response(
          JSON.stringify({
            status: "true",
            items: [
              {
                id: 999,
                guid: "pi-guid",
                enclosureUrl: "https://cdn/x.mp3",
                datePublished: 1_700_000_000,
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    const resolved = await resolveFeed(FEED_URL, 25);
    expect(resolved?.source).toBe("podcast-index");
    expect(resolved?.feed.title).toBe("PI Title");
    expect(resolved?.episodes[0]?.guid).toBe("pi-guid");
  });

  it("falls back to direct RSS parse when Podcast Index returns 400 not-found", async () => {
    configurePi(true);
    stubFetch((url) => {
      if (url.includes(PI_HOST) && url.includes("byfeedurl")) {
        // PI's "unknown feed" shape — the fix from earlier collapses this
        // to a null feed, which resolveFeed then handles by falling through.
        return new Response(
          JSON.stringify({ status: "false", description: "Feed url not found." }),
          { status: 400, headers: { "content-type": "application/json" } },
        );
      }
      // Any non-PI URL — treat as the RSS origin.
      return xmlResponse(FIXTURE);
    });
    const resolved = await resolveFeed(FEED_URL, 25);
    expect(resolved?.source).toBe("direct-rss");
    expect(resolved?.feed.title).toBe("The Founder's Cut");
    expect(resolved?.episodes).toHaveLength(3);
  });

  it("skips Podcast Index entirely when credentials aren't configured", async () => {
    configurePi(false);
    const calls: string[] = [];
    stubFetch((url) => {
      calls.push(url);
      return xmlResponse(FIXTURE);
    });
    const resolved = await resolveFeed(FEED_URL, 25);
    expect(resolved?.source).toBe("direct-rss");
    // Zero PI calls — we went straight to the feed origin.
    expect(calls.some((u) => u.includes(PI_HOST))).toBe(false);
    expect(calls[0]).toBe(FEED_URL);
  });

  it("applies maxEpisodes as an upper bound on the direct-parse result", async () => {
    configurePi(false);
    stubFetch(() => xmlResponse(FIXTURE));
    const resolved = await resolveFeed(FEED_URL, 2);
    expect(resolved?.episodes).toHaveLength(2);
  });

  it("throws — does not fall through — on PI 5xx (genuine PI outage)", async () => {
    configurePi(true);
    stubFetch((url) => {
      if (url.includes(PI_HOST)) {
        return new Response("upstream error", { status: 502, statusText: "Bad Gateway" });
      }
      return xmlResponse(FIXTURE);
    });
    await expect(resolveFeed(FEED_URL, 25)).rejects.toThrow();
  });

  it("surfaces the direct-parse error when both paths fail", async () => {
    configurePi(true);
    stubFetch((url) => {
      if (url.includes(PI_HOST) && url.includes("byfeedurl")) {
        return new Response(
          JSON.stringify({ status: "false", description: "Feed url not found." }),
          { status: 400, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("gone", { status: 410, statusText: "Gone" });
    });
    await expect(resolveFeed(FEED_URL, 25)).rejects.toBeInstanceOf(RssFeedError);
  });
});

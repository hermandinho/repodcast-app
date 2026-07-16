/**
 * Activation-flow smoke test: `createEpisodeAction` is the server-side seam
 * `/episodes/new` commits through. End-to-end it has to:
 *   1. Validate input via Zod (transcript ≥ 500 chars, ≥ 1 platform).
 *   2. Short-circuit in sample-data mode without touching DB or Inngest.
 *   3. In live mode, resolve auth → tenant, write an Episode, dispatch the
 *      `episode/generate.requested` Inngest event with the correct payload,
 *      and return the new episode id.
 *
 * Anthropic / Inngest dev server aren't reached here — those are exercised
 * downstream of `inngest.send`. This test verifies the wiring up to (and
 * including) the dispatch.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemberRole, Plan, TranscriptSource, Platform, type Episode } from "@prisma/client";
import { ValidationError } from "@/server/auth/errors";
import type { TenantContext } from "@/server/auth/tenant";

const mocks = vi.hoisted(() => ({
  isLiveDb: vi.fn(),
  requireAuthContext: vi.fn(),
  createEpisode: vi.fn(),
  inngestSend: vi.fn(),
}));

vi.mock("@/server/data/source", () => ({
  isLiveDb: mocks.isLiveDb,
}));
vi.mock("@/server/auth/context", () => ({
  requireAuthContext: mocks.requireAuthContext,
  // No-op — `createEpisodeAction` calls this to reject cancelled-sub
  // agencies. Every test here uses a live-plan agency, so gating it
  // through a stub keeps the mock aligned with the source without
  // needing to thread a `stripeSubscriptionId` fixture through every
  // `requireAuthContext.mockResolvedValue(...)`.
  assertActiveSubscription: vi.fn(),
}));
vi.mock("@/server/db/episodes", () => ({
  createEpisode: mocks.createEpisode,
}));
vi.mock("@/inngest/client", () => ({
  inngest: { send: mocks.inngestSend },
}));
// `toTenantContext` is pure but pulls in the wider auth module; stub it to
// avoid loading anything we haven't mocked.
vi.mock("@/server/auth/tenant", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    toTenantContext: (ctx: {
      agency: { id: string };
      member: { role: MemberRole };
    }): TenantContext => ({
      agencyId: ctx.agency.id,
      role: ctx.member.role,
    }),
  };
});

import { createEpisodeAction } from "@/app/(dashboard)/episodes/new/actions";

const LONG_TRANSCRIPT = "x".repeat(600);
const AGENCY_ID = "agency_smoke";
const SHOW_ID = "show_smoke";
const EPISODE_ID = "ep_smoke";

const validInput = {
  showId: SHOW_ID,
  title: "Smoke episode",
  transcript: LONG_TRANSCRIPT,
  source: TranscriptSource.PASTE,
  platforms: [Platform.TWITTER, Platform.LINKEDIN],
};

beforeEach(() => {
  mocks.isLiveDb.mockReset();
  mocks.requireAuthContext.mockReset();
  mocks.createEpisode.mockReset();
  mocks.inngestSend.mockReset();

  // Sensible defaults for the live-mode path; overridden per test as needed.
  mocks.requireAuthContext.mockResolvedValue({
    user: { clerkUserId: "user_1", email: "a@b.com", name: "A", imageUrl: null },
    agency: { id: AGENCY_ID, name: "Smoke", plan: Plan.STUDIO },
    member: { id: "member_1", role: MemberRole.OWNER },
  });
  mocks.createEpisode.mockResolvedValue({ id: EPISODE_ID } as Episode);
  mocks.inngestSend.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createEpisodeAction — sample-data mode", () => {
  it("short-circuits with the showId as the synthetic episode id, no DB or Inngest calls", async () => {
    mocks.isLiveDb.mockReturnValue(false);

    const result = await createEpisodeAction(validInput);

    expect(result).toEqual({ ok: true, episodeId: SHOW_ID });
    expect(mocks.requireAuthContext).not.toHaveBeenCalled();
    expect(mocks.createEpisode).not.toHaveBeenCalled();
    expect(mocks.inngestSend).not.toHaveBeenCalled();
  });
});

describe("createEpisodeAction — input validation", () => {
  it("rejects a transcript under 500 chars", async () => {
    mocks.isLiveDb.mockReturnValue(true);
    await expect(
      createEpisodeAction({ ...validInput, transcript: "too short" }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(mocks.createEpisode).not.toHaveBeenCalled();
    expect(mocks.inngestSend).not.toHaveBeenCalled();
  });

  it("rejects an empty platforms array", async () => {
    mocks.isLiveDb.mockReturnValue(true);
    await expect(createEpisodeAction({ ...validInput, platforms: [] })).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(mocks.createEpisode).not.toHaveBeenCalled();
    expect(mocks.inngestSend).not.toHaveBeenCalled();
  });

  it("rejects when showId is missing", async () => {
    mocks.isLiveDb.mockReturnValue(true);
    await expect(createEpisodeAction({ ...validInput, showId: "" })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});

describe("createEpisodeAction — live mode end-to-end", () => {
  it("creates the Episode and dispatches the Inngest event with the right payload", async () => {
    mocks.isLiveDb.mockReturnValue(true);

    const result = await createEpisodeAction(validInput);

    expect(result).toEqual({ ok: true, episodeId: EPISODE_ID });

    expect(mocks.requireAuthContext).toHaveBeenCalledOnce();

    // Repo write goes through the tenant-scoped helper with the agency id
    // resolved from the auth context.
    expect(mocks.createEpisode).toHaveBeenCalledOnce();
    const [tenant, payload] = mocks.createEpisode.mock.calls[0]!;
    expect(tenant).toEqual({ agencyId: AGENCY_ID, role: MemberRole.OWNER });
    expect(payload).toEqual({
      showId: SHOW_ID,
      title: "Smoke episode",
      transcript: LONG_TRANSCRIPT,
      source: TranscriptSource.PASTE,
      // UPLOAD source threads an R2 object key through; PASTE
      // input doesn't carry one, so the action defaults it to null.
      audioUrl: null,
      // RSS pins the publisher GUID here; non-RSS paths null it.
      externalUrl: null,
      // Publisher artwork only lands on RSS imports; other sources null it.
      sourceImageUrl: null,
    });

    // Generation request goes out with the platforms the user selected,
    // plus the QoS tags (plan + agencyId) so the priority-queue
    // expression on `generate-episode` can bump NETWORK-tier dispatches.
    expect(mocks.inngestSend).toHaveBeenCalledOnce();
    expect(mocks.inngestSend).toHaveBeenCalledWith({
      name: "episode/generate.requested",
      data: {
        episodeId: EPISODE_ID,
        platforms: [Platform.TWITTER, Platform.LINKEDIN],
        plan: Plan.STUDIO,
        agencyId: AGENCY_ID,
      },
    });
  });

  it("defaults the episode title to 'Untitled episode' when omitted", async () => {
    mocks.isLiveDb.mockReturnValue(true);
    const { title: _drop, ...inputWithoutTitle } = validInput;
    void _drop;

    await createEpisodeAction(inputWithoutTitle);

    const [, payload] = mocks.createEpisode.mock.calls[0]!;
    expect(payload.title).toBe("Untitled episode");
  });

  it("defaults source to PASTE when omitted", async () => {
    mocks.isLiveDb.mockReturnValue(true);
    const { source: _drop, ...inputWithoutSource } = validInput;
    void _drop;

    await createEpisodeAction(inputWithoutSource);

    const [, payload] = mocks.createEpisode.mock.calls[0]!;
    expect(payload.source).toBe(TranscriptSource.PASTE);
  });

  it("does not dispatch when the repo write throws", async () => {
    mocks.isLiveDb.mockReturnValue(true);
    mocks.createEpisode.mockRejectedValueOnce(new Error("DB down"));

    await expect(createEpisodeAction(validInput)).rejects.toThrow("DB down");
    expect(mocks.inngestSend).not.toHaveBeenCalled();
  });

  // ----------------------------------------------------------------
  // UPLOAD source path. The action threads the R2 object key
  // onto the Episode + dispatches transcribe (not generate) so the
  // transcribe pipeline can fill the transcript and chain into generate.
  // ----------------------------------------------------------------
  it("routes UPLOAD source through transcribe-requested with the audio key + pre-minted id", async () => {
    mocks.isLiveDb.mockReturnValue(true);
    const preMintedId = "audio-episode-uuid-1234";

    const result = await createEpisodeAction({
      showId: SHOW_ID,
      title: "Audio episode",
      source: TranscriptSource.UPLOAD,
      transcript: "",
      audioObjectKey: `audio/agency_smoke/${SHOW_ID}/${preMintedId}.mp3`,
      episodeId: preMintedId,
      platforms: [Platform.TWITTER, Platform.LINKEDIN],
    });

    expect(result).toEqual({ ok: true, episodeId: EPISODE_ID });

    const [, payload] = mocks.createEpisode.mock.calls[0]!;
    expect(payload).toEqual({
      // Pre-minted id is threaded into the repo so Episode.id matches
      // the id embedded in the R2 object key.
      id: preMintedId,
      showId: SHOW_ID,
      title: "Audio episode",
      transcript: "",
      source: TranscriptSource.UPLOAD,
      audioUrl: `audio/agency_smoke/${SHOW_ID}/${preMintedId}.mp3`,
      externalUrl: null,
      sourceImageUrl: null,
    });

    expect(mocks.inngestSend).toHaveBeenCalledOnce();
    expect(mocks.inngestSend).toHaveBeenCalledWith({
      name: "episode/transcribe.requested",
      data: {
        episodeId: EPISODE_ID,
        platforms: [Platform.TWITTER, Platform.LINKEDIN],
        plan: Plan.STUDIO,
        agencyId: AGENCY_ID,
      },
    });
  });

  it("rejects UPLOAD source without an audioObjectKey", async () => {
    mocks.isLiveDb.mockReturnValue(true);

    await expect(
      createEpisodeAction({
        showId: SHOW_ID,
        title: "Audio episode",
        source: TranscriptSource.UPLOAD,
        transcript: "",
        episodeId: "irrelevant",
        platforms: [Platform.TWITTER],
      }),
    ).rejects.toThrow(ValidationError);

    expect(mocks.createEpisode).not.toHaveBeenCalled();
    expect(mocks.inngestSend).not.toHaveBeenCalled();
  });

  it("rejects UPLOAD source without a pre-minted episodeId", async () => {
    mocks.isLiveDb.mockReturnValue(true);

    await expect(
      createEpisodeAction({
        showId: SHOW_ID,
        title: "Audio episode",
        source: TranscriptSource.UPLOAD,
        transcript: "",
        audioObjectKey: `audio/agency_smoke/${SHOW_ID}/missing-id.mp3`,
        platforms: [Platform.TWITTER],
      }),
    ).rejects.toThrow(ValidationError);

    expect(mocks.createEpisode).not.toHaveBeenCalled();
    expect(mocks.inngestSend).not.toHaveBeenCalled();
  });

  // ----------------------------------------------------------------
  // RSS source path. The action threads the publisher GUID
  // onto Episode.externalUrl, pins the feed URL on the event payload so
  // a later show.rssUrl edit doesn't shift the lookup, and dispatches
  // `episode/rss.import.requested` instead of generate.
  // ----------------------------------------------------------------
  it("routes RSS source through rss-import-requested with the guid + canonical feed URL", async () => {
    mocks.isLiveDb.mockReturnValue(true);

    const result = await createEpisodeAction({
      showId: SHOW_ID,
      title: "RSS episode",
      source: TranscriptSource.RSS,
      transcript: "",
      rssGuid: "ff-001-hire-four",
      rssFeedUrl: "https://feeds.example.com/ff.xml",
      rssTitle: "Why Your First 10 Hires Define Everything",
      platforms: [Platform.TWITTER, Platform.LINKEDIN],
    });

    expect(result).toEqual({ ok: true, episodeId: EPISODE_ID });

    const [, payload] = mocks.createEpisode.mock.calls[0]!;
    expect(payload).toEqual({
      showId: SHOW_ID,
      title: "RSS episode",
      transcript: "",
      source: TranscriptSource.RSS,
      audioUrl: null,
      // Publisher GUID — stable lookup key for the import pipeline + de-dupe basis.
      externalUrl: "ff-001-hire-four",
      // Publisher artwork not provided in this input — nulled.
      sourceImageUrl: null,
    });

    expect(mocks.inngestSend).toHaveBeenCalledOnce();
    expect(mocks.inngestSend).toHaveBeenCalledWith({
      name: "episode/rss.import.requested",
      data: {
        episodeId: EPISODE_ID,
        guid: "ff-001-hire-four",
        feedUrl: "https://feeds.example.com/ff.xml",
        platforms: [Platform.TWITTER, Platform.LINKEDIN],
        plan: Plan.STUDIO,
        agencyId: AGENCY_ID,
      },
    });
  });

  it("falls back to the publisher-supplied title when the user leaves the title blank", async () => {
    mocks.isLiveDb.mockReturnValue(true);

    await createEpisodeAction({
      showId: SHOW_ID,
      source: TranscriptSource.RSS,
      transcript: "",
      rssGuid: "g1",
      rssFeedUrl: "https://feeds.example.com/ff.xml",
      rssTitle: "Publisher-supplied title",
      platforms: [Platform.TWITTER],
    });

    const [, payload] = mocks.createEpisode.mock.calls[0]!;
    expect(payload.title).toBe("Publisher-supplied title");
  });

  it("rejects RSS source without a guid", async () => {
    mocks.isLiveDb.mockReturnValue(true);

    await expect(
      createEpisodeAction({
        showId: SHOW_ID,
        source: TranscriptSource.RSS,
        transcript: "",
        rssFeedUrl: "https://feeds.example.com/ff.xml",
        platforms: [Platform.TWITTER],
      }),
    ).rejects.toThrow(ValidationError);

    expect(mocks.createEpisode).not.toHaveBeenCalled();
    expect(mocks.inngestSend).not.toHaveBeenCalled();
  });

  it("rejects RSS source without a feed URL", async () => {
    mocks.isLiveDb.mockReturnValue(true);

    await expect(
      createEpisodeAction({
        showId: SHOW_ID,
        source: TranscriptSource.RSS,
        transcript: "",
        rssGuid: "g1",
        platforms: [Platform.TWITTER],
      }),
    ).rejects.toThrow(ValidationError);

    expect(mocks.createEpisode).not.toHaveBeenCalled();
    expect(mocks.inngestSend).not.toHaveBeenCalled();
  });

  it("rejects RSS source when the feed URL is malformed", async () => {
    mocks.isLiveDb.mockReturnValue(true);

    await expect(
      createEpisodeAction({
        showId: SHOW_ID,
        source: TranscriptSource.RSS,
        transcript: "",
        rssGuid: "g1",
        rssFeedUrl: "not-a-url",
        platforms: [Platform.TWITTER],
      }),
    ).rejects.toThrow(ValidationError);

    expect(mocks.createEpisode).not.toHaveBeenCalled();
    expect(mocks.inngestSend).not.toHaveBeenCalled();
  });
});

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
    });

    // Generation request goes out with the platforms the user selected.
    expect(mocks.inngestSend).toHaveBeenCalledOnce();
    expect(mocks.inngestSend).toHaveBeenCalledWith({
      name: "episode/generate.requested",
      data: { episodeId: EPISODE_ID, platforms: [Platform.TWITTER, Platform.LINKEDIN] },
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
});

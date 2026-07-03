/**
 * Phase 3.3 — server actions behind the calendar + OutputCard scheduling
 * affordances. Live-mode wiring the tests pin:
 *
 *   - `mode: 'auto'` picks BUFFER when a Buffer integration exists AND the
 *     platform is Buffer-supported; else MANUAL.
 *   - `mode: 'buffer'` errors with `no_buffer` when unconnected and
 *     `unsupported_platform` when the platform is SHOW_NOTES/BLOG/NEWSLETTER.
 *   - `mode: 'manual'` never consults Buffer.
 *   - `scheduledFor` in the past → returns `{ ok: false }` with no DB write.
 *   - Buffer's `createPost` fires *before* the DB flip; a `BufferError`
 *     surfaces as `buffer_error` and no `scheduleOutput` write happens.
 *   - Sample-mode short-circuits with no auth / DB / Buffer calls.
 *   - `unscheduleOutputAction` calls Buffer's `deletePost` first, then the
 *     DB downgrade; a Buffer failure is logged but non-fatal.
 *   - `markOutputPublishedAction` threads memberId + optional URL into the
 *     repo helper.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExternalScheduler, MemberRole, Plan, Platform } from "@prisma/client";
import { ValidationError } from "@/server/auth/errors";
import type { TenantContext } from "@/server/auth/tenant";

const mocks = vi.hoisted(() => ({
  isLiveDb: vi.fn(),
  requireAuthContext: vi.fn(),
  getBufferIntegration: vi.fn(),
  isBufferSupportedPlatform: vi.fn(),
  makeBufferAuthRefresher: vi.fn(),
  scheduleOutput: vi.fn(),
  unscheduleOutput: vi.fn(),
  markOutputPublished: vi.fn(),
  bufferCreatePost: vi.fn(),
  bufferDeletePost: vi.fn(),
  prismaFindFirst: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/server/data/source", () => ({ isLiveDb: mocks.isLiveDb }));
vi.mock("@/server/auth/context", () => ({ requireAuthContext: mocks.requireAuthContext }));
vi.mock("@/server/db/client", () => ({
  prisma: {
    generatedOutput: { findFirst: mocks.prismaFindFirst },
  },
}));
vi.mock("@/server/db/integrations", () => ({
  getBufferIntegrationForAgency: mocks.getBufferIntegration,
  isBufferSupportedPlatform: mocks.isBufferSupportedPlatform,
  makeBufferAuthRefresher: mocks.makeBufferAuthRefresher,
}));
vi.mock("@/server/db/outputs", () => ({
  scheduleOutput: mocks.scheduleOutput,
  unscheduleOutput: mocks.unscheduleOutput,
  markOutputPublished: mocks.markOutputPublished,
}));
vi.mock("@/server/integrations/buffer", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual, // keep `BufferError` as the real class so `instanceof` works
    createPost: mocks.bufferCreatePost,
    deletePost: mocks.bufferDeletePost,
  };
});
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
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

import {
  markOutputPublishedAction,
  scheduleOutputAction,
  unscheduleOutputAction,
} from "@/app/(dashboard)/schedule/actions";
import { BufferError } from "@/server/integrations/buffer";

const AGENCY_ID = "agency_smoke";
const MEMBER_ID = "mem_1";
const OUTPUT_ID = "out_1";
const EPISODE_ID = "ep_1";

const FUTURE_ISO = new Date(Date.now() + 60 * 60 * 1000).toISOString();
const PAST_ISO = new Date(Date.now() - 60 * 60 * 1000).toISOString();

// A minimal integration object shaped like ResolvedBufferIntegration.
const bufferConnected = {
  id: "int_1",
  accessToken: "buffer_token_plain",
  autoMarkPublished: true,
  lastSyncedAt: null,
  lastSyncError: null,
  meta: {
    organizationIds: ["org_1"],
    profiles: { [Platform.TWITTER]: "chn_tw", [Platform.LINKEDIN]: "chn_li" } as Record<
      Platform,
      string
    >,
    channelToOrg: { chn_tw: "org_1", chn_li: "org_1" },
  },
};

beforeEach(() => {
  for (const fn of Object.values(mocks)) {
    if (typeof fn === "function" && "mockReset" in fn) {
      (fn as { mockReset: () => void }).mockReset();
    }
  }
  mocks.requireAuthContext.mockResolvedValue({
    user: { clerkUserId: "user_1", email: "a@b.com", name: "A", imageUrl: null },
    agency: { id: AGENCY_ID, name: "Smoke", plan: Plan.STUDIO },
    member: { id: MEMBER_ID, role: MemberRole.OWNER },
  });
  // Real behavior: TWITTER/LINKEDIN/INSTAGRAM/TIKTOK yes, everything else no.
  const supported: readonly Platform[] = [
    Platform.TWITTER,
    Platform.LINKEDIN,
    Platform.INSTAGRAM,
    Platform.TIKTOK,
  ];
  mocks.isBufferSupportedPlatform.mockImplementation((p: Platform) => supported.includes(p));
  mocks.makeBufferAuthRefresher.mockReturnValue({ onUnauthenticated: async () => null });
});

afterEach(() => vi.restoreAllMocks());

// ============================================================
// scheduleOutputAction
// ============================================================

describe("scheduleOutputAction — sample-data mode", () => {
  it("short-circuits: no auth, no DB, no Buffer, echoes the request back", async () => {
    mocks.isLiveDb.mockReturnValue(false);

    const result = await scheduleOutputAction({
      outputId: OUTPUT_ID,
      scheduledForIso: FUTURE_ISO,
      mode: "auto",
    });

    expect(result).toEqual({
      ok: true,
      data: {
        outputId: OUTPUT_ID,
        scheduledFor: new Date(FUTURE_ISO).toISOString(),
        externalScheduler: ExternalScheduler.MANUAL,
        externalPostUrl: null,
      },
    });
    expect(mocks.requireAuthContext).not.toHaveBeenCalled();
    expect(mocks.scheduleOutput).not.toHaveBeenCalled();
    expect(mocks.bufferCreatePost).not.toHaveBeenCalled();
  });
});

describe("scheduleOutputAction — input validation", () => {
  it("rejects a scheduledFor in the past (returns ok:false, no DB write)", async () => {
    mocks.isLiveDb.mockReturnValue(true);
    const result = await scheduleOutputAction({
      outputId: OUTPUT_ID,
      scheduledForIso: PAST_ISO,
      mode: "auto",
    });
    expect(result).toEqual({ ok: false, error: "Scheduled time must be in the future." });
    expect(mocks.scheduleOutput).not.toHaveBeenCalled();
  });

  it("rejects a malformed input via Zod → ValidationError thrown", async () => {
    mocks.isLiveDb.mockReturnValue(true);
    await expect(
      scheduleOutputAction({ outputId: "", scheduledForIso: FUTURE_ISO, mode: "auto" }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      scheduleOutputAction({
        outputId: OUTPUT_ID,
        scheduledForIso: "not-an-iso-date",
        mode: "auto",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      scheduleOutputAction({
        outputId: OUTPUT_ID,
        scheduledForIso: FUTURE_ISO,
        mode: "bogus",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("scheduleOutputAction — auto mode resolution", () => {
  it("picks BUFFER when connected AND platform is Buffer-supported; pushes post first, then flips DB", async () => {
    mocks.isLiveDb.mockReturnValue(true);
    mocks.prismaFindFirst.mockResolvedValue({
      id: OUTPUT_ID,
      content: "hello",
      platform: Platform.TWITTER,
    });
    mocks.getBufferIntegration.mockResolvedValue(bufferConnected);
    mocks.bufferCreatePost.mockResolvedValue({
      id: "buf_post_1",
      publicUrl: "https://publish.buffer.com/posts/buf_post_1",
    });
    mocks.scheduleOutput.mockResolvedValue({
      id: OUTPUT_ID,
      episodeId: EPISODE_ID,
      scheduledFor: new Date(FUTURE_ISO),
    });

    const result = await scheduleOutputAction({
      outputId: OUTPUT_ID,
      scheduledForIso: FUTURE_ISO,
      mode: "auto",
    });

    // Buffer is called before the DB helper.
    const bufferCallOrder = mocks.bufferCreatePost.mock.invocationCallOrder[0]!;
    const scheduleCallOrder = mocks.scheduleOutput.mock.invocationCallOrder[0]!;
    expect(bufferCallOrder).toBeLessThan(scheduleCallOrder);

    expect(mocks.bufferCreatePost).toHaveBeenCalledWith(
      {
        accessToken: bufferConnected.accessToken,
        channelId: "chn_tw",
        text: "hello",
        dueAt: new Date(FUTURE_ISO),
      },
      expect.any(Object), // authRefresher
    );
    expect(mocks.scheduleOutput).toHaveBeenCalledWith(
      { agencyId: AGENCY_ID, role: MemberRole.OWNER },
      OUTPUT_ID,
      MEMBER_ID,
      expect.objectContaining({
        externalScheduler: ExternalScheduler.BUFFER,
        externalPostId: "buf_post_1",
        externalPostUrl: "https://publish.buffer.com/posts/buf_post_1",
      }),
    );
    expect(result).toEqual({
      ok: true,
      data: expect.objectContaining({
        externalScheduler: ExternalScheduler.BUFFER,
        externalPostUrl: "https://publish.buffer.com/posts/buf_post_1",
      }),
    });
  });

  it("picks MANUAL when Buffer is NOT connected — Buffer client never called", async () => {
    mocks.isLiveDb.mockReturnValue(true);
    mocks.prismaFindFirst.mockResolvedValue({
      id: OUTPUT_ID,
      content: "hi",
      platform: Platform.TWITTER,
    });
    mocks.getBufferIntegration.mockResolvedValue(null);
    mocks.scheduleOutput.mockResolvedValue({
      id: OUTPUT_ID,
      episodeId: EPISODE_ID,
      scheduledFor: new Date(FUTURE_ISO),
    });

    await scheduleOutputAction({
      outputId: OUTPUT_ID,
      scheduledForIso: FUTURE_ISO,
      mode: "auto",
    });

    expect(mocks.bufferCreatePost).not.toHaveBeenCalled();
    expect(mocks.scheduleOutput).toHaveBeenCalledWith(
      expect.anything(),
      OUTPUT_ID,
      MEMBER_ID,
      expect.objectContaining({ externalScheduler: ExternalScheduler.MANUAL }),
    );
  });

  it("picks MANUAL when Buffer connected but platform is unsupported (SHOW_NOTES) — no Buffer call", async () => {
    mocks.isLiveDb.mockReturnValue(true);
    mocks.prismaFindFirst.mockResolvedValue({
      id: OUTPUT_ID,
      content: "notes",
      platform: Platform.SHOW_NOTES,
    });
    mocks.getBufferIntegration.mockResolvedValue(bufferConnected);
    mocks.scheduleOutput.mockResolvedValue({
      id: OUTPUT_ID,
      episodeId: EPISODE_ID,
      scheduledFor: new Date(FUTURE_ISO),
    });

    await scheduleOutputAction({
      outputId: OUTPUT_ID,
      scheduledForIso: FUTURE_ISO,
      mode: "auto",
    });

    expect(mocks.bufferCreatePost).not.toHaveBeenCalled();
    expect(mocks.scheduleOutput).toHaveBeenCalledWith(
      expect.anything(),
      OUTPUT_ID,
      MEMBER_ID,
      expect.objectContaining({ externalScheduler: ExternalScheduler.MANUAL }),
    );
  });
});

describe("scheduleOutputAction — force-buffer mode", () => {
  it("returns no_buffer errorCode when Buffer isn't connected", async () => {
    mocks.isLiveDb.mockReturnValue(true);
    mocks.prismaFindFirst.mockResolvedValue({
      id: OUTPUT_ID,
      content: "hi",
      platform: Platform.TWITTER,
    });
    mocks.getBufferIntegration.mockResolvedValue(null);

    const result = await scheduleOutputAction({
      outputId: OUTPUT_ID,
      scheduledForIso: FUTURE_ISO,
      mode: "buffer",
    });
    expect(result).toEqual({
      ok: false,
      error: expect.any(String),
      errorCode: "no_buffer",
    });
    expect(mocks.scheduleOutput).not.toHaveBeenCalled();
    expect(mocks.bufferCreatePost).not.toHaveBeenCalled();
  });

  it("returns unsupported_platform when Buffer is connected but platform is SHOW_NOTES", async () => {
    mocks.isLiveDb.mockReturnValue(true);
    mocks.prismaFindFirst.mockResolvedValue({
      id: OUTPUT_ID,
      content: "notes",
      platform: Platform.SHOW_NOTES,
    });
    mocks.getBufferIntegration.mockResolvedValue(bufferConnected);

    const result = await scheduleOutputAction({
      outputId: OUTPUT_ID,
      scheduledForIso: FUTURE_ISO,
      mode: "buffer",
    });
    expect(result).toEqual({
      ok: false,
      error: expect.stringContaining("SHOW_NOTES"),
      errorCode: "unsupported_platform",
    });
    expect(mocks.scheduleOutput).not.toHaveBeenCalled();
  });

  it("returns no_profile when Buffer connected but no channel for the platform", async () => {
    mocks.isLiveDb.mockReturnValue(true);
    mocks.prismaFindFirst.mockResolvedValue({
      id: OUTPUT_ID,
      content: "hi",
      platform: Platform.INSTAGRAM, // supported by Buffer, but no profile in meta
    });
    mocks.getBufferIntegration.mockResolvedValue(bufferConnected);

    const result = await scheduleOutputAction({
      outputId: OUTPUT_ID,
      scheduledForIso: FUTURE_ISO,
      mode: "buffer",
    });
    expect(result).toEqual({
      ok: false,
      error: expect.stringContaining("INSTAGRAM"),
      errorCode: "no_profile",
    });
    expect(mocks.bufferCreatePost).not.toHaveBeenCalled();
    expect(mocks.scheduleOutput).not.toHaveBeenCalled();
  });

  it("Buffer rejects the post → returns buffer_error, no DB write", async () => {
    mocks.isLiveDb.mockReturnValue(true);
    mocks.prismaFindFirst.mockResolvedValue({
      id: OUTPUT_ID,
      content: "hi",
      platform: Platform.TWITTER,
    });
    mocks.getBufferIntegration.mockResolvedValue(bufferConnected);
    mocks.bufferCreatePost.mockRejectedValue(new BufferError(400, "channel disconnected"));

    const result = await scheduleOutputAction({
      outputId: OUTPUT_ID,
      scheduledForIso: FUTURE_ISO,
      mode: "buffer",
    });
    expect(result).toEqual({
      ok: false,
      error: expect.stringContaining("Buffer rejected the post"),
      errorCode: "buffer_error",
    });
    expect(mocks.scheduleOutput).not.toHaveBeenCalled();
  });

  it("non-Buffer errors bubble up (network failure, etc.) — not swallowed as buffer_error", async () => {
    mocks.isLiveDb.mockReturnValue(true);
    mocks.prismaFindFirst.mockResolvedValue({
      id: OUTPUT_ID,
      content: "hi",
      platform: Platform.TWITTER,
    });
    mocks.getBufferIntegration.mockResolvedValue(bufferConnected);
    mocks.bufferCreatePost.mockRejectedValue(new Error("EAI_AGAIN dns fail"));

    await expect(
      scheduleOutputAction({
        outputId: OUTPUT_ID,
        scheduledForIso: FUTURE_ISO,
        mode: "buffer",
      }),
    ).rejects.toThrow("EAI_AGAIN");
    expect(mocks.scheduleOutput).not.toHaveBeenCalled();
  });
});

describe("scheduleOutputAction — manual mode (force MANUAL regardless of Buffer state)", () => {
  it("never calls getBufferIntegrationForAgency + never posts to Buffer", async () => {
    mocks.isLiveDb.mockReturnValue(true);
    mocks.prismaFindFirst.mockResolvedValue({
      id: OUTPUT_ID,
      content: "hi",
      platform: Platform.TWITTER, // Buffer-supported, but mode=manual overrides
    });
    mocks.scheduleOutput.mockResolvedValue({
      id: OUTPUT_ID,
      episodeId: EPISODE_ID,
      scheduledFor: new Date(FUTURE_ISO),
    });

    await scheduleOutputAction({
      outputId: OUTPUT_ID,
      scheduledForIso: FUTURE_ISO,
      mode: "manual",
    });

    expect(mocks.getBufferIntegration).not.toHaveBeenCalled();
    expect(mocks.bufferCreatePost).not.toHaveBeenCalled();
    expect(mocks.scheduleOutput).toHaveBeenCalledWith(
      expect.anything(),
      OUTPUT_ID,
      MEMBER_ID,
      expect.objectContaining({
        externalScheduler: ExternalScheduler.MANUAL,
        externalPostId: undefined,
        externalPostUrl: undefined,
      }),
    );
  });
});

describe("scheduleOutputAction — cross-tenant output", () => {
  it("returns not_found when the tenant-scoped findFirst comes back null", async () => {
    mocks.isLiveDb.mockReturnValue(true);
    mocks.prismaFindFirst.mockResolvedValue(null);
    const result = await scheduleOutputAction({
      outputId: OUTPUT_ID,
      scheduledForIso: FUTURE_ISO,
      mode: "auto",
    });
    expect(result).toEqual({ ok: false, error: "Output not found.", errorCode: "not_found" });
    expect(mocks.scheduleOutput).not.toHaveBeenCalled();
    expect(mocks.bufferCreatePost).not.toHaveBeenCalled();
  });
});

// ============================================================
// unscheduleOutputAction
// ============================================================

describe("unscheduleOutputAction", () => {
  it("BUFFER-backed row: calls Buffer.deletePost *before* the DB downgrade", async () => {
    mocks.isLiveDb.mockReturnValue(true);
    mocks.prismaFindFirst.mockResolvedValue({
      id: OUTPUT_ID,
      externalScheduler: ExternalScheduler.BUFFER,
      externalPostId: "buf_post_1",
      episodeId: EPISODE_ID,
    });
    mocks.getBufferIntegration.mockResolvedValue(bufferConnected);
    mocks.bufferDeletePost.mockResolvedValue({ deleted: true });
    mocks.unscheduleOutput.mockResolvedValue({ id: OUTPUT_ID, episodeId: EPISODE_ID });

    const result = await unscheduleOutputAction({ outputId: OUTPUT_ID });

    expect(result).toEqual({ ok: true, data: { outputId: OUTPUT_ID } });
    expect(mocks.bufferDeletePost).toHaveBeenCalledWith(
      { accessToken: bufferConnected.accessToken, id: "buf_post_1" },
      expect.any(Object),
    );
    const del = mocks.bufferDeletePost.mock.invocationCallOrder[0]!;
    const unsched = mocks.unscheduleOutput.mock.invocationCallOrder[0]!;
    expect(del).toBeLessThan(unsched);
  });

  it("MANUAL row: skips Buffer entirely, just downgrades", async () => {
    mocks.isLiveDb.mockReturnValue(true);
    mocks.prismaFindFirst.mockResolvedValue({
      id: OUTPUT_ID,
      externalScheduler: ExternalScheduler.MANUAL,
      externalPostId: null,
      episodeId: EPISODE_ID,
    });
    mocks.unscheduleOutput.mockResolvedValue({ id: OUTPUT_ID, episodeId: EPISODE_ID });

    await unscheduleOutputAction({ outputId: OUTPUT_ID });

    expect(mocks.getBufferIntegration).not.toHaveBeenCalled();
    expect(mocks.bufferDeletePost).not.toHaveBeenCalled();
    expect(mocks.unscheduleOutput).toHaveBeenCalledWith(expect.anything(), OUTPUT_ID, MEMBER_ID);
  });

  it("Buffer delete throws → still downgrades locally (best-effort teardown)", async () => {
    mocks.isLiveDb.mockReturnValue(true);
    mocks.prismaFindFirst.mockResolvedValue({
      id: OUTPUT_ID,
      externalScheduler: ExternalScheduler.BUFFER,
      externalPostId: "buf_post_1",
      episodeId: EPISODE_ID,
    });
    mocks.getBufferIntegration.mockResolvedValue(bufferConnected);
    mocks.bufferDeletePost.mockRejectedValue(new BufferError(500, "buffer down"));
    mocks.unscheduleOutput.mockResolvedValue({ id: OUTPUT_ID, episodeId: EPISODE_ID });
    // Silence the console.error emitted by the swallow-and-continue branch.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await unscheduleOutputAction({ outputId: OUTPUT_ID });

    expect(result).toEqual({ ok: true, data: { outputId: OUTPUT_ID } });
    expect(mocks.unscheduleOutput).toHaveBeenCalledOnce();
    errSpy.mockRestore();
  });

  it("race with sync cron — row already moved past SCHEDULED → returns stale_state, revalidates", async () => {
    mocks.isLiveDb.mockReturnValue(true);
    mocks.prismaFindFirst.mockResolvedValue({
      id: OUTPUT_ID,
      externalScheduler: ExternalScheduler.MANUAL,
      externalPostId: null,
      episodeId: EPISODE_ID,
    });
    mocks.unscheduleOutput.mockRejectedValue(
      new ValidationError("Output out_1 can't be unscheduled from status PUBLISHED."),
    );

    const result = await unscheduleOutputAction({ outputId: OUTPUT_ID });

    expect(result).toEqual({
      ok: false,
      error: expect.stringContaining("already been published"),
      errorCode: "stale_state",
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/episodes/${EPISODE_ID}`);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/schedule");
  });

  it("unrelated ValidationError re-throws (not stale_state)", async () => {
    mocks.isLiveDb.mockReturnValue(true);
    mocks.prismaFindFirst.mockResolvedValue({
      id: OUTPUT_ID,
      externalScheduler: ExternalScheduler.MANUAL,
      externalPostId: null,
      episodeId: EPISODE_ID,
    });
    mocks.unscheduleOutput.mockRejectedValue(new ValidationError("some other validation issue"));

    await expect(unscheduleOutputAction({ outputId: OUTPUT_ID })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("cross-tenant output → not_found", async () => {
    mocks.isLiveDb.mockReturnValue(true);
    mocks.prismaFindFirst.mockResolvedValue(null);
    const result = await unscheduleOutputAction({ outputId: OUTPUT_ID });
    expect(result).toEqual({ ok: false, error: "Output not found.", errorCode: "not_found" });
  });

  it("sample-data mode: short-circuits without hitting DB or Buffer", async () => {
    mocks.isLiveDb.mockReturnValue(false);
    const result = await unscheduleOutputAction({ outputId: OUTPUT_ID });
    expect(result).toEqual({ ok: true, data: { outputId: OUTPUT_ID } });
    expect(mocks.requireAuthContext).not.toHaveBeenCalled();
    expect(mocks.unscheduleOutput).not.toHaveBeenCalled();
  });
});

// ============================================================
// markOutputPublishedAction
// ============================================================

describe("markOutputPublishedAction", () => {
  it("threads memberId + optional URL through to the repo helper", async () => {
    mocks.isLiveDb.mockReturnValue(true);
    mocks.markOutputPublished.mockResolvedValue({
      id: OUTPUT_ID,
      episodeId: EPISODE_ID,
      publishedAt: new Date(FUTURE_ISO),
    });

    const result = await markOutputPublishedAction({
      outputId: OUTPUT_ID,
      externalPostUrl: "https://twitter.com/foo/status/1",
    });

    expect(mocks.markOutputPublished).toHaveBeenCalledWith(
      { agencyId: AGENCY_ID, role: MemberRole.OWNER },
      OUTPUT_ID,
      MEMBER_ID, // NOT null — user path always carries memberId
      expect.objectContaining({
        externalPostUrl: "https://twitter.com/foo/status/1",
      }),
    );
    expect(result).toEqual({
      ok: true,
      data: expect.objectContaining({ outputId: OUTPUT_ID }),
    });
  });

  it("sample-data mode: no auth, no DB write", async () => {
    mocks.isLiveDb.mockReturnValue(false);
    const result = await markOutputPublishedAction({ outputId: OUTPUT_ID });
    expect(result).toEqual({
      ok: true,
      data: { outputId: OUTPUT_ID, publishedAt: expect.any(String) },
    });
    expect(mocks.requireAuthContext).not.toHaveBeenCalled();
    expect(mocks.markOutputPublished).not.toHaveBeenCalled();
  });

  it("rejects invalid URL via Zod → ValidationError", async () => {
    mocks.isLiveDb.mockReturnValue(true);
    await expect(
      markOutputPublishedAction({
        outputId: OUTPUT_ID,
        externalPostUrl: "not-a-url",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(mocks.markOutputPublished).not.toHaveBeenCalled();
  });
});

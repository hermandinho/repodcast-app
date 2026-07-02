/**
 * Phase 3.3 — schedule/unschedule/mark-published DB helpers.
 *
 * Pinned behavior:
 *   - Every helper filters by `episode.show.client.agencyId === ctx.agencyId`
 *     via a `findFirst` guard; cross-tenant ids surface as `NotFoundError`.
 *   - Only OWNER/ADMIN/EDITOR can mutate the schedule state.
 *   - Illegal status transitions raise `ValidationError` (can't schedule
 *     GENERATING/READY/IN_REVIEW, can't unschedule an APPROVED row, can't
 *     mark-published a SCHEDULED-but-already-past row via a status other
 *     than SCHEDULED, etc.).
 *   - `markOutputPublished(memberId = null)` skips the role gate — the sync
 *     cron drives that path and Inngest workers don't have a `MemberRole`.
 *   - `listScheduledOutputsForAgency` bounds the window at 90 days and
 *     requires `to > from`.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ExternalScheduler, MemberRole, OutputStatus, Platform } from "@prisma/client";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/auth/errors";
import type { TenantContext } from "@/server/auth/tenant";

const mocks = vi.hoisted(() => ({
  prisma: {
    generatedOutput: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    outputTransition: {
      create: vi.fn(),
    },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  },
}));

vi.mock("@/server/db/client", () => ({ prisma: mocks.prisma }));
// `voice-samples.createSampleFromOutput` isn't reached from the schedule
// helpers, but importing outputs.ts pulls the module in — stub to keep the
// mock harness minimal.
vi.mock("@/server/db/voice-samples", () => ({
  createSampleFromOutput: vi.fn(),
  countSamplesByPlatform: vi.fn(),
  listSamplesForClient: vi.fn(),
}));

import {
  listInFlightScheduledOutputs,
  listScheduledOutputsForAgency,
  markOutputPublished,
  scheduleOutput,
  unscheduleOutput,
} from "@/server/db/outputs";

const A1 = "agency_a1";
const A2 = "agency_a2";
const OUTPUT_ID = "out_1";
const EPISODE_ID = "ep_1";
const MEMBER_ID = "mem_1";

const owner = (agencyId: string): TenantContext => ({ agencyId, role: MemberRole.OWNER });
const editor = (agencyId: string): TenantContext => ({ agencyId, role: MemberRole.EDITOR });
const reviewer = (agencyId: string): TenantContext => ({ agencyId, role: MemberRole.REVIEWER });

// One hour into the future — well past `Date.now()` even on a slow test run.
const FUTURE = new Date(Date.now() + 60 * 60 * 1000);
// Fixed reference "now" that stays valid across every case in this file.
const PAST = new Date(Date.now() - 60 * 60 * 1000);

beforeEach(() => {
  for (const model of Object.values(mocks.prisma)) {
    if (typeof model === "object" && model !== null) {
      for (const fn of Object.values(model)) {
        if (typeof fn === "function" && "mockReset" in fn) {
          (fn as { mockReset: () => void }).mockReset();
        }
      }
    } else if (typeof model === "function" && "mockReset" in model) {
      (model as { mockReset: () => void }).mockReset();
    }
  }
  mocks.prisma.$transaction.mockImplementation(async (ops: Promise<unknown>[]) => Promise.all(ops));
});

// ============================================================
// scheduleOutput
// ============================================================

describe("scheduleOutput — tenant + role + status gates", () => {
  it("scopes the pre-check by `episode.show.client.agencyId`", async () => {
    mocks.prisma.generatedOutput.findFirst.mockResolvedValue({
      id: OUTPUT_ID,
      status: OutputStatus.APPROVED,
      supersededAt: null,
    });
    mocks.prisma.generatedOutput.update.mockResolvedValue({
      id: OUTPUT_ID,
      episodeId: EPISODE_ID,
      scheduledFor: FUTURE,
    });

    await scheduleOutput(owner(A1), OUTPUT_ID, MEMBER_ID, {
      scheduledFor: FUTURE,
      externalScheduler: ExternalScheduler.MANUAL,
    });

    // Guard clause runs before any writes and must carry the tenant filter.
    expect(mocks.prisma.generatedOutput.findFirst).toHaveBeenCalledWith({
      where: {
        id: OUTPUT_ID,
        episode: { show: { client: { agencyId: A1 } } },
      },
      select: { id: true, status: true, supersededAt: true },
    });
  });

  it("cross-tenant output → NotFoundError (findFirst returns null)", async () => {
    mocks.prisma.generatedOutput.findFirst.mockResolvedValue(null);
    await expect(
      scheduleOutput(owner(A2), OUTPUT_ID, MEMBER_ID, {
        scheduledFor: FUTURE,
        externalScheduler: ExternalScheduler.MANUAL,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(mocks.prisma.generatedOutput.update).not.toHaveBeenCalled();
    expect(mocks.prisma.outputTransition.create).not.toHaveBeenCalled();
  });

  it("REVIEWER can't schedule (SCHEDULE_ROLES = OWNER/ADMIN/EDITOR)", async () => {
    await expect(
      scheduleOutput(reviewer(A1), OUTPUT_ID, MEMBER_ID, {
        scheduledFor: FUTURE,
        externalScheduler: ExternalScheduler.MANUAL,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    // Role gate runs before any DB read — no tenant probe, no write.
    expect(mocks.prisma.generatedOutput.findFirst).not.toHaveBeenCalled();
  });

  it("EDITOR is allowed on the schedule action", async () => {
    mocks.prisma.generatedOutput.findFirst.mockResolvedValue({
      id: OUTPUT_ID,
      status: OutputStatus.APPROVED,
      supersededAt: null,
    });
    mocks.prisma.generatedOutput.update.mockResolvedValue({
      id: OUTPUT_ID,
      scheduledFor: FUTURE,
    });

    await expect(
      scheduleOutput(editor(A1), OUTPUT_ID, MEMBER_ID, {
        scheduledFor: FUTURE,
        externalScheduler: ExternalScheduler.MANUAL,
      }),
    ).resolves.toBeDefined();
  });

  it.each([
    OutputStatus.GENERATING,
    OutputStatus.READY,
    OutputStatus.IN_REVIEW,
    OutputStatus.SCHEDULED,
    OutputStatus.PUBLISHED,
    OutputStatus.FAILED,
  ])("rejects with ValidationError when the row is in %s (must be APPROVED)", async (status) => {
    mocks.prisma.generatedOutput.findFirst.mockResolvedValue({
      id: OUTPUT_ID,
      status,
      supersededAt: null,
    });
    await expect(
      scheduleOutput(owner(A1), OUTPUT_ID, MEMBER_ID, {
        scheduledFor: FUTURE,
        externalScheduler: ExternalScheduler.MANUAL,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(mocks.prisma.generatedOutput.update).not.toHaveBeenCalled();
  });

  it("rejects when the row is a superseded version (schedule the current one)", async () => {
    mocks.prisma.generatedOutput.findFirst.mockResolvedValue({
      id: OUTPUT_ID,
      status: OutputStatus.APPROVED,
      supersededAt: new Date(),
    });
    await expect(
      scheduleOutput(owner(A1), OUTPUT_ID, MEMBER_ID, {
        scheduledFor: FUTURE,
        externalScheduler: ExternalScheduler.MANUAL,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects a scheduledFor in the past — that's what markOutputPublished is for", async () => {
    mocks.prisma.generatedOutput.findFirst.mockResolvedValue({
      id: OUTPUT_ID,
      status: OutputStatus.APPROVED,
      supersededAt: null,
    });
    await expect(
      scheduleOutput(owner(A1), OUTPUT_ID, MEMBER_ID, {
        scheduledFor: PAST,
        externalScheduler: ExternalScheduler.MANUAL,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(mocks.prisma.generatedOutput.update).not.toHaveBeenCalled();
  });

  it("writes SCHEDULED + a transition row inside a single transaction", async () => {
    mocks.prisma.generatedOutput.findFirst.mockResolvedValue({
      id: OUTPUT_ID,
      status: OutputStatus.APPROVED,
      supersededAt: null,
    });
    mocks.prisma.generatedOutput.update.mockResolvedValue({
      id: OUTPUT_ID,
      episodeId: EPISODE_ID,
      scheduledFor: FUTURE,
      status: OutputStatus.SCHEDULED,
    });

    await scheduleOutput(owner(A1), OUTPUT_ID, MEMBER_ID, {
      scheduledFor: FUTURE,
      externalScheduler: ExternalScheduler.BUFFER,
      externalPostId: "buf_123",
      externalPostUrl: "https://publish.buffer.com/posts/buf_123",
    });

    // Exactly one $transaction call carrying both writes.
    expect(mocks.prisma.$transaction).toHaveBeenCalledOnce();
    expect(mocks.prisma.generatedOutput.update).toHaveBeenCalledWith({
      where: { id: OUTPUT_ID },
      data: {
        status: OutputStatus.SCHEDULED,
        scheduledFor: FUTURE,
        scheduledByMemberId: MEMBER_ID,
        externalScheduler: ExternalScheduler.BUFFER,
        externalPostId: "buf_123",
        externalPostUrl: "https://publish.buffer.com/posts/buf_123",
      },
    });
    expect(mocks.prisma.outputTransition.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          agencyId: A1,
          outputId: OUTPUT_ID,
          fromStatus: OutputStatus.APPROVED,
          toStatus: OutputStatus.SCHEDULED,
          byMemberId: MEMBER_ID,
        }),
      }),
    );
  });
});

// ============================================================
// unscheduleOutput
// ============================================================

describe("unscheduleOutput — clears every scheduling column", () => {
  it("tenant-scopes the pre-check + writes SCHEDULED → APPROVED with all columns null", async () => {
    mocks.prisma.generatedOutput.findFirst.mockResolvedValue({
      id: OUTPUT_ID,
      status: OutputStatus.SCHEDULED,
    });
    mocks.prisma.generatedOutput.update.mockResolvedValue({
      id: OUTPUT_ID,
      episodeId: EPISODE_ID,
      status: OutputStatus.APPROVED,
    });

    await unscheduleOutput(owner(A1), OUTPUT_ID, MEMBER_ID);

    expect(mocks.prisma.generatedOutput.findFirst).toHaveBeenCalledWith({
      where: {
        id: OUTPUT_ID,
        episode: { show: { client: { agencyId: A1 } } },
      },
      select: { id: true, status: true },
    });
    expect(mocks.prisma.generatedOutput.update).toHaveBeenCalledWith({
      where: { id: OUTPUT_ID },
      data: {
        status: OutputStatus.APPROVED,
        scheduledFor: null,
        scheduledByMemberId: null,
        externalScheduler: null,
        externalPostId: null,
        externalPostUrl: null,
      },
    });
    expect(mocks.prisma.outputTransition.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          agencyId: A1,
          outputId: OUTPUT_ID,
          fromStatus: OutputStatus.SCHEDULED,
          toStatus: OutputStatus.APPROVED,
          byMemberId: MEMBER_ID,
        }),
      }),
    );
  });

  it("rejects REVIEWER (role gate)", async () => {
    await expect(unscheduleOutput(reviewer(A1), OUTPUT_ID, MEMBER_ID)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("cross-tenant row → NotFoundError", async () => {
    mocks.prisma.generatedOutput.findFirst.mockResolvedValue(null);
    await expect(unscheduleOutput(owner(A2), OUTPUT_ID, MEMBER_ID)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it.each([
    OutputStatus.APPROVED,
    OutputStatus.PUBLISHED,
    OutputStatus.READY,
    OutputStatus.GENERATING,
  ])("rejects unschedule from status %s (must be SCHEDULED)", async (status) => {
    mocks.prisma.generatedOutput.findFirst.mockResolvedValue({ id: OUTPUT_ID, status });
    await expect(unscheduleOutput(owner(A1), OUTPUT_ID, MEMBER_ID)).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(mocks.prisma.generatedOutput.update).not.toHaveBeenCalled();
  });
});

// ============================================================
// markOutputPublished
// ============================================================

describe("markOutputPublished — user path enforces role, cron path (memberId=null) skips it", () => {
  it("REVIEWER blocked when memberId is set (user path)", async () => {
    await expect(
      markOutputPublished(reviewer(A1), OUTPUT_ID, MEMBER_ID, {}),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("memberId=null skips the role gate (cron path) — a REVIEWER-role ctx still lets the write through", async () => {
    // The cron shouldn't actually pass a REVIEWER ctx (it uses a system
    // context in the real code), but the important guarantee is that role
    // is *not* consulted when memberId is null.
    mocks.prisma.generatedOutput.findFirst.mockResolvedValue({
      id: OUTPUT_ID,
      status: OutputStatus.SCHEDULED,
      externalPostUrl: null,
    });
    mocks.prisma.generatedOutput.update.mockResolvedValue({
      id: OUTPUT_ID,
      episodeId: EPISODE_ID,
      status: OutputStatus.PUBLISHED,
      publishedAt: new Date(),
    });
    await expect(markOutputPublished(reviewer(A1), OUTPUT_ID, null, {})).resolves.toBeDefined();
    // Transition row records byMemberId as null so the audit trail
    // distinguishes cron-driven flips from operator overrides.
    expect(mocks.prisma.outputTransition.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ byMemberId: null }),
      }),
    );
  });

  it("cross-tenant row → NotFoundError even on the cron path", async () => {
    mocks.prisma.generatedOutput.findFirst.mockResolvedValue(null);
    await expect(markOutputPublished(owner(A2), OUTPUT_ID, null, {})).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it.each([
    OutputStatus.APPROVED,
    OutputStatus.READY,
    OutputStatus.PUBLISHED,
    OutputStatus.GENERATING,
    OutputStatus.IN_REVIEW,
  ])("rejects mark-published from status %s (must be SCHEDULED)", async (status) => {
    mocks.prisma.generatedOutput.findFirst.mockResolvedValue({
      id: OUTPUT_ID,
      status,
      externalPostUrl: null,
    });
    await expect(markOutputPublished(owner(A1), OUTPUT_ID, MEMBER_ID, {})).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(mocks.prisma.generatedOutput.update).not.toHaveBeenCalled();
  });

  it("preserves the existing externalPostUrl when the caller doesn't pass a new one", async () => {
    mocks.prisma.generatedOutput.findFirst.mockResolvedValue({
      id: OUTPUT_ID,
      status: OutputStatus.SCHEDULED,
      externalPostUrl: "https://twitter.com/foo/status/123",
    });
    mocks.prisma.generatedOutput.update.mockResolvedValue({ id: OUTPUT_ID, episodeId: EPISODE_ID });

    await markOutputPublished(owner(A1), OUTPUT_ID, MEMBER_ID, {});

    expect(mocks.prisma.generatedOutput.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          externalPostUrl: "https://twitter.com/foo/status/123",
        }),
      }),
    );
  });

  it("overrides the URL when the caller provides one", async () => {
    mocks.prisma.generatedOutput.findFirst.mockResolvedValue({
      id: OUTPUT_ID,
      status: OutputStatus.SCHEDULED,
      externalPostUrl: "https://old.example.com/post/1",
    });
    mocks.prisma.generatedOutput.update.mockResolvedValue({ id: OUTPUT_ID, episodeId: EPISODE_ID });

    await markOutputPublished(owner(A1), OUTPUT_ID, MEMBER_ID, {
      externalPostUrl: "https://new.example.com/post/1",
    });

    expect(mocks.prisma.generatedOutput.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          externalPostUrl: "https://new.example.com/post/1",
        }),
      }),
    );
  });
});

// ============================================================
// listScheduledOutputsForAgency — calendar range read
// ============================================================

describe("listScheduledOutputsForAgency — 90-day cap + tenant scoping", () => {
  const from = "2026-07-01T00:00:00.000Z";
  const to = "2026-07-31T00:00:00.000Z";

  it("scopes the query by ctx.agencyId + filters SCHEDULED|PUBLISHED", async () => {
    mocks.prisma.generatedOutput.findMany.mockResolvedValue([]);
    await listScheduledOutputsForAgency(owner(A1), { fromIso: from, toIso: to });
    const args = mocks.prisma.generatedOutput.findMany.mock.calls[0]![0];
    expect(args.where.episode.show.client.agencyId).toBe(A1);
    expect(args.where.status).toEqual({
      in: [OutputStatus.SCHEDULED, OutputStatus.PUBLISHED],
    });
    // Only current versions.
    expect(args.where.supersededAt).toBeNull();
  });

  it("rejects `to <= from`", async () => {
    await expect(
      listScheduledOutputsForAgency(owner(A1), { fromIso: to, toIso: from }),
    ).rejects.toBeInstanceOf(ValidationError);
    // Equal case: also rejected.
    await expect(
      listScheduledOutputsForAgency(owner(A1), { fromIso: from, toIso: from }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects a window > 90 days", async () => {
    await expect(
      listScheduledOutputsForAgency(owner(A1), {
        fromIso: "2026-01-01T00:00:00.000Z",
        toIso: "2026-06-01T00:00:00.000Z",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("threads optional clientId / showId / platform filters into the query", async () => {
    mocks.prisma.generatedOutput.findMany.mockResolvedValue([]);
    await listScheduledOutputsForAgency(owner(A1), {
      fromIso: from,
      toIso: to,
      clientId: "cli_1",
      showId: "shw_1",
      platform: Platform.TWITTER,
    });
    const args = mocks.prisma.generatedOutput.findMany.mock.calls[0]![0];
    expect(args.where.episode.show.client.id).toBe("cli_1");
    expect(args.where.episode.show.id).toBe("shw_1");
    expect(args.where.platform).toBe(Platform.TWITTER);
  });

  it("flattens the join into the CalendarOutput shape", async () => {
    mocks.prisma.generatedOutput.findMany.mockResolvedValue([
      {
        id: OUTPUT_ID,
        episodeId: EPISODE_ID,
        platform: Platform.TWITTER,
        content: "hi",
        status: OutputStatus.SCHEDULED,
        scheduledFor: new Date("2026-07-15T12:00:00.000Z"),
        publishedAt: null,
        externalScheduler: ExternalScheduler.BUFFER,
        externalPostUrl: "https://publish.buffer.com/posts/x",
        episode: {
          title: "E1",
          showId: "shw_1",
          show: {
            name: "Show 1",
            host: "Host 1",
            client: { id: "cli_1", name: "Client 1" },
          },
        },
      },
    ]);
    const rows = await listScheduledOutputsForAgency(owner(A1), { fromIso: from, toIso: to });
    expect(rows[0]).toMatchObject({
      id: OUTPUT_ID,
      episodeId: EPISODE_ID,
      episodeTitle: "E1",
      clientId: "cli_1",
      clientHost: "Host 1",
      showId: "shw_1",
      showTitle: "Show 1",
      platform: Platform.TWITTER,
      status: OutputStatus.SCHEDULED,
      externalScheduler: ExternalScheduler.BUFFER,
      externalPostUrl: "https://publish.buffer.com/posts/x",
    });
  });
});

// ============================================================
// listInFlightScheduledOutputs — cron scan (no tenant guard)
// ============================================================

describe("listInFlightScheduledOutputs — cron scan", () => {
  it("returns SCHEDULED rows with their derived agencyId (via the join)", async () => {
    mocks.prisma.generatedOutput.findMany.mockResolvedValue([
      {
        id: OUTPUT_ID,
        platform: Platform.TWITTER,
        scheduledFor: FUTURE,
        externalScheduler: ExternalScheduler.BUFFER,
        externalPostId: "buf_1",
        createdAt: new Date(),
        episode: { show: { client: { agencyId: A1 } } },
      },
    ]);
    const rows = await listInFlightScheduledOutputs();
    expect(rows).toEqual([
      {
        id: OUTPUT_ID,
        agencyId: A1,
        platform: Platform.TWITTER,
        scheduledFor: expect.any(Date),
        externalScheduler: ExternalScheduler.BUFFER,
        externalPostId: "buf_1",
        createdAt: expect.any(Date),
      },
    ]);
    // Only SCHEDULED, only current versions.
    const args = mocks.prisma.generatedOutput.findMany.mock.calls[0]![0];
    expect(args.where).toMatchObject({
      status: OutputStatus.SCHEDULED,
      supersededAt: null,
    });
    expect(args.take).toBe(500);
  });

  it("drops rows missing scheduledFor OR externalScheduler (guards against half-null legacy rows)", async () => {
    mocks.prisma.generatedOutput.findMany.mockResolvedValue([
      {
        id: "half_1",
        platform: Platform.TWITTER,
        scheduledFor: null,
        externalScheduler: ExternalScheduler.BUFFER,
        externalPostId: null,
        createdAt: new Date(),
        episode: { show: { client: { agencyId: A1 } } },
      },
      {
        id: "half_2",
        platform: Platform.LINKEDIN,
        scheduledFor: FUTURE,
        externalScheduler: null,
        externalPostId: null,
        createdAt: new Date(),
        episode: { show: { client: { agencyId: A1 } } },
      },
      {
        id: "ok",
        platform: Platform.TIKTOK,
        scheduledFor: FUTURE,
        externalScheduler: ExternalScheduler.MANUAL,
        externalPostId: null,
        createdAt: new Date(),
        episode: { show: { client: { agencyId: A2 } } },
      },
    ]);
    const rows = await listInFlightScheduledOutputs();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe("ok");
    expect(rows[0]!.agencyId).toBe(A2);
  });

  it("respects the caller-supplied limit", async () => {
    mocks.prisma.generatedOutput.findMany.mockResolvedValue([]);
    await listInFlightScheduledOutputs(50);
    const args = mocks.prisma.generatedOutput.findMany.mock.calls[0]![0];
    expect(args.take).toBe(50);
  });
});

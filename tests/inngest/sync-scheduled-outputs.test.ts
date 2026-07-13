/**
 * Every 5 minutes the cron walks the SCHEDULED backlog and
 * reconciles with Buffer + auto-publishes stale MANUAL rows. This suite
 * pins the per-branch behavior:
 *
 *   - Buffer-confirmed (`sent` / `success`) → PUBLISHED, `publishedAt` from
 *     Buffer's `sent_at`, external URL threaded through, transition row.
 *   - Buffer still-pending (`buffer` / no match in the recent window / row
 *     younger than MIN_AGE_BEFORE_POLL_MS) → skip, no writes.
 *   - Buffer failed (`error` / `failed`) → OutputStatus.FAILED, transition.
 *   - Agency's Buffer integration missing at cron time → downgrade every
 *     in-flight BUFFER row for that agency to MANUAL (no status change).
 *   - MANUAL past scheduledFor + autoMarkPublished (default) → PUBLISHED.
 *   - MANUAL past scheduledFor but agency has autoMarkPublished=false → skip.
 *   - MANUAL still in the future → skip regardless of flag.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ExternalScheduler, OutputStatus, Platform } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  listInFlight: vi.fn(),
  getIntegration: vi.fn(),
  stampSync: vi.fn(),
  makeAuthRefresher: vi.fn(),
  listRecentPosts: vi.fn(),
  prisma: {
    generatedOutput: {
      updateMany: vi.fn(),
      update: vi.fn(),
    },
    outputTransition: {
      create: vi.fn(),
    },
    agencyIntegration: {
      findMany: vi.fn(),
    },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  },
}));

vi.mock("@/server/db/client", () => ({ prisma: mocks.prisma }));
vi.mock("@/server/db/outputs", () => ({
  listInFlightScheduledOutputs: mocks.listInFlight,
}));
vi.mock("@/server/db/integrations", () => ({
  getBufferIntegrationForAgencyRaw: mocks.getIntegration,
  stampIntegrationSync: mocks.stampSync,
  makeBufferAuthRefresher: mocks.makeAuthRefresher,
}));
vi.mock("@/server/integrations/buffer", () => ({
  listRecentPostsForOrg: mocks.listRecentPosts,
}));

import { syncScheduledOutputsHandler } from "@/inngest/functions/sync-scheduled-outputs";

// A `step` stub that just runs each block inline. The real Inngest runtime
// wraps step.run for durable checkpointing; behavior parity is all we need.
const step = { run: async (_id: string, fn: () => Promise<unknown>) => fn() };

const A1 = "agency_a1";
const A2 = "agency_a2";
const NOW = Date.now();
// Anything older than MIN_AGE_BEFORE_POLL_MS = 60 s is eligible for Buffer polling.
const OLD_ENOUGH = new Date(NOW - 5 * 60 * 1000);
const TOO_YOUNG = new Date(NOW - 10 * 1000);

const integrationFor = (agencyId: string) => ({
  id: `int_${agencyId}`,
  accessToken: "at_plain",
  meta: {
    organizationIds: ["org_1"],
    profiles: { [Platform.TWITTER]: "chn_tw", [Platform.LINKEDIN]: "chn_li" } as Record<
      Platform,
      string
    >,
    channelToOrg: { chn_tw: "org_1", chn_li: "org_1" },
  },
  autoMarkPublished: true,
  lastSyncedAt: null,
  lastSyncError: null,
});

const bufferRow = (
  id: string,
  agencyId: string,
  overrides: Partial<{ createdAt: Date; externalPostId: string | null; platform: Platform }> = {},
) => ({
  id,
  agencyId,
  platform: overrides.platform ?? Platform.TWITTER,
  scheduledFor: new Date(NOW + 60 * 60 * 1000),
  externalScheduler: ExternalScheduler.BUFFER,
  externalPostId: overrides.externalPostId === undefined ? `buf_${id}` : overrides.externalPostId,
  createdAt: overrides.createdAt ?? OLD_ENOUGH,
});

const manualRow = (id: string, agencyId: string, scheduledFor: Date) => ({
  id,
  agencyId,
  platform: Platform.SHOW_NOTES,
  scheduledFor,
  externalScheduler: ExternalScheduler.MANUAL,
  externalPostId: null as string | null,
  createdAt: OLD_ENOUGH,
});

beforeEach(() => {
  for (const key of Object.keys(mocks) as (keyof typeof mocks)[]) {
    const val = mocks[key];
    if (typeof val === "function" && "mockReset" in val) {
      (val as { mockReset: () => void }).mockReset();
    }
  }
  for (const model of Object.values(mocks.prisma)) {
    if (typeof model === "object" && model !== null) {
      for (const fn of Object.values(model)) {
        if (typeof fn === "function" && "mockReset" in fn) {
          (fn as { mockReset: () => void }).mockReset();
        }
      }
    }
  }
  mocks.prisma.$transaction.mockImplementation(async (ops: Promise<unknown>[]) => Promise.all(ops));
  mocks.stampSync.mockResolvedValue(undefined);
  mocks.makeAuthRefresher.mockReturnValue({ onUnauthenticated: async () => null });
  // Default: no manual agencies flagged auto-off.
  mocks.prisma.agencyIntegration.findMany.mockResolvedValue([]);
});

// ============================================================
// Buffer confirmed
// ============================================================

describe("Buffer-confirmed rows", () => {
  it("`sent` → PUBLISHED with publishedAt from sent_at + externalPostUrl threaded through", async () => {
    mocks.listInFlight.mockResolvedValue([bufferRow("o1", A1)]);
    mocks.getIntegration.mockResolvedValue(integrationFor(A1));
    mocks.listRecentPosts.mockResolvedValue([
      {
        id: "buf_o1",
        status: "sent",
        dueAt: null,
        sentAt: new Date("2026-07-15T10:00:00.000Z"),
        externalLink: "https://twitter.com/foo/1",
        channelId: "chn_tw",
      },
    ]);
    mocks.prisma.generatedOutput.update.mockResolvedValue({ id: "o1" });
    mocks.prisma.outputTransition.create.mockResolvedValue({ id: "tr1" });

    const result = await syncScheduledOutputsHandler(step);

    expect(mocks.prisma.generatedOutput.update).toHaveBeenCalledWith({
      where: { id: "o1" },
      data: {
        status: OutputStatus.PUBLISHED,
        publishedAt: new Date("2026-07-15T10:00:00.000Z"),
        externalPostUrl: "https://twitter.com/foo/1",
      },
    });
    expect(mocks.prisma.outputTransition.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          agencyId: A1,
          outputId: "o1",
          fromStatus: OutputStatus.SCHEDULED,
          toStatus: OutputStatus.PUBLISHED,
          byMemberId: null,
        }),
      }),
    );
    expect(result.bufferConfirmed).toBe(1);
    expect(mocks.stampSync).toHaveBeenCalledWith(A1, ExternalScheduler.BUFFER, null);
  });

  it("`success` alias also flips to PUBLISHED", async () => {
    mocks.listInFlight.mockResolvedValue([bufferRow("o1", A1)]);
    mocks.getIntegration.mockResolvedValue(integrationFor(A1));
    mocks.listRecentPosts.mockResolvedValue([
      {
        id: "buf_o1",
        status: "success",
        dueAt: null,
        sentAt: new Date("2026-07-15T10:00:00.000Z"),
        externalLink: null,
        channelId: "chn_tw",
      },
    ]);
    mocks.prisma.generatedOutput.update.mockResolvedValue({ id: "o1" });
    mocks.prisma.outputTransition.create.mockResolvedValue({});

    const result = await syncScheduledOutputsHandler(step);
    expect(result.bufferConfirmed).toBe(1);
  });
});

// ============================================================
// Buffer still-pending
// ============================================================

describe("Buffer still-pending / skip cases", () => {
  it("`buffer` status → skip, no writes", async () => {
    mocks.listInFlight.mockResolvedValue([bufferRow("o1", A1)]);
    mocks.getIntegration.mockResolvedValue(integrationFor(A1));
    mocks.listRecentPosts.mockResolvedValue([
      {
        id: "buf_o1",
        status: "buffer",
        dueAt: null,
        sentAt: null,
        externalLink: null,
        channelId: "chn_tw",
      },
    ]);

    const result = await syncScheduledOutputsHandler(step);

    expect(mocks.prisma.generatedOutput.update).not.toHaveBeenCalled();
    expect(mocks.prisma.outputTransition.create).not.toHaveBeenCalled();
    expect(result.bufferSkipped).toBe(1);
    expect(result.bufferConfirmed).toBe(0);
  });

  it("row younger than MIN_AGE_BEFORE_POLL_MS (60 s) → skip, no matching attempted", async () => {
    mocks.listInFlight.mockResolvedValue([bufferRow("o1", A1, { createdAt: TOO_YOUNG })]);
    mocks.getIntegration.mockResolvedValue(integrationFor(A1));
    // Even if Buffer says `sent`, the young row is skipped.
    mocks.listRecentPosts.mockResolvedValue([
      {
        id: "buf_o1",
        status: "sent",
        dueAt: null,
        sentAt: new Date(),
        externalLink: null,
        channelId: "chn_tw",
      },
    ]);

    const result = await syncScheduledOutputsHandler(step);
    expect(result.bufferSkipped).toBe(1);
    expect(result.bufferConfirmed).toBe(0);
    expect(mocks.prisma.generatedOutput.update).not.toHaveBeenCalled();
  });

  it("row not in the recent-posts window → skip (waits for next cron pass)", async () => {
    mocks.listInFlight.mockResolvedValue([bufferRow("o1", A1)]);
    mocks.getIntegration.mockResolvedValue(integrationFor(A1));
    // Recent posts contains a DIFFERENT post id — our row's `externalPostId`
    // isn't in the window yet.
    mocks.listRecentPosts.mockResolvedValue([
      {
        id: "buf_other",
        status: "sent",
        dueAt: null,
        sentAt: new Date(),
        externalLink: null,
        channelId: "chn_tw",
      },
    ]);

    const result = await syncScheduledOutputsHandler(step);
    expect(result.bufferSkipped).toBe(1);
    expect(result.bufferConfirmed).toBe(0);
    expect(mocks.prisma.generatedOutput.update).not.toHaveBeenCalled();
  });
});

// ============================================================
// Buffer failed
// ============================================================

describe("Buffer-failed rows", () => {
  it.each(["error", "failed"])("`%s` → OutputStatus.FAILED with transition", async (status) => {
    mocks.listInFlight.mockResolvedValue([bufferRow("o1", A1)]);
    mocks.getIntegration.mockResolvedValue(integrationFor(A1));
    mocks.listRecentPosts.mockResolvedValue([
      {
        id: "buf_o1",
        status,
        dueAt: null,
        sentAt: null,
        externalLink: null,
        channelId: "chn_tw",
      },
    ]);
    mocks.prisma.generatedOutput.update.mockResolvedValue({ id: "o1" });
    mocks.prisma.outputTransition.create.mockResolvedValue({});

    const result = await syncScheduledOutputsHandler(step);

    expect(mocks.prisma.generatedOutput.update).toHaveBeenCalledWith({
      where: { id: "o1" },
      data: { status: OutputStatus.FAILED },
    });
    expect(mocks.prisma.outputTransition.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          toStatus: OutputStatus.FAILED,
          note: "Buffer reported delivery failure",
        }),
      }),
    );
    expect(result.bufferFailed).toBe(1);
  });
});

// ============================================================
// Disconnected agency → downgrade to MANUAL
// ============================================================

describe("Disconnected agency (integration missing at cron time)", () => {
  it("downgrades every BUFFER row for that agency to MANUAL (no status flip)", async () => {
    mocks.listInFlight.mockResolvedValue([
      bufferRow("o1", A1),
      bufferRow("o2", A1),
      // Different agency, still connected — shouldn't be touched by this branch.
      bufferRow("o3", A2),
    ]);
    // A1 has no integration; A2 does.
    mocks.getIntegration.mockImplementation(async (agencyId: string) =>
      agencyId === A1 ? null : integrationFor(A2),
    );
    mocks.listRecentPosts.mockResolvedValue([]); // A2's poll returns empty
    mocks.prisma.generatedOutput.updateMany.mockResolvedValue({ count: 2 });

    const result = await syncScheduledOutputsHandler(step);

    // A1's rows get updateMany'd to MANUAL — the only DB write in this branch.
    expect(mocks.prisma.generatedOutput.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["o1", "o2"] } },
      data: { externalScheduler: ExternalScheduler.MANUAL },
    });
    expect(result.bufferDowngraded).toBe(2);
    // No status change on the downgraded rows.
    expect(mocks.prisma.generatedOutput.update).not.toHaveBeenCalled();
    expect(mocks.prisma.outputTransition.create).not.toHaveBeenCalled();
  });

  it("row has no externalPostId → downgrade branch (org can't be resolved)", async () => {
    mocks.listInFlight.mockResolvedValue([bufferRow("o1", A1, { externalPostId: null })]);
    mocks.getIntegration.mockResolvedValue(integrationFor(A1));
    mocks.prisma.generatedOutput.updateMany.mockResolvedValue({ count: 1 });

    const result = await syncScheduledOutputsHandler(step);
    expect(result.bufferDowngraded).toBe(1);
    // No recent-posts call — we downgrade before polling.
    expect(mocks.listRecentPosts).not.toHaveBeenCalled();
  });
});

// ============================================================
// MANUAL auto-publish
// ============================================================

describe("MANUAL rows past scheduledFor", () => {
  it("agency default (autoMarkPublished=true) → PUBLISHED with publishedAt = scheduledFor", async () => {
    const pastTime = new Date(NOW - 30 * 60 * 1000); // 30 min ago
    mocks.listInFlight.mockResolvedValue([manualRow("m1", A1, pastTime)]);
    mocks.prisma.agencyIntegration.findMany.mockResolvedValue([]); // no explicit flag
    mocks.prisma.generatedOutput.update.mockResolvedValue({ id: "m1" });
    mocks.prisma.outputTransition.create.mockResolvedValue({});

    const result = await syncScheduledOutputsHandler(step);

    expect(mocks.prisma.generatedOutput.update).toHaveBeenCalledWith({
      where: { id: "m1" },
      data: { status: OutputStatus.PUBLISHED, publishedAt: pastTime },
    });
    expect(mocks.prisma.outputTransition.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          agencyId: A1,
          outputId: "m1",
          fromStatus: OutputStatus.SCHEDULED,
          toStatus: OutputStatus.PUBLISHED,
          byMemberId: null,
          note: "Auto-marked published — scheduledFor passed",
        }),
      }),
    );
    expect(result.manualAutoPublished).toBe(1);
  });

  it("agency has autoMarkPublished=false → skip (respect the opt-out)", async () => {
    const pastTime = new Date(NOW - 30 * 60 * 1000);
    mocks.listInFlight.mockResolvedValue([manualRow("m1", A1, pastTime)]);
    mocks.prisma.agencyIntegration.findMany.mockResolvedValue([
      { agencyId: A1, autoMarkPublished: false },
    ]);

    const result = await syncScheduledOutputsHandler(step);
    expect(result.manualAutoPublished).toBe(0);
    expect(mocks.prisma.generatedOutput.update).not.toHaveBeenCalled();
  });

  it("agency has autoMarkPublished=true explicitly → still publishes", async () => {
    const pastTime = new Date(NOW - 30 * 60 * 1000);
    mocks.listInFlight.mockResolvedValue([manualRow("m1", A1, pastTime)]);
    mocks.prisma.agencyIntegration.findMany.mockResolvedValue([
      { agencyId: A1, autoMarkPublished: true },
    ]);
    mocks.prisma.generatedOutput.update.mockResolvedValue({});
    mocks.prisma.outputTransition.create.mockResolvedValue({});

    const result = await syncScheduledOutputsHandler(step);
    expect(result.manualAutoPublished).toBe(1);
  });

  it("MANUAL row still in the future → skip regardless of flag", async () => {
    const futureTime = new Date(NOW + 30 * 60 * 1000);
    mocks.listInFlight.mockResolvedValue([manualRow("m1", A1, futureTime)]);
    mocks.prisma.agencyIntegration.findMany.mockResolvedValue([
      { agencyId: A1, autoMarkPublished: true },
    ]);

    const result = await syncScheduledOutputsHandler(step);
    expect(result.manualAutoPublished).toBe(0);
    expect(mocks.prisma.generatedOutput.update).not.toHaveBeenCalled();
  });
});

// ============================================================
// Buffer poll error → error counter increments, doesn't blow up the run
// ============================================================

describe("Resilience", () => {
  it("Buffer poll error for one org is logged + counted but doesn't abort the sync", async () => {
    mocks.listInFlight.mockResolvedValue([bufferRow("o1", A1)]);
    mocks.getIntegration.mockResolvedValue(integrationFor(A1));
    mocks.listRecentPosts.mockRejectedValue(new Error("buffer 502"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await syncScheduledOutputsHandler(step);

    expect(result.errors).toBe(1);
    expect(result.bufferConfirmed).toBe(0);
    // Sync stamp still fires — we cleared the per-agency block, and the poll
    // error is a per-org detail. (This is intentional; the next cron pass
    // retries the org.)
    expect(mocks.stampSync).toHaveBeenCalledWith(A1, ExternalScheduler.BUFFER, null);
    errSpy.mockRestore();
  });

  it("scanned counter reflects the total in-flight row count", async () => {
    mocks.listInFlight.mockResolvedValue([
      bufferRow("o1", A1),
      manualRow("m1", A1, new Date(NOW + 60 * 60 * 1000)),
    ]);
    mocks.getIntegration.mockResolvedValue(integrationFor(A1));
    mocks.listRecentPosts.mockResolvedValue([]);

    const result = await syncScheduledOutputsHandler(step);
    expect(result.scanned).toBe(2);
  });
});

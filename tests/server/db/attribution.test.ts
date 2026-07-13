import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    agencyAttribution: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
      groupBy: vi.fn(),
    },
  },
}));

vi.mock("@/server/db/client", () => ({ prisma: mocks.prisma }));

import {
  captureAttribution,
  countSignupsByCampaign,
  countSignupsBySource,
  getAttributionFor,
} from "@/server/db/attribution";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("captureAttribution", () => {
  it("upserts the attribution row keyed by agencyId", async () => {
    mocks.prisma.agencyAttribution.upsert.mockResolvedValue({ agencyId: "a1" });

    await captureAttribution("a1", {
      utmSource: "producthunt",
      utmMedium: "referral",
      utmCampaign: "launch-day",
      referrer: "https://www.producthunt.com/",
      landingPath: "/",
      signupPath: "/onboarding/workspace",
    });

    expect(mocks.prisma.agencyAttribution.upsert).toHaveBeenCalledTimes(1);
    const call = mocks.prisma.agencyAttribution.upsert.mock.calls[0][0];
    expect(call.where).toEqual({ agencyId: "a1" });
    expect(call.create.utmSource).toBe("producthunt");
    expect(call.update.utmSource).toBe("producthunt");
  });

  it("clamps overlong strings to 500 characters", async () => {
    mocks.prisma.agencyAttribution.upsert.mockResolvedValue({ agencyId: "a1" });
    const longString = "x".repeat(1200);

    await captureAttribution("a1", { referrer: longString });

    const call = mocks.prisma.agencyAttribution.upsert.mock.calls[0][0];
    expect(call.create.referrer).toHaveLength(500);
  });

  it("normalises empty and whitespace-only strings to null", async () => {
    mocks.prisma.agencyAttribution.upsert.mockResolvedValue({ agencyId: "a1" });

    await captureAttribution("a1", {
      utmSource: "",
      utmMedium: "   ",
      utmCampaign: null,
      referrer: undefined,
    });

    const call = mocks.prisma.agencyAttribution.upsert.mock.calls[0][0];
    expect(call.create.utmSource).toBeNull();
    expect(call.create.utmMedium).toBeNull();
    expect(call.create.utmCampaign).toBeNull();
    expect(call.create.referrer).toBeNull();
  });

  it("swallows DB errors — attribution must not block signup", async () => {
    mocks.prisma.agencyAttribution.upsert.mockRejectedValue(new Error("db down"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(captureAttribution("a1", { utmSource: "x" })).resolves.toBeUndefined();

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("trims leading/trailing whitespace from real values", async () => {
    mocks.prisma.agencyAttribution.upsert.mockResolvedValue({ agencyId: "a1" });

    await captureAttribution("a1", { utmSource: "  producthunt  " });

    const call = mocks.prisma.agencyAttribution.upsert.mock.calls[0][0];
    expect(call.create.utmSource).toBe("producthunt");
  });
});

describe("getAttributionFor", () => {
  it("delegates to prisma.findUnique with the agencyId", async () => {
    mocks.prisma.agencyAttribution.findUnique.mockResolvedValue({
      agencyId: "a1",
      utmSource: "producthunt",
    });

    const row = await getAttributionFor("a1");
    expect(row?.utmSource).toBe("producthunt");
    expect(mocks.prisma.agencyAttribution.findUnique).toHaveBeenCalledWith({
      where: { agencyId: "a1" },
    });
  });

  it("returns null when no row exists", async () => {
    mocks.prisma.agencyAttribution.findUnique.mockResolvedValue(null);
    expect(await getAttributionFor("missing")).toBeNull();
  });
});

describe("countSignupsBySource", () => {
  it("buckets NULL utmSource under 'direct' and sorts descending", async () => {
    mocks.prisma.agencyAttribution.groupBy.mockResolvedValue([
      { utmSource: null, _count: { agencyId: 3 } },
      { utmSource: "producthunt", _count: { agencyId: 7 } },
      { utmSource: "twitter", _count: { agencyId: 2 } },
    ]);

    const rows = await countSignupsBySource(new Date("2026-07-01"), new Date("2026-07-31"));
    expect(rows).toEqual([
      { source: "producthunt", count: 7 },
      { source: "direct", count: 3 },
      { source: "twitter", count: 2 },
    ]);
  });
});

describe("countSignupsByCampaign", () => {
  it("excludes NULL utmCampaign rows from the result", async () => {
    mocks.prisma.agencyAttribution.groupBy.mockResolvedValue([
      { utmCampaign: "launch-day", _count: { agencyId: 5 } },
      { utmCampaign: "outreach-w17", _count: { agencyId: 1 } },
    ]);

    const rows = await countSignupsByCampaign(new Date("2026-07-01"), new Date("2026-07-31"));
    expect(rows).toEqual([
      { campaign: "launch-day", count: 5 },
      { campaign: "outreach-w17", count: 1 },
    ]);

    const whereArg = mocks.prisma.agencyAttribution.groupBy.mock.calls[0][0].where;
    expect(whereArg.utmCampaign).toEqual({ not: null });
  });
});

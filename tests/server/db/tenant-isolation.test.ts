/**
 * Tenant isolation: every repository helper must filter by the caller's
 * agencyId. We mock Prisma and assert the `where` clause shape — the goal
 * is to catch any code change that drops the tenant filter at compile or
 * review time.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  EpisodeStatus,
  InviteStatus,
  MemberRole,
  OutputStatus,
  Plan,
  Platform,
  TranscriptSource,
} from "@prisma/client";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/auth/errors";

// Stub the plan-capacity helpers — `bulkGenerateEpisodes`, `updateAgencyBranding`,
// `createPortalLink` (and `createEpisode` upstream) all call them on the happy
// path. We don't want to chase their internal Prisma queries through the mock
// harness for every test; the dedicated plan-limits.test.ts covers plan gates
// (`assertMinPlan`) and capacity math (`assertPlanCapacity`) in isolation.
vi.mock("@/server/billing/limits", () => ({
  getAgencyPlan: vi.fn().mockResolvedValue(Plan.NETWORK),
  assertPlanCapacity: vi.fn().mockResolvedValue(undefined),
  assertMinPlan: vi.fn().mockReturnValue(undefined),
}));
import type { TenantContext } from "@/server/auth/tenant";

const mocks = vi.hoisted(() => ({
  prisma: {
    agency: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      count: vi.fn(),
      updateMany: vi.fn(),
    },
    client: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    episode: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      groupBy: vi.fn(),
    },
    generatedOutput: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
    },
    voiceSample: {
      findMany: vi.fn(),
      create: vi.fn(),
      groupBy: vi.fn(),
    },
    member: {
      count: vi.fn(),
      findFirst: vi.fn(),
    },
    outputTransition: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    clientPlatformInstruction: {
      findMany: vi.fn(),
      upsert: vi.fn(),
      deleteMany: vi.fn(),
    },
    show: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    showPlatformInstruction: {
      findMany: vi.fn(),
      upsert: vi.fn(),
      deleteMany: vi.fn(),
    },
    memberInvite: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    memberTransition: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    clientBillingProfile: {
      findFirst: vi.fn(),
      upsert: vi.fn(),
    },
    clientStatement: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
    },
    clientPortalLink: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    clientPortalAccessLog: {
      create: vi.fn(),
    },
    usageLog: {
      aggregate: vi.fn(),
      findMany: vi.fn(),
    },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  },
}));

vi.mock("@/server/db/client", () => ({ prisma: mocks.prisma }));

import * as agenciesRepo from "@/server/db/agencies";
import * as clientsRepo from "@/server/db/clients";
import * as clientInstructionsRepo from "@/server/db/show-instructions";
import * as episodesRepo from "@/server/db/episodes";
import * as invitesRepo from "@/server/db/invites";
import * as outputsRepo from "@/server/db/outputs";
import * as samplesRepo from "@/server/db/voice-samples";
import * as transitionsRepo from "@/server/db/transitions";
import * as memberTransitionsRepo from "@/server/db/member-transitions";
import * as clientBillingRepo from "@/server/db/client-billing";
import * as deliverablesRepo from "@/server/db/deliverables";
import * as clientStatementsRepo from "@/server/db/client-statements";
import * as clientCostRepo from "@/server/db/client-cost";
import * as clientPortalRepo from "@/server/db/client-portal";

const A1 = "agency_a1";
const A2 = "agency_a2";

const owner = (agencyId: string): TenantContext => ({ agencyId, role: MemberRole.OWNER });
const reviewer = (agencyId: string): TenantContext => ({ agencyId, role: MemberRole.REVIEWER });
const editor = (agencyId: string): TenantContext => ({ agencyId, role: MemberRole.EDITOR });

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
      (mocks.prisma as { $transaction: ReturnType<typeof vi.fn> }).$transaction.mockImplementation(
        async (ops: Promise<unknown>[]) => Promise.all(ops),
      );
    }
  }
});

// ============================================================
// agencies repo
// ============================================================

describe("agencies repo — tenant filter + role gate", () => {
  it("updateAgency scopes the write to ctx.agencyId", async () => {
    mocks.prisma.agency.updateMany.mockResolvedValue({ count: 1 });
    mocks.prisma.agency.findUniqueOrThrow.mockResolvedValue({
      id: A1,
      name: "Renamed",
    });

    await agenciesRepo.updateAgency(owner(A1), { name: "Renamed" });

    expect(mocks.prisma.agency.updateMany).toHaveBeenCalledWith({
      where: { id: A1 },
      data: { name: "Renamed" },
    });
  });

  it("updateAgency rejects EDITORs and REVIEWERs", async () => {
    await expect(agenciesRepo.updateAgency(editor(A1), { name: "Renamed" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(
      agenciesRepo.updateAgency(reviewer(A1), { name: "Renamed" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(mocks.prisma.agency.updateMany).not.toHaveBeenCalled();
  });

  it("updateAgency surfaces NotFoundError when the write touches zero rows", async () => {
    mocks.prisma.agency.updateMany.mockResolvedValue({ count: 0 });

    await expect(agenciesRepo.updateAgency(owner(A2), { name: "Renamed" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(mocks.prisma.agency.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  // --------------------------------------------------------------
  // Phase 2.5 — agency branding (logo + accent color)
  // --------------------------------------------------------------
  it("updateAgencyBranding scopes the write to ctx.agencyId + writes both fields", async () => {
    mocks.prisma.agency.updateMany.mockResolvedValue({ count: 1 });
    mocks.prisma.agency.findUniqueOrThrow.mockResolvedValue({
      id: A1,
      brandLogoUrl: "https://cdn.example.com/agency_a1/logo.png",
      brandAccentColor: "#3a5ba0",
    });

    await agenciesRepo.updateAgencyBranding(owner(A1), {
      brandLogoUrl: "https://cdn.example.com/agency_a1/logo.png",
      brandAccentColor: "#3a5ba0",
    });

    expect(mocks.prisma.agency.updateMany).toHaveBeenCalledWith({
      where: { id: A1 },
      data: {
        brandLogoUrl: "https://cdn.example.com/agency_a1/logo.png",
        brandAccentColor: "#3a5ba0",
      },
    });
  });

  it("updateAgencyBranding rejects EDITORs and REVIEWERs (branding is OWNER/ADMIN only)", async () => {
    await expect(
      agenciesRepo.updateAgencyBranding(editor(A1), {
        brandLogoUrl: null,
        brandAccentColor: null,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      agenciesRepo.updateAgencyBranding(reviewer(A1), {
        brandLogoUrl: null,
        brandAccentColor: null,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(mocks.prisma.agency.updateMany).not.toHaveBeenCalled();
  });

  it("updateAgencyBranding surfaces NotFoundError when the write touches zero rows", async () => {
    mocks.prisma.agency.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      agenciesRepo.updateAgencyBranding(owner(A2), {
        brandLogoUrl: null,
        brandAccentColor: null,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(mocks.prisma.agency.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it("updateAgencyBrandingInput normalises: empty → null, hex → lowercase, invalid hex rejected", () => {
    // Empty string collapses to null on the wire so a "clear" gesture lands as a real unset.
    const emptyToNull = agenciesRepo.updateAgencyBrandingInput.parse({
      brandLogoUrl: "",
      brandAccentColor: "",
    });
    expect(emptyToNull).toEqual({ brandLogoUrl: null, brandAccentColor: null });

    // Uppercase hex is lowercased so persisted values are canonical regardless of input.
    const lowered = agenciesRepo.updateAgencyBrandingInput.parse({
      brandLogoUrl: "https://cdn.example.com/logo.png",
      brandAccentColor: "#3A5BA0",
    });
    expect(lowered.brandAccentColor).toBe("#3a5ba0");

    // Bad hex (5 digits) trips the regex — the Zod parse throws.
    expect(() =>
      agenciesRepo.updateAgencyBrandingInput.parse({
        brandLogoUrl: null,
        brandAccentColor: "#3A5B0",
      }),
    ).toThrow();

    // Bad logo URL (not a URL) trips the .url() check.
    expect(() =>
      agenciesRepo.updateAgencyBrandingInput.parse({
        brandLogoUrl: "not-a-url",
        brandAccentColor: null,
      }),
    ).toThrow();
  });
});

// ============================================================
// clients repo
// ============================================================

describe("clients repo — tenant filter", () => {
  it("listClients filters by ctx.agencyId", async () => {
    mocks.prisma.client.findMany.mockResolvedValue([]);
    await clientsRepo.listClients(owner(A1));
    expect(mocks.prisma.client.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { agencyId: A1 } }),
    );

    await clientsRepo.listClients(owner(A2));
    expect(mocks.prisma.client.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { agencyId: A2 } }),
    );
  });

  it("getClient filters by id AND agencyId, throws NotFoundError on miss", async () => {
    mocks.prisma.client.findFirst.mockResolvedValueOnce({ id: "c1" });
    await clientsRepo.getClient(owner(A1), "c1");
    expect(mocks.prisma.client.findFirst).toHaveBeenCalledWith({
      where: { id: "c1", agencyId: A1 },
    });

    mocks.prisma.client.findFirst.mockResolvedValueOnce(null);
    await expect(clientsRepo.getClient(owner(A2), "c1")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("createClient writes agencyId from ctx, never from input", async () => {
    // Mocked agency lookup + plan-capacity check (plan = STUDIO, 0 used → OK).
    mocks.prisma.agency.findUnique.mockResolvedValue({ plan: "STUDIO" });
    mocks.prisma.client.count.mockResolvedValue(0);
    mocks.prisma.client.create.mockResolvedValue({ id: "new" });
    await clientsRepo.createClient(owner(A1), { name: "n" });
    const call = mocks.prisma.client.create.mock.calls[0]![0];
    expect(call.data.agencyId).toBe(A1);
    // Even if the caller smuggles agencyId, our code shouldn't read it
    // (the type system already prevents it; this is belt-and-braces).
    await clientsRepo.createClient(owner(A2), {
      name: "n",
      // @ts-expect-error — agencyId is not part of the input
      agencyId: "evil_agency",
    });
    const call2 = mocks.prisma.client.create.mock.calls[1]![0];
    expect(call2.data.agencyId).toBe(A2);
  });

  it("updateClient + deleteClient use updateMany/deleteMany with agency filter", async () => {
    mocks.prisma.client.updateMany.mockResolvedValue({ count: 1 });
    mocks.prisma.client.findUniqueOrThrow.mockResolvedValue({ id: "c1" });
    await clientsRepo.updateClient(owner(A1), "c1", { name: "x" });
    expect(mocks.prisma.client.updateMany).toHaveBeenCalledWith({
      where: { id: "c1", agencyId: A1 },
      data: { name: "x" },
    });

    mocks.prisma.client.deleteMany.mockResolvedValueOnce({ count: 1 });
    await clientsRepo.deleteClient(owner(A1), "c1");
    expect(mocks.prisma.client.deleteMany).toHaveBeenLastCalledWith({
      where: { id: "c1", agencyId: A1 },
    });

    // cross-tenant attempt — DB returns 0 rows affected → NotFoundError
    mocks.prisma.client.deleteMany.mockResolvedValueOnce({ count: 0 });
    await expect(clientsRepo.deleteClient(owner(A2), "c1")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("write mutations reject REVIEWER + EDITOR roles", async () => {
    await expect(clientsRepo.createClient(reviewer(A1), { name: "n" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(clientsRepo.updateClient(editor(A1), "c1", { name: "n" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});

// ============================================================
// episodes repo (nested tenancy via client.agencyId)
// ============================================================

describe("episodes repo — nested tenant filter", () => {
  it("listEpisodes joins through client.agencyId", async () => {
    mocks.prisma.episode.findMany.mockResolvedValue([]);
    await episodesRepo.listEpisodes(owner(A1));
    expect(mocks.prisma.episode.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { show: { client: { agencyId: A1 } } } }),
    );
  });

  it("listEpisodesForShow filters by clientId AND nested agencyId", async () => {
    mocks.prisma.episode.findMany.mockResolvedValue([]);
    await episodesRepo.listEpisodesForShow(owner(A1), "c1");
    expect(mocks.prisma.episode.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { showId: "c1", show: { client: { agencyId: A1 } } },
      }),
    );
  });

  it("getEpisode rejects cross-tenant access", async () => {
    mocks.prisma.episode.findFirst.mockResolvedValueOnce(null);
    await expect(episodesRepo.getEpisode(owner(A2), "ep1")).rejects.toBeInstanceOf(NotFoundError);
    expect(mocks.prisma.episode.findFirst).toHaveBeenCalledWith({
      where: { id: "ep1", show: { client: { agencyId: A2 } } },
    });
  });

  it("createEpisode verifies the target show belongs to ctx.agencyId via its client", async () => {
    // The show repo lookup goes through `show.client.agencyId`. Mock its
    // result to null so the cross-tenant case throws NotFoundError.
    (mocks.prisma as unknown as { show: { findFirst: ReturnType<typeof vi.fn> } }).show ??= {
      findFirst: vi.fn(),
    };
    (
      mocks.prisma as unknown as { show: { findFirst: ReturnType<typeof vi.fn> } }
    ).show.findFirst.mockResolvedValueOnce(null);
    await expect(
      episodesRepo.createEpisode(owner(A1), {
        showId: "show_in_other_tenant",
        title: "t",
        transcript: "x".repeat(500),
        source: TranscriptSource.PASTE,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    // No episode should have been created.
    expect(mocks.prisma.episode.create).not.toHaveBeenCalled();
  });
});

describe("episodes repo — listEpisodesFiltered", () => {
  it("anchors the where clause to ctx.agencyId via show.client", async () => {
    mocks.prisma.episode.findMany.mockResolvedValue([]);
    mocks.prisma.episode.count.mockResolvedValue(0);
    await episodesRepo.listEpisodesFiltered(owner(A1), { take: 25, skip: 0 });

    const findArgs = mocks.prisma.episode.findMany.mock.calls[0]![0];
    expect(findArgs.where).toEqual({
      show: { client: { agencyId: A1 } },
    });
    expect(findArgs.take).toBe(25);
    expect(findArgs.skip).toBe(0);
    expect(mocks.prisma.episode.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { show: { client: { agencyId: A1 } } },
      }),
    );
  });

  it("layers showId + clientId + status + search onto the tenant where", async () => {
    mocks.prisma.episode.findMany.mockResolvedValue([]);
    mocks.prisma.episode.count.mockResolvedValue(0);
    await episodesRepo.listEpisodesFiltered(owner(A1), {
      take: 10,
      skip: 20,
      showId: "show1",
      clientId: "client1",
      status: "READY" as never,
      search: "hires",
    });

    const findArgs = mocks.prisma.episode.findMany.mock.calls[0]![0];
    expect(findArgs.where).toEqual({
      show: {
        id: "show1",
        client: { agencyId: A1, id: "client1" },
      },
      status: "READY",
      title: { contains: "hires", mode: "insensitive" },
    });
    expect(findArgs.take).toBe(10);
    expect(findArgs.skip).toBe(20);
  });

  it("layers from/to onto where.createdAt with an end-of-day cap on `to`", async () => {
    mocks.prisma.episode.findMany.mockResolvedValue([]);
    mocks.prisma.episode.count.mockResolvedValue(0);
    const from = new Date("2026-06-01T00:00:00.000Z");
    const to = new Date("2026-06-24T00:00:00.000Z");
    await episodesRepo.listEpisodesFiltered(owner(A1), {
      take: 25,
      skip: 0,
      from,
      to,
    });

    const findArgs = mocks.prisma.episode.findMany.mock.calls[0]![0];
    expect(findArgs.where.createdAt).toBeDefined();
    expect(findArgs.where.createdAt.gte).toEqual(from);
    // `to` is widened to end-of-day so "through Jun 24" includes Jun 24 — the
    // exact UTC offset depends on the runner's TZ (endOfDay uses local time
    // intentionally so a US user's "Jun 24" means their local day, not UTC).
    // We just assert it's after `to` itself and still in the same UTC week.
    const lte = findArgs.where.createdAt.lte;
    expect(lte.getTime()).toBeGreaterThanOrEqual(to.getTime());
    expect(lte.getTime() - to.getTime()).toBeLessThan(36 * 60 * 60 * 1000);
  });

  it("omits the search predicate when the string is empty", async () => {
    mocks.prisma.episode.findMany.mockResolvedValue([]);
    mocks.prisma.episode.count.mockResolvedValue(0);
    await episodesRepo.listEpisodesFiltered(owner(A1), {
      take: 25,
      skip: 0,
      search: "",
    });

    const findArgs = mocks.prisma.episode.findMany.mock.calls[0]![0];
    expect(findArgs.where).not.toHaveProperty("title");
  });

  it("rejects callers without any role membership", async () => {
    // requireRole accepts OWNER/ADMIN/EDITOR/REVIEWER — a context with an
    // unknown role is the canonical reject case. There's no public way to
    // construct an empty-role ctx via the type, so we cast for the test.
    const noRole = { agencyId: A1, role: "SOMETHING_ELSE" } as unknown as TenantContext;
    await expect(
      episodesRepo.listEpisodesFiltered(noRole, { take: 25, skip: 0 }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(mocks.prisma.episode.findMany).not.toHaveBeenCalled();
  });
});

// ============================================================
// outputs repo (double-nested tenancy via episode.client.agencyId)
// ============================================================

describe("outputs repo — double-nested tenant filter", () => {
  it("listOutputsForEpisode filters via episode.client.agencyId and excludes superseded versions", async () => {
    mocks.prisma.generatedOutput.findMany.mockResolvedValue([]);
    await outputsRepo.listOutputsForEpisode(owner(A1), "ep1");
    expect(mocks.prisma.generatedOutput.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          episodeId: "ep1",
          supersededAt: null,
          episode: { show: { client: { agencyId: A1 } } },
        },
      }),
    );
  });

  it("updateOutputContent verifies tenant ownership, then writes content + accumulates editDistance", async () => {
    // First read fetches the prior content under the tenant filter.
    mocks.prisma.generatedOutput.findFirst.mockResolvedValueOnce({
      content: "old content",
    });
    mocks.prisma.generatedOutput.update.mockResolvedValue({ id: "o1" });

    await outputsRepo.updateOutputContent(owner(A1), "o1", "new content");

    expect(mocks.prisma.generatedOutput.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "o1", episode: { show: { client: { agencyId: A1 } } } },
      }),
    );
    // "old content" → "new content" differs by 4 substitutions (o↔n, l↔e, d↔w, " "↔" " same).
    // Actually: "old content" vs "new content" — compare char by char,
    // they share the trailing " content" (8 chars). Diff is "old" vs "new" → 3 subs.
    expect(mocks.prisma.generatedOutput.update).toHaveBeenCalledWith({
      where: { id: "o1" },
      data: { content: "new content", editDistance: { increment: 3 } },
    });
  });

  it("updateOutputContent rejects cross-tenant ids before writing", async () => {
    mocks.prisma.generatedOutput.findFirst.mockResolvedValueOnce(null);
    await expect(outputsRepo.updateOutputContent(owner(A2), "o1", "x")).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(mocks.prisma.generatedOutput.update).not.toHaveBeenCalled();
  });

  it("approveOutput rejects cross-tenant output ids", async () => {
    mocks.prisma.generatedOutput.findFirst.mockResolvedValueOnce(null);
    await expect(outputsRepo.approveOutput(owner(A1), "ofar", "m1")).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(mocks.prisma.generatedOutput.update).not.toHaveBeenCalled();
  });

  it("approveOutput writes APPROVED + sample inside the agency", async () => {
    mocks.prisma.generatedOutput.findFirst
      .mockResolvedValueOnce({ id: "o1", status: OutputStatus.READY }) // initial tenancy check
      .mockResolvedValueOnce({
        // inside createSampleFromOutput
        id: "o1",
        platform: Platform.LINKEDIN,
        content: "hello",
        episodeId: "ep1",
        episode: { showId: "c1" },
      });
    mocks.prisma.generatedOutput.update.mockResolvedValue({
      id: "o1",
      status: OutputStatus.APPROVED,
    });
    mocks.prisma.voiceSample.create.mockResolvedValue({ id: "vs1" });

    await outputsRepo.approveOutput(owner(A1), "o1", "m1");
    expect(mocks.prisma.generatedOutput.update).toHaveBeenCalledWith({
      where: { id: "o1" },
      data: expect.objectContaining({
        status: OutputStatus.APPROVED,
        approvedByMemberId: "m1",
      }),
    });
    expect(mocks.prisma.voiceSample.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        showId: "c1",
        platform: Platform.LINKEDIN,
        content: "hello",
        generatedOutputId: "o1",
        episodeId: "ep1",
      }),
    });
  });

  it("bulkApproveOutputsForEpisodes anchors the candidate query to ctx.agencyId and only touches READY/IN_REVIEW current versions", async () => {
    mocks.prisma.generatedOutput.findMany.mockResolvedValueOnce([
      {
        id: "o1",
        status: OutputStatus.READY,
        platform: Platform.LINKEDIN,
        content: "a",
        episodeId: "ep1",
        episode: { showId: "s1" },
      },
      {
        id: "o2",
        status: OutputStatus.IN_REVIEW,
        platform: Platform.TWITTER,
        content: "b",
        episodeId: "ep1",
        episode: { showId: "s1" },
      },
      {
        id: "o3",
        status: OutputStatus.READY,
        platform: Platform.BLOG,
        content: "c",
        episodeId: "ep2",
        episode: { showId: "s2" },
      },
    ]);
    mocks.prisma.generatedOutput.update.mockResolvedValue({ id: "x" });
    mocks.prisma.outputTransition.create.mockResolvedValue({ id: "t" });
    mocks.prisma.voiceSample.create.mockResolvedValue({ id: "vs" });

    const result = await outputsRepo.bulkApproveOutputsForEpisodes(owner(A1), ["ep1", "ep2"], "m1");

    expect(mocks.prisma.generatedOutput.findMany).toHaveBeenCalledWith({
      where: {
        episodeId: { in: ["ep1", "ep2"] },
        status: { in: [OutputStatus.READY, OutputStatus.IN_REVIEW] },
        supersededAt: null,
        episode: { show: { client: { agencyId: A1 } } },
      },
      select: expect.any(Object),
    });

    // 3 candidates × 3 writes each = 9 ops in the single transaction.
    const txCalls = mocks.prisma.$transaction.mock.calls;
    expect(txCalls.length).toBe(1);
    expect(txCalls[0]![0]).toHaveLength(9);

    expect(result).toEqual({
      totalApproved: 3,
      byEpisode: { ep1: 2, ep2: 1 },
    });
  });

  it("bulkApproveOutputsForEpisodes short-circuits on empty input + on no eligible candidates", async () => {
    // Empty input → no DB calls at all.
    let result = await outputsRepo.bulkApproveOutputsForEpisodes(owner(A1), [], "m1");
    expect(result).toEqual({ totalApproved: 0, byEpisode: {} });
    expect(mocks.prisma.generatedOutput.findMany).not.toHaveBeenCalled();

    // Non-empty input but no candidates returned → query runs, no txn.
    mocks.prisma.generatedOutput.findMany.mockResolvedValueOnce([]);
    result = await outputsRepo.bulkApproveOutputsForEpisodes(owner(A1), ["ep1"], "m1");
    expect(result).toEqual({ totalApproved: 0, byEpisode: {} });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("bulkApproveOutputsForEpisodes rejects EDITOR (approver-only)", async () => {
    await expect(
      outputsRepo.bulkApproveOutputsForEpisodes(editor(A1), ["ep1"], "m1"),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(mocks.prisma.generatedOutput.findMany).not.toHaveBeenCalled();
  });

  it("editors can update but only OWNER/ADMIN/REVIEWER can approve", async () => {
    mocks.prisma.generatedOutput.findFirst.mockResolvedValueOnce({ content: "y" });
    mocks.prisma.generatedOutput.update.mockResolvedValue({ id: "o1" });
    await expect(outputsRepo.updateOutputContent(editor(A1), "o1", "x")).resolves.toBeDefined();

    await expect(outputsRepo.approveOutput(editor(A1), "o1", "m1")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("markOutputRegenerating clones to a new row and supersedes the prior version", async () => {
    mocks.prisma.generatedOutput.findFirst.mockResolvedValueOnce({
      id: "o1",
      episodeId: "ep1",
      platform: Platform.TWITTER,
      content: "old content",
      version: 2,
      supersededAt: null,
    });
    mocks.prisma.generatedOutput.update.mockResolvedValue({ id: "o1" });
    mocks.prisma.generatedOutput.create.mockResolvedValue({
      id: "o1-v3",
      version: 3,
      status: OutputStatus.GENERATING,
      content: "old content",
      previousVersionId: "o1",
    });

    const result = await outputsRepo.markOutputRegenerating(owner(A1), "o1", "make it shorter");

    // Tenancy check on the prior row
    expect(mocks.prisma.generatedOutput.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "o1", episode: { show: { client: { agencyId: A1 } } } },
      }),
    );
    // Prior row was stamped supersededAt
    expect(mocks.prisma.generatedOutput.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "o1" },
        data: expect.objectContaining({ supersededAt: expect.any(Date) }),
      }),
    );
    // New row inherits slot identity (episodeId + platform), version+1,
    // GENERATING status, instruction stamped, and previousVersionId backref.
    expect(mocks.prisma.generatedOutput.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        episodeId: "ep1",
        platform: Platform.TWITTER,
        content: "old content",
        status: OutputStatus.GENERATING,
        version: 3,
        lastInstruction: "make it shorter",
        previousVersionId: "o1",
      }),
    });
    // The new row is returned so the caller can pass its id to Inngest.
    expect(result.id).toBe("o1-v3");
  });

  it("markOutputRegenerating refuses to act on an already-superseded row", async () => {
    mocks.prisma.generatedOutput.findFirst.mockResolvedValueOnce({
      id: "old",
      episodeId: "ep1",
      platform: Platform.TWITTER,
      content: "",
      version: 1,
      supersededAt: new Date(),
    });
    await expect(outputsRepo.markOutputRegenerating(owner(A1), "old")).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(mocks.prisma.generatedOutput.create).not.toHaveBeenCalled();
  });

  it("listVersionsForOutput filters all versions in the same slot by agency", async () => {
    mocks.prisma.generatedOutput.findFirst.mockResolvedValueOnce({
      episodeId: "ep1",
      platform: Platform.LINKEDIN,
    });
    mocks.prisma.generatedOutput.findMany.mockResolvedValueOnce([]);
    await outputsRepo.listVersionsForOutput(owner(A1), "o1");
    expect(mocks.prisma.generatedOutput.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          episodeId: "ep1",
          platform: Platform.LINKEDIN,
          episode: { show: { client: { agencyId: A1 } } },
        },
        orderBy: { version: "desc" },
      }),
    );
  });

  it("approveOutput writes an OutputTransition with the prior status", async () => {
    mocks.prisma.generatedOutput.findFirst
      .mockResolvedValueOnce({ id: "o1", status: OutputStatus.IN_REVIEW })
      .mockResolvedValueOnce({
        id: "o1",
        platform: Platform.TWITTER,
        content: "x",
        episodeId: "ep1",
        episode: { showId: "c1" },
      });
    mocks.prisma.generatedOutput.update.mockResolvedValue({ id: "o1" });
    mocks.prisma.outputTransition.create.mockResolvedValue({ id: "t1" });
    mocks.prisma.voiceSample.create.mockResolvedValue({ id: "vs1" });

    await outputsRepo.approveOutput(owner(A1), "o1", "m1");

    expect(mocks.prisma.outputTransition.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        agencyId: A1,
        outputId: "o1",
        fromStatus: OutputStatus.IN_REVIEW,
        toStatus: OutputStatus.APPROVED,
        byMemberId: "m1",
      }),
    });
  });
});

// ============================================================
// status-flow helpers (Phase 2.3)
// ============================================================

describe("outputs repo — status flow + role gating", () => {
  it("requestReviewOutput only fires from READY and logs the transition", async () => {
    mocks.prisma.generatedOutput.findFirst.mockResolvedValueOnce({
      id: "o1",
      status: OutputStatus.READY,
    });
    mocks.prisma.generatedOutput.update.mockResolvedValue({
      id: "o1",
      status: OutputStatus.IN_REVIEW,
    });
    mocks.prisma.outputTransition.create.mockResolvedValue({ id: "t1" });

    await outputsRepo.requestReviewOutput(editor(A1), "o1", "m1", "second pass");

    expect(mocks.prisma.generatedOutput.update).toHaveBeenCalledWith({
      where: { id: "o1" },
      data: { status: OutputStatus.IN_REVIEW },
    });
    expect(mocks.prisma.outputTransition.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        agencyId: A1,
        outputId: "o1",
        fromStatus: OutputStatus.READY,
        toStatus: OutputStatus.IN_REVIEW,
        byMemberId: "m1",
        note: "second pass",
      }),
    });
  });

  it("requestReviewOutput refuses to flip from non-READY status", async () => {
    mocks.prisma.generatedOutput.findFirst.mockResolvedValueOnce({
      id: "o1",
      status: OutputStatus.APPROVED,
    });
    await expect(outputsRepo.requestReviewOutput(editor(A1), "o1", "m1")).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(mocks.prisma.generatedOutput.update).not.toHaveBeenCalled();
  });

  it("rejectOutputForRevision is approver-only and flips IN_REVIEW → READY", async () => {
    // Editor can't reject.
    await expect(
      outputsRepo.rejectOutputForRevision(editor(A1), "o1", "m1"),
    ).rejects.toBeInstanceOf(ForbiddenError);

    mocks.prisma.generatedOutput.findFirst.mockResolvedValueOnce({
      id: "o1",
      status: OutputStatus.IN_REVIEW,
    });
    mocks.prisma.generatedOutput.update.mockResolvedValue({
      id: "o1",
      status: OutputStatus.READY,
    });
    mocks.prisma.outputTransition.create.mockResolvedValue({ id: "t1" });

    await outputsRepo.rejectOutputForRevision(reviewer(A1), "o1", "m1", "make it punchier");

    expect(mocks.prisma.generatedOutput.update).toHaveBeenCalledWith({
      where: { id: "o1" },
      data: { status: OutputStatus.READY },
    });
    expect(mocks.prisma.outputTransition.create).toHaveBeenLastCalledWith({
      data: expect.objectContaining({
        agencyId: A1,
        outputId: "o1",
        fromStatus: OutputStatus.IN_REVIEW,
        toStatus: OutputStatus.READY,
        byMemberId: "m1",
        note: "make it punchier",
      }),
    });
  });

  it("rejectOutputForRevision refuses to flip from non-IN_REVIEW status", async () => {
    mocks.prisma.generatedOutput.findFirst.mockResolvedValueOnce({
      id: "o1",
      status: OutputStatus.READY,
    });
    await expect(
      outputsRepo.rejectOutputForRevision(reviewer(A1), "o1", "m1"),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

// ============================================================
// transitions repo — activity feed reads (Phase 2.3)
// ============================================================

// ============================================================
// invites repo — homegrown invite flow (Phase 1.0 follow-up)
// ============================================================

describe("invites repo — tenant filter", () => {
  it("listPendingInvites filters by agency + lazily expires stale rows", async () => {
    mocks.prisma.memberInvite.updateMany.mockResolvedValue({ count: 0 });
    mocks.prisma.memberInvite.findMany.mockResolvedValue([]);

    await invitesRepo.listPendingInvites(owner(A1));

    // First, the lazy-expire sweep.
    expect(mocks.prisma.memberInvite.updateMany).toHaveBeenCalledWith({
      where: {
        agencyId: A1,
        status: InviteStatus.PENDING,
        expiresAt: { lt: expect.any(Date) },
      },
      data: { status: InviteStatus.EXPIRED },
    });
    // Then, the read.
    expect(mocks.prisma.memberInvite.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { agencyId: A1, status: InviteStatus.PENDING },
        orderBy: { createdAt: "desc" },
      }),
    );
  });

  it("listPendingInvites refuses EDITOR role", async () => {
    await expect(invitesRepo.listPendingInvites(editor(A1))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("createInvite normalises email, fills 14-day expiry, refuses duplicates", async () => {
    // No active pending invite for the same email.
    mocks.prisma.memberInvite.findFirst.mockResolvedValueOnce(null);
    // No existing member with the same email.
    mocks.prisma.member.findFirst.mockResolvedValueOnce(null);
    mocks.prisma.memberInvite.create.mockResolvedValue({ id: "i1" });

    await invitesRepo.createInvite(owner(A1), "m_owner", {
      email: " New.User@Example.COM ",
      role: MemberRole.EDITOR,
    });

    expect(mocks.prisma.memberInvite.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        agencyId: A1,
        email: "new.user@example.com",
        role: MemberRole.EDITOR,
        invitedByMemberId: "m_owner",
        expiresAt: expect.any(Date),
      }),
    });
    // Expiry roughly 14 days out (well over 13 days, well under 15).
    const call = mocks.prisma.memberInvite.create.mock.calls[0]![0];
    const ttlMs = call.data.expiresAt.getTime() - Date.now();
    expect(ttlMs).toBeGreaterThan(13 * 86_400_000);
    expect(ttlMs).toBeLessThan(15 * 86_400_000);
  });

  it("createInvite refuses when a pending invite already exists for the email", async () => {
    mocks.prisma.memberInvite.findFirst.mockResolvedValueOnce({ id: "existing" });
    await expect(
      invitesRepo.createInvite(owner(A1), "m1", {
        email: "dup@example.com",
        role: MemberRole.EDITOR,
      }),
    ).rejects.toThrowError(/already has a pending invite/);
  });

  it("createInvite refuses when the email is already a member of the agency", async () => {
    mocks.prisma.memberInvite.findFirst.mockResolvedValueOnce(null);
    mocks.prisma.member.findFirst.mockResolvedValueOnce({ id: "m_existing" });
    await expect(
      invitesRepo.createInvite(owner(A1), "m1", {
        email: "already@member.com",
        role: MemberRole.EDITOR,
      }),
    ).rejects.toThrowError(/already a member/);
  });

  it("createInvite refuses EDITOR role (admin-only action)", async () => {
    await expect(
      invitesRepo.createInvite(editor(A1), "m1", {
        email: "x@example.com",
        role: MemberRole.EDITOR,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("revokeInvite scopes by agencyId + only flips PENDING rows", async () => {
    mocks.prisma.memberInvite.updateMany.mockResolvedValueOnce({ count: 1 });
    await invitesRepo.revokeInvite(owner(A1), "i1");
    expect(mocks.prisma.memberInvite.updateMany).toHaveBeenLastCalledWith({
      where: { id: "i1", agencyId: A1, status: InviteStatus.PENDING },
      data: { status: InviteStatus.REVOKED },
    });

    // Cross-tenant attempt — 0 rows affected → NotFoundError.
    mocks.prisma.memberInvite.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(invitesRepo.revokeInvite(owner(A2), "i1")).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("transitions repo — tenant filter", () => {
  it("listRecentTransitions filters by ctx.agencyId, time-ordered", async () => {
    mocks.prisma.outputTransition.findMany.mockResolvedValue([]);
    await transitionsRepo.listRecentTransitions(owner(A1), 5);
    expect(mocks.prisma.outputTransition.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { agencyId: A1 },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
    );

    await transitionsRepo.listRecentTransitions(owner(A2));
    expect(mocks.prisma.outputTransition.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { agencyId: A2 } }),
    );
  });
});

// ============================================================
// member-transitions repo (Phase 2.4 team activity log)
// ============================================================

describe("member-transitions repo — tenant filter", () => {
  it("listMemberTransitions filters by ctx.agencyId, time-ordered, joins actor/target/invite", async () => {
    mocks.prisma.memberTransition.findMany.mockResolvedValue([]);
    await memberTransitionsRepo.listMemberTransitions(owner(A1), 10);
    const args = mocks.prisma.memberTransition.findMany.mock.calls[0]![0];
    expect(args.where).toEqual({ agencyId: A1 });
    expect(args.orderBy).toEqual({ createdAt: "desc" });
    expect(args.take).toBe(10);
    expect(args.include).toEqual({
      actor: { select: { id: true, name: true, email: true } },
      target: { select: { id: true, name: true, email: true } },
      invite: { select: { email: true } },
    });

    await memberTransitionsRepo.listMemberTransitions(owner(A2), 5);
    expect(mocks.prisma.memberTransition.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { agencyId: A2 }, take: 5 }),
    );
  });

  it("listMemberTransitions rejects callers without any role membership", async () => {
    const noRole = { agencyId: A1, role: "SOMETHING_ELSE" } as unknown as TenantContext;
    await expect(memberTransitionsRepo.listMemberTransitions(noRole)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(mocks.prisma.memberTransition.findMany).not.toHaveBeenCalled();
  });

  it("recordMemberTransition stamps agencyId from the explicit arg, not the input", async () => {
    mocks.prisma.memberTransition.create.mockResolvedValue({ id: "t1" });
    await memberTransitionsRepo.recordMemberTransition(A1, {
      kind: "ROLE_CHANGED",
      byMemberId: "m_actor",
      targetMemberId: "m_target",
      fromRole: MemberRole.EDITOR,
      toRole: MemberRole.ADMIN,
    });
    expect(mocks.prisma.memberTransition.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        agencyId: A1,
        kind: "ROLE_CHANGED",
        byMemberId: "m_actor",
        targetMemberId: "m_target",
        fromRole: MemberRole.EDITOR,
        toRole: MemberRole.ADMIN,
      }),
    });
  });
});

// ============================================================
// client-billing repo (Phase 2.13.2)
// ============================================================

describe("client-billing repo — tenant filter + role gate", () => {
  it("getClientBillingProfile anchors the read to ctx.agencyId via the parent client", async () => {
    mocks.prisma.clientBillingProfile.findFirst.mockResolvedValue(null);
    await clientBillingRepo.getClientBillingProfile(owner(A1), "c1");
    expect(mocks.prisma.clientBillingProfile.findFirst).toHaveBeenCalledWith({
      where: {
        clientId: "c1",
        client: { agencyId: A1 },
      },
    });
  });

  it("getClientBillingProfile rejects EDITOR + REVIEWER (billing data is sensitive)", async () => {
    await expect(
      clientBillingRepo.getClientBillingProfile(editor(A1), "c1"),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      clientBillingRepo.getClientBillingProfile(reviewer(A1), "c1"),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(mocks.prisma.clientBillingProfile.findFirst).not.toHaveBeenCalled();
  });

  it("upsertClientBillingProfile verifies the parent client belongs to ctx.agencyId before writing", async () => {
    // Cross-tenant client id → findFirst returns null → NotFoundError, no upsert.
    mocks.prisma.client.findFirst.mockResolvedValueOnce(null);
    await expect(
      clientBillingRepo.upsertClientBillingProfile(owner(A1), "c_other", {
        billingCycle: "MONTHLY" as never,
        currency: "USD",
        status: "ACTIVE" as never,
      } as never),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(mocks.prisma.clientBillingProfile.upsert).not.toHaveBeenCalled();
  });

  it("upsertClientBillingProfile writes via upsert keyed on clientId with both retainer and rate normalized", async () => {
    mocks.prisma.client.findFirst.mockResolvedValueOnce({ id: "c1" });
    mocks.prisma.clientBillingProfile.upsert.mockResolvedValueOnce({
      id: "p1",
      clientId: "c1",
    });

    await clientBillingRepo.upsertClientBillingProfile(owner(A1), "c1", {
      billingContactName: "Avery",
      billingContactEmail: undefined,
      retainerCents: 250_000,
      ratePerEpisodeCents: undefined,
      billingCycle: "MONTHLY" as never,
      currency: "usd",
      contractStartDate: undefined,
      contractRenewalDate: undefined,
      status: "ACTIVE" as never,
      paymentLinkUrl: undefined,
      internalNotes: undefined,
    } as never);

    const args = mocks.prisma.clientBillingProfile.upsert.mock.calls[0]![0];
    expect(args.where).toEqual({ clientId: "c1" });
    expect(args.create.clientId).toBe("c1");
    expect(args.create.retainerCents).toBe(250_000);
    expect(args.create.ratePerEpisodeCents).toBeNull();
    // Currency input was lowercase — repo upper-cases on the way in.
    expect(args.create.currency).toBe("USD");
    // Update branch carries the same normalized values (Prisma's upsert
    // needs both branches; missing them on update would silently no-op).
    expect(args.update.retainerCents).toBe(250_000);
    expect(args.update.ratePerEpisodeCents).toBeNull();
  });

  it("upsertClientBillingProfile rejects both retainer AND rate set (mutually exclusive)", async () => {
    mocks.prisma.client.findFirst.mockResolvedValueOnce({ id: "c1" });

    await expect(
      clientBillingRepo.upsertClientBillingProfile(owner(A1), "c1", {
        retainerCents: 100_000,
        ratePerEpisodeCents: 5_000,
        billingCycle: "MONTHLY" as never,
        currency: "USD",
        status: "ACTIVE" as never,
      } as never),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(mocks.prisma.clientBillingProfile.upsert).not.toHaveBeenCalled();
  });

  it("upsertClientBillingProfile role-gates EDITOR + REVIEWER before any DB lookup", async () => {
    await expect(
      clientBillingRepo.upsertClientBillingProfile(editor(A1), "c1", {
        billingCycle: "MONTHLY" as never,
        currency: "USD",
        status: "ACTIVE" as never,
      } as never),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      clientBillingRepo.upsertClientBillingProfile(reviewer(A1), "c1", {
        billingCycle: "MONTHLY" as never,
        currency: "USD",
        status: "ACTIVE" as never,
      } as never),
    ).rejects.toBeInstanceOf(ForbiddenError);
    // Neither call should have hit the parent-client lookup.
    expect(mocks.prisma.client.findFirst).not.toHaveBeenCalled();
  });
});

// ============================================================
// deliverables repo (Phase 2.13.3)
// ============================================================

describe("deliverables repo — tenant filter + filter layering", () => {
  it("listDeliverablesForClient verifies the parent client belongs to the agency before querying outputs", async () => {
    // Cross-tenant clientId → assertClientInTenant returns null → NotFoundError
    mocks.prisma.client.findFirst.mockResolvedValueOnce(null);
    await expect(
      deliverablesRepo.listDeliverablesForClient(owner(A1), "c_other", {
        take: 25,
        skip: 0,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(mocks.prisma.generatedOutput.findMany).not.toHaveBeenCalled();
    expect(mocks.prisma.generatedOutput.count).not.toHaveBeenCalled();
  });

  it("listDeliverablesForClient anchors the where clause to ctx.agencyId + clientId, supersededAt:null", async () => {
    mocks.prisma.client.findFirst.mockResolvedValueOnce({ id: "c1" });
    mocks.prisma.generatedOutput.findMany.mockResolvedValueOnce([]);
    mocks.prisma.generatedOutput.count.mockResolvedValueOnce(0);

    await deliverablesRepo.listDeliverablesForClient(owner(A1), "c1", {
      take: 25,
      skip: 0,
    });

    const findArgs = mocks.prisma.generatedOutput.findMany.mock.calls[0]![0];
    expect(findArgs.where).toEqual({
      supersededAt: null,
      episode: {
        show: {
          client: { id: "c1", agencyId: A1 },
        },
      },
    });
    expect(findArgs.take).toBe(25);
    expect(findArgs.skip).toBe(0);
    expect(findArgs.orderBy).toEqual({ createdAt: "desc" });
    expect(findArgs.include).toEqual({
      episode: { select: { id: true, title: true, recordedAt: true } },
      approvedByMember: { select: { id: true, name: true, email: true } },
    });
  });

  it("listDeliverablesForClient layers platform + status + date range onto the where clause", async () => {
    mocks.prisma.client.findFirst.mockResolvedValueOnce({ id: "c1" });
    mocks.prisma.generatedOutput.findMany.mockResolvedValueOnce([]);
    mocks.prisma.generatedOutput.count.mockResolvedValueOnce(0);

    const from = new Date("2026-06-01T00:00:00.000Z");
    const to = new Date("2026-06-24T00:00:00.000Z");
    await deliverablesRepo.listDeliverablesForClient(owner(A1), "c1", {
      take: 25,
      skip: 0,
      platform: Platform.LINKEDIN,
      status: OutputStatus.APPROVED,
      from,
      to,
    });

    const findArgs = mocks.prisma.generatedOutput.findMany.mock.calls[0]![0];
    expect(findArgs.where.platform).toBe(Platform.LINKEDIN);
    expect(findArgs.where.status).toBe(OutputStatus.APPROVED);
    expect(findArgs.where.createdAt.gte).toEqual(from);
    // end-of-day extension on `to` so "through Jun 24" includes Jun 24.
    const lte = findArgs.where.createdAt.lte;
    expect(lte.getTime()).toBeGreaterThanOrEqual(to.getTime());
    expect(lte.getTime() - to.getTime()).toBeLessThan(36 * 60 * 60 * 1000);
  });

  it("listDeliverablesForClient is open to REVIEWER (read-only)", async () => {
    mocks.prisma.client.findFirst.mockResolvedValueOnce({ id: "c1" });
    mocks.prisma.generatedOutput.findMany.mockResolvedValueOnce([]);
    mocks.prisma.generatedOutput.count.mockResolvedValueOnce(0);
    await expect(
      deliverablesRepo.listDeliverablesForClient(reviewer(A1), "c1", {
        take: 25,
        skip: 0,
      }),
    ).resolves.toEqual({ rows: [], total: 0 });
  });

  it("listDeliverablesForClient rejects callers without a recognized role", async () => {
    const noRole = { agencyId: A1, role: "SOMETHING_ELSE" } as unknown as TenantContext;
    await expect(
      deliverablesRepo.listDeliverablesForClient(noRole, "c1", {
        take: 25,
        skip: 0,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(mocks.prisma.client.findFirst).not.toHaveBeenCalled();
  });

  it("streamDeliverablesForClient mirrors the list query without pagination", async () => {
    mocks.prisma.client.findFirst.mockResolvedValueOnce({ id: "c1" });
    mocks.prisma.generatedOutput.findMany.mockResolvedValueOnce([]);
    await deliverablesRepo.streamDeliverablesForClient(owner(A1), "c1", {
      platform: Platform.BLOG,
    });
    const args = mocks.prisma.generatedOutput.findMany.mock.calls[0]![0];
    expect(args.where.episode.show.client).toEqual({ id: "c1", agencyId: A1 });
    expect(args.where.platform).toBe(Platform.BLOG);
    expect(args.take).toBeUndefined();
    expect(args.skip).toBeUndefined();
  });
});

// ============================================================
// client-statements repo (Phase 2.13.4)
// ============================================================

describe("client-statements repo — tenant filter + aggregate shape", () => {
  it("listClientStatements anchors where to clientId + agencyId, time-orders newest first", async () => {
    mocks.prisma.client.findFirst.mockResolvedValueOnce({ id: "c1" });
    mocks.prisma.clientStatement.findMany.mockResolvedValueOnce([]);
    mocks.prisma.clientStatement.count.mockResolvedValueOnce(0);

    await clientStatementsRepo.listClientStatements(owner(A1), "c1", {
      take: 25,
      skip: 0,
    });
    const args = mocks.prisma.clientStatement.findMany.mock.calls[0]![0];
    expect(args.where).toEqual({
      clientId: "c1",
      client: { agencyId: A1 },
    });
    expect(args.orderBy).toEqual([{ periodStart: "desc" }, { generatedAt: "desc" }]);
  });

  it("listClientStatements rejects EDITOR + REVIEWER (billing material)", async () => {
    await expect(
      clientStatementsRepo.listClientStatements(editor(A1), "c1", {
        take: 25,
        skip: 0,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      clientStatementsRepo.listClientStatements(reviewer(A1), "c1", {
        take: 25,
        skip: 0,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(mocks.prisma.client.findFirst).not.toHaveBeenCalled();
  });

  it("getClientStatement anchors to ctx.agencyId via the joined client", async () => {
    mocks.prisma.clientStatement.findFirst.mockResolvedValueOnce({
      id: "s1",
      client: { id: "c1", name: "X", agencyId: A1 },
    });
    await clientStatementsRepo.getClientStatement(owner(A1), "s1");
    expect(mocks.prisma.clientStatement.findFirst).toHaveBeenCalledWith({
      where: {
        id: "s1",
        client: { agencyId: A1 },
      },
      include: expect.objectContaining({
        client: { select: { id: true, name: true, agencyId: true } },
        generatedByMember: { select: { id: true, name: true, email: true } },
      }),
    });
  });

  it("getClientStatement surfaces NotFoundError when the row doesn't exist (or wrong tenant)", async () => {
    mocks.prisma.clientStatement.findFirst.mockResolvedValueOnce(null);
    await expect(
      clientStatementsRepo.getClientStatement(owner(A1), "s_other"),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("generateClientStatement runs four parallel aggregations and persists the snapshot row", async () => {
    mocks.prisma.client.findFirst.mockResolvedValueOnce({ id: "c1" });
    // Four counts + one aggregate, in the order computeAggregates fires
    // them (episode, output, approved, eligible).
    mocks.prisma.episode.count.mockResolvedValueOnce(7);
    mocks.prisma.generatedOutput.count
      .mockResolvedValueOnce(49) // outputCount
      .mockResolvedValueOnce(30) // approvedCount
      .mockResolvedValueOnce(40); // eligibleForApproval (approved + ready + in_review)
    mocks.prisma.usageLog.aggregate.mockResolvedValueOnce({
      _sum: { costCents: 12345 },
    });
    mocks.prisma.clientStatement.create.mockResolvedValueOnce({
      id: "s_new",
    });

    const periodStart = new Date("2026-06-01T00:00:00.000Z");
    const periodEnd = new Date("2026-06-30T00:00:00.000Z");
    await clientStatementsRepo.generateClientStatement(owner(A1), "c1", "m_actor", {
      periodStart,
      periodEnd,
    });

    // Verify the persisted row's totals + approval rate math.
    const createArgs = mocks.prisma.clientStatement.create.mock.calls[0]![0];
    expect(createArgs.data.clientId).toBe("c1");
    expect(createArgs.data.episodeCount).toBe(7);
    expect(createArgs.data.outputCount).toBe(49);
    expect(createArgs.data.approvedCount).toBe(30);
    // approved / eligible = 30 / 40 = 0.75 → 75%
    expect(createArgs.data.approvalRatePct).toBe(75);
    expect(createArgs.data.costCents).toBe(12345);
    expect(createArgs.data.generatedByMemberId).toBe("m_actor");
    // periodEnd is widened to end-of-day local time.
    expect(createArgs.data.periodEnd.getTime()).toBeGreaterThanOrEqual(periodEnd.getTime());
  });

  it("generateClientStatement rejects cross-tenant client + cap-rejects EDITOR before any aggregate", async () => {
    // Cross-tenant client → NotFoundError, no counts.
    mocks.prisma.client.findFirst.mockResolvedValueOnce(null);
    await expect(
      clientStatementsRepo.generateClientStatement(owner(A1), "c_other", "m1", {
        periodStart: new Date(),
        periodEnd: new Date(),
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(mocks.prisma.episode.count).not.toHaveBeenCalled();

    // EDITOR → ForbiddenError before the parent-client lookup.
    await expect(
      clientStatementsRepo.generateClientStatement(editor(A1), "c1", "m1", {
        periodStart: new Date(),
        periodEnd: new Date(),
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("generateClientStatement handles zero-eligible (no outputs) without dividing by zero", async () => {
    mocks.prisma.client.findFirst.mockResolvedValueOnce({ id: "c1" });
    mocks.prisma.episode.count.mockResolvedValueOnce(0);
    mocks.prisma.generatedOutput.count
      .mockResolvedValueOnce(0) // outputCount
      .mockResolvedValueOnce(0) // approvedCount
      .mockResolvedValueOnce(0); // eligibleForApproval
    mocks.prisma.usageLog.aggregate.mockResolvedValueOnce({
      _sum: { costCents: null },
    });
    mocks.prisma.clientStatement.create.mockResolvedValueOnce({ id: "s_new" });

    await clientStatementsRepo.generateClientStatement(owner(A1), "c1", "m1", {
      periodStart: new Date("2026-06-01"),
      periodEnd: new Date("2026-06-30"),
    });
    const createArgs = mocks.prisma.clientStatement.create.mock.calls[0]![0];
    expect(createArgs.data.approvalRatePct).toBe(0);
    expect(createArgs.data.costCents).toBe(0); // null _sum coalesces to 0
  });
});

// ============================================================
// client-cost repo (Phase 2.13.5)
// ============================================================

describe("client-cost repo — tenant filter + role gate", () => {
  it("costForClient anchors UsageLog + Episode queries to ctx.agencyId via the nested join", async () => {
    mocks.prisma.client.findFirst.mockResolvedValueOnce({ id: "c1" });
    mocks.prisma.usageLog.aggregate.mockResolvedValueOnce({
      _sum: { costCents: 4200 },
    });
    mocks.prisma.episode.count.mockResolvedValueOnce(6);

    const result = await clientCostRepo.costForClient(owner(A1), "c1", {
      from: new Date("2026-06-01"),
      to: new Date("2026-07-01"),
    });

    const usageArgs = mocks.prisma.usageLog.aggregate.mock.calls[0]![0];
    expect(usageArgs.where.agencyId).toBe(A1);
    expect(usageArgs.where.episode.show.client).toEqual({
      id: "c1",
      agencyId: A1,
    });
    expect(usageArgs.where.createdAt.gte).toEqual(new Date("2026-06-01"));
    expect(usageArgs.where.createdAt.lt).toEqual(new Date("2026-07-01"));

    const episodeArgs = mocks.prisma.episode.count.mock.calls[0]![0];
    expect(episodeArgs.where.show.client).toEqual({ id: "c1", agencyId: A1 });

    expect(result).toEqual({ costCents: 4200, episodeCountInWindow: 6 });
  });

  it("costForClient rejects EDITOR + REVIEWER (financial data)", async () => {
    await expect(clientCostRepo.costForClient(editor(A1), "c1")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(clientCostRepo.costForClient(reviewer(A1), "c1")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(mocks.prisma.client.findFirst).not.toHaveBeenCalled();
  });

  it("costForClient rejects cross-tenant clientId before aggregating", async () => {
    mocks.prisma.client.findFirst.mockResolvedValueOnce(null);
    await expect(clientCostRepo.costForClient(owner(A1), "c_other")).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(mocks.prisma.usageLog.aggregate).not.toHaveBeenCalled();
    expect(mocks.prisma.episode.count).not.toHaveBeenCalled();
  });

  it("costForClient handles null _sum (no usage in window) → 0", async () => {
    mocks.prisma.client.findFirst.mockResolvedValueOnce({ id: "c1" });
    mocks.prisma.usageLog.aggregate.mockResolvedValueOnce({
      _sum: { costCents: null },
    });
    mocks.prisma.episode.count.mockResolvedValueOnce(0);
    await expect(clientCostRepo.costForClient(owner(A1), "c1")).resolves.toEqual({
      costCents: 0,
      episodeCountInWindow: 0,
    });
  });

  it("costByClient pivots usage + episode counts per client and computes margin from retainer", async () => {
    // Three clients in the agency: one with a retainer, one with a rate +
    // episode count, one with no billing profile.
    mocks.prisma.client.findMany.mockResolvedValueOnce([
      {
        id: "c1",
        name: "Acme",
        billingProfile: { retainerCents: 100_000, ratePerEpisodeCents: null },
      },
      {
        id: "c2",
        name: "Bravo",
        billingProfile: { retainerCents: null, ratePerEpisodeCents: 5_000 },
      },
      {
        id: "c3",
        name: "Charlie",
        billingProfile: null,
      },
    ]);
    mocks.prisma.usageLog.findMany.mockResolvedValueOnce([
      { costCents: 1200, episode: { show: { clientId: "c1" } } },
      { costCents: 800, episode: { show: { clientId: "c2" } } },
      { costCents: 400, episode: { show: { clientId: "c2" } } },
      // c3 has no usage rows — still appears in the rollup with 0 cost.
    ]);
    mocks.prisma.episode.groupBy.mockResolvedValueOnce([
      { showId: "s1", _count: { _all: 2 } }, // → c1
      { showId: "s2", _count: { _all: 4 } }, // → c2
    ]);
    mocks.prisma.show.findMany.mockResolvedValueOnce([
      { id: "s1", clientId: "c1" },
      { id: "s2", clientId: "c2" },
    ]);

    const rows = await clientCostRepo.costByClient(owner(A1));
    const byId = new Map(rows.map((r) => [r.clientId, r]));

    expect(byId.get("c1")).toMatchObject({
      costCents: 1200,
      episodeCountInWindow: 2,
      retainerCents: 100_000,
      revenueCents: 100_000,
      marginCents: 100_000 - 1200,
    });
    expect(byId.get("c2")).toMatchObject({
      costCents: 1200, // 800 + 400
      episodeCountInWindow: 4,
      ratePerEpisodeCents: 5_000,
      revenueCents: 5_000 * 4,
      marginCents: 5_000 * 4 - 1200,
    });
    // No billing profile → revenue and margin null, cost still 0.
    expect(byId.get("c3")).toMatchObject({
      costCents: 0,
      episodeCountInWindow: 0,
      retainerCents: null,
      ratePerEpisodeCents: null,
      revenueCents: null,
      marginCents: null,
    });
  });

  it("costByClient anchors every Prisma query to ctx.agencyId", async () => {
    mocks.prisma.client.findMany.mockResolvedValueOnce([
      { id: "c1", name: "Acme", billingProfile: null },
    ]);
    mocks.prisma.usageLog.findMany.mockResolvedValueOnce([]);
    mocks.prisma.episode.groupBy.mockResolvedValueOnce([]);
    mocks.prisma.show.findMany.mockResolvedValueOnce([]);

    await clientCostRepo.costByClient(owner(A1));

    expect(mocks.prisma.client.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { agencyId: A1 } }),
    );
    const usageArgs = mocks.prisma.usageLog.findMany.mock.calls[0]![0];
    expect(usageArgs.where.agencyId).toBe(A1);
    expect(usageArgs.where.episode.show.client.agencyId).toBe(A1);
    const episodeArgs = mocks.prisma.episode.groupBy.mock.calls[0]![0];
    expect(episodeArgs.where.show.client.agencyId).toBe(A1);
    const showArgs = mocks.prisma.show.findMany.mock.calls[0]![0];
    expect(showArgs.where.client.agencyId).toBe(A1);
  });

  it("costByClient short-circuits on zero clients", async () => {
    mocks.prisma.client.findMany.mockResolvedValueOnce([]);
    await expect(clientCostRepo.costByClient(owner(A1))).resolves.toEqual([]);
    expect(mocks.prisma.usageLog.findMany).not.toHaveBeenCalled();
    expect(mocks.prisma.episode.groupBy).not.toHaveBeenCalled();
  });

  it("costByClient rejects EDITOR + REVIEWER", async () => {
    await expect(clientCostRepo.costByClient(editor(A1))).rejects.toBeInstanceOf(ForbiddenError);
    expect(mocks.prisma.client.findMany).not.toHaveBeenCalled();
  });
});

// ============================================================
// client-instructions repo — voice customisation save (Phase 2.1)
// ============================================================

describe("client-instructions repo — tenant filter", () => {
  it("saveVoiceInstructions rejects cross-tenant clientId before writing", async () => {
    mocks.prisma.client.findFirst.mockResolvedValueOnce(null);
    await expect(
      clientInstructionsRepo.saveVoiceInstructions(owner(A1), {
        showId: "c-other",
        global: "be punchy",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    // The lookup goes through the Show repo now — verify the chained tenant
    // filter through `show.client.agencyId`.
    expect(mocks.prisma.show.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "c-other", client: { agencyId: A1 } },
      }),
    );
  });

  it("saveVoiceInstructions upserts non-empty rules and deletes blanks", async () => {
    mocks.prisma.show.findFirst.mockResolvedValueOnce({ id: "c1" });
    mocks.prisma.showPlatformInstruction.findMany.mockResolvedValue([]);

    await clientInstructionsRepo.saveVoiceInstructions(owner(A1), {
      showId: "c1",
      global: "  always lead with a hook  ",
      perPlatform: {
        [Platform.TWITTER]: "no hashtags",
        [Platform.LINKEDIN]: "  ", // blank → delete
        [Platform.SHOW_NOTES]: "include timestamps",
      },
    });

    // Global gets trimmed and stamped on Show.
    const updateCall = mocks.prisma.show.update.mock.calls[0]![0];
    expect(updateCall.data).toEqual({
      globalInstructions: "always lead with a hook",
    });
    expect(updateCall.where).toEqual({ id: "c1" });

    // Non-empty rules: upserted.
    const upsertCalls = mocks.prisma.showPlatformInstruction.upsert.mock.calls;
    const upsertedPlatforms = upsertCalls.map((c) => c[0].where.showId_platform.platform);
    expect(upsertedPlatforms).toContain(Platform.TWITTER);
    expect(upsertedPlatforms).toContain(Platform.SHOW_NOTES);
    expect(upsertedPlatforms).not.toContain(Platform.LINKEDIN);

    // Blank rule: deleted (so we don't poison cached prompt blocks with "").
    const deleteCalls = mocks.prisma.showPlatformInstruction.deleteMany.mock.calls;
    const deletedPlatforms = deleteCalls.map((c) => c[0].where.platform);
    expect(deletedPlatforms).toContain(Platform.LINKEDIN);
    // Platforms with no entry in the input also get deleteMany (defensive).
    expect(deletedPlatforms).toContain(Platform.INSTAGRAM);
  });

  it("saveVoiceInstructions refuses REVIEWER role", async () => {
    await expect(
      clientInstructionsRepo.saveVoiceInstructions(reviewer(A1), {
        showId: "c1",
        global: "x",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

// ============================================================
// voice samples
// ============================================================

describe("voice-samples repo — tenant filter", () => {
  it("listVoiceSamplesForShow nests agencyId via client relation", async () => {
    mocks.prisma.voiceSample.findMany.mockResolvedValue([]);
    await samplesRepo.listVoiceSamplesForShow(owner(A1), "c1");
    expect(mocks.prisma.voiceSample.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { showId: "c1", show: { client: { agencyId: A1 } } },
      }),
    );
  });

  it("countSamplesByPlatform groups but still filters by agency", async () => {
    mocks.prisma.voiceSample.groupBy.mockResolvedValue([
      { platform: Platform.TWITTER, _count: { _all: 3 } },
      { platform: Platform.LINKEDIN, _count: { _all: 5 } },
    ]);
    const totals = await samplesRepo.countSamplesByPlatform(owner(A1), "c1");
    expect(mocks.prisma.voiceSample.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { showId: "c1", show: { client: { agencyId: A1 } } },
      }),
    );
    expect(totals.TWITTER).toBe(3);
    expect(totals.LINKEDIN).toBe(5);
    expect(totals.INSTAGRAM).toBe(0);
  });
});

// ============================================================
// client-portal repo (Phase 2.5)
// ============================================================

describe("client-portal repo — agency writes are tenant-scoped + token-lookup gates", () => {
  it("createPortalLink rejects EDITOR/REVIEWER (write is OWNER/ADMIN only)", async () => {
    await expect(
      clientPortalRepo.createPortalLink(editor(A1), { clientId: "c1", expiresInDays: 30 }, "m1"),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      clientPortalRepo.createPortalLink(reviewer(A1), { clientId: "c1", expiresInDays: 30 }, "m1"),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(mocks.prisma.client.findFirst).not.toHaveBeenCalled();
    expect(mocks.prisma.clientPortalLink.create).not.toHaveBeenCalled();
  });

  it("createPortalLink rejects a cross-tenant clientId before any write", async () => {
    // Tenant gate: client lookup scoped to ctx.agencyId fails the pre-check.
    mocks.prisma.client.findFirst.mockResolvedValue(null);
    await expect(
      clientPortalRepo.createPortalLink(
        owner(A2),
        { clientId: "c_a1_owned", expiresInDays: 30 },
        "m1",
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(mocks.prisma.client.findFirst).toHaveBeenCalledWith({
      where: { id: "c_a1_owned", agencyId: A2 },
      select: { id: true },
    });
    expect(mocks.prisma.clientPortalLink.create).not.toHaveBeenCalled();
  });

  it("createPortalLink writes a row with expiresAt = now + expiresInDays", async () => {
    mocks.prisma.client.findFirst.mockResolvedValue({ id: "c1" });
    mocks.prisma.clientPortalLink.create.mockResolvedValue({ id: "l1", token: "t1" });

    const before = Date.now();
    await clientPortalRepo.createPortalLink(
      owner(A1),
      { clientId: "c1", expiresInDays: 7 },
      "m_owner",
    );

    expect(mocks.prisma.clientPortalLink.create).toHaveBeenCalledTimes(1);
    const args = mocks.prisma.clientPortalLink.create.mock.calls[0]![0]!;
    expect(args.data.clientId).toBe("c1");
    expect(args.data.createdByMemberId).toBe("m_owner");
    const expiresAt = args.data.expiresAt as Date;
    expect(expiresAt).toBeInstanceOf(Date);
    const deltaMs = expiresAt.getTime() - before;
    // 7 days ± a few seconds of clock slop.
    expect(deltaMs).toBeGreaterThanOrEqual(7 * 24 * 60 * 60 * 1000 - 2000);
    expect(deltaMs).toBeLessThanOrEqual(7 * 24 * 60 * 60 * 1000 + 2000);
  });

  it("revokePortalLink scopes the updateMany by client.agencyId + revokedAt:null", async () => {
    mocks.prisma.clientPortalLink.updateMany.mockResolvedValue({ count: 1 });
    await clientPortalRepo.revokePortalLink(owner(A1), "l1");
    expect(mocks.prisma.clientPortalLink.updateMany).toHaveBeenCalledWith({
      where: { id: "l1", revokedAt: null, client: { agencyId: A1 } },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it("revokePortalLink surfaces NotFoundError when no row matches (cross-tenant or already revoked)", async () => {
    mocks.prisma.clientPortalLink.updateMany.mockResolvedValue({ count: 0 });
    await expect(clientPortalRepo.revokePortalLink(owner(A2), "l1")).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("listPortalLinks filters by clientId + client.agencyId, newest first", async () => {
    mocks.prisma.client.findFirst.mockResolvedValue({ id: "c1" });
    mocks.prisma.clientPortalLink.findMany.mockResolvedValue([]);
    await clientPortalRepo.listPortalLinks(owner(A1), "c1");
    expect(mocks.prisma.clientPortalLink.findMany).toHaveBeenCalledWith({
      where: { clientId: "c1", client: { agencyId: A1 } },
      orderBy: { createdAt: "desc" },
      include: {
        createdByMember: { select: { id: true, name: true, email: true } },
      },
    });
  });

  // --------------------------------------------------------------
  // Public token lookup — no TenantContext. The token IS the credential.
  // --------------------------------------------------------------

  it("getPortalLinkByToken returns null when no link matches", async () => {
    mocks.prisma.clientPortalLink.findUnique.mockResolvedValue(null);
    const result = await clientPortalRepo.getPortalLinkByToken("missing");
    expect(result).toBeNull();
  });

  it("getPortalLinkByToken returns null when the link is revoked (no signal vs missing)", async () => {
    mocks.prisma.clientPortalLink.findUnique.mockResolvedValue({
      id: "l1",
      token: "t1",
      revokedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      client: {
        id: "c1",
        name: "Acme",
        agency: { id: A1, name: "A", brandLogoUrl: null, brandAccentColor: null },
      },
    });
    const result = await clientPortalRepo.getPortalLinkByToken("t1");
    expect(result).toBeNull();
  });

  it("getPortalLinkByToken returns null when the link is expired", async () => {
    mocks.prisma.clientPortalLink.findUnique.mockResolvedValue({
      id: "l1",
      token: "t1",
      revokedAt: null,
      expiresAt: new Date(Date.now() - 60_000),
      client: {
        id: "c1",
        name: "Acme",
        agency: { id: A1, name: "A", brandLogoUrl: null, brandAccentColor: null },
      },
    });
    const result = await clientPortalRepo.getPortalLinkByToken("t1");
    expect(result).toBeNull();
  });

  it("getPortalLinkByToken returns the link + agency branding when valid", async () => {
    const link = {
      id: "l1",
      token: "t1",
      revokedAt: null,
      expiresAt: new Date(Date.now() + 86_400_000),
      client: {
        id: "c1",
        name: "Acme",
        agency: {
          id: A1,
          name: "A",
          brandLogoUrl: "https://cdn.example.com/a.png",
          brandAccentColor: "#3a5ba0",
        },
      },
    };
    mocks.prisma.clientPortalLink.findUnique.mockResolvedValue(link);
    const result = await clientPortalRepo.getPortalLinkByToken("t1");
    expect(result).toBe(link);
  });
});

// ============================================================
// Phase 2.6 — bulk generate
// ============================================================

describe("episodes repo — bulkGenerateEpisodes", () => {
  it("filters to ctx.agencyId via show.client.agencyId in the findMany", async () => {
    mocks.prisma.episode.findMany.mockResolvedValue([]);

    await episodesRepo.bulkGenerateEpisodes(owner(A1), { episodeIds: ["ep1", "ep2"] });

    expect(mocks.prisma.episode.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["ep1", "ep2"] },
        show: { client: { agencyId: A1 } },
      },
      select: expect.objectContaining({
        id: true,
        status: true,
        outputs: expect.objectContaining({
          where: { supersededAt: null },
          select: { platform: true },
          distinct: ["platform"],
        }),
      }),
    });
  });

  it("rejects EDITOR? — no, EDITOR is in WRITE_ROLES; REVIEWER is rejected", async () => {
    await expect(
      episodesRepo.bulkGenerateEpisodes(reviewer(A1), { episodeIds: ["ep1"] }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(mocks.prisma.episode.findMany).not.toHaveBeenCalled();
  });

  it("skips episodes that aren't DRAFT or FAILED and short-circuits when none are eligible", async () => {
    mocks.prisma.episode.findMany.mockResolvedValue([
      { id: "ep_ready", status: EpisodeStatus.READY, outputs: [] },
      { id: "ep_proc", status: EpisodeStatus.PROCESSING, outputs: [] },
      { id: "ep_archived", status: EpisodeStatus.ARCHIVED, outputs: [] },
    ]);

    const result = await episodesRepo.bulkGenerateEpisodes(owner(A1), {
      episodeIds: ["ep_ready", "ep_proc", "ep_archived"],
    });

    expect(result.dispatches).toEqual([]);
    // All three rows were ineligible — their ids surface so the UI can
    // explain to the user that the click only partially landed.
    expect(result.skippedNotEligible).toEqual(["ep_ready", "ep_proc", "ep_archived"]);
    // No status flip when nothing was eligible.
    expect(mocks.prisma.episode.updateMany).not.toHaveBeenCalled();
  });

  it("flips eligible DRAFT/FAILED rows to PROCESSING + clears failureReason in one updateMany", async () => {
    mocks.prisma.episode.findMany.mockResolvedValue([
      { id: "ep_draft", status: EpisodeStatus.DRAFT, outputs: [] },
      { id: "ep_failed", status: EpisodeStatus.FAILED, outputs: [{ platform: Platform.LINKEDIN }] },
      { id: "ep_ready", status: EpisodeStatus.READY, outputs: [] },
    ]);
    mocks.prisma.episode.updateMany.mockResolvedValue({ count: 2 });

    const result = await episodesRepo.bulkGenerateEpisodes(owner(A1), {
      episodeIds: ["ep_draft", "ep_failed", "ep_ready"],
    });

    expect(mocks.prisma.episode.updateMany).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.episode.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["ep_draft", "ep_failed"] },
        show: { client: { agencyId: A1 } },
      },
      data: {
        status: EpisodeStatus.PROCESSING,
        failureReason: null,
      },
    });

    expect(result.skippedNotEligible).toEqual(["ep_ready"]);
    expect(result.dispatches).toEqual([
      // No prior outputs — falls back to the full 7-platform default set.
      {
        episodeId: "ep_draft",
        platforms: [
          Platform.TWITTER,
          Platform.LINKEDIN,
          Platform.INSTAGRAM,
          Platform.TIKTOK,
          Platform.SHOW_NOTES,
          Platform.BLOG,
          Platform.NEWSLETTER,
        ],
      },
      // Prior outputs exist (LinkedIn only) — derives from them so a
      // retry honours the original platform selection.
      { episodeId: "ep_failed", platforms: [Platform.LINKEDIN] },
    ]);
  });

  it("ignores ids that resolve to other tenants (findMany filter strips them)", async () => {
    // Caller asks for 3 ids; only one is in their tenant. findMany returns
    // just that one, and the function never flips or dispatches for the
    // other two — they're invisible by design.
    mocks.prisma.episode.findMany.mockResolvedValue([
      { id: "ep_owned", status: EpisodeStatus.FAILED, outputs: [] },
    ]);
    mocks.prisma.episode.updateMany.mockResolvedValue({ count: 1 });

    const result = await episodesRepo.bulkGenerateEpisodes(owner(A1), {
      episodeIds: ["ep_owned", "ep_other_tenant_a", "ep_other_tenant_b"],
    });

    expect(result.dispatches.map((d) => d.episodeId)).toEqual(["ep_owned"]);
    expect(result.skippedNotEligible).toEqual([]);
    // Status flip targets only the tenant-owned id.
    const updateCall = mocks.prisma.episode.updateMany.mock.calls[0]![0]!;
    expect(updateCall.where.id).toEqual({ in: ["ep_owned"] });
  });

  it("rejects empty input via the Zod schema before touching the DB", async () => {
    await expect(
      episodesRepo.bulkGenerateEpisodes(owner(A1), { episodeIds: [] }),
    ).rejects.toThrow();
    expect(mocks.prisma.episode.findMany).not.toHaveBeenCalled();
  });
});

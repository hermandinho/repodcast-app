/**
 * `updateAgencyAction` is the seam that renames the active workspace.
 * Asserts the action layer: Zod validation, sample-mode short-circuit,
 * tenant-scoped repo call in live mode, and revalidation of the dashboard
 * + agency-settings paths.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemberRole, Plan, type Agency } from "@prisma/client";
import { ValidationError } from "@/server/auth/errors";
import type { TenantContext } from "@/server/auth/tenant";

const mocks = vi.hoisted(() => ({
  isLiveDb: vi.fn(),
  resolveTenantContext: vi.fn(),
  repoUpdateAgency: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/server/data/source", () => ({
  isLiveDb: mocks.isLiveDb,
}));
vi.mock("@/server/data/tenant", () => ({
  resolveTenantContext: mocks.resolveTenantContext,
}));
vi.mock("@/server/db/agencies", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    updateAgency: mocks.repoUpdateAgency,
  };
});
vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));

import { updateAgencyAction } from "@/app/(dashboard)/settings/agency/actions";

const AGENCY_ID = "agency_smoke";
const TENANT: TenantContext = { agencyId: AGENCY_ID, role: MemberRole.OWNER };

beforeEach(() => {
  mocks.isLiveDb.mockReset();
  mocks.resolveTenantContext.mockReset();
  mocks.repoUpdateAgency.mockReset();
  mocks.revalidatePath.mockReset();

  mocks.resolveTenantContext.mockResolvedValue(TENANT);
  mocks.repoUpdateAgency.mockResolvedValue({
    id: AGENCY_ID,
    name: "Renamed",
    plan: Plan.STUDIO,
  } as Agency);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("updateAgencyAction — validation", () => {
  it("rejects an empty name", async () => {
    mocks.isLiveDb.mockReturnValue(true);
    await expect(updateAgencyAction({ name: "" })).rejects.toBeInstanceOf(ValidationError);
    expect(mocks.repoUpdateAgency).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects names over 120 chars", async () => {
    mocks.isLiveDb.mockReturnValue(true);
    await expect(updateAgencyAction({ name: "x".repeat(121) })).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(mocks.repoUpdateAgency).not.toHaveBeenCalled();
  });

  it("rejects a missing name field", async () => {
    mocks.isLiveDb.mockReturnValue(true);
    await expect(updateAgencyAction({})).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("updateAgencyAction — sample-data mode", () => {
  it("returns success without touching the DB", async () => {
    mocks.isLiveDb.mockReturnValue(false);

    const result = await updateAgencyAction({ name: "Demo Renamed" });

    expect(result).toEqual({ ok: true, data: { name: "Demo Renamed" } });
    expect(mocks.resolveTenantContext).not.toHaveBeenCalled();
    expect(mocks.repoUpdateAgency).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("updateAgencyAction — live mode", () => {
  it("resolves tenant, writes via the repo, returns the persisted name", async () => {
    mocks.isLiveDb.mockReturnValue(true);

    const result = await updateAgencyAction({ name: "Renamed" });

    expect(result).toEqual({ ok: true, data: { name: "Renamed" } });
    expect(mocks.resolveTenantContext).toHaveBeenCalledOnce();
    expect(mocks.repoUpdateAgency).toHaveBeenCalledWith(TENANT, {
      name: "Renamed",
    });
  });

  it("revalidates the dashboard layout (topbar + greeting) and the agency settings page", async () => {
    mocks.isLiveDb.mockReturnValue(true);
    await updateAgencyAction({ name: "Renamed" });

    expect(mocks.revalidatePath).toHaveBeenCalledWith("/(dashboard)", "layout");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings/agency");
  });

  it("surfaces a repo error as a structured failure (no revalidate)", async () => {
    mocks.isLiveDb.mockReturnValue(true);
    mocks.repoUpdateAgency.mockRejectedValueOnce(new Error("Agency agency_smoke not found"));

    const result = await updateAgencyAction({ name: "Renamed" });

    expect(result).toEqual({
      ok: false,
      error: "Agency agency_smoke not found",
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

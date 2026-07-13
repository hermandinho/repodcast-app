/**
 * ROOT-side agency write actions.
 *
 * Every action must:
 *   - Reject SUPPORT + ANALYST with ForbiddenError BEFORE any TX opens
 *   - Fire the correct audit action key with `targetAgencyId` stamped
 *   - Reject the malformed states the plan calls out (double-suspend,
 *     revoking a nonexistent override, cancelling a subless agency, …)
 *
 * The Stripe path (`forceCancelAgencySubscription`) verifies:
 *   - `subscriptions.cancel` is called with `invoice_now + prorate`
 *   - The local Agency row is downgraded to STUDIO + subscription id cleared
 *   - Everything lands inside the same audit TX
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InvoiceStatus, Plan, SystemAdminRole } from "@prisma/client";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/auth/errors";

const mocks = vi.hoisted(() => ({
  agencyFindUnique: vi.fn(),
  agencyUpdate: vi.fn(),
  agencyDelete: vi.fn(),
  invoiceFindUnique: vi.fn(),
  systemAuditLogCreate: vi.fn(),
  $transaction: vi.fn(),
  stripeSubscriptionsCancel: vi.fn(),
  getR2Client: vi.fn(),
  quarantineR2AgencyPrefixes: vi.fn(),
}));

vi.mock("@/server/db/client", () => ({
  prisma: {
    agency: { findUnique: mocks.agencyFindUnique },
    invoice: { findUnique: mocks.invoiceFindUnique },
    $transaction: mocks.$transaction,
  },
}));

vi.mock("@/server/billing/stripe", () => ({
  requireStripeClient: () => ({
    subscriptions: { cancel: mocks.stripeSubscriptionsCancel },
  }),
}));

vi.mock("@/server/storage/r2", () => ({
  getR2Client: mocks.getR2Client,
  quarantineR2AgencyPrefixes: mocks.quarantineR2AgencyPrefixes,
}));

import type { SystemAdminContext } from "@/server/auth/system";
import {
  extendAgencyCompAccess,
  forceCancelAgencySubscription,
  grantAgencyCompAccess,
  grantAgencyPlanOverride,
  hardDeleteAgency,
  recordInvoiceRefundIntent,
  revokeAgencyCompAccess,
  revokeAgencyPlanOverride,
  suspendAgency,
  unsuspendAgency,
} from "@/server/db/system/agencies";

function ctx(role: SystemAdminRole = "ROOT"): SystemAdminContext {
  return {
    user: { clerkUserId: "user_1", email: "ops@example.com", name: null, imageUrl: null },
    admin: { id: "sa_1", role, mfaEnforced: true },
  };
}

function buildFakeTx() {
  const auditWrites: Record<string, unknown>[] = [];
  const agencyUpdates: Record<string, unknown>[] = [];
  const agencyDeletes: Record<string, unknown>[] = [];
  const tx = {
    systemAuditLog: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        auditWrites.push(data);
        return data;
      }),
    },
    agency: {
      findUnique: mocks.agencyFindUnique,
      update: vi.fn(async (args: Record<string, unknown>) => {
        agencyUpdates.push(args);
        return mocks.agencyUpdate(args);
      }),
      delete: vi.fn(async (args: Record<string, unknown>) => {
        agencyDeletes.push(args);
        return mocks.agencyDelete(args);
      }),
    },
  };
  return { tx, auditWrites, agencyUpdates, agencyDeletes };
}

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
});

// ============================================================
// Suspend / unsuspend
// ============================================================

describe("suspendAgency", () => {
  it("rejects SUPPORT + ANALYST with ForbiddenError before any TX", async () => {
    for (const role of ["SUPPORT", "ANALYST"] satisfies SystemAdminRole[]) {
      await expect(suspendAgency(ctx(role), { id: "agc_1", note: "abuse" })).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    }
    expect(mocks.$transaction).not.toHaveBeenCalled();
  });

  it("stamps suspendedAt + fires agency.suspend audit", async () => {
    mocks.agencyFindUnique.mockResolvedValueOnce({
      id: "agc_1",
      name: "Acme",
      plan: "STUDIO" satisfies Plan,
      suspendedAt: null,
    });
    mocks.agencyUpdate.mockResolvedValueOnce({
      id: "agc_1",
      name: "Acme",
      plan: "STUDIO" satisfies Plan,
      suspendedAt: new Date("2026-07-01T00:00:00Z"),
    });
    const fake = buildFakeTx();
    mocks.$transaction.mockImplementation(async (cb: (t: unknown) => Promise<unknown>) =>
      cb(fake.tx),
    );

    await suspendAgency(ctx(), { id: "agc_1", note: "spam reports rolling in" });

    const updateArgs = fake.agencyUpdates[0] as { data: { suspendedAt: Date } };
    expect(updateArgs.data.suspendedAt).toBeInstanceOf(Date);
    expect(fake.auditWrites[0]?.action).toBe("agency.suspend");
    expect(fake.auditWrites[0]?.targetAgencyId).toBe("agc_1");
    expect(fake.auditWrites[0]?.note).toBe("spam reports rolling in");
  });

  it("throws ValidationError when the agency is already suspended", async () => {
    mocks.agencyFindUnique.mockResolvedValueOnce({
      id: "agc_1",
      name: "Acme",
      plan: "STUDIO" satisfies Plan,
      suspendedAt: new Date("2026-06-01"),
    });
    const fake = buildFakeTx();
    mocks.$transaction.mockImplementation(async (cb: (t: unknown) => Promise<unknown>) =>
      cb(fake.tx),
    );

    await expect(
      suspendAgency(ctx(), { id: "agc_1", note: "double-suspend" }),
    ).rejects.toBeInstanceOf(ValidationError);
    // No update fired.
    expect(fake.agencyUpdates).toHaveLength(0);
  });

  it("throws NotFoundError when the agency is missing", async () => {
    mocks.agencyFindUnique.mockResolvedValueOnce(null);
    const fake = buildFakeTx();
    mocks.$transaction.mockImplementation(async (cb: (t: unknown) => Promise<unknown>) =>
      cb(fake.tx),
    );

    await expect(suspendAgency(ctx(), { id: "agc_missing", note: "test" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("requires a note >= 3 chars (Zod)", async () => {
    await expect(suspendAgency(ctx(), { id: "agc_1", note: "no" })).rejects.toThrow();
    expect(mocks.$transaction).not.toHaveBeenCalled();
  });
});

describe("unsuspendAgency", () => {
  it("clears suspendedAt + fires agency.unsuspend audit", async () => {
    mocks.agencyFindUnique.mockResolvedValueOnce({
      id: "agc_1",
      name: "Acme",
      suspendedAt: new Date("2026-06-01"),
    });
    mocks.agencyUpdate.mockResolvedValueOnce({
      id: "agc_1",
      name: "Acme",
      suspendedAt: null,
    });
    const fake = buildFakeTx();
    mocks.$transaction.mockImplementation(async (cb: (t: unknown) => Promise<unknown>) =>
      cb(fake.tx),
    );

    await unsuspendAgency(ctx(), { id: "agc_1", note: "false positive" });

    const updateArgs = fake.agencyUpdates[0] as { data: { suspendedAt: Date | null } };
    expect(updateArgs.data.suspendedAt).toBeNull();
    expect(fake.auditWrites[0]?.action).toBe("agency.unsuspend");
  });

  it("throws ValidationError when the agency isn't currently suspended", async () => {
    mocks.agencyFindUnique.mockResolvedValueOnce({
      id: "agc_1",
      name: "Acme",
      suspendedAt: null,
    });
    const fake = buildFakeTx();
    mocks.$transaction.mockImplementation(async (cb: (t: unknown) => Promise<unknown>) =>
      cb(fake.tx),
    );

    await expect(unsuspendAgency(ctx(), { id: "agc_1", note: "no-op" })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});

// ============================================================
// Plan override
// ============================================================

describe("grantAgencyPlanOverride", () => {
  it("rejects SUPPORT with ForbiddenError before any TX", async () => {
    await expect(
      grantAgencyPlanOverride(ctx("SUPPORT"), {
        id: "agc_1",
        plan: "NETWORK",
        note: "comp",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(mocks.$transaction).not.toHaveBeenCalled();
  });

  it("sets planOverride + fires agency.grant_plan_override audit", async () => {
    mocks.agencyFindUnique.mockResolvedValueOnce({
      id: "agc_1",
      name: "Acme",
      plan: "STUDIO" satisfies Plan,
      planOverride: null,
    });
    mocks.agencyUpdate.mockResolvedValueOnce({
      id: "agc_1",
      name: "Acme",
      plan: "STUDIO" satisfies Plan,
      planOverride: "NETWORK" satisfies Plan,
    });
    const fake = buildFakeTx();
    mocks.$transaction.mockImplementation(async (cb: (t: unknown) => Promise<unknown>) =>
      cb(fake.tx),
    );

    await grantAgencyPlanOverride(ctx(), {
      id: "agc_1",
      plan: "NETWORK",
      note: "partner comp for Q3",
    });

    const updateArgs = fake.agencyUpdates[0] as { data: { planOverride: Plan } };
    expect(updateArgs.data.planOverride).toBe("NETWORK");
    expect(fake.auditWrites[0]?.action).toBe("agency.grant_plan_override");
  });

  it("rejects an invalid plan at Zod validation", async () => {
    await expect(
      grantAgencyPlanOverride(ctx(), {
        id: "agc_1",
        plan: "GALACTIC" as never,
        note: "typo",
      }),
    ).rejects.toThrow();
  });
});

describe("revokeAgencyPlanOverride", () => {
  it("clears planOverride when one is active", async () => {
    mocks.agencyFindUnique.mockResolvedValueOnce({
      id: "agc_1",
      name: "Acme",
      plan: "STUDIO" satisfies Plan,
      planOverride: "NETWORK" satisfies Plan,
    });
    mocks.agencyUpdate.mockResolvedValueOnce({
      id: "agc_1",
      name: "Acme",
      plan: "STUDIO" satisfies Plan,
      planOverride: null,
    });
    const fake = buildFakeTx();
    mocks.$transaction.mockImplementation(async (cb: (t: unknown) => Promise<unknown>) =>
      cb(fake.tx),
    );

    await revokeAgencyPlanOverride(ctx(), { id: "agc_1", note: "beta ended" });

    const updateArgs = fake.agencyUpdates[0] as { data: { planOverride: Plan | null } };
    expect(updateArgs.data.planOverride).toBeNull();
    expect(fake.auditWrites[0]?.action).toBe("agency.revoke_plan_override");
  });

  it("throws ValidationError when there's no override to revoke", async () => {
    mocks.agencyFindUnique.mockResolvedValueOnce({
      id: "agc_1",
      name: "Acme",
      plan: "STUDIO" satisfies Plan,
      planOverride: null,
    });
    const fake = buildFakeTx();
    mocks.$transaction.mockImplementation(async (cb: (t: unknown) => Promise<unknown>) =>
      cb(fake.tx),
    );

    await expect(
      revokeAgencyPlanOverride(ctx(), { id: "agc_1", note: "cleanup" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

// ============================================================
// Comp access — free dashboard access without a Stripe sub
// ============================================================

describe("grantAgencyCompAccess", () => {
  it("rejects SUPPORT with ForbiddenError before any TX", async () => {
    await expect(
      grantAgencyCompAccess(ctx("SUPPORT"), {
        id: "agc_1",
        durationDays: 90,
        note: "demo tenant",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(mocks.$transaction).not.toHaveBeenCalled();
  });

  it("stamps compAccessExpiresAt ~durationDays out + fires agency.grant_comp_access audit", async () => {
    mocks.agencyFindUnique.mockResolvedValueOnce({
      id: "agc_1",
      name: "Acme",
      compAccessExpiresAt: null,
    });
    mocks.agencyUpdate.mockImplementationOnce(
      async (args: { data: { compAccessExpiresAt: Date } }) => ({
        id: "agc_1",
        name: "Acme",
        compAccessExpiresAt: args.data.compAccessExpiresAt,
      }),
    );
    const fake = buildFakeTx();
    mocks.$transaction.mockImplementation(async (cb: (t: unknown) => Promise<unknown>) =>
      cb(fake.tx),
    );

    const before = Date.now();
    const result = await grantAgencyCompAccess(ctx(), {
      id: "agc_1",
      durationDays: 90,
      note: "internal demo",
    });
    const after = Date.now();

    // Expiry should be within [now + 90d - epsilon, now + 90d + epsilon]
    const expected90d = 90 * 86_400_000;
    expect(result.compAccessExpiresAt.getTime()).toBeGreaterThanOrEqual(before + expected90d - 5);
    expect(result.compAccessExpiresAt.getTime()).toBeLessThanOrEqual(after + expected90d + 5);
    expect(fake.auditWrites[0]?.action).toBe("agency.grant_comp_access");
  });

  it("rejects a duration outside [1, 3650] days at Zod validation", async () => {
    await expect(
      grantAgencyCompAccess(ctx(), { id: "agc_1", durationDays: 0, note: "x" }),
    ).rejects.toThrow();
    await expect(
      grantAgencyCompAccess(ctx(), { id: "agc_1", durationDays: 4000, note: "x" }),
    ).rejects.toThrow();
  });
});

describe("extendAgencyCompAccess", () => {
  it("adds days on top of a live comp expiry", async () => {
    const currentExpiry = new Date(Date.now() + 10 * 86_400_000);
    mocks.agencyFindUnique.mockResolvedValueOnce({
      id: "agc_1",
      name: "Acme",
      compAccessExpiresAt: currentExpiry,
    });
    mocks.agencyUpdate.mockImplementationOnce(
      async (args: { data: { compAccessExpiresAt: Date } }) => ({
        id: "agc_1",
        name: "Acme",
        compAccessExpiresAt: args.data.compAccessExpiresAt,
      }),
    );
    const fake = buildFakeTx();
    mocks.$transaction.mockImplementation(async (cb: (t: unknown) => Promise<unknown>) =>
      cb(fake.tx),
    );

    const result = await extendAgencyCompAccess(ctx(), {
      id: "agc_1",
      additionalDays: 30,
      note: "extension",
    });

    // Live comp → extension stacks: current + 30d
    expect(result.compAccessExpiresAt.getTime()).toBe(currentExpiry.getTime() + 30 * 86_400_000);
    expect(fake.auditWrites[0]?.action).toBe("agency.extend_comp_access");
  });

  it("rebases off now when the current expiry is already in the past", async () => {
    const expiredAt = new Date(Date.now() - 5 * 86_400_000);
    mocks.agencyFindUnique.mockResolvedValueOnce({
      id: "agc_1",
      name: "Acme",
      compAccessExpiresAt: expiredAt,
    });
    mocks.agencyUpdate.mockImplementationOnce(
      async (args: { data: { compAccessExpiresAt: Date } }) => ({
        id: "agc_1",
        name: "Acme",
        compAccessExpiresAt: args.data.compAccessExpiresAt,
      }),
    );
    const fake = buildFakeTx();
    mocks.$transaction.mockImplementation(async (cb: (t: unknown) => Promise<unknown>) =>
      cb(fake.tx),
    );

    const before = Date.now();
    const result = await extendAgencyCompAccess(ctx(), {
      id: "agc_1",
      additionalDays: 30,
      note: "renew",
    });
    const after = Date.now();

    // Expired comp → rebase off `now`, so expiry lands ~30d out (not
    // "still in the past + 30d").
    const expected = 30 * 86_400_000;
    expect(result.compAccessExpiresAt.getTime()).toBeGreaterThanOrEqual(before + expected - 5);
    expect(result.compAccessExpiresAt.getTime()).toBeLessThanOrEqual(after + expected + 5);
  });

  it("rebases off now when compAccessExpiresAt was null", async () => {
    mocks.agencyFindUnique.mockResolvedValueOnce({
      id: "agc_1",
      name: "Acme",
      compAccessExpiresAt: null,
    });
    mocks.agencyUpdate.mockImplementationOnce(
      async (args: { data: { compAccessExpiresAt: Date } }) => ({
        id: "agc_1",
        name: "Acme",
        compAccessExpiresAt: args.data.compAccessExpiresAt,
      }),
    );
    const fake = buildFakeTx();
    mocks.$transaction.mockImplementation(async (cb: (t: unknown) => Promise<unknown>) =>
      cb(fake.tx),
    );

    const before = Date.now();
    const result = await extendAgencyCompAccess(ctx(), {
      id: "agc_1",
      additionalDays: 7,
      note: "grant-via-extend",
    });
    const after = Date.now();

    const expected = 7 * 86_400_000;
    expect(result.compAccessExpiresAt.getTime()).toBeGreaterThanOrEqual(before + expected - 5);
    expect(result.compAccessExpiresAt.getTime()).toBeLessThanOrEqual(after + expected + 5);
  });
});

describe("revokeAgencyCompAccess", () => {
  it("nulls compAccessExpiresAt when one is active", async () => {
    mocks.agencyFindUnique.mockResolvedValueOnce({
      id: "agc_1",
      name: "Acme",
      compAccessExpiresAt: new Date(Date.now() + 10 * 86_400_000),
    });
    mocks.agencyUpdate.mockResolvedValueOnce({
      id: "agc_1",
      name: "Acme",
      compAccessExpiresAt: null,
    });
    const fake = buildFakeTx();
    mocks.$transaction.mockImplementation(async (cb: (t: unknown) => Promise<unknown>) =>
      cb(fake.tx),
    );

    await revokeAgencyCompAccess(ctx(), { id: "agc_1", note: "partner offboarded" });

    const updateArgs = fake.agencyUpdates[0] as { data: { compAccessExpiresAt: Date | null } };
    expect(updateArgs.data.compAccessExpiresAt).toBeNull();
    expect(fake.auditWrites[0]?.action).toBe("agency.revoke_comp_access");
  });

  it("throws ValidationError when there's no comp access to revoke", async () => {
    mocks.agencyFindUnique.mockResolvedValueOnce({
      id: "agc_1",
      name: "Acme",
      compAccessExpiresAt: null,
    });
    const fake = buildFakeTx();
    mocks.$transaction.mockImplementation(async (cb: (t: unknown) => Promise<unknown>) =>
      cb(fake.tx),
    );

    await expect(
      revokeAgencyCompAccess(ctx(), { id: "agc_1", note: "cleanup" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

// ============================================================
// Force-cancel subscription
// ============================================================

describe("forceCancelAgencySubscription", () => {
  it("rejects when the agency has no active subscription — no Stripe call", async () => {
    mocks.agencyFindUnique.mockResolvedValueOnce({
      id: "agc_1",
      name: "Acme",
      plan: "STUDIO" satisfies Plan,
      stripeSubscriptionId: null,
    });

    await expect(
      forceCancelAgencySubscription(ctx(), { id: "agc_1", note: "cleanup" }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(mocks.stripeSubscriptionsCancel).not.toHaveBeenCalled();
    expect(mocks.$transaction).not.toHaveBeenCalled();
  });

  it("throws NotFoundError when the agency is missing — no Stripe call", async () => {
    mocks.agencyFindUnique.mockResolvedValueOnce(null);
    await expect(
      forceCancelAgencySubscription(ctx(), { id: "agc_missing", note: "test" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(mocks.stripeSubscriptionsCancel).not.toHaveBeenCalled();
  });

  it("cancels via Stripe with invoice_now + prorate and downgrades locally to STUDIO", async () => {
    mocks.agencyFindUnique.mockResolvedValueOnce({
      id: "agc_1",
      name: "Acme",
      plan: "NETWORK" satisfies Plan,
      stripeSubscriptionId: "sub_xxx",
    });
    mocks.stripeSubscriptionsCancel.mockResolvedValueOnce({
      id: "sub_xxx",
      status: "canceled",
      canceled_at: 1_760_000_000,
    });
    mocks.agencyUpdate.mockResolvedValueOnce({});
    const fake = buildFakeTx();
    mocks.$transaction.mockImplementation(async (cb: (t: unknown) => Promise<unknown>) =>
      cb(fake.tx),
    );

    await forceCancelAgencySubscription(ctx(), {
      id: "agc_1",
      note: "customer requested via phone",
    });

    expect(mocks.stripeSubscriptionsCancel).toHaveBeenCalledWith("sub_xxx", {
      invoice_now: true,
      prorate: true,
    });
    const updateArgs = fake.agencyUpdates[0] as {
      data: { plan: Plan; billingCadence: string; stripeSubscriptionId: string | null };
    };
    expect(updateArgs.data.plan).toBe("STUDIO");
    expect(updateArgs.data.billingCadence).toBe("MONTHLY");
    expect(updateArgs.data.stripeSubscriptionId).toBeNull();
    expect(fake.auditWrites[0]?.action).toBe("subscription.force_cancel");
    expect(fake.auditWrites[0]?.targetAgencyId).toBe("agc_1");
  });

  it("propagates a Stripe failure so the local downgrade doesn't happen", async () => {
    mocks.agencyFindUnique.mockResolvedValueOnce({
      id: "agc_1",
      name: "Acme",
      plan: "NETWORK" satisfies Plan,
      stripeSubscriptionId: "sub_xxx",
    });
    mocks.stripeSubscriptionsCancel.mockRejectedValueOnce(new Error("stripe went down"));
    const fake = buildFakeTx();
    mocks.$transaction.mockImplementation(async (cb: (t: unknown) => Promise<unknown>) =>
      cb(fake.tx),
    );

    await expect(
      forceCancelAgencySubscription(ctx(), { id: "agc_1", note: "test" }),
    ).rejects.toThrow("stripe went down");
    // Local update never fired.
    expect(fake.agencyUpdates).toHaveLength(0);
  });
});

// ============================================================
// Refund intent
// ============================================================

describe("recordInvoiceRefundIntent", () => {
  it("throws NotFoundError when the invoice is missing", async () => {
    mocks.invoiceFindUnique.mockResolvedValueOnce(null);
    await expect(
      recordInvoiceRefundIntent(ctx(), { invoiceId: "inv_missing", note: "test" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(mocks.$transaction).not.toHaveBeenCalled();
  });

  it("writes an invoice.refund_request audit row and returns the Stripe URL", async () => {
    mocks.invoiceFindUnique.mockResolvedValueOnce({
      id: "inv_1",
      stripeInvoiceId: "in_stripe_xyz",
      amountCents: 12_900,
      currency: "usd",
      status: "PAID" satisfies InvoiceStatus,
      agencyId: "agc_1",
    });
    const fake = buildFakeTx();
    mocks.$transaction.mockImplementation(async (cb: (t: unknown) => Promise<unknown>) =>
      cb(fake.tx),
    );

    const result = await recordInvoiceRefundIntent(ctx(), {
      invoiceId: "inv_1",
      note: "customer overpaid",
    });

    expect(result.stripeUrl).toBe("https://dashboard.stripe.com/invoices/in_stripe_xyz");
    expect(fake.auditWrites[0]?.action).toBe("invoice.refund_request");
    expect(fake.auditWrites[0]?.targetAgencyId).toBe("agc_1");
    expect(fake.auditWrites[0]?.targetEntityType).toBe("invoice");
    expect(fake.auditWrites[0]?.targetEntityId).toBe("inv_1");
    expect(fake.auditWrites[0]?.note).toBe("customer overpaid");
  });

  it("rejects SUPPORT with ForbiddenError before any lookup", async () => {
    await expect(
      recordInvoiceRefundIntent(ctx("SUPPORT"), {
        invoiceId: "inv_1",
        note: "not authorised",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(mocks.invoiceFindUnique).not.toHaveBeenCalled();
  });
});

// ============================================================
// Hard-delete
// ============================================================

describe("hardDeleteAgency", () => {
  it("rejects OPERATOR/SUPPORT/ANALYST with ForbiddenError (ROOT-only)", async () => {
    for (const role of ["OPERATOR", "SUPPORT", "ANALYST"] satisfies SystemAdminRole[]) {
      await expect(
        hardDeleteAgency(ctx(role), {
          id: "agc_1",
          confirmName: "Acme",
          note: "explicit reason above ten chars",
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
    // Never even reached the pre-flight fetch.
    expect(mocks.agencyFindUnique).not.toHaveBeenCalled();
    expect(mocks.$transaction).not.toHaveBeenCalled();
  });

  it("throws NotFoundError when the agency is missing", async () => {
    mocks.agencyFindUnique.mockResolvedValueOnce(null);
    await expect(
      hardDeleteAgency(ctx(), {
        id: "agc_missing",
        confirmName: "Acme",
        note: "cleanup test workspace",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(mocks.quarantineR2AgencyPrefixes).not.toHaveBeenCalled();
  });

  it("throws ValidationError when confirmName doesn't match the agency name", async () => {
    mocks.agencyFindUnique.mockResolvedValueOnce({
      id: "agc_1",
      name: "Acme",
      plan: "STUDIO" satisfies Plan,
      stripeSubscriptionId: null,
      stripeCustomerId: null,
      createdAt: new Date("2026-01-01"),
    });
    await expect(
      hardDeleteAgency(ctx(), {
        id: "agc_1",
        confirmName: "Beta",
        note: "typed the wrong name",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    // No quarantine, no delete.
    expect(mocks.quarantineR2AgencyPrefixes).not.toHaveBeenCalled();
    expect(mocks.$transaction).not.toHaveBeenCalled();
  });

  it("throws ValidationError when the agency still has an active Stripe subscription", async () => {
    mocks.agencyFindUnique.mockResolvedValueOnce({
      id: "agc_1",
      name: "Acme",
      plan: "NETWORK" satisfies Plan,
      stripeSubscriptionId: "sub_still_live",
      stripeCustomerId: "cus_live",
      createdAt: new Date("2026-01-01"),
    });
    await expect(
      hardDeleteAgency(ctx(), {
        id: "agc_1",
        confirmName: "Acme",
        note: "attempted premature delete",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(mocks.quarantineR2AgencyPrefixes).not.toHaveBeenCalled();
    expect(mocks.$transaction).not.toHaveBeenCalled();
  });

  it("rejects a note under 10 chars at Zod validation", async () => {
    await expect(
      hardDeleteAgency(ctx(), { id: "agc_1", confirmName: "Acme", note: "too short" }),
    ).rejects.toThrow();
    expect(mocks.agencyFindUnique).not.toHaveBeenCalled();
  });

  it("skips R2 quarantine when R2 isn't configured but still deletes the DB row", async () => {
    mocks.agencyFindUnique.mockResolvedValueOnce({
      id: "agc_1",
      name: "Acme",
      plan: "STUDIO" satisfies Plan,
      stripeSubscriptionId: null,
      stripeCustomerId: null,
      createdAt: new Date("2026-01-01"),
    });
    mocks.getR2Client.mockReturnValueOnce(null);
    mocks.agencyDelete.mockResolvedValueOnce({});
    const fake = buildFakeTx();
    mocks.$transaction.mockImplementation(async (cb: (t: unknown) => Promise<unknown>) =>
      cb(fake.tx),
    );

    const result = await hardDeleteAgency(ctx(), {
      id: "agc_1",
      confirmName: "Acme",
      note: "fresh install, no assets stored",
    });

    expect(mocks.quarantineR2AgencyPrefixes).not.toHaveBeenCalled();
    expect(result.quarantine).toEqual({ copied: 0, deleted: 0, prefixes: [] });
    expect(fake.agencyDeletes).toHaveLength(1);
    expect(fake.auditWrites[0]?.action).toBe("agency.hard_delete");
  });

  it("fires R2 quarantine BEFORE opening the DB TX and records counts in the audit row", async () => {
    mocks.agencyFindUnique.mockResolvedValueOnce({
      id: "agc_1",
      name: "Acme",
      plan: "NETWORK" satisfies Plan,
      stripeSubscriptionId: null,
      stripeCustomerId: "cus_1",
      createdAt: new Date("2026-01-01"),
    });
    mocks.getR2Client.mockReturnValueOnce({ client: {}, bucket: "test" });
    mocks.agencyDelete.mockResolvedValueOnce({});
    const fake = buildFakeTx();

    // Track call order: quarantine must fire BEFORE $transaction opens so a
    // R2 failure leaves the DB row intact.
    const order: string[] = [];
    mocks.quarantineR2AgencyPrefixes.mockImplementationOnce(async () => {
      order.push("quarantine");
      return {
        copied: 12,
        deleted: 12,
        quarantinePrefixes: [
          "_quarantine/agc_1/2026-07-01T00:00:00.000Z/audio/agc_1/",
          "_quarantine/agc_1/2026-07-01T00:00:00.000Z/artwork/agc_1/",
        ],
      };
    });
    mocks.$transaction.mockImplementationOnce(async (cb: (t: unknown) => Promise<unknown>) => {
      order.push("transaction");
      return cb(fake.tx);
    });

    const result = await hardDeleteAgency(ctx(), {
      id: "agc_1",
      confirmName: "Acme",
      note: "GDPR erasure — customer confirmed via ticket 42",
    });

    expect(order).toEqual(["quarantine", "transaction"]);
    expect(result.quarantine.copied).toBe(12);
    expect(fake.agencyDeletes[0]).toEqual({ where: { id: "agc_1" } });
    const audit = fake.auditWrites[0]!;
    expect(audit.action).toBe("agency.hard_delete");
    expect(audit.targetAgencyId).toBe("agc_1");
    expect(audit.targetEntityType).toBe("agency");
    expect(audit.note).toBe("GDPR erasure — customer confirmed via ticket 42");
    // The `before` snapshot embeds the pre-delete agency shape + the
    // quarantine counts so a future restorer knows where to look.
    const before = audit.before as { name: string; quarantine: { copied: number } };
    expect(before.name).toBe("Acme");
    expect(before.quarantine.copied).toBe(12);
  });

  it("propagates a quarantine failure so the DB row is NOT deleted", async () => {
    mocks.agencyFindUnique.mockResolvedValueOnce({
      id: "agc_1",
      name: "Acme",
      plan: "STUDIO" satisfies Plan,
      stripeSubscriptionId: null,
      stripeCustomerId: null,
      createdAt: new Date("2026-01-01"),
    });
    mocks.getR2Client.mockReturnValueOnce({ client: {}, bucket: "test" });
    mocks.quarantineR2AgencyPrefixes.mockRejectedValueOnce(new Error("R2 unreachable"));

    await expect(
      hardDeleteAgency(ctx(), {
        id: "agc_1",
        confirmName: "Acme",
        note: "delete attempt with R2 offline",
      }),
    ).rejects.toThrow("R2 unreachable");
    // TX never opened.
    expect(mocks.$transaction).not.toHaveBeenCalled();
  });
});

/**
 * The dedupe-ledger primitive is small but load-bearing for the Stripe
 * webhook handler — get it wrong and a single network blip retransmits a
 * subscription update three times. These tests pin the create-vs-conflict
 * branching and the delete-on-rollback path.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  prisma: {
    webhookDelivery: {
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

vi.mock("@/server/db/client", () => ({ prisma: mocks.prisma }));

import { markWebhookProcessed, unmarkWebhookProcessed } from "@/server/db/webhook-deliveries";

beforeEach(() => {
  mocks.prisma.webhookDelivery.create.mockReset();
  mocks.prisma.webhookDelivery.deleteMany.mockReset();
});

function uniqueViolation(): Prisma.PrismaClientKnownRequestError {
  // The constructor signature changed across Prisma majors; construct via
  // `Object.assign` so the test isn't coupled to a specific version.
  const err = Object.assign(
    new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "test",
    }),
    { meta: { target: ["source", "eventId"] } },
  );
  return err;
}

describe("markWebhookProcessed", () => {
  it("creates a ledger row and returns deduped=false on the first delivery", async () => {
    mocks.prisma.webhookDelivery.create.mockResolvedValue({ id: "wd_1" });

    const result = await markWebhookProcessed("stripe", "evt_123", "customer.subscription.updated");

    expect(result).toEqual({ deduped: false });
    expect(mocks.prisma.webhookDelivery.create).toHaveBeenCalledWith({
      data: {
        source: "stripe",
        eventId: "evt_123",
        eventType: "customer.subscription.updated",
      },
    });
  });

  it("returns deduped=true on a P2002 unique violation (concurrent retry)", async () => {
    mocks.prisma.webhookDelivery.create.mockRejectedValueOnce(uniqueViolation());

    const result = await markWebhookProcessed("stripe", "evt_123", "invoice.paid");

    expect(result).toEqual({ deduped: true });
  });

  it("rethrows non-P2002 prisma errors so the handler can surface 500", async () => {
    const fatal = Object.assign(
      new Prisma.PrismaClientKnownRequestError("connection lost", {
        code: "P2024",
        clientVersion: "test",
      }),
    );
    mocks.prisma.webhookDelivery.create.mockRejectedValueOnce(fatal);

    await expect(markWebhookProcessed("stripe", "evt_456", "invoice.paid")).rejects.toBe(fatal);
  });

  it("rethrows unknown errors unchanged", async () => {
    const generic = new Error("DB down");
    mocks.prisma.webhookDelivery.create.mockRejectedValueOnce(generic);

    await expect(markWebhookProcessed("stripe", "evt_456", "invoice.paid")).rejects.toBe(generic);
  });
});

describe("unmarkWebhookProcessed", () => {
  it("deletes by (source, eventId) so the provider's retry re-processes", async () => {
    mocks.prisma.webhookDelivery.deleteMany.mockResolvedValue({ count: 1 });

    await unmarkWebhookProcessed("stripe", "evt_123");

    expect(mocks.prisma.webhookDelivery.deleteMany).toHaveBeenCalledWith({
      where: { source: "stripe", eventId: "evt_123" },
    });
  });

  it("tolerates a missing row — no throw on count=0 (cleanup path)", async () => {
    mocks.prisma.webhookDelivery.deleteMany.mockResolvedValue({ count: 0 });

    await expect(unmarkWebhookProcessed("stripe", "evt_never_existed")).resolves.toBeUndefined();
  });
});

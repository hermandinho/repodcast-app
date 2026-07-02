/**
 * Phase 3.5 — pin the Inngest priority-queue + concurrency config on the
 * two generation fns. This is a config-shape test, not a behavior test:
 * without a live Inngest dev server there's no way to verify that a
 * NETWORK event actually cuts ahead of a STUDIO one queued 30 s earlier.
 * What we CAN verify is that the config the SDK will ship to Inngest
 * has the right expression + the right limits, so a future refactor
 * that drops one silently gets flagged.
 */

import { describe, expect, it } from "vitest";
import { generateEpisode } from "@/inngest/functions/generate-episode";
import { regenerateOutput } from "@/inngest/functions/regenerate-output";

// Both functions expose their construction opts via a readonly `.opts`
// property (see `InngestFunction.d.ts`). Cast to unknown → indexed access
// so we can inspect fields the public typings don't publicly promise.
type FnWithOpts = { opts: Record<string, unknown> };

function optsOf(fn: unknown): Record<string, unknown> {
  return (fn as FnWithOpts).opts;
}

describe("generateEpisode — Phase 3.5 priority queue", () => {
  const opts = optsOf(generateEpisode);

  it("bumps NETWORK-tier dispatches ahead of default priority", () => {
    // Priority is evaluated at enqueue time against `event.data`. A
    // NETWORK dispatch returns 120 (cut ahead of anything queued in the
    // last 2 minutes); everything else returns 0. Legacy events with
    // no `plan` also fall to 0 — the ternary evaluates `undefined ==
    // 'NETWORK'` → false, which is exactly what we want.
    expect(opts.priority).toEqual({
      run: "event.data.plan == 'NETWORK' ? 120 : 0",
    });
  });

  it("caps global concurrency AND per-agency concurrency", () => {
    // Two-layer concurrency:
    //   Global limit protects Anthropic rate + monthly $ budget.
    //   Per-agency limit stops one agency's batch from monopolizing the
    //   global pool. Key falls back to `event.id` so events missing an
    //   agencyId (legacy dispatchers pre-3.5) don't erroneously share a
    //   bucket labeled `undefined`.
    expect(opts.concurrency).toEqual([
      { limit: 10 },
      {
        scope: "fn",
        key: "event.data.agencyId ?? event.id",
        limit: 3,
      },
    ]);
  });
});

describe("regenerateOutput — Phase 3.5 priority queue", () => {
  const opts = optsOf(regenerateOutput);

  it("mirrors generateEpisode's priority so both hot paths honor NETWORK", () => {
    // Regenerate is arguably MORE visible than batch — a Reviewer is
    // staring at a spinner in the drawer. Same expression as generate so
    // the two hot paths behave identically for a NETWORK tenant.
    expect(opts.priority).toEqual({
      run: "event.data.plan == 'NETWORK' ? 120 : 0",
    });
  });

  it("mirrors generateEpisode's concurrency layers", () => {
    expect(opts.concurrency).toEqual([
      { limit: 10 },
      {
        scope: "fn",
        key: "event.data.agencyId ?? event.id",
        limit: 3,
      },
    ]);
  });
});

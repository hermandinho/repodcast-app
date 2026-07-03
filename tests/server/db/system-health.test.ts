/**
 * Phase 3.6.12 — `/root/system` reachability grid.
 *
 * The load-bearing primitive is `runProbe` — every service probe funnels
 * through it, so the guarantee ("a hung provider must never take the health
 * page hostage") is pinned here.
 *
 * Tests cover:
 *   - happy-path shape (status/latency/detail)
 *   - thrown error → `down` with the error message (truncated at 200 chars)
 *   - timeout → `down` with "Timed out after Nms"
 *   - degraded pass-through from the probe callback
 *   - `worstOf` aggregation across mixed states
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runProbe, worstOf, type HealthProbe } from "@/server/db/system/health";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ============================================================
// runProbe
// ============================================================

describe("runProbe", () => {
  it("returns ok + latency when the callback resolves within timeout", async () => {
    const p = runProbe("postgres", "Postgres", async () => {
      await Promise.resolve();
      return { status: "ok", detail: "SELECT 1 succeeded" };
    });
    await vi.advanceTimersByTimeAsync(0);
    const probe = await p;

    expect(probe.service).toBe("postgres");
    expect(probe.label).toBe("Postgres");
    expect(probe.status).toBe("ok");
    expect(probe.detail).toBe("SELECT 1 succeeded");
    expect(probe.latencyMs).toBeGreaterThanOrEqual(0);
    expect(probe.checkedAt).toBeInstanceOf(Date);
  });

  it("marks the probe `down` with a timeout detail when the callback hangs", async () => {
    const p = runProbe("stripe", "Stripe", async () => {
      // Never resolve — the wrapper's timeout is what returns.
      await new Promise(() => {
        /* hang */
      });
      return { status: "ok", detail: "unreachable" };
    });
    // Advance beyond the 2500ms probe timeout.
    await vi.advanceTimersByTimeAsync(2600);
    const probe = await p;

    expect(probe.status).toBe("down");
    expect(probe.detail).toContain("Timed out");
    expect(probe.detail).toContain("2500ms");
  });

  it("catches thrown errors and surfaces the message on a `down` probe", async () => {
    const p = runProbe("r2", "R2", async () => {
      throw new Error("bucket forbidden");
    });
    await vi.advanceTimersByTimeAsync(0);
    const probe = await p;

    expect(probe.status).toBe("down");
    expect(probe.detail).toBe("bucket forbidden");
  });

  it("truncates a giant error message to keep the tile readable", async () => {
    const giant = "x".repeat(500);
    const p = runProbe("r2", "R2", async () => {
      throw new Error(giant);
    });
    await vi.advanceTimersByTimeAsync(0);
    const probe = await p;

    expect(probe.detail.length).toBeLessThanOrEqual(200);
    expect(probe.detail.endsWith("…")).toBe(true);
  });

  it("passes through `degraded` from the callback without demoting it", async () => {
    const p = runProbe("anthropic", "Anthropic", async () => ({
      status: "degraded",
      detail: "Last call 36h ago",
    }));
    await vi.advanceTimersByTimeAsync(0);
    const probe = await p;

    expect(probe.status).toBe("degraded");
    expect(probe.detail).toBe("Last call 36h ago");
  });

  it("handles non-Error throws (strings, unknowns) without crashing", async () => {
    const p = runProbe("clerk", "Clerk", async () => {
      throw "string error";
    });
    await vi.advanceTimersByTimeAsync(0);
    const probe = await p;

    expect(probe.status).toBe("down");
    expect(probe.detail).toBe("string error");
  });
});

// ============================================================
// worstOf
// ============================================================

describe("worstOf", () => {
  it("returns `ok` when every probe is ok", () => {
    expect(worstOf([buildProbe("ok"), buildProbe("ok")])).toBe("ok");
  });

  it("returns `unconfigured` when at least one is unconfigured and none are worse", () => {
    expect(worstOf([buildProbe("ok"), buildProbe("unconfigured"), buildProbe("ok")])).toBe(
      "unconfigured",
    );
  });

  it("prefers `degraded` over `unconfigured`", () => {
    expect(worstOf([buildProbe("unconfigured"), buildProbe("degraded"), buildProbe("ok")])).toBe(
      "degraded",
    );
  });

  it("prefers `down` over anything else — it dominates the banner", () => {
    expect(
      worstOf([
        buildProbe("ok"),
        buildProbe("degraded"),
        buildProbe("unconfigured"),
        buildProbe("down"),
      ]),
    ).toBe("down");
  });

  it("returns `ok` on an empty list (defensive default)", () => {
    expect(worstOf([])).toBe("ok");
  });
});

// ============================================================
// Fixtures
// ============================================================

function buildProbe(status: HealthProbe["status"]): HealthProbe {
  return {
    service: "postgres",
    label: "Postgres",
    status,
    latencyMs: 42,
    detail: `state=${status}`,
    checkedAt: new Date("2026-06-30T00:00:00Z"),
  };
}

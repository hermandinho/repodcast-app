/**
 * `trackServer` is the only analytics surface with real branching logic —
 * the client wrapper just defers to posthog-js. We verify the no-op gate,
 * the request shape, and that fetch errors never escape to the caller
 * (telemetry must not block the pipeline).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Platform } from "@prisma/client";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.resetModules();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
  delete process.env.NEXT_PUBLIC_POSTHOG_HOST;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("trackServer", () => {
  it("is a silent no-op when NEXT_PUBLIC_POSTHOG_KEY is unset", async () => {
    const { trackServer } = await import("@/server/analytics/track");

    await trackServer(
      "generation_completed",
      {
        episodeId: "ep1",
        platform: Platform.LINKEDIN,
        outputTokens: 800,
        durationMs: 12000,
      },
      { distinctId: "agency:a1", agencyId: "a1" },
    );

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("POSTs to the capture endpoint with the api key + event payload when configured", async () => {
    process.env.NEXT_PUBLIC_POSTHOG_KEY = "phc_test";
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200 });

    const { trackServer } = await import("@/server/analytics/track");

    await trackServer(
      "generation_completed",
      {
        episodeId: "ep1",
        platform: Platform.LINKEDIN,
        outputTokens: 800,
        durationMs: 12000,
      },
      { distinctId: "agency:a1", agencyId: "a1" },
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://us.i.posthog.com/capture/");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      api_key: "phc_test",
      event: "generation_completed",
      distinct_id: "agency:a1",
      properties: expect.objectContaining({
        episodeId: "ep1",
        platform: Platform.LINKEDIN,
        outputTokens: 800,
        durationMs: 12000,
        agencyId: "a1",
        $groups: { agency: "a1" },
      }),
    });
  });

  it("honours NEXT_PUBLIC_POSTHOG_HOST and strips trailing slash", async () => {
    process.env.NEXT_PUBLIC_POSTHOG_KEY = "phc_test";
    process.env.NEXT_PUBLIC_POSTHOG_HOST = "https://eu.posthog.io/";
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200 });

    const { trackServer } = await import("@/server/analytics/track");

    await trackServer(
      "output_approved",
      {
        outputId: "o1",
        platform: "li",
        edited: false,
        editDistance: 0,
        showId: "sh_1",
        editRatio: 0,
        postReady: true,
      },
      { distinctId: "agency:a1" },
    );

    expect(fetchMock).toHaveBeenCalledWith("https://eu.posthog.io/capture/", expect.anything());
  });

  it("swallows fetch failures — telemetry never blocks the caller", async () => {
    process.env.NEXT_PUBLIC_POSTHOG_KEY = "phc_test";
    fetchMock.mockRejectedValueOnce(new Error("network blew up"));
    // Silence the console.warn from the catch path so the test runner stays clean.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { trackServer } = await import("@/server/analytics/track");

    await expect(
      trackServer(
        "output_edited",
        { outputId: "o1", platform: "x", delta: 5, totalEditDistance: 12 },
        { distinctId: "agency:a1" },
      ),
    ).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalled();
  });

  it("warns but doesn't throw on a non-2xx response", async () => {
    process.env.NEXT_PUBLIC_POSTHOG_KEY = "phc_test";
    fetchMock.mockResolvedValueOnce({ ok: false, status: 403 });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { trackServer } = await import("@/server/analytics/track");

    await expect(
      trackServer(
        "output_approved",
        {
          outputId: "o1",
          platform: "x",
          edited: true,
          editDistance: 14,
          showId: "sh_1",
          editRatio: 0.07,
          postReady: true,
        },
        { distinctId: "agency:a1" },
      ),
    ).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("output_approved returned 403"));
  });
});

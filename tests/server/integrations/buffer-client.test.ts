/**
 * Phase 3.3 — Buffer API client.
 *
 * Behavior pinned:
 *   - OAuth `exchangeCode` + `refreshAccessToken` POST form-encoded bodies
 *     to Buffer's token endpoint with all the required grant fields and
 *     compute `expiresAt` from `expires_in`.
 *   - GraphQL calls send JSON with a bearer token; 5xx retries with backoff,
 *     4xx throws `BufferError`.
 *   - `deletePost` catches Buffer's "not found" surface and returns
 *     `{ deleted: false }` instead of throwing (404 = deleted-ok semantics).
 *   - GraphQL 200-with-errors is treated as a 400 `BufferError`.
 *   - `createPost` short-circuits `MutationError` unions.
 *   - `listOrganizationsAndChannels` maps Buffer's `service` string onto
 *     our `Platform` enum (unknown service → platform: null).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Platform } from "@prisma/client";
import {
  BufferError,
  createPost,
  deletePost,
  exchangeCode,
  listOrganizationsAndChannels,
  listRecentPostsForOrg,
  refreshAccessToken,
} from "@/server/integrations/buffer";

// ============================================================
// Helpers
// ============================================================

type FetchArgs = { url: string; init: RequestInit };
const fetchCalls: FetchArgs[] = [];

function stubFetch(handler: (call: FetchArgs) => Response | Promise<Response>): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const call = { url, init: init ?? {} };
      fetchCalls.push(call);
      return handler(call);
    }),
  );
}

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

beforeEach(() => {
  fetchCalls.length = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ============================================================
// exchangeCode / refreshAccessToken
// ============================================================

describe("exchangeCode — form-encoded token exchange", () => {
  it("POSTs authorization_code grant with client + PKCE fields and derives expiresAt from expires_in", async () => {
    stubFetch(() =>
      jsonResponse({
        access_token: "at_new",
        refresh_token: "rt_new",
        expires_in: 3600,
      }),
    );
    const before = Date.now();
    const result = await exchangeCode({
      code: "the_code",
      codeVerifier: "the_verifier",
      clientId: "cid",
      clientSecret: "secret",
      redirectUri: "https://app.example/cb",
    });

    expect(fetchCalls).toHaveLength(1);
    const { url, init } = fetchCalls[0]!;
    expect(url).toMatch(/token/i);
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    // Body is URL-encoded, not JSON.
    const form = new URLSearchParams(init.body as string);
    expect(form.get("grant_type")).toBe("authorization_code");
    expect(form.get("client_id")).toBe("cid");
    expect(form.get("client_secret")).toBe("secret");
    expect(form.get("redirect_uri")).toBe("https://app.example/cb");
    expect(form.get("code")).toBe("the_code");
    expect(form.get("code_verifier")).toBe("the_verifier");

    expect(result.accessToken).toBe("at_new");
    expect(result.refreshToken).toBe("rt_new");
    expect(result.expiresAt).toBeInstanceOf(Date);
    // ~ 1 hour ahead of `before` — allow a comfortable ±5s runtime skew.
    const delta = result.expiresAt!.getTime() - before;
    expect(delta).toBeGreaterThan(3600 * 1000 - 5000);
    expect(delta).toBeLessThan(3600 * 1000 + 5000);
  });

  it("returns expiresAt null when expires_in is missing", async () => {
    stubFetch(() => jsonResponse({ access_token: "at" }));
    const result = await exchangeCode({
      code: "c",
      codeVerifier: "v",
      clientId: "cid",
      clientSecret: "s",
      redirectUri: "https://app/cb",
    });
    expect(result.expiresAt).toBeNull();
    expect(result.refreshToken).toBeNull();
  });

  it("throws BufferError on non-2xx", async () => {
    stubFetch(() => new Response("bad grant", { status: 400 }));
    await expect(
      exchangeCode({
        code: "c",
        codeVerifier: "v",
        clientId: "cid",
        clientSecret: "s",
        redirectUri: "https://app/cb",
      }),
    ).rejects.toBeInstanceOf(BufferError);
  });

  it("throws BufferError when the 200 body isn't JSON", async () => {
    stubFetch(
      () =>
        new Response("<html>oops</html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
    );
    await expect(
      exchangeCode({
        code: "c",
        codeVerifier: "v",
        clientId: "cid",
        clientSecret: "s",
        redirectUri: "https://app/cb",
      }),
    ).rejects.toBeInstanceOf(BufferError);
  });

  it("throws BufferError when access_token is missing from an OK response", async () => {
    stubFetch(() => jsonResponse({ refresh_token: "rt_only" }));
    await expect(
      exchangeCode({
        code: "c",
        codeVerifier: "v",
        clientId: "cid",
        clientSecret: "s",
        redirectUri: "https://app/cb",
      }),
    ).rejects.toBeInstanceOf(BufferError);
  });
});

describe("refreshAccessToken — same shape, refresh_token grant", () => {
  it("POSTs refresh_token grant and returns a rotated refresh_token when present", async () => {
    stubFetch(() => jsonResponse({ access_token: "at2", refresh_token: "rt2", expires_in: 3600 }));
    const result = await refreshAccessToken({
      refreshToken: "rt_old",
      clientId: "cid",
      clientSecret: "secret",
    });
    const form = new URLSearchParams(fetchCalls[0]!.init.body as string);
    expect(form.get("grant_type")).toBe("refresh_token");
    expect(form.get("refresh_token")).toBe("rt_old");
    expect(form.get("client_id")).toBe("cid");
    expect(form.get("client_secret")).toBe("secret");
    expect(result.accessToken).toBe("at2");
    expect(result.refreshToken).toBe("rt2");
  });

  it("returns refreshToken null when Buffer doesn't rotate it (callers keep the old one)", async () => {
    stubFetch(() => jsonResponse({ access_token: "at2", expires_in: 3600 }));
    const result = await refreshAccessToken({
      refreshToken: "rt_old",
      clientId: "cid",
      clientSecret: "secret",
    });
    expect(result.refreshToken).toBeNull();
  });

  it("4xx surfaces as BufferError so callers can distinguish 'reconnect required' from transport blips", async () => {
    stubFetch(() => new Response("invalid_grant", { status: 400 }));
    await expect(
      refreshAccessToken({
        refreshToken: "rt_bad",
        clientId: "cid",
        clientSecret: "s",
      }),
    ).rejects.toBeInstanceOf(BufferError);
  });
});

// ============================================================
// bufferGraphQL — 5xx retry + auth headers
// ============================================================

describe("Buffer GraphQL transport", () => {
  it("sends Bearer + JSON headers to the GraphQL endpoint", async () => {
    stubFetch(() => jsonResponse({ data: { account: { organizations: [] } } }));
    await listOrganizationsAndChannels("at_1");
    const { url, init } = fetchCalls[0]!;
    expect(url).toMatch(/api\.buffer\.com/);
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer at_1");
    expect(headers["Content-Type"]).toBe("application/json");
    // Body is JSON with `query` + `variables`.
    const body = JSON.parse(init.body as string);
    expect(body).toEqual(expect.objectContaining({ query: expect.any(String) }));
  });

  it("retries 5xx up to 3 times with backoff, then succeeds", async () => {
    let attempt = 0;
    stubFetch(() => {
      attempt += 1;
      if (attempt <= 2) return new Response("boom", { status: 502 });
      return jsonResponse({ data: { account: { organizations: [] } } });
    });
    // Speed up the backoff — the module uses `setTimeout`, which vitest fake
    // timers can compress. Use vi.useFakeTimers + tick manually.
    vi.useFakeTimers();
    const promise = listOrganizationsAndChannels("at_1");
    // Backoff schedule: 250ms → 1000ms. Advance past both.
    await vi.advanceTimersByTimeAsync(300);
    await vi.advanceTimersByTimeAsync(1100);
    await promise;
    vi.useRealTimers();
    expect(fetchCalls).toHaveLength(3);
  });

  it("throws BufferError on 4xx immediately (no retry)", async () => {
    stubFetch(() => new Response("bad", { status: 400 }));
    await expect(listOrganizationsAndChannels("at_1")).rejects.toBeInstanceOf(BufferError);
    expect(fetchCalls).toHaveLength(1);
  });

  it("throws BufferError when GraphQL returns 200 with an `errors` array (validation errors on 200)", async () => {
    stubFetch(() => jsonResponse({ errors: [{ message: "field not found" }] }));
    await expect(listOrganizationsAndChannels("at_1")).rejects.toBeInstanceOf(BufferError);
  });

  it("401 without an auth refresher throws BufferError (no retry loop)", async () => {
    stubFetch(() => new Response("nope", { status: 401 }));
    await expect(listOrganizationsAndChannels("at_1")).rejects.toBeInstanceOf(BufferError);
    expect(fetchCalls).toHaveLength(1);
  });

  it("401 → refresher → retry once with the fresh token", async () => {
    let attempt = 0;
    stubFetch(({ init }) => {
      attempt += 1;
      const authHeader = (init.headers as Record<string, string>).Authorization;
      if (attempt === 1) {
        expect(authHeader).toBe("Bearer stale_token");
        return new Response("unauthorized", { status: 401 });
      }
      expect(authHeader).toBe("Bearer fresh_token");
      return jsonResponse({ data: { account: { organizations: [] } } });
    });
    const result = await listOrganizationsAndChannels("stale_token", {
      onUnauthenticated: async () => "fresh_token",
    });
    expect(fetchCalls).toHaveLength(2);
    expect(result.organizations).toEqual([]);
  });

  it("200-with-UNAUTHENTICATED-GraphQL-error is treated identically to 401", async () => {
    let attempt = 0;
    stubFetch(() => {
      attempt += 1;
      if (attempt === 1) {
        return jsonResponse({
          errors: [{ message: "denied", extensions: { code: "UNAUTHENTICATED" } }],
        });
      }
      return jsonResponse({ data: { account: { organizations: [] } } });
    });
    await listOrganizationsAndChannels("stale", {
      onUnauthenticated: async () => "fresh",
    });
    expect(fetchCalls).toHaveLength(2);
  });

  it("refresher returning null propagates the 401 as BufferError", async () => {
    stubFetch(() => new Response("nope", { status: 401 }));
    await expect(
      listOrganizationsAndChannels("stale", { onUnauthenticated: async () => null }),
    ).rejects.toBeInstanceOf(BufferError);
    expect(fetchCalls).toHaveLength(1);
  });
});

// ============================================================
// listOrganizationsAndChannels — service → Platform mapping
// ============================================================

describe("listOrganizationsAndChannels", () => {
  it("maps Buffer's `service` onto our Platform enum; unknown services fall through as platform=null", async () => {
    let step = 0;
    stubFetch(() => {
      step += 1;
      if (step === 1) {
        return jsonResponse({
          data: {
            account: {
              organizations: [{ id: "org_1", name: "Acme" }],
            },
          },
        });
      }
      // Second call: channels for org_1
      return jsonResponse({
        data: {
          channels: [
            { id: "chn_tw", name: "Twitter", service: "twitter" },
            { id: "chn_li", name: "LinkedIn", service: "linkedin" },
            { id: "chn_ig", name: "Instagram", service: "instagram" },
            { id: "chn_tt", name: "TikTok", service: "tiktok" },
            { id: "chn_fb", name: "Facebook", service: "facebook" }, // unsupported
          ],
        },
      });
    });

    const { organizations, channels } = await listOrganizationsAndChannels("at_1");

    expect(organizations).toEqual([{ id: "org_1", name: "Acme" }]);
    // Every channel is returned; only supported services get a Platform enum.
    expect(channels.map((c) => ({ id: c.id, platform: c.platform }))).toEqual([
      { id: "chn_tw", platform: Platform.TWITTER },
      { id: "chn_li", platform: Platform.LINKEDIN },
      { id: "chn_ig", platform: Platform.INSTAGRAM },
      { id: "chn_tt", platform: Platform.TIKTOK },
      { id: "chn_fb", platform: null },
    ]);
    // All channels are tagged with their org id — Buffer's channel query is
    // per-org, so the caller needs the reverse lookup for the sync cron.
    expect(channels.every((c) => c.organizationId === "org_1")).toBe(true);
  });

  it("returns empty channels when the account has no orgs (skips the per-org channel query)", async () => {
    stubFetch(() => jsonResponse({ data: { account: { organizations: [] } } }));
    const result = await listOrganizationsAndChannels("at_1");
    expect(result.organizations).toEqual([]);
    expect(result.channels).toEqual([]);
    expect(fetchCalls).toHaveLength(1);
  });
});

// ============================================================
// createPost / deletePost / listRecentPostsForOrg
// ============================================================

describe("createPost", () => {
  it("returns id + publicUrl on PostActionSuccess (falls back to publish.buffer.com URL when externalLink is null)", async () => {
    stubFetch(() =>
      jsonResponse({
        data: {
          createPost: {
            __typename: "PostActionSuccess",
            post: { id: "post_1", externalLink: null },
          },
        },
      }),
    );
    const result = await createPost({
      accessToken: "at",
      channelId: "chn_tw",
      text: "hi",
      dueAt: new Date("2027-01-01T00:00:00.000Z"),
    });
    expect(result).toEqual({
      id: "post_1",
      publicUrl: "https://publish.buffer.com/posts/post_1",
    });
    // The mutation input carries mode:customScheduled + ISO dueAt.
    const body = JSON.parse(fetchCalls[0]!.init.body as string) as {
      variables: { input: { mode: string; dueAt: string; text: string; channelId: string } };
    };
    expect(body.variables.input.mode).toBe("customScheduled");
    expect(body.variables.input.dueAt).toBe("2027-01-01T00:00:00.000Z");
    expect(body.variables.input.text).toBe("hi");
    expect(body.variables.input.channelId).toBe("chn_tw");
  });

  it("MutationError → BufferError with the message", async () => {
    stubFetch(() =>
      jsonResponse({
        data: {
          createPost: { __typename: "MutationError", message: "channel disconnected" },
        },
      }),
    );
    await expect(
      createPost({
        accessToken: "at",
        channelId: "chn_tw",
        text: "hi",
        dueAt: new Date(),
      }),
    ).rejects.toBeInstanceOf(BufferError);
  });
});

describe("deletePost — 404 = deleted-ok", () => {
  it("returns { deleted: true } on success", async () => {
    stubFetch(() =>
      jsonResponse({
        data: {
          deletePost: { __typename: "DeletePostSuccess", deletedPostId: "post_1" },
        },
      }),
    );
    const result = await deletePost({ accessToken: "at", id: "post_1" });
    expect(result).toEqual({ deleted: true });
  });

  it("swallows 'not found' 4xx as `deleted: false` (idempotent teardown)", async () => {
    stubFetch(() => new Response("Post not found", { status: 400 }));
    const result = await deletePost({ accessToken: "at", id: "gone" });
    expect(result).toEqual({ deleted: false });
  });

  it("swallows 'does not exist' 200-with-errors as `deleted: false`", async () => {
    stubFetch(() => jsonResponse({ errors: [{ message: "Post does not exist" }] }));
    const result = await deletePost({ accessToken: "at", id: "gone" });
    expect(result).toEqual({ deleted: false });
  });

  it("re-throws non-404 4xx (real failures still surface)", async () => {
    stubFetch(() => new Response("permission denied", { status: 403 }));
    await expect(deletePost({ accessToken: "at", id: "p" })).rejects.toBeInstanceOf(BufferError);
  });
});

describe("listRecentPostsForOrg", () => {
  it("normalises the GraphQL edges into flat BufferPost rows with Date fields", async () => {
    stubFetch(() =>
      jsonResponse({
        data: {
          posts: {
            edges: [
              {
                node: {
                  id: "p1",
                  status: "sent",
                  dueAt: "2026-07-01T00:00:00.000Z",
                  sentAt: "2026-07-01T00:00:05.000Z",
                  externalLink: "https://twitter.com/foo/1",
                  channelId: "chn_tw",
                },
              },
              {
                node: {
                  id: "p2",
                  status: "buffer",
                  dueAt: null,
                  sentAt: null,
                  externalLink: null,
                  channelId: "chn_tw",
                },
              },
            ],
          },
        },
      }),
    );
    const result = await listRecentPostsForOrg({
      accessToken: "at",
      organizationId: "org_1",
      channelIds: ["chn_tw"],
      first: 25,
    });
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      id: "p1",
      status: "sent",
      dueAt: new Date("2026-07-01T00:00:00.000Z"),
      sentAt: new Date("2026-07-01T00:00:05.000Z"),
      externalLink: "https://twitter.com/foo/1",
      channelId: "chn_tw",
    });
    expect(result[1]!.sentAt).toBeNull();
    // Variables include the channelIds filter.
    const body = JSON.parse(fetchCalls[0]!.init.body as string) as {
      variables: {
        first: number;
        input: { organizationId: string; filter: { channelIds?: string[] } };
      };
    };
    expect(body.variables.first).toBe(25);
    expect(body.variables.input.organizationId).toBe("org_1");
    expect(body.variables.input.filter.channelIds).toEqual(["chn_tw"]);
  });
});

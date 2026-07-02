import "server-only";

import { Platform } from "@prisma/client";

/**
 * Phase 3.3 — Buffer API client.
 *
 * Buffer's current API is GraphQL at `https://api.buffer.com`, auth via
 * OAuth 2 (PKCE) at `auth.buffer.com`. The classic v1 REST API was
 * deprecated for new OAuth apps.
 *
 * Flow:
 *   1. `exchangeCode` — POST auth.buffer.com/token with code + PKCE verifier.
 *   2. `listOrganizationsAndChannels` — walk `account.organizations` and
 *      `channels(input: { organizationId })` to build the Platform → channelId
 *      map we store on `AgencyIntegration.meta`.
 *   3. `createPost` — schedule a post on a specific channel at a specific
 *      time via the `createPost` mutation with `mode: customScheduled` +
 *      `dueAt` (ISO 8601 UTC).
 *   4. `findPostById` — batch-poll recent posts on a channel to discover
 *      state transitions (buffer → sent). Buffer's docs don't expose a
 *      single-post-by-id query, so we scan the recent set and match.
 *   5. `deletePost` — cancel a scheduled post.
 *
 * All calls share: 15 s AbortController timeout, 3-attempt retry on 5xx
 * or network failures, and a `BufferError { status, body }` for 4xx that
 * callers can catch to surface actionable messages.
 */

const BUFFER_GRAPHQL_URL = process.env.BUFFER_API_URL ?? "https://api.buffer.com";
const BUFFER_TOKEN_URL = process.env.BUFFER_TOKEN_URL ?? "https://auth.buffer.com/token";
const REQUEST_TIMEOUT_MS = 15_000;
const RETRY_DELAYS_MS = [250, 1000, 4000];

export class BufferError extends Error {
  readonly status: number;
  readonly body: string;
  constructor(status: number, body: string) {
    super(`Buffer API ${status}: ${body.slice(0, 200)}`);
    this.name = "BufferError";
    this.status = status;
    this.body = body;
  }
}

/**
 * Buffer's `service` string → our Platform enum. Anything not in this map
 * is silently dropped from the channel bag — we only publish to the four
 * supported social platforms.
 */
const BUFFER_SERVICE_TO_PLATFORM: Record<string, Platform> = {
  twitter: Platform.TWITTER,
  linkedin: Platform.LINKEDIN,
  instagram: Platform.INSTAGRAM,
  tiktok: Platform.TIKTOK,
};

export type BufferOrganization = { id: string; name: string };

export type BufferChannel = {
  id: string;
  name: string;
  service: string;
  organizationId: string;
  platform: Platform | null;
};

export type BufferPost = {
  id: string;
  status: string;
  dueAt: Date | null;
  sentAt: Date | null;
  externalLink: string | null;
  channelId: string | null;
};

export type ExchangeCodeResult = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
};

/**
 * Result shape shared by `exchangeCode` and `refreshAccessToken` — Buffer's
 * token endpoint returns the same JSON envelope for both grant types.
 */
export type RefreshAccessTokenResult = ExchangeCodeResult;

// ============================================================
// OAuth token exchange
// ============================================================

export async function exchangeCode(params: {
  code: string;
  codeVerifier: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<ExchangeCodeResult> {
  const form = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: params.clientId,
    client_secret: params.clientSecret,
    redirect_uri: params.redirectUri,
    code: params.code,
    code_verifier: params.codeVerifier,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(BUFFER_TOKEN_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  const bodyText = await res.text();
  if (!res.ok) throw new BufferError(res.status, bodyText);
  let data: { access_token?: string; refresh_token?: string; expires_in?: number };
  try {
    data = JSON.parse(bodyText);
  } catch {
    throw new BufferError(res.status, `Non-JSON token response: ${bodyText.slice(0, 200)}`);
  }
  if (!data.access_token) {
    throw new BufferError(500, "Buffer token endpoint returned no access_token");
  }
  const expiresAt =
    typeof data.expires_in === "number" && data.expires_in > 0
      ? new Date(Date.now() + data.expires_in * 1000)
      : null;
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresAt,
  };
}

/**
 * Exchange a refresh token for a fresh access token. Buffer OAuth 2 access
 * tokens expire (~1 hour); without this call the stored token 401s and every
 * downstream Buffer surface (schedule, sync, channel refresh) breaks until
 * an OWNER/ADMIN manually disconnects and reconnects.
 *
 * Buffer may rotate the refresh token as part of the response — when
 * `refresh_token` is present in the payload it supersedes the old one; when
 * absent, callers should keep the original.
 *
 * Errors surface as `BufferError` so callers can distinguish "reconnect
 * required" (4xx from the token endpoint) from transport blips.
 */
export async function refreshAccessToken(params: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}): Promise<RefreshAccessTokenResult> {
  const form = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: params.refreshToken,
    client_id: params.clientId,
    client_secret: params.clientSecret,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(BUFFER_TOKEN_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  const bodyText = await res.text();
  if (!res.ok) throw new BufferError(res.status, bodyText);
  let data: { access_token?: string; refresh_token?: string; expires_in?: number };
  try {
    data = JSON.parse(bodyText);
  } catch {
    throw new BufferError(res.status, `Non-JSON refresh response: ${bodyText.slice(0, 200)}`);
  }
  if (!data.access_token) {
    throw new BufferError(500, "Buffer refresh endpoint returned no access_token");
  }
  const expiresAt =
    typeof data.expires_in === "number" && data.expires_in > 0
      ? new Date(Date.now() + data.expires_in * 1000)
      : null;
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresAt,
  };
}

// ============================================================
// GraphQL transport
// ============================================================

/**
 * Optional hook passed alongside a Buffer API call. When the request 401s
 * (either HTTP 401 or a GraphQL `code: UNAUTHENTICATED` error on a 200
 * response), `bufferGraphQL` invokes this once. Returning a fresh access
 * token retries the same request; returning `null` propagates the 401 as
 * usual. Bound to a specific agencyId by callers in `server/db/integrations`.
 */
export type BufferAuthRefresher = {
  onUnauthenticated?: () => Promise<string | null>;
};

/**
 * True when the parsed GraphQL body carries a Buffer "not authenticated"
 * signal. Buffer sometimes returns HTTP 200 with an error whose extensions
 * carry `code: UNAUTHENTICATED` instead of a top-level 401 — treat the two
 * as equivalent for retry purposes.
 */
function isUnauthenticatedGraphQLError(json: {
  errors?: Array<{ message?: string; extensions?: { code?: string } }>;
}): boolean {
  if (!json.errors) return false;
  return json.errors.some(
    (e) =>
      e.extensions?.code === "UNAUTHENTICATED" ||
      (typeof e.message === "string" && /access token is not valid/i.test(e.message)),
  );
}

async function bufferGraphQL<T>(
  accessToken: string,
  query: string,
  variables?: Record<string, unknown>,
  auth?: BufferAuthRefresher,
): Promise<T> {
  let attempt = 0;
  let currentToken = accessToken;
  let refreshed = false;
  while (true) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let res: Response | null = null;
    try {
      res = await fetch(BUFFER_GRAPHQL_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${currentToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ query, variables: variables ?? {} }),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if (attempt >= RETRY_DELAYS_MS.length) throw err;
      await sleep(RETRY_DELAYS_MS[attempt]!);
      attempt += 1;
      continue;
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text();
    if (!res.ok) {
      // 401: one-shot refresh + retry when a refresher is wired. This is
      // the failure mode `resolveFreshAccessToken` misses when the stored
      // row has `expiresAt = null` (Buffer didn't emit `expires_in`, or
      // the row predates the OAuth 2 rollout) — the proactive path never
      // fires, so we lean on the reactive one here.
      if (res.status === 401 && !refreshed && auth?.onUnauthenticated) {
        const fresh = await auth.onUnauthenticated();
        if (fresh) {
          currentToken = fresh;
          refreshed = true;
          continue;
        }
      }
      if (res.status >= 500 && attempt < RETRY_DELAYS_MS.length) {
        await sleep(RETRY_DELAYS_MS[attempt]!);
        attempt += 1;
        continue;
      }
      throw new BufferError(res.status, text);
    }
    let json: { data?: T; errors?: Array<{ message?: string; extensions?: { code?: string } }> };
    try {
      json = JSON.parse(text);
    } catch {
      throw new BufferError(res.status, `Non-JSON GraphQL response: ${text.slice(0, 200)}`);
    }
    if (json.errors && json.errors.length > 0) {
      // Buffer surfaces auth failures as HTTP 200 + GraphQL error too —
      // apply the same one-shot refresh path we use for HTTP 401.
      if (!refreshed && auth?.onUnauthenticated && isUnauthenticatedGraphQLError(json)) {
        const fresh = await auth.onUnauthenticated();
        if (fresh) {
          currentToken = fresh;
          refreshed = true;
          continue;
        }
      }
      // Buffer surfaces GraphQL validation + runtime errors here even on a
      // 200. Treat as a 4xx from our side so callers get a `BufferError`
      // they can catch and surface to the UI.
      throw new BufferError(400, json.errors.map((e) => e.message ?? "unknown").join(" | "));
    }
    if (!json.data) {
      throw new BufferError(500, "Buffer GraphQL returned no data");
    }
    return json.data;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ============================================================
// Organizations + channels
// ============================================================

/**
 * Enumerate every organization + channel the token can reach and return
 * them as a flat list of channels tagged with their parent org id. Used
 * at connect-callback time to hydrate `AgencyIntegration.meta.profiles`.
 */
export async function listOrganizationsAndChannels(
  accessToken: string,
  auth?: BufferAuthRefresher,
): Promise<{ organizations: BufferOrganization[]; channels: BufferChannel[] }> {
  // Step 1: enumerate orgs. Buffer's schema puts them under `account`.
  const orgsData = await bufferGraphQL<{
    account: { organizations: Array<{ id: string; name: string }> } | null;
  }>(accessToken, `query { account { organizations { id name } } }`, undefined, auth);

  const organizations = orgsData.account?.organizations ?? [];
  if (organizations.length === 0) {
    return { organizations: [], channels: [] };
  }

  // Step 2: per-org, query channels. Buffer requires `organizationId` on
  // the channels query — no root "all channels" endpoint. We could
  // parallelise this via Promise.all but sequential keeps us under any
  // per-app rate limit Buffer imposes.
  const channels: BufferChannel[] = [];
  for (const org of organizations) {
    const chData = await bufferGraphQL<{
      channels: Array<{ id: string; name: string; service: string }>;
    }>(
      accessToken,
      `query($orgId: OrganizationId!) {
        channels(input: { organizationId: $orgId }) { id name service }
      }`,
      { orgId: org.id },
      auth,
    );
    for (const c of chData.channels ?? []) {
      channels.push({
        id: c.id,
        name: c.name,
        service: c.service,
        organizationId: org.id,
        platform: BUFFER_SERVICE_TO_PLATFORM[c.service] ?? null,
      });
    }
  }

  return { organizations, channels };
}

// ============================================================
// Post mutations + queries
// ============================================================

/**
 * Schedule a post on a single channel at a specific time. Uses
 * `mode: customScheduled` so `dueAt` is respected. Buffer returns a
 * union — success carries `post.id`, error carries `message`.
 */
export async function createPost(
  params: {
    accessToken: string;
    channelId: string;
    text: string;
    dueAt: Date;
  },
  auth?: BufferAuthRefresher,
): Promise<{ id: string; publicUrl: string | null }> {
  const data = await bufferGraphQL<{
    createPost:
      | { __typename: "PostActionSuccess"; post: { id: string; externalLink: string | null } }
      | { __typename: "MutationError"; message: string };
  }>(
    params.accessToken,
    `mutation CreatePost($input: CreatePostInput!) {
      createPost(input: $input) {
        __typename
        ... on PostActionSuccess { post { id externalLink } }
        ... on MutationError { message }
      }
    }`,
    {
      input: {
        text: params.text,
        channelId: params.channelId,
        schedulingType: "automatic",
        mode: "customScheduled",
        dueAt: params.dueAt.toISOString(),
      },
    },
    auth,
  );
  const result = data.createPost;
  if (result.__typename !== "PostActionSuccess") {
    throw new BufferError(
      400,
      result.__typename === "MutationError" ? result.message : "Unknown createPost error",
    );
  }
  return {
    id: result.post.id,
    publicUrl: result.post.externalLink ?? `https://publish.buffer.com/posts/${result.post.id}`,
  };
}

/**
 * Delete a scheduled post. Called from `unscheduleOutputAction`. Buffer
 * returns a union; 404-style "not found" surfaces as a MutationError
 * which we swallow (already-gone == success from our side).
 */
export async function deletePost(
  params: {
    accessToken: string;
    id: string;
  },
  auth?: BufferAuthRefresher,
): Promise<{ deleted: boolean }> {
  try {
    await bufferGraphQL<{
      deletePost:
        | { __typename: "DeletePostSuccess"; deletedPostId: string }
        | { __typename: "MutationError"; message: string };
    }>(
      params.accessToken,
      `mutation DeletePost($input: DeletePostInput!) {
        deletePost(input: $input) {
          __typename
          ... on DeletePostSuccess { deletedPostId }
          ... on MutationError { message }
        }
      }`,
      { input: { id: params.id } },
      auth,
    );
    return { deleted: true };
  } catch (err) {
    if (err instanceof BufferError && /not.?found|does not exist/i.test(err.body)) {
      return { deleted: false };
    }
    throw err;
  }
}

/**
 * Pull the current state of a batch of posts by scanning the recent set
 * on an organization. Buffer's public GraphQL surface doesn't expose a
 * single-post-by-id query, so we page the recent posts list and match
 * client-side. In practice the sync cron runs every 5 min and volume
 * per agency is low, so a 100-item recent list covers well beyond one
 * cron interval's worth of activity.
 */
export async function listRecentPostsForOrg(
  params: {
    accessToken: string;
    organizationId: string;
    channelIds?: string[];
    first?: number;
  },
  auth?: BufferAuthRefresher,
): Promise<BufferPost[]> {
  const first = params.first ?? 100;
  const data = await bufferGraphQL<{
    posts: {
      edges: Array<{
        node: {
          id: string;
          status: string;
          dueAt: string | null;
          sentAt: string | null;
          externalLink: string | null;
          channelId: string | null;
        };
      }>;
    };
  }>(
    params.accessToken,
    `query RecentPosts($input: PostsInput!, $first: Int!) {
      posts(first: $first, input: $input) {
        edges {
          node { id status dueAt sentAt externalLink channelId }
        }
      }
    }`,
    {
      first,
      input: {
        organizationId: params.organizationId,
        filter: params.channelIds ? { channelIds: params.channelIds } : {},
      },
    },
    auth,
  );
  return data.posts.edges.map(({ node }) => ({
    id: node.id,
    status: node.status,
    dueAt: node.dueAt ? new Date(node.dueAt) : null,
    sentAt: node.sentAt ? new Date(node.sentAt) : null,
    externalLink: node.externalLink,
    channelId: node.channelId,
  }));
}

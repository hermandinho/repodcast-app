import "server-only";

import {
  OutputStatus,
  type Episode,
  type GeneratedOutput,
  type Platform,
  type VoiceSample,
} from "@prisma/client";
import type { TenantContext } from "@/server/auth/tenant";
import { getClient as dbGetClient, listClients as dbListClients } from "@/server/db/clients";
import {
  getShow as dbGetShow,
  listShows as dbListShows,
  listShowsForClient as dbListShowsForClient,
} from "@/server/db/shows";
import {
  episodeBucketTotals as dbEpisodeBucketTotals,
  getEpisode as dbGetEpisode,
  listEpisodesFiltered as dbListEpisodesFiltered,
  listEpisodesForShow as dbListEpisodesForShow,
  type ListEpisodesFilterInput,
} from "@/server/db/episodes";
import {
  listOutputsForEpisode as dbListOutputsForEpisode,
  listShippedOutputsForAgencyByShow as dbListShippedOutputsForAgencyByShow,
  listShippedOutputsForShow as dbListShippedOutputsForShow,
  qualityByPlatformForEpisode as dbQualityByPlatformForEpisode,
} from "@/server/db/outputs";
import { computeVoiceProgress, type VoiceProgressResult } from "@/server/ai/voice-progress";
import {
  listRecentTransitions as dbListRecentTransitions,
  type TransitionWithContext,
} from "@/server/db/transitions";
import { searchAgency as dbSearchAgency } from "@/server/db/search";
import {
  countSamplesByPlatform as dbCountSamplesByPlatform,
  listVoiceSamplesForShow as dbListVoiceSamplesForShow,
} from "@/server/db/voice-samples";
import { prisma } from "@/server/db/client";

import { sampleClients, type SampleClient } from "@/lib/sample-data/clients";
import { sampleShows, type SampleShow } from "@/lib/sample-data/shows";
import { sampleEpisodes, type SampleEpisode } from "@/lib/sample-data/episode-outputs";
import type { PlatformKey } from "@/lib/sample-data/platforms";
import type { EpisodeStatus as UiEpisodeStatus } from "@/lib/sample-data/episode-status";
import { voiceProfiles, type VoiceProfile } from "@/lib/sample-data/voice-profiles";
import {
  activityItems,
  chartSeries,
  dashboardKpis,
  recentEpisodes as sampleRecentEpisodes,
  type ActivityItem,
  type ChartSeries,
  type DashboardKpi,
  type RecentEpisode,
} from "@/lib/sample-data/dashboard";
import { dashboardSummary } from "@/server/db/dashboard";
import { formatAbsDelta, formatPctDelta } from "@/lib/dashboard-deltas";

// Canonical definition lives in `./is-live-db` — callers that only need
// this flag should import from there so they don't drag in the rest of
// this module. Re-exported here so existing consumers keep working.
import { isLiveDb } from "./is-live-db";
export { isLiveDb };

// ============================================================
// Platform-key bridging (DB enum ↔ UI short key)
// ============================================================

const PLATFORM_TO_KEY: Record<Platform, PlatformKey> = {
  TWITTER: "x",
  LINKEDIN: "li",
  INSTAGRAM: "ig",
  TIKTOK: "tt",
  SHOW_NOTES: "notes",
  BLOG: "blog",
  NEWSLETTER: "news",
};

const STATUS_TO_KEY: Record<string, UiEpisodeStatus> = {
  GENERATING: "generating",
  READY: "ready",
  IN_REVIEW: "review",
  AWAITING_CLIENT_APPROVAL: "awaiting-client",
  APPROVED: "approved",
  SCHEDULED: "scheduled",
  PUBLISHED: "published",
  FAILED: "failed",
};

// ============================================================
// Deterministic UI derivations from real rows
// ============================================================

const PALETTE = ["#3A5BA0", "#2E9E5B", "#7A4FB0", "#A06D12", "#C0392B"];
function colorForName(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

function initialsOf(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function timeAgo(date: Date): string {
  const ms = Date.now() - date.getTime();
  const days = Math.floor(ms / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months === 1) return "1 month ago";
  return `${months} months ago`;
}

function emptyPlatformCounts(): Record<PlatformKey, number> {
  return { x: 0, li: 0, ig: 0, tt: 0, notes: 0, blog: 0, news: 0 };
}

// ============================================================
// Clients (parent customers)
// ============================================================

export async function listClientsForUI(ctx: TenantContext): Promise<SampleClient[]> {
  if (!isLiveDb()) return sampleClients;
  const rows = await dbListClients(ctx);
  return rows.map((c) => ({
    key: c.id,
    name: c.name,
    description: c.description ?? "",
    contactName: c.contactName ?? "",
    contactEmail: c.contactEmail ?? "",
    artworkUrl: c.artworkUrl ?? "",
    initial: initialsOf(c.name),
    avatarBg: colorForName(c.name),
  }));
}

export async function getClientForUI(
  ctx: TenantContext,
  /** Either a cuid (live mode) or a sample key like "northwind" (fallback mode). */
  idOrKey: string,
): Promise<SampleClient | null> {
  if (!isLiveDb()) {
    return sampleClients.find((c) => c.key === idOrKey) ?? null;
  }
  try {
    const c = await dbGetClient(ctx, idOrKey);
    return {
      key: c.id,
      name: c.name,
      description: c.description ?? "",
      contactName: c.contactName ?? "",
      contactEmail: c.contactEmail ?? "",
      artworkUrl: c.artworkUrl ?? "",
      initial: initialsOf(c.name),
      avatarBg: colorForName(c.name),
    };
  } catch {
    return null;
  }
}

// ============================================================
// Shows (podcasts)
// ============================================================

export async function listShowsForUI(ctx: TenantContext): Promise<SampleShow[]> {
  if (!isLiveDb()) return sampleShows;
  const rows = await dbListShows(ctx);
  // Pull the whole agency's shipped outputs once, grouped by showId, so
  // each card's voice-progress sparkline reuses the same data — N cards
  // cost one query total, not N.
  const [shows, byShow] = await Promise.all([
    Promise.all(rows.map((s) => showToUI(ctx, s))),
    dbListShippedOutputsForAgencyByShow(ctx),
  ]);
  return shows.map((show) => {
    const shipped = byShow.get(show.key);
    if (!shipped || shipped.length === 0) return show;
    return { ...show, voiceProgress: computeVoiceProgress(shipped) };
  });
}

export async function listShowsForClientUI(
  ctx: TenantContext,
  clientIdOrKey: string,
): Promise<SampleShow[]> {
  if (!isLiveDb()) {
    return sampleShows.filter((s) => s.clientKey === clientIdOrKey);
  }
  const rows = await dbListShowsForClient(ctx, clientIdOrKey);
  return Promise.all(rows.map((s) => showToUI(ctx, s)));
}

export async function getShowForUI(
  ctx: TenantContext,
  idOrKey: string,
): Promise<SampleShow | null> {
  if (!isLiveDb()) {
    return sampleShows.find((s) => s.key === idOrKey) ?? null;
  }
  try {
    const s = await dbGetShow(ctx, idOrKey);
    return showToUI(ctx, s);
  } catch {
    return null;
  }
}

/**
 * Edit-form initial values for `<ShowFormModal mode="edit">`. Returns
 * exactly the shape the modal's `initial` prop expects, including the
 * parent client name for the locked picker label.
 */
export type ShowEditInitial = {
  name: string;
  host: string;
  description: string | null;
  artworkUrl: string | null;
  rssUrl: string | null;
  clientId: string;
  clientName: string;
};

export async function getShowEditInitialForUI(
  ctx: TenantContext,
  idOrKey: string,
): Promise<ShowEditInitial | null> {
  if (!isLiveDb()) {
    const sample = sampleShows.find((s) => s.key === idOrKey);
    if (!sample) return null;
    const client = sampleClients.find((c) => c.key === sample.clientKey);
    return {
      name: sample.name,
      host: sample.host,
      description: null,
      artworkUrl: null,
      rssUrl: null,
      clientId: sample.clientKey,
      clientName: client?.name ?? "",
    };
  }
  try {
    const s = await dbGetShow(ctx, idOrKey);
    const parent = await prisma.client.findUnique({
      where: { id: s.clientId },
      select: { name: true },
    });
    return {
      name: s.name,
      host: s.host,
      description: s.description,
      artworkUrl: s.artworkUrl,
      rssUrl: s.rssUrl,
      clientId: s.clientId,
      clientName: parent?.name ?? "",
    };
  } catch {
    return null;
  }
}

async function showToUI(
  ctx: TenantContext,
  s: Awaited<ReturnType<typeof dbGetShow>>,
): Promise<SampleShow> {
  // Per-platform sample counts via the existing groupBy helper.
  const counts = await dbCountSamplesByPlatform(ctx, s.id);
  const platformSamples: Record<PlatformKey, number> = emptyPlatformCounts();
  let totalSamples = 0;
  for (const [platform, n] of Object.entries(counts) as [Platform, number][]) {
    platformSamples[PLATFORM_TO_KEY[platform]] = n;
    totalSamples += n;
  }

  const episodes = await dbListEpisodesForShow(ctx, s.id);
  const episodeSlice = episodes.slice(0, 5);
  const lastActivity = episodes[0]?.updatedAt ?? s.updatedAt;

  // Per-episode output totals + pending-review counts. Two grouped counts
  // over the same subset of episodes so the /shows/[key] episode list can
  // render "N outputs · M reviewed" and the "N to review" pill without a
  // round-trip per row. Prisma's `_count` doesn't accept two aliased
  // filters on the same relation, so we merge the two groupBy results by
  // episodeId in memory.
  const sliceIds = episodeSlice.map((e) => e.id);
  const [totalGroups, pendingGroups] = sliceIds.length
    ? await Promise.all([
        prisma.generatedOutput.groupBy({
          by: ["episodeId"],
          where: { episodeId: { in: sliceIds }, supersededAt: null },
          _count: { _all: true },
        }),
        prisma.generatedOutput.groupBy({
          by: ["episodeId"],
          where: {
            episodeId: { in: sliceIds },
            supersededAt: null,
            status: { in: [OutputStatus.READY, OutputStatus.IN_REVIEW] },
          },
          _count: { _all: true },
        }),
      ])
    : [[], []];
  const totalByEp = new Map<string, number>(totalGroups.map((r) => [r.episodeId, r._count._all]));
  const pendingByEp = new Map<string, number>(
    pendingGroups.map((r) => [r.episodeId, r._count._all]),
  );

  return {
    key: s.id,
    clientKey: s.clientId,
    name: s.name,
    host: s.host,
    initial: initialsOf(s.name),
    avatarBg: colorForName(s.name),
    artworkUrl: s.artworkUrl ?? "",
    rssUrl: s.rssUrl,
    samples: totalSamples,
    episodeCount: episodes.length,
    lastActivity: timeAgo(lastActivity),
    platformSamples,
    episodes: episodeSlice.map((e) =>
      episodeToUiSummary(e, totalByEp.get(e.id) ?? 0, pendingByEp.get(e.id) ?? 0),
    ),
  };
}

function episodeToUiSummary(e: Episode, outputCount: number, pendingReviewCount: number) {
  const status = STATUS_TO_KEY[e.status] ?? "ready";
  const date = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(
    e.createdAt,
  );
  return {
    // Live-mode rows carry the real Episode.id so `/shows/[key]` rows
    // can link straight to `/episodes/[id]`.
    id: e.id,
    title: e.title,
    date,
    status,
    outputs: outputCount > 0 ? `${outputCount} output${outputCount === 1 ? "" : "s"}` : "",
    outputCount,
    pendingReviewCount,
  };
}

// ============================================================
// Episodes + outputs
// ============================================================

// ============================================================
// Episodes list (paginated /episodes index)
// ============================================================

export type EpisodeListStatus = "DRAFT" | "PROCESSING" | "READY" | "ARCHIVED" | "FAILED";

export type EpisodeListItem = {
  id: string;
  title: string;
  showId: string;
  showName: string;
  clientId: string;
  clientName: string;
  status: EpisodeListStatus;
  createdAt: string;
  outputCount: number;
  /** Current (non-superseded) outputs sitting in a reviewable state.
   *  Drives the list's Needs review / Done bucketing — see the top of
   *  `episode-list-selection.tsx`. */
  pendingReviewCount: number;
  initial: string;
  avatarBg: string;
};

export type EpisodeListFilterOptions = {
  shows: { id: string; name: string }[];
  statuses: EpisodeListStatus[];
};

const EPISODE_STATUSES: EpisodeListStatus[] = [
  "DRAFT",
  "PROCESSING",
  "READY",
  "ARCHIVED",
  "FAILED",
];

function formatShortDate(d: Date): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(d);
}

/**
 * Paginated episode list for the `/episodes` index. In sample-data mode the
 * three seeded episodes are returned regardless of filters — keeps the UI
 * preview representative without paying for a sample-mode filter engine.
 */
export async function listEpisodesForUI(
  ctx: TenantContext,
  filters: ListEpisodesFilterInput,
): Promise<{ items: EpisodeListItem[]; total: number }> {
  if (!isLiveDb()) {
    // Build synthetic rows from the seeded shows/episodes — three rows,
    // one per show key, in a stable order.
    const items: EpisodeListItem[] = sampleShows.map((s) => {
      const ep = sampleEpisodes[s.key];
      const client = sampleClients.find((c) => c.key === s.clientKey);
      const outputCount = ep?.outputs.length ?? 7;
      const pendingReviewCount =
        ep?.outputs.filter(
          (o) => o.status === "ready" || o.status === "review" || o.status === "awaiting-client",
        ).length ?? 0;
      return {
        id: s.key,
        title: ep?.episode ?? "Untitled episode",
        showId: s.key,
        showName: s.name,
        clientId: client?.key ?? "",
        clientName: client?.name ?? "",
        status: "READY",
        createdAt: ep?.episodeMeta?.split("·")[1]?.trim() ?? "Recently",
        outputCount,
        pendingReviewCount,
        initial: s.initial,
        avatarBg: s.avatarBg,
      };
    });
    return { items, total: items.length };
  }

  const { rows, total } = await dbListEpisodesFiltered(ctx, filters);
  const items: EpisodeListItem[] = rows.map((e) => ({
    id: e.id,
    title: e.title,
    showId: e.show.id,
    showName: e.show.name,
    clientId: e.show.client.id,
    clientName: e.show.client.name,
    status: e.status as EpisodeListStatus,
    createdAt: formatShortDate(e.createdAt),
    outputCount: e._count.outputs,
    pendingReviewCount: e.pendingReviewCount,
    initial: initialsOf(e.show.name),
    avatarBg: colorForName(e.show.name),
  }));

  return { items, total };
}

/**
 * Agency-wide bucket totals for the `/episodes` toolbar pills + subtitle.
 * Not scoped to the caller's search/show/date filters — the pills are a
 * navigational aid, so counts should stay stable as users narrow.
 * Sample-data mode returns synthetic values keyed off `sampleShows` so
 * the demo surface still lights up.
 */
export async function episodeBucketTotalsForUI(ctx: TenantContext): Promise<{
  all: number;
  draft: number;
  review: number;
  outputsWaitingReview: number;
}> {
  if (!isLiveDb()) {
    return {
      all: sampleShows.length,
      draft: 1,
      review: Math.max(0, sampleShows.length - 1),
      outputsWaitingReview: sampleShows.length * 3,
    };
  }
  return dbEpisodeBucketTotals(ctx);
}

/**
 * Filter dropdown options for `/episodes`. Lists every show the agency
 * owns + the static set of EpisodeStatus values.
 */
export async function listEpisodeFilterOptionsForUI(
  ctx: TenantContext,
): Promise<EpisodeListFilterOptions> {
  if (!isLiveDb()) {
    return {
      shows: sampleShows.map((s) => ({ id: s.key, name: s.name })),
      statuses: EPISODE_STATUSES,
    };
  }
  const rows = await dbListShows(ctx);
  return {
    shows: rows.map((s) => ({ id: s.id, name: s.name })),
    statuses: EPISODE_STATUSES,
  };
}

export async function getEpisodeForUI(
  ctx: TenantContext,
  idOrKey: string,
): Promise<{
  show: SampleShow;
  episode: SampleEpisode;
  clientValidationMode: "INTERNAL" | "CLIENT";
} | null> {
  if (!isLiveDb()) {
    const show = sampleShows.find((s) => s.key === idOrKey);
    const episode = sampleEpisodes[idOrKey];
    if (!show || !episode) return null;
    return { show, episode, clientValidationMode: "INTERNAL" };
  }

  let episodeRow: Episode | null = null;
  try {
    episodeRow = await dbGetEpisode(ctx, idOrKey);
  } catch {
    return null;
  }

  const [show, outputs, quality, versionCounts, clientValidation] = await Promise.all([
    dbGetShow(ctx, episodeRow.showId),
    dbListOutputsForEpisode(ctx, episodeRow.id),
    dbQualityByPlatformForEpisode(ctx, episodeRow.id),
    // groupBy platform to know how many historical versions exist per slot.
    // dbListOutputsForEpisode only returns current versions (supersededAt:null).
    prisma.generatedOutput.groupBy({
      by: ["platform"],
      where: {
        episodeId: episodeRow.id,
        episode: { show: { client: { agencyId: ctx.agencyId } } },
      },
      _count: { _all: true },
    }),
    // Resolve the parent client's validation mode via the episode → show
    // → client chain. Cheap: one row, indexed lookup.
    prisma.episode.findFirst({
      where: { id: episodeRow.id, show: { client: { agencyId: ctx.agencyId } } },
      select: { show: { select: { client: { select: { validationMode: true } } } } },
    }),
  ]);

  const versionCountByPlatform = new Map<Platform, number>(
    versionCounts.map((r) => [r.platform, r._count?._all ?? 0]),
  );

  // FAILED rows store their reason on the most recent transition row's
  // `note`. Skip the lookup entirely when no outputs are failed.
  const failedOutputIds = outputs.filter((o) => o.status === OutputStatus.FAILED).map((o) => o.id);
  const reasonByOutputId = new Map<string, string>();
  if (failedOutputIds.length > 0) {
    const failureRows = await prisma.outputTransition.findMany({
      where: {
        outputId: { in: failedOutputIds },
        toStatus: OutputStatus.FAILED,
      },
      orderBy: { createdAt: "desc" },
      select: { outputId: true, note: true },
    });
    for (const row of failureRows) {
      if (!reasonByOutputId.has(row.outputId) && row.note) {
        reasonByOutputId.set(row.outputId, row.note);
      }
    }
  }

  // Derive "client asked for changes" signal: an output is in that state
  // when its current status is READY AND its most recent OutputTransition
  // is AWAITING_CLIENT_APPROVAL → READY (the audit trail left by
  // `clientRequestRevisionFromPortal`). Any subsequent transition
  // (approve, request review, regen, etc.) supersedes the signal because
  // the *latest* transition per output row is no longer that pair. Fetch
  // every transition for the READY outputs in one round-trip and pick
  // the newest per row in memory — the dataset is tiny (7 platforms × a
  // handful of transitions each), so a groupBy isn't worth the complexity.
  const readyOutputIds = outputs.filter((o) => o.status === OutputStatus.READY).map((o) => o.id);
  const revisionByOutputId = new Map<string, { at: string; note: string | null }>();
  if (readyOutputIds.length > 0) {
    const transitions = await prisma.outputTransition.findMany({
      where: { outputId: { in: readyOutputIds } },
      orderBy: { createdAt: "desc" },
      select: {
        outputId: true,
        fromStatus: true,
        toStatus: true,
        note: true,
        createdAt: true,
      },
    });
    const latestByOutputId = new Map<string, (typeof transitions)[number]>();
    for (const t of transitions) {
      // desc order → first row per outputId is the latest.
      if (!latestByOutputId.has(t.outputId)) latestByOutputId.set(t.outputId, t);
    }
    for (const [outputId, t] of latestByOutputId) {
      if (
        t.fromStatus === OutputStatus.AWAITING_CLIENT_APPROVAL &&
        t.toStatus === OutputStatus.READY
      ) {
        revisionByOutputId.set(outputId, {
          at: t.createdAt.toISOString(),
          note: t.note,
        });
      }
    }
  }

  const showUI = await showToUI(ctx, show);

  const episode: SampleEpisode = {
    id: episodeRow.id,
    clientKey: showUI.key,
    // Used as the breadcrumb tail. Falls back to a date stamp when the
    // user hasn't named the episode yet so the crumb stays meaningful;
    // otherwise it mirrors the heading title (truncated client-side).
    episodeNo:
      episodeRow.title.trim().length > 0
        ? episodeRow.title
        : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(
            episodeRow.createdAt,
          ),
    episode: episodeRow.title,
    episodeMeta: episodeRow.recordedAt ? `Recorded ${episodeRow.recordedAt.toDateString()}` : "",
    lastTrained: timeAgo(show.updatedAt),
    description: show.voiceDescription ?? "",
    // `Episode.keyMoments` is JSONB written by the generate pipeline. Cast
    // through `unknown` (Prisma's JsonValue isn't structurally compatible
    // with KeyMoment[]) — the writer is the only path into this column.
    keyMoments: (episodeRow.keyMoments as unknown as SampleEpisode["keyMoments"]) ?? undefined,
    pipeline: {
      source: episodeRow.source as "PASTE" | "UPLOAD" | "RSS" | "YOUTUBE",
      // UPLOAD episodes flow DRAFT → PROCESSING (transcribe) → PROCESSING
      // (generate) → READY. The transcribing UX kicks in whenever the
      // transcript hasn't landed — covers both DRAFT (event still in
      // flight) and PROCESSING (Deepgram running).
      awaitingTranscript: episodeRow.transcript.trim().length === 0,
      status: episodeRow.status.toLowerCase() as
        "draft" | "processing" | "ready" | "archived" | "failed",
      failureReason: episodeRow.failureReason ?? null,
    },
    outputs: outputs.map((o) => {
      const revision = revisionByOutputId.get(o.id);
      return {
        key: PLATFORM_TO_KEY[o.platform],
        id: o.id,
        meta: outputMetaFor(o.platform),
        status: STATUS_TO_KEY[o.status] ?? "ready",
        quality: o.quality ?? Math.round(quality[o.platform]?.avg ?? 0),
        content: o.content,
        version: o.version,
        versionCount: versionCountByPlatform.get(o.platform) ?? 1,
        failureReason: reasonByOutputId.get(o.id) ?? null,
        scheduledForIso: o.scheduledFor?.toISOString() ?? null,
        publishedAtIso: o.publishedAt?.toISOString() ?? null,
        externalScheduler: o.externalScheduler ?? null,
        externalPostUrl: o.externalPostUrl ?? null,
        sentToClientAtIso: o.sentToClientAt?.toISOString() ?? null,
        clientApprovedAtIso: o.clientApprovedAt?.toISOString() ?? null,
        clientRevisionRequestedAtIso: revision?.at ?? null,
        clientRevisionNote: revision?.note ?? null,
        ruleViolations: o.ruleViolations,
        editDistance: o.editDistance,
      };
    }),
  };

  const clientValidationMode = clientValidation?.show.client.validationMode ?? "INTERNAL";
  return { show: showUI, episode, clientValidationMode };
}

const OUTPUT_META_BY_PLATFORM: Record<Platform, string> = {
  TWITTER: "Thread · 6 posts",
  LINKEDIN: "Single post",
  INSTAGRAM: "Caption + tags",
  TIKTOK: "Script · ~25s",
  SHOW_NOTES: "Summary + timestamps",
  BLOG: "Long-form draft",
  NEWSLETTER: "Email issue",
};
function outputMetaFor(p: Platform): string {
  return OUTPUT_META_BY_PLATFORM[p];
}

// ============================================================
// Voice profile (per-show)
// ============================================================

export async function getVoiceProfileForUI(
  ctx: TenantContext,
  idOrKey: string,
): Promise<{
  show: SampleShow;
  profile: VoiceProfile;
  progress: VoiceProgressResult;
} | null> {
  if (!isLiveDb()) {
    const show = sampleShows.find((s) => s.key === idOrKey);
    const profile = voiceProfiles[idOrKey];
    if (!show || !profile) return null;
    return { show, profile, progress: sampleProgressForDemo(profile) };
  }

  let show: Awaited<ReturnType<typeof dbGetShow>>;
  try {
    show = await dbGetShow(ctx, idOrKey);
  } catch {
    return null;
  }

  const [samples, showUI, instructions, shippedRows] = await Promise.all([
    dbListVoiceSamplesForShow(ctx, show.id),
    showToUI(ctx, show),
    prisma.showPlatformInstruction.findMany({ where: { showId: show.id } }),
    dbListShippedOutputsForShow(ctx, show.id),
  ]);

  const perPlatform: Record<PlatformKey, string> = {
    x: "",
    li: "",
    ig: "",
    tt: "",
    notes: "",
    blog: "",
    news: "",
  };
  for (const i of instructions) {
    const uiKey = PLATFORM_TO_KEY[i.platform];
    perPlatform[uiKey] = i.rule;
  }

  const profile: VoiceProfile = {
    clientKey: showUI.key,
    description: show.voiceDescription ?? "",
    descriptionApproved: show.voiceDescriptionApproved ?? null,
    tags: [],
    samples: samples.map((s: VoiceSample) => ({
      platform: PLATFORM_TO_KEY[s.platform],
      text: s.content,
      episode: s.episodeId ? `Ep ${s.episodeId.slice(-4)}` : "",
      date: new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(
        s.createdAt,
      ),
    })),
    instructions: {
      global: show.globalInstructions ?? "",
      perPlatform,
    },
  };

  return { show: showUI, profile, progress: computeVoiceProgress(shippedRows) };
}

/**
 * Synthetic voice-progress curve for sample-data mode. The design
 * preview shouldn't render an empty chart on shows that have obvious
 * "training data" in the sample fixtures — the story only lands if the
 * curve is visibly climbing. We fake up one point per episode implied
 * by the sample's `samples[]` list, ramping post-ready rate from ~40%
 * to ~90% so the shape mirrors what a real show would look like.
 */
function sampleProgressForDemo(profile: VoiceProfile): VoiceProgressResult {
  const totalSamples = profile.samples.length;
  if (totalSamples === 0) {
    return {
      series: [],
      headline: { postReadyRate: null, sampleCount: 0, window: 30 },
      milestones: { developing: null, strong: null },
    };
  }
  // Bucket the samples into ~5 pseudo-episodes so the curve is legible
  // even on shows with only a dozen samples.
  const buckets = Math.min(6, Math.max(2, Math.ceil(totalSamples / 3)));
  const perBucket = Math.max(1, Math.floor(totalSamples / buckets));
  const series = Array.from({ length: buckets }, (_, i) => {
    // Ramp from 0.40 → 0.92 across the buckets.
    const t = buckets === 1 ? 1 : i / (buckets - 1);
    return {
      episodeIndex: i + 1,
      episodeId: `demo_ep_${i + 1}`,
      title: `Ep ${i + 1}`,
      postReadyRate: 0.4 + (0.92 - 0.4) * t,
      sampleCount: perBucket,
    };
  });
  const headline = series[series.length - 1]?.postReadyRate ?? null;
  return {
    series,
    headline: {
      postReadyRate: headline,
      sampleCount: Math.min(30, totalSamples),
      window: 30,
    },
    milestones: {
      developing: totalSamples >= 6 ? Math.min(buckets, 2) : null,
      strong: totalSamples >= 16 ? Math.min(buckets, buckets - 1) : null,
    },
  };
}

// ============================================================
// Outputs
// ============================================================

export async function listOutputsForUI(
  ctx: TenantContext,
  episodeId: string,
): Promise<GeneratedOutput[] | null> {
  if (!isLiveDb()) return null;
  try {
    return await dbListOutputsForEpisode(ctx, episodeId);
  } catch {
    return null;
  }
}

// ============================================================
// Dashboard
// ============================================================

export type DashboardChartSeriesMap = {
  "8 weeks": ChartSeries;
  "12 weeks": ChartSeries;
};

export type DashboardData = {
  kpis: DashboardKpi[];
  recent: RecentEpisode[];
  chart: DashboardChartSeriesMap;
  activity: ActivityItem[];
  /**
   * Agency-wide count of outputs waiting on the operator's review (READY
   * or IN_REVIEW). Drives the top "attention strip"; when 0 the strip
   * collapses so a clean workspace doesn't get a false alert.
   */
  pendingReview: number;
};

type WeeklyPoint = { weekStart: string; generated: number; approved: number };

function seriesFromWeekly(
  range: "8 weeks" | "12 weeks",
  rangeLabel: string,
  weekly: readonly WeeklyPoint[],
): ChartSeries {
  const labels: string[] = [];
  let lastMonth = -1;
  for (const w of weekly) {
    const d = new Date(w.weekStart);
    if (d.getMonth() !== lastMonth) {
      labels.push(d.toLocaleString("en-US", { month: "short" }));
      lastMonth = d.getMonth();
    } else {
      labels.push("");
    }
  }
  return {
    range,
    rangeLabel,
    total: weekly.reduce((sum, w) => sum + w.generated, 0),
    generated: weekly.map((w) => w.generated),
    approved: weekly.map((w) => w.approved),
    labels,
  };
}

export async function getDashboardForUI(ctx: TenantContext): Promise<DashboardData> {
  if (!isLiveDb()) {
    return {
      kpis: dashboardKpis,
      recent: sampleRecentEpisodes,
      chart: {
        "8 weeks": chartSeries["8 weeks"],
        "12 weeks": chartSeries["12 weeks"],
      },
      activity: activityItems,
      // Sum from the sample-data episode list so the demo shows the
      // attention strip when the sample workspace has drafts pending.
      pendingReview: sampleRecentEpisodes.reduce((n, e) => n + e.pendingReviewCount, 0),
    };
  }

  const [summary, transitions] = await Promise.all([
    dashboardSummary(ctx),
    dbListRecentTransitions(ctx, 12),
  ]);

  const priorMonthLabel = new Intl.DateTimeFormat("en-US", { month: "short" }).format(
    new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1),
  );

  const kpis: DashboardKpi[] = [
    {
      label: "Posted unedited",
      value: `${summary.unedited}%`,
      // Last-30-shipped window (see `percentPostedUnedited` in dashboard.ts)
      // — a rolling number, not lifetime. Deltas aren't meaningful for a
      // trailing window that already re-averages every day.
      delta: "",
      progress: summary.unedited,
      caption: "Share of the last 30 shipped outputs you shipped without meaningful edits",
    },
    {
      label: "Episodes this month",
      value: String(summary.episodesMonth),
      delta: formatAbsDelta(summary.episodesMonth, summary.prior.episodes, priorMonthLabel),
    },
    {
      label: "Outputs generated",
      value: String(summary.outputsMonth),
      delta: formatPctDelta(summary.outputsMonth, summary.prior.outputs),
    },
    { label: "Approval rate", value: `${summary.approval}%`, delta: "" },
  ];

  // Recent episodes — derive UI shape from the real rows. We surface the
  // *show* name on the dashboard (most useful for editors) rather than the
  // parent client name; client is one more nav-click away.
  const recent: RecentEpisode[] = summary.recent.map((e) => ({
    key: e.id,
    title: e.title,
    client: e.show.name,
    initial: e.show.name.slice(0, 2).toUpperCase(),
    avatarBg: colorForRecent(e.show.name),
    status: STATUS_TO_KEY[e.status] ?? "ready",
    outputs: `${e._count.outputs} outputs`,
    outputCount: e._count.outputs,
    pendingReviewCount: e.pendingReviewCount,
  }));

  const chart: DashboardChartSeriesMap = {
    "8 weeks": seriesFromWeekly("8 weeks", "Last 8 weeks", summary.weekly),
    "12 weeks": seriesFromWeekly("12 weeks", "Last 12 weeks", summary.weekly12),
  };

  // Live mode: an empty transition log means a real agency hasn't generated
  // anything yet. The `<ActivityFeed>` empty-state already handles `[]` — we
  // do NOT fall back to demo data here (that would surface fictional Eli/Maya
  // names in a real workspace's feed).
  const activity = transitions.map(transitionToActivityItem);

  return { kpis, recent, chart, activity, pendingReview: summary.pendingReview };
}

// ============================================================
// Activity feed rendering
// ============================================================

const PLATFORM_LABEL: Record<Platform, string> = {
  TWITTER: "X thread",
  LINKEDIN: "LinkedIn post",
  INSTAGRAM: "Instagram caption",
  TIKTOK: "TikTok script",
  SHOW_NOTES: "show notes",
  BLOG: "blog draft",
  NEWSLETTER: "newsletter",
};

const STATUS_PALETTE: Record<OutputStatus, { color: string; ring: string }> = {
  GENERATING: { color: "#8B95A6", ring: "#EEF1F6" },
  READY: { color: "#3A5BA0", ring: "#EEF2FB" },
  IN_REVIEW: { color: "#A06D12", ring: "#FBF1DE" },
  AWAITING_CLIENT_APPROVAL: { color: "#3A4A80", ring: "#EEF1FB" },
  APPROVED: { color: "#2E9E5B", ring: "#E7F4EC" },
  SCHEDULED: { color: "#3A5BA0", ring: "#EEF2FB" },
  PUBLISHED: { color: "#2E9E5B", ring: "#E7F4EC" },
  FAILED: { color: "#C0392B", ring: "#FBEDEC" },
};

function transitionVerb(t: OutputStatus, prior: OutputStatus | null): string {
  switch (t) {
    case OutputStatus.APPROVED:
      return prior === OutputStatus.AWAITING_CLIENT_APPROVAL ? "approved by client" : "approved";
    case OutputStatus.IN_REVIEW:
      return prior === OutputStatus.READY ? "sent for review" : "flagged for review";
    case OutputStatus.AWAITING_CLIENT_APPROVAL:
      return "sent to client";
    case OutputStatus.READY:
      if (prior === OutputStatus.IN_REVIEW) return "rejected";
      if (prior === OutputStatus.AWAITING_CLIENT_APPROVAL) return "revision requested by client";
      return "generated";
    case OutputStatus.GENERATING:
      return "started regenerating";
    case OutputStatus.SCHEDULED:
      return "scheduled";
    case OutputStatus.PUBLISHED:
      return "published";
    case OutputStatus.FAILED:
      return "failed";
  }
}

function actorName(member: TransitionWithContext["member"]): string | null {
  if (!member) return null;
  return member.name ?? member.email.split("@")[0];
}

function transitionToActivityItem(t: TransitionWithContext): ActivityItem {
  const palette = STATUS_PALETTE[t.toStatus];
  const verb = transitionVerb(t.toStatus, t.fromStatus);
  const actor = actorName(t.member);
  const platformLabel = PLATFORM_LABEL[t.output.platform as Platform];
  const subject = actor ? `${actor} ${verb} a ${platformLabel}` : `${platformLabel} ${verb}`;
  return {
    text: subject,
    // Dashboard activity column shows the show name (closest to the work).
    client: t.output.episode.show.name,
    time: timeAgo(t.createdAt),
    color: palette.color,
    ring: palette.ring,
  };
}

const RECENT_PALETTE = ["#3A5BA0", "#2E9E5B", "#7A4FB0", "#A06D12", "#C0392B"];
function colorForRecent(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return RECENT_PALETTE[Math.abs(hash) % RECENT_PALETTE.length];
}

// ============================================================
// Global search — clients + shows + episodes
// ============================================================

export type SearchHit =
  | { kind: "client"; id: string; name: string; href: string }
  | {
      kind: "show";
      id: string;
      name: string;
      host: string;
      clientName: string;
      href: string;
    }
  | {
      kind: "episode";
      id: string;
      title: string;
      showName: string;
      clientName: string;
      dateLabel: string;
      href: string;
    };

export type SearchResultsForUI = {
  clients: Extract<SearchHit, { kind: "client" }>[];
  shows: Extract<SearchHit, { kind: "show" }>[];
  episodes: Extract<SearchHit, { kind: "episode" }>[];
};

const EMPTY_SEARCH: SearchResultsForUI = { clients: [], shows: [], episodes: [] };

function includesFold(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

export async function searchForUI(
  ctx: TenantContext,
  q: string,
  limit = 5,
): Promise<SearchResultsForUI> {
  const needle = q.trim();
  if (needle.length < 2) return EMPTY_SEARCH;

  if (!isLiveDb()) {
    const clients = sampleClients
      .filter((c) => includesFold(c.name, needle))
      .slice(0, limit)
      .map((c) => ({
        kind: "client" as const,
        id: c.key,
        name: c.name,
        href: `/clients/${c.key}`,
      }));

    const shows = sampleShows
      .filter((s) => includesFold(s.name, needle) || includesFold(s.host, needle))
      .slice(0, limit)
      .map((s) => {
        const parent = sampleClients.find((c) => c.key === s.clientKey);
        return {
          kind: "show" as const,
          id: s.key,
          name: s.name,
          host: s.host,
          clientName: parent?.name ?? "",
          href: `/shows/${s.key}`,
        };
      });

    const episodes = Object.values(sampleEpisodes)
      .filter((e) => includesFold(e.episode, needle))
      .slice(0, limit)
      .map((e) => {
        const show = sampleShows.find((s) => s.key === e.clientKey);
        const parent = show ? sampleClients.find((c) => c.key === show.clientKey) : null;
        return {
          kind: "episode" as const,
          id: e.id,
          title: e.episode,
          showName: show?.name ?? "",
          clientName: parent?.name ?? "",
          dateLabel: "",
          href: `/episodes/${e.id}`,
        };
      });

    return { clients, shows, episodes };
  }

  const raw = await dbSearchAgency(ctx, needle, limit);

  return {
    clients: raw.clients.map((c) => ({
      kind: "client",
      id: c.id,
      name: c.name,
      href: `/clients/${c.id}`,
    })),
    shows: raw.shows.map((s) => ({
      kind: "show",
      id: s.id,
      name: s.name,
      host: s.host,
      clientName: s.client.name,
      href: `/shows/${s.id}`,
    })),
    episodes: raw.episodes.map((e) => ({
      kind: "episode",
      id: e.id,
      title: e.title,
      showName: e.show.name,
      clientName: e.show.client.name,
      dateLabel: formatShortDate(e.createdAt),
      href: `/episodes/${e.id}`,
    })),
  };
}

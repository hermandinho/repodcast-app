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
  getEpisode as dbGetEpisode,
  listEpisodesFiltered as dbListEpisodesFiltered,
  listEpisodesForShow as dbListEpisodesForShow,
  type ListEpisodesFilterInput,
} from "@/server/db/episodes";
import {
  listOutputsForEpisode as dbListOutputsForEpisode,
  qualityByPlatformForEpisode as dbQualityByPlatformForEpisode,
} from "@/server/db/outputs";
import {
  listRecentTransitions as dbListRecentTransitions,
  type TransitionWithContext,
} from "@/server/db/transitions";
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

export function isLiveDb(): boolean {
  return !!process.env.DATABASE_URL;
}

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
  APPROVED: "approved",
  SCHEDULED: "scheduled",
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
  return Promise.all(rows.map((s) => showToUI(ctx, s)));
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
  const lastActivity = episodes[0]?.updatedAt ?? s.updatedAt;

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
    episodes: episodes.slice(0, 5).map(episodeToUiSummary),
  };
}

function episodeToUiSummary(e: Episode) {
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
    outputs: "7 outputs",
  };
}

// ============================================================
// Episodes + outputs
// ============================================================

// ============================================================
// Episodes list (paginated /episodes index)
// ============================================================

export type EpisodeListStatus = "DRAFT" | "PROCESSING" | "READY" | "ARCHIVED";

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
  initial: string;
  avatarBg: string;
};

export type EpisodeListFilterOptions = {
  shows: { id: string; name: string }[];
  statuses: EpisodeListStatus[];
};

const EPISODE_STATUSES: EpisodeListStatus[] = ["DRAFT", "PROCESSING", "READY", "ARCHIVED"];

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
      return {
        id: s.key,
        title: ep?.episode ?? "Untitled episode",
        showId: s.key,
        showName: s.name,
        clientId: client?.key ?? "",
        clientName: client?.name ?? "",
        status: "READY",
        createdAt: ep?.episodeMeta?.split("·")[1]?.trim() ?? "Recently",
        outputCount: ep?.outputs.length ?? 7,
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
    initial: initialsOf(e.show.name),
    avatarBg: colorForName(e.show.name),
  }));

  return { items, total };
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
): Promise<{ show: SampleShow; episode: SampleEpisode } | null> {
  if (!isLiveDb()) {
    const show = sampleShows.find((s) => s.key === idOrKey);
    const episode = sampleEpisodes[idOrKey];
    if (!show || !episode) return null;
    return { show, episode };
  }

  let episodeRow: Episode | null = null;
  try {
    episodeRow = await dbGetEpisode(ctx, idOrKey);
  } catch {
    return null;
  }

  const [show, outputs, quality, versionCounts] = await Promise.all([
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
    outputs: outputs.map((o) => ({
      key: PLATFORM_TO_KEY[o.platform],
      id: o.id,
      meta: outputMetaFor(o.platform),
      status: STATUS_TO_KEY[o.status] ?? "ready",
      quality: o.quality ?? Math.round(quality[o.platform]?.avg ?? 0),
      content: o.content,
      version: o.version,
      versionCount: versionCountByPlatform.get(o.platform) ?? 1,
      failureReason: reasonByOutputId.get(o.id) ?? null,
    })),
  };

  return { show: showUI, episode };
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
): Promise<{ show: SampleShow; profile: VoiceProfile } | null> {
  if (!isLiveDb()) {
    const show = sampleShows.find((s) => s.key === idOrKey);
    const profile = voiceProfiles[idOrKey];
    if (!show || !profile) return null;
    return { show, profile };
  }

  let show: Awaited<ReturnType<typeof dbGetShow>>;
  try {
    show = await dbGetShow(ctx, idOrKey);
  } catch {
    return null;
  }

  const [samples, showUI, instructions] = await Promise.all([
    dbListVoiceSamplesForShow(ctx, show.id),
    showToUI(ctx, show),
    prisma.showPlatformInstruction.findMany({ where: { showId: show.id } }),
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

  return { show: showUI, profile };
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
      label: "Posted with no edits",
      value: `${summary.unedited}%`,
      // Lifetime metric — leave delta empty until 1.9 lands an edit-distance
      // field that lets us scope this to the current month meaningfully.
      delta: "",
      progress: summary.unedited,
      caption: "First-draft accept rate — the clearest sign the voice engine is working",
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

  return { kpis, recent, chart, activity };
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
  APPROVED: { color: "#2E9E5B", ring: "#E7F4EC" },
  SCHEDULED: { color: "#3A5BA0", ring: "#EEF2FB" },
  PUBLISHED: { color: "#2E9E5B", ring: "#E7F4EC" },
  FAILED: { color: "#C0392B", ring: "#FBEDEC" },
};

function transitionVerb(t: OutputStatus, prior: OutputStatus | null): string {
  switch (t) {
    case OutputStatus.APPROVED:
      return "approved";
    case OutputStatus.IN_REVIEW:
      return prior === OutputStatus.READY ? "sent for review" : "flagged for review";
    case OutputStatus.READY:
      return prior === OutputStatus.IN_REVIEW ? "rejected" : "generated";
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

import type { EpisodeStatus } from "./episode-status";

export type DashboardKpi = {
  label: string;
  /** Display value (e.g. "76%", "9", "63", "91%"). */
  value: string;
  /** Trend pill (e.g. "▲ 8 pts", "▲ 2 vs. May"). */
  delta: string;
  /** Only used for the hero KPI — drives the progress bar fill. */
  progress?: number;
  /** Only the hero KPI uses this caption. */
  caption?: string;
};

export const dashboardKpis: DashboardKpi[] = [
  {
    label: "Posted with no edits",
    value: "76%",
    delta: "▲ 8 pts",
    progress: 76,
    caption: "First-draft accept rate — the clearest sign the voice engine is working",
  },
  { label: "Episodes this month", value: "9", delta: "▲ 2 vs. May" },
  { label: "Outputs generated", value: "63", delta: "▲ 18%" },
  { label: "Approval rate", value: "91%", delta: "▲ 4 pts" },
];

export type RecentEpisode = {
  /** Routing key — live mode passes the real episode id; sample mode uses the
   *  parent show key since `/episodes/[id]` resolves either form. */
  key: string;
  title: string;
  client: string;
  initial: string;
  avatarBg: string;
  status: EpisodeStatus;
  outputs: string;
};

export const recentEpisodes: RecentEpisode[] = [
  {
    key: "ff",
    title: "Why Your First 10 Hires Define Everything",
    client: "The Founder's Frequency",
    initial: "FF",
    avatarBg: "#3A5BA0",
    status: "review",
    outputs: "7 outputs",
  },
  {
    key: "te",
    title: "Surviving 90 Days Off-Grid in Patagonia",
    client: "Trail & Error",
    initial: "TE",
    avatarBg: "#2E9E5B",
    status: "approved",
    outputs: "7 outputs",
  },
  {
    key: "mt",
    title: "The Index Fund Myth Everyone Repeats",
    client: "Money on the Table",
    initial: "MT",
    avatarBg: "#7A4FB0",
    status: "generating",
    outputs: "5 / 7",
  },
  {
    key: "ff",
    title: "The Pricing Conversation You're Avoiding",
    client: "The Founder's Frequency",
    initial: "FF",
    avatarBg: "#3A5BA0",
    status: "approved",
    outputs: "7 outputs",
  },
  {
    key: "te",
    title: "Reading Weather Without a Phone",
    client: "Trail & Error",
    initial: "TE",
    avatarBg: "#2E9E5B",
    status: "scheduled",
    outputs: "7 outputs",
  },
];

export type ActivityItem = {
  text: string;
  client: string;
  time: string;
  /** Dot color. */
  color: string;
  /** Outer ring color (lighter wash). */
  ring: string;
};

export const activityItems: ActivityItem[] = [
  {
    text: "You approved a LinkedIn post",
    client: "The Founder's Frequency",
    time: "12m ago",
    color: "#2E9E5B",
    ring: "#E7F4EC",
  },
  {
    text: "Maya Chen's voice reached Strong",
    client: "The Founder's Frequency",
    time: "1h ago",
    color: "#3A5BA0",
    ring: "#EEF2FB",
  },
  {
    text: "Generated 7 outputs",
    client: "Money on the Table",
    time: "2h ago",
    color: "#3A5BA0",
    ring: "#EEF2FB",
  },
  {
    text: "Sam Rivera approved an Instagram caption",
    client: "Trail & Error",
    time: "3h ago",
    color: "#2E9E5B",
    ring: "#E7F4EC",
  },
  {
    text: "Voice trained on 3 new samples",
    client: "Trail & Error",
    time: "4h ago",
    color: "#3A5BA0",
    ring: "#EEF2FB",
  },
  {
    text: "New episode uploaded",
    client: "The Pricing Conversation You're Avoiding",
    time: "5h ago",
    color: "#8B95A6",
    ring: "#EEF1F6",
  },
  {
    text: "Generated 7 outputs",
    client: "The Founder's Frequency",
    time: "Yesterday",
    color: "#3A5BA0",
    ring: "#EEF2FB",
  },
];

export type ChartSeries = {
  range: "8 weeks" | "12 weeks";
  rangeLabel: string;
  /** Total outputs at the end of the window. */
  total: number;
  /** Generated per week, parallel to `approved` and `labels`. */
  generated: number[];
  /** Approved per week. */
  approved: number[];
  /** Sparse week labels (e.g. ['Apr','','','May',…]). */
  labels: string[];
};

export const chartSeries: Record<"8 weeks" | "12 weeks", ChartSeries> = {
  "8 weeks": {
    range: "8 weeks",
    rangeLabel: "Last 8 weeks",
    total: 63,
    generated: [38, 44, 41, 52, 47, 58, 55, 63],
    approved: [33, 40, 36, 47, 43, 53, 50, 57],
    labels: ["Apr", "", "", "May", "", "", "Jun", ""],
  },
  "12 weeks": {
    range: "12 weeks",
    rangeLabel: "Last 12 weeks",
    total: 63,
    generated: [29, 34, 31, 38, 44, 41, 52, 47, 58, 55, 60, 63],
    approved: [24, 29, 27, 33, 40, 36, 47, 43, 53, 50, 55, 57],
    labels: ["Apr", "", "", "May", "", "", "Jun", "", "", "Jul", "", ""],
  },
};

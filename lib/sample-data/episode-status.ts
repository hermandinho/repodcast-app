export type EpisodeStatus =
  "generating" | "ready" | "review" | "scheduled" | "approved" | "published" | "failed";

export type StatusMeta = {
  label: string;
  bg: string;
  color: string;
  /** Subtle card border tint matching the status. */
  cardBorder: string;
};

export function statusMeta(status: EpisodeStatus): StatusMeta {
  switch (status) {
    case "generating":
      return { label: "Generating", bg: "#EEF2FB", color: "#3A5BA0", cardBorder: "#DDE5F4" };
    case "ready":
      // Peach — matches the ref's Ready pill and signals "attention needed"
      // without being alarmist.
      return { label: "Ready", bg: "#FDECDD", color: "#B9631C", cardBorder: "#F5D9BE" };
    case "review":
      return { label: "In review", bg: "#FBF1DE", color: "#A06D12", cardBorder: "#F0E3CB" };
    case "scheduled":
      // Purple — matches the Schedule CTA that got it into this state, so
      // the eye pairs pill and button color without a mental hop.
      return { label: "Scheduled", bg: "#EFEAFB", color: "#5D3FD3", cardBorder: "#D9CFF3" };
    case "approved":
      return { label: "Approved", bg: "#E7F4EC", color: "#1E7A47", cardBorder: "#CFE8DA" };
    case "published":
      return { label: "Published", bg: "#DBEDD9", color: "#166534", cardBorder: "#BEDDBA" };
    case "failed":
      return { label: "Failed", bg: "#FBEDEC", color: "#C0392B", cardBorder: "#F0CCC9" };
  }
}

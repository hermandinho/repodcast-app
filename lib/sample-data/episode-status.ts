export type EpisodeStatus = "generating" | "ready" | "review" | "scheduled" | "approved" | "failed";

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
      return { label: "Ready", bg: "#F1F4F9", color: "#7A8496", cardBorder: "#E6EBF3" };
    case "review":
      return { label: "In review", bg: "#FBF1DE", color: "#A06D12", cardBorder: "#F0E3CB" };
    case "scheduled":
      return { label: "Scheduled", bg: "#F1F4F9", color: "#7A8496", cardBorder: "#E6EBF3" };
    case "approved":
      return { label: "Approved", bg: "#E7F4EC", color: "#1E7A47", cardBorder: "#CFE8DA" };
    case "failed":
      return { label: "Failed", bg: "#FBEDEC", color: "#C0392B", cardBorder: "#F0CCC9" };
  }
}

export type PlatformKey = "x" | "li" | "ig" | "tt" | "notes" | "blog" | "news";

export type PlatformMeta = {
  key: PlatformKey;
  /** Short name for badges and chips (e.g. "X / Twitter"). */
  name: string;
  /** Long name for context-rich UI (e.g. "X / Twitter Thread"). */
  fullName: string;
  /** Short description shown in the new-episode platform list. */
  desc: string;
  badge: string;
  badgeBg: string;
  badgeColor: string;
  badgeBorder: string;
};

export const platforms: PlatformMeta[] = [
  {
    key: "x",
    name: "X / Twitter",
    fullName: "X / Twitter Thread",
    desc: "Threaded hook and payoff",
    badge: "𝕏",
    badgeBg: "#15171A",
    badgeColor: "#fff",
    badgeBorder: "#15171A",
  },
  {
    key: "li",
    name: "LinkedIn",
    fullName: "LinkedIn Post",
    desc: "Professional single post",
    badge: "in",
    badgeBg: "#0A66C2",
    badgeColor: "#fff",
    badgeBorder: "#0A66C2",
  },
  {
    key: "ig",
    name: "Instagram",
    fullName: "Instagram Caption",
    desc: "Caption with hashtags",
    badge: "IG",
    badgeBg: "#D62976",
    badgeColor: "#fff",
    badgeBorder: "#D62976",
  },
  {
    key: "tt",
    name: "TikTok",
    fullName: "TikTok Script",
    desc: "Short-form video script",
    badge: "TT",
    badgeBg: "#111315",
    badgeColor: "#fff",
    badgeBorder: "#111315",
  },
  {
    key: "notes",
    name: "Show Notes",
    fullName: "Show Notes",
    desc: "Summary and timestamps",
    badge: "≡",
    badgeBg: "#EEF2FB",
    badgeColor: "#3A5BA0",
    badgeBorder: "#DDE5F4",
  },
  {
    key: "blog",
    name: "Blog Post",
    fullName: "Blog Post",
    desc: "Long-form article draft",
    badge: "¶",
    badgeBg: "#EEF2FB",
    badgeColor: "#3A5BA0",
    badgeBorder: "#DDE5F4",
  },
  {
    key: "news",
    name: "Newsletter",
    fullName: "Newsletter",
    desc: "Email issue with subject",
    badge: "✉",
    badgeBg: "#EEF2FB",
    badgeColor: "#3A5BA0",
    badgeBorder: "#DDE5F4",
  },
];

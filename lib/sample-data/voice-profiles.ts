import type { PlatformKey } from "./platforms";

export type VoiceSample = {
  platform: PlatformKey;
  text: string;
  episode: string;
  date: string;
};

export type VoiceInstructions = {
  global: string;
  perPlatform: Record<PlatformKey, string>;
};

export type VoiceProfile = {
  clientKey: string;
  description: string;
  tags: string[];
  samples: VoiceSample[];
  instructions: VoiceInstructions;
};

export const voiceProfiles: Record<string, VoiceProfile> = {
  ff: {
    clientKey: "ff",
    description:
      "Direct and energetic with a builder's optimism. Short, punchy sentences. Opens on a contrarian hook, favors concrete numbers over abstractions, and always lands on one actionable takeaway. Warm but never fluffy — talks to founders like a peer who's been in the trenches.",
    tags: [
      "Contrarian hook",
      "Short sentences",
      "Concrete numbers",
      "One clear takeaway",
      "Peer-to-peer tone",
    ],
    samples: [
      {
        platform: "x",
        text: "Your first 10 hires aren't employees — they're co-authors of your culture. Get the first three right and everyone after raises their own bar.",
        episode: "Ep 47",
        date: "Jun 24",
      },
      {
        platform: "li",
        text: "Most founders obsess over hire #100. The ones who win obsess over hire #4 — the first person who joins because of the bar, not in spite of it.",
        episode: "Ep 47",
        date: "Jun 24",
      },
      {
        platform: "ig",
        text: "Save this before your next hire. Hire for slope, not intercept. Your first 3 set the bar. Write the culture doc first.",
        episode: "Ep 45",
        date: "Jun 17",
      },
      {
        platform: "notes",
        text: "00:00 Cold open — hires as source code. 04:12 Hire for slope, not intercept. 11:40 The first-3 bar-setting effect.",
        episode: "Ep 47",
        date: "Jun 24",
      },
      {
        platform: "blog",
        text: "There's a quiet moment in every company's life when it stops being a project and starts being an organization. For Dani Okafor, that moment is hire number ten.",
        episode: "Ep 44",
        date: "Jun 10",
      },
      {
        platform: "news",
        text: "Subject: Your first 10 hires are writing your source code. Three takeaways worth your inbox this week.",
        episode: "Ep 47",
        date: "Jun 24",
      },
      {
        platform: "x",
        text: "“Hire for slope, not intercept.” Where someone is going matters more than where they are today.",
        episode: "Ep 45",
        date: "Jun 17",
      },
      {
        platform: "li",
        text: "If you can't write your culture doc, you're not ready to hire — you're about to outsource that definition to whoever joins next.",
        episode: "Ep 44",
        date: "Jun 10",
      },
    ],
    instructions: {
      global:
        "Always open with a contrarian or counterintuitive hook. Keep sentences short. Prefer concrete numbers over adjectives. End every piece with one clear, actionable takeaway. Never use corporate jargon. Refer to the audience as “founders” or “you,” never “entrepreneurs.”",
      perPlatform: {
        x: "Lead tweet hooks in under 200 chars. 5–7 tweets max. End with “Full episode below.”",
        li: "No hashtags. Close with one question to the reader.",
        ig: "3–5 lowercase hashtags max. Caption under 125 words.",
        tt: "Hook in the first 3 seconds. Mark beats with timestamps.",
        notes: "Always include timestamps and the guest's handle.",
        blog: "800–1,200 words. H1 = episode title. Open with a scene.",
        news: "Subject line under 55 chars. Sign off as “Maya.”",
      },
    },
  },

  te: {
    clientKey: "te",
    description:
      "Vivid and sensory with understated grit. Lets the landscape do the talking, leans on concrete detail over adjectives, and closes calm. Never sells the adventure — just reports it honestly and lets the reader feel the weight of the pack.",
    tags: ["Sensory detail", "Understated", "Calm close", "No hype", "Concrete over abstract"],
    samples: [
      {
        platform: "ig",
        text: "90 days. No resupply. Just Patagonia. What the wilderness teaches when the signal drops.",
        episode: "Ep 23",
        date: "Jun 18",
      },
      {
        platform: "blog",
        text: "There's a specific kind of quiet you only find when the last bar of signal disappears. On this episode, Sam walks us through ninety days of it.",
        episode: "Ep 23",
        date: "Jun 18",
      },
      {
        platform: "li",
        text: "The biggest lesson wasn't about gear — it was about how fast “essential” gets redefined when you carry everything on your back.",
        episode: "Ep 22",
        date: "Jun 4",
      },
      {
        platform: "notes",
        text: "00:00 Why no resupply. 08:30 Day 12: fear to focus. 21:15 Redefining “essential.”",
        episode: "Ep 23",
        date: "Jun 18",
      },
    ],
    instructions: {
      global:
        "Let detail carry the weight — show, don't sell. Keep adjectives sparse. Never use exclamation points. Close calm.",
      perPlatform: {
        x: "Open mid-scene. No hashtags in the thread body.",
        li: "One vivid image, one lesson. No “gear list” bullets.",
        ig: "Location tag + 4 hashtags. Lead with a sensory line.",
        tt: "Open on the landscape, not the host.",
        notes: "Timestamps plus a one-line gear note.",
        blog: "Long-form, present tense where possible.",
        news: "Short. One photo caption energy per paragraph.",
      },
    },
  },

  mt: {
    clientKey: "mt",
    description:
      "Plain-spoken and skeptical, allergic to jargon. Reframes conventional wisdom with a sharp question, uses everyday analogies, and respects the listener's intelligence. Still calibrating — approve a few more outputs to lock in the voice.",
    tags: ["Plain-spoken", "Skeptical", "Everyday analogies", "Reframes wisdom"],
    samples: [
      {
        platform: "li",
        text: "“Just buy the index fund.” It's not wrong — but it's not the whole sentence. Here's what “passive” actually costs you.",
        episode: "Ep 12",
        date: "Jun 20",
      },
      {
        platform: "notes",
        text: "00:00 The half-sentence problem. 06:40 Index vs. safe. 14:20 When passive stops working.",
        episode: "Ep 12",
        date: "Jun 20",
      },
      {
        platform: "blog",
        text: "“Just buy the index fund” might be the most repeated piece of financial advice of the decade. It's also incomplete.",
        episode: "Ep 11",
        date: "Jun 13",
      },
      {
        platform: "x",
        text: "Index ≠ safe. Index = average. Those aren't the same word.",
        episode: "Ep 11",
        date: "Jun 13",
      },
    ],
    instructions: {
      global:
        "Reframe one piece of conventional wisdom per piece. No jargon — if a term needs defining, use an everyday analogy. Respect the reader; never condescend.",
      perPlatform: {
        x: "Lead with the myth, then the correction.",
        li: "Pose the question in line one.",
        ig: "Plain language. 3 hashtags max.",
        tt: "State the myth, pause, correct it.",
        notes: "Define every financial term inline.",
        blog: "Use a household analogy in the intro.",
        news: "One myth per issue. Subject states the myth.",
      },
    },
  },
};

export function getVoiceProfile(clientKey: string): VoiceProfile | undefined {
  return voiceProfiles[clientKey];
}

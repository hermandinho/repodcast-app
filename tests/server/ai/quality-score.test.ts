import { Platform } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { scoreOutput } from "@/server/ai/quality-score";

// Each platform's "good" sample is hand-tuned to satisfy the heuristic on
// both axes — they assert the scorer's calibration, not the model's quality.
// The negative cases verify the score actually drops when shape breaks.

describe("scoreOutput — universal", () => {
  it("returns 0 for empty content", () => {
    for (const p of Object.values(Platform)) {
      expect(scoreOutput(p, "")).toBe(0);
      expect(scoreOutput(p, "   \n\n  ")).toBe(0);
    }
  });

  it("never returns a score outside [0, 100]", () => {
    const huge = "word ".repeat(5000);
    for (const p of Object.values(Platform)) {
      const s = scoreOutput(p, huge);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(100);
    }
  });
});

describe("scoreOutput — TWITTER", () => {
  const goodThread = [
    "1/ The opening hook in one tight tweet.",
    "2/ A second beat that lands a concrete number — 47 minutes saved per episode.",
    "3/ A third tweet expanding the why, still tight.",
    "4/ Fourth tweet — the pivot.",
    "5/ Final tweet with the takeaway and the link.",
  ].join("\n\n");

  it("scores a well-formed 5-tweet thread high", () => {
    expect(scoreOutput(Platform.TWITTER, goodThread)).toBeGreaterThanOrEqual(80);
  });

  it("drops when there are too few tweets", () => {
    const twoTweets = "1/ Only one beat.\n\n2/ And another.";
    expect(scoreOutput(Platform.TWITTER, twoTweets)).toBeLessThan(70);
  });

  it("penalises tweets that blow past 280 chars", () => {
    const tooLong = [
      "1/ " + "x".repeat(310),
      "2/ " + "x".repeat(310),
      "3/ " + "x".repeat(310),
      "4/ " + "x".repeat(310),
      "5/ " + "x".repeat(310),
    ].join("\n\n");
    const score = scoreOutput(Platform.TWITTER, tooLong);
    expect(score).toBeLessThan(scoreOutput(Platform.TWITTER, goodThread));
  });
});

describe("scoreOutput — LINKEDIN", () => {
  const goodPost = [
    "Most founders obsess over hire #100. The winners obsess over hire #4 — the one nobody writes essays about, but the one that quietly decides whether your culture compiles or not.",
    "Three ideas that stuck with me this week after recording with Dani Okafor, who scaled a team from four to four hundred and still talks about hire #4 like it was the most important call she ever made:",
    "• Hire for slope, not intercept. Trajectory beats résumé every time, and the candidates who light up about how they want to grow are almost always the ones who actually do.",
    "• Your first 3 hires set a bar everyone else pattern-matches to. Get them wrong and you spend the next four years debugging people decisions while pretending the problem is something else.",
    "• If you can't sit down today and write a one-page culture doc, you're not ready to make the next hire. The exercise of having to articulate it is the whole point.",
    "The uncomfortable part nobody admits to? Most of us hire people exactly like ourselves — and quietly install our own blind spots at scale, then wonder why the company keeps tripping over the same kind of problem.",
    "What was your most important early hire, and what did it teach you? Drop it in the comments — I read every reply, and the answers usually surprise me.",
  ].join("\n\n");

  it("scores a paragraph-broken post in the 700–1,400 char range", () => {
    expect(goodPost.length).toBeGreaterThanOrEqual(700);
    expect(goodPost.length).toBeLessThanOrEqual(1400);
    expect(scoreOutput(Platform.LINKEDIN, goodPost)).toBeGreaterThanOrEqual(75);
  });

  it("drops when the post is one long blob with no breaks", () => {
    const wallOfText = "Word ".repeat(200).trim();
    expect(scoreOutput(Platform.LINKEDIN, wallOfText)).toBeLessThan(
      scoreOutput(Platform.LINKEDIN, goodPost),
    );
  });

  it("penalises hashtag spam", () => {
    const spammy = goodPost + "\n\n#founders #hiring #startup #culture #leadership #vc";
    expect(scoreOutput(Platform.LINKEDIN, spammy)).toBeLessThan(
      scoreOutput(Platform.LINKEDIN, goodPost),
    );
  });
});

describe("scoreOutput — INSTAGRAM", () => {
  const goodCaption =
    "90 days. No resupply. Just Patagonia. 🏔️\n\n" +
    "Three things the silence teaches you when the last bar of signal disappears 👇\n\n" +
    "Link in bio. 🎧\n\n" +
    "#backpacking #patagonia #offgrid #adventurepodcast";

  it("scores a clean caption with 3–5 lowercase hashtags + 1–3 emoji high", () => {
    expect(scoreOutput(Platform.INSTAGRAM, goodCaption)).toBeGreaterThanOrEqual(75);
  });

  it("penalises UPPERCASE hashtags", () => {
    const upper = goodCaption.replace(/#\w+/g, (h) => h.toUpperCase());
    expect(scoreOutput(Platform.INSTAGRAM, upper)).toBeLessThan(
      scoreOutput(Platform.INSTAGRAM, goodCaption),
    );
  });

  it("penalises emoji spam", () => {
    const emojiSpam = goodCaption + "\n\n🔥🔥🔥💯💯💯⚡⚡⚡🚀🚀🚀✨✨✨";
    expect(scoreOutput(Platform.INSTAGRAM, emojiSpam)).toBeLessThan(
      scoreOutput(Platform.INSTAGRAM, goodCaption),
    );
  });

  it("drops when word count blows well past 125", () => {
    const longCaption = "word ".repeat(300) + "\n#a #b #c 🎧";
    expect(scoreOutput(Platform.INSTAGRAM, longCaption)).toBeLessThan(
      scoreOutput(Platform.INSTAGRAM, goodCaption),
    );
  });
});

describe("scoreOutput — TIKTOK", () => {
  const goodScript = [
    "[HOOK — 0:00]",
    "Your first 10 hires aren't employees. They're writing your company's source code.",
    "",
    "[BEAT — 0:03]",
    "Dani scaled a team 4 → 400. She says the first ten decided all of it.",
    "",
    "[BEAT — 0:09]",
    "Rule: hire for slope, not intercept.",
    "",
    "[BEAT — 0:15]",
    "The trap? Scaling your own blind spots at scale.",
    "",
    "[CTA — 0:21]",
    "Follow for the full breakdown.",
  ].join("\n");

  it("scores a beat-marked script high", () => {
    expect(scoreOutput(Platform.TIKTOK, goodScript)).toBeGreaterThanOrEqual(70);
  });

  it("drops sharply when beat markers are missing", () => {
    const unmarked = goodScript.replace(/\[[^\]]+\]/g, "").trim();
    expect(scoreOutput(Platform.TIKTOK, unmarked)).toBeLessThan(
      scoreOutput(Platform.TIKTOK, goodScript) - 30,
    );
  });
});

describe("scoreOutput — SHOW_NOTES", () => {
  const goodNotes = [
    "Maya sits down with Dani Okafor on why the first 10 hires define a company. A practical walk through the framework Okafor used to scale a team from 4 to 400 — and the culture-doc test that tells you whether you're ready to grow at all.",
    "",
    "00:00 — Cold open: hires as source code",
    "04:12 — Hire for slope, not intercept",
    "11:40 — The first-3 bar-setting effect",
    "19:05 — Avoiding the clone trap",
    "27:30 — The culture-doc test",
    "34:18 — Q&A: hardest early hire",
  ].join("\n");

  it("scores a notes page with summary + 5+ timestamps high", () => {
    expect(scoreOutput(Platform.SHOW_NOTES, goodNotes)).toBeGreaterThanOrEqual(70);
  });

  it("drops sharply when there are no timestamps", () => {
    const noTimestamps = goodNotes.replace(/\d{1,2}:\d{2} — /g, "• ");
    expect(scoreOutput(Platform.SHOW_NOTES, noTimestamps)).toBeLessThan(
      scoreOutput(Platform.SHOW_NOTES, goodNotes),
    );
  });
});

describe("scoreOutput — BLOG", () => {
  const goodBlog =
    "# Why Your First 10 Hires Define Everything\n\n" +
    ("There's a quiet moment in every company's life when it stops being a project and starts being an organization. ".repeat(
      2,
    ) +
      "\n\n") +
    (
      "According to Dani Okafor, that moment isn't a funding round or a launch. It's hire number ten. ".repeat(
        3,
      ) + "\n\n"
    ).repeat(15);

  it("scores a long-form post with an H1 + many paragraphs high", () => {
    const wc = goodBlog.trim().split(/\s+/).length;
    expect(wc).toBeGreaterThanOrEqual(800);
    expect(scoreOutput(Platform.BLOG, goodBlog)).toBeGreaterThanOrEqual(70);
  });

  it("drops when there is no H1 and only a short body", () => {
    const stub = "Just a couple of sentences here. Nothing more.";
    expect(scoreOutput(Platform.BLOG, stub)).toBeLessThan(40);
  });
});

describe("scoreOutput — NEWSLETTER", () => {
  const goodEmail = [
    "Subject: Your first 10 hires are writing your source code",
    "",
    "Hey —",
    "",
    "This week Dani Okafor (4 → 400) made a case that stuck with me: the first ten people you hire don't fill roles, they define the company.",
    "",
    "Three takeaways worth your inbox:",
    "",
    "1. Hire for slope, not intercept.",
    "2. Your first 3 hires set the bar everyone copies.",
    "3. Can't write the culture doc? You're not ready to hire.",
    "",
    ...Array.from(
      { length: 18 },
      (_, i) =>
        `Expansion paragraph ${i + 1} — concrete detail and a few more words so the body hits the 300–600 word target the heuristic is calibrated around.`,
    ),
    "",
    "Until next week,",
    "Maya",
  ].join("\n");

  it("scores a complete email with subject + sign-off high", () => {
    expect(scoreOutput(Platform.NEWSLETTER, goodEmail)).toBeGreaterThanOrEqual(70);
  });

  it("drops when the subject line is missing", () => {
    const noSubject = goodEmail.replace(/^Subject:[^\n]+\n+/i, "");
    expect(scoreOutput(Platform.NEWSLETTER, noSubject)).toBeLessThan(
      scoreOutput(Platform.NEWSLETTER, goodEmail),
    );
  });

  it("drops when the subject line is too long", () => {
    const tooLongSubject = goodEmail.replace(/^Subject:[^\n]+/, "Subject: " + "x".repeat(80));
    expect(scoreOutput(Platform.NEWSLETTER, tooLongSubject)).toBeLessThan(
      scoreOutput(Platform.NEWSLETTER, goodEmail),
    );
  });
});

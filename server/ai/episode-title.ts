import "server-only";

import { CLAUDE_MODEL, requireClaudeClient } from "./claude";
import { extractText } from "./prompt-builder";

/**
 * Ask Claude for a short, publishable episode title based on the
 * transcript. Called from `generate-episode` when the wizard didn't
 * capture a real title (e.g. UPLOAD flows where the user skipped step
 * 4, or PASTE flows without a manual title) so the episode doesn't
 * live in the dashboard as "Untitled episode" forever.
 *
 * Deliberately narrow: one call, tight token budget, no tools. The
 * transcript is truncated to `MAX_INPUT_CHARS` so this stays cheap on
 * long shows — the first ~15k characters are enough context for a
 * useful title. Falls back to null when the call errors or comes back
 * with something unusable; the caller keeps the placeholder.
 */

/** Rough character budget — ~4k tokens of transcript context. */
const MAX_INPUT_CHARS = 15_000;

const SYSTEM_PROMPT = `You write clean, punchy podcast episode titles.

Rules:
- 3 to 8 words. No trailing punctuation.
- No emojis, no all-caps, no clickbait ("You won't believe…").
- Prefer a concrete noun/verb from the actual content over a generic label.
- Do NOT prefix with "Episode X:", "How to", or the host/guest name unless it's the whole point.
- Do NOT wrap the title in quotes.
- Reply with ONLY the title text. No preamble, no explanation.`;

export type EpisodeTitleContext = {
  showName?: string | null;
  hostName?: string | null;
};

export async function suggestEpisodeTitle(
  transcript: string,
  context: EpisodeTitleContext = {},
): Promise<string | null> {
  const trimmed = transcript.trim();
  if (trimmed.length === 0) return null;

  const client = requireClaudeClient();
  const contextLine =
    context.showName || context.hostName
      ? `Show: ${context.showName ?? "unknown"}${
          context.hostName ? ` · Host: ${context.hostName}` : ""
        }\n\n`
      : "";
  const excerpt = trimmed.slice(0, MAX_INPUT_CHARS);

  let response;
  try {
    response = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 60,
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [
        {
          role: "user",
          content: `${contextLine}Transcript (may be truncated):\n\n${excerpt}\n\nReturn ONLY the title.`,
        },
      ],
    });
  } catch (err) {
    // Cheap best-effort call — never block the pipeline. Log so we can
    // spot patterns (rate limits, malformed prompts) in Sentry.
    console.warn("[episode-title] Claude call failed", err);
    return null;
  }

  return sanitizeTitle(extractText(response));
}

/**
 * Clean up common model habits: surrounding quotes, trailing periods,
 * accidental "Title:" prefix, code fences. Returns null when the
 * cleaned string doesn't look like a usable title.
 */
export function sanitizeTitle(raw: string): string | null {
  let s = raw.trim();
  if (s.length === 0) return null;
  s = s.replace(/^```(?:text|markdown)?\s*|\s*```$/g, "").trim();
  s = s.replace(/^title\s*[:\-–]\s*/i, "").trim();
  // Strip a single pair of surrounding quotes (straight or curly).
  s = s
    .replace(/^["“‘'`]+/, "")
    .replace(/["”’'`]+$/, "")
    .trim();
  // Take the first non-empty line — the model occasionally adds a
  // subtitle on line 2 despite the prompt.
  const firstLine = s.split(/\r?\n/).find((line) => line.trim().length > 0);
  s = (firstLine ?? "").trim();
  // Trailing sentence punctuation reads like a summary, not a title.
  s = s.replace(/[.!?]+$/g, "").trim();
  if (s.length === 0) return null;
  // Guard against a stray paragraph of prose slipping through.
  if (s.length > 140) return null;
  return s;
}

/**
 * Is this the kind of title we'd overwrite with an auto-generated one?
 * `"Untitled episode"` is the wizard fallback in `episodes/new/actions.ts`;
 * empty / whitespace-only covers defensive cases.
 */
export function isPlaceholderTitle(title: string | null | undefined): boolean {
  if (!title) return true;
  const t = title.trim();
  if (t.length === 0) return true;
  const lower = t.toLowerCase();
  return lower === "untitled episode" || lower === "untitled";
}

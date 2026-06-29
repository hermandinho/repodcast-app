import "server-only";

import { CLAUDE_MODEL, requireClaudeClient } from "./claude";
import { extractText } from "./prompt-builder";

/**
 * A standout idea/quote pulled from the transcript. The generation pipeline
 * extracts these *once* per episode, then all 7 platform prompts share the
 * list — keeping a consistent narrative arc across outputs.
 */
export type KeyMoment = {
  /** Short label for the moment (e.g. "Hire for slope, not intercept"). */
  topic: string;
  /** Direct quote from the speaker, lightly cleaned. */
  quote: string;
  /** Optional timestamp like "12:30" when the transcript has time markers. */
  timestamp?: string;
  /** One sentence explaining why this moment matters. */
  insight: string;
};

const SYSTEM_PROMPT = `You extract the 3–5 most useful moments from podcast transcripts so writers
can build platform-specific content around the same narrative spine.

Pick moments that are:
- Concrete, not abstract — a specific claim, anecdote, or rule the host or guest stated.
- Standalone — would make sense pulled out as a tweet or a section header.
- Distinct — don't pick two that say the same thing in different words.

For each moment, return:
- "topic" — a 3–6 word label
- "quote" — the speaker's exact words, lightly cleaned (remove filler, keep voice)
- "timestamp" — MM:SS if the transcript has time markers, omit otherwise
- "insight" — one sentence on why this moment matters

Respond ONLY with a JSON array. No prose, no markdown fences, no preamble.`;

/**
 * Pull the JSON array out of a model response that *might* be wrapped in code
 * fences or have leading whitespace. We try strict parse first, then a more
 * forgiving regex fallback for ```json fences.
 */
export function parseKeyMoments(text: string): KeyMoment[] {
  const tryParse = (s: string): KeyMoment[] | null => {
    try {
      const parsed = JSON.parse(s);
      return Array.isArray(parsed) ? (parsed as KeyMoment[]) : null;
    } catch {
      return null;
    }
  };

  const trimmed = text.trim();
  const direct = tryParse(trimmed);
  if (direct) return validate(direct);

  // ```json … ``` fence
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    const inner = tryParse(fence[1].trim());
    if (inner) return validate(inner);
  }

  // Last-resort: find the first '[' and last ']' and try the slice.
  const start = trimmed.indexOf("[");
  const end = trimmed.lastIndexOf("]");
  if (start !== -1 && end > start) {
    const slice = tryParse(trimmed.slice(start, end + 1));
    if (slice) return validate(slice);
  }

  throw new Error(
    `Could not parse key moments from model response. Got:\n${trimmed.slice(0, 400)}`,
  );
}

function validate(raw: unknown[]): KeyMoment[] {
  return raw
    .filter((m): m is Record<string, unknown> => typeof m === "object" && m !== null)
    .map((m) => ({
      topic: String(m.topic ?? "").trim(),
      quote: String(m.quote ?? "").trim(),
      timestamp:
        typeof m.timestamp === "string" && m.timestamp.trim() !== ""
          ? m.timestamp.trim()
          : undefined,
      insight: String(m.insight ?? "").trim(),
    }))
    .filter((m) => m.topic.length > 0 && m.quote.length > 0);
}

/**
 * Call Claude to extract the key moments from a transcript. Cached system
 * prompt is reused across episodes; user message changes per call.
 */
export async function extractKeyMoments(transcript: string): Promise<KeyMoment[]> {
  const client = requireClaudeClient();
  const response = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1500,
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [
      {
        role: "user",
        content: `Episode transcript:\n\n${transcript}\n\nReturn the JSON array now.`,
      },
    ],
  });
  return parseKeyMoments(extractText(response));
}

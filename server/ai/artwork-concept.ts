import "server-only";

import { CLAUDE_MODEL, requireClaudeClient } from "./claude";
import { extractText } from "./prompt-builder";

/**
 * Q1 feature #4 — Claude picks a visual concept for the episode's hero
 * artwork BEFORE we hand off to Workers AI. Two-stage prompting keeps
 * the image-model prompt small, high-signal, and consistent across the
 * three aspect ratios (16:9, 1:1, 9:16).
 *
 * The concept describes the scene, palette, mood, and any text overlay
 * we want the image model to lean into. Cached on Episode.artworkConcept
 * so a subsequent "generate variants" flow doesn't re-call Claude.
 */

export type ArtworkConcept = {
  /** One-sentence scene description — the primary subject. */
  subject: string;
  /** Dominant mood/tone in 1–3 words. */
  mood: string;
  /** 2–4 hex colors or descriptive palette (e.g. "amber, deep navy"). */
  palette: string;
  /** Short optional text overlay for thumbnails. Empty string = no text. */
  textOverlay: string;
  /** Style directives (e.g. "cinematic, editorial, high contrast"). */
  style: string;
};

const SYSTEM_PROMPT = `You pick the visual concept for a podcast episode's hero
artwork. The concept feeds an image model (Flux) that renders three
aspect ratios: 16:9, 1:1, 9:16.

Aim for:
- A single, concrete SUBJECT that captures the episode's central image or
  metaphor. Not "a person talking" — something specific (a lone chess
  piece on a highway, a cracked terracotta jar, a datacenter at dusk).
- A MOOD that tells the model what emotion to strike (contemplative,
  urgent, warm, ominous).
- A PALETTE — 2–4 colors, hex or plain names.
- A STYLE — editorial photography? Cinematic still? Flat illustration?
- An optional TEXT OVERLAY, only when the episode has a hook line short
  enough to fit on a thumbnail (<= 4 words). Otherwise return "" —
  empty text.

Respond ONLY with a JSON object with these five keys. No prose, no
markdown fences, no preamble.`;

/** Exposed for tests. */
export function parseArtworkConcept(text: string): ArtworkConcept {
  const trimmed = text.trim();

  const tryParse = (s: string): unknown => {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  };

  // Direct parse, fence-stripped parse, or "{ … }" slice fallback —
  // same pattern as key-moments / highlight-selection.
  let raw: unknown = tryParse(trimmed);
  if (!raw || typeof raw !== "object") {
    const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) raw = tryParse(fence[1].trim());
  }
  if (!raw || typeof raw !== "object") {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start !== -1 && end > start) raw = tryParse(trimmed.slice(start, end + 1));
  }
  if (!raw || typeof raw !== "object") {
    throw new Error(
      `Could not parse artwork concept from model response. Got:\n${trimmed.slice(0, 400)}`,
    );
  }

  const obj = raw as Record<string, unknown>;
  return {
    subject: str(obj.subject),
    mood: str(obj.mood),
    palette: str(obj.palette),
    textOverlay: str(obj.textOverlay),
    style: str(obj.style),
  };
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Ask Claude for the concept. Uses a cached system prompt (episode-
 * dependent input only in the user message).
 */
export async function selectArtworkConcept(input: {
  episodeTitle: string;
  showName: string;
  hostName?: string | null;
  voiceDescription?: string | null;
  transcript: string;
  hookMoments?: readonly string[];
}): Promise<ArtworkConcept> {
  const client = requireClaudeClient();

  // Trim the transcript so we're not sending 30k tokens for a concept.
  // First ~4000 chars captures enough narrative arc; the hookMoments
  // list gives Claude a summary of the strongest beats to draw from.
  const transcriptSlice =
    input.transcript.length > 4000
      ? input.transcript.slice(0, 4000) + "\n[... transcript truncated ...]"
      : input.transcript;
  const hooks =
    input.hookMoments && input.hookMoments.length > 0
      ? `\nKey moments in this episode:\n${input.hookMoments.map((h) => `- ${h}`).join("\n")}`
      : "";

  const userMessage =
    `Show: ${input.showName}\n` +
    (input.hostName ? `Host: ${input.hostName}\n` : "") +
    (input.voiceDescription ? `Voice: ${input.voiceDescription}\n` : "") +
    `Episode: ${input.episodeTitle}\n\n` +
    `Transcript (excerpt):\n${transcriptSlice}${hooks}\n\n` +
    `Return the JSON object now.`;

  const response = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 700,
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: userMessage }],
  });

  return parseArtworkConcept(extractText(response));
}

/**
 * Turn the concept into a Flux-ready prompt. Aspect ratio dictates one
 * additional line so the model composes for the canvas.
 */
export function buildImagePrompt(concept: ArtworkConcept, aspect: "16:9" | "1:1" | "9:16"): string {
  const aspectDirective = {
    "16:9": "Compose for a wide 16:9 canvas — horizontal, cinematic framing.",
    "1:1": "Compose for a square 1:1 canvas — centered, iconic framing.",
    "9:16": "Compose for a tall 9:16 canvas — vertical, mobile-first framing.",
  }[aspect];

  const overlayLine = concept.textOverlay
    ? `Text overlay: "${concept.textOverlay}", set in a bold sans-serif, high-contrast against the background.`
    : "No text in the image.";

  return [
    `${concept.subject}.`,
    `Mood: ${concept.mood}.`,
    `Palette: ${concept.palette}.`,
    `Style: ${concept.style}.`,
    aspectDirective,
    overlayLine,
    "Podcast episode artwork — hero image, not a portrait, not a photograph of a microphone.",
  ]
    .filter(Boolean)
    .join(" ");
}

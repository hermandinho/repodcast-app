import "server-only";

import type Anthropic from "@anthropic-ai/sdk";
import { CLAUDE_MODEL } from "./claude";

/**
 * One Claude call: condense a set of approved samples into a 2–3 sentence
 * narrative voice profile. Intentionally short — long descriptions tend to
 * dilute the prompt builder's cached identity block.
 */

const SYSTEM_PROMPT = `You are a senior brand voice editor. Read a podcast host's
approved social outputs and write a 2–3 sentence description of their voice.
Lead with tone, then 1–2 craft tells (sentence shape, common openers, hooks),
then how they close. Skip filler. Never use bullet lists or headings. Avoid
adjectives like "engaging" or "authentic" — point to *what they do* instead.
Target ~55 words. Output the description text only, no preamble.`;

export type VoiceSampleForSummary = {
  platform: string;
  content: string;
};

export type SummariseVoiceInput = {
  clientName: string;
  hostName: string;
  samples: VoiceSampleForSummary[];
};

export type SummariseVoiceResult = {
  description: string;
  inputTokens: number;
  outputTokens: number;
};

function renderUserBlock(input: SummariseVoiceInput): string {
  const sampleLines = input.samples.map(
    (s, i) => `## Sample ${i + 1} — ${s.platform}\n${s.content.trim()}`,
  );
  return [
    `Podcast: ${input.clientName}`,
    `Host: ${input.hostName}`,
    "",
    "Below are the host's most recently approved outputs. Write the voice description.",
    "",
    sampleLines.join("\n\n"),
  ].join("\n");
}

export async function summariseVoice(
  client: Anthropic,
  input: SummariseVoiceInput,
): Promise<SummariseVoiceResult> {
  if (input.samples.length === 0) {
    throw new Error("summariseVoice requires at least one sample");
  }

  const response = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 280,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: renderUserBlock(input) }],
  });

  const text = response.content
    .flatMap((b) => (b.type === "text" ? [b.text] : []))
    .join("\n")
    .trim();

  return {
    description: text,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}

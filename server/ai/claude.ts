import "server-only";

import Anthropic from "@anthropic-ai/sdk";

const globalForClaude = globalThis as unknown as { anthropic?: Anthropic };

/**
 * The Claude model used everywhere. Centralised so we can swap versions
 * (e.g. when 4.7 lands) by editing one line.
 */
export const CLAUDE_MODEL = "claude-sonnet-4-6";

/**
 * Returns a configured Anthropic client, or null when ANTHROPIC_API_KEY is
 * unset. Callers that legitimately precede AI setup (e.g. build-time route
 * collection) get null; callers that need to actually invoke Claude should
 * call `requireClaudeClient()` instead.
 */
export function getClaudeClient(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  if (!globalForClaude.anthropic) {
    globalForClaude.anthropic = new Anthropic({ apiKey });
  }
  return globalForClaude.anthropic;
}

export function requireClaudeClient(): Anthropic {
  const client = getClaudeClient();
  if (!client) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }
  return client;
}

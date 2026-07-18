import "server-only";

import Anthropic from "@anthropic-ai/sdk";

const globalForClaude = globalThis as unknown as { anthropic?: Anthropic };

/**
 * Vercel AI Gateway base URL. When AI_GATEWAY_API_KEY is set we route through
 * here instead of calling Anthropic direct — buys us spend caps, per-user
 * rate limits, provider fallback, and per-route token observability.
 */
const GATEWAY_BASE_URL = "https://ai-gateway.vercel.sh";

const CLAUDE_MODEL_BASE = "claude-sonnet-4-6";

/**
 * True when Anthropic calls are being routed through Vercel AI Gateway.
 * Opt-in via AI_GATEWAY_API_KEY — merely running on Vercel (OIDC token
 * present) is deliberately NOT enough, since every deployment gets an OIDC
 * token and we don't want the fact of being on Vercel to silently reroute
 * production traffic.
 */
export function isUsingAiGateway(): boolean {
  return Boolean(process.env.AI_GATEWAY_API_KEY);
}

/**
 * Model ID passed to `messages.create({ model })`. The Gateway expects the
 * `<provider>/<model>` shape; direct Anthropic expects the raw ID.
 */
export const CLAUDE_MODEL = isUsingAiGateway()
  ? `anthropic/${CLAUDE_MODEL_BASE}`
  : CLAUDE_MODEL_BASE;

/**
 * Returns a configured Anthropic client, or null when no credentials are
 * available. Prefers Gateway when AI_GATEWAY_API_KEY is set, falls back to
 * direct Anthropic via ANTHROPIC_API_KEY. Callers that legitimately precede
 * AI setup (e.g. build-time route collection) get null; callers that need to
 * actually invoke Claude should call `requireClaudeClient()` instead.
 */
export function getClaudeClient(): Anthropic | null {
  const gatewayKey = process.env.AI_GATEWAY_API_KEY;
  const directKey = process.env.ANTHROPIC_API_KEY;
  const apiKey = gatewayKey ?? directKey;
  if (!apiKey) return null;
  if (!globalForClaude.anthropic) {
    globalForClaude.anthropic = new Anthropic({
      apiKey,
      ...(gatewayKey ? { baseURL: GATEWAY_BASE_URL } : {}),
    });
  }
  return globalForClaude.anthropic;
}

export function requireClaudeClient(): Anthropic {
  const client = getClaudeClient();
  if (!client) {
    throw new Error(
      "No AI credentials configured — set AI_GATEWAY_API_KEY (preferred) or ANTHROPIC_API_KEY",
    );
  }
  return client;
}

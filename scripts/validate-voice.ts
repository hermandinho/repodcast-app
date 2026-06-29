/**
 * Voice quality validation harness.
 *
 * Reads a transcript + voice profile, runs all (or a subset of) the 7
 * platform prompts in parallel through Claude, and writes the outputs to
 * `docs/voice-validation/{timestamp}/{platform}.md` for human review.
 *
 * Usage:
 *   npx tsx scripts/validate-voice.ts --transcript path/to/transcript.txt --client ff
 *   npx tsx scripts/validate-voice.ts --transcript path/to/x.txt --voice path/to/voice.json --platforms TWITTER,LINKEDIN
 *
 * Voice profile JSON shape (when using --voice):
 *   {
 *     "clientName": "…", "hostName": "…",
 *     "voiceDescription": "…",
 *     "globalInstructions": "…",
 *     "perPlatformInstructions": { "TWITTER": "…", … },
 *     "samples": [{ "platform": "TWITTER", "content": "…" }, …]
 *   }
 *
 * --client {ff|te|mt} loads the voice profile straight from
 * `lib/sample-data/voice-profiles.ts` — fastest path to a smoke test against
 * a benchmark voice without writing JSON by hand.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { Platform } from "@prisma/client";
import { ALL_PLATFORMS, platformConfig } from "../server/ai/platforms";
import { buildMessages, extractText, type VoiceContext } from "../server/ai/prompt-builder";
import { CLAUDE_MODEL, requireClaudeClient } from "../server/ai/claude";
import { voiceProfiles } from "../lib/sample-data/voice-profiles";
import type { PlatformKey } from "../lib/sample-data/platforms";
import { loadEnvLocal } from "./load-env-local";

// Match the dev experience — pull ANTHROPIC_API_KEY from .env.local.
loadEnvLocal();

// ============================================================
// Argv parsing
// ============================================================

type Args = {
  transcript: string;
  voice?: string;
  client?: string;
  platforms?: Platform[];
};

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const out: Partial<Args> = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    switch (k) {
      case "--transcript":
        out.transcript = v;
        i++;
        break;
      case "--voice":
        out.voice = v;
        i++;
        break;
      case "--client":
        out.client = v;
        i++;
        break;
      case "--platforms":
        out.platforms = v.split(",").map((p) => p.trim() as Platform);
        i++;
        break;
    }
  }
  if (!out.transcript) {
    console.error("Missing --transcript. See header of scripts/validate-voice.ts.");
    process.exit(1);
  }
  if (!out.voice && !out.client) {
    console.error("Pass --voice path/to/voice.json or --client {ff|te|mt}.");
    process.exit(1);
  }
  return out as Args;
}

// ============================================================
// Voice context resolution
// ============================================================

const PLATFORM_BY_SHORT_KEY: Record<PlatformKey, Platform> = {
  x: Platform.TWITTER,
  li: Platform.LINKEDIN,
  ig: Platform.INSTAGRAM,
  tt: Platform.TIKTOK,
  notes: Platform.SHOW_NOTES,
  blog: Platform.BLOG,
  news: Platform.NEWSLETTER,
};

async function loadVoiceFromJson(filePath: string): Promise<VoiceContext> {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as VoiceContext;
}

function loadVoiceFromSampleClient(key: string): VoiceContext {
  const profile = voiceProfiles[key];
  if (!profile) {
    throw new Error(`No sample voice profile for client "${key}". Try ff, te, or mt.`);
  }
  // Map the short platform keys ("x", "li" …) → Prisma Platform enum.
  const perPlatformInstructions: Partial<Record<Platform, string>> = {};
  for (const [shortKey, rule] of Object.entries(profile.instructions.perPlatform)) {
    const platform = PLATFORM_BY_SHORT_KEY[shortKey as PlatformKey];
    if (platform) perPlatformInstructions[platform] = rule;
  }
  return {
    clientName:
      profile.clientKey === "ff"
        ? "The Founder's Frequency"
        : profile.clientKey === "te"
          ? "Trail & Error"
          : "Money on the Table",
    hostName:
      profile.clientKey === "ff"
        ? "Maya Chen"
        : profile.clientKey === "te"
          ? "Sam Rivera"
          : "Priya Anand",
    voiceDescription: profile.description,
    globalInstructions: profile.instructions.global,
    perPlatformInstructions,
    samples: profile.samples.map((s) => ({
      platform: PLATFORM_BY_SHORT_KEY[s.platform],
      content: s.text,
    })),
  };
}

// ============================================================
// Main
// ============================================================

async function main(): Promise<void> {
  const args = parseArgs();
  const transcript = await readFile(args.transcript, "utf8");
  const voice = args.voice
    ? await loadVoiceFromJson(args.voice)
    : loadVoiceFromSampleClient(args.client!);
  const platforms = args.platforms ?? ALL_PLATFORMS;

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = path.join("docs", "voice-validation", stamp);
  await mkdir(outDir, { recursive: true });

  console.log(`[validate-voice] model=${CLAUDE_MODEL} client="${voice.clientName}"`);
  console.log(`[validate-voice] platforms=${platforms.join(",")}`);
  console.log(`[validate-voice] transcript=${args.transcript} (${transcript.length} chars)`);
  console.log(`[validate-voice] writing to ${outDir}`);

  const client = requireClaudeClient();

  const results = await Promise.all(
    platforms.map(async (platform) => {
      const built = buildMessages({ platform, voice, transcript, model: CLAUDE_MODEL });
      const start = Date.now();
      try {
        const response = await client.messages.create({
          model: built.model,
          max_tokens: built.maxTokens,
          system: built.system,
          messages: built.messages,
        });
        const text = extractText(response);
        const elapsedMs = Date.now() - start;
        return {
          platform,
          ok: true as const,
          text,
          elapsedMs,
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
          cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
        };
      } catch (err) {
        const elapsedMs = Date.now() - start;
        return { platform, ok: false as const, error: String(err), elapsedMs };
      }
    }),
  );

  // Write each output as a markdown file + a single summary.md
  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheRead = 0;
  const summaryLines: string[] = [
    `# Voice validation — ${voice.clientName}`,
    "",
    `- Model: \`${CLAUDE_MODEL}\``,
    `- Transcript: \`${args.transcript}\` (${transcript.length} chars)`,
    `- Generated: ${stamp}`,
    "",
    "| Platform | Status | ms | input | output | cache-read |",
    "| --- | --- | ---: | ---: | ---: | ---: |",
  ];

  for (const r of results) {
    const cfg = platformConfig(r.platform);
    const fileName = `${r.platform.toLowerCase()}.md`;
    const filePath = path.join(outDir, fileName);
    if (r.ok) {
      await writeFile(
        filePath,
        `# ${cfg.fullName}\n\n${r.text}\n\n---\n_Generated in ${r.elapsedMs}ms · ${r.inputTokens}/${r.outputTokens} tokens · cache read ${r.cacheReadTokens}_\n`,
        "utf8",
      );
      totalInput += r.inputTokens;
      totalOutput += r.outputTokens;
      totalCacheRead += r.cacheReadTokens;
      summaryLines.push(
        `| ${r.platform} | ok | ${r.elapsedMs} | ${r.inputTokens} | ${r.outputTokens} | ${r.cacheReadTokens} |`,
      );
    } else {
      await writeFile(filePath, `# ${cfg.fullName} — FAILED\n\n${r.error}\n`, "utf8");
      summaryLines.push(`| ${r.platform} | **FAIL** | ${r.elapsedMs} | — | — | — |`);
    }
  }
  summaryLines.push("");
  summaryLines.push(
    `**Totals:** input ${totalInput} · output ${totalOutput} · cache-read ${totalCacheRead}`,
  );
  await writeFile(path.join(outDir, "summary.md"), summaryLines.join("\n"), "utf8");

  console.log(`[validate-voice] done — see ${outDir}/summary.md`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

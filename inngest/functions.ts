import { inngest } from "./client";
import { checkOnboardingNudges } from "./functions/check-onboarding-nudges";
import { checkRenewals } from "./functions/check-renewals";
import { cleanupOrphanAudio } from "./functions/cleanup-orphan-audio";
import { generateEpisode } from "./functions/generate-episode";
import { importRssEpisode } from "./functions/import-rss-episode";
import { backfillUsageRollup, nightlyUsageRollup } from "./functions/nightly-usage-rollup";
import { refreshVoiceDescription } from "./functions/refresh-voice-description";
import { regenerateOutput } from "./functions/regenerate-output";
import { transcribeEpisode } from "./functions/transcribe-episode";

/**
 * Smoke-test function. Kept as a heartbeat for the Inngest dev UI; we'll
 * remove once the dashboard's "/api/inngest is alive" check uses a real
 * production function.
 */
export const helloFn = inngest.createFunction(
  { id: "hello-world", triggers: [{ event: "test/hello" }] },
  async ({ event, step }) => {
    await step.run("log", () => {
      console.log("[inngest] test/hello received", event.data);
      return { ok: true };
    });
    return { received: event.data };
  },
);

/** Functions registered with the /api/inngest route handler. */
export const functions = [
  helloFn,
  generateEpisode,
  regenerateOutput,
  refreshVoiceDescription,
  transcribeEpisode,
  importRssEpisode,
  checkRenewals,
  checkOnboardingNudges,
  cleanupOrphanAudio,
  nightlyUsageRollup,
  backfillUsageRollup,
];

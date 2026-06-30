import type { Platform } from "@prisma/client";

/**
 * Typed event registry — fed into the Inngest client via EventSchemas so
 * `event.data` is typed at both the dispatcher and the function side.
 *
 * Add new events here; the function definitions become type-checked
 * automatically.
 */
export type Events = {
  "episode/generate.requested": {
    data: {
      episodeId: string;
      platforms: Platform[];
    };
  };

  /**
   * Phase 2.7 — audio uploads land here first. The transcribe pipeline
   * fetches the R2 object via a signed URL, sends it to Deepgram, writes
   * the resulting transcript onto the Episode, and then fires
   * `episode/generate.requested` so the existing pipeline runs unchanged.
   */
  "episode/transcribe.requested": {
    data: {
      episodeId: string;
      platforms: Platform[];
    };
  };

  /**
   * Phase 2.8 — RSS imports land here. The importer prefers a publisher-
   * supplied transcript (Podcasting 2.0 `<podcast:transcript>` tag), and
   * falls back to downloading the audio enclosure to R2 + handing off to
   * `episode/transcribe.requested` when none is available. Either path
   * ends with `episode/generate.requested` so the rest of the pipeline
   * stays unchanged.
   */
  "episode/rss.import.requested": {
    data: {
      episodeId: string;
      /** Publisher GUID — used to re-lookup the episode on retry. */
      guid: string;
      /** Show.rssUrl at dispatch time — pinned so a later edit doesn't shift the lookup. */
      feedUrl: string;
      platforms: Platform[];
    };
  };

  /** Fired by the pipeline once all platforms are persisted. SSE + email subscribe. */
  "episode/generated": {
    data: {
      episodeId: string;
      outputCount: number;
      failedPlatforms: Platform[];
    };
  };

  /** Single-output regenerate with instruction (2.2). */
  "episode/regenerate.output.requested": {
    data: {
      outputId: string;
      instruction?: string;
    };
  };

  /**
   * Refresh a show's AI voice description (Phase 2.1). Fired when the
   * approved-sample count crosses a refresh threshold (see
   * `server/ai/voice-strength.ts`).
   */
  "voice/refresh.requested": {
    data: {
      showId: string;
    };
  };

  /**
   * Phase 3.6.18 step 4 — manual backfill of the nightly usage rollup. Run
   * once with `{fromIso, toIso}` to populate snapshots for a date range
   * (inclusive lower bound, exclusive upper). Each day's rollup is
   * idempotent (upsert), so re-running the same range is safe.
   */
  "system/rollup.backfill.requested": {
    data: {
      /** Inclusive UTC midnight lower bound (ISO string). */
      fromIso: string;
      /** Exclusive UTC midnight upper bound (ISO string). */
      toIso: string;
    };
  };

  /** Smoke-test event still used by the no-op helloFn. */
  "test/hello": {
    data: Record<string, unknown>;
  };
};

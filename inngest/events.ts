import type { Plan, Platform } from "@prisma/client";

/**
 * Typed event registry — fed into the Inngest client via EventSchemas so
 * `event.data` is typed at both the dispatcher and the function side.
 *
 * Add new events here; the function definitions become type-checked
 * automatically.
 *
 * Several events carry an optional `plan` on `event.data`.
 * It's read by the Inngest `priority.run` expression on `generate-episode`
 * + `regenerate-output` (NETWORK jumps the queue). Optional so events
 * fired by older code paths — or in-flight events during deploy — still
 * enqueue at default priority instead of failing to serialize.
 */
export type Events = {
  "episode/generate.requested": {
    data: {
      episodeId: string;
      platforms: Platform[];
      /** Effective agency plan at dispatch time. Consumed by the
       *  Inngest `priority.run` expression on `generate-episode`. */
      plan?: Plan;
      /** Denormalized agencyId — used as the per-agency concurrency key
       *  on `generate-episode` so one agency's 20-episode batch can't
       *  monopolize the global slot pool. Optional to keep old
       *  dispatchers working; the concurrency key falls back to the
       *  event id (effectively unlimited) when missing. */
      agencyId?: string;
    };
  };

  /**
   * Audio uploads land here first. The transcribe pipeline
   * fetches the R2 object via a signed URL, sends it to Deepgram, writes
   * the resulting transcript onto the Episode, and then fires
   * `episode/generate.requested` so the existing pipeline runs unchanged.
   */
  "episode/transcribe.requested": {
    data: {
      episodeId: string;
      platforms: Platform[];
      plan?: Plan;
      agencyId?: string;
    };
  };

  /**
   * RSS imports land here. The importer prefers a publisher-
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
      plan?: Plan;
      agencyId?: string;
    };
  };

  /**
   * YouTube imports land here. The importer pulls the video's
   * captions (auto-generated or manually uploaded) and emits
   * `episode/generate.requested`. v1 has no audio-download fallback —
   * YouTube fights the tools that extract audio streams (ytdl-core /
   * youtubei.js), so we treat "no captions" as a terminal failure with an
   * actionable failureReason instead of a brittle scrape.
   */
  "episode/youtube.import.requested": {
    data: {
      episodeId: string;
      /** Full YouTube URL as the user provided it — parsed inside the fn. */
      videoUrl: string;
      platforms: Platform[];
      plan?: Plan;
      agencyId?: string;
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
      plan?: Plan;
      /** Denormalized agencyId — used as the concurrency-limit key on
       *  `regenerate-output` so one agency's batch retries can't starve
       *  another agency's live single-output regenerates. Optional to
       *  keep old dispatchers working. */
      agencyId?: string;
    };
  };

  /**
   * Refresh a show's AI voice description. Fired when the
   * approved-sample count crosses a refresh threshold (see
   * `server/ai/voice-strength.ts`).
   */
  "voice/refresh.requested": {
    data: {
      showId: string;
    };
  };

  /**
   * Request N vertical clips be extracted + rendered for an
   * episode. `generate-clips` loads the transcript, asks Claude for
   * highlight spans, creates VideoClip rows in PENDING, and hands each
   * to the VPS render worker which fills in renderedUrl/posterUrl.
   * Wired but non-functional initially (worker endpoint returns 501).
   */
  "episode/clips.requested": {
    data: {
      episodeId: string;
      /** Denormalised — same tenant-scoping semantics as generate-episode. */
      agencyId: string;
      /** Cap the number of clips generated. Default 5, upper bound 10. */
      maxClips?: number;
    };
  };

  /**
   * Re-render one existing VideoClip with new start/end bounds.
   * The row keeps its id + hookLine + score; only startMs/endMs update
   * and the R2 objects at the clip's outputPrefix get overwritten.
   * Fired by `retrimClipAction`.
   */
  "clip/retrim.requested": {
    data: {
      clipId: string;
      agencyId: string;
      startMs: number;
      endMs: number;
    };
  };

  /**
   * Audiogram (waveform video) for a single social output.
   * Fired when the user toggles "publish with audio" on an output; the
   * render worker composes a waveform video from source audio + SRT +
   * a blurred show-artwork background.
   */
  "output/audiogram.requested": {
    data: {
      outputId: string;
      agencyId: string;
    };
  };

  /**
   * Hero image variants (square / 16:9 / 9:16) for an episode.
   * Calls Cloudflare Workers AI (flux-1-schnell) directly — no VPS
   * involvement. Populates Episode.heroImageUrl, squareCoverUrl,
   * verticalCoverUrl.
   */
  "episode/artwork.requested": {
    data: {
      episodeId: string;
      agencyId: string;
    };
  };

  /**
   * Manual backfill of the nightly usage rollup. Run
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

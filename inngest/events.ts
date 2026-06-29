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

  /** Smoke-test event still used by the no-op helloFn. */
  "test/hello": {
    data: Record<string, unknown>;
  };
};

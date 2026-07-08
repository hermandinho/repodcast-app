/**
 * Client-safe voice-progress types. The pure aggregation lives in
 * `server/ai/voice-progress.ts` behind a `server-only` guard (via its
 * `voice-strength.ts` dependency); this module holds just the shapes
 * so `<VoiceProgressCard>` in the client bundle can consume the
 * server-computed result without dragging server modules along.
 */

export type VoiceProgressPoint = {
  /** 1-indexed order within the show. */
  episodeIndex: number;
  episodeId: string;
  title: string;
  /** 0..1. Share of this episode's shipped outputs that were post-ready. */
  postReadyRate: number;
  /** How many shipped outputs contributed. */
  sampleCount: number;
};

export type VoiceProgressResult = {
  series: VoiceProgressPoint[];
  headline: {
    postReadyRate: number | null;
    sampleCount: number;
    window: number;
  };
  milestones: {
    developing: number | null;
    strong: number | null;
  };
};

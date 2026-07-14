import { describe, expect, it } from "vitest";
import {
  AUDIO_KEY_PREFIX,
  filterAgedCandidates,
  parseAudioKey,
  partitionOrphans,
} from "@/server/storage/audio-orphan";

/**
 * Pure helpers behind the orphan-audio cleanup cron.
 *
 * These pin the bit of logic where a one-char shift would either silently
 * skip every orphan (cron does nothing) or — worse — match an unrelated
 * key shape and delete keys it shouldn't.
 */

describe("parseAudioKey", () => {
  it("parses the canonical agency/show/episode key", () => {
    const parsed = parseAudioKey("audio/agency_123/show_abc/ep_xyz.mp3");
    expect(parsed).toEqual({
      agencyId: "agency_123",
      showId: "show_abc",
      episodeId: "ep_xyz",
      ext: "mp3",
    });
  });

  it("returns null for the wrong top-level prefix", () => {
    expect(parseAudioKey("artwork/agency_123/show_abc/foo.png")).toBeNull();
    expect(parseAudioKey("video/agency_123/show_abc/foo.mp4")).toBeNull();
    // Without the trailing slash on the prefix, "audiotest/..." must not match.
    expect(AUDIO_KEY_PREFIX).toBe("audio/");
    expect(parseAudioKey("audiotest/agency_123/show_abc/foo.mp3")).toBeNull();
  });

  it("returns null when path depth is wrong", () => {
    // too shallow
    expect(parseAudioKey("audio/agency_123/show_abc.mp3")).toBeNull();
    // too deep (an extra subfolder snuck in)
    expect(parseAudioKey("audio/agency_123/show_abc/sub/ep_xyz.mp3")).toBeNull();
  });

  it("returns null on missing extension or hidden-dotfile basename", () => {
    expect(parseAudioKey("audio/agency_123/show_abc/ep_xyz")).toBeNull();
    expect(parseAudioKey("audio/agency_123/show_abc/ep_xyz.")).toBeNull();
    // Leading-dot basename: dot at index 0 → no episodeId before the dot.
    expect(parseAudioKey("audio/agency_123/show_abc/.mp3")).toBeNull();
  });

  it("keeps the longest-suffix extension when the basename has multiple dots", () => {
    const parsed = parseAudioKey("audio/agency_123/show_abc/ep.with.dots.m4a");
    expect(parsed?.episodeId).toBe("ep.with.dots");
    expect(parsed?.ext).toBe("m4a");
  });
});

describe("partitionOrphans", () => {
  const c = (key: string, episodeId: string) => ({ key, episodeId });

  it("splits candidates by whether the episodeId exists in the DB set", () => {
    const candidates = [
      c("audio/a/s/ep_kept.mp3", "ep_kept"),
      c("audio/a/s/ep_orphan.mp3", "ep_orphan"),
      c("audio/a/s/ep_kept_too.mp3", "ep_kept_too"),
    ];
    const existing = new Set(["ep_kept", "ep_kept_too"]);
    const { orphans, keepers } = partitionOrphans(candidates, existing);
    expect(orphans.map((o) => o.episodeId)).toEqual(["ep_orphan"]);
    expect(keepers.map((k) => k.episodeId)).toEqual(["ep_kept", "ep_kept_too"]);
  });

  it("returns empty buckets for empty input", () => {
    const { orphans, keepers } = partitionOrphans([], new Set(["irrelevant"]));
    expect(orphans).toEqual([]);
    expect(keepers).toEqual([]);
  });

  it("treats every candidate as orphan when the DB set is empty", () => {
    const candidates = [c("audio/a/s/ep_1.mp3", "ep_1"), c("audio/a/s/ep_2.mp3", "ep_2")];
    const { orphans, keepers } = partitionOrphans(candidates, new Set());
    expect(orphans).toHaveLength(2);
    expect(keepers).toHaveLength(0);
  });
});

describe("filterAgedCandidates", () => {
  const now = new Date("2026-07-01T03:00:00.000Z");
  const MIN_AGE_MS = 24 * 60 * 60 * 1000;
  const obj = (key: string, lastModified: Date | null, size: number | null = 1) => ({
    key,
    lastModified,
    size,
  });

  it("keeps objects older than the cutoff, drops fresher ones", () => {
    const old = new Date(now.getTime() - 25 * 60 * 60 * 1000);
    const justUnder = new Date(now.getTime() - 23 * 60 * 60 * 1000);
    const result = filterAgedCandidates(
      [obj("audio/a/s/ep_old.mp3", old), obj("audio/a/s/ep_fresh.mp3", justUnder)],
      now,
      MIN_AGE_MS,
    );
    expect(result.map((c) => c.episodeId)).toEqual(["ep_old"]);
  });

  it("treats the exact-24h boundary as eligible (>= cutoff is kept)", () => {
    const exact = new Date(now.getTime() - MIN_AGE_MS);
    const result = filterAgedCandidates([obj("audio/a/s/ep_edge.mp3", exact)], now, MIN_AGE_MS);
    expect(result.map((c) => c.episodeId)).toEqual(["ep_edge"]);
  });

  it("skips objects with no LastModified — age is unknowable, can't delete safely", () => {
    const result = filterAgedCandidates([obj("audio/a/s/ep_dateless.mp3", null)], now, MIN_AGE_MS);
    expect(result).toEqual([]);
  });

  it("skips objects whose key doesn't parse — the cron never deletes mystery keys", () => {
    const old = new Date(now.getTime() - 48 * 60 * 60 * 1000);
    const result = filterAgedCandidates(
      [obj("audio/wrong-shape.mp3", old), obj("artwork/a/s/foo.png", old)],
      now,
      MIN_AGE_MS,
    );
    expect(result).toEqual([]);
  });
});

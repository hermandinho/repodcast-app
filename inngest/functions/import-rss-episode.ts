import { EpisodeStatus, TranscriptSource } from "@prisma/client";
import { NonRetriableError } from "inngest";
import { audioExtensionFor } from "@/lib/audio";
import { prisma } from "@/server/db/client";
import { captureInngestFailure } from "@/server/observability/sentry";
import { putR2Object } from "@/server/storage/r2";
import {
  listEpisodesByFeedId,
  lookupEpisodeByGuid,
  lookupFeedByUrl,
  pickTranscriptUrl,
  PodcastIndexError,
  type PodcastIndexEpisode,
} from "@/server/imports/podcastindex";
import { fetchAndNormaliseTranscript, TranscriptFetchError } from "@/server/imports/transcripts";
import type { Events } from "../events";
import { inngest } from "../client";

function truncateReason(message: string): string {
  const trimmed = message.trim();
  if (trimmed.length === 0) return "RSS import failed";
  return trimmed.length > 500 ? `${trimmed.slice(0, 497)}...` : trimmed;
}

/**
 * Phase 2.8 — RSS import pipeline.
 *
 * Two valid endings depending on what the publisher exposes:
 *   - Transcript present → normalise + persist → `episode/generate.requested`.
 *   - Transcript absent  → download audio enclosure to R2, set
 *     `Episode.audioUrl` to the R2 key, fire `episode/transcribe.requested`
 *     so the existing Deepgram pipeline takes over.
 *
 * Either way the rest of the pipeline (generate-episode) runs unchanged.
 *
 * Failure modes:
 *   - `NonRetriableError` for missing row, wrong source, missing GUID, or
 *     a Podcast Index 4xx — input is broken, retries won't help.
 *   - 5xx / network errors fall through to Inngest's default retry policy.
 */

const AUDIO_FETCH_TIMEOUT_MS = 60_000;
/** Generous ceiling — most podcast episodes are 10–60 MB; >500 MB is a misconfigured feed. */
const MAX_AUDIO_BYTES = 500 * 1024 * 1024;
/** Lower bound on a usable transcript — shorter than this and Claude has nothing to chew on. */
const MIN_TRANSCRIPT_CHARS = 500;

export const importRssEpisode = inngest.createFunction(
  {
    id: "import-rss-episode",
    triggers: [{ event: "episode/rss.import.requested" }],
    retries: 3,
    /**
     * After Inngest exhausts retries (or a `NonRetriableError` bubbles
     * straight through), flip the Episode to FAILED with the reason on
     * `failureReason`. The episode page renders a banner from this so the
     * user sees what went wrong instead of a blank "still loading" view.
     */
    onFailure: async ({ event, error }) => {
      const { episodeId } = event.data.event.data as Events["episode/rss.import.requested"]["data"];
      captureInngestFailure("rss_import", error, { episodeId });
      try {
        await prisma.episode.update({
          where: { id: episodeId },
          data: {
            status: EpisodeStatus.FAILED,
            failureReason: truncateReason(error?.message ?? "RSS import failed"),
          },
        });
      } catch (err) {
        // Episode may have been deleted in the meantime — swallow so the
        // failure handler itself doesn't poison the queue.
        console.error("import-rss-episode onFailure persistence failed", err);
      }
    },
  },
  async ({ event, step }) => {
    const {
      episodeId,
      guid,
      feedUrl,
      platforms,
      plan,
      agencyId: agencyIdFromEvent,
    } = event.data as Events["episode/rss.import.requested"]["data"];

    // ---- 1. Load + validate ----
    const episode = await prisma.episode.findUnique({
      where: { id: episodeId },
      select: {
        id: true,
        source: true,
        transcript: true,
        audioUrl: true,
        showId: true,
        show: { select: { client: { select: { agencyId: true } } } },
      },
    });
    if (!episode) {
      throw new NonRetriableError(`Episode ${episodeId} not found`);
    }
    if (episode.source !== TranscriptSource.RSS) {
      throw new NonRetriableError(
        `Episode ${episodeId} source is ${episode.source}, not RSS — refusing to import`,
      );
    }
    const agencyId = agencyIdFromEvent ?? episode.show.client.agencyId;
    if (episode.transcript.trim().length >= MIN_TRANSCRIPT_CHARS) {
      // Idempotent re-fire — transcript already filled. Skip straight to
      // generate so the dispatcher's retry still wakes up the pipeline.
      await step.sendEvent("emit-generate", {
        name: "episode/generate.requested",
        data: { episodeId, platforms, plan, agencyId },
      });
      return { episodeId, skipped: true };
    }

    // ---- 2. Status → PROCESSING ----
    await step.run("mark-processing", () =>
      prisma.episode.update({
        where: { id: episodeId },
        data: { status: EpisodeStatus.PROCESSING },
      }),
    );

    // ---- 3. Re-lookup the episode on Podcast Index ----
    // We re-fetch on every run rather than caching on the event — the
    // publisher may add a transcript or fix an enclosure between dispatch
    // and the function actually running.
    //
    // Strategy: try the direct `/episodes/byguid` lookup first (cheap,
    // O(1)); if it returns nothing — which happens when Podcast Index's
    // byguid index is out of sync with byfeedid for this feed — fall
    // back to scanning the feed's episode list for a guid match. The
    // wizard's picker already showed the episode from that scan, so a
    // local match here is the strongest signal we have.
    let indexEpisode: PodcastIndexEpisode | null = null;
    try {
      indexEpisode = await lookupEpisodeByGuid(guid, feedUrl);
    } catch (err) {
      if (!(err instanceof PodcastIndexError) || err.status < 400 || err.status >= 500) {
        throw err;
      }
      // 4xx on byguid is recoverable via the fallback below.
    }
    if (!indexEpisode) {
      try {
        const feed = await lookupFeedByUrl(feedUrl);
        if (feed) {
          const episodes = await listEpisodesByFeedId(feed.id, 200);
          indexEpisode = episodes.find((e) => e.guid === guid) ?? null;
        }
      } catch (err) {
        if (err instanceof PodcastIndexError && err.status >= 400 && err.status < 500) {
          throw new NonRetriableError(
            `Podcast Index ${err.status}: ${err.message}. Body: ${err.body.slice(0, 200)}`,
          );
        }
        throw err;
      }
    }
    if (!indexEpisode) {
      throw new NonRetriableError(
        `Podcast Index has no episode matching guid=${guid} on feed ${feedUrl}. ` +
          `The publisher may have removed it, or the GUID changed since the wizard listed it. ` +
          `Try a different episode from the feed.`,
      );
    }

    // ---- 4a. Transcript-first path ----
    const transcriptSource = pickTranscriptUrl(indexEpisode.transcripts);
    if (transcriptSource) {
      const fetched = await step.run("fetch-transcript", async () => {
        try {
          const text = await fetchAndNormaliseTranscript(
            transcriptSource.url,
            transcriptSource.type,
          );
          return text ?? "";
        } catch (err) {
          if (err instanceof TranscriptFetchError && err.status >= 400 && err.status < 500) {
            // Stale or auth-gated transcript URL — drop to the audio path.
            return "";
          }
          throw err;
        }
      });

      if (fetched.trim().length >= MIN_TRANSCRIPT_CHARS) {
        await step.run("persist-transcript", () =>
          prisma.episode.update({
            where: { id: episodeId },
            data: {
              transcript: fetched,
              durationSec: indexEpisode.duration ?? undefined,
              recordedAt: indexEpisode.datePublished,
            },
          }),
        );

        await step.sendEvent("emit-generate", {
          name: "episode/generate.requested",
          data: { episodeId, platforms, plan, agencyId },
        });

        return {
          episodeId,
          transcriptChars: fetched.length,
          via: "publisher-transcript" as const,
        };
      }
      // Transcript too short to be useful — fall through to audio path.
    }

    // ---- 4b. Audio fallback path ----
    if (!indexEpisode.enclosureUrl) {
      throw new NonRetriableError(
        `Episode ${episodeId} has no transcript and no enclosure URL — nothing to import`,
      );
    }

    const audioKey = await step.run("download-audio-to-r2", async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), AUDIO_FETCH_TIMEOUT_MS);
      let res: Response;
      try {
        res = await fetch(indexEpisode.enclosureUrl, { signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }
      if (!res.ok) {
        // Publisher 404s here are common (URL rotated). Retries are pointless.
        if (res.status >= 400 && res.status < 500) {
          throw new NonRetriableError(
            `Audio enclosure returned ${res.status} ${res.statusText} for ${indexEpisode.enclosureUrl}`,
          );
        }
        throw new Error(`Audio enclosure returned ${res.status} ${res.statusText}`);
      }
      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.byteLength > MAX_AUDIO_BYTES) {
        throw new NonRetriableError(
          `Audio enclosure is ${buffer.byteLength} bytes — exceeds the ${MAX_AUDIO_BYTES} byte ceiling`,
        );
      }

      const contentType =
        indexEpisode.enclosureType ?? res.headers.get("content-type") ?? "audio/mpeg";
      const filenameHint = indexEpisode.enclosureUrl.split("?")[0]!.split("/").pop() ?? "audio.mp3";
      const ext = audioExtensionFor(contentType, filenameHint);
      const key = `audio/${agencyId}/${episode.showId}/${episodeId}.${ext}`;
      await putR2Object(key, buffer, contentType);
      return key;
    });

    await step.run("persist-audio-key", () =>
      prisma.episode.update({
        where: { id: episodeId },
        data: {
          audioUrl: audioKey,
          durationSec: indexEpisode.duration ?? undefined,
          recordedAt: indexEpisode.datePublished,
        },
      }),
    );

    // Hand off to the existing audio pipeline — transcribe-episode
    // accepts RSS as a valid source so the episode's origin is preserved
    // for reporting (Episodes-by-source chart, etc).
    await step.sendEvent("emit-transcribe", {
      name: "episode/transcribe.requested",
      data: { episodeId, platforms, plan, agencyId },
    });

    return {
      episodeId,
      audioKey,
      via: "audio-fallback" as const,
    };
  },
);

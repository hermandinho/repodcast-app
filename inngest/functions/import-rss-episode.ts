import { EpisodePipelineStage, EpisodeStatus, TranscriptSource } from "@prisma/client";
import { NonRetriableError } from "inngest";
import { audioExtensionFor } from "@/lib/audio";
import { prisma } from "@/server/db/client";
import { captureInngestFailure } from "@/server/observability/sentry";
import { streamR2Object } from "@/server/storage/r2";
import {
  lookupEpisodeByGuid,
  pickTranscriptUrl,
  PodcastIndexError,
  type PodcastIndexEpisode,
} from "@/server/imports/podcastindex";
import { resolveFeed, RssFeedError } from "@/server/imports/rss-feed";
import { fetchAndNormaliseTranscript, TranscriptFetchError } from "@/server/imports/transcripts";
import type { Events } from "../events";
import { inngest } from "../client";

function truncateReason(message: string): string {
  const trimmed = message.trim();
  if (trimmed.length === 0) return "RSS import failed";
  return trimmed.length > 500 ? `${trimmed.slice(0, 497)}...` : trimmed;
}

/**
 * RSS import pipeline.
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

/**
 * Wall-clock ceiling on the whole fetch-and-stream. Not a "no progress
 * for N seconds" watchdog — a simple upper bound. 10 minutes covers a
 * 2 GB file over a ~30 Mbps link; larger than that is off-spec.
 */
const AUDIO_FETCH_TIMEOUT_MS = 10 * 60_000;

/**
 * Sanity cap. We no longer buffer the enclosure into Node's heap
 * (streaming straight to R2 multipart upload — see `streamR2Object`),
 * so the memory pressure that motivated the old 500 MB limit is gone.
 * A ceiling still catches genuinely misconfigured feeds — an
 * uncompressed 3-hour WAV lands around 1.8 GB, and a 6-hour lossless
 * recording pushes 3.6 GB; anything past 2 GB is almost certainly one
 * of those, not a legitimate podcast episode.
 */
const MAX_AUDIO_BYTES = 2 * 1024 * 1024 * 1024;
/** Lower bound on a usable transcript — shorter than this and Claude has nothing to chew on. */
const MIN_TRANSCRIPT_CHARS = 500;

/**
 * Web-stream passthrough that aborts if the cumulative byte count
 * exceeds `maxBytes`. Feeds without a `Content-Length` header can't be
 * preflighted, so we watch bytes as they flow — the moment the ceiling
 * is breached, the stream errors and lib-storage's multipart upload
 * aborts (no orphan partial object left in R2).
 */
function throwOnByteOverflow(
  source: ReadableStream<Uint8Array>,
  maxBytes: number,
  onExceed: (seenBytes: number) => Error,
): ReadableStream<Uint8Array> {
  let seen = 0;
  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      seen += chunk.byteLength;
      if (seen > maxBytes) {
        controller.error(onExceed(seen));
        return;
      }
      controller.enqueue(chunk);
    },
  });
  return source.pipeThrough(transform);
}

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
            stage: EpisodePipelineStage.FAILED,
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

    // ---- 2. Status → PROCESSING, stage → IMPORTING ----
    await step.run("mark-processing", () =>
      prisma.episode.update({
        where: { id: episodeId },
        data: {
          status: EpisodeStatus.PROCESSING,
          stage: EpisodePipelineStage.IMPORTING,
        },
      }),
    );

    // ---- 3. Re-lookup the episode ----
    // We re-fetch on every run rather than caching on the event — the
    // publisher may add a transcript or fix an enclosure between dispatch
    // and the function actually running.
    //
    // Strategy: try Podcast Index's direct `/episodes/byguid` first (cheap,
    // O(1)); if that misses — Podcast Index's byguid index is sometimes out
    // of sync with byfeedid for a given feed, and it doesn't index every
    // publisher (Substack, Patreon, self-hosted) — fall back to resolving
    // the feed and scanning for a guid match. `resolveFeed` handles the
    // PI-or-direct-RSS branch internally.
    let indexEpisode: PodcastIndexEpisode | null = null;
    try {
      indexEpisode = await lookupEpisodeByGuid(guid, feedUrl);
    } catch (err) {
      if (err instanceof PodcastIndexError && err.status >= 500) throw err;
      // 4xx / non-PI errors are recoverable via the fallback below.
    }
    if (!indexEpisode) {
      try {
        const resolved = await resolveFeed(feedUrl, 500);
        if (resolved) {
          indexEpisode = resolved.episodes.find((e) => e.guid === guid) ?? null;
        }
      } catch (err) {
        if (err instanceof RssFeedError) {
          throw new NonRetriableError(err.message);
        }
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
        `Feed ${feedUrl} has no episode matching guid=${guid}. ` +
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
      // AbortController covers the whole fetch + streaming download —
      // once the timer fires, the fetch aborts, the response body
      // errors, and (via `streamR2Object`'s signal wiring below) the
      // in-flight multipart upload calls its own `.abort()` so R2's
      // side cleans up + no `UploadPart` teardown leaks as a stray
      // socket error.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), AUDIO_FETCH_TIMEOUT_MS);
      let res: Response;
      try {
        res = await fetch(indexEpisode.enclosureUrl, { signal: controller.signal });
      } catch (err) {
        clearTimeout(timer);
        // Rewrap so the failing phase reads clearly in Sentry / logs —
        // without this the caller sees a bare `ECONNABORTED` / `fetch
        // failed` with no idea whether it was the download or the
        // upload that broke.
        throw new Error(
          `RSS audio fetch failed for ${indexEpisode.enclosureUrl}: ${err instanceof Error ? err.message : String(err)}`,
          { cause: err },
        );
      }
      try {
        if (!res.ok) {
          // Publisher 404s here are common (URL rotated). Retries are pointless.
          if (res.status >= 400 && res.status < 500) {
            throw new NonRetriableError(
              `Audio enclosure returned ${res.status} ${res.statusText} for ${indexEpisode.enclosureUrl}`,
            );
          }
          throw new Error(`Audio enclosure returned ${res.status} ${res.statusText}`);
        }

        // Preflight when the server declared a Content-Length. Rejects
        // before a single byte streams through — cheaper than watching
        // the ceiling breach mid-download, and produces a cleaner error
        // message that names the declared size.
        const declaredLen = Number(res.headers.get("content-length") ?? "");
        if (Number.isFinite(declaredLen) && declaredLen > MAX_AUDIO_BYTES) {
          throw new NonRetriableError(
            `Audio enclosure declares ${declaredLen} bytes — exceeds the ${MAX_AUDIO_BYTES} byte ceiling`,
          );
        }
        if (!res.body) {
          throw new Error(`Audio enclosure at ${indexEpisode.enclosureUrl} returned no body`);
        }

        const contentType =
          indexEpisode.enclosureType ?? res.headers.get("content-type") ?? "audio/mpeg";
        const filenameHint =
          indexEpisode.enclosureUrl.split("?")[0]!.split("/").pop() ?? "audio.mp3";
        const ext = audioExtensionFor(contentType, filenameHint);
        const key = `audio/${agencyId}/${episode.showId}/${episodeId}.${ext}`;

        // For feeds without Content-Length, watch the running byte total
        // and abort past the ceiling; feeds with Content-Length already
        // cleared the preflight above but keeping the counter costs
        // nothing and defends against a lying header.
        const limited = throwOnByteOverflow(
          res.body,
          MAX_AUDIO_BYTES,
          (seen) =>
            new NonRetriableError(
              `Audio enclosure exceeded the ${MAX_AUDIO_BYTES} byte ceiling (saw ${seen} bytes so far)`,
            ),
        );

        // Threading `controller.signal` in gives lib-storage a chance
        // to call `Upload.abort()` itself when the timeout fires,
        // rather than only reacting to the source stream erroring.
        // That's what stops the `ECONNABORTED` writes from leaking to
        // Node's async void on timeout / overflow paths.
        try {
          await streamR2Object(key, limited, contentType, controller.signal);
        } catch (err) {
          throw new Error(
            `RSS audio R2 upload failed for ${key} (${declaredLen || "unknown"} bytes declared): ${err instanceof Error ? err.message : String(err)}`,
            { cause: err },
          );
        }
        return key;
      } finally {
        clearTimeout(timer);
      }
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

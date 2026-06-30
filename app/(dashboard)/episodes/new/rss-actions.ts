"use server";

import { z } from "zod";
import { MemberRole } from "@prisma/client";
import { assertRole, requireAuthContext } from "@/server/auth/context";
import { NotFoundError, ValidationError } from "@/server/auth/errors";
import { prisma } from "@/server/db/client";
import {
  isPodcastIndexConfigured,
  listEpisodesByFeedId,
  lookupFeedByUrl,
  PodcastIndexError,
  type PodcastIndexEpisode,
} from "@/server/imports/podcastindex";

/**
 * Phase 2.8 — wizard-side RSS helpers. The "Import from RSS" step calls
 * `connectRssFeedAction` to validate a user-typed URL against Podcast
 * Index (and persist it onto `Show.rssUrl` for next time), then calls
 * `listFeedEpisodesAction` to render the picker.
 *
 * Both actions are EDITOR+ — same gate as createEpisode. REVIEWERs can't
 * kick off imports.
 *
 * Note: the URL stored on `Show.rssUrl` is the **publisher-canonical** URL
 * Podcast Index resolved it to (via `feed.url`), not the user's raw input.
 * That stabilises the lookup on subsequent runs even when the user typed a
 * pre-redirect URL.
 */

const showInput = z.object({ showId: z.string().min(1) });

const connectInput = z.object({
  showId: z.string().min(1),
  rssUrl: z.string().url(),
});

const MAX_EPISODES_FOR_PICKER = 25;

const WRITE_ROLES = [MemberRole.OWNER, MemberRole.ADMIN, MemberRole.EDITOR] as const;

export type FeedEpisodeForPicker = {
  guid: string;
  title: string;
  /** ISO string — server actions can't return Dates over the wire untyped. */
  datePublishedIso: string;
  durationSec: number | null;
  enclosureUrl: string;
  enclosureType: string | null;
  hasTranscript: boolean;
};

export type ConnectFeedResult =
  | {
      ok: true;
      data: {
        /** The canonical URL Podcast Index resolved + we persisted. */
        feedUrl: string;
        feedTitle: string;
        episodes: FeedEpisodeForPicker[];
      };
    }
  | { ok: false; error: string };

export type ListFeedEpisodesResult =
  | {
      ok: true;
      data: {
        feedUrl: string;
        feedTitle: string;
        episodes: FeedEpisodeForPicker[];
      };
    }
  | { ok: false; error: string };

/**
 * Resolve a user-typed RSS URL against Podcast Index, persist the
 * canonical URL onto the show, and return the recent episode list so the
 * wizard can immediately render the picker.
 */
export async function connectRssFeedAction(raw: unknown): Promise<ConnectFeedResult> {
  const parsed = connectInput.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError("Invalid RSS connect input", parsed.error.issues);
  }
  if (!isPodcastIndexConfigured()) {
    return {
      ok: false,
      error: "RSS imports aren't configured yet — set PODCAST_INDEX_KEY and PODCAST_INDEX_SECRET.",
    };
  }

  const auth = await requireAuthContext();
  assertRole(auth, WRITE_ROLES);

  // Tenant gate before any external call — refuse to talk to Podcast Index
  // about a show that isn't ours.
  const show = await prisma.show.findFirst({
    where: { id: parsed.data.showId, client: { agencyId: auth.agency.id } },
    select: { id: true, rssUrl: true },
  });
  if (!show) throw new NotFoundError(`Show ${parsed.data.showId} not found`);

  let feed;
  try {
    feed = await lookupFeedByUrl(parsed.data.rssUrl);
  } catch (err) {
    if (err instanceof PodcastIndexError) {
      return { ok: false, error: `Podcast Index lookup failed: ${err.message}` };
    }
    throw err;
  }
  if (!feed) {
    return {
      ok: false,
      error:
        "Podcast Index doesn't recognise that feed yet — double-check the URL or wait for its next crawl.",
    };
  }

  const canonicalUrl = feed.url || parsed.data.rssUrl;
  if (show.rssUrl !== canonicalUrl) {
    await prisma.show.update({
      where: { id: show.id },
      data: { rssUrl: canonicalUrl },
    });
  }

  const episodes = await listEpisodesByFeedId(feed.id, MAX_EPISODES_FOR_PICKER);
  return {
    ok: true,
    data: {
      feedUrl: canonicalUrl,
      feedTitle: feed.title,
      episodes: episodes.map(toPickerRow),
    },
  };
}

/**
 * Re-fetch the episode list for a show whose feed was previously connected.
 * Idempotent — does not write to the show row. Used by the wizard when the
 * user picks a different show that already has an `rssUrl` set.
 */
export async function listFeedEpisodesAction(raw: unknown): Promise<ListFeedEpisodesResult> {
  const parsed = showInput.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError("Invalid show id", parsed.error.issues);
  }
  if (!isPodcastIndexConfigured()) {
    return {
      ok: false,
      error: "RSS imports aren't configured yet — set PODCAST_INDEX_KEY and PODCAST_INDEX_SECRET.",
    };
  }

  const auth = await requireAuthContext();
  assertRole(auth, WRITE_ROLES);

  const show = await prisma.show.findFirst({
    where: { id: parsed.data.showId, client: { agencyId: auth.agency.id } },
    select: { id: true, rssUrl: true },
  });
  if (!show) throw new NotFoundError(`Show ${parsed.data.showId} not found`);
  if (!show.rssUrl) {
    return { ok: false, error: "This show has no RSS feed connected yet." };
  }

  let feed;
  try {
    feed = await lookupFeedByUrl(show.rssUrl);
  } catch (err) {
    if (err instanceof PodcastIndexError) {
      return { ok: false, error: `Podcast Index lookup failed: ${err.message}` };
    }
    throw err;
  }
  if (!feed) {
    return {
      ok: false,
      error: "Podcast Index can no longer find this feed — the publisher may have moved it.",
    };
  }

  const episodes = await listEpisodesByFeedId(feed.id, MAX_EPISODES_FOR_PICKER);
  return {
    ok: true,
    data: {
      feedUrl: show.rssUrl,
      feedTitle: feed.title,
      episodes: episodes.map(toPickerRow),
    },
  };
}

function toPickerRow(ep: PodcastIndexEpisode): FeedEpisodeForPicker {
  return {
    guid: ep.guid,
    title: ep.title,
    datePublishedIso: ep.datePublished.toISOString(),
    durationSec: ep.duration ?? null,
    enclosureUrl: ep.enclosureUrl,
    enclosureType: ep.enclosureType ?? null,
    hasTranscript: ep.transcripts.length > 0,
  };
}

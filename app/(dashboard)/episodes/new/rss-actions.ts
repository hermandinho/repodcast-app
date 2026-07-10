"use server";

import { z } from "zod";
import { MemberRole } from "@prisma/client";
import { assertRole, requireAuthContext } from "@/server/auth/context";
import { NotFoundError, ValidationError } from "@/server/auth/errors";
import { prisma } from "@/server/db/client";
import { PodcastIndexError, type PodcastIndexEpisode } from "@/server/imports/podcastindex";
import { resolveFeed, RssFeedError } from "@/server/imports/rss-feed";

/**
 * Phase 2.8 — wizard-side RSS helpers. The "Import from RSS" step calls
 * `connectRssFeedAction` to validate a user-typed URL (Podcast Index first,
 * direct RSS parse as fallback) and persist it onto `Show.rssUrl` for next
 * time, then calls `listFeedEpisodesAction` to render the picker.
 *
 * Both actions are EDITOR+ — same gate as createEpisode. REVIEWERs can't
 * kick off imports.
 *
 * Note: the URL stored on `Show.rssUrl` is the **canonical** URL — Podcast
 * Index's normalized `feed.url` when available, otherwise the RSS document's
 * `<atom:link rel="self">`, falling back to the user's raw input. That
 * stabilises the lookup on subsequent runs even when the user typed a
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
        /** The canonical URL we resolved + persisted. */
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
 * Resolve a user-typed RSS URL (Podcast Index → direct parse), persist the
 * canonical URL onto the show, and return the recent episode list so the
 * wizard can immediately render the picker.
 */
export async function connectRssFeedAction(raw: unknown): Promise<ConnectFeedResult> {
  const parsed = connectInput.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError("Invalid RSS connect input", parsed.error.issues);
  }

  const auth = await requireAuthContext();
  assertRole(auth, WRITE_ROLES);

  // Tenant gate before any external call — refuse to talk to Podcast Index
  // (or fetch a feed URL) about a show that isn't ours.
  const show = await prisma.show.findFirst({
    where: { id: parsed.data.showId, client: { agencyId: auth.agency.id } },
    select: { id: true, rssUrl: true },
  });
  if (!show) throw new NotFoundError(`Show ${parsed.data.showId} not found`);

  let resolved;
  try {
    resolved = await resolveFeed(parsed.data.rssUrl, MAX_EPISODES_FOR_PICKER);
  } catch (err) {
    return { ok: false, error: describeFeedError(err) };
  }
  if (!resolved) {
    return {
      ok: false,
      error: "That feed URL didn't resolve — double-check it and try again.",
    };
  }

  const canonicalUrl = resolved.feed.url || parsed.data.rssUrl;
  if (show.rssUrl !== canonicalUrl) {
    await prisma.show.update({
      where: { id: show.id },
      data: { rssUrl: canonicalUrl },
    });
  }

  return {
    ok: true,
    data: {
      feedUrl: canonicalUrl,
      feedTitle: resolved.feed.title,
      episodes: resolved.episodes.map(toPickerRow),
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

  let resolved;
  try {
    resolved = await resolveFeed(show.rssUrl, MAX_EPISODES_FOR_PICKER);
  } catch (err) {
    return { ok: false, error: describeFeedError(err) };
  }
  if (!resolved) {
    return {
      ok: false,
      error: "This feed is no longer reachable — the publisher may have moved it.",
    };
  }

  return {
    ok: true,
    data: {
      feedUrl: show.rssUrl,
      feedTitle: resolved.feed.title,
      episodes: resolved.episodes.map(toPickerRow),
    },
  };
}

function describeFeedError(err: unknown): string {
  if (err instanceof PodcastIndexError) return `Podcast Index lookup failed: ${err.message}`;
  if (err instanceof RssFeedError) return err.message;
  return err instanceof Error ? err.message : "Couldn't reach the RSS feed.";
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

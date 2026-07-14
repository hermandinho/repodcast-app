"use client";

import { useEffect, useState, useTransition } from "react";
import {
  connectRssFeedAction,
  listFeedEpisodesAction,
  type FeedEpisodeForPicker,
} from "@/app/(dashboard)/episodes/new/rss-actions";

/**
 * Wizard step-2 panel for the "Import from RSS" method.
 *
 * Two modes:
 *  - Show has no `rssUrl` saved → URL input + "Connect feed" button →
 *    server resolves the URL via Podcast Index, persists the canonical
 *    URL onto the show, and surfaces the picker.
 *  - Show already has a connected feed → episode picker renders straight
 *    away (auto-loaded on mount); "Change feed" pill lets the user
 *    reconnect a different URL.
 *
 * The parent wizard owns the selected `(guid, feedUrl, title)` triple
 * and threads it into `createEpisodeAction`. We surface a "no transcript
 * — will transcribe" hint per row so the user knows when they're about to
 * pay for Deepgram.
 */

export type RssSelection = {
  guid: string;
  feedUrl: string;
  /** Publisher title — pre-fills the wizard's episode-title input. */
  title: string;
};

export function RssFeedPicker({
  showId,
  /** Persisted `Show.rssUrl` — null when the show has no feed connected. */
  initialFeedUrl,
  selected,
  onSelect,
}: {
  showId: string;
  initialFeedUrl: string | null;
  selected: RssSelection | null;
  onSelect: (next: RssSelection | null) => void;
}) {
  const [urlInput, setUrlInput] = useState(initialFeedUrl ?? "");
  const [feedUrl, setFeedUrl] = useState(initialFeedUrl);
  const [feedTitle, setFeedTitle] = useState<string | null>(null);
  const [episodes, setEpisodes] = useState<FeedEpisodeForPicker[] | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  /** Tracks reconnect mode (user clicked "Change feed" on a connected show). */
  const [reconnecting, setReconnecting] = useState(false);

  // Auto-load the episode list on mount when this show already has a feed
  // connected. Switching shows is handled by the parent via `key={showId}` —
  // a fresh `showId` remounts the picker, which gives every state hook its
  // initial value derived from the new `initialFeedUrl` prop. That avoids
  // the prop-sync useEffect pattern (React 19 / Next 16's
  // `react-hooks/set-state-in-effect` rule flags those for cascading
  // renders) without losing the auto-load behaviour.
  useEffect(() => {
    if (!initialFeedUrl) return;
    startTransition(async () => {
      try {
        const result = await listFeedEpisodesAction({ showId });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setFeedTitle(result.data.feedTitle);
        setEpisodes(result.data.episodes);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load feed");
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onConnect = () => {
    const trimmed = urlInput.trim();
    if (trimmed.length === 0) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await connectRssFeedAction({ showId, rssUrl: trimmed });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setFeedUrl(result.data.feedUrl);
        setFeedTitle(result.data.feedTitle);
        setEpisodes(result.data.episodes);
        setReconnecting(false);
        // Clear any prior selection — old GUID likely doesn't exist on the
        // new feed and would 404 the import.
        if (selected) onSelect(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to connect feed");
      }
    });
  };

  const showConnectForm = !feedUrl || reconnecting;

  return (
    <div className="flex flex-col gap-3">
      {showConnectForm && (
        <>
          <label className="text-ink block font-sans text-[13px] font-semibold">RSS feed URL</label>
          <div className="flex gap-2">
            <input
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="https://feeds.example.com/your-show.xml"
              className="flex-1 rounded-[10px] px-[14px] py-[10px] font-sans text-[13.5px] text-[#2A3550] outline-none"
              style={{ border: "1px solid #C9D4E8", background: "#FBFCFE" }}
            />
            <button
              type="button"
              onClick={onConnect}
              disabled={pending || urlInput.trim().length === 0}
              className="bg-accent rounded-[10px] px-4 py-[10px] font-sans text-[13px] font-semibold text-white transition-[filter] hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pending ? "Connecting…" : "Connect feed"}
            </button>
          </div>
          <p className="text-muted-2 text-[12px]">
            We&apos;ll resolve the feed against Podcast Index, save the canonical URL on this show,
            and list its recent episodes below.
          </p>
        </>
      )}

      {!showConnectForm && feedUrl && (
        <div className="text-muted-2 flex items-center justify-between text-[12px]">
          <span>
            Connected to <span className="text-ink font-semibold">{feedTitle ?? feedUrl}</span>
          </span>
          <button
            type="button"
            onClick={() => setReconnecting(true)}
            className="text-accent hover:underline"
          >
            Change feed
          </button>
        </div>
      )}

      {error && (
        <div className="rounded-[10px] border border-[#F0CFC2] bg-[#FBEDEC] px-3 py-2 text-[12px] text-[#A03425]">
          {error}
        </div>
      )}

      {pending && episodes === null && (
        <div className="text-muted-2 text-[12px]">Loading episodes…</div>
      )}

      {episodes && episodes.length > 0 && (
        <div className="flex max-h-[260px] flex-col gap-1 overflow-y-auto rounded-[10px] border border-[#E6EBF3] bg-[#FBFCFE] p-1">
          {episodes.map((ep) => {
            const isSelected = selected?.guid === ep.guid;
            return (
              <button
                key={ep.guid}
                type="button"
                onClick={() => onSelect({ guid: ep.guid, feedUrl: feedUrl!, title: ep.title })}
                className="flex items-start justify-between gap-3 rounded-[8px] px-3 py-2 text-left transition-colors"
                style={{
                  background: isSelected ? "var(--color-accent-soft)" : "transparent",
                  border: `1px solid ${isSelected ? "var(--color-accent)" : "transparent"}`,
                }}
              >
                <span className="min-w-0 flex-1">
                  <span className="text-ink block truncate font-sans text-[13px] font-semibold">
                    {ep.title}
                  </span>
                  <span className="text-muted-2 mt-[2px] block font-sans text-[11.5px]">
                    {formatPublishedDate(ep.datePublishedIso)}
                    {ep.durationSec ? ` · ${formatDuration(ep.durationSec)}` : ""}
                    {ep.hasTranscript ? " · transcript available" : " · will transcribe"}
                  </span>
                </span>
                {isSelected && (
                  <span className="text-accent shrink-0 font-sans text-[11.5px] font-semibold">
                    Selected
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {episodes && episodes.length === 0 && (
        <div className="text-muted-2 rounded-[10px] border border-dashed border-[#D8DEEA] bg-[#FBFCFE] px-3 py-4 text-center text-[12px]">
          The feed connected, but Podcast Index has no episodes for it yet.
        </div>
      )}
    </div>
  );
}

function formatPublishedDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const mins = Math.round(sec / 60);
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem === 0 ? `${hours}h` : `${hours}h ${rem}m`;
}

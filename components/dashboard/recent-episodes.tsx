import Link from "next/link";
import {
  recentEpisodes as sampleRecentEpisodes,
  type RecentEpisode,
} from "@/lib/sample-data/dashboard";
import { statusMeta } from "@/lib/sample-data/episode-status";

/**
 * Dashboard recent-episodes card (ref UI Revamp 5a).
 *
 * Each row shows a compact show avatar, the episode title, and a
 * state-driven right side: a "Review" CTA when outputs are pending, a
 * "Generate" CTA when nothing has been generated, otherwise the status
 * pill for downstream states (approved / scheduled / published /
 * generating). The whole row links into the episode — the CTA button
 * inside is decorative; its click bubbles to the same target.
 */
export function RecentEpisodes({
  episodes = sampleRecentEpisodes,
}: {
  episodes?: RecentEpisode[];
}) {
  return (
    <div className="overflow-hidden rounded-[12px] border border-[#E4E9F1] bg-white">
      <div className="flex items-center justify-between border-b border-[#EEF1F6] px-6 py-[18px]">
        <span className="text-[15px] font-bold text-[#0A1E3C]">Recent episodes</span>
        <Link
          href="/episodes"
          className="text-accent text-[12.5px] font-semibold no-underline hover:brightness-90"
        >
          View all →
        </Link>
      </div>

      {episodes.length === 0 ? (
        <div className="px-6 py-10 text-center text-[12.5px] text-[#8A97AD]">
          No episodes yet — create one from the New episode button.
        </div>
      ) : (
        <div className="flex flex-col">
          {episodes.map((e, i) => {
            const isFirst = i === 0;
            const isLast = i === episodes.length - 1;
            const pending = e.pendingReviewCount > 0;
            const noOutputs = e.outputCount === 0;
            const meta = statusMeta(e.status);
            return (
              <Link
                key={`${e.key}-${i}`}
                href={`/episodes/${encodeURIComponent(e.key)}`}
                className={`flex items-center gap-[14px] px-6 py-[14px] no-underline transition-colors ${
                  !isLast ? "border-b border-[#F4F6FA]" : ""
                } ${isFirst ? "bg-[#FBFCFE]" : "hover:bg-[#FBFCFE]"}`}
              >
                <span
                  className="font-display flex h-9 w-9 flex-none items-center justify-center rounded-[9px] text-[11px] font-extrabold text-white"
                  style={{ background: e.avatarBg }}
                >
                  {e.initial}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-bold text-[#0A1E3C]">{e.title}</div>
                  <div className="mt-[2px] truncate text-[11.5px] text-[#8A97AD]">{e.client}</div>
                </div>

                {pending ? (
                  <span className="flex-none rounded-full bg-[#F9F1DE] px-[10px] py-1 text-[11px] font-semibold text-[#B07818]">
                    {e.pendingReviewCount} to review
                  </span>
                ) : noOutputs ? (
                  <span className="flex-none rounded-full bg-[#F1F4F9] px-[10px] py-1 text-[11px] font-semibold text-[#41506B]">
                    No outputs
                  </span>
                ) : (
                  <span
                    className="flex-none rounded-full px-[10px] py-1 text-[11px] font-semibold"
                    style={{ background: meta.bg, color: meta.color }}
                  >
                    {meta.label}
                  </span>
                )}

                {pending ? (
                  <span className="bg-accent flex-none rounded-[7px] px-[13px] py-[7px] text-[12px] font-semibold text-white">
                    Review
                  </span>
                ) : noOutputs ? (
                  <span className="flex-none rounded-[7px] border border-[#E4E9F1] px-[13px] py-[6px] text-[12px] font-semibold text-[#41506B]">
                    Generate
                  </span>
                ) : (
                  <span className="flex-none rounded-[7px] border border-[#E4E9F1] px-[13px] py-[6px] text-[12px] font-semibold text-[#41506B]">
                    Open
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

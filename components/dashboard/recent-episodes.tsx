import Link from "next/link";
import { StatusPill } from "@/components/ui/status-pill";
import {
  recentEpisodes as sampleRecentEpisodes,
  type RecentEpisode,
} from "@/lib/sample-data/dashboard";

export function RecentEpisodes({
  episodes = sampleRecentEpisodes,
}: {
  episodes?: RecentEpisode[];
}) {
  return (
    <div className="border-border bg-surface rounded-2xl border px-5 pt-5 pb-2">
      <div className="mb-[14px] flex items-center justify-between">
        <div className="font-display text-ink text-[15px] font-semibold">Recent episodes</div>
        <Link href="/clients" className="text-accent font-sans text-[12.5px] font-medium">
          View all
        </Link>
      </div>
      <div>
        {episodes.length === 0 ? (
          <div className="text-muted-2 py-6 text-center text-[12.5px]">
            No episodes yet — create one from the New episode button.
          </div>
        ) : (
          episodes.map((e, i) => (
            <Link
              key={i}
              href={`/episodes/${encodeURIComponent(e.key)}`}
              className="flex items-center gap-3 border-t border-[#F0F3F8] px-[6px] py-[11px] transition-colors hover:bg-[#FAFBFD]"
            >
              <span
                className="font-display flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center rounded-md text-[11px] font-bold text-white"
                style={{ background: e.avatarBg }}
              >
                {e.initial}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-ink truncate text-[13px] font-medium">{e.title}</div>
                <div className="text-muted-2 truncate text-[11.5px]">{e.client}</div>
              </div>
              <span className="text-muted-2 text-[11.5px] whitespace-nowrap">{e.outputs}</span>
              <StatusPill status={e.status} />
            </Link>
          ))
        )}
      </div>
    </div>
  );
}

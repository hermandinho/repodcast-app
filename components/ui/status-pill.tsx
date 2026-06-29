import { statusMeta, type EpisodeStatus } from "@/lib/sample-data/episode-status";

export function StatusPill({ status }: { status: EpisodeStatus }) {
  const m = statusMeta(status);
  return (
    <span
      className="rounded-pill inline-flex flex-shrink-0 items-center gap-[5px] px-[9px] py-[3px] font-sans text-[11px] font-semibold whitespace-nowrap"
      style={{ background: m.bg, color: m.color }}
    >
      <span className="block h-[6px] w-[6px] rounded-full" style={{ background: m.color }} />
      {m.label}
    </span>
  );
}

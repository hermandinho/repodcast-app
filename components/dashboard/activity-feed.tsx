import {
  activityItems as sampleActivityItems,
  type ActivityItem,
} from "@/lib/sample-data/dashboard";

/**
 * Dashboard activity card (ref 5a).
 *
 * Table-style rows: `HH:MM · dot · description · show`, with the time
 * and show name muted so the eye lands on the actor + verb + object
 * phrase in the middle. Dot color is threaded from the transition-to-
 * activity mapper — green for terminal events (published), soft accent
 * for in-flight scheduling events, muted for admin actions.
 */
export function ActivityFeed({ items = sampleActivityItems }: { items?: ActivityItem[] }) {
  return (
    <div className="rounded-[12px] border border-[#E4E9F1] bg-white px-6 py-5">
      <div className="flex items-baseline justify-between">
        <div className="flex items-baseline gap-[10px]">
          <span className="text-[15px] font-bold text-[#0A1E3C]">Activity</span>
          <span className="text-[12.5px] text-[#8A97AD]">Across all client shows</span>
        </div>
        <span className="font-mono text-[10.5px] tracking-[0.1em] text-[#8A97AD]">TODAY</span>
      </div>

      {items.length === 0 ? (
        <div className="mt-3 rounded-[8px] bg-[#F6F8FC] px-4 py-6 text-center text-[12.5px] text-[#8A97AD]">
          Activity will appear here as you generate and approve outputs.
        </div>
      ) : (
        <div className="mt-[10px] flex flex-col">
          {items.map((a, i) => {
            const isLast = i === items.length - 1;
            return (
              <div
                key={i}
                className={`grid items-center gap-3 py-[11px] ${
                  !isLast ? "border-b border-[#F4F6FA]" : ""
                }`}
                style={{ gridTemplateColumns: "64px 14px 1fr auto" }}
              >
                <span className="font-mono text-[10.5px] text-[#B0BACB]">{a.time}</span>
                <span
                  className="block h-2 w-2 rounded-full"
                  style={{ background: a.color, boxShadow: `0 0 0 2px ${a.ring}` }}
                />
                <span className="text-[13.5px] leading-[1.45] text-[#41506B]">{a.text}</span>
                <span className="text-[12px] text-[#8A97AD]">{a.client}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

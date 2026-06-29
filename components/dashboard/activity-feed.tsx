import {
  activityItems as sampleActivityItems,
  type ActivityItem,
} from "@/lib/sample-data/dashboard";

export function ActivityFeed({ items = sampleActivityItems }: { items?: ActivityItem[] }) {
  return (
    <>
      <div className="font-display text-ink text-[15px] font-semibold">Activity</div>
      <div className="text-muted-2 mt-[3px] mb-5 text-[12px]">Across all client shows</div>

      <div>
        {items.length === 0 ? (
          <div className="text-muted-2 text-[12.5px]">
            Activity will appear here as you generate and approve outputs.
          </div>
        ) : (
          items.map((a, i) => {
            const last = i === items.length - 1;
            return (
              <div key={i} className="flex gap-[13px]">
                <div className="flex flex-shrink-0 flex-col items-center">
                  <span
                    className="mt-[3px] block h-[11px] w-[11px] rounded-full"
                    style={{
                      background: a.color,
                      border: `2.5px solid ${a.ring}`,
                    }}
                  />
                  {!last && <span className="bg-border-subtle my-[3px] w-[2px] flex-1" />}
                </div>
                <div className="min-w-0 pb-5">
                  <div className="text-[13px] leading-[1.45] text-[#2A3550]">
                    <span className="font-medium">{a.text}</span>
                  </div>
                  <div className="text-muted-2 mt-[3px] truncate text-[11.5px]">{a.client}</div>
                  <div className="text-subtle mt-[3px] text-[11px]">{a.time}</div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </>
  );
}

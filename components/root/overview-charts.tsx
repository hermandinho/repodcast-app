import type { Plan, TranscriptSource } from "@prisma/client";

const PLAN_COLORS: Record<Plan, string> = {
  SOLO: "#94a3b8", // slate-400
  STUDIO: "#3A5BA0", // brand accent
  NETWORK: "#10b981", // emerald-500
};

const PLAN_LABEL: Record<Plan, string> = {
  SOLO: "Solo",
  STUDIO: "Studio",
  NETWORK: "Network",
};

const SOURCE_COLORS: Record<TranscriptSource, string> = {
  PASTE: "#a78bfa", // violet-400
  UPLOAD: "#22d3ee", // cyan-400
  RSS: "#f59e0b", // amber-500
  YOUTUBE: "#ef4444", // red-500
};

const SOURCE_LABEL: Record<TranscriptSource, string> = {
  PASTE: "Paste",
  UPLOAD: "Audio upload",
  RSS: "RSS feed",
  YOUTUBE: "YouTube",
};

/**
 * Horizontal bar chart of episodes by transcript-source. Bars share a single
 * x-axis (the largest source) so segment sizes are visually comparable.
 * Renders nothing if all four sources are zero — the dashboard wraps this in
 * an empty-state.
 */
export function EpisodesBySourceChart({
  data,
}: {
  data: Array<{ source: TranscriptSource; count: number }>;
}) {
  const max = Math.max(...data.map((d) => d.count), 1);
  const total = data.reduce((acc, d) => acc + d.count, 0);

  return (
    <div className="flex flex-col gap-3">
      {data.map(({ source, count }) => {
        const widthPct = max > 0 ? Math.round((count / max) * 100) : 0;
        return (
          <div key={source} className="flex flex-col gap-1">
            <div className="flex items-center justify-between text-[12.5px]">
              <span className="text-zinc-300">{SOURCE_LABEL[source]}</span>
              <span className="font-mono text-zinc-400 tabular-nums">
                {count.toLocaleString()}
                {total > 0 ? (
                  <span className="ml-2 text-zinc-600">{Math.round((count / total) * 100)}%</span>
                ) : null}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${widthPct}%`, backgroundColor: SOURCE_COLORS[source] }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Stacked bar chart of outputs per week, segmented by the agency's plan at
 * write time. Inline SVG so we don't pull in Recharts for one chart. The bar
 * height encodes the week's total; segment heights inside encode plan share.
 */
export function OutputsByPlanChart({
  data,
}: {
  data: Array<{ weekStartIso: string; counts: Record<Plan, number>; total: number }>;
}) {
  const max = Math.max(...data.map((d) => d.total), 1);
  const planOrder: readonly Plan[] = ["NETWORK", "STUDIO", "SOLO"]; // top → bottom of stack

  // SVG canvas — 12 bars across, with side padding for axis labels.
  const W = 720;
  const H = 200;
  const padX = 24;
  const padY = 32;
  const barAreaWidth = W - padX * 2;
  const barAreaHeight = H - padY * 2;
  const slotWidth = barAreaWidth / data.length;
  const barWidth = Math.min(slotWidth * 0.6, 36);

  return (
    <div className="flex flex-col gap-3">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label="Outputs per week by plan"
      >
        {/* Axis baseline */}
        <line
          x1={padX}
          x2={W - padX}
          y1={H - padY}
          y2={H - padY}
          stroke="#27272a"
          strokeWidth={1}
        />
        {data.map((week, i) => {
          const cx = padX + slotWidth * i + slotWidth / 2;
          let y = H - padY; // start at baseline, stack upward
          return (
            <g key={week.weekStartIso}>
              {planOrder.map((plan) => {
                const value = week.counts[plan];
                if (value === 0) return null;
                const h = Math.round((value / max) * barAreaHeight);
                y -= h;
                return (
                  <rect
                    key={plan}
                    x={cx - barWidth / 2}
                    y={y}
                    width={barWidth}
                    height={h}
                    fill={PLAN_COLORS[plan]}
                    opacity={0.9}
                  >
                    <title>
                      {`${PLAN_LABEL[plan]}: ${value} (week of ${week.weekStartIso.slice(0, 10)})`}
                    </title>
                  </rect>
                );
              })}
              {/* Per-bar week label (every 2nd week so it doesn't crowd) */}
              {i % 2 === 0 ? (
                <text
                  x={cx}
                  y={H - padY + 14}
                  textAnchor="middle"
                  fontSize={10}
                  fontFamily="var(--font-mono)"
                  fill="#71717a"
                >
                  {week.weekStartIso.slice(5, 10)}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>

      <div className="flex items-center gap-4 font-mono text-[10.5px] tracking-wider text-zinc-500 uppercase">
        {(["SOLO", "STUDIO", "NETWORK"] as Plan[]).map((plan) => (
          <span key={plan} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: PLAN_COLORS[plan] }} />
            {PLAN_LABEL[plan]}
          </span>
        ))}
      </div>
    </div>
  );
}

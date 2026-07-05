"use client";

import { useMemo, useState } from "react";
import { chartSeries as sampleChartSeries, type ChartSeries } from "@/lib/sample-data/dashboard";

type Range = "8 weeks" | "12 weeks";

export type ChartSeriesMap = {
  "8 weeks": ChartSeries;
  "12 weeks": ChartSeries;
};

/**
 * Output volume chart (dashboard revamp 5a).
 *
 * Layout matches the ref exactly:
 *   - Title + range subtitle on the left, legend + 8w/12w toggle right.
 *   - Bar column: a soft-accent "generated" stack with a solid-accent
 *     "approved" overlay filling from the base up to the approved share
 *     of that week.
 *   - Empty state: a soft callout below the chart when nothing has been
 *     approved yet, explaining what the blue overlay is for.
 *
 * All accent tones use the workspace `--color-accent` — the ref's blue
 * is only a mockup color; we keep the brand accent so the chart stays
 * cohesive with the rest of the app.
 */
export function OutputVolumeChart({ series = sampleChartSeries }: { series?: ChartSeriesMap }) {
  const [range, setRange] = useState<Range>("8 weeks");
  const data = useMemo(() => series[range], [range, series]);

  const bars = useMemo(() => {
    const max = Math.max(...data.generated, 1);
    return data.generated.map((g, i) => ({
      genH: g > 0 ? Math.max(4, Math.round((g / max) * 100)) : 0,
      apprPct: g > 0 ? Math.round(((data.approved[i] ?? 0) / g) * 100) : 0,
      label: data.labels[i] ?? "",
    }));
  }, [data]);

  const anyApproved = data.approved.some((n) => n > 0);
  const anyGenerated = data.generated.some((n) => n > 0);

  return (
    <div className="rounded-[12px] border border-[#E4E9F1] bg-white px-6 py-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-[10px]">
          <span className="text-[15px] font-bold text-[#0A1E3C]">Output volume</span>
          <span className="text-[12.5px] text-[#8A97AD]">
            {data.rangeLabel} · {data.total} outputs
          </span>
        </div>

        <div className="flex items-center gap-[14px]">
          <span className="flex items-center gap-[6px] text-[11.5px] text-[#41506B]">
            <span className="bg-accent block h-[9px] w-[9px] rounded-[3px]" />
            Approved
          </span>
          <span className="flex items-center gap-[6px] text-[11.5px] text-[#41506B]">
            <span className="bg-accent-soft block h-[9px] w-[9px] rounded-[3px]" />
            Generated
          </span>
          <div className="inline-flex rounded-[7px] bg-[#EEF1F6] p-[2px]">
            {(["8 weeks", "12 weeks"] as Range[]).map((r) => {
              const selected = r === range;
              return (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRange(r)}
                  className={`rounded-[5px] px-[11px] py-1 text-[11.5px] font-semibold transition-colors ${
                    selected
                      ? "bg-white text-[#0A1E3C] shadow-[0_1px_2px_rgba(10,30,60,0.1)]"
                      : "text-[#41506B]"
                  }`}
                >
                  {r === "8 weeks" ? "8w" : "12w"}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div
        className="mt-[22px] grid items-end gap-[10px]"
        style={{
          gridTemplateColumns: `repeat(${bars.length}, minmax(0, 1fr))`,
          height: 170,
        }}
      >
        {bars.map((b, i) => (
          <div key={i} className="flex h-full flex-col justify-end">
            {b.genH === 0 ? (
              <div className="h-[2px] rounded-[2px] bg-[#EEF1F6]" />
            ) : (
              <div
                className="bg-accent-soft relative w-full rounded-t-[5px]"
                style={{ height: `${b.genH}%` }}
              >
                <div
                  className="bg-accent absolute inset-x-0 bottom-0 rounded-b-[0px]"
                  style={{ height: `${b.apprPct}%` }}
                />
              </div>
            )}
          </div>
        ))}
      </div>
      <div
        className="mt-2 grid gap-[10px] font-mono text-[9.5px] text-[#B0BACB]"
        style={{ gridTemplateColumns: `repeat(${bars.length}, minmax(0, 1fr))` }}
      >
        {bars.map((b, i) => (
          <span key={i} className="text-center">
            {b.label}
          </span>
        ))}
      </div>

      {anyGenerated && !anyApproved && (
        <div className="mt-4 flex items-center gap-2 rounded-[8px] bg-[#F6F8FC] px-[14px] py-[10px] text-[12.5px] text-[#41506B]">
          <span className="text-accent">ⓘ</span>
          Nothing approved yet — approved outputs will fill the bars in accent.
        </div>
      )}
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import { chartSeries as sampleChartSeries, type ChartSeries } from "@/lib/sample-data/dashboard";

type Range = "8 weeks" | "12 weeks";

export type ChartSeriesMap = {
  "8 weeks": ChartSeries;
  "12 weeks": ChartSeries;
};

/**
 * Output volume chart. Accepts both ranges and toggles between them client-
 * side — both series come from the dashboard data source (live aggregates in
 * live mode, the seeded sample data otherwise), so there's no sample-data
 * fallback in either mode anymore.
 */
export function OutputVolumeChart({ series = sampleChartSeries }: { series?: ChartSeriesMap }) {
  const [range, setRange] = useState<Range>("8 weeks");
  const data = useMemo(() => series[range], [range, series]);

  const bars = useMemo(() => {
    const max = Math.max(...data.generated, 1);
    return data.generated.map((g, i) => ({
      genH: Math.round((g / max) * 100),
      apprPct: g > 0 ? Math.round(((data.approved[i] ?? 0) / g) * 100) : 0,
      label: data.labels[i] ?? "",
    }));
  }, [data]);

  return (
    <div className="border-border bg-surface rounded-2xl border p-5">
      <div className="mb-[6px] flex items-start justify-between gap-3">
        <div>
          <div className="font-display text-ink text-[15px] font-semibold">Output volume</div>
          <div className="text-muted-2 mt-[2px] text-[12.5px]">
            {data.rangeLabel} · {data.total} outputs
          </div>
        </div>

        <div className="text-muted flex items-center gap-[14px] font-sans text-[11.5px] font-medium">
          <span className="flex items-center gap-[6px]">
            <span className="bg-accent block h-[9px] w-[9px] rounded-[2px]" />
            Approved
          </span>
          <span className="flex items-center gap-[6px]">
            <span className="bg-accent-soft block h-[9px] w-[9px] rounded-[2px]" />
            Generated
          </span>

          <div className="border-border ml-[10px] inline-flex overflow-hidden rounded-md border">
            {(["8 weeks", "12 weeks"] as Range[]).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRange(r)}
                className="px-2 py-1 font-sans text-[11px] font-semibold transition-colors"
                style={{
                  background: r === range ? "var(--color-accent-soft)" : "#fff",
                  color: r === range ? "var(--color-accent)" : "#5A6473",
                }}
              >
                {r === "8 weeks" ? "8w" : "12w"}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex h-[158px] items-end gap-[9px] pt-[18px]">
        {bars.map((b, i) => (
          <div key={i} className="flex h-full flex-1 flex-col items-center justify-end">
            <div className="relative flex h-full w-full max-w-[34px] items-end">
              <div
                className="bg-accent-soft relative w-full rounded-t-md"
                style={{
                  height: `${b.genH}%`,
                  borderBottomLeftRadius: 3,
                  borderBottomRightRadius: 3,
                  transformOrigin: "bottom",
                  animation: "grow .5s ease-out",
                }}
              >
                <div
                  className="bg-accent absolute inset-x-0 bottom-0 rounded-md"
                  style={{ height: `${b.apprPct}%` }}
                />
              </div>
            </div>
            <div className="text-subtle mt-[9px] h-[13px] font-sans text-[10.5px] font-medium">
              {b.label}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

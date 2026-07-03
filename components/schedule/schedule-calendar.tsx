"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { OutputStatus, Platform } from "@prisma/client";
import type { CalendarOutput } from "@/server/db/outputs";

const PLATFORM_LABEL: Record<Platform, string> = {
  TWITTER: "Twitter",
  LINKEDIN: "LinkedIn",
  INSTAGRAM: "Instagram",
  TIKTOK: "TikTok",
  SHOW_NOTES: "Show notes",
  BLOG: "Blog",
  NEWSLETTER: "Newsletter",
};

const PLATFORM_HUE: Record<Platform, string> = {
  TWITTER: "#1D9BF0",
  LINKEDIN: "#0A66C2",
  INSTAGRAM: "#D6249F",
  TIKTOK: "#111111",
  SHOW_NOTES: "#7E7E7E",
  BLOG: "#4A5568",
  NEWSLETTER: "#6D5EF5",
};

type CalendarEntry = CalendarOutput & { anchorDate: Date };

export function ScheduleCalendar({
  outputs,
  monthIso,
}: {
  outputs: CalendarOutput[];
  monthIso: string;
}) {
  const monthStart = useMemo(() => new Date(monthIso), [monthIso]);
  const [drawerKey, setDrawerKey] = useState<string | null>(null);

  const entries = useMemo<CalendarEntry[]>(
    () =>
      outputs.map((o) => ({
        ...o,
        anchorDate:
          o.status === OutputStatus.PUBLISHED && o.publishedAt
            ? o.publishedAt
            : (o.scheduledFor ?? o.publishedAt ?? new Date(0)),
      })),
    [outputs],
  );

  const grid = useMemo(() => buildMonthGrid(monthStart), [monthStart]);
  const byDay = useMemo(() => {
    const m = new Map<string, CalendarEntry[]>();
    for (const e of entries) {
      const key = dayKey(e.anchorDate);
      const list = m.get(key) ?? [];
      list.push(e);
      m.set(key, list);
    }
    return m;
  }, [entries]);

  const activeDay = drawerKey ? (byDay.get(drawerKey) ?? []) : [];

  const monthLabel = monthStart.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  const prev = shiftMonth(monthStart, -1);
  const next = shiftMonth(monthStart, 1);
  const today = new Date();
  const todayKey = dayKey(today);

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-ink text-[20px] font-semibold tracking-[-0.4px]">
          {monthLabel}
        </h2>
        <div className="flex items-center gap-1.5">
          <Link
            href={`/schedule?month=${monthKey(prev)}`}
            className="border-border text-muted hover:text-ink rounded-lg border px-2.5 py-1 text-[12.5px]"
          >
            ←
          </Link>
          <Link
            href={`/schedule?month=${monthKey(today)}`}
            className="border-border text-muted hover:text-ink rounded-lg border px-3 py-1 text-[12.5px]"
          >
            Today
          </Link>
          <Link
            href={`/schedule?month=${monthKey(next)}`}
            className="border-border text-muted hover:text-ink rounded-lg border px-2.5 py-1 text-[12.5px]"
          >
            →
          </Link>
        </div>
      </div>

      <div className="border-border grid grid-cols-7 overflow-hidden rounded-2xl border">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div
            key={d}
            className="border-border text-muted-2 border-b bg-zinc-50 px-3 py-2 font-mono text-[10.5px] font-semibold tracking-[0.05em] uppercase"
          >
            {d}
          </div>
        ))}
        {grid.map((cell, i) => {
          const cellKey = dayKey(cell.date);
          const entriesForDay = byDay.get(cellKey) ?? [];
          const isToday = cellKey === todayKey;
          return (
            <button
              type="button"
              key={i}
              onClick={() => setDrawerKey(entriesForDay.length > 0 ? cellKey : null)}
              className={`border-border min-h-[104px] border-r border-b p-2 text-left transition-colors ${
                cell.inMonth ? "bg-white" : "bg-zinc-50"
              } ${entriesForDay.length ? "hover:bg-blue-50/60" : ""}`}
            >
              <div
                className={`mb-1.5 flex items-center justify-between text-[11.5px] ${
                  cell.inMonth ? "text-ink" : "text-zinc-400"
                }`}
              >
                <span
                  className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[10.5px] font-semibold ${
                    isToday ? "bg-accent text-white" : ""
                  }`}
                >
                  {cell.date.getUTCDate()}
                </span>
                {entriesForDay.length > 0 ? (
                  <span className="text-muted-2 font-mono text-[10px]">{entriesForDay.length}</span>
                ) : null}
              </div>
              <div className="flex flex-col gap-1">
                {entriesForDay.slice(0, 3).map((e) => (
                  <div
                    key={e.id}
                    className="truncate rounded-md border px-1.5 py-0.5 text-[10.5px]"
                    style={{
                      borderColor: PLATFORM_HUE[e.platform] + "40",
                      color: PLATFORM_HUE[e.platform],
                      backgroundColor: PLATFORM_HUE[e.platform] + "12",
                    }}
                  >
                    {PLATFORM_LABEL[e.platform]} · {e.clientHost}
                  </div>
                ))}
                {entriesForDay.length > 3 ? (
                  <div className="text-muted-2 text-[10.5px]">+{entriesForDay.length - 3} more</div>
                ) : null}
              </div>
            </button>
          );
        })}
      </div>

      {drawerKey ? (
        <div onClick={() => setDrawerKey(null)} className="fixed inset-0 z-40 bg-black/40">
          <div
            onClick={(e) => e.stopPropagation()}
            className="absolute top-0 right-0 h-full w-full max-w-[440px] overflow-y-auto bg-white p-6 shadow-xl"
          >
            <div className="mb-4 flex items-start justify-between">
              <div>
                <div className="text-muted-2 font-mono text-[10.5px] tracking-[0.06em] uppercase">
                  {drawerDateLabel(drawerKey)}
                </div>
                <div className="font-display text-ink mt-1 text-[18px] font-semibold">
                  {activeDay.length} post{activeDay.length === 1 ? "" : "s"}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDrawerKey(null)}
                className="text-muted hover:text-ink text-[13px]"
              >
                Close
              </button>
            </div>
            <div className="flex flex-col gap-3">
              {activeDay.map((entry) => (
                <ScheduleDrawerCard key={entry.id} entry={entry} />
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function ScheduleDrawerCard({ entry }: { entry: CalendarEntry }) {
  const hue = PLATFORM_HUE[entry.platform];
  const timeLabel =
    entry.status === OutputStatus.PUBLISHED
      ? (entry.publishedAt?.toISOString().slice(11, 16) ?? "")
      : (entry.scheduledFor?.toISOString().slice(11, 16) ?? "");
  return (
    <div className="border-border rounded-2xl border bg-white p-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className="rounded-full px-2 py-0.5 text-[10.5px] font-semibold"
            style={{
              backgroundColor: hue + "12",
              color: hue,
              border: `1px solid ${hue}40`,
            }}
          >
            {PLATFORM_LABEL[entry.platform]}
          </span>
          <span className="text-muted-2 font-mono text-[10.5px]">{timeLabel} UTC</span>
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${
            entry.status === OutputStatus.PUBLISHED
              ? "bg-emerald-50 text-emerald-800"
              : "bg-blue-50 text-blue-800"
          }`}
        >
          {entry.status === OutputStatus.PUBLISHED ? "Published" : "Scheduled"}
        </span>
      </div>
      <div className="text-muted-2 text-[11.5px]">
        {entry.clientHost} · {entry.showTitle}
      </div>
      <div className="text-ink mt-2 line-clamp-3 text-[12.5px] leading-[1.55] whitespace-pre-wrap">
        {entry.content}
      </div>
      <div className="mt-3 flex items-center justify-between text-[11.5px]">
        <Link href={`/episodes/${entry.episodeId}`} className="text-accent hover:underline">
          Open episode →
        </Link>
        {entry.externalPostUrl ? (
          <a
            href={entry.externalPostUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="text-muted hover:text-ink"
          >
            View post ↗
          </a>
        ) : null}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// Pure helpers — no state, safe to keep inline for now.
// -----------------------------------------------------------------------

function buildMonthGrid(monthStart: Date): Array<{ date: Date; inMonth: boolean }> {
  // Grid always starts on Monday. Compute the offset of the 1st of the month.
  const first = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth(), 1));
  const dow = (first.getUTCDay() + 6) % 7; // Mon = 0
  const start = new Date(first);
  start.setUTCDate(first.getUTCDate() - dow);

  const cells: Array<{ date: Date; inMonth: boolean }> = [];
  for (let i = 0; i < 42; i += 1) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    cells.push({
      date: d,
      inMonth: d.getUTCMonth() === first.getUTCMonth(),
    });
  }
  return cells;
}

function dayKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate(),
  ).padStart(2, "0")}`;
}

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function shiftMonth(d: Date, delta: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + delta, 1));
}

function drawerDateLabel(key: string): string {
  const parts = key.split("-").map((n) => Number.parseInt(n, 10));
  const d = new Date(Date.UTC(parts[0]!, parts[1]! - 1, parts[2]!));
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

import { requireAuthContext } from "@/server/auth/context";
import { toTenantContext } from "@/server/auth/tenant";
import { isLiveDb } from "@/server/data/source";
import { listScheduledOutputsForAgency, type CalendarOutput } from "@/server/db/outputs";
import { ScheduleCalendar } from "@/components/schedule/schedule-calendar";

export const dynamic = "force-dynamic";

/**
 * Phase 3.3 — calendar of SCHEDULED + PUBLISHED outputs for the current
 * month, with a day-drawer for detail. Deep-linkable via `?month=YYYY-MM`.
 */
export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const sp = await searchParams;
  const month = parseMonth(sp.month);
  const monthStart = new Date(Date.UTC(month.year, month.month0, 1));
  const nextStart = new Date(Date.UTC(month.year, month.month0 + 1, 1));

  const auth = await requireAuthContext();
  const ctx = toTenantContext(auth);

  const outputs: CalendarOutput[] = isLiveDb()
    ? await listScheduledOutputsForAgency(ctx, {
        fromIso: monthStart.toISOString(),
        toIso: nextStart.toISOString(),
      })
    : [];

  return (
    <div className="px-[30px] pt-[28px] pb-[60px]">
      <div className="mx-auto max-w-[1120px]">
        <div className="mb-5">
          <h1 className="font-display text-ink text-[25px] font-semibold tracking-[-0.5px]">
            Schedule
          </h1>
          <p className="text-muted mt-[6px] text-[14px]">
            Every SCHEDULED and PUBLISHED post across your agency. Approve an output on any episode
            to add it here.
          </p>
        </div>

        {/* Always render the calendar — the next/prev/Today controls live
            inside it. Bug fix: the previous code swapped the calendar for
            an "empty" card when the month had zero outputs, which stranded
            the user with no way to navigate to a different month. */}
        <ScheduleCalendar
          outputs={outputs}
          monthIso={monthStart.toISOString()}
          emptyHint={
            outputs.length === 0
              ? "Nothing scheduled this month — approve outputs on your episodes to add them to the calendar."
              : null
          }
        />
      </div>
    </div>
  );
}

function parseMonth(raw: string | undefined): { year: number; month0: number } {
  const now = new Date();
  const fallback = { year: now.getUTCFullYear(), month0: now.getUTCMonth() };
  if (!raw) return fallback;
  const match = /^(\d{4})-(\d{2})$/.exec(raw);
  if (!match) return fallback;
  const year = Number.parseInt(match[1]!, 10);
  const month = Number.parseInt(match[2]!, 10);
  if (year < 2020 || year > 2100 || month < 1 || month > 12) return fallback;
  return { year, month0: month - 1 };
}

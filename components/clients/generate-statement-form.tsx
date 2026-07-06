"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { generateClientStatementAction } from "@/app/(dashboard)/clients/[key]/statements/actions";

/**
 * Phase 2.13.4 — Generate-statement form.
 *
 * Defaults to the current calendar month (first → today's date). Submit
 * routes the user to the new statement's detail page on success.
 */
export function GenerateStatementForm({
  clientKey,
  defaultStart,
  defaultEnd,
}: {
  clientKey: string;
  /** YYYY-MM-DD — first day of current calendar month. */
  defaultStart: string;
  /** YYYY-MM-DD — today (or end of the period the user wants). */
  defaultEnd: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [periodStart, setPeriodStart] = useState(defaultStart);
  const [periodEnd, setPeriodEnd] = useState(defaultEnd);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!periodStart || !periodEnd) {
      setError("Pick a period start and end.");
      return;
    }
    startTransition(async () => {
      try {
        const result = await generateClientStatementAction({
          clientId: clientKey,
          period: { periodStart, periodEnd },
        });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        router.push(`/clients/${clientKey}/statements/${result.data.statementId}`);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Generate failed.");
      }
    });
  };

  return (
    <form
      onSubmit={onSubmit}
      className="border-border bg-surface flex flex-wrap items-end gap-3 rounded-3xl border p-5"
    >
      <div className="min-w-0 flex-1">
        <div className="font-display text-ink text-[15px] font-semibold">Generate statement</div>
        <div className="text-muted-2 mt-[3px] text-[12.5px]">
          Snapshots episode + output counts and approval rate, then seeds billable line items from
          this client&apos;s billing profile. Delivery totals stay locked; edit the line items to
          match what you&apos;re actually charging.
        </div>
      </div>

      <label className="flex flex-col gap-[6px]">
        <span className="text-muted font-sans text-[12px] font-medium">From</span>
        <Input
          type="date"
          value={periodStart}
          max={periodEnd || undefined}
          onChange={(e) => setPeriodStart(e.target.value)}
          required
        />
      </label>
      <label className="flex flex-col gap-[6px]">
        <span className="text-muted font-sans text-[12px] font-medium">To</span>
        <Input
          type="date"
          value={periodEnd}
          min={periodStart || undefined}
          onChange={(e) => setPeriodEnd(e.target.value)}
          required
        />
      </label>

      <Button type="submit" disabled={pending}>
        {pending ? "Generating…" : "Generate"}
      </Button>

      {error && (
        <div className="basis-full rounded-md bg-[#FBEDEC] px-3 py-2 font-sans text-[12.5px] font-medium text-[#8A2A1F]">
          {error}
        </div>
      )}
    </form>
  );
}

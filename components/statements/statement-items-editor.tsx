"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addStatementItemAction,
  deleteStatementItemAction,
  updateStatementItemAction,
} from "@/app/(dashboard)/clients/[key]/statements/[id]/items-actions";

/**
 * Editable line-item table for a `ClientStatement`. OWNER/ADMIN-only —
 * the parent page role-gates access before rendering, so we don't
 * re-check here. Read-only mode is a separate branch used on the
 * portal renderer.
 *
 * Each row inputs live-compute a `Row total` from `quantity × unit`,
 * but the persisted `amountCents` is authoritative — we send only
 * quantity + unit to the server, which round-trips a fresh amount.
 */

export type StatementItemRow = {
  id: string;
  description: string;
  /** Decimal serialised as a JS number for form editing. */
  quantity: number;
  unitAmountCents: number;
  amountCents: number;
};

const CENTS_PER_UNIT = 100;

function centsFromDollars(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * CENTS_PER_UNIT);
}

function dollarsFromCents(cents: number): string {
  return (cents / CENTS_PER_UNIT).toFixed(2);
}

function formatMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
    }).format(cents / CENTS_PER_UNIT);
  } catch {
    return `${(cents / CENTS_PER_UNIT).toFixed(2)} ${currency}`;
  }
}

export function StatementItemsEditor({
  clientKey,
  statementId,
  currency,
  initialItems,
}: {
  clientKey: string;
  statementId: string;
  currency: string;
  initialItems: StatementItemRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Local edit buffers for the "add new" row.
  const [newDescription, setNewDescription] = useState("");
  const [newQuantity, setNewQuantity] = useState("1");
  const [newUnitDollars, setNewUnitDollars] = useState("");

  const total = useMemo(
    () => initialItems.reduce((sum, it) => sum + it.amountCents, 0),
    [initialItems],
  );

  const runAction = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>) => {
    setError(null);
    startTransition(async () => {
      try {
        const result = await fn();
        if (!result.ok) {
          setError(result.error);
          return;
        }
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      }
    });
  };

  const addRow = () => {
    const qty = Number(newQuantity);
    const unitCents = centsFromDollars(newUnitDollars);
    if (!newDescription.trim()) {
      setError("Description is required.");
      return;
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      setError("Quantity must be a positive number.");
      return;
    }
    if (unitCents == null) {
      setError("Unit price must be a non-negative number.");
      return;
    }
    runAction(async () => {
      const result = await addStatementItemAction({
        clientKey,
        statementId,
        description: newDescription.trim(),
        quantity: qty,
        unitAmountCents: unitCents,
      });
      if (result.ok) {
        setNewDescription("");
        setNewQuantity("1");
        setNewUnitDollars("");
      }
      return result;
    });
  };

  return (
    <section className="border-border bg-surface rounded-3xl border p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <div className="font-display text-ink text-[15px] font-semibold">Billable items</div>
          <div className="text-muted-2 mt-[3px] text-[12.5px]">
            The lines the client sees on the invoice for this period. Auto-seeded from the billing
            profile — edit, remove, or add rows to match what you&apos;re actually charging.
          </div>
        </div>
        <div className="text-right">
          <div className="text-muted-2 font-mono text-[10.5px] font-medium tracking-[0.06em] uppercase">
            Total
          </div>
          <div className="font-display text-ink mt-1 text-[22px] font-bold tracking-[-0.3px] tabular-nums">
            {formatMoney(total, currency)}
          </div>
        </div>
      </div>

      {initialItems.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {initialItems.map((item) => (
            <ExistingRow
              key={item.id}
              clientKey={clientKey}
              statementId={statementId}
              item={item}
              currency={currency}
              pending={pending}
              runAction={runAction}
            />
          ))}
        </ul>
      ) : (
        <div className="border-border bg-canvas text-muted-2 rounded-2xl border border-dashed px-4 py-6 text-center text-[12.5px]">
          No line items yet — add one below.
        </div>
      )}

      {/* Add-new row */}
      <div className="border-border-subtle bg-surface-2 mt-4 grid grid-cols-[minmax(0,1fr)_100px_120px_auto] items-end gap-3 rounded-2xl border p-3">
        <label className="flex flex-col gap-[6px]">
          <span className="text-muted font-sans text-[11.5px] font-medium">Description</span>
          <input
            type="text"
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            placeholder="e.g. Extra editing hours"
            className="border-border rounded-md border bg-white px-3 py-2 font-sans text-[13px] outline-none focus:border-[#3A5BA0]"
            maxLength={200}
          />
        </label>
        <label className="flex flex-col gap-[6px]">
          <span className="text-muted font-sans text-[11.5px] font-medium">Qty</span>
          <input
            type="number"
            step="0.01"
            min="0"
            value={newQuantity}
            onChange={(e) => setNewQuantity(e.target.value)}
            className="border-border rounded-md border bg-white px-3 py-2 text-right font-sans text-[13px] tabular-nums outline-none focus:border-[#3A5BA0]"
          />
        </label>
        <label className="flex flex-col gap-[6px]">
          <span className="text-muted font-sans text-[11.5px] font-medium">Unit ({currency})</span>
          <input
            type="number"
            step="0.01"
            min="0"
            value={newUnitDollars}
            onChange={(e) => setNewUnitDollars(e.target.value)}
            placeholder="0.00"
            className="border-border rounded-md border bg-white px-3 py-2 text-right font-sans text-[13px] tabular-nums outline-none focus:border-[#3A5BA0]"
          />
        </label>
        <button
          type="button"
          onClick={addRow}
          disabled={pending}
          className="border-accent-border bg-accent rounded-md border px-4 py-2 font-sans text-[12.5px] font-semibold text-white transition-[filter] hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "…" : "Add item"}
        </button>
      </div>

      {error && (
        <div className="mt-3 rounded-md bg-[#FBEDEC] px-3 py-2 font-sans text-[12.5px] font-medium text-[#8A2A1F]">
          {error}
        </div>
      )}
    </section>
  );
}

/**
 * A single existing item. Inline-edits `description`, `quantity`, and
 * `unit`; the row total re-computes locally as the user types. Blurring
 * a field commits the change (one server round-trip per edit — small
 * cost, avoids a global "save" that could lose focus state).
 */
function ExistingRow({
  clientKey,
  statementId,
  item,
  currency,
  pending,
  runAction,
}: {
  clientKey: string;
  statementId: string;
  item: StatementItemRow;
  currency: string;
  pending: boolean;
  runAction: (fn: () => Promise<{ ok: true } | { ok: false; error: string }>) => void;
}) {
  const [description, setDescription] = useState(item.description);
  const [quantity, setQuantity] = useState(String(item.quantity));
  const [unitDollars, setUnitDollars] = useState(dollarsFromCents(item.unitAmountCents));

  const liveTotalCents = useMemo(() => {
    const q = Number(quantity);
    const u = centsFromDollars(unitDollars);
    if (!Number.isFinite(q) || q < 0 || u == null) return item.amountCents;
    return Math.round(q * u);
  }, [quantity, unitDollars, item.amountCents]);

  const commit = (patch: { description?: string; quantity?: number; unitAmountCents?: number }) => {
    runAction(() =>
      updateStatementItemAction({
        clientKey,
        statementId,
        itemId: item.id,
        ...patch,
      }),
    );
  };

  const remove = () => {
    runAction(() => deleteStatementItemAction({ clientKey, statementId, itemId: item.id }));
  };

  return (
    <li className="border-border bg-surface grid grid-cols-[minmax(0,1fr)_100px_120px_120px_auto] items-center gap-3 rounded-2xl border px-3 py-2">
      <input
        type="text"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        onBlur={() => {
          const trimmed = description.trim();
          if (trimmed && trimmed !== item.description) commit({ description: trimmed });
          else setDescription(item.description);
        }}
        className="border-border-subtle rounded-md border bg-white px-3 py-1.5 font-sans text-[13px] outline-none focus:border-[#3A5BA0]"
        maxLength={200}
      />
      <input
        type="number"
        step="0.01"
        min="0"
        value={quantity}
        onChange={(e) => setQuantity(e.target.value)}
        onBlur={() => {
          const q = Number(quantity);
          if (Number.isFinite(q) && q > 0 && q !== item.quantity) {
            commit({ quantity: q });
          } else {
            setQuantity(String(item.quantity));
          }
        }}
        className="border-border-subtle rounded-md border bg-white px-3 py-1.5 text-right font-sans text-[13px] tabular-nums outline-none focus:border-[#3A5BA0]"
      />
      <input
        type="number"
        step="0.01"
        min="0"
        value={unitDollars}
        onChange={(e) => setUnitDollars(e.target.value)}
        onBlur={() => {
          const cents = centsFromDollars(unitDollars);
          if (cents != null && cents !== item.unitAmountCents) {
            commit({ unitAmountCents: cents });
          } else {
            setUnitDollars(dollarsFromCents(item.unitAmountCents));
          }
        }}
        className="border-border-subtle rounded-md border bg-white px-3 py-1.5 text-right font-sans text-[13px] tabular-nums outline-none focus:border-[#3A5BA0]"
      />
      <span className="text-ink text-right font-sans text-[13px] font-semibold tabular-nums">
        {formatMoney(liveTotalCents, currency)}
      </span>
      <button
        type="button"
        onClick={remove}
        disabled={pending}
        className="border-border text-muted rounded-md border bg-white px-2.5 py-1.5 font-sans text-[11.5px] font-medium transition-colors hover:border-red-200 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-60"
        aria-label={`Remove ${item.description}`}
      >
        Remove
      </button>
    </li>
  );
}

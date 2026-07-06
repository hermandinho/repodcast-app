import "server-only";

import type { ClientStatementItem, Platform } from "@prisma/client";
import type { StatementPdfData } from "@/components/statements/statement-pdf";

/**
 * Shared adapter — takes the raw DB rows the PDF routes fetch (agency
 * side + portal side) and shapes them into `StatementPdfData` for the
 * `<StatementPdf>` renderer. Kept out of the routes so the "how do we
 * format money?" and "how do we handle a missing generatedByMember?"
 * decisions live in one place.
 */

type MinimalMember = { name: string | null; email: string } | null;

export function buildStatementPdfPayload(input: {
  agencyName: string;
  brandAccentColor: string | null;
  clientName: string;
  currency: string;
  periodStart: Date;
  periodEnd: Date;
  generatedAt: Date;
  generatedByMember: MinimalMember;
  totals: {
    episodeCount: number;
    outputCount: number;
    approvedCount: number;
    approvalRatePct: number;
  };
  items: ClientStatementItem[];
  breakdown: Array<{ platform: Platform; total: number; approved: number }>;
}): StatementPdfData {
  const fmtMoney = makeMoneyFormatter(input.currency);
  const totalCents = input.items.reduce((sum, it) => sum + it.amountCents, 0);

  const generatedByLabel = input.generatedByMember
    ? input.generatedByMember.name?.trim() || input.generatedByMember.email
    : "system";

  return {
    agencyName: input.agencyName,
    brandAccentColor: input.brandAccentColor,
    clientName: input.clientName,
    periodStartIso: input.periodStart.toISOString(),
    periodEndIso: input.periodEnd.toISOString(),
    generatedAtIso: input.generatedAt.toISOString(),
    generatedByLabel,
    currency: input.currency,
    totals: {
      episodeCount: input.totals.episodeCount,
      outputCount: input.totals.outputCount,
      approvedCount: input.totals.approvedCount,
      approvalRatePct: input.totals.approvalRatePct,
      totalFormatted: fmtMoney(totalCents),
    },
    items: input.items.map((it) => ({
      description: it.description,
      quantityLabel: formatQuantity(Number(it.quantity)),
      unitLabel: fmtMoney(it.unitAmountCents),
      amountLabel: fmtMoney(it.amountCents),
    })),
    breakdown: input.breakdown,
  };
}

function makeMoneyFormatter(currency: string): (cents: number) => string {
  const safe = currency && /^[A-Za-z]{3}$/.test(currency) ? currency.toUpperCase() : "USD";
  const fmt = (() => {
    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: safe,
        minimumFractionDigits: 2,
      });
    } catch {
      return null;
    }
  })();
  return (cents) => {
    if (fmt) return fmt.format(cents / 100);
    return `${(cents / 100).toFixed(2)} ${safe}`;
  };
}

/**
 * Show whole numbers as "12", fractional as "0.5" (drops trailing zeros).
 */
function formatQuantity(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return String(Number(n.toFixed(2)));
}

import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ForbiddenError, ValidationError } from "@/server/auth/errors";
import { requireSystemAdminContext } from "@/server/auth/system";
import {
  CSV_EXPORT_HARD_CAP,
  streamInvoicesForCsv,
  type InvoiceRowForRoot,
  type StreamInvoicesForCsvInput,
} from "@/server/db/system/finance";

/**
 * Phase 3.6.7 — CSV export of the global invoice ledger.
 *
 * Same filter shape as the dashboard query string (`search`, `status`,
 * `createdFrom`, `createdTo`) — the dashboard's "Export CSV" link just
 * carries the current filters across.
 *
 * Auth: the `/api/root/*` namespace doesn't sit under the (root) route
 * group, so we have to gate explicitly. `requireSystemAdminContext` mirrors
 * the layout-level check — 404 (not 403) when the caller isn't a SystemAdmin
 * so the route's existence stays invisible to probing.
 */
export const dynamic = "force-dynamic";

const HEADER = [
  "invoice_id",
  "stripe_invoice_id",
  "created_at",
  "agency_id",
  "agency_name",
  "status",
  "amount_cents",
  "currency",
  "period_start",
  "period_end",
  "hosted_invoice_url",
  "pdf_url",
];

/** RFC 4180 quoting — only quote cells that contain a delimiter / quote / newline. */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function csvLine(cells: unknown[]): string {
  return cells.map(csvCell).join(",");
}

function row(r: InvoiceRowForRoot): string {
  return csvLine([
    r.id,
    r.stripeInvoiceId,
    r.createdAt.toISOString(),
    r.agencyId,
    r.agencyName,
    r.status,
    r.amountCents,
    r.currency.toUpperCase(),
    r.periodStart.toISOString(),
    r.periodEnd.toISOString(),
    r.hostedInvoiceUrl ?? "",
    r.pdfUrl ?? "",
  ]);
}

export async function GET(req: Request) {
  const ctx = await requireSystemAdminContext();

  const url = new URL(req.url);
  const filters: Partial<StreamInvoicesForCsvInput> = {
    search: url.searchParams.get("search") ?? undefined,
    status: (url.searchParams.get("status") as StreamInvoicesForCsvInput["status"]) ?? undefined,
    createdFrom: url.searchParams.get("createdFrom") ?? undefined,
    createdTo: url.searchParams.get("createdTo") ?? undefined,
  };

  let rows: InvoiceRowForRoot[];
  try {
    rows = await streamInvoicesForCsv(ctx, filters);
  } catch (err) {
    if (err instanceof ZodError) {
      throw new ValidationError(err.message);
    }
    if (err instanceof ForbiddenError) {
      // Defensive — the layout-side gate already filters non-readers, but
      // future role changes might tighten the helper. Surface the 403
      // explicitly so curl-based exports don't get a confusing 200.
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    throw err;
  }

  const body =
    [csvLine(HEADER), ...rows.map(row)].join("\n") +
    (rows.length === CSV_EXPORT_HARD_CAP
      ? `\n# truncated at ${CSV_EXPORT_HARD_CAP} rows — narrow your filters\n`
      : "\n");

  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const filename = `repodcast-invoices-${stamp}.csv`;

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

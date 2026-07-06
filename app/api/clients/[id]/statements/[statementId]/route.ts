import { NextResponse } from "next/server";
import { MemberRole, OutputStatus, Platform } from "@prisma/client";
import { requireAuthContext } from "@/server/auth/context";
import { ForbiddenError, NotFoundError } from "@/server/auth/errors";
import { toTenantContext } from "@/server/auth/tenant";
import { computeStatementAggregates, getClientStatement } from "@/server/db/client-statements";
import { listStatementItems } from "@/server/db/client-statement-items";
import { prisma } from "@/server/db/client";
import { isLiveDb } from "@/server/data/source";

/**
 * Phase 2.13.4 — Single-statement CSV export.
 *
 * Layout: a header block carrying the period + totals (one line per
 * metric, key/value pairs), then a blank row, then a per-platform
 * breakdown computed from current outputs inside the window. Per-platform
 * counts can drift from the snapshot if outputs are later regenerated
 * (superseded rows are excluded); the snapshot totals at the top remain
 * the contract.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
function csvLine(cells: unknown[]): string {
  return cells.map(csvCell).join(",");
}

function dateOnly(d: Date | null | undefined): string {
  if (!d) return "";
  return d.toISOString().slice(0, 10);
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "client"
  );
}

const PLATFORMS: Platform[] = [
  Platform.TWITTER,
  Platform.LINKEDIN,
  Platform.INSTAGRAM,
  Platform.TIKTOK,
  Platform.SHOW_NOTES,
  Platform.BLOG,
  Platform.NEWSLETTER,
];

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; statementId: string }> },
) {
  const { id: clientId, statementId } = await params;

  if (!isLiveDb()) {
    return NextResponse.json(
      { error: "Sample-data mode — statement export disabled." },
      { status: 404 },
    );
  }

  const auth = await requireAuthContext();
  if (auth.member.role !== MemberRole.OWNER && auth.member.role !== MemberRole.ADMIN) {
    throw new ForbiddenError("Only owners and admins can export statements.");
  }

  // Tenancy guard on the URL key — also yields the client name for the
  // filename.
  const client = await prisma.client.findFirst({
    where: { id: clientId, agencyId: auth.agency.id },
    select: { id: true, name: true },
  });
  if (!client) throw new NotFoundError(`Client ${clientId} not found`);

  // Statement repo enforces OWNER/ADMIN + tenant; getClientStatement throws
  // NotFoundError on mismatch.
  const statement = await getClientStatement(toTenantContext(auth), statementId);
  if (statement.client.id !== client.id) {
    throw new NotFoundError(`Statement ${statementId} not found for client`);
  }

  // Delivery counts recomputed live for the same reason the detail page
  // does — pre-fix statements persisted `approvedCount = 0` and stay
  // that way until regenerated. Live values auto-heal the CSV.
  const [items, liveTotals] = await Promise.all([
    listStatementItems(toTenantContext(auth), statement.id),
    computeStatementAggregates(
      toTenantContext(auth),
      clientId,
      statement.periodStart,
      statement.periodEnd,
    ),
  ]);
  const itemsTotalCents = items.reduce((sum, it) => sum + it.amountCents, 0);

  // Per-platform breakdown from current outputs in the window. groupBy
  // counts per platform; we then format one CSV row per platform.
  const breakdown = await prisma.generatedOutput.groupBy({
    by: ["platform", "status"],
    where: {
      supersededAt: null,
      episode: {
        show: { client: { id: clientId, agencyId: auth.agency.id } },
      },
      createdAt: {
        gte: statement.periodStart,
        lte: statement.periodEnd,
      },
    },
    _count: { _all: true },
  });

  // Pivot into { platform → { total, approved } } shape. "Approved"
  // includes SCHEDULED + PUBLISHED — an approved-and-scheduled output
  // is still approved, the status column just moved on. Filtering by
  // status === APPROVED alone (the prior code) under-reported.
  const APPROVED_STATUSES = new Set<OutputStatus>([
    OutputStatus.APPROVED,
    OutputStatus.SCHEDULED,
    OutputStatus.PUBLISHED,
  ]);
  const byPlatform = new Map<Platform, { total: number; approved: number }>();
  for (const p of PLATFORMS) {
    byPlatform.set(p, { total: 0, approved: 0 });
  }
  for (const row of breakdown) {
    const slot = byPlatform.get(row.platform);
    if (!slot) continue;
    slot.total += row._count._all;
    if (APPROVED_STATUSES.has(row.status)) {
      slot.approved += row._count._all;
    }
  }

  const generatedBy = statement.generatedByMember
    ? statement.generatedByMember.name?.trim() || statement.generatedByMember.email
    : "system";

  // Build the CSV. Header block first (key,value), then a blank row, then
  // a line-items table, then a blank row, then per-platform breakdown.
  // Cost-to-serve is intentionally omitted — internal, /root-only now.
  const lines: string[] = [];
  lines.push(csvLine(["Client", statement.client.name]));
  lines.push(csvLine(["Period start", dateOnly(statement.periodStart)]));
  lines.push(csvLine(["Period end", dateOnly(statement.periodEnd)]));
  lines.push(csvLine(["Generated at", dateOnly(statement.generatedAt)]));
  lines.push(csvLine(["Generated by", generatedBy]));
  lines.push(csvLine(["Currency", statement.currency]));
  lines.push(csvLine([]));
  lines.push(csvLine(["Episode count", liveTotals.episodeCount]));
  lines.push(csvLine(["Output count", liveTotals.outputCount]));
  lines.push(csvLine(["Approved count", liveTotals.approvedCount]));
  lines.push(csvLine(["Approval rate (%)", liveTotals.approvalRatePct]));
  lines.push(csvLine([]));
  lines.push(csvLine(["Description", "Quantity", "Unit (cents)", "Amount (cents)"]));
  for (const item of items) {
    lines.push(
      csvLine([item.description, Number(item.quantity), item.unitAmountCents, item.amountCents]),
    );
  }
  lines.push(csvLine(["", "", "Total (cents)", itemsTotalCents]));
  lines.push(csvLine([]));
  lines.push(csvLine(["Platform", "Total outputs", "Approved outputs"]));
  for (const platform of PLATFORMS) {
    const slot = byPlatform.get(platform)!;
    lines.push(csvLine([platform, slot.total, slot.approved]));
  }

  const body = lines.join("\r\n") + "\r\n";
  const filename = `${slugify(client.name)}-statement-${dateOnly(statement.periodStart)}_${dateOnly(statement.periodEnd)}.csv`;

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

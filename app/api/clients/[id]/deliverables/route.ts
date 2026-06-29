import { NextResponse } from "next/server";
import { MemberRole, OutputStatus, Platform } from "@prisma/client";
import { requireAuthContext } from "@/server/auth/context";
import { ForbiddenError, NotFoundError } from "@/server/auth/errors";
import { toTenantContext } from "@/server/auth/tenant";
import { streamDeliverablesForClient } from "@/server/db/deliverables";
import { prisma } from "@/server/db/client";
import { isLiveDb } from "@/server/data/source";

/**
 * Phase 2.13.3 — CSV export of the deliverable ledger for a single client.
 *
 * Auth: OWNER/ADMIN only (the in-app ledger is open to all roles, but the
 * downloadable CSV is treated like a billing export — restricted to the
 * roles that own client relationships).
 *
 * No streaming for v1 — agencies cap at ~hundreds of outputs per client per
 * period, well inside what fits in memory + a single CSV response. If we
 * see complaints, swap to a `ReadableStream` of chunked rows.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function parseDate(raw: string | null): Date | undefined {
  if (!raw) return undefined;
  const d = new Date(raw);
  return Number.isFinite(d.getTime()) ? d : undefined;
}

function parsePlatform(raw: string | null): Platform | undefined {
  if (!raw) return undefined;
  return raw in Platform ? (raw as Platform) : undefined;
}

function parseStatus(raw: string | null): OutputStatus | undefined {
  if (!raw) return undefined;
  return raw in OutputStatus ? (raw as OutputStatus) : undefined;
}

/** Quote a CSV cell when it contains a delimiter, quote, or newline. */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
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

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: clientId } = await params;

  if (!isLiveDb()) {
    // Sample-data mode: the table is illustrative, the export is real-mode
    // only. Returning 404 is the cleanest signal — "this endpoint doesn't
    // do anything useful without a DB."
    return NextResponse.json(
      { error: "Sample-data mode — deliverables export disabled." },
      { status: 404 },
    );
  }

  const auth = await requireAuthContext();
  if (auth.member.role !== MemberRole.OWNER && auth.member.role !== MemberRole.ADMIN) {
    throw new ForbiddenError("Only owners and admins can export deliverables.");
  }

  // Resolve client name for the filename — also a tenant gate (cross-tenant
  // ids fall out as null → 404).
  const client = await prisma.client.findFirst({
    where: { id: clientId, agencyId: auth.agency.id },
    select: { id: true, name: true },
  });
  if (!client) throw new NotFoundError(`Client ${clientId} not found`);

  const url = new URL(req.url);
  const from = parseDate(url.searchParams.get("from"));
  const to = parseDate(url.searchParams.get("to"));
  const platform = parsePlatform(url.searchParams.get("platform"));
  const status = parseStatus(url.searchParams.get("status"));

  const rows = await streamDeliverablesForClient(toTenantContext(auth), clientId, {
    from,
    to,
    platform,
    status,
  });

  const header = [
    "Output ID",
    "Episode",
    "Recorded",
    "Platform",
    "Status",
    "Generated",
    "Approved by",
    "Approved at",
    "Edit distance",
    "Version",
  ];
  const lines: string[] = [csvLine(header)];
  for (const r of rows) {
    lines.push(
      csvLine([
        r.id,
        r.episode.title,
        dateOnly(r.episode.recordedAt),
        r.platform,
        r.status,
        dateOnly(r.createdAt),
        r.approvedByMember?.name ?? r.approvedByMember?.email ?? "",
        dateOnly(r.approvedAt),
        r.editDistance,
        r.version,
      ]),
    );
  }
  const body = lines.join("\r\n") + "\r\n";

  const fromStamp = from ? dateOnly(from) : "all";
  const toStamp = to ? dateOnly(to) : "all";
  const filename = `${slugify(client.name)}-deliverables-${fromStamp}_${toStamp}.csv`;

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

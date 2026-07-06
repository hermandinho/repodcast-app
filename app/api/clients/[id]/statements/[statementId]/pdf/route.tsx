import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { MemberRole } from "@prisma/client";
import { requireAuthContext } from "@/server/auth/context";
import { ForbiddenError, NotFoundError } from "@/server/auth/errors";
import { toTenantContext } from "@/server/auth/tenant";
import { prisma } from "@/server/db/client";
import {
  computeStatementAggregates,
  computeStatementPlatformBreakdown,
  getClientStatementForPdf,
} from "@/server/db/client-statements";
import { listStatementItems } from "@/server/db/client-statement-items";
import { isLiveDb } from "@/server/data/source";
import { StatementPdf } from "@/components/statements/statement-pdf";
import { buildStatementPdfPayload } from "@/server/statements/pdf-payload";

/**
 * Phase 3.8 — Single-statement PDF export (agency-side).
 *
 * Auth-gated OWNER/ADMIN, mirrors the CSV route's tenant guard. Renders
 * the PDF on-demand — statement totals are frozen at generation time, so
 * a repeat download always yields the same bytes; we skip the R2 cache
 * (`pdfStorageKey` on the schema stays reserved) since statements are
 * downloaded rarely and the renderer is cheap.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function dateOnly(d: Date): string {
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

  const client = await prisma.client.findFirst({
    where: { id: clientId, agencyId: auth.agency.id },
    select: { id: true, name: true },
  });
  if (!client) throw new NotFoundError(`Client ${clientId} not found`);

  const statement = await getClientStatementForPdf(toTenantContext(auth), statementId);
  if (statement.client.id !== client.id) {
    throw new NotFoundError(`Statement ${statementId} not found for client`);
  }

  // Recompute delivery counts live so PDFs from pre-fix statements show
  // the correct approvedCount (persisted rows have `approvedCount = 0`
  // from the earlier status-set bug).
  const [breakdown, items, liveTotals] = await Promise.all([
    computeStatementPlatformBreakdown({
      clientId,
      agencyId: auth.agency.id,
      periodStart: statement.periodStart,
      periodEnd: statement.periodEnd,
    }),
    listStatementItems(toTenantContext(auth), statement.id),
    computeStatementAggregates(
      toTenantContext(auth),
      clientId,
      statement.periodStart,
      statement.periodEnd,
    ),
  ]);

  const buffer = await renderToBuffer(
    <StatementPdf
      data={buildStatementPdfPayload({
        agencyName: statement.client.agency.name,
        brandAccentColor: statement.client.agency.brandAccentColor,
        clientName: statement.client.name,
        currency: statement.currency,
        periodStart: statement.periodStart,
        periodEnd: statement.periodEnd,
        generatedAt: statement.generatedAt,
        generatedByMember: statement.generatedByMember,
        totals: {
          episodeCount: liveTotals.episodeCount,
          outputCount: liveTotals.outputCount,
          approvedCount: liveTotals.approvedCount,
          approvalRatePct: liveTotals.approvalRatePct,
        },
        items,
        breakdown,
      })}
    />,
  );

  const filename = `${slugify(client.name)}-statement-${dateOnly(statement.periodStart)}_${dateOnly(statement.periodEnd)}.pdf`;

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

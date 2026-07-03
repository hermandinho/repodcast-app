import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { MemberRole } from "@prisma/client";
import { requireAuthContext } from "@/server/auth/context";
import { ForbiddenError, NotFoundError } from "@/server/auth/errors";
import { toTenantContext } from "@/server/auth/tenant";
import { prisma } from "@/server/db/client";
import {
  computeStatementPlatformBreakdown,
  getClientStatementForPdf,
} from "@/server/db/client-statements";
import { isLiveDb } from "@/server/data/source";
import { StatementPdf } from "@/components/statements/statement-pdf";

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

function formatUsd(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(cents / 100);
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

  const breakdown = await computeStatementPlatformBreakdown({
    clientId,
    agencyId: auth.agency.id,
    periodStart: statement.periodStart,
    periodEnd: statement.periodEnd,
  });

  const generatedByLabel = statement.generatedByMember
    ? statement.generatedByMember.name?.trim() || statement.generatedByMember.email
    : "system";

  const buffer = await renderToBuffer(
    <StatementPdf
      data={{
        agencyName: statement.client.agency.name,
        brandAccentColor: statement.client.agency.brandAccentColor,
        clientName: statement.client.name,
        periodStartIso: statement.periodStart.toISOString(),
        periodEndIso: statement.periodEnd.toISOString(),
        generatedAtIso: statement.generatedAt.toISOString(),
        generatedByLabel,
        totals: {
          episodeCount: statement.episodeCount,
          outputCount: statement.outputCount,
          approvedCount: statement.approvedCount,
          approvalRatePct: statement.approvalRatePct,
          costUsd: formatUsd(statement.costCents),
        },
        breakdown,
      }}
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

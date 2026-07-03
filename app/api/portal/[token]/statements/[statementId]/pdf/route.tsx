import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import {
  computeStatementPlatformBreakdown,
  getSharedStatementForPortalPdf,
} from "@/server/db/client-statements";
import { getPortalLinkByToken } from "@/server/db/client-portal";
import { isLiveDb } from "@/server/data/source";
import { StatementPdf } from "@/components/statements/statement-pdf";

/**
 * Phase 3.8 — client-portal PDF export.
 *
 * Auth is the token in the URL — validated the same way as `/portal/[token]`
 * (missing / revoked / expired → 404). Statement must also be explicitly
 * shared (`sharedWithPortalAt IS NOT NULL`) AND belong to the portal's
 * client; both conditions live in `getSharedStatementForPortalPdf`, so a
 * mis-scoped statementId collapses to null and 404s here.
 *
 * No signal exfiltration: every failure path — bad token, unshared
 * statement, cross-tenant id — returns the same 404. The client shouldn't
 * be able to probe for existence.
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
  { params }: { params: Promise<{ token: string; statementId: string }> },
) {
  const { token, statementId } = await params;

  if (!isLiveDb()) {
    return NextResponse.json({ error: "Portal disabled in sample-data mode." }, { status: 404 });
  }

  const link = await getPortalLinkByToken(token);
  if (!link) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const statement = await getSharedStatementForPortalPdf(link.clientId, statementId);
  if (!statement) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const breakdown = await computeStatementPlatformBreakdown({
    clientId: link.clientId,
    agencyId: statement.client.agency.id,
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

  const filename = `${slugify(statement.client.name)}-statement-${dateOnly(statement.periodStart)}_${dateOnly(statement.periodEnd)}.pdf`;

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { OutputStatus } from "@prisma/client";
import {
  computeStatementPlatformBreakdown,
  getSharedStatementForPortalPdf,
} from "@/server/db/client-statements";
import { prisma } from "@/server/db/client";
import { getPortalLinkByToken } from "@/server/db/client-portal";
import { isLiveDb } from "@/server/data/source";
import { StatementPdf } from "@/components/statements/statement-pdf";
import { buildStatementPdfPayload } from "@/server/statements/pdf-payload";

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

  // Live delivery counts on the portal PDF, matching the agency PDF —
  // avoids pre-fix rows shipping to the client with `approvedCount = 0`.
  // Portal-side query (no `TenantContext`): the token IS the auth check,
  // validated above; the queries scope to `link.clientId` explicitly.
  const outputWindow = {
    supersededAt: null,
    episode: {
      show: {
        client: { id: link.clientId, agencyId: statement.client.agency.id },
      },
    },
    createdAt: { gte: statement.periodStart, lte: statement.periodEnd },
  } as const;

  const [breakdown, items, episodeCount, outputCount, approvedCount, eligibleForApproval] =
    await Promise.all([
      computeStatementPlatformBreakdown({
        clientId: link.clientId,
        agencyId: statement.client.agency.id,
        periodStart: statement.periodStart,
        periodEnd: statement.periodEnd,
      }),
      prisma.clientStatementItem.findMany({
        where: { statementId: statement.id },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      }),
      prisma.episode.count({
        where: {
          show: {
            client: { id: link.clientId, agencyId: statement.client.agency.id },
          },
          createdAt: { gte: statement.periodStart, lte: statement.periodEnd },
        },
      }),
      prisma.generatedOutput.count({ where: outputWindow }),
      prisma.generatedOutput.count({
        where: {
          ...outputWindow,
          status: {
            in: [OutputStatus.APPROVED, OutputStatus.SCHEDULED, OutputStatus.PUBLISHED],
          },
        },
      }),
      prisma.generatedOutput.count({
        where: {
          ...outputWindow,
          status: {
            in: [
              OutputStatus.APPROVED,
              OutputStatus.SCHEDULED,
              OutputStatus.PUBLISHED,
              OutputStatus.READY,
              OutputStatus.IN_REVIEW,
              OutputStatus.AWAITING_CLIENT_APPROVAL,
            ],
          },
        },
      }),
    ]);
  const approvalRatePct =
    eligibleForApproval === 0 ? 0 : Math.round((approvedCount / eligibleForApproval) * 100);

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
          episodeCount,
          outputCount,
          approvedCount,
          approvalRatePct,
        },
        items,
        breakdown,
      })}
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

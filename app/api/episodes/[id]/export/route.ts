import { OutputStatus } from "@prisma/client";
import { requireAuthContext } from "@/server/auth/context";
import { ForbiddenError, NotFoundError } from "@/server/auth/errors";
import { toTenantContext } from "@/server/auth/tenant";
import { isLiveDb } from "@/server/data/source";
import { prisma } from "@/server/db/client";
import { getEpisode } from "@/server/db/episodes";
import {
  exportFilenameFor,
  renderBrandedExport,
  type BrandedExportData,
} from "@/lib/branded-export";

/**
 * Branded HTML export for one episode.
 *
 * GET /api/episodes/[id]/export — agency-only, tenant-scoped via
 * `getEpisode(ctx, id)` (404 on cross-tenant id). Returns a single
 * self-contained HTML document — no external CSS, only the agency
 * logo URL is fetched at render time by the receiving browser. The
 * receiving client can open it, forward it, or print to PDF.
 *
 * We deliberately don't render PDF server-side — Puppeteer / Playwright
 * is too heavy a dependency to drag in for one route, and modern
 * browsers all expose "Save as PDF" from the print dialog. The CSS
 * `@media print` block tightens the layout for that path.
 *
 * Sample-data mode returns 503; live mode is the only meaningful path.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  if (!isLiveDb()) {
    return new Response("Live database not configured", { status: 503 });
  }

  const auth = await requireAuthContext();
  const ctx = toTenantContext(auth);

  try {
    await getEpisode(ctx, id);
  } catch (err) {
    if (err instanceof NotFoundError) return new Response("Not found", { status: 404 });
    if (err instanceof ForbiddenError) return new Response("Forbidden", { status: 403 });
    throw err;
  }

  // Fetch everything the renderer needs in one round-trip. Approved
  // outputs only (current version) — the export is a delivery receipt,
  // not a draft archive.
  const episode = await prisma.episode.findFirst({
    where: { id, show: { client: { agencyId: auth.agency.id } } },
    include: {
      show: { select: { name: true, host: true } },
      outputs: {
        where: { status: OutputStatus.APPROVED, supersededAt: null },
        orderBy: { approvedAt: "desc" },
        select: { platform: true, content: true, approvedAt: true },
      },
    },
  });
  if (!episode) return new Response("Not found", { status: 404 });

  const agency = await prisma.agency.findUnique({
    where: { id: auth.agency.id },
    select: { name: true, brandLogoUrl: true, brandAccentColor: true },
  });
  if (!agency) return new Response("Agency not found", { status: 404 });

  const data: BrandedExportData = {
    episodeTitle: episode.title,
    showName: episode.show.name,
    hostName: episode.show.host,
    recordedAt: episode.recordedAt,
    agencyName: agency.name,
    brandLogoUrl: agency.brandLogoUrl,
    brandAccentColor: agency.brandAccentColor,
    outputs: episode.outputs,
  };

  const html = renderBrandedExport(data);
  const filename = exportFilenameFor(episode.title);

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

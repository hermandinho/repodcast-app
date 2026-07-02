import { ExternalScheduler, OutputStatus } from "@prisma/client";
import { prisma } from "@/server/db/client";
import {
  getBufferIntegrationForAgencyRaw,
  makeBufferAuthRefresher,
  stampIntegrationSync,
} from "@/server/db/integrations";
import { listInFlightScheduledOutputs } from "@/server/db/outputs";
import { listRecentPostsForOrg } from "@/server/integrations/buffer";
import { inngest } from "../client";

/**
 * Phase 3.3 — every 5 minutes, walk the SCHEDULED backlog and reconcile
 * with the provider:
 *
 *   1. BUFFER-backed rows: call `GET /updates/{id}.json`; if Buffer reports
 *      `sent`, flip status → PUBLISHED and stamp `publishedAt` from Buffer's
 *      own `sent_at`. `buffer` (still-pending) → skip. `failed` → flip to
 *      FAILED (so the calendar shows the miss) and stash the reason for
 *      the surface. Missing agency integration = downgrade to MANUAL.
 *   2. MANUAL rows past `scheduledFor` on an agency with `autoMarkPublished`
 *      → flip to PUBLISHED (assumption: user posted at the scheduled time).
 *      Agencies who dispute this can disable the flag in settings.
 *
 * Skipped: rows created less than 60 s ago — Buffer's `buffer` state is
 * expected in that window and we don't want to churn the API before the
 * first sync could plausibly complete.
 */

/** Skip Buffer polls for rows younger than this — Buffer needs a beat. */
const MIN_AGE_BEFORE_POLL_MS = 60 * 1000;

export const syncScheduledOutputs = inngest.createFunction(
  {
    id: "sync-scheduled-outputs",
    triggers: [{ cron: "*/5 * * * *" }],
    retries: 1,
  },
  async ({ step }) => {
    const rows = await listInFlightScheduledOutputs(500);
    const now = new Date();

    let bufferConfirmed = 0;
    let bufferSkipped = 0;
    let bufferFailed = 0;
    let bufferDowngraded = 0;
    let manualAutoPublished = 0;
    let errors = 0;

    // Group Buffer rows by agency so we only decrypt each integration once.
    const bufferByAgency = new Map<string, typeof rows>();
    const manualRows: typeof rows = [];
    for (const row of rows) {
      if (row.externalScheduler === ExternalScheduler.BUFFER) {
        const list = bufferByAgency.get(row.agencyId) ?? [];
        list.push(row);
        bufferByAgency.set(row.agencyId, list);
      } else if (row.externalScheduler === ExternalScheduler.MANUAL) {
        manualRows.push(row);
      }
    }

    // ---- Buffer pass ---------------------------------------------------
    // Strategy: Buffer's GraphQL surface doesn't expose a single-post-by-id
    // query, so we batch-fetch recent posts per (agency × org × channel)
    // and match client-side. One `listRecentPostsForOrg` call covers every
    // in-flight row on that org, which keeps API traffic bounded.
    for (const [agencyId, agencyRows] of bufferByAgency) {
      await step.run(`buffer-agency-${agencyId}`, async () => {
        const integration = await getBufferIntegrationForAgencyRaw(agencyId);
        if (!integration) {
          const ids = agencyRows.map((r) => r.id);
          const res = await prisma.generatedOutput.updateMany({
            where: { id: { in: ids } },
            data: { externalScheduler: ExternalScheduler.MANUAL },
          });
          bufferDowngraded += res.count;
          return { downgraded: res.count };
        }

        // Group in-flight rows by their originating Buffer organization so
        // we can do one recent-posts query per org.
        const rowsByOrg = new Map<string, typeof agencyRows>();
        const noOrgRows: typeof agencyRows = [];
        for (const row of agencyRows) {
          if (!row.externalPostId) {
            // No provider id — treat as MANUAL going forward.
            noOrgRows.push(row);
            continue;
          }
          // channelToOrg was populated at connect time; if we can't resolve
          // the org, the row was scheduled before the meta migration or the
          // channel was deleted — downgrade.
          const channelForRow = row.externalPostId; // fallback lookup key; real key is channelId
          // We stored the channel that owned each post via the schedule
          // action's meta lookup. Since we only kept `profiles: Platform →
          // channelId`, walk the map to find which channel powers this
          // platform.
          const platformChannelId = integration.meta.profiles[row.platform];
          const orgId = platformChannelId
            ? integration.meta.channelToOrg[platformChannelId]
            : undefined;
          void channelForRow;
          if (!orgId) {
            noOrgRows.push(row);
            continue;
          }
          const list = rowsByOrg.get(orgId) ?? [];
          list.push(row);
          rowsByOrg.set(orgId, list);
        }

        if (noOrgRows.length > 0) {
          const res = await prisma.generatedOutput.updateMany({
            where: { id: { in: noOrgRows.map((r) => r.id) } },
            data: { externalScheduler: ExternalScheduler.MANUAL },
          });
          bufferDowngraded += res.count;
        }

        for (const [orgId, orgRows] of rowsByOrg) {
          const channelIds = Array.from(
            new Set(
              orgRows.flatMap((r) => {
                const chId = integration.meta.profiles[r.platform];
                return chId ? [chId] : [];
              }),
            ),
          );
          let recentPosts;
          try {
            recentPosts = await listRecentPostsForOrg(
              {
                accessToken: integration.accessToken,
                organizationId: orgId,
                channelIds: channelIds.length > 0 ? channelIds : undefined,
                first: 100,
              },
              makeBufferAuthRefresher(agencyId),
            );
          } catch (err) {
            errors += 1;
            console.error(`sync-scheduled-outputs: Buffer poll failed for org ${orgId}`, err);
            continue;
          }
          const byId = new Map(recentPosts.map((p) => [p.id, p]));

          for (const row of orgRows) {
            if (now.getTime() - row.createdAt.getTime() < MIN_AGE_BEFORE_POLL_MS) {
              bufferSkipped += 1;
              continue;
            }
            const match = row.externalPostId ? byId.get(row.externalPostId) : undefined;
            if (!match) {
              // Post wasn't in the recent window — could be still pending
              // OR already gone. Skip; next cron pass will pick it up.
              bufferSkipped += 1;
              continue;
            }
            const status = match.status.toLowerCase();
            if (status === "sent" || status === "success") {
              await prisma.$transaction([
                prisma.generatedOutput.update({
                  where: { id: row.id },
                  data: {
                    status: OutputStatus.PUBLISHED,
                    publishedAt: match.sentAt ?? new Date(),
                    externalPostUrl: match.externalLink ?? undefined,
                  },
                }),
                prisma.outputTransition.create({
                  data: {
                    agencyId: row.agencyId,
                    outputId: row.id,
                    fromStatus: OutputStatus.SCHEDULED,
                    toStatus: OutputStatus.PUBLISHED,
                    byMemberId: null,
                    note: "Buffer confirmed delivery",
                  },
                }),
              ]);
              bufferConfirmed += 1;
            } else if (status === "error" || status === "failed") {
              await prisma.$transaction([
                prisma.generatedOutput.update({
                  where: { id: row.id },
                  data: { status: OutputStatus.FAILED },
                }),
                prisma.outputTransition.create({
                  data: {
                    agencyId: row.agencyId,
                    outputId: row.id,
                    fromStatus: OutputStatus.SCHEDULED,
                    toStatus: OutputStatus.FAILED,
                    byMemberId: null,
                    note: "Buffer reported delivery failure",
                  },
                }),
              ]);
              bufferFailed += 1;
            } else {
              bufferSkipped += 1;
            }
          }
        }
        await stampIntegrationSync(agencyId, ExternalScheduler.BUFFER, null);
      });
    }

    // ---- MANUAL pass --------------------------------------------------
    // Only auto-publish past rows on agencies with `autoMarkPublished = true`.
    // Load the flag per agency once.
    const manualAgencyIds = [...new Set(manualRows.map((r) => r.agencyId))];
    const autoFlags = manualAgencyIds.length
      ? await prisma.agencyIntegration.findMany({
          where: { agencyId: { in: manualAgencyIds }, provider: ExternalScheduler.BUFFER },
          select: { agencyId: true, autoMarkPublished: true },
        })
      : [];
    const autoFlagByAgency = new Map(autoFlags.map((f) => [f.agencyId, f.autoMarkPublished]));

    for (const row of manualRows) {
      if (row.scheduledFor.getTime() > now.getTime()) continue;
      // Default: auto-publish. If the agency has a Buffer integration row
      // with the flag explicitly OFF, respect that. Agencies without any
      // integration row get the default-on behavior.
      const auto = autoFlagByAgency.get(row.agencyId) ?? true;
      if (!auto) continue;
      try {
        await prisma.$transaction([
          prisma.generatedOutput.update({
            where: { id: row.id },
            data: { status: OutputStatus.PUBLISHED, publishedAt: row.scheduledFor },
          }),
          prisma.outputTransition.create({
            data: {
              agencyId: row.agencyId,
              outputId: row.id,
              fromStatus: OutputStatus.SCHEDULED,
              toStatus: OutputStatus.PUBLISHED,
              byMemberId: null,
              note: "Auto-marked published — scheduledFor passed",
            },
          }),
        ]);
        manualAutoPublished += 1;
      } catch (err) {
        errors += 1;
        console.error(`sync-scheduled-outputs: MANUAL auto-publish failed for ${row.id}`, err);
      }
    }

    return {
      scanned: rows.length,
      bufferConfirmed,
      bufferSkipped,
      bufferFailed,
      bufferDowngraded,
      manualAutoPublished,
      errors,
    };
  },
);

import { ClientStatus, MemberRole } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { sendClientRenewalReminderEmail } from "@/server/email/send";
import { inngest } from "../client";

/**
 * Daily renewals cron.
 *
 * Scans every active agency's `ClientBillingProfile` rows and fires the
 * renewal-reminder email at two pre-renewal markers: 30 days out and 7
 * days out. Each (client × marker) ping is deduped via the
 * `BillingReminderSent` table (composite unique on `(clientId, marker)`),
 * so this can safely run daily without re-firing.
 *
 * Schedule: 14:00 UTC — mid-morning Pacific, late afternoon EU. Tuned to
 * land in agency inboxes while the workday is still open.
 *
 * Skipped: agencies that have flipped `renewalRemindersEnabled = false`
 * on their `/settings/agency` mute toggle.
 */

const PRE_RENEWAL_MARKERS = [
  { marker: "30d" as const, days: 30 },
  { marker: "7d" as const, days: 7 },
];

/**
 * Exported for testing — given a renewal date + a marker (in days), return
 * the inclusive [windowStart, windowEnd) bracket the cron uses to decide
 * "is this renewal currently inside the marker's window?"
 *
 * Window is one day wide so a daily cron firing at the same UTC hour lands
 * exactly once per marker (the dedupe table handles the edge case where
 * the cron skips a day and the renewal advances past the window).
 */
export function markerWindow(now: Date, days: number): { start: Date; end: Date } {
  // Renewal-date math is calendar-day, so normalize `now` to UTC midnight
  // and the bracket to a 1-day slot.
  const dayStart = new Date(now);
  dayStart.setUTCHours(0, 0, 0, 0);
  const start = new Date(dayStart);
  start.setUTCDate(dayStart.getUTCDate() + days);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 1);
  return { start, end };
}

/** Pure helper — kept exported for unit tests. */
export function daysBetween(now: Date, target: Date): number {
  const ms = target.getTime() - now.getTime();
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

const APP_BASE_URL =
  process.env.NEXT_PUBLIC_APP_URL ??
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

export const checkRenewals = inngest.createFunction(
  {
    id: "check-renewals",
    triggers: [{ cron: "0 14 * * *" }], // "0 14 * * *" (14:00 UTC, mid-morning Pacific)
    retries: 3,
  },
  async ({ step }) => {
    const now = new Date();
    let totalSent = 0;
    let totalSkipped = 0;

    for (const { marker, days } of PRE_RENEWAL_MARKERS) {
      const { start, end } = markerWindow(now, days);

      // Read-only fetches happen OUTSIDE `step.run` so on retry they
      // re-execute against the current DB state — and we sidestep the
      // JSONify-of-Date round-trip Inngest does to `step.run` return
      // values (the renewal date would come back as a string).
      const profiles = await prisma.clientBillingProfile.findMany({
        where: {
          status: ClientStatus.ACTIVE,
          contractRenewalDate: { gte: start, lt: end },
          client: {
            agency: { renewalRemindersEnabled: true },
          },
        },
        include: {
          client: {
            select: {
              id: true,
              name: true,
              agencyId: true,
              agency: { select: { name: true } },
            },
          },
        },
      });

      for (const profile of profiles) {
        // Idempotency: try to claim the (clientId, marker) slot. If a row
        // already exists the unique constraint trips → skip this profile.
        const claimed = await step.run(`claim-reminder-${marker}-${profile.clientId}`, async () => {
          try {
            await prisma.billingReminderSent.create({
              data: {
                agencyId: profile.client.agencyId,
                clientId: profile.clientId,
                marker,
              },
            });
            return true;
          } catch (err) {
            // Prisma P2002 — already sent this marker for this client.
            if (
              err &&
              typeof err === "object" &&
              "code" in err &&
              (err as { code: string }).code === "P2002"
            ) {
              return false;
            }
            throw err;
          }
        });

        if (!claimed) {
          totalSkipped += 1;
          continue;
        }

        // Recipients: every OWNER + ADMIN on the agency with a real email
        // (the @clerk.local synthetic addresses don't deliver). Read
        // outside step.run for the same reason as above.
        const recipients = await prisma.member.findMany({
          where: {
            agencyId: profile.client.agencyId,
            role: { in: [MemberRole.OWNER, MemberRole.ADMIN] },
            NOT: { email: { endsWith: "@clerk.local" } },
          },
          select: { email: true },
        });
        if (recipients.length === 0) {
          // No deliverable recipient — release the claim so a future run
          // (after the agency adds an Admin) can re-attempt.
          await step.run(`release-claim-${marker}-${profile.clientId}`, () =>
            prisma.billingReminderSent.deleteMany({
              where: { clientId: profile.clientId, marker },
            }),
          );
          continue;
        }

        const renewalDate = profile.contractRenewalDate!;
        const daysToRenewal = daysBetween(now, renewalDate);
        const billingUrl = `${APP_BASE_URL}/clients/${profile.clientId}/billing`;
        const renewalDateLabel = new Intl.DateTimeFormat("en-US", {
          month: "long",
          day: "numeric",
          year: "numeric",
          timeZone: "UTC",
        }).format(renewalDate);

        // Send all-at-once via the to-many path (Resend handles the fanout).
        // Wrap in step.run so a Resend hiccup doesn't blow up the whole
        // cron run — retries are memoized per profile.
        await step.run(`send-${marker}-${profile.clientId}`, () =>
          sendClientRenewalReminderEmail(
            recipients.map((r) => r.email),
            {
              agencyName: profile.client.agency.name,
              clientName: profile.client.name,
              marker,
              daysToRenewal,
              renewalDateLabel,
              billingUrl,
            },
          ),
        );
        totalSent += 1;
      }
    }

    return {
      sent: totalSent,
      skipped: totalSkipped,
      ranAt: now.toISOString(),
    };
  },
);

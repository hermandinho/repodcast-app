import { MemberRole, TrialStatus } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { sendTrialDay2Email } from "@/server/email/send";
import { TRIAL_DAYS } from "@/lib/plans";
import { inngest } from "../client";

/**
 * Daily mid-trial nudge cron.
 *
 * One marker today: `day_2` — the portal-preview email that fires ~2 days
 * into a `TRIAL_DAYS`-day trial. Day 0 (welcome) is event-driven off the
 * Stripe webhook, T-3 (`day_4` on a 7-day trial) is event-driven off
 * `customer.subscription.trial_will_end`, and day-end outcomes are
 * event-driven off `subscription.updated` / `subscription.deleted`. So this
 * cron only owns the mid-trial email.
 *
 * Window filter: pick agencies whose trial *ends* between `TRIAL_DAYS-2 - 0.5`
 * days and `TRIAL_DAYS-2 + 0.5` days from now — i.e. they're ~2 days into
 * the trial. Idempotency lives in `TrialNudgeSent`, so a missed cron run or
 * a double-fire both resolve to exactly-one delivery.
 *
 * Schedule: daily at 15:00 UTC (mid-day EU, morning US) — a "good time to
 * see an email" without a live cron dedupe layer. Same claim-then-send
 * pattern as `check-onboarding-nudges.ts`.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const HALF_DAY_MS = 12 * 60 * 60 * 1000;
const APP_BASE_URL =
  process.env.NEXT_PUBLIC_APP_URL ??
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

/**
 * Exported for testing. Given a `now`, returns the `[start, end)` bracket
 * of `trialEndsAt` values that fall inside the "~2 days into a
 * `TRIAL_DAYS`-day trial" window. The window is 1 day wide (±½ day around
 * the center) so a daily cron fire lands the email once with room for
 * clock skew.
 */
export function day2Window(now: Date): { start: Date; end: Date } {
  // "2 days in" = trial has `TRIAL_DAYS - 2` days remaining.
  const daysRemainingCenter = TRIAL_DAYS - 2;
  const center = now.getTime() + daysRemainingCenter * DAY_MS;
  return { start: new Date(center - HALF_DAY_MS), end: new Date(center + HALF_DAY_MS) };
}

export const checkTrialNudges = inngest.createFunction(
  {
    id: "check-trial-nudges",
    triggers: [{ cron: "0 15 * * *" }], // daily at 15:00 UTC
    retries: 3,
  },
  async ({ step }) => {
    const now = new Date();
    let sent = 0;
    let skipped = 0;

    const { start, end } = day2Window(now);

    // Read fresh outside step.run so retries see current DB state. `TrialStatus`
    // ACTIVE is the only status this email applies to — CONVERTED / EXPIRED /
    // CANCELED all mean the trial is no longer running.
    const agencies = await prisma.agency.findMany({
      where: {
        trialStatus: TrialStatus.ACTIVE,
        trialEndsAt: { gte: start, lt: end },
      },
      select: { id: true, name: true },
    });

    for (const agency of agencies) {
      const claimed = await step.run(`claim-day_2-${agency.id}`, async () => {
        try {
          await prisma.trialNudgeSent.create({
            data: { agencyId: agency.id, marker: "day_2" },
          });
          return true;
        } catch (err) {
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
        skipped += 1;
        continue;
      }

      // Recipient: founding OWNER, same convention as the onboarding nudges.
      const owner = await prisma.member.findFirst({
        where: {
          agencyId: agency.id,
          role: MemberRole.OWNER,
          NOT: { email: { endsWith: "@clerk.local" } },
        },
        orderBy: { createdAt: "asc" },
        select: { email: true, name: true },
      });

      if (!owner) {
        await step.run(`release-day_2-${agency.id}`, () =>
          prisma.trialNudgeSent.deleteMany({
            where: { agencyId: agency.id, marker: "day_2" },
          }),
        );
        continue;
      }

      // Count outputs generated for this trial so the copy can lean on
      // real activity. Scoped to this agency via the show → client join;
      // superseded rows excluded so we count what the user actually sees.
      const outputCount = await prisma.generatedOutput.count({
        where: {
          supersededAt: null,
          episode: { show: { client: { agencyId: agency.id } } },
        },
      });

      const firstName = owner.name?.split(" ")[0]?.trim() || "there";

      await step.run(`send-day_2-${agency.id}`, () =>
        sendTrialDay2Email(owner.email, {
          firstName,
          agencyName: agency.name,
          outputCount,
        }),
      );
      sent += 1;
    }

    return { sent, skipped, appBaseUrl: APP_BASE_URL, ranAt: now.toISOString() };
  },
);

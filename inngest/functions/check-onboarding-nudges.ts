import { MemberRole, OnboardingStep } from "@prisma/client";
import { prisma } from "@/server/db/client";
import {
  sendOnboardingFinishSetupEmail,
  sendOnboardingFirstClientEmail,
} from "@/server/email/send";
import { inngest } from "../client";

/**
 * Phase 2.10 — hourly onboarding drop-off-recovery cron.
 *
 * Two markers:
 *  - `24h` — Agency created ~24h ago and the founding OWNER hasn't finished
 *           the wizard (`onboardingStep !== DONE`). Sends "finish setup" with
 *           a deep link back to `/onboarding` (the resume gate routes to the
 *           exact step they bailed on).
 *  - `72h` — Agency created ~72h ago and still has zero `Client` rows. Sends
 *           "your first client is waiting" with a CTA to `/clients`.
 *
 * Both markers can fire for the same agency by design (a user who bails at
 * step 2 gets the 24h "finish setup" *and* the 72h "first client" nudge —
 * they're escalating reminders, not a single funnel).
 *
 * Schedule: hourly. Each marker's window is exactly 1h wide so a successful
 * run lands the email exactly once per (agency, marker). `OnboardingNudgeSent`
 * gives us belt-and-suspenders idempotency across cron retries + the
 * window-slip edge case where the cron skips an hour.
 *
 * Same claim-then-send pattern as `check-renewals.ts`: try to insert the
 * dedupe row first; on P2002 (already sent) skip; release the claim if no
 * deliverable recipient so a future run can re-attempt once a real email is
 * on file.
 */

const MARKERS = [
  { marker: "24h" as const, hours: 24 },
  { marker: "72h" as const, hours: 72 },
];

const APP_BASE_URL =
  process.env.NEXT_PUBLIC_APP_URL ??
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

/**
 * Exported for testing — given a marker (in hours) + a `now`, return the
 * [windowStart, windowEnd) bracket the cron uses to decide "was this agency
 * created inside this marker's hour-wide window?".
 *
 * Window is `now - (hours + 1)` ≤ createdAt < `now - hours`, so:
 *  - At an hourly fire 24h after a 14:00 signup, a 14:00→15:00 window catches it.
 *  - One missed hourly fire still lets the next run catch it (window slides
 *    forward by 1h, but the dedupe table is the real idempotency guard).
 */
export function markerWindow(now: Date, hours: number): { start: Date; end: Date } {
  const end = new Date(now.getTime() - hours * 60 * 60 * 1000);
  const start = new Date(end.getTime() - 60 * 60 * 1000);
  return { start, end };
}

export const checkOnboardingNudges = inngest.createFunction(
  {
    id: "check-onboarding-nudges",
    triggers: [{ cron: "0 * * * *" }], // top of every hour
    retries: 3,
  },
  async ({ step }) => {
    const now = new Date();
    let totalSent = 0;
    let totalSkipped = 0;

    for (const { marker, hours } of MARKERS) {
      const { start, end } = markerWindow(now, hours);

      // Read agencies outside step.run so retries see fresh DB state and we
      // avoid Inngest's JSON serialization of Date columns. Filter:
      //  - createdAt in the marker's hour-wide window
      //  - onboarding not finished (the 24h email is moot for a finished user)
      //  - for 72h: also gate on "no clients yet"
      const agencies = await prisma.agency.findMany({
        where: {
          createdAt: { gte: start, lt: end },
          onboardingStep: { not: OnboardingStep.DONE },
          ...(marker === "72h" ? { clients: { none: {} } } : {}),
        },
        select: { id: true, name: true, onboardingStep: true },
      });

      for (const agency of agencies) {
        // Claim the (agencyId, marker) slot. Already-sent → skip silently.
        const claimed = await step.run(`claim-${marker}-${agency.id}`, async () => {
          try {
            await prisma.onboardingNudgeSent.create({
              data: { agencyId: agency.id, marker },
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
          totalSkipped += 1;
          continue;
        }

        // Recipient: the founding OWNER (oldest OWNER row by createdAt — the
        // member created alongside the agency in `createAgencyForUser`). Skip
        // synthetic Clerk addresses since they don't deliver.
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
          // No deliverable OWNER — release the claim so a future run (once a
          // real email is wired up) can re-attempt this marker.
          await step.run(`release-${marker}-${agency.id}`, () =>
            prisma.onboardingNudgeSent.deleteMany({
              where: { agencyId: agency.id, marker },
            }),
          );
          continue;
        }

        const firstName = owner.name?.split(" ")[0]?.trim() || "there";

        await step.run(`send-${marker}-${agency.id}`, () => {
          if (marker === "24h") {
            return sendOnboardingFinishSetupEmail(owner.email, {
              firstName,
              agencyName: agency.name,
              resumeUrl: `${APP_BASE_URL}/onboarding`,
            });
          }
          return sendOnboardingFirstClientEmail(owner.email, {
            firstName,
            agencyName: agency.name,
            newClientUrl: `${APP_BASE_URL}/clients`,
          });
        });
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

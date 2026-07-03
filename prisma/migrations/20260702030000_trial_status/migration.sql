-- Phase 3.9 — trial lifecycle columns on Agency.
--
-- Backs the card-required 14-day free-trial flow. The Stripe webhook writes
-- both columns on `syncSubscription`:
--   - `trialEndsAt` mirrors `subscription.trial_end` (unix → DateTime).
--   - `trialStatus` mirrors the subscription's lifecycle: `trialing` → ACTIVE,
--     first successful invoice → CONVERTED, payment_failed at trial end →
--     EXPIRED, user-initiated cancel while trialing → CANCELED.
--
-- Default `NONE` on backfill so legacy agencies that pre-date the trial flow
-- (and any future paid-first flow) render without a trial banner. The
-- `(trialStatus, trialEndsAt)` composite index powers the "trial ending soon"
-- cron scan and the ROOT "On trial" filter without needing a full-table sweep.

CREATE TYPE "TrialStatus" AS ENUM ('NONE', 'ACTIVE', 'CONVERTED', 'EXPIRED', 'CANCELED');

ALTER TABLE "Agency"
  ADD COLUMN "trialEndsAt" TIMESTAMP(3),
  ADD COLUMN "trialStatus" "TrialStatus" NOT NULL DEFAULT 'NONE';

CREATE INDEX "Agency_trialStatus_trialEndsAt_idx" ON "Agency"("trialStatus", "trialEndsAt");

-- Phase 3.9 — dedupe ledger for the mid-trial nudge cron.
--
-- Presence of a row means "we already sent the (agencyId, marker) email".
-- The Inngest cron claims before send with a CREATE; a duplicate collapses
-- on the unique constraint and the run short-circuits. Same shape as
-- `OnboardingNudgeSent` — kept separate so the two crons never contend
-- for the same row.

CREATE TABLE "TrialNudgeSent" (
  "id" TEXT NOT NULL,
  "agencyId" TEXT NOT NULL,
  "marker" TEXT NOT NULL,
  "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TrialNudgeSent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TrialNudgeSent_agencyId_marker_key"
  ON "TrialNudgeSent"("agencyId", "marker");

CREATE INDEX "TrialNudgeSent_sentAt_idx"
  ON "TrialNudgeSent"("sentAt");

ALTER TABLE "TrialNudgeSent"
  ADD CONSTRAINT "TrialNudgeSent_agencyId_fkey"
  FOREIGN KEY ("agencyId") REFERENCES "Agency"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

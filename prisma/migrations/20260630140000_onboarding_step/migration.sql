-- Phase 2.10 — Onboarding progress restoration + drop-off-recovery dedupe.

-- CreateEnum
CREATE TYPE "OnboardingStep" AS ENUM ('WORKSPACE', 'TEAMMATES', 'CLIENT', 'DONE');

-- AlterTable: existing rows backfill as DONE so they're not pulled into the wizard.
ALTER TABLE "Agency" ADD COLUMN "onboardingStep" "OnboardingStep" NOT NULL DEFAULT 'DONE';

-- CreateTable
CREATE TABLE "OnboardingNudgeSent" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "marker" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OnboardingNudgeSent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OnboardingNudgeSent_agencyId_marker_key" ON "OnboardingNudgeSent"("agencyId", "marker");

-- CreateIndex
CREATE INDEX "OnboardingNudgeSent_sentAt_idx" ON "OnboardingNudgeSent"("sentAt");

-- AddForeignKey
ALTER TABLE "OnboardingNudgeSent" ADD CONSTRAINT "OnboardingNudgeSent_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

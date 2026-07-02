-- Phase 3.3 — Scheduling surface.
--
-- Extends `GeneratedOutput` with the six scheduling columns (scheduledFor,
-- scheduledByMemberId, externalScheduler, externalPostId, externalPostUrl,
-- publishedAt), adds two calendar-hot-path indices, and introduces the
-- `AgencyIntegration` table + `ExternalScheduler` enum for optional
-- per-agency Buffer OAuth.
--
-- All GeneratedOutput additions are nullable — no backfill needed on
-- existing rows (they stay APPROVED / PUBLISHED with the new columns null).

-- CreateEnum
CREATE TYPE "ExternalScheduler" AS ENUM ('BUFFER', 'MANUAL');

-- AlterTable GeneratedOutput
ALTER TABLE "GeneratedOutput" ADD COLUMN "scheduledFor" TIMESTAMP(3);
ALTER TABLE "GeneratedOutput" ADD COLUMN "scheduledByMemberId" TEXT;
ALTER TABLE "GeneratedOutput" ADD COLUMN "externalScheduler" "ExternalScheduler";
ALTER TABLE "GeneratedOutput" ADD COLUMN "externalPostId" TEXT;
ALTER TABLE "GeneratedOutput" ADD COLUMN "externalPostUrl" TEXT;
ALTER TABLE "GeneratedOutput" ADD COLUMN "publishedAt" TIMESTAMP(3);

-- Foreign Key: scheduledByMember → Member (SetNull so member deletion
-- doesn't cascade-wipe the schedule history).
ALTER TABLE "GeneratedOutput" ADD CONSTRAINT "GeneratedOutput_scheduledByMemberId_fkey"
  FOREIGN KEY ("scheduledByMemberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Indices: calendar range query + cron scan on SCHEDULED rows.
CREATE INDEX "GeneratedOutput_scheduledByMemberId_idx" ON "GeneratedOutput"("scheduledByMemberId");
CREATE INDEX "GeneratedOutput_scheduledFor_idx" ON "GeneratedOutput"("scheduledFor");
CREATE INDEX "GeneratedOutput_status_scheduledFor_idx" ON "GeneratedOutput"("status", "scheduledFor");

-- CreateTable AgencyIntegration
CREATE TABLE "AgencyIntegration" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "provider" "ExternalScheduler" NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT,
    "expiresAt" TIMESTAMP(3),
    "meta" JSONB,
    "autoMarkPublished" BOOLEAN NOT NULL DEFAULT true,
    "connectedByMemberId" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "lastSyncError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgencyIntegration_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AgencyIntegration_agencyId_provider_key" ON "AgencyIntegration"("agencyId", "provider");
CREATE INDEX "AgencyIntegration_agencyId_idx" ON "AgencyIntegration"("agencyId");

ALTER TABLE "AgencyIntegration" ADD CONSTRAINT "AgencyIntegration_agencyId_fkey"
  FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AgencyIntegration" ADD CONSTRAINT "AgencyIntegration_connectedByMemberId_fkey"
  FOREIGN KEY ("connectedByMemberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

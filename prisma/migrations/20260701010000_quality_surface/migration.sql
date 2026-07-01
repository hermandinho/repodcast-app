-- Phase 3.6.10 — Quality, abuse, and moderation surface.
--
-- Adds:
--   - Enums AbuseReportCategory + AbuseReportStatus
--   - Table AbuseReport (the triage queue behind /root/quality)
--   - Three nullable moderation columns on GeneratedOutput + an index for the
--     "list all flagged" hot path
--
-- All additions are backwards-compatible: the new AbuseReport table is empty
-- on first deploy, and the GeneratedOutput ALTERs add nullable columns
-- (existing rows land NULL) plus one new index. Safe to run on a live DB
-- with no downtime window.
--
-- FK posture on AbuseReport:
--   - assignedToSystemAdminId → SystemAdmin SET NULL. A soft-deleted admin
--     drops the queue-link automatically; the report itself survives.
--   - targetAgencyId / targetMemberId / targetOutputId → NO FK. Deliberate.
--     Mirrors the SystemAuditLog pattern so an agency hard-delete doesn't
--     cascade-wipe abuse reports that referenced it.

-- CreateEnum
CREATE TYPE "AbuseReportCategory" AS ENUM ('SPAM', 'COPYRIGHT', 'IMPERSONATION', 'HARASSMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "AbuseReportStatus" AS ENUM ('OPEN', 'IN_REVIEW', 'RESOLVED', 'DISMISSED');

-- CreateTable
CREATE TABLE "AbuseReport" (
    "id" TEXT NOT NULL,
    "reportedByEmail" TEXT,
    "category" "AbuseReportCategory" NOT NULL,
    "body" TEXT NOT NULL,
    "status" "AbuseReportStatus" NOT NULL DEFAULT 'OPEN',
    "targetAgencyId" TEXT,
    "targetMemberId" TEXT,
    "targetOutputId" TEXT,
    "assignedToSystemAdminId" TEXT,
    "resolution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AbuseReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AbuseReport_status_createdAt_idx" ON "AbuseReport"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AbuseReport_assignedToSystemAdminId_status_idx" ON "AbuseReport"("assignedToSystemAdminId", "status");

-- CreateIndex
CREATE INDEX "AbuseReport_targetAgencyId_createdAt_idx" ON "AbuseReport"("targetAgencyId", "createdAt");

-- CreateIndex
CREATE INDEX "AbuseReport_category_status_idx" ON "AbuseReport"("category", "status");

-- AddForeignKey
ALTER TABLE "AbuseReport" ADD CONSTRAINT "AbuseReport_assignedToSystemAdminId_fkey" FOREIGN KEY ("assignedToSystemAdminId") REFERENCES "SystemAdmin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable — moderation columns on GeneratedOutput
ALTER TABLE "GeneratedOutput" ADD COLUMN "flagReason" TEXT;
ALTER TABLE "GeneratedOutput" ADD COLUMN "flaggedByMemberId" TEXT;
ALTER TABLE "GeneratedOutput" ADD COLUMN "flaggedAt" TIMESTAMP(3);

-- CreateIndex — hot path for "list all currently-flagged outputs across every agency"
CREATE INDEX "GeneratedOutput_flaggedAt_idx" ON "GeneratedOutput"("flaggedAt");

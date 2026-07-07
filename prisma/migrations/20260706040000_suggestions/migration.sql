-- In-app suggestions / feedback.
--
-- Adds:
--   - Enums SuggestionType + SuggestionStatus
--   - Table Suggestion (durable inbox behind the tenant Feedback button
--     and the /root/feedback triage queue)
--
-- FK posture:
--   - agencyId → Agency SET NULL. A hard-deleted agency null-outs its
--     historical rows so the ROOT queue survives forever.
--   - memberId → Member SET NULL. Same reasoning; the `reporterEmail`
--     snapshot keeps the row readable after the member is gone.
--   - resolvedBySystemAdminId → SystemAdmin SET NULL. A soft-deleted
--     admin drops the "resolved by" link without losing the row.

-- CreateEnum
CREATE TYPE "SuggestionType" AS ENUM ('BUG', 'FEATURE_REQUEST', 'IMPROVEMENT', 'QUESTION', 'OTHER');

-- CreateEnum
CREATE TYPE "SuggestionStatus" AS ENUM ('NEW', 'TRIAGED', 'PLANNED', 'IN_PROGRESS', 'SHIPPED', 'WONTFIX');

-- CreateTable
CREATE TABLE "Suggestion" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT,
    "memberId" TEXT,
    "reporterEmail" TEXT NOT NULL,
    "reporterName" TEXT,
    "type" "SuggestionType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "SuggestionStatus" NOT NULL DEFAULT 'NEW',
    "contextUrl" TEXT,
    "resolution" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBySystemAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Suggestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Suggestion_status_createdAt_idx" ON "Suggestion"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Suggestion_type_status_idx" ON "Suggestion"("type", "status");

-- CreateIndex
CREATE INDEX "Suggestion_agencyId_createdAt_idx" ON "Suggestion"("agencyId", "createdAt");

-- CreateIndex
CREATE INDEX "Suggestion_resolvedBySystemAdminId_idx" ON "Suggestion"("resolvedBySystemAdminId");

-- AddForeignKey
ALTER TABLE "Suggestion" ADD CONSTRAINT "Suggestion_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Suggestion" ADD CONSTRAINT "Suggestion_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Suggestion" ADD CONSTRAINT "Suggestion_resolvedBySystemAdminId_fkey" FOREIGN KEY ("resolvedBySystemAdminId") REFERENCES "SystemAdmin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

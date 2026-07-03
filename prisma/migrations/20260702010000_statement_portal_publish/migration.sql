-- Phase 3.8 — explicit publish of ClientStatement rows to the client portal.
--
-- `sharedWithPortalAt` gates portal visibility (null = agency-only). The
-- companion `sharedByMemberId` records who published it so the audit trail
-- survives — SetNull matches the pattern used for `generatedByMemberId`,
-- since a portal-published statement should still be visible to the client
-- even if the operator who published it is later removed.

-- AlterTable
ALTER TABLE "ClientStatement"
  ADD COLUMN "sharedWithPortalAt" TIMESTAMP(3),
  ADD COLUMN "sharedByMemberId" TEXT;

-- CreateIndex
CREATE INDEX "ClientStatement_clientId_sharedWithPortalAt_idx" ON "ClientStatement"("clientId", "sharedWithPortalAt" DESC);

-- CreateIndex
CREATE INDEX "ClientStatement_sharedByMemberId_idx" ON "ClientStatement"("sharedByMemberId");

-- AddForeignKey
ALTER TABLE "ClientStatement" ADD CONSTRAINT "ClientStatement_sharedByMemberId_fkey" FOREIGN KEY ("sharedByMemberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

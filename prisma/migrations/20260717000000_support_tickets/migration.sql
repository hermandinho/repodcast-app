-- Public support tickets — /contact form submissions.
--
-- Adds:
--   - Enums SupportTicketCategory + SupportTicketStatus
--   - Table SupportTicket (durable inbox behind the public /contact
--     support form; the ROOT /root/support triage queue is deferred but
--     the indexes are pre-provisioned for it).
--
-- FK posture mirrors Suggestion — agency/member/resolvedBy pointers all
-- SET NULL so a hard-deleted agency, removed member, or soft-deleted
-- admin doesn't cascade-wipe historical tickets. Snapshotted name/email
-- on the row keep it triage-readable in every case.

-- CreateEnum
CREATE TYPE "SupportTicketCategory" AS ENUM ('BUG', 'QUESTION', 'BILLING', 'ACCOUNT', 'FEATURE_REQUEST', 'OTHER');

-- CreateEnum
CREATE TYPE "SupportTicketStatus" AS ENUM ('NEW', 'OPEN', 'WAITING_ON_USER', 'RESOLVED', 'CLOSED');

-- CreateTable
CREATE TABLE "SupportTicket" (
    "id" TEXT NOT NULL,
    "refCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "category" "SupportTicketCategory" NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "SupportTicketStatus" NOT NULL DEFAULT 'NEW',
    "agencyId" TEXT,
    "memberId" TEXT,
    "contextUrl" TEXT,
    "userAgent" TEXT,
    "ipHash" TEXT,
    "resolution" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBySystemAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SupportTicket_refCode_key" ON "SupportTicket"("refCode");

-- CreateIndex
CREATE INDEX "SupportTicket_status_createdAt_idx" ON "SupportTicket"("status", "createdAt");

-- CreateIndex
CREATE INDEX "SupportTicket_category_status_idx" ON "SupportTicket"("category", "status");

-- CreateIndex
CREATE INDEX "SupportTicket_ipHash_createdAt_idx" ON "SupportTicket"("ipHash", "createdAt");

-- CreateIndex
CREATE INDEX "SupportTicket_agencyId_createdAt_idx" ON "SupportTicket"("agencyId", "createdAt");

-- CreateIndex
CREATE INDEX "SupportTicket_resolvedBySystemAdminId_idx" ON "SupportTicket"("resolvedBySystemAdminId");

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_resolvedBySystemAdminId_fkey" FOREIGN KEY ("resolvedBySystemAdminId") REFERENCES "SystemAdmin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

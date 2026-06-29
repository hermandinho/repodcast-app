-- Phase 2.13.1 — Client management & billing support schema.

-- CreateEnum
CREATE TYPE "BillingCycle" AS ENUM ('MONTHLY', 'QUARTERLY', 'ANNUAL', 'PROJECT');

-- CreateEnum
CREATE TYPE "ClientStatus" AS ENUM ('ACTIVE', 'PAUSED', 'CHURNED');

-- AlterTable
ALTER TABLE "Agency" ADD COLUMN "renewalRemindersEnabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "ClientBillingProfile" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "billingContactName" TEXT,
    "billingContactEmail" TEXT,
    "retainerCents" INTEGER,
    "ratePerEpisodeCents" INTEGER,
    "billingCycle" "BillingCycle" NOT NULL DEFAULT 'MONTHLY',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "contractStartDate" TIMESTAMP(3),
    "contractRenewalDate" TIMESTAMP(3),
    "status" "ClientStatus" NOT NULL DEFAULT 'ACTIVE',
    "paymentLinkUrl" TEXT,
    "internalNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientBillingProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClientBillingProfile_clientId_key" ON "ClientBillingProfile"("clientId");

-- CreateIndex
CREATE INDEX "ClientBillingProfile_status_idx" ON "ClientBillingProfile"("status");

-- CreateIndex
CREATE INDEX "ClientBillingProfile_contractRenewalDate_idx" ON "ClientBillingProfile"("contractRenewalDate");

-- AddForeignKey
ALTER TABLE "ClientBillingProfile" ADD CONSTRAINT "ClientBillingProfile_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "ClientStatement" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "episodeCount" INTEGER NOT NULL,
    "outputCount" INTEGER NOT NULL,
    "approvedCount" INTEGER NOT NULL,
    "approvalRatePct" INTEGER NOT NULL,
    "costCents" INTEGER NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "generatedByMemberId" TEXT,
    "pdfStorageKey" TEXT,
    "csvStorageKey" TEXT,
    "webhookDeliveredAt" TIMESTAMP(3),
    "webhookExternalRef" TEXT,

    CONSTRAINT "ClientStatement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClientStatement_clientId_periodStart_idx" ON "ClientStatement"("clientId", "periodStart" DESC);

-- CreateIndex
CREATE INDEX "ClientStatement_clientId_generatedAt_idx" ON "ClientStatement"("clientId", "generatedAt" DESC);

-- CreateIndex
CREATE INDEX "ClientStatement_generatedByMemberId_idx" ON "ClientStatement"("generatedByMemberId");

-- AddForeignKey
ALTER TABLE "ClientStatement" ADD CONSTRAINT "ClientStatement_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientStatement" ADD CONSTRAINT "ClientStatement_generatedByMemberId_fkey" FOREIGN KEY ("generatedByMemberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "ClientPortalLink" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdByMemberId" TEXT,
    "revokedAt" TIMESTAMP(3),
    "lastAccessedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientPortalLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClientPortalLink_token_key" ON "ClientPortalLink"("token");

-- CreateIndex
CREATE INDEX "ClientPortalLink_clientId_expiresAt_idx" ON "ClientPortalLink"("clientId", "expiresAt");

-- CreateIndex
CREATE INDEX "ClientPortalLink_createdByMemberId_idx" ON "ClientPortalLink"("createdByMemberId");

-- AddForeignKey
ALTER TABLE "ClientPortalLink" ADD CONSTRAINT "ClientPortalLink_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientPortalLink" ADD CONSTRAINT "ClientPortalLink_createdByMemberId_fkey" FOREIGN KEY ("createdByMemberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "ClientPortalAccessLog" (
    "id" TEXT NOT NULL,
    "portalLinkId" TEXT NOT NULL,
    "viewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipHash" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "ClientPortalAccessLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClientPortalAccessLog_portalLinkId_viewedAt_idx" ON "ClientPortalAccessLog"("portalLinkId", "viewedAt" DESC);

-- AddForeignKey
ALTER TABLE "ClientPortalAccessLog" ADD CONSTRAINT "ClientPortalAccessLog_portalLinkId_fkey" FOREIGN KEY ("portalLinkId") REFERENCES "ClientPortalLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "BillingReminderSent" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "marker" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingReminderSent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BillingReminderSent_clientId_marker_key" ON "BillingReminderSent"("clientId", "marker");

-- CreateIndex
CREATE INDEX "BillingReminderSent_agencyId_sentAt_idx" ON "BillingReminderSent"("agencyId", "sentAt");

-- AddForeignKey
ALTER TABLE "BillingReminderSent" ADD CONSTRAINT "BillingReminderSent_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingReminderSent" ADD CONSTRAINT "BillingReminderSent_client_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

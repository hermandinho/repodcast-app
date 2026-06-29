-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('STUDIO', 'AGENCY', 'NETWORK');

-- CreateEnum
CREATE TYPE "MemberRole" AS ENUM ('OWNER', 'ADMIN', 'EDITOR', 'REVIEWER');

-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('TWITTER', 'LINKEDIN', 'INSTAGRAM', 'TIKTOK', 'SHOW_NOTES', 'BLOG', 'NEWSLETTER');

-- CreateEnum
CREATE TYPE "EpisodeStatus" AS ENUM ('DRAFT', 'PROCESSING', 'READY', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "OutputStatus" AS ENUM ('GENERATING', 'READY', 'IN_REVIEW', 'APPROVED', 'SCHEDULED', 'PUBLISHED', 'FAILED');

-- CreateEnum
CREATE TYPE "TranscriptSource" AS ENUM ('PASTE', 'UPLOAD', 'RSS', 'YOUTUBE');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'OPEN', 'PAID', 'VOID', 'UNCOLLECTIBLE');

-- CreateEnum
CREATE TYPE "InviteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED');

-- CreateTable
CREATE TABLE "Agency" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "plan" "Plan" NOT NULL DEFAULT 'STUDIO',
    "clerkOrgId" TEXT,
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Agency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Member" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "clerkUserId" TEXT NOT NULL,
    "role" "MemberRole" NOT NULL DEFAULT 'EDITOR',
    "email" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemberInvite" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "MemberRole" NOT NULL DEFAULT 'EDITOR',
    "token" TEXT NOT NULL,
    "status" "InviteStatus" NOT NULL DEFAULT 'PENDING',
    "invitedByMemberId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "acceptedByClerkUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemberInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "contactName" TEXT,
    "contactEmail" TEXT,
    "artworkUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Show" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "description" TEXT,
    "artworkUrl" TEXT,
    "rssUrl" TEXT,
    "voiceDescription" TEXT,
    "globalInstructions" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Show_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShowPlatformInstruction" (
    "id" TEXT NOT NULL,
    "showId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "rule" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShowPlatformInstruction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Episode" (
    "id" TEXT NOT NULL,
    "showId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "transcript" TEXT NOT NULL,
    "source" "TranscriptSource" NOT NULL,
    "audioUrl" TEXT,
    "externalUrl" TEXT,
    "status" "EpisodeStatus" NOT NULL DEFAULT 'DRAFT',
    "recordedAt" TIMESTAMP(3),
    "durationSec" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Episode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeneratedOutput" (
    "id" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "content" TEXT NOT NULL,
    "status" "OutputStatus" NOT NULL DEFAULT 'GENERATING',
    "version" INTEGER NOT NULL DEFAULT 1,
    "quality" INTEGER,
    "lastInstruction" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedByMemberId" TEXT,
    "supersededAt" TIMESTAMP(3),
    "previousVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GeneratedOutput_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutputTransition" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "outputId" TEXT NOT NULL,
    "byMemberId" TEXT,
    "fromStatus" "OutputStatus",
    "toStatus" "OutputStatus" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutputTransition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoiceSample" (
    "id" TEXT NOT NULL,
    "showId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "content" TEXT NOT NULL,
    "generatedOutputId" TEXT,
    "episodeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VoiceSample_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageLog" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "episodeId" TEXT,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "costCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "stripeInvoiceId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "status" "InvoiceStatus" NOT NULL,
    "hostedInvoiceUrl" TEXT,
    "pdfUrl" TEXT,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Agency_clerkOrgId_key" ON "Agency"("clerkOrgId");

-- CreateIndex
CREATE UNIQUE INDEX "Agency_stripeCustomerId_key" ON "Agency"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "Agency_stripeSubscriptionId_key" ON "Agency"("stripeSubscriptionId");

-- CreateIndex
CREATE INDEX "Member_agencyId_idx" ON "Member"("agencyId");

-- CreateIndex
CREATE INDEX "Member_clerkUserId_idx" ON "Member"("clerkUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Member_agencyId_clerkUserId_key" ON "Member"("agencyId", "clerkUserId");

-- CreateIndex
CREATE UNIQUE INDEX "MemberInvite_token_key" ON "MemberInvite"("token");

-- CreateIndex
CREATE INDEX "MemberInvite_agencyId_status_idx" ON "MemberInvite"("agencyId", "status");

-- CreateIndex
CREATE INDEX "MemberInvite_email_idx" ON "MemberInvite"("email");

-- CreateIndex
CREATE INDEX "MemberInvite_invitedByMemberId_idx" ON "MemberInvite"("invitedByMemberId");

-- CreateIndex
CREATE INDEX "Client_agencyId_idx" ON "Client"("agencyId");

-- CreateIndex
CREATE INDEX "Show_clientId_idx" ON "Show"("clientId");

-- CreateIndex
CREATE INDEX "ShowPlatformInstruction_showId_idx" ON "ShowPlatformInstruction"("showId");

-- CreateIndex
CREATE UNIQUE INDEX "ShowPlatformInstruction_showId_platform_key" ON "ShowPlatformInstruction"("showId", "platform");

-- CreateIndex
CREATE INDEX "Episode_showId_idx" ON "Episode"("showId");

-- CreateIndex
CREATE INDEX "Episode_status_idx" ON "Episode"("status");

-- CreateIndex
CREATE INDEX "GeneratedOutput_episodeId_idx" ON "GeneratedOutput"("episodeId");

-- CreateIndex
CREATE INDEX "GeneratedOutput_episodeId_platform_supersededAt_idx" ON "GeneratedOutput"("episodeId", "platform", "supersededAt");

-- CreateIndex
CREATE INDEX "GeneratedOutput_platform_idx" ON "GeneratedOutput"("platform");

-- CreateIndex
CREATE INDEX "GeneratedOutput_status_idx" ON "GeneratedOutput"("status");

-- CreateIndex
CREATE INDEX "GeneratedOutput_approvedByMemberId_idx" ON "GeneratedOutput"("approvedByMemberId");

-- CreateIndex
CREATE INDEX "GeneratedOutput_previousVersionId_idx" ON "GeneratedOutput"("previousVersionId");

-- CreateIndex
CREATE INDEX "OutputTransition_agencyId_createdAt_idx" ON "OutputTransition"("agencyId", "createdAt");

-- CreateIndex
CREATE INDEX "OutputTransition_outputId_createdAt_idx" ON "OutputTransition"("outputId", "createdAt");

-- CreateIndex
CREATE INDEX "OutputTransition_byMemberId_idx" ON "OutputTransition"("byMemberId");

-- CreateIndex
CREATE INDEX "VoiceSample_showId_platform_idx" ON "VoiceSample"("showId", "platform");

-- CreateIndex
CREATE INDEX "VoiceSample_generatedOutputId_idx" ON "VoiceSample"("generatedOutputId");

-- CreateIndex
CREATE INDEX "VoiceSample_episodeId_idx" ON "VoiceSample"("episodeId");

-- CreateIndex
CREATE INDEX "UsageLog_agencyId_createdAt_idx" ON "UsageLog"("agencyId", "createdAt");

-- CreateIndex
CREATE INDEX "UsageLog_episodeId_idx" ON "UsageLog"("episodeId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_stripeInvoiceId_key" ON "Invoice"("stripeInvoiceId");

-- CreateIndex
CREATE INDEX "Invoice_agencyId_createdAt_idx" ON "Invoice"("agencyId", "createdAt");

-- AddForeignKey
ALTER TABLE "Member" ADD CONSTRAINT "Member_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberInvite" ADD CONSTRAINT "MemberInvite_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberInvite" ADD CONSTRAINT "MemberInvite_invitedByMemberId_fkey" FOREIGN KEY ("invitedByMemberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Show" ADD CONSTRAINT "Show_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShowPlatformInstruction" ADD CONSTRAINT "ShowPlatformInstruction_showId_fkey" FOREIGN KEY ("showId") REFERENCES "Show"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Episode" ADD CONSTRAINT "Episode_showId_fkey" FOREIGN KEY ("showId") REFERENCES "Show"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedOutput" ADD CONSTRAINT "GeneratedOutput_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedOutput" ADD CONSTRAINT "GeneratedOutput_approvedByMemberId_fkey" FOREIGN KEY ("approvedByMemberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedOutput" ADD CONSTRAINT "GeneratedOutput_previousVersionId_fkey" FOREIGN KEY ("previousVersionId") REFERENCES "GeneratedOutput"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutputTransition" ADD CONSTRAINT "OutputTransition_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutputTransition" ADD CONSTRAINT "OutputTransition_outputId_fkey" FOREIGN KEY ("outputId") REFERENCES "GeneratedOutput"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutputTransition" ADD CONSTRAINT "OutputTransition_byMemberId_fkey" FOREIGN KEY ("byMemberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoiceSample" ADD CONSTRAINT "VoiceSample_showId_fkey" FOREIGN KEY ("showId") REFERENCES "Show"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoiceSample" ADD CONSTRAINT "VoiceSample_generatedOutputId_fkey" FOREIGN KEY ("generatedOutputId") REFERENCES "GeneratedOutput"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoiceSample" ADD CONSTRAINT "VoiceSample_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageLog" ADD CONSTRAINT "UsageLog_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageLog" ADD CONSTRAINT "UsageLog_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

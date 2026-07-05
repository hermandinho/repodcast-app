-- CreateEnum
CREATE TYPE "ValidationMode" AS ENUM ('INTERNAL', 'CLIENT');

-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('REVIEW_REQUESTED', 'CLIENT_APPROVED', 'CLIENT_REVISION_REQUESTED');

-- AlterEnum
ALTER TYPE "OutputStatus" ADD VALUE 'AWAITING_CLIENT_APPROVAL';

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "notificationEmails" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "validationMode" "ValidationMode" NOT NULL DEFAULT 'INTERNAL';

-- AlterTable
ALTER TABLE "GeneratedOutput" ADD COLUMN     "clientApprovalEmail" TEXT,
ADD COLUMN     "clientApprovedAt" TIMESTAMP(3),
ADD COLUMN     "sentToClientAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "kind" "NotificationKind" NOT NULL,
    "outputId" TEXT,
    "episodeId" TEXT,
    "actorMemberId" TEXT,
    "body" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notification_memberId_readAt_createdAt_idx" ON "Notification"("memberId", "readAt", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Notification_agencyId_createdAt_idx" ON "Notification"("agencyId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_outputId_idx" ON "Notification"("outputId");

-- CreateIndex
CREATE INDEX "Notification_episodeId_idx" ON "Notification"("episodeId");

-- CreateIndex
CREATE INDEX "Notification_actorMemberId_idx" ON "Notification"("actorMemberId");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_actorMemberId_fkey" FOREIGN KEY ("actorMemberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_outputId_fkey" FOREIGN KEY ("outputId") REFERENCES "GeneratedOutput"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

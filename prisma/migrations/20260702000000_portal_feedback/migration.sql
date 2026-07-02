-- CreateTable
CREATE TABLE "ClientPortalFeedback" (
    "id" TEXT NOT NULL,
    "portalLinkId" TEXT NOT NULL,
    "outputId" TEXT,
    "fromEmail" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readByMemberId" TEXT,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "ClientPortalFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClientPortalFeedback_portalLinkId_createdAt_idx" ON "ClientPortalFeedback"("portalLinkId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ClientPortalFeedback_outputId_idx" ON "ClientPortalFeedback"("outputId");

-- CreateIndex
CREATE INDEX "ClientPortalFeedback_readByMemberId_idx" ON "ClientPortalFeedback"("readByMemberId");

-- AddForeignKey
ALTER TABLE "ClientPortalFeedback" ADD CONSTRAINT "ClientPortalFeedback_portalLinkId_fkey" FOREIGN KEY ("portalLinkId") REFERENCES "ClientPortalLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientPortalFeedback" ADD CONSTRAINT "ClientPortalFeedback_readByMemberId_fkey" FOREIGN KEY ("readByMemberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

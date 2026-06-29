-- AlterTable
ALTER TABLE "GeneratedOutput" ADD COLUMN     "editDistance" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WebhookDelivery_source_processedAt_idx" ON "WebhookDelivery"("source", "processedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookDelivery_source_eventId_key" ON "WebhookDelivery"("source", "eventId");

-- CreateEnum
CREATE TYPE "ClipRenderStatus" AS ENUM ('PENDING', 'RENDERING', 'READY', 'FAILED');

-- AlterTable
ALTER TABLE "Episode" ADD COLUMN     "sourceVideoUrl" TEXT;

-- CreateTable
CREATE TABLE "VideoClip" (
    "id" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "startMs" INTEGER NOT NULL,
    "endMs" INTEGER NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "hookLine" TEXT NOT NULL,
    "sourceVideoUrl" TEXT,
    "renderedUrl" TEXT,
    "posterUrl" TEXT,
    "captionsUrl" TEXT,
    "status" "ClipRenderStatus" NOT NULL DEFAULT 'PENDING',
    "renderError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VideoClip_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VideoClip_episodeId_idx" ON "VideoClip"("episodeId");

-- CreateIndex
CREATE INDEX "VideoClip_agencyId_createdAt_idx" ON "VideoClip"("agencyId", "createdAt");

-- CreateIndex
CREATE INDEX "VideoClip_status_idx" ON "VideoClip"("status");

-- AddForeignKey
ALTER TABLE "VideoClip" ADD CONSTRAINT "VideoClip_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoClip" ADD CONSTRAINT "VideoClip_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

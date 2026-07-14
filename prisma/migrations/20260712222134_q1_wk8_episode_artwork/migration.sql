-- AlterTable
ALTER TABLE "Episode" ADD COLUMN     "artworkConcept" JSONB,
ADD COLUMN     "heroImageUrl" TEXT,
ADD COLUMN     "squareCoverUrl" TEXT,
ADD COLUMN     "verticalCoverUrl" TEXT;

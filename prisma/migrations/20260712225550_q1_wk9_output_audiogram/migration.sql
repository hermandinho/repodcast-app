-- AlterTable
ALTER TABLE "GeneratedOutput" ADD COLUMN     "audiogramAspect" TEXT,
ADD COLUMN     "audiogramEndMs" INTEGER,
ADD COLUMN     "audiogramError" TEXT,
ADD COLUMN     "audiogramPosterUrl" TEXT,
ADD COLUMN     "audiogramStartMs" INTEGER,
ADD COLUMN     "audiogramStatus" "ClipRenderStatus",
ADD COLUMN     "audiogramUrl" TEXT;

-- Phase 2.8 follow-up — surface RSS / transcribe pipeline failures on the
-- Episode itself so the UI has a place to render an error banner instead
-- of leaving the page blank when a non-retriable error trips upstream.

-- AlterEnum
ALTER TYPE "EpisodeStatus" ADD VALUE 'FAILED';

-- AlterTable
ALTER TABLE "Episode" ADD COLUMN "failureReason" TEXT;

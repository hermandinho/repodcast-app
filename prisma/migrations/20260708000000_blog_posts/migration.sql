-- Public blog module (Phase 3.6 marketing surface).
--
-- Adds:
--   - Enum BlogPostStatus
--   - Table BlogPost (public marketing content, authored via /root/blog)
--
-- FK posture:
--   - authorAdminId    → SystemAdmin SET NULL. A soft-deleted author keeps
--     the post visible; the byline just drops off. Matches Suggestion.
--   - updatedByAdminId → SystemAdmin SET NULL. Same reasoning.
--
-- Indexes:
--   - (status, publishedAt DESC) — public reader hot path.
--   - (category, publishedAt DESC) — /blog?category=… drill-in.
--   - authorAdminId / updatedByAdminId — FK convention.

-- CreateEnum
CREATE TYPE "BlogPostStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'PUBLISHED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "BlogPost" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "excerpt" TEXT NOT NULL,
    "bodyMarkdown" TEXT NOT NULL,
    "coverImageUrl" TEXT,
    "category" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "readingMinutes" INTEGER,
    "status" "BlogPostStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "metaTitle" TEXT,
    "metaDescription" TEXT,
    "canonicalUrl" TEXT,
    "ogImageUrl" TEXT,
    "noindex" BOOLEAN NOT NULL DEFAULT false,
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "structuredDataJson" JSONB,
    "authorAdminId" TEXT,
    "updatedByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BlogPost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BlogPost_slug_key" ON "BlogPost"("slug");

-- CreateIndex
CREATE INDEX "BlogPost_status_publishedAt_idx" ON "BlogPost"("status", "publishedAt" DESC);

-- CreateIndex
CREATE INDEX "BlogPost_category_publishedAt_idx" ON "BlogPost"("category", "publishedAt" DESC);

-- CreateIndex
CREATE INDEX "BlogPost_authorAdminId_idx" ON "BlogPost"("authorAdminId");

-- CreateIndex
CREATE INDEX "BlogPost_updatedByAdminId_idx" ON "BlogPost"("updatedByAdminId");

-- AddForeignKey
ALTER TABLE "BlogPost" ADD CONSTRAINT "BlogPost_authorAdminId_fkey" FOREIGN KEY ("authorAdminId") REFERENCES "SystemAdmin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlogPost" ADD CONSTRAINT "BlogPost_updatedByAdminId_fkey" FOREIGN KEY ("updatedByAdminId") REFERENCES "SystemAdmin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

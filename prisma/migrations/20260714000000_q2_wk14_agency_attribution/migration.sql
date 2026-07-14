-- Q2 wk14 — signup attribution sidecar. 1:1 with Agency.
-- See prisma/schema.prisma `model AgencyAttribution` for the shape and
-- Q2.md §"Weeks 14–16 — Distribution infrastructure" for the rationale.

-- CreateTable
CREATE TABLE "AgencyAttribution" (
    "agencyId" TEXT NOT NULL,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "utmContent" TEXT,
    "utmTerm" TEXT,
    "referrer" TEXT,
    "landingPath" TEXT,
    "signupPath" TEXT,
    "gclid" TEXT,
    "fbclid" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgencyAttribution_pkey" PRIMARY KEY ("agencyId")
);

-- CreateIndex
CREATE INDEX "AgencyAttribution_utmSource_idx" ON "AgencyAttribution"("utmSource");

-- CreateIndex
CREATE INDEX "AgencyAttribution_utmCampaign_idx" ON "AgencyAttribution"("utmCampaign");

-- CreateIndex
CREATE INDEX "AgencyAttribution_createdAt_idx" ON "AgencyAttribution"("createdAt");

-- AddForeignKey
ALTER TABLE "AgencyAttribution" ADD CONSTRAINT "AgencyAttribution_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

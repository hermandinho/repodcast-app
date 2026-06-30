-- Phase 3.6.16 + 3.6.18 step 4 — nightly usage rollup table.
--
-- One row per (agency, UTC calendar day). Powers the /root dashboard's hot
-- paths so we stop running groupBy on UsageLog / GeneratedOutput on every
-- render. Snapshots cover everything up to yesterday; today reads live.
--
-- Idempotency: the unique constraint (agencyId, date) backs the cron's
-- upsert — re-running the cron updates an existing row instead of
-- inserting a duplicate.

-- CreateTable
CREATE TABLE "AgencyUsageSnapshot" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "plan" "Plan" NOT NULL,
    "episodes" INTEGER NOT NULL DEFAULT 0,
    "outputs" INTEGER NOT NULL DEFAULT 0,
    "costCents" INTEGER NOT NULL DEFAULT 0,
    "revenueCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgencyUsageSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgencyUsageSnapshot_agencyId_date_key" ON "AgencyUsageSnapshot"("agencyId", "date");

-- CreateIndex
CREATE INDEX "AgencyUsageSnapshot_date_idx" ON "AgencyUsageSnapshot"("date");

-- CreateIndex
CREATE INDEX "AgencyUsageSnapshot_agencyId_date_idx" ON "AgencyUsageSnapshot"("agencyId", "date" DESC);

-- AddForeignKey
ALTER TABLE "AgencyUsageSnapshot" ADD CONSTRAINT "AgencyUsageSnapshot_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

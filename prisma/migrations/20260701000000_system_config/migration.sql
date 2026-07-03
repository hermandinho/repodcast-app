-- Phase 3.6.11 — Platform configuration + per-agency limit overrides.
--
-- Adds SystemConfig (flat key/value bag for platform-wide toggles) and
-- AgencyLimitOverride (per-agency resource ceiling that trumps the plan
-- default). Both are additive — no ALTER on existing tables — so this is
-- safe to run against a live DB with no downtime window.
--
-- Foreign-key posture:
--   - SystemConfig.updatedBySystemAdminId → Restrict + nullable. Nullable so
--     the initial bootstrap seed can write rows before any admin exists;
--     Restrict so audit attribution can never be silently dropped on a
--     mis-configured hard delete (soft-delete via `deactivatedAt` is the
--     intended teardown).
--   - AgencyLimitOverride.bySystemAdminId → Restrict + non-nullable. Every
--     override is authored by a specific admin; hard-deleting the admin is
--     refused so the audit trail survives.
--   - AgencyLimitOverride.agencyId → Cascade. If the agency is hard-deleted
--     the override goes with it (there's nothing to grant capacity to).

-- CreateEnum
CREATE TYPE "LimitOverrideResource" AS ENUM ('SHOWS', 'MEMBERS', 'EPISODES', 'GENERATIONS');

-- CreateTable
CREATE TABLE "SystemConfig" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "description" TEXT,
    "updatedBySystemAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SystemConfig_key_key" ON "SystemConfig"("key");

-- CreateIndex
CREATE INDEX "SystemConfig_updatedBySystemAdminId_idx" ON "SystemConfig"("updatedBySystemAdminId");

-- CreateTable
CREATE TABLE "AgencyLimitOverride" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "resource" "LimitOverrideResource" NOT NULL,
    "value" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "note" TEXT,
    "bySystemAdminId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgencyLimitOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgencyLimitOverride_agencyId_resource_key" ON "AgencyLimitOverride"("agencyId", "resource");

-- CreateIndex
CREATE INDEX "AgencyLimitOverride_expiresAt_idx" ON "AgencyLimitOverride"("expiresAt");

-- CreateIndex
CREATE INDEX "AgencyLimitOverride_bySystemAdminId_idx" ON "AgencyLimitOverride"("bySystemAdminId");

-- AddForeignKey
ALTER TABLE "SystemConfig" ADD CONSTRAINT "SystemConfig_updatedBySystemAdminId_fkey" FOREIGN KEY ("updatedBySystemAdminId") REFERENCES "SystemAdmin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgencyLimitOverride" ADD CONSTRAINT "AgencyLimitOverride_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgencyLimitOverride" ADD CONSTRAINT "AgencyLimitOverride_bySystemAdminId_fkey" FOREIGN KEY ("bySystemAdminId") REFERENCES "SystemAdmin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

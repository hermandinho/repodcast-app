-- Phase 3.6 — ROOT user & platform admin backend.
--
-- Adds the SystemAdmin (platform-employee identity) + SystemAuditLog
-- (append-only audit trail) tables. Both sit OUTSIDE the tenant graph —
-- no FK to Agency or Member from SystemAdmin itself, and the audit log's
-- targetAgencyId / targetMemberId are deliberately untyped String columns
-- so an agency hard-delete doesn't cascade-wipe its audit history.

-- CreateEnum
CREATE TYPE "SystemAdminRole" AS ENUM ('ROOT', 'OPERATOR', 'SUPPORT', 'ANALYST');

-- CreateTable
CREATE TABLE "SystemAdmin" (
    "id" TEXT NOT NULL,
    "clerkUserId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "role" "SystemAdminRole" NOT NULL DEFAULT 'SUPPORT',
    "mfaEnforced" BOOLEAN NOT NULL DEFAULT true,
    "lastActiveAt" TIMESTAMP(3),
    "deactivatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemAdmin_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SystemAdmin_clerkUserId_key" ON "SystemAdmin"("clerkUserId");

-- CreateIndex
CREATE INDEX "SystemAdmin_role_idx" ON "SystemAdmin"("role");

-- CreateIndex
CREATE INDEX "SystemAdmin_deactivatedAt_idx" ON "SystemAdmin"("deactivatedAt");

-- CreateTable
CREATE TABLE "SystemAuditLog" (
    "id" TEXT NOT NULL,
    "bySystemAdminId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetAgencyId" TEXT,
    "targetMemberId" TEXT,
    "targetEntityType" TEXT,
    "targetEntityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "note" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SystemAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SystemAuditLog_bySystemAdminId_createdAt_idx" ON "SystemAuditLog"("bySystemAdminId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "SystemAuditLog_targetAgencyId_createdAt_idx" ON "SystemAuditLog"("targetAgencyId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "SystemAuditLog_action_createdAt_idx" ON "SystemAuditLog"("action", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "SystemAuditLog_createdAt_idx" ON "SystemAuditLog"("createdAt" DESC);

-- AddForeignKey
-- ON DELETE RESTRICT: deactivating an admin is a soft-delete (deactivatedAt);
-- hard-deleting one would orphan their audit rows, so we refuse it at the DB
-- layer as a backstop.
ALTER TABLE "SystemAuditLog" ADD CONSTRAINT "SystemAuditLog_bySystemAdminId_fkey" FOREIGN KEY ("bySystemAdminId") REFERENCES "SystemAdmin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

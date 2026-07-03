-- Phase 3.6.5 — ROOT-side write actions on Agency.
--
-- Two additive nullable columns:
--   - suspendedAt DateTime? — set by the /root suspend action, cleared by
--     unsuspend. Non-null = the tenant dashboard bounces to a "your account
--     is suspended" screen; ROOT read paths (data export) still resolve so
--     the agency can recover their data on unsuspension.
--   - planOverride Plan?   — comp override. `getAgencyPlan()` prefers this
--     over `plan` when set, so an operator can grant / cap capacity without
--     touching Stripe or the customer's paid tier.
--
-- Both columns nullable + default null → safe on live data; no backfill
-- needed.

-- AlterTable
ALTER TABLE "Agency" ADD COLUMN "suspendedAt" TIMESTAMP(3);
ALTER TABLE "Agency" ADD COLUMN "planOverride" "Plan";

-- CreateIndex — hot path for "list currently-suspended agencies" on the
-- /root/agencies list once the status filter starts pivoting on this
-- column (it currently accepts the param but has no data to filter on).
CREATE INDEX "Agency_suspendedAt_idx" ON "Agency"("suspendedAt");

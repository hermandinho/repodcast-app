-- ROOT-granted free access. Non-null + future date → agency clears the
-- "has active subscription" gate as if it had a Stripe sub. Past date =
-- expired comp (equivalent to null for gate purposes). Grant / revoke /
-- extend go through `withSystemAudit`.
--
-- Nullable + default null → safe on live data; no backfill needed.
-- No index: this column is only read on lookups that already filter by
-- Agency.id (unique), so a secondary index buys us nothing.

-- AlterTable
ALTER TABLE "Agency" ADD COLUMN "compAccessExpiresAt" TIMESTAMP(3);

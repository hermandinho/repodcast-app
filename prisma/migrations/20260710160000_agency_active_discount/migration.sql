-- Surface Stripe Coupon / Promotion Code state on the billing page so
-- custom-priced deals (buyers with a negotiated coupon attached to their
-- sub) don't get blindsided when the discount expires and the sticker
-- price kicks in. Populated by the Stripe webhook's `syncSubscription`
-- from `sub.discounts[0].source.coupon` (expanded on retrieve).
--
-- `activeDiscountLabel` — the coupon's human `name` (e.g. "Launch pricing").
-- `activeDiscountEndsAt` — the discount's `end` timestamp for repeating
-- coupons, null for `forever` / `once` durations.
--
-- Both are cleared when the sub no longer has an active discount.
--
-- No index — read one row at a time via `Agency.findUnique` on the
-- billing page, same access pattern as `subscriptionCancelAt`.

ALTER TABLE "Agency"
  ADD COLUMN "activeDiscountLabel" TEXT,
  ADD COLUMN "activeDiscountEndsAt" TIMESTAMP(3);

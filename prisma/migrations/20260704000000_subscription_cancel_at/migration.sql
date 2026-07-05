-- Track "cancel scheduled" state on Agency so /settings/billing can
-- surface the effective end-date and expose a Resume button. Populated
-- by the Stripe webhook's `syncSubscription` from `sub.cancel_at`
-- (falling back to `items[0].current_period_end` when `cancel_at` is
-- unset but `cancel_at_period_end: true`). Nulled on resume and on
-- final subscription deletion.
--
-- No index — the column is read one row at a time via `Agency.findUnique`
-- on the billing page. Adding one would only pay off if we ever wanted
-- to sweep "canceling in the next N days" agencies, which we don't.

ALTER TABLE "Agency" ADD COLUMN "subscriptionCancelAt" TIMESTAMP(3);

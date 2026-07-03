-- Phase 3.x onboarding rebuild — billing cadence.
--
-- Adds the MONTHLY / ANNUAL discriminator the new paid-only onboarding flow
-- needs so Stripe Checkout can pick the right Price (each plan now has both
-- a monthly and an annual Stripe Price). The webhook writes this column from
-- the chosen Price ID so the value always reflects what's actually billed.
--
-- Default MONTHLY so existing rows (and any sample-mode fixtures) keep their
-- semantics — every currently-paying agency we have is on a monthly Stripe
-- sub. Annual subs get the column flipped when their webhook lands.

CREATE TYPE "BillingCadence" AS ENUM ('MONTHLY', 'ANNUAL');

ALTER TABLE "Agency"
  ADD COLUMN "billingCadence" "BillingCadence" NOT NULL DEFAULT 'MONTHLY';

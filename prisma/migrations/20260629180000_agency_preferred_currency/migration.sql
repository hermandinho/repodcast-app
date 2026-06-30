-- Phase 2.9 follow-up: multi-currency Stripe plans.
-- Adds `preferredCurrency` on Agency (3-letter ISO-4217, defaults to USD).
-- Backfill is implicit via the column default — existing rows pick up "USD".

ALTER TABLE "Agency"
  ADD COLUMN "preferredCurrency" TEXT NOT NULL DEFAULT 'USD';

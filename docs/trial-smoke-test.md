# Trial flow — smoke test

End-to-end walkthrough for the Phase 3.9 free-trial mechanic. Run this against a **dev** environment with Stripe test-mode keys after applying the `20260702030000_trial_status` + `20260703000000_trial_nudge_sent` migrations. Every step below has a **verify** line so you know whether it landed.

Prereqs:

- `stripe login` — Stripe CLI hooked to your test account.
- `NEXT_PUBLIC_STRIPE_STUDIO_MONTHLY_PRICE_ID` (+ other plan + trial-activation Price IDs) set in `.env.local`. Run `npm run stripe:plans` to provision them.
- `RESEND_API_KEY` set (if unset, emails silently skip and log a warning — the state transitions still work).
- Dev server running (`npm run dev`), Inngest dev server running (`npx inngest-cli dev` or the Vercel Inngest local proxy).

---

## 0. Apply migrations

- [ ] `npx prisma migrate deploy` — applies both `20260702030000_trial_status` and `20260703000000_trial_nudge_sent`.
- [ ] `npx prisma migrate status` — reports "Database schema is up to date."
- [ ] `npx prisma migrate diff --from-migrations ./prisma/migrations --to-schema ./prisma/schema.prisma --script` — reports **no diff**. If it does, the hand-written migration doesn't match the schema; fix before proceeding.

---

## 1. Forward the Stripe webhook to localhost

```
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

- [ ] Copy the `whsec_…` secret it prints and set `STRIPE_WEBHOOK_SECRET` in `.env.local`. Restart the dev server.

---

## 2. Happy path: trial starts

1. Sign up as a brand-new Clerk user.
2. Complete `/onboarding/workspace` → land on `/onboarding/plan`.
3. Confirm the picker CTA reads **"Start 7-day trial · $1 today"** and STUDIO is pre-selected.
4. Click through to Stripe Checkout with test card `4242 4242 4242 4242`.

Verify:

- [ ] Stripe CLI prints `customer.subscription.created` with `"status": "trialing"` and a `trial_end` unix ~7 days out.
- [ ] Stripe CLI prints `invoice.paid` for a **$1 activation** invoice on day 0 (this is the critical new step — if the invoice doesn't fire immediately, the `line_items` ordering in `checkoutFromOnboardingAction` needs revisiting).
- [ ] `Agency` row: `plan=STUDIO`, `trialStatus=ACTIVE`, `trialEndsAt` matches Stripe's `trial_end`, `stripeSubscriptionId` set.
- [ ] Dashboard shell renders the neutral (non-urgent) **TrialBanner** with `7 days left`.
- [ ] `/settings/billing` renders the **TrialStatusCard** with the "Ends today" pill correctly counted down.
- [ ] Email inbox: **TrialWelcomeEmail** ("Your … trial is live") arrived at the OWNER address.
- [ ] PostHog: `trial_started` event with `agencyId`, `plan=STUDIO`, `cadence`.

---

## 3. Day-2 nudge (Inngest cron)

The cron fires daily at 15:00 UTC. To exercise it now instead of waiting two days:

- [ ] In the Inngest dev UI, invoke `check-trial-nudges` with a mocked `now` such that some ACTIVE trial has `trialEndsAt` inside `[now + 4.5d, now + 5.5d)`.
  - Alternative: temporarily update an `Agency.trialEndsAt` to `now + 5 days` and hit "Run" on the cron.

Verify:

- [ ] Return payload shows `sent >= 1`.
- [ ] `TrialNudgeSent` row created with `marker="day_2"` for that agency.
- [ ] Email inbox: **TrialDay2Email** ("here's what your client sees") arrived.
- [ ] Re-run the cron — `sent === 0`, `skipped >= 1`. The dedupe holds.

---

## 4. T-3 nudge (Stripe-driven)

Stripe fires `customer.subscription.trial_will_end` ~72 h before `trial_end`. To exercise:

```
stripe trigger customer.subscription.trial_will_end \
  --add subscription:metadata.agencyId=<agencyId> \
  --add subscription:trial_end=$(($(date +%s) + 259200))
```

(Or fast-forward the trial via `stripe subscriptions update <sub_id> --trial-end=<unix>`.)

Verify:

- [ ] Webhook 204s (no error).
- [ ] Email inbox: **TrialEndingSoonEmail** ("your trial ends [date]") arrived to every OWNER + ADMIN.
- [ ] `TrialBanner` in the dashboard flips to the **red / urgent** variant.

---

## 5. Trial converts → paid

Fast-forward the trial to `now` so Stripe attempts the first charge:

```
stripe subscriptions update <sub_id> --trial-end=now
```

The 4242 test card succeeds → sub transitions `trialing → active`.

Verify:

- [ ] Webhook fires `customer.subscription.updated` and `invoice.paid`.
- [ ] `Agency.trialStatus = CONVERTED`. `plan` stays STUDIO.
- [ ] `TrialBanner` disappears from the dashboard.
- [ ] `/settings/billing` **TrialStatusCard** flips to the green "Converted" variant.
- [ ] Email inbox: **TrialConvertedEmail** ("your trial converted") arrived to every OWNER + ADMIN.
- [ ] PostHog: `trial_converted` event fired exactly once.

---

## 6. Payment-failure path (EXPIRED)

Repeat step 2 with a fresh signup, but use the Stripe test card `4000 0000 0000 0341` (charge succeeds during trial then declines on first invoice). Fast-forward the trial to `now`, then let Stripe exhaust Smart Retries (or force with `stripe subscriptions cancel <sub_id> --cancellation-details.reason=payment_failed`).

Verify:

- [ ] Webhook fires `customer.subscription.deleted` with `cancellation_details.reason=payment_failed`.
- [ ] `Agency.trialStatus = EXPIRED`. `plan = SOLO`. `stripeSubscriptionId = null`.
- [ ] `/settings/billing` **TrialStatusCard** flips to the red "Expired" variant.
- [ ] Email inbox: **TrialExpiredEmail** ("your trial ended") arrived.
- [ ] PostHog: `trial_expired_no_conversion` event fired.

---

## 7. User-cancel path (CANCELED)

Repeat step 2 with a fresh signup. Cancel from the Stripe Customer Portal _before_ the trial ends.

```
stripe subscriptions cancel <sub_id> --cancellation-details.reason=cancellation_requested
```

Verify:

- [ ] Webhook fires `customer.subscription.deleted` with `cancellation_details.reason=cancellation_requested`.
- [ ] `Agency.trialStatus = CANCELED`. `plan = SOLO`. `stripeSubscriptionId = null`.
- [ ] `/settings/billing` **TrialStatusCard** flips to the amber "Canceled" variant.
- [ ] **No** `TrialExpiredEmail` sent (by design — user-cancels are quiet).
- [ ] PostHog: `trial_canceled_early` event fired.

---

## 8. Second-trial denial

Sign back in as the user from step 6 (EXPIRED). Attempt to start a new subscription from `/onboarding/plan`.

Verify:

- [ ] `/onboarding/plan` CTA reads **"Continue to checkout"**, not "Start 7-day trial · $1 today" (trialEligible is false because `stripeCustomerId` is set).
- [ ] The `line_items` array in the Checkout Session contains **only** the recurring plan Price — no $1 activation line item.
- [ ] Copy under the title is the plain "Pay by card via Stripe…" variant.
- [ ] Stripe Checkout Session created without `trial_period_days`.
- [ ] On success: `Agency.trialStatus` stays `EXPIRED` (we don't reset it), `plan` reflects the picked plan, no `trial_started` event.

---

## 9. Extend-trial ROOT action

As a SystemAdmin (ROOT / OPERATOR):

1. Navigate to `/root/agencies?trial=active`.
2. Confirm at least one agency renders with the green "Xd left" trial pill.
3. Click through to `/root/agencies/[id]`.
4. In the ROOT actions panel, find **Extend trial** (only rendered for ACTIVE trials).
5. Enter `additionalDays=3`, a required note, and submit.

Verify:

- [ ] Success redirect `?action_ok=trial_extended`.
- [ ] `Agency.trialEndsAt` moves +3 days (both locally and in Stripe — `stripe subscriptions retrieve <sub_id>` shows the new `trial_end`).
- [ ] `SystemAuditLog` row: `action="subscription.extend_trial"`, `before/after` capture the timestamps, `note` matches what you typed.
- [ ] `TrialBanner` in the tenant dashboard reflects the new "Xd left" count.

---

## 10. Rollback safety

If anything above fails, roll back with:

```
psql "$DATABASE_URL" <<SQL
BEGIN;
DROP TABLE "TrialNudgeSent";
ALTER TABLE "Agency" DROP COLUMN "trialEndsAt", DROP COLUMN "trialStatus";
DROP TYPE "TrialStatus";
DELETE FROM "_prisma_migrations"
  WHERE migration_name IN ('20260702030000_trial_status', '20260703000000_trial_nudge_sent');
COMMIT;
SQL
```

Then investigate and re-apply — the two migrations are additive-only, so a re-run is safe once the underlying issue is fixed.

# Marketing Strategy

## 0. Plan structure & pricing rationale

### The tiers

|                                              | **Solo**           | **Studio**                    | **Network**                        |
| -------------------------------------------- | ------------------ | ----------------------------- | ---------------------------------- |
| USD / month                                  | **$29**            | **$89**                       | **$299**                           |
| Annual (2 months free)                       | $290 / yr          | $890 / yr                     | $2,990 / yr                        |
| Target user                                  | One host, one show | Small studio or in-house team | Podcast agency w/ multiple clients |
| Shows                                        | 1                  | 5                             | 25                                 |
| Seats                                        | 1                  | 3                             | Unlimited                          |
| Episodes / month                             | 20                 | 60                            | 250                                |
| Generations / month (7 platforms × episodes) | 140                | 420                           | 1,750                              |
| Monthly cost cap (Anthropic + Deepgram)      | $9                 | $27                           | $90                                |
| Approval workflow                            | ✓                  | ✓                             | ✓                                  |
| Voice matching + strength meter              | ✓                  | ✓                             | ✓                                  |
| Client portal (per-client tokenized links)   | —                  | —                             | **✓**                              |
| White-label exports (custom brand accent)    | —                  | —                             | **✓**                              |
| Batch processing                             | —                  | —                             | **✓**                              |
| Priority queue                               | —                  | —                             | **✓**                              |

Non-USD prices at launch (per month): EUR = USD, GBP ≈ 0.85×, CAD ≈ 1.35×, AUD ≈ 1.50×. See `lib/plans.ts` for the exact numbers — Stripe Price `currency_options` is written from that table by `scripts/configure-stripe-plans.ts`.

### Why 3 tiers, not 4

The previous plan (4 tiers: Studio / Agency / Network) suffered from **the Agency-tier straddle**: it was too expensive for solo creators, too limited for real agencies, and the "Client Portal on Agency but not Studio" gate meant Studio agencies felt one-feature-away. Collapsing Studio + Agency into a single **Studio** tier at $89 gives small teams a clean home; **Network** becomes the unambiguous agency-with-clients tier where portals + white-label + batch live.

Three tiers also matches the mental model buyers already have: individual → small team → agency. Fewer decisions on the pricing page = faster conversion.

### Why Solo at $29 (and 20 episodes/month)

Competitive floor is Castmagic at $29 with ~10–15 hours of audio processed and unlimited AI derivatives. Matching their price without matching their perceived generosity would read stingy. We give **20 episodes/month at Solo** (≈ 20 hours if you assume ~1-hour episodes), which is 2.5× the "hours" framing while staying inside a $9 cost cap.

Repositioning consequence: **Solo creators are now inside our ICP**, not anti-positioning. The old "we're not for solo podcasters" line comes out.

### Why Network at $299 (was $499)

The old $499 pricing assumed 3 tiers of drip up from $99 with big feature gates on the middle tier. Now that features drip only twice (Studio → Network), and the middle tier is $89 not $249, the top tier at $499 would look mispriced. $299 keeps a clean ~3.4× step from Studio and stays within reach for a 5-person agency doing $10K–$30K MRR — our primary ICP.

### Why a 30% cost cap (was 45%)

Cost caps guard against runaway fan-out (a bug, a poisoned queue, a bad user); they aren't there to gate normal usage. UsageLog telemetry shows blended COGS around **$0.20/episode**. At Solo's 20 episodes/month, expected spend is ~$4 — the $9 cap is a 2.25× ceiling on the expected, tight enough to keep the incident cost small but loose enough that a single busy month doesn't trip it.

30% chosen over 45% because we now have three tiers priced closer together — the same absolute ceiling in dollars, expressed as a wider % of a smaller plan, would leave Network with $135 of AI headroom which is more than we ever expect to spend on 250 episodes. 30% keeps the % consistent across tiers and forces a clearer investigation trigger when we breach it.

Cap math:

- Solo: $29 × 30% = **$9** (900¢)
- Studio: $89 × 30% = **$27** (2700¢)
- Network: $299 × 30% = **$90** (9000¢)

### Feature gating map

| Feature                           | Solo | Studio | Network |
| --------------------------------- | ---- | ------ | ------- |
| Voice matching (per-client model) | ✓    | ✓      | ✓       |
| Approval workflow                 | ✓    | ✓      | ✓       |
| Voice strength meter              | ✓    | ✓      | ✓       |
| Buffer scheduling                 | ✓    | ✓      | ✓       |
| **Client portal**                 | —    | —      | ✓       |
| **White-label exports**           | —    | —      | ✓       |
| **Custom brand accent**           | —    | —      | ✓       |
| **Batch processing**              | —    | —      | ✓       |
| **Priority queue**                | —    | —      | ✓       |

Client portals, white-label, and batch are the **Network moat** — three features clustered on one tier telling one story: "we make you look professional to your clients". The old drip (portals on Agency, batch on Network) diluted that story.

---

## 1. Free trial — Solo-only $1 activation model

**Trial is Solo-tier only. 7-day trial gated behind a $1 non-refundable activation fee. Card captured at Checkout; $1 charged on day 0; Solo recurring price ($29) starts on day 8. Studio and Network subscribe directly at their monthly price on day 0 with no trial mechanic.**

### Why Solo-only (not "trial on any tier")

The activation fee caps the abuser's cost at $1 while our exposure equals the tier's monthly cost cap:

| Trial tier  | AI-spend cap during trial | Abuser cost | Our loss per abuser |
| ----------- | ------------------------- | ----------- | ------------------- |
| Solo        | $9                        | $1          | ~$8                 |
| ~~Studio~~  | ~~$27~~                   | ~~$1~~      | ~~~$26~~            |
| ~~Network~~ | ~~$90~~                   | ~~$1~~      | ~~~$89~~            |

A determined bad actor cycling fresh Stripe customers (VPN + disposable email + burner card) would cost us **$89 per attempt at Network vs $8 at Solo — 9× smaller blast radius on Solo-only.**

Beyond the abuse math:

- **Trial-as-conversion-mechanic maps to Solo's buyer.** Solo is the price-sensitive individual creator segment competing for Castmagic mindshare. A $1 "try before you buy" fits their decision process; a $299/mo agency owner doesn't need a $1 test.
- **Studio/Network buyers don't need a trial.** They have approved budgets and know they want the product. A trial mechanic reads gimmicky at those price points, not enterprise-y.
- **Natural upsell funnel.** Solo trialists who love the voice engine can upgrade to Studio/Network on day 8+ (full plan charge, no re-trial). Solo becomes the entry, Studio/Network becomes "you've validated it, now scale."
- **Nothing evaluable is behind a Studio/Network paywall for triallability.** Solo includes voice matching, approval workflow, and Buffer scheduling — 80% of the product's evaluable value. Client portals + batch (Network-only) are features you _need_ when you have clients, not features you _try_.

### Why paid-trial, not free-trial

| Option                                    | Verdict    | Reason                                                                                                                                                  |
| ----------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No-card 7-day trial                       | Rejected   | 3–5× lower paid conversion in B2B SaaS. Attracts tire-kickers, burns Anthropic tokens on non-buyers.                                                    |
| Card-required, no charge (previous model) | Rejected   | Card doesn't validate on capture — dead cards discover on day 8 when the real charge fails, we lose the conversion silently.                            |
| Trial on all three tiers                  | Rejected   | See abuse table above — Network trial exposes $89/incident vs $8 on Solo-only. Studio/Network buyers don't need a trial anyway.                         |
| Freemium at any tier                      | Rejected   | Unbounded AI generation cost on non-converters. No forcing function.                                                                                    |
| **Solo-only $1 activation + 7-day trial** | **Chosen** | Validates the card lives, filters signups who won't pay $1 to try, small sunk-cost lifts conversion, and caps abuse blast radius at Solo's $9 cost cap. |

### Trial mechanics

- **Eligible tier:** Solo only. Studio/Network Checkout sessions don't set `trial_period_days` and don't include the activation-fee line item — full plan price charges on day 0.
- **Trial length:** 7 days (industry standard; matches Linear, Cal.com, Vercel, Castmagic)
- **Activation fee:** $1 USD / €1 / £1 / C$1 / A$1 — one-time charge on day 0, Solo-only
- **Refund policy:** Non-refundable. Framed as "activation fee" not "prorated first day". Same as Castmagic.
- **Card required:** Yes (Stripe Checkout collects it before the $1 charge is authorized)
- **On trial-end + payment success:** Auto-flip to paid Solo, no user action
- **On trial-end + payment failure:** `handleSubscriptionDeleted` webhook — access degrades to a downgrade path (drops to SOLO limits with sub cleared), data unchanged
- **Cancellation during trial:** Cancel anytime in-app; $1 is not refunded; no recurring charge on day 8; workspace freezes to read-only 30 days post-cancel
- **Mid-trial upgrade (Solo → Studio/Network):** Allowed via Stripe Customer Portal. Stripe ends the trial early and prorates the diff onto the first invoice at the new tier. The user's $1 activation is not refunded (already spent) but they get the higher tier immediately.
- **Second-trial policy:** No. Enforced by `stripeCustomerId` check — once a customer has trialed once, they go straight to paid on any future signup regardless of tier picked.
- **Extension:** Ops can grant +7 days via `SystemAdmin` action (audit-logged). Only meaningful for active Solo trials.

### Stripe implementation shape

Two Checkout modes depending on eligibility. The Solo trial path uses
`mode: 'payment'` — this is the load-bearing decision that makes "$1
today" visible in Stripe's own UI (`mode: 'subscription'` with
`trial_period_days` shows "$0 due today" and defers the entire first
invoice, which is why the earlier design was wrong).

**Solo trial (Solo + no prior Stripe customer + no prior trial)** —
`checkoutFromOnboardingAction` uses `createSoloTrialCheckout`:

- `mode: 'payment'`
- `line_items`: single inline `price_data` for $1 with product name
  "Solo trial activation" (no persisted Stripe Price — amount is baked
  into `TRIAL_ACTIVATION_FEE_CENTS` in `lib/plans.ts`, single source of
  truth)
- `payment_intent_data.setup_future_usage: 'off_session'` — saves the
  card for the recurring charge on day 8 without asking again
- `customer_creation: 'always'` — forces a Stripe Customer so the
  webhook can attach the follow-up subscription
- `submit_type: 'pay'`, metadata `solo_trial_activation: 'true'` +
  `plan_price_id` (the recurring plan Price ID) so the webhook doesn't
  need a second env-var lookup

Stripe's checkout page now shows "$1 due today" clearly. On success,
`checkout.session.completed` fires. The webhook handler
(`handleCheckoutSessionCompleted`):

1. Verifies `metadata.solo_trial_activation === 'true'` and `mode === 'payment'`
2. Guards against double-creation (agency already has a `stripeSubscriptionId`)
3. Retrieves the PaymentIntent, extracts the saved payment method
4. Sets it as the customer's `invoice_settings.default_payment_method`
5. Creates the subscription via `stripe.subscriptions.create` with
   `trial_period_days: 7` + `default_payment_method` + the plan Price
6. That subscription creation itself fires `customer.subscription.created`
   with `status: trialing`, which our existing `syncSubscription` picks
   up to stamp `Agency.trialStatus = ACTIVE`, `trialEndsAt`,
   `stripeSubscriptionId`, etc.

The $1 charge lands as a proper PaymentIntent (not an invoice) tied to
the customer. The recurring $29 charge on day 8 is invoiced by Stripe
normally against the saved card.

**Non-trial (Studio, Network, or returning-Solo customer)** —
`createDirectSubscriptionCheckout`:

- `mode: 'subscription'`
- Single recurring `line_items` entry
- No `trial_period_days`, no activation fee
- Metadata `solo_trial_activation: 'false'`

Stripe charges the full plan price on day 0 and fires
`customer.subscription.created` immediately. No follow-up webhook work
needed for this path.

**Eligibility gate** (`checkoutFromOnboardingAction`):

```ts
const isSoloPick = plan === Plan.SOLO;
const trialEligible = isSoloPick && !stripeCustomerId && trialStatus === "NONE";
```

Same boolean drives both the Checkout mode selection and the
`solo_trial_activation` metadata flag.

**No env var for the activation Price** — the amount is inlined via
`price_data.unit_amount` from `TRIAL_ACTIVATION_FEE_CENTS`.

### Copy on the pricing page

- **Solo card:** CTA `Start 7-day trial`. Sub-copy: `$1 today, then $29/mo after 7 days`.
- **Studio card:** CTA `Get started`. Sub-copy: `Billed monthly` (or `Billed $890 yearly` on annual).
- **Network card:** CTA `Get started`. Sub-copy: `Billed monthly` (or `Billed $2,990 yearly` on annual).
- Trust footer under the cards: `Secure checkout — you'll be redirected to Stripe to enter card details.` (applies to all three).

### UI checklist

- [ ] `/pricing` page: Solo CTA reads "Start 7-day trial", Studio/Network read "Get started"
- [ ] `/onboarding/plan`: Solo card shows the trial sub-line; Studio/Network show `Billed monthly` / `Billed X yearly`
- [ ] Trial banner in tenant nav: "X days left in trial · Upgrade now" with dismiss + upgrade CTA (Solo users only)
- [ ] Trial-end warning banner (last 3 days): non-dismissable (Solo users only)
- [ ] `/settings/billing`: show trial status + card-on-file + trial-end date (Solo users only)
- [ ] Compare table sticky CTA row: Solo cell reads `Start 7-day trial`; Studio/Network read `Choose Studio` / `Choose Network`

### Emails (via Resend, Solo trialists only)

- [ ] Day 0: "Welcome — trial ends [DATE], $1 activation charge confirmed" with quick-start checklist
- [ ] Day 2: "You've generated N outputs — here's what your first week looks like"
- [ ] Day 4 (T-3): "Trial ends in 3 days — [CTA]" (matches Stripe's `trial_will_end` webhook)
- [ ] Day 8: "Trial converted — first invoice for $29" OR "Trial ended — you weren't charged. Come back anytime."

### Analytics (PostHog)

- [ ] `trial_started` (always plan=SOLO, cadence, currency, referral source)
- [ ] `trial_activation_fee_charged` (Stripe confirms $1 succeeded on day 0)
- [ ] `trial_activation_fee_failed` (card declined — filter these out of the funnel)
- [ ] `trial_converted` (day 8 Solo recurring charge succeeded)
- [ ] `trial_expired_no_conversion` (canceled before day 8, no recurring charge)
- [ ] `trial_canceled_early`
- [ ] `trial_upgrade_mid_trial` (Solo trialist upgraded to Studio/Network before day 8 — indicates trial converted+expanded in one motion)
- [ ] Funnel: signup → workspace-created → Solo pick → $1 charged → first-episode-generated → trial-converted (or upgraded)

### System-admin surface

- [ ] `/root/agencies` filter: "Currently on trial" (implicitly Solo-only)
- [ ] Bulk email trial cohorts from ROOT
- [ ] Extend-trial action with audit log entry
- [ ] "$1 activation charge failed" alert in ROOT overview
- [ ] Alert when a Solo trial abuse pattern is detected (multiple `trial_activation_fee_charged` events from the same IP / device fingerprint within N days)

---

## 2. Positioning

### One-liner

- [ ] Working candidate: **"Turn every episode into a week of client-approved social content — without hiring more staff."**
- [ ] Solo-tier variant: **"Turn every episode into a week of social content — in your voice."**

### Core promise (pick one per tier)

- Solo: **"Sound like you, at speed."** Time-saved framing.
- Studio: **"3× your output without hiring."** Team-productivity framing.
- Network: **"The client portal your agency has been faking with Notion."** Client-facing framing.

### Anti-positioning (who we're NOT for)

- [ ] ~~Solo podcasters~~ — **now in-scope at the Solo tier**
- [ ] Enterprise media companies (they build in-house — mention on pricing page)
- [ ] Non-podcast content agencies (out of scope for v1 copy)
- [ ] Anyone unwilling to try for $1 (self-selecting via the trial gate)

---

## 3. Target segments (ICP)

- [ ] **Primary — Studio tier**: podcast production studios, 2–8 staff, $10K–$50K MRR, currently doing social manually or with a freelancer
- [ ] **Primary — Network tier**: podcast agencies with 5+ clients, $30K+ MRR, need client-facing deliverables
- [ ] **Secondary — Solo tier**: individual creators with a monetized show, $500+/mo revenue, competing for Castmagic mindshare
- [ ] **Tertiary**: in-house content teams at podcast-first companies (Podia, Riverside, Circle) using it as internal tooling
- [ ] **Tertiary**: fractional CMOs / marketing consultants who need a whitelabel deliverable

### Buying triggers to write copy against

- Solo: "I can barely keep up with promoting my own show" / "Castmagic feels generic — the outputs don't sound like me"
- Studio: "I lost a client because our social output was too slow" / "I want to raise prices but can't justify without more deliverables"
- Network: "I have 5 clients and my VA is drowning" / "I need to show my clients what I'm producing"

---

## 4. Acquisition channels — first 90 days

### Owned

- [ ] `/pricing` page — trial CTA above the fold, $1 explicitly called out
- [ ] Public case study: 1 launch-customer story before public launch
- [ ] Comparison landing pages: **"vs. Castmagic"** (Solo tier), "vs. hiring a social VA" (Studio), "vs. Descript + Buffer" (Studio), "vs. building in-house" (Network)
- [ ] SEO pillar posts: "podcast agency workflow", "repurpose podcast content", "podcast client reporting", **"Castmagic alternative for agencies"**

### Community

- [ ] Founder posts weekly in [Podcast Movement](https://podcastmovement.com/), r/podcasting, Podnews Slack
- [ ] Sponsor 3 episodes of a podcast-industry podcast (Sounds Profitable, Podnews Weekly Review)
- [ ] Guest on 2 podcast-agency podcasts before public launch

### Paid (only once organic converts)

- [ ] Google Search: "podcast repurposing", "Castmagic alternative", "social content for podcasts" — budget cap $500/mo
- [ ] LinkedIn Ads: job-title targeting "Podcast Producer", "Content Manager", agency size 2–20 — $500/mo cap
- [ ] **No paid until organic hits 20 trial-starts/week**

### Partnerships

- [ ] Riverside / Descript / Buzzsprout integration listing pages
- [ ] Buffer integration listing page (leverage existing OAuth)
- [ ] Affiliate program: 20% recurring for first 12 months — agency directories + podcast consultants

---

## 5. Onboarding → paid conversion

### Golden-path (day 0)

- [ ] Sign up → workspace name → **pick plan → Stripe Checkout with $1 charge** → return page confirms trial → first show pre-filled from a sample → paste transcript → see generation in < 60 seconds

### 5-minute-value target

- [ ] Every trialist sees their first generated Twitter thread within 5 minutes of the $1 charge landing
- [ ] Pre-seed the workspace with one sample transcript

### Aha checkpoints (trigger emails/nudges when hit)

- [ ] First generation produced → celebrate + prompt to share preview
- [ ] First approval → prompt to invite a teammate (viral loop; Studio+ only)
- [ ] First portal link minted → prompt to send to a real client (Network only)
- [ ] Third episode generated → surface upgrade prompt if on Solo (approaching allowance)

### Friction to remove

- [ ] Skip the "connect Buffer" step during trial — offer it after day 3
- [ ] Don't ask for brand assets (logo, color) until first portal share (Network only)
- [ ] Don't force RSS import — pasted transcript is fine for the first episode

---

## 6. Retention + expansion

### Retention signals (weekly review)

- [ ] Approvals in week 2 > 0
- [ ] Portal link minted in week 2 > 0 (Network only)
- [ ] Second episode generated in week 2 > 0
- [ ] Solo tier: user is still under 20 ep/mo and not upgrading — this is fine, healthy Solo behaviour

### Churn saves

- [ ] Cancel flow: **"Downgrade to Solo"** always presented before "Cancel entirely" (was "Downgrade to Studio")
- [ ] Exit survey — 5 options + free-text, results ship to Slack `#churn`
- [ ] Founder-sent "sorry to see you go" email offering a call for any $89+/mo canceler

### Expansion motion

- [ ] **Solo → Studio prompt** when a user hits: 2nd show attempt, invites a 2nd seat, hits 15+/20 episodes in a month
- [ ] **Studio → Network prompt** when a user hits: 4th show attempt, invites a 4th seat, or asks about client portals (feature-blocked)
- [ ] **Annual upsell prompt** at day 30, day 90, day 180 — 20% discount on annual, one-time (compounds with the "2 months free" already baked in? No — 20% off the annual price is separate). Confirm this stacks cleanly with Stripe billing before shipping the coupon.

---

## 7. Metrics — north star and guardrails

### Weekly numbers to review

- [ ] Trial starts / week (leading)
- [ ] $1 activation charge success rate (target: > 98% — anything less means our Checkout flow is capturing bad cards)
- [ ] Trial → paid conversion rate (target: 30%+ — up from the 25% target for no-charge trials, because $1 filters tire-kickers)
- [ ] Time-to-first-generation (target: < 5 minutes)
- [ ] Time-to-first-portal-share (target: < 3 days, Network tier only)
- [ ] Monthly logo churn (target: < 3%)
- [ ] Net revenue retention (target: 110%+)

### Cost guardrails

- [ ] **Trial cost per user < $3** (Anthropic + Deepgram + Resend + infra). Lower than the previous $10 target because we're now bounded by the picked-tier's cost cap (Solo = $9), and the $1 activation offsets some of the cost.
- [ ] **CAC payback**: < 12 months on monthly plans; < 6 months on annual
- [ ] **Gross margin per active agency > 70%** across all tiers (cost cap enforces the floor)

### Kill-criteria (when to change strategy)

- [ ] Trial → paid < 20% for two consecutive months → revisit trial length or $1 fee amount (test $5)
- [ ] $1 charge success rate < 95% → investigate Checkout flow (are we asking for a card too early?)
- [ ] Trial cost > $10/user → reduce trial generation limit
- [ ] < 10 trial starts/week after 60 days of organic → increase paid spend OR pivot channels
- [ ] Refund/chargeback rate on the $1 > 2% → the "non-refundable" framing isn't clear enough; revisit copy or switch to refundable

---

## 8. Launch sequence

- [ ] Week -4: Recruit 5 design-partner agencies (free lifetime **Network** in exchange for testimonial + case study)
- [ ] Week -2: Ship trial mechanics behind a flag; test $1 charge in Stripe test mode against 5 currencies
- [ ] Week -1: Case study, comparison pages (especially "vs. Castmagic"), pricing page final
- [ ] Week 0: Product Hunt launch (Tuesday), Podnews mention, LinkedIn founder post — headline: **"3 plans, $1 to try, sounds like you"**
- [ ] Week +2: First webinar — "The Podcast Agency Playbook" — using trial as CTA
- [ ] Week +4: Retro on trial conversion; adjust length/tier or $1 fee amount if kill-criteria hit

---

## Appendix A — decisions taken 2026-07-04

| Decision                  | Verdict                     | Reason                                                                                                                                            |
| ------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Number of tiers           | 3 (Solo, Studio, Network)   | Cleaner mental model, no straddle tier, Network becomes unambiguous agency SKU                                                                    |
| Solo pricing              | $29/mo, 20 ep/mo            | Match Castmagic's price floor; beat their generosity framing                                                                                      |
| Studio pricing            | $89/mo (was $59, older $99) | Absorbs old Agency features minus client portals; still accessible to small studios                                                               |
| Network pricing           | $299/mo (was $499)          | Clean 3.4× step from Studio; within reach for 5-person agencies                                                                                   |
| Cost cap %                | 30% of USD monthly          | Tighter incident ceiling; forces clearer investigation trigger                                                                                    |
| Client portal gating      | Network only                | Concentrates the "look professional to clients" story on one tier                                                                                 |
| Trial mechanism           | $1 activation + 7-day trial | Card validation on day 0; filters tire-kickers; matches Castmagic                                                                                 |
| Refund on $1              | No                          | Framed as activation fee, not prorated day                                                                                                        |
| Trial-eligible tier       | **Solo only**               | Abuse math: Network's $90 cost cap = $89 loss per abuser vs $8 on Solo — 9× smaller blast radius. Studio/Network buyers subscribe directly.       |
| Mid-trial upgrade         | Allowed, prorated           | Solo → Studio/Network via Stripe Customer Portal; trial ends early, diff prorated onto first invoice; $1 activation not refunded (already spent). |
| Second trial per customer | No                          | Enforced via `stripeCustomerId` check                                                                                                             |

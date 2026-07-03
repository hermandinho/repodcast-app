# Marketing Strategy

## 1. Free Trial — Recommendation

**Card-required, 7-day trial at AGENCY-tier feature access, delivered via Stripe's native `trial_period_days`. No charge until day 8; card captured on day 1.**

### Why this over the alternatives

| Option                                | Verdict    | Reason                                                                                                                   |
| ------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------ |
| No-card 7-day trial                   | Rejected   | 3–5× lower paid conversion in B2B SaaS at $99+/mo. Attracts tire-kickers, burns AI tokens.                               |
| Freemium at STUDIO ($0)               | Rejected   | Unbounded AI generation cost on non-converters (each episode = real Anthropic spend). No forcing function.               |
| Time-limited at STUDIO                | Rejected   | Client Portal + white-label branding are the "aha" features — both AGENCY-locked. Trialists never feel the real product. |
| **Card-required, 7-day, AGENCY tier** | **Chosen** | Stripe handles expiry natively, existing plan-capacity limits already cap blast radius, "aha" features unlocked.         |

### Trial design (tick as decided)

- [ ] Trial length: **7 days** (industry-standard; Linear/Cal.com/Vercel/Baremetrics)
- [ ] Trial tier: **AGENCY** (unlocks Client Portal + branding + more capacity)
- [ ] Card required at signup: **yes** (Stripe Checkout with `trial_period_days: 7`)
- [ ] Trial capacity: use standard AGENCY limits (10 shows, 6 seats, 60 episodes, 420 generations)
- [ ] Cost cap during trial: apply standard $60/mo AGENCY cost cap unchanged
- [ ] On trial-end + payment success: auto-flip to paid AGENCY, no user action needed
- [ ] On trial-end + payment failure: match existing `handleSubscriptionDeleted` path — downgrade to STUDIO, unchanged data
- [ ] Trial cancellation: cancel any time in-app, no charge, stays on STUDIO after day 7
- [ ] Extension policy: ops can grant +7 day extension via `SystemAdmin` action (audit-logged)
- [ ] Second-trial policy: **no** second trial per Stripe customer (enforce via `stripeCustomerId` check)

### Implementation checklist

**Schema**

- [ ] Add `Agency.trialEndsAt DateTime?` (null = never trialed or trial ended)
- [ ] Add `Agency.trialStatus` enum: `NONE | ACTIVE | CONVERTED | EXPIRED | CANCELED`
- [ ] Migration is additive-only (no data movement)

**Stripe integration**

- [ ] Add `trial_period_days: 7` to `checkoutFromOnboardingAction` for first-time customers
- [ ] Extend `syncSubscription` webhook handler to read `subscription.trial_end` → write `trialEndsAt`
- [ ] Handle `customer.subscription.trial_will_end` webhook (fires 3 days before end) → email nudge
- [ ] Handle `invoice.payment_failed` on first post-trial invoice → downgrade path

**UI**

- [ ] `/pricing` page: show "Start 7-day free trial" as primary CTA (was "Start subscription")
- [ ] `/onboarding/plan`: pre-select AGENCY, show "$0 today, then $249/mo after 7 days"
- [ ] Trial banner in tenant nav: "X days left in trial · Upgrade now" with dismiss + upgrade CTA
- [ ] Trial-end warning banner (last 3 days): red, non-dismissable
- [ ] `/settings/billing`: show trial status + card-on-file + trial-end date

**Emails (via Resend)**

- [ ] Day 0: "Welcome — your trial ends [DATE]" with quick-start checklist
- [ ] Day 2: "You've generated N outputs — here's what your clients see" (portal preview link)
- [ ] Day 4 (T-3): "Trial ends in 3 days — [CTA]" (matches Stripe's own trial_will_end webhook)
- [ ] Day 8: "Trial converted — first invoice for $[amount]" OR "Trial ended — you're on STUDIO"

**Analytics (PostHog)**

- [ ] Event `trial_started` (with plan, cadence, currency, referral source)
- [ ] Event `trial_converted` (paid on day 8)
- [ ] Event `trial_expired_no_conversion` (ran out day 7, no card charge)
- [ ] Event `trial_canceled_early`
- [ ] Funnel: signup → workspace-created → card-captured → first-episode-generated → first-portal-published → trial-converted

**System-admin surface**

- [ ] `/root/agencies` filter: "Currently on trial"
- [ ] Bulk email trial cohorts from ROOT
- [ ] Extend-trial action with audit log entry

---

## 2. Positioning

### One-liner

- [ ] Decide primary one-liner. Working candidate: **"Turn every episode into a week of client-approved social content — without hiring more staff."**

### Core promise (pick one, delete the others)

- [ ] Time saved: "Deliver a week of social from a single episode in 20 minutes."
- [ ] Client retention: "The client portal your podcast clients wish you had."
- [ ] Margin lift: "3× your revenue per episode without touching your staffing."

### Anti-positioning (who we're NOT for)

- [ ] Solo podcasters (they don't have clients — direct them to competitors)
- [ ] Enterprise media companies (they build in-house — mention on pricing page)
- [ ] Non-podcast content agencies (out of scope for v1 copy)

---

## 3. Target segments (ICP)

- [ ] **Primary**: Podcast production agencies, 3–15 staff, $10K–$100K MRR, currently doing social manually or with a freelancer
- [ ] **Secondary**: In-house content teams at podcast-first companies (Podia, Riverside, Circle) using it as internal tooling
- [ ] **Tertiary**: Fractional CMOs / marketing consultants who need a whitelabel deliverable for podcast clients

### Buying triggers to write copy against

- [ ] "I lost a client because our social output was too slow"
- [ ] "I want to raise prices but can't justify without more deliverables"
- [ ] "I have 3 clients and my VA is drowning"

---

## 4. Acquisition channels — first 90 days

### Owned

- [ ] `/pricing` page — trial CTA above the fold
- [ ] Public case study: 1 launch-customer story on the marketing site (before public launch)
- [ ] Comparison landing pages: "vs. hiring a social VA", "vs. Descript + Buffer", "vs. Castmagic"
- [ ] SEO: 5 pillar posts targeting "podcast agency workflow", "repurpose podcast content", "podcast client reporting"

### Community

- [ ] Founder posts weekly in [Podcast Movement](https://podcastmovement.com/), r/podcasting, Podnews Slack
- [ ] Sponsor 3 episodes of a podcast-industry podcast (Sounds Profitable, Podnews Weekly Review)
- [ ] Guest on 2 podcast-agency podcasts before public launch

### Paid (only once organic converts)

- [ ] Google Search: "podcast repurposing", "social content for podcasts" — budget cap $500/mo initially
- [ ] LinkedIn Ads: job-title targeting "Podcast Producer", "Content Manager", agency size 2–20 — budget cap $500/mo
- [ ] **No paid until organic hits 20 trial-starts/week** (avoids masking bad positioning with ad spend)

### Partnerships

- [ ] Riverside / Descript / Buzzsprout integration listing pages (they list companion tools)
- [ ] Buffer integration listing page (leverage the existing OAuth we already ship)
- [ ] Affiliate program: 20% recurring for the first 12 months — for agency directories and podcast consultants

---

## 5. Onboarding → paid conversion

### Golden-path (day 0)

- [ ] Sign up → workspace name → **start trial (card capture)** → first client + first show pre-filled from a sample → paste a transcript → see generation in < 60 seconds

### 5-minute-value target

- [ ] Every trialist must see their first generated Twitter thread within 5 minutes of signup
- [ ] Pre-seed the workspace with one sample transcript so they don't have to bring their own to get the "aha"

### Aha checkpoints (trigger emails/nudges when hit)

- [ ] First generation produced → celebrate + prompt to share preview
- [ ] First approval → prompt to invite a teammate (viral loop)
- [ ] First portal link minted → prompt to send it to a real client
- [ ] Third episode generated → surface upgrade prompt (approaching STUDIO limit)

### Friction to remove

- [ ] Skip the "connect Buffer" step during trial — offer it after day 3
- [ ] Don't ask for brand assets (logo, color) until first portal share
- [ ] Don't force RSS import — pasted transcript is fine for the first episode

---

## 6. Retention + expansion

### Retention signals (weekly review)

- [ ] Approvals in week 2 > 0
- [ ] Portal link minted in week 2 > 0
- [ ] Second episode generated in week 2 > 0

### Churn saves

- [ ] Cancel flow: "Downgrade to STUDIO" always presented before "Cancel entirely"
- [ ] Exit survey — 5 options + free-text, results ship to Slack `#churn`
- [ ] Founder-sent "sorry to see you go" email offering a call for any $249+/mo canceler

### Expansion motion

- [ ] STUDIO → AGENCY prompt when a customer hits: 3rd show, 2nd seat, or first "wanted a portal" event
- [ ] AGENCY → NETWORK prompt when they hit 8/10 shows or 5/6 seats
- [ ] Annual upsell prompt at day 30, day 90, day 180 — 20% discount on annual, one-time

---

## 7. Metrics — north star and guardrails

### Weekly numbers to review

- [ ] Trial starts / week (leading)
- [ ] Trial → paid conversion rate (target: 25%+, industry median for card-required trials)
- [ ] Time-to-first-generation (target: < 5 minutes)
- [ ] Time-to-first-portal-share (target: < 3 days)
- [ ] Monthly logo churn (target: < 3%)
- [ ] Net revenue retention (target: 110%+)

### Cost guardrails

- [ ] Trial cost per user < $10 (Anthropic + Postmark/Resend + infra)
- [ ] CAC payback < 12 months on monthly plans; < 6 months on annual

### Kill-criteria (when to change strategy)

- [ ] Trial → paid < 15% for two consecutive months → revisit trial length or tier
- [ ] Trial cost > $25/user → reduce trial generation limit or shorten to 7 days
- [ ] < 10 trial starts/week after 60 days of organic → increase paid spend OR pivot channels

---

## 8. Launch sequence

- [ ] Week -4: Recruit 5 design-partner agencies (free lifetime AGENCY in exchange for testimonial + case study)
- [ ] Week -2: Ship trial mechanics behind a flag; test with design partners
- [ ] Week -1: Case study, comparison pages, pricing page final
- [ ] Week 0: Product Hunt launch (Tuesday), Podnews mention, LinkedIn founder post
- [ ] Week +2: First webinar — "The Podcast Agency Playbook" — using trial as CTA
- [ ] Week +4: Retro on trial conversion; adjust length/tier if kill-criteria hit

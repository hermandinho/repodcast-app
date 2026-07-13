# Pricing v2 — Q1 features rollout

> Post-Q1 pricing + positioning rewrite. Incorporates the three new
> content pipelines (clips, artwork, audiograms), the reworked episode
> UI, and the shift in what "an agency deliverable" actually looks like.
>
> Read alongside `MarketingStrategy.md` (v1) — this doc supersedes
> sections 0 (plan structure) and portions of the pricing rationale.
> Anything not touched here stays.

---

## 1. What actually shipped in Q1

The v1 pricing was designed around a product that delivered **seven
text outputs per episode**. That's still the spine, but the deliverable
now includes:

| Feature                                        | Ships with             | Marginal cost                                                                               |
| ---------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------- |
| Text outputs × 7 platforms                     | Episode                | ~$0.05–0.10 per episode (7 Claude calls)                                                    |
| Voice matching + drift alerts                  | Show                   | Fixed                                                                                       |
| **Vertical clips** (up to 5 per episode, 9:16) | Episode + video source | ~$0.03 per episode (1 Claude call for highlight selection) + ffmpeg on the VPS (fixed cost) |
| **Hero artwork** (16:9 + 1:1 + 9:16)           | Episode                | ~$0.01 per episode (1 Claude call) + Workers AI free tier                                   |
| **Audiograms** (per social output)             | Output + audio         | ~$0 marginal (ffmpeg only)                                                                  |
| Trim editor + regenerate                       | All above              | Free (retry doesn't call Claude)                                                            |

Blended COGS per episode with everything used: **~$0.15**. Down from
the ~$0.20 assumption in v1 because a good chunk of the new load
(Workers AI, ffmpeg) is fixed-cost, not per-call.

VPS floor is €8.70/mo (Hetzner CPX21) for prod, staging is €4.35/mo —
call it €13/mo of infra. The per-clip / per-audiogram render cost is
essentially zero once the box is running.

---

## 2. Positioning shift

### v1 story

> "Turn one episode into seven platform-ready posts in your client's
> voice."

### v2 story

> "One episode becomes a full launch kit — seven written posts, five
> vertical clips, hero artwork, and audiograms — all in your client's
> voice, ready to publish."

The "voice matching" moat stays. What changes is what an agency
**hands to their client**: a folder of MP4s + PNGs + text, not just a
Google Doc of tweets. That's what justifies retainer economics.

### Anchor claim

The old page led with "voice-true". Voice is a **differentiator**, not
a positioning statement. Buyers scan for outputs first, quality
second. New hero copy leads with the deliverables list; voice is the
sub-headline that explains _why_ the deliverables are good.

**Hero (proposed):**

> **Every episode ships a full launch kit.**
>
> 7 posts across every social platform · 5 vertical clips ·
> 3 aspect ratios of hero artwork · publish-ready audiograms —
> in your show's voice, in under a minute.

**Second-fold (voice moat):**

> **Voice-true, not just AI-generated.** We isolate each host's
> writing patterns so every deliverable reads like they wrote it —
> not a generic model.

---

## 3. Tier design

Four tiers survive from v1 (Solo → Studio → Agency → Network). Prices
and episode allowances **do not change**. What changes is:

- Every tier gets access to clips, artwork, and audiograms.
- The **per-episode allowance** of each new feature scales up the ladder
  (fewer clips on Solo, more on Network).
- The **regeneration budget** scales up the ladder. Regens don't cost
  the customer directly; they gate our own COGS.
- **Batch processing** moves from Agency → Studio (its new marketing
  home) because with the new pipelines the pain of one-at-a-time
  becomes acute at just 5 shows.

### Overview table

|                                          | **Solo** | **Studio** | **Agency** | **Network** |
| ---------------------------------------- | :------: | :--------: | :--------: | :---------: |
| USD / month                              | **$29**  |  **$89**   |  **$179**  |  **$299**   |
| Annual (2 months free)                   |   $290   |    $890    |   $1,790   |   $2,990    |
| Shows                                    |    1     |     5      |     12     |     25      |
| Seats                                    |    1     |     3      |     6      |  Unlimited  |
| Episodes / month                         |    20    |     60     |    150     |     300     |
| **Text outputs (7 platforms)**           |    ✓     |     ✓      |     ✓      |      ✓      |
| **Voice matching + drift alerts**        |    ✓     |     ✓      |     ✓      |      ✓      |
| **Clips per episode**                    |  **3**   |   **5**    |   **5**    |   **10**    |
| **Hero artwork (3 aspects)**             |    ✓     |     ✓      |     ✓      |      ✓      |
| **Audiograms per output**                |  **1**   |   **1**    |   **1**    |    **1**    |
| **Trim editor + retry**                  |    ✓     |     ✓      |     ✓      |      ✓      |
| **Clip regenerations / mo**              |    40    |    200     |    500     | Unlimited*  |
| **Artwork regenerations / mo**           |    10    |     40     |    100     | Unlimited*  |
| **Audiogram regenerations / mo**         |    40    |    200     |    500     | Unlimited*  |
| **Batch generation** (all shows/eps)     |    —     |     ✓      |     ✓      |      ✓      |
| **Client portal** (per-client link)      |    —     |     —      |     ✓      |      ✓      |
| **Client-approval workflow**             |    —     |     —      |     ✓      |      ✓      |
| **Buffer scheduling**                    |    ✓     |     ✓      |     ✓      |      ✓      |
| **White-label exports** (logo, no brand) |    —     |     —      |     —      |      ✓      |
| **Custom brand accent**                  |    —     |     —      |     —      |      ✓      |
| **Custom domain (`clients.you.com`)**    |    —     |     —      |     —      |      ✓      |
| **Priority queue**                       |    —     |     —      |     —      |      ✓      |
| Monthly cost cap (internal)              |    $9    |    $27     |    $54     |     $90     |

*"Unlimited" on Network is soft-capped at the plan's $90 cost cap —
users never see this unless they blow past 6× expected use.

### Why per-episode clip count differs

- **Solo (3/ep):** solo creators want a taste; three vertical clips
  fill a week of TikTok posts. Enough to feel meaningful, not enough
  to feel like the full deliverable.
- **Studio / Agency (5/ep):** matches Q1's design ceiling. This is the
  "professional" tier — five clips per episode is the deliverable most
  agencies pitch to their clients.
- **Network (10/ep):** headroom for agencies whose clients pay for
  volume. Also gives them room to A/B — pick their favorite 5 to
  publish, keep the rest as a bench.

### Why audiograms are 1/output on every tier

An audiogram is a per-post attachment. Each output only makes sense
with one audiogram. There's no natural upsell in "get 3 audiograms per
output" — it would just be waste. Instead we gate regenerations.

### Why regenerations, not "total renders"

Every deliverable can be regenerated (different bounds, different
Claude selections). Regeneration is where cost accumulates. Capping
total _renders_ would penalize normal use ("your artwork is fine on
attempt one"); capping _regenerations_ only bites when someone is
iterating heavily. Same abuse ceiling, cleaner UX.

Regen quotas are set at ~2× expected usage:

- **Clips**: expected ~2 regens per episode on Studio (60 ep × 2 = 120,
  budget 200). Solo gets 40 (20 ep × 2). Network unlimited.
- **Artwork**: expected ~0.5 regens per episode (people usually accept
  the first output). Solo 10 = 20 × 0.5. Network unlimited.
- **Audiograms**: same shape as clips.

### Where features moved

| Feature                | v1 tier              | v2 tier     | Why                                                                                                                                                                                                                    |
| ---------------------- | -------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Batch generation       | Agency               | **Studio**  | With clips + artwork + audiograms, doing 60 episodes one-at-a-time is untenable. Studios need batch to stay sane. Also — batch was on Agency in v1 but Agency didn't exist yet; now it does, so the tier is available. |
| Client portal          | Agency (was Network) | Agency      | Unchanged from v1 code. Portals are what a "client-facing agency" needs.                                                                                                                                               |
| White-label exports    | Network              | **Network** | Same. This is the moat.                                                                                                                                                                                                |
| Priority queue         | Network              | Network     | Same.                                                                                                                                                                                                                  |
| Custom brand accent    | Network              | Network     | Same.                                                                                                                                                                                                                  |
| **NEW: Custom domain** | —                    | Network     | Adds a concrete "own the portal URL" affordance — future feature per Q3 (`repodcast.com/portal/…` → `deliverables.acme.com`).                                                                                          |

---

## 4. What we _don't_ gate

Deliberate policy: **the deliverables themselves aren't gated**. Every
tier gets clips, artwork, and audiograms. Only the _scale_ differs
(episodes/mo, shows, regens/mo). Gates apply only to the
"agency-facing" surface: portals, white-label, batch, priority.

Why: buyers don't upgrade to unlock features they've never used. They
upgrade because they've used a feature and hit the quota. Solo users
who see clips work will feel the pull to Studio when they book their
fifth client; Studio agencies who taste portals via a promo will pull
to Agency when they onboard a client that expects branded delivery.

Anti-pattern to avoid: **"clips are a Studio+ feature."** Doing that
means the Solo tier has no visible reason to exist — nobody upgrades
from Free (which we don't have) to Solo just for extra episodes.

---

## 5. Landing page updates

### Above the fold

- **New hero**: three-line spec (see §2 anchor claim).
- **Hero visual**: swap the current single-screenshot to a small
  gallery — clip player + artwork frame + text output card + audiogram
  waveform. Communicates deliverables at a glance.
- **Primary CTA**: unchanged (`Start free` → Solo trial checkout).
- **Secondary CTA**: `See a sample delivery` — links to a fixed demo
  agency's public output preview.

### Section reshuffle (top → bottom)

1. Hero (deliverables + voice-true sub-line)
2. **NEW: Deliverable gallery** — 4-tile grid, one per pipeline
   (posts, clips, artwork, audiograms), each with a small live-ish
   preview and a two-line description.
3. **Voice moat** — existing "voice-true" section moves here (was
   #1). Keep the equalizer wave, keep the trust language.
4. **Workflow** — existing "how it works" band, updated:
   - Step 3 was "generate posts". Now: "generate posts, clips,
     artwork, and audiograms — one click."
5. **Client-facing** — new section pitching portals + white-label. Two
   surfaces: the operator dashboard, the client's portal. Same
   product, two audiences.
6. **Pricing preview** — 4-card row summarizing the tiers. Full table
   on `/pricing`.
7. **Trusted-by** (unchanged, though we should freshen the logos with
   real customer wins if any land pre-launch).
8. **Final CTA** — unchanged.

### Copy shifts

Replace all "seven outputs" language with **"a launch kit per
episode"** or **"seven posts + clips + artwork + audiograms"**. Search
targets:

- `app/page.tsx` — hero + workflow sections
- `app/about/page.tsx` — the "what we do" narrative
- Site meta description
- OpenGraph copy

---

## 6. Pricing page updates

### Layout

- 4 cards, not 3. Recommended-tier badge stays on **Studio** (the
  MRR sweet spot).
- Each card leads with **what you get per episode**, not with
  seats/shows: "7 posts + 3 clips + artwork + audiograms" (Solo) up
  to "7 posts + 10 clips + artwork + audiograms" (Network).
- Second block: scale (shows, seats, episodes/mo).
- Third block: agency features (portal, batch, white-label,
  priority) as icon rows.

### New "regenerations" microcopy

Under the pricing table add a small explainer block:

> **What counts as a regeneration?**
> Every clip, artwork variant, and audiogram can be re-rendered as
> many times as your plan allows. The first render for each
> deliverable is always included; only re-runs count against your
> monthly regen budget.

### FAQ additions

- "Can I try clips before I subscribe?" — Yes, on the 7-day Solo
  trial.
- "What happens if I hit my regen budget?" — Buttons soft-disable
  until the next billing cycle; existing renders stay downloadable.
- "Can I use my own MP4s?" — Yes, upload via the Clips tab (2 GB
  cap, MP4/MOV/MKV/WebM).
- "Do you charge extra for AI runs?" — No, everything is included in
  the plan price up to the regen cap.

---

## 7. Migration plan (existing customers)

- **Solo / Network v1 customers** — pricing unchanged, gain access to
  new features at their tier's quota.
- **Studio v1 customers** — pricing unchanged, gain batch generation
  (moved down from Agency).
- **v1 Studio customers who need Agency features** (portals) —
  targeted email inviting them to upgrade with a 30-day discount.
  Copy: "Your studio is doing more per client now. Agency includes
  the client portal and batch generation you've been requesting."
- **New signups (as of v2 launch date)** — see the new tier structure
  from day 0.

No customer sees a **price increase**. That's important — the
positioning shift is additive.

---

## 8. Implementation checklist

Ordered roughly by dependency. Land in ~2–3 PRs.

### PR 1 — Data & billing plumbing

1. `lib/plans.ts` — extend `PlanLimits` with:
   - `clipsPerEpisode: number`
   - `clipRegenerationsPerMonth: number`
   - `artworkRegenerationsPerMonth: number`
   - `audiogramRegenerationsPerMonth: number`
2. Update `PLAN_LIMITS` per tier per §3 table.
3. Update `PLAN_DISPLAY` highlights to reflect the new deliverable
   spec.
4. `lib/plan-features.ts` — add feature keys:
   - `clipsIncluded` (min: SOLO — always available, drives the "3 vs
     5 vs 10 per episode" copy)
   - `artworkIncluded` (min: SOLO)
   - `audiogramsIncluded` (min: SOLO)
5. `server/billing/limits.ts` — implement `assertClipRegenCapacity`,
   `assertArtworkRegenCapacity`, `assertAudiogramRegenCapacity`.
   Called from the retry / trim actions before the event fires.
6. `server/db/agency-usage.ts` (new or extend existing) — monthly
   counters for clip/artwork/audiogram regens. Increment inside the
   Inngest fns _after_ a render succeeds (charged only for successful
   regens; failed renders are on us).
7. Tests: extend `tests/server/billing/limits.test.ts` with the three
   new capacity gates.

### PR 2 — Landing + pricing pages

1. `app/page.tsx` — hero rewrite + deliverable gallery + section
   reshuffle per §5.
2. Deliverable gallery component (`components/landing/deliverable-gallery.tsx`)
   — 4-tile grid, small MP4/PNG samples per tile from a fixed demo
   agency.
3. `app/pricing/page.tsx` — 4-card layout with new "per-episode
   deliverables" leading section. Studio recommended badge.
4. `app/about/page.tsx` — narrative refresh (deliverables first,
   voice second).
5. Meta / OpenGraph — new copy.

### PR 3 — In-app upsells + quota UI

1. `components/billing/regen-quota-meter.tsx` — small progress bar
   showing "X of Y regenerations used this month" on the Clips /
   Artwork / Audiogram tabs.
2. `<FeatureUpgradePrompt>` — new variants for
   `clipsPerEpisodeUpgrade`, `regenerationsUpgrade`. Rendered inline
   when a user hits the cap.
3. Server-side gate copy: when a regen is rejected because of quota,
   the action returns an `error` with a clear upgrade suggestion +
   `plan.next.name`.
4. Onboarding wizard — no changes to the plan picker; verify the
   descriptions match `PLAN_DISPLAY` after PR1's copy update.

### Stripe

No plan-id changes. Prices are the same. The four tiers already exist
in Stripe (per `scripts/configure-stripe-plans.ts`). This is a pure
metadata + gating rework; nothing needs to be re-provisioned on the
Stripe side.

---

## 9. Risks / open questions

- **Quota UI ambiguity.** If a user sees "40 regenerations / month"
  they may confuse it with "40 clips total." Copy has to be
  aggressive about "first render is free; only retries count." Test
  the microcopy on 3 users before shipping.
- **Cost-cap collision.** Network's soft-unlimited regens rely on the
  $90 cost cap to be the real ceiling. If clip rendering ever moves
  off the fixed-cost VPS (say Modal.com for GPU renders), Network's
  cost profile changes and we may need to revisit.
- **Marketing copy honesty.** "Under a minute" was true for the 7-post
  case. With the full launch kit (posts + clips + artwork +
  audiograms) the total pipeline is closer to 3–4 min. Copy should
  say "posts in under a minute; clips + artwork + audiograms
  following automatically."
- **Batch on Studio.** Moving batch down from Agency compresses the
  Studio→Agency step. Verify the Agency tier still has enough
  daylight (portal + client workflow + 12 shows should be enough,
  but watch churn/upgrade signal in the first quarter).

---

## 10. Ship-order recommendation

1. **Week 1**: PR 1 (data + billing plumbing). Ships silently — no UI
   change. Existing customers gain access at their tier's default
   quota; usage counters begin ticking.
2. **Week 2**: PR 3 (in-app upsells + quota UI). Now customers can
   see their usage against the new caps.
3. **Week 3**: PR 2 (landing + pricing rewrite). Marketing gets the
   deliverable-first positioning; new signups arrive under the v2
   story.
4. **Week 4**: Announce to existing customers via email — the "your
   plan just got more capable" note. No price changes, only added
   value. Target NPS bump + churn dip.

---

_Add follow-up work here as it comes up. Move items out of §8 as they
land._

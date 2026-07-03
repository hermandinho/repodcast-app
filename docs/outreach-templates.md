# Outreach templates — agency GTM

Cold + lifecycle email copy for the Repodcast agency ICP. These are
starting points, not final sends — always personalize the opener and
sanity-check the plan/pricing numbers against the current `lib/plans.ts`
before shipping a campaign.

**Audience.** Owners / heads of production at podcast production
agencies (3–30 shows). Not solo hosts — Repodcast pays back the fastest
when someone else has to write the platform posts.

**Voice.** Concise. Concrete numbers. Never "revolutionize" / "unlock
the power of" / any launch-hype vocabulary. If a sentence would sound
weird in a Slack DM, cut it.

**Personalization tokens.** `{{first_name}}`, `{{agency}}`, `{{show}}`,
`{{host}}`, `{{platform}}`, `{{limit}}`, `{{plan}}`. Only ship a token
if you have real data behind it — a missing `{{host}}` reads worse than
a generic sentence.

---

## 1. Cold outbound — agency owner

**When.** First touch. You saw their agency's shows in Podcast Index,
listened to at least one clip, and confirmed they publish platform
content (LinkedIn, X, IG) alongside episodes.

**Subject line variants.**

- `{{show}} → 7 platform posts, in {{host}}'s voice`
- `Cutting {{agency}}'s platform-post lag`
- Question: `how are you writing {{show}}'s LinkedIn posts today?`

**Body.**

```
Hi {{first_name}} —

I caught {{show}}'s last episode. You're publishing consistently, but
the LinkedIn and X posts are landing 3–5 days behind the drop. That's
where most of the search + share traffic lives.

We built Repodcast for that exact gap. You upload the audio or drop an
RSS URL; 90 seconds later there are 7 platform-ready posts drafted in
{{host}}'s voice — the same voice, learned from the episodes you've
already approved. Every post lands with a quality score + a "was this
in-voice?" flag so your writers only touch the ones that need it.

Two questions:

1. What's your current turnaround from episode drop to first
   LinkedIn post going live?
2. Would 5 minutes next week be useful to see it running on one of
   {{agency}}'s shows? I can pre-load a real episode so we're
   not looking at a canned demo.

Either way, glad to keep listening.

— {{sender_first_name}}
{{sender_role}} · repodcastapp.com
```

**Notes.**

- Never claim a number ("3–5 days behind") you haven't verified. If you
  don't know their lag, drop that sentence and lead with the second
  paragraph.
- The two questions are load-bearing. A "yes to #2" is the whole point;
  #1 gets a reply from prospects who don't want a demo yet but do want
  to compare notes.
- No CTA button. Reply-driven only. Adding a "Book a demo" link cuts
  reply rate ~30% in cold sequences at this volume.

---

## 2. Follow-up — no reply after 7 days

**When.** 7 calendar days after the cold, no reply, no open? still
send. Do NOT chain past two follow-ups per prospect per quarter.

**Subject line variants.**

- Reply-thread: `Re: {{previous_subject}}` (preserves the thread — the
  prospect sees "1 previous message" and reads both together)
- Fresh: `{{host}}'s LinkedIn — one more data point`

**Body.**

```
{{first_name}} —

Circling back once. Since I wrote, we shipped a scheduled-post feature
so approved posts go out through Buffer on the calendar you already
run — the writer never leaves your existing workflow.

If cross-posting isn't a pain right now, no worries and I'll close the
loop. If it is, hit reply with a Tuesday or Thursday and I'll send a
short calendar.

— {{sender_first_name}}
```

**Notes.**

- "Circling back once" telegraphs that this is the last touch. That
  actually improves reply rate — prospects who wanted to reply but
  didn't get to it feel a small deadline.
- Reference a real product update, not a manufactured one. If
  scheduling isn't shipped yet, swap the middle paragraph for the
  next-most-recent shipped feature.

---

## 3. Trial activation — signed up, no episode after 48 hours

**When.** Day 2 after signup if the account has zero Episodes. Fired
by an Inngest cron or a Resend automation. Skip if
`Agency.stripeSubscriptionId` is null and they're still in the free
onboarding — those need a different sequence.

**Subject line variants.**

- `Try {{first_name}}'s next episode on us`
- `Stuck on the transcript step?`

**Body.**

```
Hi {{first_name}} —

You signed up two days ago and haven't generated your first episode
yet. If something got in the way, tell me what — I'd rather fix the
onboarding than lose you.

The two things most people trip on:

1. **Transcript.** If you don't have one on hand, drop the RSS feed
   URL and we'll pull it. Podcasting 2.0 feeds ship transcripts
   directly; audio-only feeds get transcribed via Deepgram in ~3 min.
2. **Voice samples.** Zero-shot generation reads like ChatGPT. You
   need to approve 2–3 posts before the "in {{host}}'s voice" claim
   becomes true. Approve on the first episode and every subsequent
   episode gets sharper.

Reply here and I'll walk through it with you, or use this link to
finish the flow you started:

{{resume_link}}

— {{sender_first_name}}
```

**Notes.**

- The two-item list is the WHOLE point of this email. Onboarding
  telemetry (`server/analytics/track.ts:onboarding_step_completed`)
  showed those are the top two abandon points; naming them up front
  reduces "I got stuck but was embarrassed to ask" attrition.
- `{{resume_link}}` should deep-link to the wizard step they abandoned
  on, not the dashboard. See `app/onboarding/return/page.tsx` for the
  resume-token pattern.

---

## 4. Upgrade nudge — at plan limit

**When.** Fired the day an agency hits ≥ 90% of any `PLAN_LIMITS`
resource. Not the moment they hit 100% (`assertPlanCapacity` already
throws + surfaces `<PlanLimitBanner>`) — the goal here is to convert
the anticipation, not the crash.

**Subject line variants.**

- `{{agency}} is close to the {{plan}} cap`
- `{{limit}} of {{limit}} — upgrade before you're blocked?`

**Body.**

```
Hi {{first_name}} —

{{agency}} is at {{used}} of {{limit}} {{resource}} on the {{plan}}
plan. You'll cross the limit sometime this month based on the last 30
days of usage — meaning your next episode generation would 403 until
the meter resets on the 1st.

The next tier up ({{next_plan}}, ${{next_price}}/mo) lifts you to
{{next_limit}} {{resource}} and adds {{next_plan_feature_bullet}}.

Two paths:

1. Upgrade now: {{upgrade_link}} — takes effect immediately, prorated
   against the current cycle.
2. Hit reply if you want a comp on this month specifically — we do
   that for agencies inside a launch push. I need to know before the
   cap so the meter override applies retroactively.

— {{sender_first_name}}
```

**Notes.**

- The "wait until cap" comp path is deliberate. It filters out
  prospects who'd upgrade anyway (they take path 1) from prospects
  who need a hand-hold (they'll reply). Support gets a smaller,
  higher-signal inbox.
- `{{next_plan_feature_bullet}}` — for STUDIO → AGENCY use
  "batch processing across all clients"; for AGENCY → NETWORK use
  "priority generation queue + 25 shows".
- `{{upgrade_link}}` deep-links into `createCheckoutSessionAction`
  with the next-tier `plan` + `cadence` pre-selected.

---

## 5. Reactivation — churned / dormant 30 days

**When.** No generation activity in 30 days AND `stripeSubscriptionId`
is present (still paying, not using). If they cancelled, use a
different sequence — win-back copy needs different framing than "you
forgot us".

**Subject line variants.**

- `Still paying for Repodcast — should you be?`
- `{{agency}}'s meter is at 0 this month`

**Body.**

```
{{first_name}} —

You haven't generated an episode with us in 30 days but you're still
paying ${{monthly}}/mo on {{plan}}. That's either a pause we should
know about, or a workflow issue worth fixing.

Three possibilities I hear most often:

1. Client roster shrank — nothing to generate right now. Fair. Would
   you rather downgrade or pause the subscription for 60 days?
2. Voice quality wasn't sharp enough to ship — the samples never
   crossed the training threshold. Reply and I'll audit the
   {{host}} profile with you; usually 3 more approvals unlock it.
3. Something broke and I never heard about it. In which case I owe
   you an apology, and want to know what happened.

Which is it?

— {{sender_first_name}}
```

**Notes.**

- Naming "you're paying and not using" up front sounds
  counter-intuitive but has the highest reply rate of any dormant
  sequence tested. Prospects respect being caught before they cancel.
- The three-option format works because inaction is expensive for
  them (money out, no value in). Compare to a generic "we miss you"
  which they've seen 100 times.
- Never offer a full refund in this email. If they ask, escalate to a
  ROOT admin and use the `refund-flag` action so the audit trail is
  clean.

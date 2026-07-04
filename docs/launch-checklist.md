# Launch checklist

Product Hunt-anchored launch plan. Same shape works for a Hacker News
Show HN or a LinkedIn / X announcement — the substrate changes, the
sequence doesn't.

The whole thing turns on **one number**: reply cadence in the first
four hours after launch. Everything before T-0 is about reducing the
number of things you have to think about at T+2h.

---

## T-14 → T-8 (two weeks out)

Locked-in prep. If you're skipping steps here, don't launch this cycle.

- [ ] **Pick the launch day.** Tuesday–Thursday for Product Hunt (avoid
      the Monday reset spike + the Friday tail). Time: 12:01 AM PT is
      the traditional slot; test-launches show comparable performance
      as late as 3 AM PT if that fits sleep better. Avoid US holidays.
- [ ] **Recruit the hunter.** If you don't have a Product Hunt account
      with >100 followers already, ask a friend who does. A hunter is
      the account that submits — early exposure is real, but not
      make-or-break.
- [ ] **Freeze scope.** No new features between T-14 and T-0. Anything
      urgent lands on a `hotfix-*` branch off `main` — the release
      branch stays quiet so you don't spend launch day chasing a
      regression from a T-2 refactor.
- [ ] **Baseline the health check.** Hit `/api/health` daily.
      `checks.db.status` must be `pass` on every ping for the last 7
      days. Anything else → fix or postpone the launch.
- [ ] **Verify all three plans provision.** Manually cut a Stripe
      Checkout on SOLO ($29), STUDIO ($89), NETWORK ($299) against the
      production account. Confirm the $1 activation charge fires on day
      0, the webhook lands, `Agency.plan` updates, `stripeSubscriptionId`
      populates. Cancel each test sub before the next test.
- [ ] **Draft the launch copy.** Product Hunt lets you edit up to
      launch time but not after — decide the tagline + description
      now so you can proofread with fresh eyes on T-2.

## T-7 → T-2 (finalize assets)

- [ ] **Screenshots + hero image.** Actual production data on a
      real-looking agency (create a "Repodcast Demo" agency if you
      don't have a design-friendly one). At minimum: dashboard,
      `/episodes/[id]` (a NETWORK-tier account so you show batch),
      voice profile, `/settings/billing` with the 30-day chart. Save
      at 1600×900 for Product Hunt gallery.
- [ ] **Demo video, 60 seconds.** Screen-recording only, no talking
      head. Signup → paste transcript → generate → approve → schedule.
      One take. Use a real recent episode so the content isn't
      obviously canned. Add captions (they play muted in the feed).
- [ ] **Landing page dress rehearsal.** Someone who has never seen
      Repodcast walks through `repodcastapp.com` and narrates confusion.
      Fix every "wait, what does that mean" you hear.
- [ ] **Warm the outreach list.** For the agency GTM list (see
      `docs/outreach-templates.md`), send the cold-outbound sequence 3
      days before launch. Anyone who replies gets a "we're launching
      Thursday, would you comment?" ask — comment quality > comment
      volume for Product Hunt.
- [ ] **Recruit 15–25 launch-day supporters.** People who've told you
      they'll upvote AND leave a comment. Volume alone doesn't move
      the ranking anymore; the algorithm weights commented upvotes
      higher.
- [ ] **Prep the maker comment.** First thing you post as the maker,
      pinned above the product. Should be 3–4 short paragraphs:
      (1) why the product exists in one sentence, (2) the one thing
      you got wrong on the first draft, (3) what you're building next,
      (4) an ask ("what would you want that Repodcast doesn't do
      yet?"). This comment is the second-most-read text on the page
      after the tagline.

## T-1 (day before launch)

- [ ] **All ready statuses green.** Uptime, Sentry (no unresolved P0
      issues), Stripe (webhook health), Clerk (webhook health),
      Inngest (no functions in a persistent failure state), R2 (no
      auth alerts). If any is yellow, decide right now whether to
      push or postpone.
- [ ] **Product Hunt draft submitted.** Save-only, don't publish. This
      catches asset validation errors 12 hours early instead of at
      T-0.
- [ ] **Announcement thread drafted** on X + LinkedIn. Same content,
      platform-appropriate. Don't schedule these — post live at
      T+30min so replies feel human.
- [ ] **Email blast drafted, not sent.** All existing users +
      cold-outbound repliers + newsletter. Subject line variants
      ready to A/B if your provider supports it.
- [ ] **Turn off calendar for launch day.** All internal meetings
      cancelled or moved. You'll spend 6+ hours in the comments.
- [ ] **Sleep.** Non-negotiable. A tired maker in the comments is
      worse than no maker in the comments.

## T-0 (launch day)

Times are in PT because that's Product Hunt's clock.

### 12:01 AM — go live

- [ ] Publish the Product Hunt draft.
- [ ] Post the pinned maker comment within 60 seconds of going live.
      This has to happen before the first non-maker comment lands.
- [ ] Notify the 15–25 launch-day supporters — Slack / iMessage / DMs.
      Prewritten "we're live: {{link}}". Don't include instructions;
      they know what to do.

### 6:00 AM PT — visibility push

- [ ] Post the X thread. First tweet should quote the tagline; second
      tweet should link the Product Hunt page. Don't ask for upvotes
      directly (X shadow-bans this); do ask "if you write content for
      podcasts, does this look useful?"
- [ ] Post the LinkedIn announcement.
- [ ] Fire the email blast to existing users + repliers.

### 9:00 AM PT → 3:00 PM PT — comment shift

The single most important block of the day. Sit in the Product Hunt
comments for six hours.

- [ ] Reply to every comment within 15 minutes of it posting. Not
      "thanks!" — a real reply that either answers the question,
      concedes a real limitation, or acknowledges a good idea.
- [ ] Every question you get in comments → save to a running list.
      The best of them become the next batch of FAQ updates.
- [ ] If you get a hostile comment, don't delete it. Respond
      substantively; the community reads how you handle it as a
      signal for how you'll handle their bug reports later.
- [ ] Retweet / re-quote every organic mention on X. Don't
      auto-thanks; write one line each.

### 6:00 PM PT — check position

- [ ] Note your rank at 6 PM. #1–#3 → keep pushing comments until
      midnight. #4–#7 → keep engaging but stop actively recruiting;
      you've likely landed where you'll land. #8+ → thank supporters,
      wrap up.

### 11:30 PM PT — wrap

- [ ] Post a "thank you" comment as the maker. Not the same as the
      pinned first one — this one is retrospective ("what surprised
      me from today: …").
- [ ] Screenshot the final rank + comment count for the
      post-retrospective.
- [ ] Close the laptop.

## T+1 → T+7 (follow-through)

This is where most launches die. The launch generates a signup spike;
retention from that spike determines whether the launch was actually
worth it.

- [ ] **T+1 morning: activation email.** To every signup from
      launch day who hasn't generated an episode. Personal — from
      the founder's actual email address, not `hello@`. Reference
      the launch explicitly ("saw you signed up during our Product
      Hunt push yesterday").
- [ ] **T+1 → T+7: onboarding-nudge cron.** Verify
      `check-onboarding-nudges` Inngest fn is firing (it's the
      activation path for signups that stall — see
      `inngest/functions/check-onboarding-nudges.ts`). Watch
      `Agency.activationStage` progression in the ROOT dashboard.
- [ ] **T+3: cost-cap sanity check.** Launch-day signups may batch
      generate on curiosity. Verify no agency has crossed the
      monthly cost cap prematurely (`server/db/system/config.ts` for
      the override tool if you need to comp).
- [ ] **T+7: cohort retention read.** Signups from launch day vs.
      signups from the prior 30 days — what's the D1 / D7
      episode-generation rate? If launch cohort < baseline cohort,
      the launch messaging is inflating the signup number with
      poorly-qualified accounts and you need to sharpen the
      landing-page copy before running the same play again.

## Retrospective (within 14 days)

- [ ] **What worked.** One page. Specific tactics, not "the community
      loved it."
- [ ] **What didn't.** Same page. Any surprise costs (Anthropic
      spike, R2 bandwidth), any Sentry issues that fired, any
      hostile comments worth answering more substantively in a blog
      reply.
- [ ] **Update THIS document.** Anything in the checklist that
      turned out to be wrong for our specific product / audience
      should get patched here so the next launch (next tier, or a
      re-launch) doesn't repeat the mistake.
- [ ] **Cost-per-signup + cost-per-paying calc.** Anthropic + Deepgram + R2 usage during launch week ÷ signups. Then ÷ paying
      conversions. That's the number that tells you whether Product
      Hunt is a channel to invest in again or one-and-done.

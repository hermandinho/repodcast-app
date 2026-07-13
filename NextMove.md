# Repodcast — Next Move

> Forward-looking feature backlog beyond current PLAN.md phases. Ordered strictly
> by value-to-effort, not by category. Each entry names concrete tools, packages,
> and APIs so the "how" is unambiguous when the item comes up for scoping.
>
> This file complements `PLAN.md` (in-flight roadmap) and `AboutUs.md` (shipped
> state). Move an item here into `PLAN.md` when it enters an actual phase.

---

## Ranking rationale

Ordered by three factors, in this priority:

1. **Category-defining** — does it fill a gap versus Opus Clip / Descript / Castmagic that customers already ask about?
2. **Retainer-justifying** — does it produce evidence an agency can put in front of a client?
3. **Network-tier unlock** — does it justify the 3x jump from Solo to Network?

Effort estimates are for one senior engineer, coding time only. Add ~30% for
integration testing, prompt tuning, and platform review submissions where noted.

---

## Zero-budget path (build order when external spend must be ~$0)

If the constraint is "no monthly SaaS spend beyond what's already paid,"
the ranking shifts. Compute-heavy features get deferred; pure-code and
free-tier features move up. Existing paid dependencies (Neon, Clerk, R2,
Anthropic, Deepgram, Stripe, Resend, Buffer) are assumed already covered
because they're in the shipped app.

### Ship immediately — zero new external cost

These are pure code on top of what's already paid for. No new services.

1. **Bulk regenerate (#13)** — extra Claude tokens only
2. **A/B hook variants (#17)** — extra Claude tokens only
3. **Slack + Teams notifications (#7)** — Incoming Webhooks are free
4. **Blog CMS push (#8)** — WordPress / Ghost / Webflow APIs are free from
   their side
5. **Newsletter push (#9)** — Beehiiv / ConvertKit / Mailchimp APIs are free
6. **Native publishing to Bluesky + Mastodon (subset of #10)** — both fully
   free protocols
7. **YouTube description + chapters (#11)** — Google API free tier is huge
8. **Style guide PDF ingest (#12)** — Anthropic PDF blocks reuse the existing
   Claude quota; `unpdf` is free as a local fallback
9. **PWA / mobile approval (#16)** — Web Push + service workers are browser
   standards, no service required
10. **Inline comments (#14)** — poll every 3s over the existing SSE; skip
    Pusher/Ably
11. **Content calendar planning (#15)** — schema + UI only
12. **Per-client access scoping (#21)** — schema + query filters only
13. **Guest-aware voice (#19)** — reuses Deepgram diarization + Claude

### Ship with a small VPS ($4–8/mo) or free-tier services

- **#14 — AI episode artwork (#4):** **Cloudflare Workers AI free tier**
  (10k neurons/day) with `flux-1-schnell`. Truly free at your volume. Or
  Hugging Face Inference API free tier for SDXL. Fall back to
  `gpt-image-1` only for the occasional "hero" thumbnail if quality
  matters.
- **#15 — Voice drift alerts (#18):** **Cloudflare Workers AI BGE embeddings**
  (free) + **pgvector on Neon** (free, comes with your existing plan). Or
  `@xenova/transformers` running embeddings locally in a Node worker.
- **#16 — Post-publish analytics (#2, partial):** Buffer's GraphQL API already
  surfaces stats; extend the existing client. LinkedIn + IG + TikTok are
  free with app-review approval. **Skip the Twitter/X $200/mo tier
  entirely** — read X stats through Buffer instead.
- **#17 — Audiogram video (#5):** ffmpeg on a **Hetzner CPX11 (~€4.35/mo)** or
  **Oracle Cloud Always Free ARM VM** (truly $0 forever). CPU-only
  rendering is fine for 30–60s audiograms.
- **#18 — Clip generation (#1, CPU-only v1):** same VPS. Use raw
  `fluent-ffmpeg` (skip Remotion — it needs Chromium which is heavy).
  Auto-captions burned in via ffmpeg `subtitles` filter from Deepgram
  SRT. Yes it looks less polished than Opus Clip. Ship it anyway; iterate
  once revenue justifies GPU rendering. Serve MP4s from R2 directly —
  **R2 egress is $0**, that's R2's entire selling proposition, so skip
  Cloudflare Stream.
- **#19 — White-label portal domain (#3):** **Caddy with on-demand TLS** on a
  $4/mo VPS. Free Let's Encrypt certs, automatic provisioning as agencies
  add their CNAME. One YAML config, no Vercel Domains API required.
  Alternative: keep it on Vercel and manually add domains on the Hobby
  plan until volume forces the switch.
- **#20 — Public REST API + webhooks (#6):** **self-hosted Svix** (the whole
  thing is open source), **Scalar** or **Nextra** for docs (both free,
  self-hosted from an OpenAPI yaml). **Upstash Redis free tier**
  (10k commands/day) for rate limiting — enough for early API users.
  Postgres-backed rate limit as an even cheaper fallback.
- **#21 — Multi-clip trailer (#22):** inherits the VPS from #1.

### Defer until revenue justifies

- **Twitter/X analytics (part of #2)** — $200/mo API tier. Read via Buffer
  instead until you have a paying customer who asks for X-specific data.
- **Clip generation with Remotion + GPU** — the ffmpeg v1 above is enough;
  upgrade only when clip quality is a churn reason.
- **Cloudflare Stream** — R2 egress is free; don't add Stream until you
  actually see bandwidth issues.
- **SSO (#20)** — Clerk Enterprise and WorkOS are both paid. Skip until an
  enterprise deal is contingent on it.
- **Modal / Fly.io GPU compute** — CPU rendering handles v1; GPU only when
  volume forces it.

### Free-tier tool substitute map

| Original recommendation | Zero-budget substitute | Notes |
|---|---|---|
| Modal.com / Fly.io GPU | **Hetzner CPX11** (~€4/mo) or **Oracle Cloud Always Free** ARM VM | CPU-only ffmpeg handles v1 clip + audiogram volume |
| Cloudflare Stream | **Serve MP4 direct from R2** | R2 egress = $0; skip Stream until real bandwidth pain |
| gpt-image-1 / Imagen 4 / Ideogram | **Cloudflare Workers AI** `flux-1-schnell` (10k neurons/day free), then Hugging Face Inference API free tier | Reserve paid models for the rare "hero" image |
| Voyage AI embeddings | **Cloudflare Workers AI BGE** (free) or `@xenova/transformers` local | Both truly free at podcast-scale volume |
| Ayrshare / Phyllo | **Buffer GraphQL stats** + free direct platform APIs | Skip Twitter API cost by reading X stats through Buffer |
| Vercel Domains API + Approximated.app | **Caddy on-demand TLS** on a $4/mo VPS | Free ACME certs, one YAML config, unlimited domains |
| Svix hosted | **Self-hosted Svix** (fully open source) | Same VPS as media worker, no extra cost |
| Mintlify / Fern | **Scalar** or **Nextra** | Both free, self-hosted from an OpenAPI yaml |
| Pusher / Ably | **SSE + polling** (already have) or self-hosted **Soketi** | Approval workflow doesn't need real-time |
| Clerk Enterprise SSO / WorkOS | **Defer** — Clerk's non-enterprise tier handles password + social | SSO is a "close the deal" feature; not needed until you have that deal |
| Upstash Redis (paid) | **Upstash free tier** (10k cmd/day) or **Postgres-backed** rate limit | Free tier is enough for MVP API users |
| Remotion + Chromium | **Raw ffmpeg** with `subtitles` + `showwaves` filters | Uglier captions, but 10x cheaper compute |
| Modal GPU for embeddings | **Local `@xenova/transformers`** in a Node worker | Runs on the same VPS, no separate service |

### Total zero-budget monthly cost

Everything above ships for **~$4–8/mo of new external spend** — a single
small VPS (Hetzner CPX11 €4.35/mo, or Oracle Cloud ARM for $0). All other
new services use free tiers.

The VPS runs:
- ffmpeg render worker (triggered by Inngest events)
- Caddy for white-label domain TLS termination
- Self-hosted Svix for webhook delivery
- Optionally, a local embeddings container

If Oracle Cloud Always Free suits (ARM `VM.Standard.A1.Flex` with 4 vCPU +
24GB RAM is available in the always-free tier as of 2026), the incremental
cost is $0.

---

## Tier 1 — Category-defining bets (build first)

### 1. Short-form video clip generation

**What.** Extract 3–5 highlight moments per episode from the transcript, cut the
underlying video/audio around them, burn in captions, output vertical 9:16 clips
ready for Reels / TikTok / Shorts. Optional b-roll and animated captions.

**Why it's #1.** Biggest missing feature in the category. Every podcast-tooling
competitor ships this. Agencies leave Repodcast to use Opus Clip or Vizard for
this today. Turns the seven-output story into a nine-output story with the two
new outputs being the most-shared ones.

**Tools.**

- **Highlight selection:** Claude 4.7 (already wired in `server/ai/`). Feed the
  Deepgram transcript with per-word timestamps (Deepgram already returns these
  when `punctuate=true, utterances=true`) and prompt for top-N spans with a
  scoring rubric (hook strength, standalone comprehension, emotional beat).
- **Video assembly:** [Remotion](https://www.remotion.dev/) — React-based video
  composition. Preferred over raw ffmpeg because caption styling, brand
  intros/outros, and animated title cards are all just JSX. Renders to MP4 via
  Chromium + ffmpeg under the hood.
- **Alternative (leaner):** `fluent-ffmpeg` npm + ffmpeg binary directly. Use
  `subtitles` filter to burn in ASS captions, `showwaves` for audio-only
  visualization, `crop`/`scale` for 9:16 conversion. Cheaper compute, uglier
  output.
- **YouTube source video download:** `@distube/ytdl-core` (the maintained fork —
  vanilla `ytdl-core` is frequently broken). For UPLOAD-source episodes with no
  video, generate an audiogram-style visual (see #4).
- **Audio-only fallback rendering:** ffmpeg `showwaves` or `showspectrum`
  filter over a static background derived from the show's artwork.
- **Compute:** ffmpeg is heavy — Vercel functions are the wrong shape. Options:
  - **Modal.com** — Python-first, GPU-optional, per-second billing. Best fit for
    a self-contained render worker triggered by Inngest.
  - **Fly.io Machines** — spin-to-zero container that boots on demand, holds
    ffmpeg + Chromium. Cheaper at low volume.
  - **Cloudflare Containers** — newer option, tight R2 integration since storage
    is already there.
  - **Not AWS Lambda** — 15 min timeout + cold start on Chromium is painful.
- **Storage:** Cloudflare R2 (already have). Consider **Cloudflare Stream** for
  delivery — automatic transcoding, per-clip analytics, adaptive bitrate, cheap
  bandwidth. Signed URLs to keep clips agency-scoped.
- **Preview UI:** `<video>` element with a scrubbable timeline. Add a react
  waveform component (`wavesurfer.js`) for the trim editor if we want manual
  in/out adjustment before render.

**Data model.**

- Extend `Platform` enum: add `REELS`, `SHORTS`, `TIKTOK_VIDEO` (or reuse
  existing platforms and add an `outputMedium: TEXT | VIDEO | AUDIOGRAM` field).
- New `VideoClip` model: `episodeId`, `startMs`, `endMs`, `sourceUrl`,
  `renderedUrl`, `posterUrl`, `captionsUrl`, `renderStatus`, `score`.
- Extend `Episode` with `sourceVideoUrl` populated during import for YOUTUBE
  and UPLOAD-with-video sources.

**Effort.** 4–8 weeks. Highlight-selection prompt is the tricky part; ffmpeg
pipeline is well-trodden. Add another 2 weeks if we want the Remotion-based
animated-caption route with brand theming.

**Ship gate.** Solo tier at first (drives evaluability), unlock more clips per
episode at Studio / Network.

---

### 2. Post-publish analytics loopback

**What.** After a post is PUBLISHED, poll the platform (or Buffer's analytics
surface) for impressions, engagement, and clicks. Store as time series on the
`GeneratedOutput`. Join with `editDistance` and voice-sample lineage to answer:
_which voice variants actually perform?_ Surface as a Performance tab per
output, show, and client.

**Why it's #2.** Closes the voice-quality feedback loop. Right now voice
training rewards "human-approved" — this makes it reward "human-approved AND
engaging." Also produces the deliverable-of-record that agencies can show
clients to justify the retainer.

**Tools.**

- **Buffer analytics:** Buffer's GraphQL API exposes `Post.statistics` (likes,
  comments, reach, clicks depending on platform). Extend `listRecentPostsForOrg`
  in `server/integrations/buffer.ts` to include the statistics fields — the
  transport is already there.
- **Twitter/X direct:** `GET /2/tweets/{id}?tweet.fields=public_metrics`.
  Requires paid API tier (Basic $200/mo) — but you already need this if you
  ever want to replace Buffer's X publishing.
- **LinkedIn direct:** Marketing API `/rest/socialActions/{shareUrn}` +
  `/rest/organizationalEntityShareStatistics`. Needs `r_organization_social`
  scope, part of Marketing Developer Platform approval.
- **Instagram direct:** Graph API `/{ig-media-id}/insights?metric=impressions,reach,engagement,saved`.
  Needs `instagram_manage_insights` scope on an IG Business account.
- **TikTok direct:** Content Posting API returns basic stats; deeper metrics
  require Research API approval (hard to get for commercial use).
- **Third-party consolidator (fallback):** [Ayrshare](https://www.ayrshare.com/)
  or [Phyllo](https://www.getphyllo.com/) — pay per API call, one integration
  for many platforms. Higher unit cost, lower engineering effort. Consider for
  v1 while you decide whether to build native adapters.
- **Time-series storage:** Not TimescaleDB. Just a Postgres table with
  `(outputId, capturedAt, metricKey, value)` and monthly rollups via a nightly
  Inngest job — you don't have the volume to justify anything more.
- **Charts:** Recharts (already in stack).

**Data model.**

- `OutputMetric` — `outputId`, `capturedAt`, `platform`, `impressions`,
  `engagements`, `clicks`, `raw` (JSON for platform-specific fields).
- `OutputMetricSnapshot` (rollup) — `outputId`, `windowDays` (1/7/30),
  `totalImpressions`, `totalEngagements`, `engagementRate`.
- Extend `VoiceSample` implicitly: performance is derived by joining
  `VoiceSample.sourceOutputId` → `OutputMetric`.

**Inngest.** `pullOutputMetrics` cron every 6h for the first 48h post-publish,
daily for the first 30 days, then stops. Fan-out per-agency to respect per-tenant
rate limits.

**Effort.** 3–4 weeks for Buffer-only + one direct platform. Full multi-platform
native: add another 4–6 weeks (per-platform OAuth scopes + review).

---

### 3. White-label portal domain

**What.** Agencies bring their own domain (`deliverables.acme-agency.com`) that
maps to their client portal. Their logo, colors, and sender-address on the
notification emails. No `repodcast.com` visible to end clients.

**Why it's #3.** Real Network-tier unlock. Agencies with real clients already
white-label everything — the current `repodcast.com/portal/...` URL is the one
sales objection you hear from Network-tier prospects. Cheap to build if you're
already on Vercel.

**Tools.**

- **Custom domain provisioning:** Vercel Domains API — `POST /v10/projects/{id}/domains`
  to add per-agency domains. Auto-issues Let's Encrypt certs.
- **Alternative:** Self-manage with **Approximated.app** (SaaS for exactly this
  problem — customer CNAMEs to their servers, Approximated terminates TLS and
  proxies through) or **SSL for SaaS** if you outgrow Vercel's domain limits.
- **Multi-tenant routing:** Extend `middleware.ts` to resolve the host header:
  if `host !== repodcast.com`, look up `Agency.portalDomain` and rewrite to
  `/portal/[token]` with the resolved agency scoped in. Cache the domain→agency
  map in-memory with 60s TTL.
- **Custom email sender:** Resend supports [verified domains per project](https://resend.com/docs/dashboard/domains/introduction).
  Add `AgencyEmailDomain` model, DKIM/SPF verification flow, then
  `resend.emails.send({ from: 'notifications@acme-agency.com' })`.
- **Custom favicon + open-graph:** Extend the branding tab to include favicon
  upload (R2) and a per-agency `<title>` template.

**Data model.**

- Extend `Agency` with `portalDomain: String? @unique` and
  `portalDomainVerifiedAt: DateTime?`.
- New `AgencyEmailDomain` — `domain`, `dkimStatus`, `spfStatus`, `verifiedAt`,
  `resendDomainId`.

**Effort.** 1–2 weeks. Vercel API does the heavy lifting; the domain-verification
UX is where the time goes.

**Ship gate.** Network tier only.

---

### 4. AI episode artwork

**What.** Every episode gets a bespoke square (Apple Podcasts), horizontal
(YouTube thumbnail), and vertical (Reels/TikTok cover) artwork generated from
episode key moments + show style.

**Why.** Visually striking, immediately obvious in every list view, and cheap.
The BLOG and NEWSLETTER outputs currently ship without a hero image — this
fixes that.

**Tools.**

- **Image models** (best-in-class today):
  - **OpenAI `gpt-image-1`** — best prompt adherence, best typography, works
    for the "text-on-image" thumbnails YouTube demands.
  - **Google Imagen 4** via Vertex AI — comparable quality, cheaper at scale.
  - **Flux 1.1 Pro** via Replicate or fal.ai — best for photo-realistic scenes,
    weaker on text.
  - **Ideogram v3** — strongest typography of any model, best for text-heavy
    thumbnails.
- **Style anchoring:** Use the show's existing `artworkUrl` as an image-input
  reference (gpt-image-1 and Flux both support this). Ensures per-show
  consistency.
- **Prompt construction:** Feed Claude the transcript + key moments + show
  voice description, prompt for a visual concept, hand the concept to the
  image model. Two-stage keeps the image prompt small and high-signal.
- **Storage:** R2 (already have). Add on-the-fly resizing via Cloudflare Images
  or `@cf-wasm/photon` for the different aspect ratios.

**Data model.**

- Extend `Episode` with `heroImageUrl`, `thumbnailUrl`, `verticalCoverUrl`.
- New `EpisodeImageVariant` if you want to store multiple generated candidates
  for the agency to pick from.

**Effort.** 1 week for a first cut. Add another week for style-locked show
identity (LoRA training on show artwork if you want to go deep — probably
overkill).

---

### 5. Audiogram / waveform video

**What.** 30–60 second static video: waveform animation over a background
derived from the show's artwork, burnt-in captions, agency logo watermark.
Available for every social output as a "publish with audio" option.

**Why.** Cheap by comparison, high perceived value. Handles the "no video
source" case where full clip generation isn't possible (audio-only podcasts,
paste-imported transcripts).

**Tools.**

- **Renderer:** Remotion (same choice as #1) or `fluent-ffmpeg` with
  `showwaves` filter. Remotion wins if you also build #1; ffmpeg wins if this
  is standalone.
- **Compute:** Same as #1 (Modal / Fly / Cloudflare Containers).
- **Captions:** Deepgram word-level timestamps → SRT → burned in via Remotion
  `<Captions>` component or ffmpeg subtitles filter.
- **Background:** Extract dominant color from show artwork with `node-vibrant`
  and use a subtle gradient, or blur the show artwork behind the waveform.

**Effort.** 1–2 weeks standalone. A few days if #1 is already shipped and
Remotion is set up.

---

### 6. Public REST API + outbound webhooks

**What.** Third-party access to the agency's own data. Agencies build Zaps,
private dashboards, or hand a read-only key to their client. Outbound
webhooks fire on standard events (`output.approved`, `output.published`,
`episode.ready`).

**Why.** Sticky. Agencies that build custom automation on top of Repodcast
are much less likely to churn. Also unlocks a marketplace path (Zapier /
Make / n8n integrations built by users).

**Tools.**

- **REST layer:** Mount under `/api/v1/*` — Next.js Route Handlers. Reuse
  existing server-layer functions (`server/db/*`), not the server actions
  (server actions couple to Next form state). Return JSON in a consistent
  envelope: `{ data, pagination, error }`.
- **Auth:** Personal access tokens per agency. New `ApiKey` model with
  scopes (`read:episodes`, `write:outputs`, etc). Bearer token in
  `Authorization` header. Rate-limit via [Upstash Redis](https://upstash.com/)
  (`@upstash/ratelimit`) — you don't have Redis yet, this is a good excuse
  to add it once.
- **Webhook delivery:** [Svix](https://www.svix.com/) — battle-tested webhook
  delivery, retries, signing, delivery UI. Preferred over rolling your own.
  Alternative: [Hookdeck](https://hookdeck.com/) or [Inngest](https://www.inngest.com/)
  since you already have Inngest (fan-out with a delivery step + retry
  policy).
- **Docs:** [Mintlify](https://mintlify.com/) or [Fern](https://buildwithfern.com/)
  — generate from an OpenAPI spec, hosted on `docs.repodcast.com`. Or
  simpler: [Scalar](https://scalar.com/) — good-looking, self-hosted from a
  static OpenAPI yaml.
- **SDK generation (later):** [Stainless](https://www.stainlessapi.com/) or
  Fern can generate first-party TypeScript + Python SDKs from your OpenAPI
  spec.

**Data model.**

- `ApiKey` — `agencyId`, `hashedKey`, `label`, `scopes[]`, `createdBy`,
  `lastUsedAt`, `revokedAt`.
- `WebhookEndpoint` — `agencyId`, `url`, `secret`, `subscribedEvents[]`,
  `disabledAt`.
- `WebhookDeliveryAttempt` — audit + retry state (if not using Svix).

**Effort.** 3–4 weeks for a clean v1 covering read-endpoints on episodes,
outputs, clients + a first batch of outbound events.

---

### 7. Slack + Teams notifications

**What.** Pipe the workflow events (review requested, client approved,
publish failed, generation complete) into the agency's own Slack channel or
Teams team. Bidirectional later (approve from Slack).

**Why.** Loved feature, small build. Email inbox is where notifications go
to die; Slack is where agency ops actually happens.

**Tools.**

- **Slack (v1 — one-way):** [Incoming Webhooks](https://api.slack.com/messaging/webhooks).
  Agency pastes a webhook URL into settings, we POST JSON. `@slack/webhook`
  npm package. No OAuth required.
- **Slack (v2 — interactive):** Full OAuth app with `chat:write`,
  `interactions` (buttons that fire an `Approve` / `Request revision` action
  back to Repodcast). Requires publicly reachable interaction endpoint,
  request-signature verification. `@slack/bolt` framework.
- **Teams:** [Incoming Webhook connectors](https://learn.microsoft.com/en-us/microsoftteams/platform/webhooks-and-connectors/how-to/add-incoming-webhook)
  (deprecated but still working) or **Microsoft Graph Adaptive Cards** for the
  modern path. Start with connectors, migrate when Microsoft turns them off.
- **Message templating:** [Block Kit](https://api.slack.com/block-kit) for
  Slack, [Adaptive Cards](https://adaptivecards.io/) for Teams. Same JSON
  shape as their respective builders.

**Data model.**

- Extend `AgencyIntegration.provider` enum with `SLACK` and `TEAMS`.
- Reuse the `meta` JSON bag for the webhook URL / channel bindings.

**Effort.** 1 week for v1 (webhooks only, one direction). 3 weeks for v2
(full OAuth + interactive approvals).

---

### 8. Blog CMS push

**What.** The BLOG output right now is copy-paste. Push directly to
WordPress / Ghost / Webflow as a draft (or published) post.

**Why.** Removes friction on an already-shipped output. Highest-leverage
"finish the job" feature.

**Tools.**

- **WordPress:** REST API v2, `POST /wp-json/wp/v2/posts`. Auth via
  [Application Passwords](https://make.wordpress.org/core/2020/11/05/application-passwords-integration-guide/)
  (built into WP 5.6+) — simpler than OAuth. Or JWT plugin if the site
  requires it.
- **Ghost:** [`@tryghost/admin-api`](https://ghost.org/docs/admin-api/) npm
  package. Admin API key per integration.
- **Webflow:** [Webflow CMS API v2](https://developers.webflow.com/data/reference/rest-introduction).
  OAuth 2 app, `POST /collections/{id}/items` to create a CMS item.
- **Framer / Notion / Beehiiv Blog:** Each has its own SDK — add adapters as
  demand appears. Don't build them all upfront.
- **HTML sanitization:** [`sanitize-html`](https://www.npmjs.com/package/sanitize-html)
  before pushing to any CMS to avoid smuggling script tags.

**Data model.**

- Reuse `AgencyIntegration` — add `WORDPRESS`, `GHOST`, `WEBFLOW` providers.
- Extend `GeneratedOutput` with `cmsPostId`, `cmsPostUrl` for the BLOG
  platform (parallel to Buffer's `externalPostId`).

**Effort.** 1 week per CMS. Start with WordPress (biggest share of blogs).

---

### 9. Newsletter provider push

**What.** Same as #8 but for the NEWSLETTER output — push to Beehiiv /
ConvertKit / Mailchimp as a draft broadcast.

**Why.** Same reasoning — finish the job on a shipped output.

**Tools.**

- **Beehiiv:** [v2 API](https://developers.beehiiv.com/), `POST /publications/{publicationId}/posts`
  with status=draft. Bearer token per publication.
- **ConvertKit (Kit):** [v3 API](https://developers.convertkit.com/), broadcasts
  endpoint. API key per account.
- **Mailchimp:** Marketing API `POST /campaigns` + `PUT /campaigns/{id}/content`.
  API key auth. Heavier lift than the others because Mailchimp splits
  campaign metadata from content.
- **Substack:** No official API. Skip or use their private RSS-import
  workflow (they ingest RSS). Don't build a scraper — high maintenance burden.
- **HTML → plain-text fallback:** [`html-to-text`](https://www.npmjs.com/package/html-to-text)
  for providers that also need a plain-text variant.

**Data model.**

- `AgencyIntegration.provider` gains `BEEHIIV`, `CONVERTKIT`, `MAILCHIMP`.

**Effort.** 1 week per provider. Start with Beehiiv (cleanest API, growing
podcast-adjacent user base).

---

## Tier 2 — Distribution surface expansion

### 10. Native publishing to more platforms (Threads, Bluesky, Shorts, Reddit, Mastodon)

**What.** Beyond Buffer's four social platforms, add native adapters for the
platforms Buffer doesn't cover. Slot into the existing `ExternalScheduler`
enum with new `NATIVE_*` variants (this shape is already in the schema).

**Why.** Fills gaps in the distribution story. Each is smallish on its own
but the aggregate matters: agencies with clients in different niches have
different platform needs.

**Tools.**

- **Threads:** Meta Graph API, `POST /me/threads` + `POST /me/threads_publish`
  two-step flow (v20+). OAuth via Facebook Login for Business. Same app-review
  process as Instagram since it's the same platform.
- **Bluesky:** [`@atproto/api`](https://www.npmjs.com/package/@atproto/api) —
  official AT Protocol client. Auth is currently app passwords (per-user
  strings), OAuth 2 landing in 2026. `agent.post({ text })` for basic posts;
  extension records for images/video.
- **YouTube Shorts:** YouTube Data API v3, `videos.insert` with a vertical
  9:16 MP4. Requires a linked Google account with a YouTube channel and OAuth
  consent for `youtube.upload` scope. Depends on clip generation (#1) for
  content.
- **Reddit:** OAuth2 (installed app or web app), `POST /api/submit`. Per-user
  refresh tokens. Handle per-subreddit posting rules and shadowbans — Reddit
  is tricky, expose "post to r/…" only when the client explicitly configures
  a target subreddit.
- **Mastodon:** Instance-specific OAuth, `POST /api/v1/statuses`. The user
  configures their home instance URL; we do the OAuth dance against that
  instance. `masto` npm client.

**Data model.**

- Extend `Platform` enum: `THREADS`, `BLUESKY`, `YOUTUBE_SHORTS`, `REDDIT`,
  `MASTODON`.
- Extend `ExternalScheduler` enum: `NATIVE_THREADS`, `NATIVE_BLUESKY`, etc.
- Each needs its own `AgencyIntegration.provider` variant with per-provider
  meta shape.

**Effort.** 1–2 weeks per platform, plus app-review time for Threads and
YouTube (weeks of wall-clock).

---

### 11. YouTube description + chapters

**What.** For episodes with YouTube sources, generate a rich description
(from BLOG or SHOW_NOTES output) and timestamped chapters, then push to the
video via YouTube Data API `videos.update`.

**Why.** Small polish, immediately visible to end users. Chapters improve
watch-time; descriptions improve SEO.

**Tools.**

- **Chapter selection:** Existing Claude prompt with the transcript. Chapters
  need to start at 0:00 and be at least 10 seconds each — bake that into the
  prompt.
- **Push:** YouTube Data API v3, `videos.update` with `part=snippet`. OAuth
  scope `youtube.force-ssl` or `youtube`.
- **Description formatting:** YouTube truncates descriptions in most surfaces
  to the first 3 lines — front-load the hook.

**Data model.**

- Extend `Episode` with `youtubeVideoId` (already partially there for
  YOUTUBE-source episodes).
- New optional `EpisodeChapter` — `episodeId`, `startSeconds`, `title`.

**Effort.** 3–5 days. Depends on OAuth flow, which you likely need to build
for #10 (Shorts) anyway.

---

## Tier 3 — Agency workflow depth

### 12. Style guide PDF upload → auto voice instructions

**What.** Client sends a brand voice PDF; extract the rules and populate
per-platform custom instructions on the show automatically instead of the
current manual free-text field.

**Why.** Removes the largest onboarding-friction step. Every established
brand has a voice doc — asking the agency to hand-transcribe it into your
UI is high-friction.

**Tools.**

- **PDF ingestion:** Anthropic API accepts PDFs directly as
  [document blocks](https://docs.claude.com/en/docs/build-with-claude/pdf-support)
  — no local parsing needed. Attach the file, prompt for structured
  extraction, get JSON back.
- **Local fallback:** [`unpdf`](https://www.npmjs.com/package/unpdf) or
  [`pdf-parse`](https://www.npmjs.com/package/pdf-parse) if you ever need to
  extract text without hitting the model.
- **Structured extraction:** Anthropic's tool-use to force a JSON schema of
  `{ tonalRules: string[], forbiddenWords: string[], preferredPhrases: string[], perPlatformOverrides: {...} }`.
- **Storage:** R2 for the raw PDF (audit trail), Postgres for the extracted
  rules.

**Data model.**

- New `ShowStyleGuide` — `showId`, `sourcePdfUrl`, `extractedAt`, `rulesJson`.
- Existing `Show.globalInstructions` and `ShowPlatformInstruction` populated
  from `rulesJson`.

**Effort.** 1 week. The prompt is the interesting part.

---

### 13. Bulk regenerate with prompt

**What.** "Regenerate all TWITTER outputs across the last 10 episodes with
'punchier hooks.'" One dialog, N regeneration jobs, one progress view.

**Why.** Big time-saver during voice tuning. When an agency changes voice
direction mid-quarter, they currently have to re-approve one at a time.

**Tools.**

- **Fan-out:** Reuse `regenerateOutput` Inngest function. Use
  [`step.sendEvent`](https://www.inngest.com/docs/reference/functions/step-send-event)
  with a batch of events tagged by a `batchId` so the UI can track progress
  in aggregate.
- **UI:** Extend the episodes list with multi-select + a "regenerate
  selected" action. Modal captures the prompt override.
- **Progress:** Reuse the SSE stream at `/api/episodes/{id}/stream`; add a
  parallel `/api/batches/{id}/stream` for the aggregate view.

**Data model.**

- New `RegenerationBatch` — `agencyId`, `startedBy`, `prompt`, `outputIds[]`,
  `startedAt`, `completedAt`, `succeededCount`, `failedCount`.

**Effort.** 3–5 days.

---

### 14. Inline comment threads on drafts

**What.** Reviewers leave comments anchored to a text range on a draft
before approve. Threaded. Resolvable. Replaces the "email screenshot" review
dance.

**Why.** Fixes the ugliest workflow moment in the current review flow.

**Tools.**

- **Text anchoring:** Character offset `{ start, end }` — simplest and stable
  across re-renders. Fancier alternative: [ProseMirror](https://prosemirror.net/)
  positions or [Yjs](https://yjs.dev/) for CRDT-based collaborative editing
  (overkill unless you also want live cursors).
- **Realtime:** Server-Sent Events (already in stack) works for one-way
  updates. For live typing indicators, add [Pusher Channels](https://pusher.com/channels/)
  or [Ably](https://ably.com/) — but honestly, poll every 3s and it's fine for
  approval workflow.
- **Mentions / notifications:** Reuse existing `Notification` model. New kind
  `OUTPUT_COMMENT_MENTION`. Resend fires an email if the mentioned member is
  offline.

**Data model.**

- New `OutputComment` — `outputId`, `authorMemberId`, `body`,
  `anchorStart`, `anchorEnd`, `parentCommentId?`, `resolvedAt?`,
  `resolvedByMemberId?`.

**Effort.** 1–2 weeks. Anchor-stability edge cases are where the time goes
(what if the underlying text was edited?).

---

### 15. Content calendar planning view

**What.** The current calendar shows already-scheduled outputs. Add a
"planning" mode: placeholder slots for future episodes ("2 posts per weekday
on LinkedIn"), and a fill-when-ready flow so the agency plans the month
ahead independently of when the episodes exist.

**Why.** Agencies plan cadence, not individual posts. The current calendar
is reactive; this makes it proactive.

**Tools.**

- **Frontend:** Same date-grid the schedule page uses. Add a "slot type"
  drawer with recurrence rules (`RRULE` — the iCalendar recurrence syntax,
  parseable with [`rrule`](https://www.npmjs.com/package/rrule) npm).
- **Backend:** New `ContentSlot` model separate from `GeneratedOutput`. When
  an output is scheduled, it can optionally "fill" a slot; empty slots past
  their date get a "missed" indicator.
- **Auto-fill:** Given N ready outputs and M open slots this week, propose
  a mapping. Simple greedy match by platform + priority.

**Data model.**

- New `ContentSlot` — `agencyId`, `clientId?`, `platform`, `scheduledFor`,
  `rrule?`, `filledByOutputId?`.

**Effort.** 2 weeks. The auto-fill assistant is where you can spend
unbounded time; ship without it in v1.

---

### 16. Mobile-friendly client approval / PWA

**What.** Client portal is already responsive; add an installable PWA with
push notifications so client approvals happen on the phone with one tap.

**Why.** Approvals are the highest-drop-off step. Clients approve from their
phone at the coffee shop. A tap-to-install PWA + push notification for
"revisions ready" reduces the review-cycle time.

**Tools.**

- **PWA:** [`next-pwa`](https://www.npmjs.com/package/@ducanh2912/next-pwa)
  for the manifest + service worker. Or Next.js built-in support (Next 15+
  ships better PWA primitives).
- **Push notifications:** Web Push API. iOS supports it since 16.4 but only
  from home-screen-installed PWAs. Use [`web-push`](https://www.npmjs.com/package/web-push)
  on the server to sign VAPID payloads.
- **Auth:** Extend the existing tokenized-portal-link model — the token stays
  valid, we just persist a subscription per portal session.

**Data model.**

- New `PortalPushSubscription` — `portalLinkId`, `endpoint`, `keys`,
  `subscribedAt`.

**Effort.** 1 week.

---

## Tier 4 — Voice engine depth (differentiator reinforcement)

### 17. A/B hook variants

**What.** For every social output, generate 3 opening lines. Agency picks
one to publish. If analytics loopback (#2) is live, join engagement back to
the picked variant to learn.

**Why.** Cheap way to improve output quality — and once #2 is in, becomes
the training signal that makes the voice engine measurably better over time.

**Tools.**

- **Generation:** Extend the existing per-platform prompt to return an array
  of hooks in a structured field. Anthropic tool-use enforces the schema.
- **UI:** Radio-select in the output-drawer view. Track the chosen variant
  on `GeneratedOutput`.
- **Analysis:** Once #2 is in, `OutputMetric.impressions` per variant → win
  rate per voice sample.

**Data model.**

- New `OutputHookVariant` — `outputId`, `body`, `chosen`, `generatedAt`.
- Or, simpler: JSON array on `GeneratedOutput` + a `chosenHookIndex` int.

**Effort.** 3 days for generation + selection UI. Cross-linking with #2 is
the real value.

**Dependency.** #2 for the closed-loop learning.

---

### 18. Voice drift alerts

**What.** Compare embeddings of recent approved samples against the show's
historical baseline. When the show's tone starts drifting, flag it so the
agency notices before the client does.

**Why.** Voice is your differentiator; drift is the silent killer. This is
a "we know your voice better than you do" trust signal.

**Tools.**

- **Embeddings:** [Voyage AI `voyage-3`](https://docs.voyageai.com/) —
  best-in-class general-purpose embedding, cheap. Or OpenAI
  `text-embedding-3-small` if you want to keep the vendor list short.
- **Vector storage:** [`pgvector`](https://github.com/pgvector/pgvector) on
  Neon (Neon supports it natively). No external vector DB needed at this
  scale.
- **Drift detection:** Rolling centroid of the last N samples vs. the
  historical centroid. Cosine distance > threshold (tune per show) → flag.
- **Alerting:** Reuse Notification + Resend infra.

**Data model.**

- Extend `VoiceSample` with `embedding` (vector column).
- New `VoiceDriftAlert` — `showId`, `detectedAt`, `distance`, `acknowledgedAt`.

**Effort.** 1–2 weeks including tuning the threshold.

---

### 19. Guest-aware voice

**What.** When an episode has a named guest, capture the guest's tone from
their portion of the transcript so quotes attributed to the guest sound like
them, not the host.

**Why.** Podcast agencies constantly say "the guest's LinkedIn quote
sounds nothing like the guest" — this fixes that specific class of
authenticity failure.

**Tools.**

- **Speaker separation:** Deepgram supports `diarize=true` (already in
  scope), returns per-word speaker labels. Combine with `paragraphs=true`.
- **Guest identification:** Prompt Claude with the diarized transcript and
  the episode's `guestName` (new field on `Episode`) — ask which speaker
  index is the guest.
- **Per-speaker voice extraction:** Feed only the guest's utterances to the
  voice-description prompt, store as `GuestVoiceProfile` per-episode (short
  half-life — don't reuse across guests).

**Data model.**

- Extend `Episode` with `guestName`, `guestBio` (optional).
- New `GuestVoiceProfile` — `episodeId`, `voiceDescription`, `sampleQuotes[]`.

**Effort.** 1–2 weeks. Prompt tuning is most of the work.

---

## Tier 5 — Enterprise infrastructure

### 20. SSO (SAML + Google Workspace)

**What.** Enterprise sign-in via SAML or Google Workspace, gated to Network
tier.

**Why.** Table-stakes for larger agencies. Sales objection remover, not a
retention driver — build when the first Network prospect asks.

**Tools.**

- **Clerk Enterprise SSO** — Clerk already handles this on their higher
  tiers. Cheapest path since Clerk is already the auth provider.
- **Alternative:** [WorkOS](https://workos.com/) — purpose-built for SSO
  add-ons. Better UX for admins configuring their IdP, more portable if you
  ever migrate off Clerk.

**Effort.** 3–5 days if using Clerk Enterprise. 1–2 weeks with WorkOS.

---

### 21. Per-client access scoping

**What.** OWNER/ADMIN/EDITOR/REVIEWER works for Solo/Studio. Network
agencies with 20+ members want per-client access: "Reviewer Jane can only
see Client Acme's outputs." Fine-grained multi-tenant-within-tenant.

**Why.** Real Network-tier need. Not urgent until you're onto agencies with
15+ clients and 10+ team members.

**Tools.**

- **Schema:** New `MemberClientAccess` join — `memberId`, `clientId`,
  `role`. When populated for a member, restricts their queryable client set.
- **Enforcement:** Extend the `getAuthContext` helper to include the scoped
  client-id set. Apply as a `where` clause in every server-layer function
  that returns client-scoped data.
- **Test coverage:** Extend the existing tenant-isolation test harness with
  per-client isolation cases.

**Data model.**

- New `MemberClientAccess` — `memberId`, `clientId`, `role`, `grantedByMemberId`,
  `grantedAt`.

**Effort.** 2–3 weeks. Most of the work is auditing every existing query to
apply the new scope filter without accidentally leaking data.

---

## Tier 6 — Lower priority / dependent

### 22. Multi-clip trailer generator

**What.** One-minute episode promo cut from 3–5 highlights.

**Why.** Nice-to-have. Trivial extension of clip generation once #1 exists.

**Tools.** Same as #1 (Remotion + ffmpeg).

**Effort.** 3–5 days once #1 is shipped.

**Dependency.** #1.

---

## Cross-cutting infrastructure to add along the way

These aren't features but they show up as prerequisites in multiple items
above. Add them when the first item that needs them ships:

- **Redis (Upstash)** — rate limiting (#6), caching hot paths, session-store
  candidates. Managed serverless Redis, pay per request.
- **Vector index (`pgvector` on Neon)** — voice drift (#18), potentially
  semantic transcript search later. Native to Neon, no separate provider.
- **Media compute worker** — Modal / Fly.io / Cloudflare Containers. Needed
  the moment you build clip generation (#1) or audiograms (#5). Pick once,
  reuse for #22 and any future ffmpeg work.
- **Cloudflare Stream** — video delivery, per-clip analytics, adaptive
  bitrate. Add when clip generation (#1) ships and R2-served MP4s start
  showing bandwidth cost pressure.
- **Svix or equivalent webhook infra** — public API (#6). Do not build your
  own retry logic; the failure modes are numerous and well-solved.

---

## Suggested build order (12-month view)

**Q1 (weeks 1–13)**
- Short-form video clip generation (#1) — 6–8 weeks
- AI episode artwork (#4) — 1 week in parallel
- Audiogram / waveform video (#5) — 1 week, depends on the Modal/Fly worker
  from #1

**Q2 (weeks 14–26)**
- Post-publish analytics loopback (#2) — 4 weeks
- Slack + Teams notifications (#7) — 1 week
- Blog CMS push (#8, WordPress + Ghost) — 2 weeks
- Newsletter provider push (#9, Beehiiv + ConvertKit) — 2 weeks
- Style guide PDF upload (#12) — 1 week

**Q3 (weeks 27–39)**
- White-label portal domain (#3) — 2 weeks
- Public REST API + webhooks (#6) — 4 weeks
- Native publishing (#10, pick 2 platforms — probably Threads + Bluesky) — 3 weeks
- YouTube description + chapters (#11) — 1 week

**Q4 (weeks 40–52)**
- Voice drift alerts (#18) — 2 weeks
- A/B hook variants (#17) — 3 days, activates #2's learning loop
- Inline comments (#14) — 2 weeks
- Bulk regenerate (#13) — 1 week
- Content calendar planning (#15) — 2 weeks
- Mobile PWA (#16) — 1 week
- Multi-clip trailer (#22) — 3 days

**Deferred (build when first customer asks)**
- SSO (#20)
- Per-client access scoping (#21)
- Guest-aware voice (#19)

---

_Add new candidates to Tier 6, promote via ranking rationale, move into
`PLAN.md` when a phase picks them up._

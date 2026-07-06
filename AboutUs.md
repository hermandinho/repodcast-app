# About Repodcast

**Repodcast** is a B2B SaaS platform built for podcast production agencies. It turns a single episode transcript into seven platform-ready outputs — Twitter/X, LinkedIn, Instagram, TikTok, show notes, blog post, and newsletter — in each client's authentic voice, in under a minute.

This document is the source of truth for **what the product does today**. It grows as new features ship. Aspirational work lives in `PLAN.md`; this file only describes shipped functionality.

---

## Table of contents

1. [Product surface at a glance](#1-product-surface-at-a-glance)
2. [Marketing site and public pages](#2-marketing-site-and-public-pages)
3. [Authentication, onboarding, and invites](#3-authentication-onboarding-and-invites)
4. [The dashboard](#4-the-dashboard)
5. [Clients](#5-clients)
6. [Shows](#6-shows)
7. [Episodes and the generation pipeline](#7-episodes-and-the-generation-pipeline)
8. [The seven outputs and their approval workflow](#8-the-seven-outputs-and-their-approval-workflow)
9. [Voice profiles](#9-voice-profiles)
10. [Scheduling and publishing](#10-scheduling-and-publishing)
11. [Settings, team, and billing](#11-settings-team-and-billing)
12. [The client portal](#12-the-client-portal)
13. [Client billing, statements, and deliverables](#13-client-billing-statements-and-deliverables)
14. [Background jobs](#14-background-jobs)
15. [API and webhooks](#15-api-and-webhooks)
16. [Data model](#16-data-model)
17. [Integrations](#17-integrations)
18. [Platform administration (ROOT)](#18-platform-administration-root)
19. [Trust, safety, and abuse handling](#19-trust-safety-and-abuse-handling)
20. [Notable engineering choices](#20-notable-engineering-choices)

---

## 1. Product surface at a glance

Repodcast is a multi-tenant application. Each **agency** is a tenant that manages many **clients**, each client owns one or more **shows** (podcasts), and each show has **episodes**. Every episode fans out into up to seven **generated outputs**, one per platform, that flow through a voice-tuned generation and approval pipeline before being scheduled or published.

The stack under the hood: **Next.js 16** (App Router, Turbopack), **React 19.2**, **Tailwind CSS v4**, **Prisma 7 + Neon Postgres**, **Clerk** for authentication, **Inngest** for background jobs, **Cloudflare R2** for storage, **Anthropic Claude** for generation, **Deepgram** for transcription, **Stripe** for billing, **Resend** for transactional email, **Buffer** for social publishing, **PostHog** for feature flags, and **Sentry** for error tracking.

---

## 2. Marketing site and public pages

Unauthenticated visitors land on the public surface. Every public page is server-rendered and SEO-indexed via `app/sitemap.ts` and `app/robots.ts`.

- **Landing page** (`app/page.tsx`) — Auth-aware hero, "how it works," and trusted-by section. Recent iterations added an animated equalizer wave behind the final CTA and a polished light-mode UI pass.
- **About** (`app/about/page.tsx`) — Company/product narrative organised around the voice engine, target audience (production agencies), voice-true philosophy, and four commitments (content ownership, voice isolation, export, honest limits).
- **Pricing** (`app/pricing/page.tsx`) — Plan selector for the three tiers: **SOLO**, **STUDIO**, and **NETWORK**.
- **Contact** (`app/contact/page.tsx`) — Contact form.
- **Coming Soon** (`app/coming-soon/page.tsx`) — Placeholder used for features gated behind flags.
- **Legal** (`app/legal/privacy`, `terms`, `security`, `report`) — Terms of service, privacy policy, security posture page, and the abuse-report intake form.

---

## 3. Authentication, onboarding, and invites

Sign-in and sign-up are handled by **Clerk** (`app/sign-in`, `app/sign-up`) with a customised appearance layer. Route protection lives in `middleware.ts`, which also resolves the active tenant context and supports read-only impersonation for support cases.

**Post-sign-in routing** (`app/after-sign-in/page.tsx`) inspects the account's state and directs the user to onboarding, the returning-subscriber flow, or the dashboard.

**Onboarding** (`app/onboarding/`) is a stateful multi-step flow:

1. `/onboarding/workspace` — create the agency workspace.
2. `/onboarding/plan` — select plan (SOLO/STUDIO/NETWORK), billing cadence (MONTHLY/ANNUAL), and preferred currency; hand off to Stripe checkout. New agencies get a card-required $1 activation with a 7-day trial (one trial per Stripe customer).
3. `/onboarding/return` — dedicated re-subscribe flow for customers whose subscription lapsed.

**Team invites** are **not** Clerk Organizations. Repodcast uses its own tokenised invite system (`app/invite/[token]/page.tsx`, `MemberInvite` table). Invites carry a role, expire, can be revoked, and log every state change to `MemberTransition`.

---

## 4. The dashboard

`app/(dashboard)/dashboard/page.tsx` is the authenticated home. It renders:

- **KPI tiles** — active shows, episodes this month, outputs generated, approval throughput.
- **Output volume chart** — trend line across recent periods.
- **Recent episodes** — quick-jump list.
- **Activity feed** — recent workflow events (generations, approvals, publishes).
- **"Review pending outputs" dark-card CTA** — surfaces outputs waiting on internal or client review.
- **Onboarding gate** — shown when the agency has no shows yet.

---

## 5. Clients

A **client** is the agency's customer — the person or company whose podcasts the agency produces.

**Client list** (`app/(dashboard)/clients/page.tsx`) — sortable cards showing show count, episode count, voice-sample count, contact info, and an unread portal-feedback badge. Clients with pending notes float to the top of the list.

**Client detail** (`app/(dashboard)/clients/[key]/`) uses a tabbed layout:

- **Overview** — shows under the client, plus an "Add show" button.
- **Deliverables & Billing** (OWNER/ADMIN) — billing profile form, cost-to-serve card, paginated deliverable ledger with filters (date, status, platform), portal-links manager, portal-feedback inbox.
- **Workflow** (OWNER/ADMIN) — validation-mode picker (INTERNAL vs. CLIENT), notification email list, and owner contact display. This tab is where an agency decides whether client approval is required before scheduling.

---

## 6. Shows

A **show** is a podcast that belongs to a client. Each show carries its own voice profile, so a client with multiple podcasts can maintain distinct tones per property.

**Shows page** (`app/(dashboard)/shows/page.tsx`) — all podcasts across the agency, grouped by client, with capacity indicators and RSS status badges.

Each show stores: name, host (the primary on-mic voice), description, artwork URL, RSS URL, AI-generated voice description, global custom instructions, and per-platform custom instructions.

---

## 7. Episodes and the generation pipeline

**Episode list** (`app/(dashboard)/episodes/page.tsx`) — full-text search, filter by status/show/date range, 25 per page.

**New episode wizard** (`app/(dashboard)/episodes/new/page.tsx`) supports four transcript sources:

- **PASTE** — paste a transcript directly.
- **UPLOAD** — upload an audio file; Deepgram transcribes it via the `transcribeEpisode` Inngest job.
- **RSS** — import from a podcast's RSS feed via the Podcast Index API; falls back to audio transcription if no transcript is provided by the feed.
- **YOUTUBE** — pull captions from a YouTube video.

An episode moves through statuses: **DRAFT → PROCESSING → READY** (or **FAILED**). Once a transcript is available, the `generateEpisode` job fans out generation across all seven platforms.

**Episode detail** (`app/(dashboard)/episodes/[id]/page.tsx`) shows the episode metadata, the seven outputs as cards, and streams real-time generation progress via server-sent events (`/api/episodes/{id}/stream`). Per-output actions include edit, regenerate (with an optional custom instruction), schedule, and approve.

---

## 8. The seven outputs and their approval workflow

The seven platforms — **TWITTER, LINKEDIN, INSTAGRAM, TIKTOK, SHOW_NOTES, BLOG, NEWSLETTER** — each produce one `GeneratedOutput` per episode. Each output tracks:

- **Version history** — regenerating supersedes the current version; older versions are preserved.
- **Edit distance** — Levenshtein delta from the AI's original draft (0 = untouched by a human).
- **Optional quality score** — for retrospective analysis.
- **Approval metadata** — who approved it and when, plus client approval fields if the client-approval flow is in effect.
- **Flagging** — reason, flagged-by, flagged-at, for moderation.
- **Scheduling** — target time, scheduler (Buffer or Manual), external post ID and URL, published-at.
- **Transition log** (`OutputTransition`) — append-only audit trail of every status change.

Outputs progress through: **GENERATING → READY → IN_REVIEW → (AWAITING_CLIENT_APPROVAL) → APPROVED → SCHEDULED → PUBLISHED**, with **FAILED** as a terminal error state.

**Validation modes** are set per client:

- **INTERNAL** — an agency reviewer approves; approved outputs are immediately schedulable.
- **CLIENT** — approved outputs are sent to the client portal for sign-off before they become schedulable. Client approval is a terminal state (`clientApprovedAt`, `clientApprovalEmail`).

Workflow notifications — review requested, client approved, client revision requested — fire via Resend to a per-client notification list and land in the in-app notification inbox.

---

## 9. Voice profiles

Voice is the product's differentiator. Every **show** owns a voice profile made of:

- **Voice samples** — approved outputs promoted into training data, scoped strictly by `(show, platform)` so voices cannot leak between clients.
- **Voice description** — an AI-generated narrative of the show's tone, refreshed automatically by the `refreshVoiceDescription` Inngest job whenever the sample count crosses a threshold.
- **Global custom instructions** — free-form rules that apply across all platforms.
- **Per-platform instructions** — platform-specific tweaks (e.g., "always use British English on LinkedIn").

**Voice page** (`app/(dashboard)/voice/[showKey]/page.tsx`) — per-show editor with strength visualisation, sample approval and rejection, and inline editing of instructions. When a user edits an approved output, the edit distance is captured so the system knows how far the human moved from the AI draft — feeding back into how the voice model evolves.

---

## 10. Scheduling and publishing

**Schedule calendar** (`app/(dashboard)/schedule/page.tsx`) — month view of every SCHEDULED and PUBLISHED output. Days are clickable and open a drawer with per-day detail. Month navigation deep-links via query params.

Two publishing paths:

- **Buffer** — the agency connects Buffer via OAuth in Settings → Integrations. Approved outputs can be pushed to Buffer for the four social platforms Buffer supports (TWITTER, LINKEDIN, INSTAGRAM, TIKTOK). The `syncScheduledOutputs` job keeps status in sync with Buffer.
- **Manual** — the agency publishes elsewhere and flips outputs from SCHEDULED to PUBLISHED themselves. The nightly job auto-publishes MANUAL outputs whose scheduled time has passed.

---

## 11. Settings, team, and billing

`app/(dashboard)/settings/` is a tabbed section:

- **Agency** — name, renewal reminders toggle, plan display with current price, preferred currency (ISO-4217), workspace metadata (creation date, member count, workspace ID), plus a danger-zone delete flow.
- **Billing** — active subscription status and price, cadence (MONTHLY/ANNUAL), scheduled-cancellation state with a resume button, currency picker, and Stripe checkout entry point. Trial banners show `TrialStatus` — NONE/ACTIVE/CONVERTED/EXPIRED/CANCELED — with a countdown when active.
- **Branding** — agency logo (uploaded to Cloudflare R2) and accent colour (7-character hex). Both are applied to the client portal and to exported PDFs/CSVs.
- **Integrations** — Buffer OAuth connect/disconnect, token refresh, per-platform profile mapping, last-sync timestamp, and error state.
- **Team** — member list with roles (OWNER/ADMIN/EDITOR/REVIEWER), pending invites with expiration, send-invite form, role changes, and member removal. Every mutation is logged to `MemberTransition`.

---

## 12. The client portal

The portal (`app/portal/[token]/page.tsx`) is a **public, token-gated** surface — no login required — where an agency's clients can review, approve, and download deliverables.

Portal capabilities:

- **Access control** — a `ClientPortalLink` token is required; links can carry an optional shared password (stored in a path-scoped cookie), an expiry, and a revocation flag. Every view is logged to `ClientPortalAccessLog` with an IP hash and user-agent.
- **Branded surface** — agency logo, accent colour, client name, and optional payment CTA in the header.
- **Summary strip** — published, scheduled, and approved counts (rolling 30 days).
- **Pending approvals** — outputs in `AWAITING_CLIENT_APPROVAL` with an inline approval form. Clients can approve or request revisions.
- **Deliverables tree** — shows → episodes → outputs, each with copy-to-clipboard, platform links, and a per-output feedback form.
- **Statements** — PDF/CSV client billing statements shared to the portal at the agency's discretion.

Client feedback lands in `ClientPortalFeedback` with read/unread state; agency members triage it from the client detail page.

---

## 13. Client billing, statements, and deliverables

Each client can have a **billing profile** (`ClientBillingProfile`) that captures retainer or per-episode rate, currency, renewal date, and an optional payment link. Renewal reminders are dispatched 30 and 7 days ahead of the renewal date by the `checkRenewals` Inngest job (with deduplication via `BillingReminderSent`).

**Client statements** (`ClientStatement`) are period snapshots: episode count, output count, approval count, and cost. Statements are rendered as both **PDF** and **CSV**, persisted to R2, and can be shared to the client portal by setting `sharedWithPortalAt`.

The **deliverable ledger** on the client detail page is the operational view: every generated output the agency has delivered, filterable and paginated, ready to become a statement.

---

## 14. Background jobs

All heavy work runs in **Inngest**. Registered functions today:

- `generateEpisode` — orchestrates the seven-output generation pipeline with plan-based priority.
- `regenerateOutput` — regenerates a single output, optionally with a custom instruction.
- `transcribeEpisode` — sends audio to Deepgram and stores the transcript.
- `importRssEpisode` — resolves an RSS feed via Podcast Index and imports; falls back to audio transcription when the feed provides no transcript.
- `importYoutubeEpisode` — pulls captions from a YouTube video.
- `refreshVoiceDescription` — regenerates a show's AI voice description when the sample threshold is crossed.
- `checkRenewals` — sends 30- and 7-day renewal reminders.
- `checkOnboardingNudges` — drop-off recovery emails at 24 and 72 hours.
- `checkTrialNudges` — mid-trial nudge on day 2 of the 7-day trial.
- `cleanupOrphanAudio` — deletes unused R2 audio objects.
- `nightlyUsageRollup` + `backfillUsageRollup` — writes daily per-agency usage snapshots (episodes, outputs, cost, revenue).
- `syncScheduledOutputs` — reconciles Buffer status and auto-publishes overdue MANUAL outputs.

Every event carries plan and agency identifiers so the runner can enforce concurrency and priority per tenant.

---

## 15. API and webhooks

**Webhooks (inbound):**

- `/api/webhooks/clerk` — user and (residual) organisation sync.
- `/api/webhooks/stripe` — subscription lifecycle → `Agency.stripeSubscriptionId`, `plan`, `billingCadence`, `trialStatus`, `trialEndsAt`, `subscriptionCancelAt`.

Idempotency for every provider is tracked in `WebhookDelivery`.

**Integration OAuth:**

- `/api/integrations/buffer/connect`, `/callback`, `/disconnect`, `/refresh`.

**Inngest:**

- `/api/inngest` — the function-handler endpoint.

**Application APIs:**

- `/api/episodes/{id}/stream` — SSE stream of live generation progress.
- `/api/episodes/{id}/export` — episode data export (CSV/JSON).
- `/api/clients/{id}/deliverables` — client deliverable list.
- `/api/clients/{id}/statements/{statementId}` — statement PDF/CSV download (signed R2 URL).
- `/api/portal/{token}/statements/{id}/pdf` — portal-scoped statement PDF download.

**Operations:**

- `/api/health` — liveness probe.
- `/api/root/finance/invoices.csv` — ROOT-only invoice export.

---

## 16. Data model

The Prisma schema (`prisma/schema.prisma`) defines the tenant boundary, workflow, billing, portal, admin, and moderation surfaces.

**Tenancy and workflow:**

- `Agency` — tenant root. Owns Stripe IDs, plan, billing cadence and currency, branding, trial state, and suspension flags.
- `Member` — user-per-agency link with role.
- `MemberInvite` — tokenised invites with expiry.
- `Notification` — in-app workflow notifications.
- `MemberTransition` — append-only audit of team changes.

**Content:**

- `Client`, `Show`, `Episode`, `GeneratedOutput`, `VoiceSample`.
- `OutputTransition` — append-only audit of output status changes.

**Billing:**

- `ClientBillingProfile`, `ClientStatement`, `Invoice`, `UsageLog`.
- `BillingReminderSent`, `OnboardingNudgeSent`, `TrialNudgeSent` — email dedup ledgers.
- `WebhookDelivery` — provider webhook idempotency.

**Portal:**

- `ClientPortalLink`, `ClientPortalAccessLog`, `ClientPortalFeedback`.

**Platform administration:**

- `SystemAdmin`, `SystemAuditLog`, `SystemConfig`.
- `AgencyLimitOverride`, `AgencyUsageSnapshot`.

**Moderation and integrations:**

- `AbuseReport`, `AgencyIntegration`.

Key enums power the workflow: `Plan`, `MemberRole`, `Platform`, `EpisodeStatus`, `OutputStatus`, `ValidationMode`, `NotificationKind`, `ExternalScheduler`, `TranscriptSource`, `InvoiceStatus`, `BillingCycle`, `ClientStatus`, `BillingCadence`, `MemberTransitionKind`, `InviteStatus`, `TrialStatus`, `SystemAdminRole`, `LimitOverrideResource`, `AbuseReportCategory`, `AbuseReportStatus`.

---

## 17. Integrations

| Integration                                          | Status                | What it powers                                                                                                                                         |
| ---------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Anthropic Claude** (`server/ai/`)                  | Wired and used        | All output generation, voice description, key-moment extraction. Model constant is centralised for easy version bumps (currently `claude-sonnet-4-6`). |
| **Deepgram**                                         | Wired and used        | Audio-to-transcript for UPLOAD and RSS-fallback flows via the `transcribeEpisode` job.                                                                 |
| **Stripe** (`server/billing/stripe.ts`)              | Wired and used        | Checkout, subscription lifecycle, invoice retrieval, trial state, cancel/resume.                                                                       |
| **Resend** (`server/db/notifications.ts`)            | Wired and used        | Workflow notifications, renewal reminders, onboarding nudges, trial nudges — all fire-and-forget with logged failures.                                 |
| **Cloudflare R2** (`server/storage/r2.ts`)           | Wired and used        | Audio uploads, statement PDFs and CSVs, branding logos, signed-URL downloads.                                                                          |
| **Podcast Index** (`server/imports/podcastindex.ts`) | Wired and used        | RSS feed lookup with custom SHA-1 HMAC auth.                                                                                                           |
| **Buffer** (`server/integrations/buffer.ts`)         | Wired and used        | Social scheduling and publishing for TWITTER, LINKEDIN, INSTAGRAM, TIKTOK. OAuth with refresh-token handling.                                          |
| **PostHog** (`server/analytics/feature-flag.ts`)     | Wired (feature flags) | Server-side flag decisions.                                                                                                                            |
| **Sentry**                                           | Optional / lazy       | Error tracking; opt-in via env vars.                                                                                                                   |

Every integration is **lazy-initialised** — if its env vars are absent, the related code path skips silently so `next build` succeeds on a fresh clone with no keys.

---

## 18. Platform administration (ROOT)

Repodcast ships a small internal-admin surface for Anthropic-side operators, separate from the agency-facing app.

- **Roles** — ROOT, OPERATOR, SUPPORT, ANALYST (`SystemAdmin`), MFA-enforced, soft-delete preserved.
- **Audit log** — every ROOT-level mutation is appended to `SystemAuditLog` with action key, before/after JSON, IP, and user-agent.
- **Configuration** — key/value platform toggles in `SystemConfig`, each change audit-logged.
- **Agency controls** — suspension, limit overrides (`AgencyLimitOverride` on shows, members, episodes/month, generations/month), nightly usage snapshots (`AgencyUsageSnapshot`).
- **Finance** — invoice ledger export at `/api/root/finance/invoices.csv`.

---

## 19. Trust, safety, and abuse handling

- **Abuse intake** — public form at `app/legal/report/` captures reports; entries land in `AbuseReport` with category (SPAM, COPYRIGHT, IMPERSONATION, HARASSMENT, OTHER) and triage state (OPEN, IN_REVIEW, RESOLVED, DISMISSED).
- **Output flagging** — any output can be flagged with a reason, member, and timestamp for moderation review.
- **Portal access logs** — every portal view records an IP hash and user-agent, giving agencies visibility into who has accessed shared deliverables.
- **Password-protected portal links** — optional shared password required alongside the token, stored in a path-scoped cookie.

---

## 20. Notable engineering choices

- **Not the Clerk-Organizations flow** — Repodcast uses its own `Member` + `MemberInvite` tables. Clerk handles user identity; team membership is Repodcast's.
- **Soft-delete everywhere it matters** — audit-relevant tables preserve history through soft-delete rather than hard-delete, so post-hoc investigation stays possible.
- **Append-only audit logs** — `OutputTransition`, `MemberTransition`, `SystemAuditLog`, `ClientPortalAccessLog`.
- **Sample-data mode** — when `DATABASE_URL` is absent, `lib/sample-data/` renders every page against a seeded fixture set so design and demo flows work without a live database. Inngest and SSE are skipped in this mode.
- **Per-tenant priority** — Inngest events carry the agency's plan so the job runner can enforce concurrency and priority per tenant.
- **Multi-currency-native** — currency is ISO-4217 free-form on `Agency` and `ClientBillingProfile`; there is no hard-coded USD assumption in the client-billing surface. Internal cost accounting is in cents USD (`UsageLog.costCents`).
- **Lazy integrations** — every third-party client is initialised on first use and gracefully absent if its env vars are missing, so contributors can spin up the app without every key.

---

_Last updated as of the current dev branch. Add new sections here as capabilities ship — one section per major surface, and update the corresponding entries in [§16 Data model](#16-data-model) and [§17 Integrations](#17-integrations) if the change touches the schema or a third-party._

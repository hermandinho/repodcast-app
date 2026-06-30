# Repodcast — Build Roadmap

> Exhaustive, dependency-ordered task list. Work top to bottom within each phase.
> `- [x]` = done. `- [~]` = partial (see note). `- [ ]` = pending.
>
> When in doubt, pick the next `- [ ]` or `- [~]` task whose phase's exit criteria
> isn't met yet, do it, mark it, run typecheck + test, commit, repeat.

---

## Status snapshot

**Foundations (Phase 0):** **~95% done** — scaffold, Prettier/Husky/lint-staged, design system, expanded UI primitive library, app shell, all five UI screens, Prisma schema, Clerk auth, Sentry/PostHog/Inngest/R2 wiring, multi-tenant repo layer, **AI prompt foundation (7 production prompts + builder + key-moment extractor + validation script)**, 39-test Vitest harness. Open: voice-validation gate against real transcripts (needs `ANTHROPIC_API_KEY`), remaining UI primitives, live Neon migration, Vercel deploy.

**MVP (Phase 1):** **~97% done** — **1.0 self-service onboarding wired as a 3-step wizard** (Workspace → Teammates → First client; steps 2/3 skippable). `createAgencyAction` creates Agency+OWNER Member in-app, `getAuthContext` decoupled from Clerk `orgId`, three-state routing matrix enforced in the dashboard layout, demo-agency fallback gated to dev-only. All screens read through the data-source shim. Full **client + show CRUD** with polished modals (live preview, sectioned layout, artwork upload, validation, Cmd/Ctrl+Enter, mount-on-open state pattern). **R2 artwork upload** end-to-end including a CORS bootstrap script + dashboard fallback for non-bucket-admin tokens; artwork renders across detail pages, list cards, and embedded show rows. **Dashboard KPIs** compute from real aggregates. **Stripe billing scaffolding** with usage meters, plan ladder, invoice list, checkout/portal server actions, signature-verified webhook syncing Agency.plan + Invoice rows. **Plan-limit enforcement** + per-plan cost-cap in the Inngest orchestrator. **Resend email** (welcome + generation-complete). All three Inngest functions live (generate, regenerate, refresh-voice-description). **Settings hub** (`/settings/{billing,team,branding}`). **Team page** with homegrown invite flow, role changes, OWNER transfer, member removal, all seat-capacity-guarded. **Landing page** (`app/page.tsx`) renders auth-aware CTAs (signed-in users see "Open dashboard" everywhere; signed-out users see "Sign in" / "Start free"). **Open before MVP ships:** end-to-end Inngest integration test (real Anthropic + Inngest dev server, gated on a test DB), integration tests against a real Clerk + Neon, real Stripe price IDs in env, audio/RSS/YouTube inputs, scheduling.

**Voice moat (Phase 2) + Growth (Phase 3):** Voice page wired to live data with empty-state polish (AI-summary callout shows a "Approve a few outputs and the engine will write a summary here" prompt when `voiceDescription` is null; samples grid shows a dashed-border card with a "Generate an episode →" CTA when there are zero approved samples; filter chips hidden when there's nothing to filter; back link to the show added). Generation pipeline is built (1.5). Most of the rest is downstream of finishing Phase 1. **2.13 Client management & billing support is now spec'd** (`ref/Specs.docx` §4.4) and planned in the Phase 2 section — `ClientBillingProfile` + `ClientStatement` + `ClientPortalLink` schema, deliverable ledger derived from existing rows, cost-to-serve from `UsageLog`, white-labeled period statements (PDF/CSV), renewal-reminder cron, signed deliverables webhook, tokenized client portal. **Hard scope boundary: Repodcast never collects, holds, or processes payments** between agencies and their clients — system-of-record + reporting layer only.

**Blocked on user input (no code work can unblock these):**

- Neon `DATABASE_URL` + `DIRECT_URL` → first migration + seed → real data in pages
- Clerk webhook endpoint URL → invite-flow side-channel + member sync (post-1.0 this is a side-channel, not the agency-creation source of truth)
- PostHog / Sentry DSNs → analytics + error capture live
- Stripe products + price IDs → checkout + plan enforcement
- R2 bucket + API token → artwork/audio uploads
- Vercel project import → preview deploys per PR

Until these are set, every integration is wired but skips silently — `next build` and `npm run test` both stay green on a fresh clone with no env.

---

## Quick reference

```bash
npm run dev               # Next dev server (Turbopack)
npm run dev:inngest       # Local Inngest dev server (run alongside dev)
npm run build             # Production build
npm run lint              # ESLint (flat config)
npm run test              # Vitest (unit + tenant-isolation)
npm run test:watch        # Vitest watch
npm run db:generate       # Regenerate Prisma client
npm run db:migrate        # prisma migrate dev (needs DIRECT_URL)
npm run db:migrate:deploy # CI/prod migrations
npm run db:seed           # Seed the Northbeam demo agency
npm run db:studio         # Prisma Studio
npm run typecheck         # tsc --noEmit
npm run format            # Prettier write
npm run format:check      # Prettier check (CI)
npm run ai:validate       # Voice-quality validation script (needs ANTHROPIC_API_KEY)
```

---

## Tech stack (reference)

- **Frontend:** Next.js 16.2.9 (App Router, Turbopack), React 19.2, TypeScript, Tailwind CSS v4, Sora + Inter, Recharts (chart for dashboard — not installed yet, current inline SVG bars stand in)
- **Backend/data:** Next.js Route Handlers + Server Actions, Prisma 7 (Postgres via `@prisma/adapter-pg`), Inngest 4, Server-Sent Events
- **AI/transcription:** Anthropic Claude (`claude-sonnet-4-6`), Deepgram Nova-2 (Whisper fallback), Podcast Index API, YouTube Transcript API
- **Auth/billing:** Clerk 7 (with Organizations), Stripe (+ webhooks)
- **Infra:** Vercel, Cloudflare R2, Resend
- **Monitoring:** PostHog, Sentry 10
- **Testing:** Vitest 4 + @vitest/coverage-v8

## Domain model (reference)

`Agency` → `Member` (role).
`Agency` → `Client` (customer — agency / hosted person) → `Show` (podcast — owns voice) → `Episode` → `GeneratedOutput` / `VoiceSample`.

Each `Show` carries its own `host`, `voiceDescription`, `globalInstructions`, `rssUrl`, `artworkUrl`, and per-platform `ShowPlatformInstruction` rows. Voice samples are scoped to a Show (each podcast has its own host with its own voice).

**Phase 2.13 (planned, not yet built):** `Client` → `ClientBillingProfile` (1:1) → `ClientStatement` (per-period snapshots) → `ClientPortalLink` (tokenized read-only access) → `ClientPortalAccessLog` (audit).

Plans: `STUDIO` · `AGENCY` · `NETWORK`. Roles: `OWNER` · `ADMIN` · `EDITOR` · `REVIEWER`.
Platforms: `TWITTER` · `LINKEDIN` · `INSTAGRAM` · `TIKTOK` · `SHOW_NOTES` · `BLOG` · `NEWSLETTER`.
Episode statuses: `DRAFT` · `PROCESSING` · `READY` · `ARCHIVED`.
Output statuses: `GENERATING` · `READY` · `IN_REVIEW` · `APPROVED` · `SCHEDULED` · `PUBLISHED` · `FAILED`.
Phase-2.13 enums (planned): Billing cycles: `MONTHLY` · `QUARTERLY` · `ANNUAL` · `PROJECT`. Client statuses: `ACTIVE` · `PAUSED` · `CHURNED`.

## Conventions

- [x] Folder layout: `app/`, `components/`, `lib/`, `server/` (auth, db, storage; AI lands in Phase 1.4), `inngest/`, `prisma/`, `tests/`
- [x] All DB access via `server/db/*` repository helpers (never inline Prisma in routes)
- [x] Repository helpers always take a `TenantContext` and filter by `agencyId` (see `server/auth/tenant.ts`)
- [x] Zod schemas exposed from each repo; routes/server-actions validate input against them
- [ ] All AI calls go through `server/ai/*` (lands in 1.4)
- [x] Server-only modules import `"server-only"` (Vitest aliases this to an empty shim — see `tests/shims/server-only.ts`)
- [x] Errors thrown by repos extend `AppError` with a `statusCode` (`ForbiddenError` 403, `NotFoundError` 404, `ValidationError` 422)

## Next.js 16 notes (read before scaffolding new routes)

Full deltas in `node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md`.

- **Async request APIs:** `params`, `searchParams`, `cookies()`, `headers()`, `draftMode()` are all `Promise`s — `await` them in every layout/page/route handler/metadata function.
- **Middleware → Proxy:** Next 16 deprecates `middleware.ts` in favour of `proxy.ts` (Node-only). **We're still on `middleware.ts`** because Clerk 7.5 doesn't ship a `clerkProxy` companion. Switch when Clerk publishes proxy support.
- **Fetch + Route Handlers no longer cached by default.** Opt in with `cache: 'force-cache'` on fetch or `export const dynamic = 'force-static'` on the segment. Webhooks + SSE set `dynamic = 'force-dynamic'` explicitly.
- **`revalidateTag(tag, profile)`** requires a second arg in Next 16. New `updateTag()` provides read-your-writes for server actions.
- **Turbopack is default** in dev _and_ build — no `--turbopack` flags needed.
- **`next lint` removed.** Use the ESLint CLI directly with flat config.
- **`images.domains` deprecated** — use `images.remotePatterns`.
- **Parallel routes:** every `@slot` requires a `default.tsx` or builds fail.
- **`cacheComponents: true`** is the new PPR opt-in. Decision deferred — not adopted yet.

---

# Phase 0 — Foundations

> Goal: scaffold, design system, persistence, auth, infra, multi-tenant guardrails.

## 0.1 Project scaffold & tooling

- [x] `create-next-app` (Next 16.2.9, React 19.2, Tailwind v4, ESLint, TypeScript, App Router)
- [x] `tsconfig` paths/aliases (`@/*` → `./*`)
- [x] ESLint flat config (`eslint.config.mjs` using `eslint-config-next/core-web-vitals` + `/typescript`)
- [x] `npm run dev`, `build`, `start`, `lint`
- [x] `npm run test`, `test:watch` (Vitest 4 — added in Phase 1.1)
- [x] Folder structure: `app/`, `components/`, `lib/`, `server/`, `inngest/`, `prisma/`, `tests/`
- [x] `README.md` (quickstart, env vars, deploy walkthrough, scripts)
- [x] `.gitignore` allows `.env.example` (negation for the `.env*` glob)
- [x] Prettier config (`.prettierrc` + `.prettierignore` + `prettier-plugin-tailwindcss`)
- [x] `typecheck`, `format`, `format:check` npm scripts
- [x] Husky + lint-staged pre-commit — `.husky/pre-commit` runs lint-staged (Prettier + ESLint on staged files) then `npm run typecheck`. `prepare` script auto-installs hooks.

## 0.2 Environment & accounts

- [x] `.env.example` — full variable list grouped by phase (DB, AI, Auth, Stripe, R2, Resend, PostHog, Sentry, Podcast Index, Inngest)
- [~] Accounts: Clerk created (test keys in place). **Pending:** Anthropic, Deepgram, Neon, Stripe, R2, Resend, PostHog, Sentry, Podcast Index, Inngest, Vercel.

## 0.3 Database & ORM

- [x] Prisma 7.8 + `@prisma/adapter-pg` + `pg` installed (Prisma 7 requires a driver adapter)
- [x] `prisma.config.ts` — Prisma 7 moved connection URLs out of `schema.prisma`; this file points migrations at `DIRECT_URL ?? DATABASE_URL` and declares the seed command
- [x] `prisma/schema.prisma` — enums `Plan`, `MemberRole`, `Platform`, `EpisodeStatus`, `OutputStatus`, `TranscriptSource`, `InvoiceStatus`
- [x] Models: `Agency`, `Member`, `Client`, `ClientPlatformInstruction`, `Episode`, `GeneratedOutput`, `VoiceSample`, `UsageLog`, `Invoice`
- [x] `createdAt`/`updatedAt` on every long-lived model; `@@index` on every FK; multi-column indexes on hot paths (`UsageLog([agencyId, createdAt])`, `VoiceSample([clientId, platform])`)
- [x] Cascade deletes for owned children, `SetNull` for historical pointers
- [x] `server/db/client.ts` — lazy-initialised PrismaClient singleton (HMR-safe, doesn't throw on import when `DATABASE_URL` unset)
- [x] `prisma/seed.ts` — idempotent seed of the Northbeam demo agency (3 clients × 1 episode × 7 outputs + voice samples + per-platform instructions)
- [ ] Apply first migration against Neon (`npm run db:migrate -- --name init`) — **blocked on `DATABASE_URL`/`DIRECT_URL`**
- [ ] Run `npm run db:seed` against the live DB

## 0.4 Auth foundation (Clerk)

- [x] `@clerk/nextjs` 7.5 + `svix` installed
- [x] `<ClerkProvider>` in root layout with brand-matched appearance
- [x] `middleware.ts` — `clerkMiddleware` + `createRouteMatcher`; public routes: `/sign-in`, `/sign-up`, `/api/webhooks/*`, `/api/inngest`; everything else hits `auth.protect()`
- [x] `/sign-in/[[...sign-in]]` and `/sign-up/[[...sign-up]]` Clerk catch-all routes
- [x] `app/api/webhooks/clerk/route.ts` — `force-dynamic`, svix signature verify, dispatch on `organization.*`, `organizationMembership.*`, `user.updated/deleted`
- [x] `server/db/auth-sync.ts` — `upsertAgencyFromClerkOrg`, `upsertMemberFromClerkMembership` (lazily upserts agency on race), `deleteAgencyByClerkOrgId`, `deleteMemberByClerkIds`, `refreshMembersForClerkUser`
- [x] `server/auth/context.ts` — `getAuthContext()`, `requireAuthContext()` (redirects to `/sign-in`), `assertRole(ctx, allowed)`
- [x] Sidebar user card pulls from `getAuthContext()` (replaces the static "Eli Mara" demo data)
- [ ] Enable Clerk Organizations in the Clerk dashboard + create webhook subscription pointing at deployed `/api/webhooks/clerk` — **blocked on Clerk dashboard config** (interim only — 1.0 makes the webhook a side-channel for invites rather than the source of truth for agency creation)
- [x] ~~Decision: when to promote one ADMIN to OWNER~~ → resolved by 1.0 (first member of an in-app-created agency is OWNER, via `createAgencyAction`)
- [ ] Track Clerk's `clerkProxy` release; switch `middleware.ts` → `proxy.ts` when available

## 0.5 Design system & app shell

- [x] Tailwind v4 `@theme` tokens — brand/surface/text/border/accent/status/voice/platform colors, radii, shadows, font families (`globals.css`)
- [x] Sora (display) + Inter (body) via `next/font/google`
- [x] Shared animations in `globals.css`: `spin`, `shimmer`, `pop`, `grow`
- [x] App shell: 236px navy `<Sidebar>` (brand mark, 7 nav items, user card), 60px white `<Topbar>` (workspace label, `<ClientSwitcher>` reading the URL, New episode CTA)
- [x] `<NavLink>` (client) with active-route highlighting
- [x] `<ClientSwitcher>` matches `/clients/[key]`, `/voice/[key]`, `/episodes/[key]` and reflects the selected client
- [x] Five mockup screens built and verified end-to-end:
  - `/dashboard` — KPI tiles, 8/12-week chart toggle, recent episodes list, sticky activity rail
  - `/clients` and `/clients/[key]` — grid + detail with per-platform voice strength
  - `/episodes/new` — 4-step wizard (client → source → platforms → review/generate)
  - `/episodes/[id]` — output grid with all states (generating spinner+shimmer, edit, regenerate panel, approve toast) + sticky right rail
  - `/voice/[clientKey]` — AI summary callout, strength-by-platform, custom-instructions editor, approved-samples browser with filter chips
- [x] Reusable primitives built so far: `<VoiceStrengthBars>` (sm/md/lg), `<StatusPill>`, `<PlatformBadge>` (sm/md), `<Toggle>`, `<Button>` (4 variants × 3 sizes), `<Card>` (default/accent tones, 2xl/3xl radii), `<Input>`, `<Textarea>`, `<Modal>` (+ `ModalHeader`/`ModalBody`/`ModalFooter`, native `<dialog>` with backdrop)
- [ ] Refactor existing pages to use the primitives (currently still inline-Tailwind; will migrate alongside server-action wiring in Phase 1.3 / 1.7)
- [ ] Remaining primitives to extract: `Select`, `Tabs`, `Tooltip`, `Toast`, `Skeleton`, `Avatar`, `Badge`
- [ ] Tokens reference doc (extracted colors/radii/shadows in `docs/design-tokens.md`)

## 0.6 Infra wiring

- [x] **Sentry** — `@sentry/nextjs` 10; `sentry.{client,server,edge}.config.ts` no-op when DSN unset; `instrumentation.ts` dispatches by `NEXT_RUNTIME`; `next.config.ts` wraps with `withSentryConfig` only when DSN is set; re-exports `captureRequestError` as `onRequestError`
- [x] **PostHog** — `posthog-js`; `<PostHogProvider>` client component, lazy-init when `NEXT_PUBLIC_POSTHOG_KEY` set; emits `app_loaded` + `$pageview` on every App Router navigation (Suspense-wrapped `useSearchParams` so root layout stays server-rendered); mounted in root layout
- [x] **Inngest** — `inngest/client.ts` (`Inngest({ id: "repodcast" })`), `inngest/functions.ts` (no-op `helloFn` on `test/hello`), `app/api/inngest/route.ts` (serve handler with `force-dynamic`); added `/api/inngest` to middleware public matcher; `dev:inngest` npm script
- [x] **R2** — `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`; `server/storage/r2.ts` exposes lazy `getR2Client()`, strict `requireR2Client()`, and helpers `putR2Object`, `deleteR2Object`, `signR2UploadUrl`, `signR2DownloadUrl`
- [x] **R2 CORS bootstrap** — `scripts/configure-r2-cors.ts` + `npm run r2:cors` apply `PUT/GET/HEAD` CORS for `http://localhost:3000`, `http://localhost:3001`, and `NEXT_PUBLIC_APP_URL`. Script needs an Admin Read+Write R2 token; the runtime token can stay narrowly scoped to object read/write. Dashboard JSON fallback documented for users without bucket-admin tokens. Without this, direct browser uploads to `<account>.r2.cloudflarestorage.com` fail with `xhr.onerror` before R2 ever sees them — the client-side error message in `<ArtworkUpload>` now points at this fix explicitly.
- [ ] Connect repo to Vercel; configure env vars; preview deploys per PR — **blocked on user**
- [ ] Configure Clerk webhook URL after first Vercel deploy — **blocked on user**

## 0.7 Multi-tenant scoping & repository layer

> Originally Phase 1.1; pulled forward because every Phase 1 task depends on it.

- [x] `server/auth/errors.ts` — `AppError`, `ForbiddenError` (403), `NotFoundError` (404), `ValidationError` (422)
- [x] `server/auth/tenant.ts` — `TenantContext` type, `toTenantContext(authContext)`, `requireRole(ctx, allowed)`
- [x] `server/db/clients.ts` — full CRUD repo, role-gated, `updateMany`/`deleteMany` patterns for atomic tenant filtering, Zod schemas exposed
- [x] `server/db/episodes.ts` — list/get/create with `client.agencyId` join filter; `createEpisode` verifies target Client belongs to caller's agency
- [x] `server/db/outputs.ts` — list/get/update/approve (transactional + writes `VoiceSample`)/markRegenerating/`qualityByPlatformForEpisode`; double-nested tenant filter (`episode.client.agencyId`)
- [x] `server/db/voice-samples.ts` — list per client, `countSamplesByPlatform` (groupBy), `createSampleFromOutput` (used by `approveOutput`)
- [x] Vitest + V8 coverage installed; `vitest.config.ts` with `@`-alias + `server-only` shim
- [x] `tests/server/auth/role-guard.test.ts` — 6 tests on `requireRole` + error class hierarchy
- [x] `tests/server/db/tenant-isolation.test.ts` — 16 tests asserting every read/write helper's `where` clause includes the correct `agencyId` (single, nested, double-nested); role gates reject wrong roles; cross-tenant access surfaces as `NotFoundError`
- [ ] Integration tests against a real test database (Phase 1.5 needs this; pair with the Neon migration once URLs are live)

## 0.8 Voice quality validation (research track)

> Originally a hard gate before any UI work. Postponed because the UI is faster to build than the validation is to set up; now runs in parallel with Phase 1.4 prompt work so prompt iterations are graded against real benchmarks before they ship.

- [x] `scripts/validate-voice.ts` — takes `--transcript <file>` + `--voice <json>` or `--client {ff|te|mt}` + optional `--platforms` filter, calls Claude in parallel, writes per-platform outputs + `summary.md` to `docs/voice-validation/{timestamp}/`. Records per-platform token usage including cache reads.
- [x] First-draft prompts for all 7 platforms (`server/ai/prompts/*.ts`) — these double as the **production** prompts (1.4); validation runs the same code paths the generation pipeline will use
- [x] `npm run ai:validate` script wiring
- [ ] Collect 5–10 real transcripts from target-size shows
- [ ] Run validation; compare on-voice quality head-to-head against a Castmagic/Podsqueeze pass (**blocked on `ANTHROPIC_API_KEY` + benchmark transcripts**)
- [ ] **GATE on 1.5:** Don't ship the generation pipeline until output is at least as on-voice as competitors. Record findings in `docs/voice-validation/summary.md` (or a hand-written summary referencing each run).

**Exit criteria for Phase 0:** App deploys to Vercel behind Clerk auth; DB migrated + seeded; design system renders; Sentry/PostHog/Inngest reachable; repository layer enforces tenancy with passing tests. **Voice validation may run in parallel with Phase 1.4 but must clear before Phase 1.5 ships.**

---

# Phase 1 — MVP (paid users generating outputs)

> Goal: a real agency can sign up, add a client, paste a transcript, get all 7 text outputs, edit/approve, hit a plan limit, and pay. Quality is instrumented from day one.

## 1.0 Self-service onboarding (decouple Agency from Clerk Orgs)

> **Premise:** this is a paid self-service SaaS. A new user signs up, names their agency, and is in — without us touching the Clerk dashboard or relying on a Clerk Organization webhook. Clerk handles user auth + sessions only; **agency creation is an in-app server action**. This is a prerequisite for shipping to real users.

### Why this lands here (not in 2.10 as originally drafted)

- Today: `getAuthContext()` keys on Clerk's `orgId`; `Agency` rows are upserted only when the `organization.created` webhook fires. A signed-in user without a Clerk org has no in-app path to creating one — they fall through `resolveTenantContext()` to the seeded "Northbeam Studio" demo agency, which is fine for `npm run dev` but unacceptable in production (real signups would silently attach to the demo tenant).
- 1.2's "first sign-up onboarding stub" and 0.4's "when to promote OWNER" decision are both blocked on this — both get resolved by 1.0.

### Architectural shift

- [x] **Agency lifecycle moves in-app**
  - New `createAgencyAction({ name, plan })` — Zod-validated, requires an authenticated Clerk user, single `$transaction` that creates the `Agency` row + an initial `Member` row with role `OWNER` (clerkUserId + email + name pulled from `currentUser()`).
  - Fires `sendWelcomeEmail` here (currently fired from the Clerk webhook on first-member sync; move the trigger so self-serve signups still get welcomed).
  - First member of any in-app-created agency is **OWNER, full stop** — closes the "Clerk only ever assigns ADMIN" footgun from 0.4.
  - **Decision (interim):** ~~keep creating a backing Clerk Organization in the same action and store its id in `Agency.clerkOrgId`~~ **superseded** — the homegrown invite flow (see follow-up below) replaced Clerk Orgs entirely, so `createAgencyForUser` no longer provisions one. `Agency.clerkOrgId` stays on the schema for legacy rows.
  - Implementation: `server/db/agencies.ts` exposes `createAgencyForUser(input)` (DB transaction creates Agency + OWNER Member → welcome email best-effort). `app/onboarding/actions.ts#createAgencyAction` is the server-action entry point with double-submit guard via `userHasAnyMembership(clerkUserId)`.

- [x] **Active-agency resolution no longer reads Clerk's `orgId`**
  - `getAuthContext()` switches to: look up `Member` rows where `clerkUserId == userId`, pick the active one.
  - MVP: single member-row assumption (or most-recently-updated if multiple). True multi-agency switching deferred.
  - Follow-up: cookie-backed `active_agency_id` + topbar agency switcher (mirrors the existing `<ClientSwitcher>` pattern).
  - Implementation: `server/auth/context.ts#getAuthContext` now queries `prisma.member.findFirst({ where: { clerkUserId }, orderBy: { updatedAt: "desc" }, include: { agency } })`.

- [x] **Routing + redirects — three states**
  1. Unauthenticated → `/sign-in` (existing middleware behaviour)
  2. Authenticated, **zero** `Member` rows → `/onboarding`
  3. Authenticated with a `Member` → normal dashboard
  - Enforced inside `app/(dashboard)/layout.tsx` (server component, `await getAuthContext()` → `redirect("/onboarding")` when null). Keeps middleware cheap (no DB lookup per request).
  - `app/onboarding/layout.tsx` does the inverse: if the user already has a `Member`, `redirect("/dashboard")` — prevents loops.
  - `/onboarding` is NOT in the middleware's public matcher (`auth.protect()` still runs so unauthenticated users redirect to `/sign-in`). The matcher didn't need updating.

- [x] **Remove the production demo-agency fallback**
  - Today: signed-in user with no Member → `resolveTenantContext()` returns the seeded "Northbeam Studio" agency. That would attach real signups to the demo tenant.
  - After: gate that branch behind `process.env.NODE_ENV !== "production"`. Sample-data mode (no `DATABASE_URL`) still returns the synthetic tenant for the design-time experience.
  - Implementation: `server/data/tenant.ts#resolveTenantContext` now wraps the demo-agency lookup in `process.env.NODE_ENV !== "production"`. Belt-and-braces with the dashboard-layout redirect (which fires first in practice).

### Onboarding flow (`/onboarding`)

Three forward-only steps: **Workspace → Teammates → First client**. The trailing two are skippable since both are reachable from Settings → Team and the dashboard's `<GetStarted>` card. Refreshing mid-wizard bounces to `/dashboard` (the layout gate sees the OWNER `Member` row created in step 1), which is acceptable since no data is lost — only optional steps are skipped.

- [x] **Step 1 — Agency basics (required)**
  - Fields: agency name (defaults to `"{firstName}'s Studio"`), plan tier picker (Studio / Agency / Network — Studio by default; real plan upgrade still goes through Stripe checkout from `/settings/billing` post-onboarding).
  - Submit → `createAgencyAction` → advance to step 2.
- [x] **Step 2 — Invite teammates (optional)**
  - Up to 5 email + role rows (Editor/Admin), per-row validation + per-row error state. `Promise.allSettled` over `inviteMemberAction` so partial failures don't block. Primary CTA flips to "Skip for now" when no emails are entered; explicit Skip button shown when at least one row is filled.
- [x] **Step 3 — First client (optional)**
  - Single name field calling `createClientAction`. Primary CTA flips to "Skip & finish" when empty. On success or skip → `router.push("/dashboard")`.
- [x] **Stepper** — three numbered circles, brand-blue active, mint check when completed, outlined grey when upcoming. Connecting line fills brand-blue between completed steps.

### Dashboard empty-state (`<GetStarted>`)

- [x] On `/dashboard`, when the agency has zero shows, replace the KPI / chart layout with a guided card adapted to the hierarchy:
  - **1. Add your first client** — primary CTA, opens the existing `<ClientFormModal>` inline. Once a client exists, this card flips to "Done" + the second card becomes primary.
  - **2. Add a show** — primary CTA after step 1 is done. Opens `<ShowFormModal>` inline with the user's first client preselected as the parent (previously redirected to `/clients`, which was a dead end). Disabled with hint "Add a client first" until step 1 is done.
  - **3. Generate your first episode** — disabled until both 1 and 2 are done; links to `/episodes/new` once unlocked.
- Sample-data mode always renders the populated dashboard so the design preview stays representative.
- Once a show is added, the page renders the normal dashboard on next request.

### What we keep using Clerk for

- **User auth** — sign-in / sign-up screens, sessions, password reset (unchanged).
- **User profile data** — `currentUser()` for email + name.
- **Invitations (interim)** — `inviteMemberAction` still calls `clerkClient().organizations.createOrganizationInvitation()`. Requires the backing Clerk Org we create in step 1. Replacing this with a homegrown token-based flow drops Clerk Orgs entirely — follow-up.

### Resolves elsewhere in the plan

- **0.4** "Decision: when to promote one ADMIN to OWNER" → first member of an in-app-created agency is OWNER, in `createAgencyAction`.
- **1.2** "First sign-up onboarding stub: prompt to create org" → replaced with the full `/onboarding` flow below.
- **2.10** "Onboarding flow + voice calibration + 5-minute time-to-value" → moves here. 2.10 becomes the _polish_ section (funnel analytics, progress restoration, drop-off recovery emails).

### Out of scope (deferred follow-ups)

- Multi-agency-per-user with cookie-backed active selection + topbar agency switcher
- ~~Homegrown token-based invite flow that drops Clerk Organizations entirely~~ **landed** — see "Homegrown invite flow" below
- Custom subdomain per agency (Phase 2.5 white-label dependency)
- Onboarding analytics funnel + drop-off recovery (stays in 2.10)

### Homegrown invite flow (1.0 follow-up — shipped)

- [x] **Schema:** new `MemberInvite` model + `InviteStatus` enum (`PENDING | ACCEPTED | REVOKED | EXPIRED`). Token is an opaque cuid with a `@unique` constraint. Indexed by `(agencyId, status)`, `email`, `invitedByMemberId`.
- [x] **Repo (`server/db/invites.ts`):**
  - `listPendingInvites(ctx)` — admin-only, lazily flips past-due rows to `EXPIRED` before reading (no cron needed).
  - `createInvite(ctx, invitedByMemberId, input)` — admin-only, normalises email to lowercase, 14-day TTL, refuses duplicate-pending + already-member emails.
  - `getInviteByToken(token)` — _public_ (no `TenantContext`) lookup used by the unauthenticated `/invite/[token]` page; lazy-expires on read.
  - `acceptInvite(token, visitor)` — strict email match (case-insensitive), single `$transaction` upserts the `Member` row and stamps `acceptedAt + acceptedByClerkUserId` on the invite.
  - `revokeInvite(ctx, inviteId)` — admin-only, only flips `PENDING` rows, scoped by agencyId; ignores cross-tenant ids (returns `NotFoundError` to avoid leaking which case applies).
- [x] **Email:** new `server/email/templates/agency-invite.tsx` (branded React Email) + `sendAgencyInviteEmail` helper. Same Resend-skips-when-unconfigured behaviour as the existing welcome / generation-complete templates.
- [x] **Server actions (`/settings/team/actions.ts`):**
  - `inviteMemberAction` rewritten to use `createInvite` + `sendAgencyInviteEmail`. _Awaits_ email delivery so the inviter sees a real error if Resend rejects (and the action returns the accept URL for manual delivery).
  - `revokeInviteAction` (new) — wraps `repoRevokeInvite`.
  - `changeMemberRoleAction` + `removeMemberAction` switched from Clerk Organization mutations to direct `Member` updates/deletes. OWNER rows are guarded out of both (`role: { not: OWNER }`), and self-edits are refused at the action layer.
- [x] **Routing:** new public route `/invite/[token]` (added to the middleware public matcher). Layout matches the onboarding visual treatment (gradient + orbs). The page server-loads the invite, renders one of: `valid` / `expired` / `revoked` / `already-accepted` / `not-found`. If the visitor is signed in with the matching email, the card auto-accepts via `useEffect` and redirects to `/dashboard`; otherwise it routes to `/sign-up?redirect_url=/invite/{token}` (Clerk returns them after sign-up).
- [x] **Team UI:** new `<PendingInviteRow>` component lists pending invites above the "Invite a teammate" form on `/settings/team`. Each row shows email, role, "expires in N days", and a Revoke button with confirm modal.
- [x] **Clerk Org provisioning dropped from `createAgencyForUser`** — no more best-effort Clerk Org creation in the agency lifecycle. `Agency.clerkOrgId` field kept on the schema for legacy rows but unused by all new code paths.
- [x] **Tests:** 7 new (67 total) covering `listPendingInvites` lazy expiry + role gate, `createInvite` email normalisation + 14-day expiry + duplicate guards + admin-only gate, `revokeInvite` cross-tenant safety.

### Exit criteria

- [x] A brand-new user (no Clerk org, no Member) signs in → lands on `/onboarding` → creates an agency → ends on `/dashboard`, all in one session, no manual setup. _(End-to-end manual verification still needs a live Clerk + Neon — code paths are wired and typecheck-clean.)_
- [x] `getAuthContext()` no longer reads Clerk's `orgId`.
- [x] The demo-agency fallback in `server/data/tenant.ts` is gated to `NODE_ENV !== "production"`.
- [x] Existing test suite still green; **60 tests** total. New tests cover `seedManualVoiceSamples` (cross-tenant rejection, trimming, blank-drop, approve-role gate). End-to-end redirect-matrix integration tests deferred until a test Clerk + Neon environment is provisioned.

---

## 1.1 Wire existing UI pages to real data

> A `server/data/source.ts` shim sits between pages and the repos. When `DATABASE_URL` is set, it returns Prisma rows mapped onto the existing UI shapes; otherwise it falls back to `lib/sample-data/*`. Pages now read through this shim so dev works on a fresh clone with no env vars.

- [x] `server/data/source.ts` — `isLiveDb()`, `listClientsForUI`, `getClientForUI`, `getEpisodeForUI`, `getVoiceProfileForUI`, `listOutputsForUI` with deterministic UI derivations (initial, avatarBg, timeAgo, per-platform counts)
- [x] `/clients` — reads `listClientsForUI(tenant)`
- [x] `/clients/[key]` — reads `getClientForUI(tenant, key)`
- [x] `/episodes/[id]` — reads `getEpisodeForUI(tenant, id)`
- [x] `/voice/[clientKey]` — reads `getVoiceProfileForUI(tenant, key)`
- [x] `/voice` — redirect target picks the first client from the live list
- [x] `/episodes/new` — passes real `clients` to the wizard
- [x] `<ClientSwitcher>` — receives the agency's clients as a prop from `<Topbar>` (server fetch); URL matcher unchanged
- [x] `/dashboard` — KPIs, chart, recent episodes, and activity feed all wire to real aggregates via `dashboardSummary(ctx)` (`server/db/dashboard.ts`). KPI deltas: episodes get an absolute month-over-month pill (`▲ 2 vs. May`), outputs gets a percent-change pill (`▲ 26%` / `▲ new` when prior was zero), both via the pure formatters in `lib/dashboard-deltas.ts` (13 unit tests). Approval-rate + "posted with no edits" stay deltaless for now — both are lifetime metrics until 1.9's edit-distance lands. Chart `total` now sums the chart's own 8-week window instead of leaking the month-scoped count. Activity feed no longer falls back to demo `activityItems` in live mode when the transition log is empty — `<ActivityFeed>` already renders a clean "Activity will appear here…" empty state. **Recent-episode rows are now `<Link href="/episodes/{key}">`** — `RecentEpisode.key` carries the episode id in live mode (or the show key in sample mode; `/episodes/[id]` resolves either form). **Time-of-day greeting** ("Good morning/afternoon/evening, {firstName}") via a `<Greeting>` client component using `useSyncExternalStore` so the server snapshot ("Welcome back") hydrates deterministically and the client snapshot picks the bucket from the user's local hour (Vercel runs UTC, so server-side would mis-greet most users).
- [ ] Once live mode is the default end-to-end, delete `lib/sample-data/` and the fallback branches

## 1.2 Agency & member management

- [x] Agency record auto-created on Clerk `organization.created` webhook (0.4) — _kept as a side-channel for legacy Clerk-Org-first invites; in-app `createAgencyAction` (1.0) is now the primary path_
- [x] Member records synced from Clerk OrganizationMembership with `MemberRole` mapping
- [x] ~~First-sign-up onboarding stub~~ → replaced by the full `/onboarding` flow in 1.0
- [x] **Agency settings page** (`/settings/agency`) — inline name edit (OWNER/ADMIN gate at both action + repo layers, EDITOR/REVIEWER see a read-only label), current-plan summary card with a "Change plan →" link to `/settings/billing`, and a 3-fact strip (member count + Manage link, created-on date, workspace id). `<AgencyNameForm>` disables Save until the value is trimmed-non-empty + dirty, surfaces a brief "Saved" check on success, and calls `router.refresh()` so the topbar/dashboard greeting pick up the rename immediately. `updateAgencyAction` revalidates `(dashboard)` layout + `/settings/agency`. New repo `updateAgency(ctx, patch)` uses `updateMany` to enforce tenant scope atomically; 0-rows → `NotFoundError`. **Settings index** now redirects to `/settings/agency`; **`SettingsNav`** lists Agency as the first tab. Tests: 7 new (6 action smoke + 3 repo tenant/role) — total **81 tests**.
- [x] ~~Promote-to-OWNER mechanic~~ → resolved by 1.0 (first member is OWNER); manual promote-to-OWNER for legacy Clerk-created agencies still lives in `/settings/team` via 2.4's transfer-ownership flow

## 1.3 Clients CRUD wiring

- [x] Repo helpers (`listClients`, `getClient`, `createClient`, `updateClient`, `deleteClient`) with role gates + Zod schemas
- [x] Server actions (`app/(dashboard)/clients/actions.ts`) — `createClientAction`, `updateClientAction`, `deleteClientAction` with sample-data no-op + revalidatePath
- [x] Create-client modal (`<ClientFormModal mode="create">`) — `<Modal>` + `<Input>` + `<Textarea>` + `<Button>` primitives, validates name/host required, renders inline server-side error
- [x] Edit-client modal (`<ClientFormModal mode="edit">`) — same component, hydrated from `initial` prop
- [x] `<NewClientButton>` mounted on the Clients list header
- [x] `<ClientDetailActions>` on the client detail page — Edit (opens modal) + Delete (confirm dialog reusing `<Modal>` with cascade warning, red destructive button)
- [x] **R2 artwork upload** — `signArtworkUploadAction` (Zod-validated, allows JPG/PNG/WebP/AVIF, scopes object keys by `agencyId`, requires `NEXT_PUBLIC_R2_PUBLIC_BASE_URL`); `<ArtworkUpload>` component with file picker → XHR PUT to R2 with live progress %, thumbnail preview, "Replace" / "Clear" controls. Plain URL field still rendered as fallback.
- [x] Wire client detail "Add episode" CTA to `/episodes/new?clientId={id}` + `EpisodeWizard` accepts `initialClientKey` (validated against the agency's clients before pre-selecting)
- [x] **Artwork rendering** — detail headers (`/clients/[key]`, `/shows/[key]`), list cards (`/clients`, `/shows`), and the embedded show rows on the client detail page all swap the initials-on-`avatarBg` tile for the uploaded image when `artworkUrl` is set. Show list cards keep the 120px banner layout with an `object-cover` image + a bottom-edge gradient so the floating "Podcast" label + ep-count pill stay readable on any artwork.

## 1.3a Shows CRUD wiring

> Built alongside the new-user activation flow — without show creation in the UI, the dashboard's `<GetStarted>` "Add a show" CTA was a dead end and `/episodes/new` had nothing to point at. Mirrors the client CRUD shape so callers can reuse the modal pattern.

- [x] Repo helpers exposed pre-existed (`server/db/shows.ts` — `createShow`, `updateShow`, `deleteShow` + `createShowInput` / `updateShowInput` Zod schemas); no schema work needed.
- [x] **Server actions** (`app/(dashboard)/shows/actions.ts`) — `createShowAction`, `updateShowAction`, `deleteShowAction` with sample-data no-op + revalidatePath fan-out (`/shows`, `/clients`, `/dashboard`, `/episodes`, `/voice` on delete to cover cascades).
- [x] **`<ShowFormModal>`** mirroring `<ClientFormModal>` — sectioned layout (Brand / Basics / Connect), live preview, R2 artwork upload reuse, RSS URL validation, Cmd/Ctrl+Enter submit, submit gating. Client picker auto-locks when only one client exists or `defaultClientId` is set, so callers from `/clients/[key]` can't accidentally re-parent.
- [x] **`<NewShowButton>`** — small wrapper (primary CTA + inline link variant) used on `/clients/[key]` so users can add shows under a fixed client without picking it again.
- [x] **`<ShowDetailActions>`** on `/shows/[key]` — Edit (opens `<ShowFormModal mode="edit">`) + Delete (confirm dialog with cascade warning, routes back to `/shows` on success).
- [x] **Edit-form initial fetcher** — `getShowEditInitialForUI(ctx, idOrKey)` returns exactly the shape `<ShowFormModal>` needs in edit mode (live mode reads the row + parent client name; sample mode looks up `sampleShows` + `sampleClients`).
- [x] **`<GetStarted>` "Add a show" CTA** opens the modal inline (no more `/clients` redirect dead end).
- [x] `+ Add show` button in the `/shows` list page header — `<NewShowButton>` now accepts the full `clients` list (with optional `defaultClientId` to lock the picker for per-client surfaces). Disabled with a tooltip hint when the agency has zero clients.
- [x] **Empty-state cards** on `/clients` and `/shows` list pages — dashed-border block (icon + headline + 1-line explanation + primary CTA) replaces the bare empty grid. `/shows` branches: when the agency has clients it shows `<NewShowButton>`, when it has none it nudges to `/clients` instead, since show creation can't proceed without a parent.

## 1.3b Modal pattern consolidation

- [x] Both `<ClientFormModal>` and `<ShowFormModal>` use the **mount-on-open** pattern (outer wrapper holds `<Modal>` always-mounted; body component remounts per open). Hydrating state from props via `useState` initializers in the body avoids the `setState`-in-effect pattern that Next 16 flags as `react-hooks/set-state-in-effect`. Pre-existing lint debt on the client modal is cleared.
- [x] `<Modal>` primitive centering — `fixed inset-0 m-auto` restores the dialog's user-agent auto-centering (Tailwind v4 preflight zeroes `margin`); `max-h-[calc(100vh-32px)]` + `overflow-y-auto` keep tall modals scrollable.

## 1.4 Prompt system

- [x] `server/ai/prompts/` — one file per platform (`twitter`, `linkedin`, `instagram`, `tiktok`, `show-notes`, `blog`, `newsletter`) + `index.ts` keyed by `Platform`
- [x] `server/ai/platforms.ts` — `PlatformConfig` (`name`/`fullName`/`format`/`maxTokens`/`idealLength`) per `Platform`
- [x] `server/ai/prompt-builder.ts` — composes identity card + voice samples + global+platform instructions + transcript into an `Anthropic.MessageCreateParams` payload with `cache_control: ephemeral` on the stable blocks
- [x] `selectSamples(samples, targetPlatform, opts)` — on-platform first, top up off-platform, fall back to more on-platform to fill `maxTotal`
- [x] Adding a platform = new template file + entry in `PLATFORM_PROMPTS` + entry in `PLATFORM_CONFIG`; no core changes
- [x] `server/ai/claude.ts` — lazy `getClaudeClient()` + strict `requireClaudeClient()`, `CLAUDE_MODEL` constant
- [x] Unit tests for the prompt builder (9 tests) — selection ordering, system-block cache markers, per-platform rule isolation, all-7-platforms smoke check, minimal-voice-profile fallback
- [x] Key-moment extraction (`server/ai/key-moments.ts`) — `extractKeyMoments(transcript)` calls Claude with a strict JSON-only system prompt, returns `KeyMoment[]`. Parser handles bare JSON, ` ```json ` fences, and prose-wrapped output. 8 parser unit tests.
- [ ] **Gate:** before merging the generation pipeline (1.5), run `npm run ai:validate` and capture findings (depends on `ANTHROPIC_API_KEY`)

## 1.5 Generation pipeline (Inngest)

- [x] Event registry `inngest/events.ts` — `episode/generate.requested`, `episode/generated`, `episode/regenerate.output.requested`
- [x] `inngest/functions/generate-episode.ts` orchestrator:
  - Load episode + validate ≥ 500-word transcript (`NonRetriableError` on short)
  - Cost-cap guard reads `UsageLog` since month-start; `NonRetriableError` if over `MONTHLY_CAP_CENTS` ($50 placeholder; superseded by Phase 1.11)
  - Mark episode `PROCESSING`
  - Extract key moments (`step.run`-cached, single Claude call shared across platforms)
  - Load voice samples (top 20 most recent) + build `VoiceContext`
  - Fan out via `Promise.allSettled` — one `step.run` per platform, parallel
  - Persist successful outputs + `UsageLog` rows in a single `prisma.$transaction`
  - Mark episode `READY` even on partial failure
  - Emit `episode/generated` with `failedPlatforms` list for SSE/email subscribers
- [x] Partial-failure resilience (one platform fails → others still save)
- [x] `retries: 3` configured on the function
- [x] Per-call token usage logged to `UsageLog` with cost estimate
- [ ] Chunk transcript if > 6,000 tokens (currently single-shot)
- [~] Quality scoring (0–100) — **heuristic landed.** `server/ai/quality-score.ts` exposes `scoreOutput(platform, content)` with two axes (length 0–50 + structure 0–50): TWITTER scores numbered-tweet count + per-tweet 280-char fit; LINKEDIN scores 700–1,400 char range + paragraph breaks + hashtag-spam guard; INSTAGRAM scores <125 words + 3–5 lowercase hashtags + 1–3 emoji; TIKTOK scores `[HOOK] / [BEAT] / [CTA]` markers; SHOW_NOTES scores MM:SS timestamp count + summary paragraph length; BLOG scores 800–1,200 words + H1 + paragraph density; NEWSLETTER scores subject-line presence/length + short sign-off + 300–600 word body. Wired into `generate-episode.ts` + `regenerate-output.ts` (writes `GeneratedOutput.quality` at persist). 21 unit tests cover each platform's good/bad cases plus universal floor/cap invariants (135 tests total). Claude-as-judge refinement still deferred.
- [ ] Single-output regenerate function (`episode/regenerate.output.requested`) — Phase 2.2
- [ ] Replace placeholder `MONTHLY_CAP_CENTS` with per-plan limits when 1.11 lands
- [ ] Integration test: mock Claude + Prisma, dispatch event, assert 7 outputs + 7 UsageLogs (needs test DB)

## 1.6 New Episode flow (wire form)

- [x] Wizard UI (`/episodes/new`) — 4 steps, client/source/platforms/review
- [x] `createEpisodeAction` (`app/(dashboard)/episodes/new/actions.ts`) — Zod-validated; in sample mode short-circuits to the existing sample episode page; in live mode creates `Episode` + fires `episode/generate.requested`
- [x] Step 1 receives real client list from the New Episode page (via 1.1)
- [x] Wizard submit calls the action via `useTransition`; redirects to `/episodes/{id}` on success; surfaces server-side error inline
- [x] **Activation-flow smoke test** (`tests/actions/create-episode.test.ts`, 8 cases) — sample-data short-circuit (no DB or Inngest calls), Zod rejects short transcript / empty platforms / missing showId, live-mode happy path asserts `createEpisode` payload + tenant scope + `inngest.send({ name: "episode/generate.requested", data })` shape, defaults for title + source, and that a repo failure does not dispatch the Inngest event. Downstream Anthropic + Inngest dev-server are not exercised here (1.5's integration test handles that, still gated on a test DB).
- [~] Audio (2.7) + RSS (2.8) paths landed. YouTube source path still stubbed in the UI — placeholder server action lands with 3.2.

## 1.7 Episode Outputs screen (wire actions)

- [x] Outputs UI with all five states (generating spinner+shimmer, ready/review display, edit textarea, regenerate panel, approved toast)
- [x] `updateOutputContentAction` — Zod-validated, calls `updateOutputContent` + `revalidatePath`; no-op in sample mode
- [x] `approveOutputAction` — wraps `approveOutput` (which transactionally creates the `VoiceSample`); revalidates `/episodes`, `/voice`, `/clients` layouts so the voice strength badges refresh
- [x] `regenerateOutputAction` — wraps `markOutputRegenerating` + fires `episode/regenerate.output.requested` Inngest event
- [x] `OutputsView` fires actions inline alongside local state updates (toast + ticker still client-side; server is the source of truth)
- [x] Live progress — **replaced by SSE in 2.9**; outputs now stream in via `/api/episodes/[id]/stream` instead of client-side polling.
- [x] Per-card error state when status is `FAILED` — generate pipeline now persists a `FAILED` placeholder `GeneratedOutput` + `OutputTransition` (error message captured in `note`, truncated to 500 chars) for every platform that rejects in the `Promise.allSettled`, so the grid always shows all requested platforms instead of silently dropping rows. `regenerate-output` gained an `onFailure` handler that flips the row to `FAILED` once Inngest exhausts retries. UI: `EpisodeStatus` + `statusMeta` gained a `"failed"` case (red border/bg matching the existing `FAILED` palette), `STATUS_TO_KEY` maps `FAILED → "failed"`, `getEpisodeForUI` joins the latest `FAILED` transition's `note` onto each failed output as `failureReason`, and `<OutputCard>` renders a red error banner + "Try again" pill that reuses the existing regenerate flow (clean retry, no instruction → server routes back to `READY`). `regenerate()` in `<OutputsView>` now derives `_target` from instruction emptiness instead of hard-coding `"review"`, so the optimistic status matches what the server returns.

## 1.8 Voice sample capture

- [x] `approveOutput` in `server/db/outputs.ts` writes the `VoiceSample` row inside a transaction with the status flip
- [ ] Approve button wired (part of 1.7)
- [ ] After approve, `<VoiceStrengthBars>` on the rail + topbar pill updates from the new `samples` count (currently local state — needs `router.refresh()` or `revalidatePath`)

## 1.9 Quality instrumentation (north-star metric)

- [x] **Edit-distance on save** — new `GeneratedOutput.editDistance Int @default(0)` field. `lib/edit-distance.ts` is a classical two-row Levenshtein (memory O(min(n,m)), O(n·m) time — sub-30ms for typical ≤5KB outputs). `updateOutputContent` now does a tenant-scoped `findFirst` to read the prior content, scores the delta, and writes `{ content, editDistance: { increment: delta } }` in a single `update`. Pure helper has 9 unit tests (identity, insertions, deletions, substitutions, kitten/sitting, symmetry check, realistic content edit, ~2KB load). **Migration:** `npm run db:migrate` (needs `DIRECT_URL`) to land the column in Neon.
- [x] **Derived metric `% of outputs approved with no edits`** — `percentPostedUnedited(ctx)` in `server/db/dashboard.ts` upgraded from the `version == 1` proxy (which mis-classified edited-then-approved v1 rows as untouched) to `editDistance == 0`. Hero KPI now reflects real user behavior. Lifetime metric for now — MoM delta on this and `approvalRate` still deferred (needs a date-scoped variant; see 1.13 follow-up).
- [x] **PostHog events wired** — `generation_completed` (Inngest, after persist-outputs: `episodeId`, `platform` enum, `outputTokens`, `durationMs`), `output_approved` (client, on approve action ok: `outputId`, `platform` UI key, `edited` bool, `editDistance`), `output_edited` (client, on edit action ok: `outputId`, `platform`, `delta` for this save, `totalEditDistance`). Server-side capture goes through `server/analytics/track.ts` — a small fetch wrapper around PostHog's `/capture/` endpoint (no `posthog-node` dep, 2-second timeout, swallows errors so telemetry never blocks the pipeline) with `distinctId: agency:${agencyId}` and PostHog `$groups: { agency }` for dashboard rollups. Note: `outputTokens` replaces the PLAN's draft `quality` field until 1.9 ships a real heuristic-or-judge score.
- [x] **Typed event helpers** — `lib/analytics/events.ts` declares an `EventMap` keyed off event name. Both `track(name, payload)` (client wrapper around `posthog-js`) and `trackServer(name, payload, { distinctId, agencyId? })` consume the same shape, so the compiler refuses any typo or payload drift across the codebase. `updateOutputContentAction` and `approveOutputAction` now return `{ delta, totalEditDistance }` and `{ editDistance }` respectively so the client can fire events without an extra round-trip. 5 unit tests on `trackServer` cover the no-op gate (no `NEXT_PUBLIC_POSTHOG_KEY`), POST shape (api_key + event + distinct_id + properties + `$groups`), `NEXT_PUBLIC_POSTHOG_HOST` trailing-slash strip, fetch-throw resilience, and non-2xx warning path.
- [x] **`docs/observability.md`** — documents how to fire events (client vs. server wrapper), every active event with its trigger + properties, and how to add a new one. Sentry config is referenced too. PostHog dashboard URL still TODO — links go in once the project is provisioned.

## 1.10 Billing (Stripe)

- [x] `stripe` SDK installed; `server/billing/stripe.ts` lazy client pinned to API version `2026-06-24.dahlia`
- [x] `server/billing/prices.ts` — `priceIdFor(plan)` + reverse `planForPriceId(id)` lookup keyed by `NEXT_PUBLIC_STRIPE_*_PRICE_ID` env vars
- [x] Server actions `createCheckoutSessionAction(plan)` + `createPortalSessionAction()` — role-gated to OWNER/ADMIN, build dynamic success/cancel URLs from request headers, stamp `agencyId` into checkout metadata
- [x] Webhook `app/api/webhooks/stripe/route.ts` — `force-dynamic`, signature verify via `stripe.webhooks.constructEvent`, dispatch on `customer.subscription.{created,updated,deleted}` + `invoice.{paid,payment_failed,finalized}` → sync `Agency.{plan, stripeCustomerId, stripeSubscriptionId}` + upsert `Invoice` rows
- [x] **Billing screen** (`/settings/billing`) — current plan card with manage/upgrade CTAs, 4 usage meters (shows/seats/episodes-month/generations-month, amber at ≥80%, red at 100%), 3-tile plan ladder with the active tier highlighted, invoice history with hosted-PDF links
- [x] **Webhook idempotency** — new `WebhookDelivery` model (`(source, eventId)` unique, `source` ∈ `"stripe" | "clerk" | "resend"` so we can dedupe every provider through one table). `server/db/webhook-deliveries.ts` exposes `markWebhookProcessed(source, eventId, eventType)` → `{ deduped: boolean }` (translates Prisma `P2002` into `deduped: true`) + `unmarkWebhookProcessed(...)` for rollback. The Stripe handler claims the event id before dispatching: a duplicate retry short-circuits to 204 (Stripe stops resending after a 2xx); a dispatch failure rolls the ledger row back so Stripe's next retry re-processes a legitimate event without permanently de-duping it. 6 unit tests cover the create-success, concurrent-retry P2002, non-P2002 rethrow, unknown-error rethrow, deleteMany shape, and missing-row tolerance. **Migration:** `npm run db:migrate` (needs `DIRECT_URL`) lands the new model. Rows accumulate forever for now — a daily prune of `processedAt < now - 90d` lands later when the table grows (Stripe events older than ~30 days are never retried).
- [x] Settings hub with tab nav (`/settings` redirects to `/settings/agency`; `<SettingsNav>` provides Agency/Billing/Team/Branding tabs)
- [ ] `revalidateTag('agency-{id}', 'max')` once routes start opting into `cacheComponents`
- [~] Webhook idempotency tested (6 unit tests on the dedupe helper). Signature verification + end-to-end retry behavior still want an integration test against a real Stripe sandbox.

## 1.11 Plan enforcement & metering

- [x] `lib/plans.ts` — `PLAN_LIMITS` (shows, seats, episodes/month, generations/month, monthly cost-cap cents) and `PLAN_DISPLAY` (name, priceUsd, tagline, highlights) for STUDIO/AGENCY/NETWORK
- [x] `server/billing/limits.ts` — `planCapacity(agencyId, plan, resource)` (used + limit) and `assertPlanCapacity` (throws `ForbiddenError`)
- [x] Hooked into `createClient` and `createEpisode` repos — capacity check before write
- [x] Inngest orchestrator reads the agency's plan and enforces `monthlyCostCapCents` (replaces the $50 placeholder)
- [x] Usage meters on `/settings/billing` reuse the same `planCapacity` helper for one source of truth
- [x] Soft upgrade prompts in the UI before limits hit. Shared `<PlanLimitBanner>` (`components/billing/plan-limit-banner.tsx`) renders nothing under 80% usage, an amber notice + "View plans" pill at 80–99%, and a red blocking notice + "Upgrade plan" pill at ≥100%. New `loadCapacityForUI(agencyId, resource)` server helper in `server/billing/limits.ts` bundles `{ used, limit, plan, resource }` so callers can pass one prop. Surfaces wired: `/episodes/new` (episodes-per-month, top of wizard), `<ShowFormModal mode="create">` via `<NewShowButton>` on `/shows` + `/clients/[key]` (shows cap, inside modal body), and `<InviteMemberForm>` on `/settings/team` (seats cap, above the form). Sample-data mode passes `null` so the design preview stays clean; live mode probes capacity at page load.
- [ ] Enforce seats on Clerk Organization invites (Phase 2.4 lands the team UI)

## 1.12 Transactional email (Resend)

- [x] `resend` + `@react-email/components` + `@react-email/render` installed
- [x] `server/email/client.ts` — lazy `getResendClient()` (no-op without `RESEND_API_KEY`); `FROM_EMAIL` from `RESEND_FROM_EMAIL` env override
- [x] `server/email/templates/welcome.tsx` — branded welcome with quickstart bullets + dashboard CTA
- [x] `server/email/templates/generation-complete.tsx` — outputs-ready summary with success / partial-failure variants
- [x] `server/email/send.ts` — `sendWelcomeEmail` + `sendGenerationCompleteEmail`; logs and returns `{ ok: false }` on failure but never throws (so user flows can't be blocked by email outages)
- [x] Wired: Clerk webhook fires welcome on first member sync per agency; Inngest orchestrator fires generation-complete to OWNER + ADMIN members after the persist step
- [ ] Domain/DKIM verify in Resend dashboard (manual)
- [ ] Sentry alert on `[email] resend rejected` warning rate
- [ ] Onboarding "did this email reach you?" smoke test inside the app

## 1.13 Dashboard data wiring

- [x] Dashboard UI (KPI tiles, 8/12-week chart, recent episodes, activity feed)
- [x] `server/db/dashboard.ts` — `episodesThisMonth`, `outputsGeneratedThisMonth`, `episodesPriorMonth`, `outputsGeneratedPriorMonth`, `approvalRate`, `percentPostedUnedited` (now keyed off `editDistance == 0`, the real signal 1.9 landed), `weeklyOutputVolume(weeks)`, `recentEpisodes(limit)`, plus a `dashboardSummary` bundle that includes the prior-month aggregates for MoM deltas
- [x] `getDashboardForUI(ctx)` in the data-source — falls back to sample data when `!isLiveDb()`
- [x] `<RecentEpisodes>` + `<ActivityFeed>` + `<OutputVolumeChart>` accept props (sample-data defaults preserved)
- [x] Greeting + workspace label come from the real `auth` context when signed in
- [x] Activity feed wired to `listRecentTransitions(ctx, 12)` — derives ActivityItem text from `(actor, verb, platform-label, client)` with status-driven dot color/ring. Sample feed remains as the fallback when the transitions table is empty.
- [x] 12-week range pulls a live aggregate too — `dashboardSummary` now runs a single `weeklyOutputVolume(ctx, 12)` query and slices the last 8 entries for the 8-week window (both windows end at the current week, so the slice is exact). `getDashboardForUI` derives a `ChartSeriesMap` `{ "8 weeks", "12 weeks" }` via a shared `seriesFromWeekly` helper. `<OutputVolumeChart>` now accepts a `series` map and selects in-memory on toggle — no more sample-data fallback in either mode. Sample-data branch returns the existing pre-computed `chartSeries["8 weeks" | "12 weeks"]` for parity.
- [ ] Install Recharts when the inline SVG chart hits a limitation (filterable, hoverable tooltips)

**Exit criteria for Phase 1:** End-to-end works on production — sign up, add client, paste transcript, generate 7 outputs, edit + approve, hit a plan limit, pay. Cost per generation measured + capped. North-star metric (% posted unedited) tracked.

---

# Phase 2 — Voice moat, all inputs, agency workflow

> Goal: per-client voice engine works (Strong threshold), all 4 input methods are live, approval workflow + teams + white-label are in place.

## 2.1 Full voice engine

- [~] Per-client, per-platform voice profiles persisted — global (`Client.globalInstructions`) + per-platform (`ClientPlatformInstruction`) rules now persist via the editor. Per-platform _AI_ description versioning still deferred.
- [x] Voice-strength threshold logic centralised in `server/ai/voice-strength.ts` — `VOICE_LEVEL_THRESHOLDS` (Weak 0–5 / Developing 6–15 / Strong 16+), `VOICE_REFRESH_THRESHOLDS = [1, 6, 16, 30]`, `voiceLevel(samples)`, `crossedVoiceRefreshThreshold(prev, next)`. UI helpers in `lib/sample-data/voice-strength.ts` keep their existing import path for now.
- [x] AI-generated voice description per client — `server/ai/voice-description.ts` builds a short (~55 word, no bullets) Claude prompt over the 20 most-recently approved samples. New Inngest function `refresh-voice-description` (3 retries) writes back to `Client.voiceDescription` + logs token usage in `UsageLog`. Fired from `approveOutputAction` when the post-approve sample count crosses a refresh threshold; dispatch is fire-and-forget so a queue outage can't roll back the approve.
- [x] Sample-selection strategy — **v2 scored picker landed.** `selectSamples()` now scores each sample as `0.7 * recency + 0.3 * lengthFit`, sorts within the on-platform / off-platform buckets, and otherwise keeps the existing on-target → off-target → fallback flow. Recency uses input index (callers pass newest-first, `orderBy createdAt desc` in the pipeline), so the public `VoiceSampleForPrompt` type stayed narrow — no `createdAt` field threaded. Length fit is scored against each sample's **own** platform sweet spot (per-platform char ranges in `LENGTH_SWEET_SPOTS`), so an off-platform sample wins/loses on whether it's a good example of its own platform — not whether it contorts to the target's shape. 4 new tests cover: length-fit boosts an older on-target sample over a fresh tiny one (realistic 20-sample batch), length-fit ties → recency wins, off-platform scoring uses its own sweet spot, empty input returns []. 161 tests total.
- [x] Custom instructions editor UI (global + per-platform)
- [x] **Wired** custom-instructions editor to the DB — `server/db/client-instructions.ts` exposes `saveVoiceInstructions(ctx, input)`: tenant-scoped, role-gated to OWNER/ADMIN/EDITOR, single `$transaction` that updates `Client.globalInstructions`, upserts non-empty per-platform rules, and `deleteMany`s blanks (so empty strings don't poison the cached prompt blocks). New `saveVoiceInstructionsAction` + `useTransition`-driven Save button in `VoiceView` with inline error display.
- [x] **Voice Profile screen** (`/voice/[showKey]`) — UI done; **first-pass live-data polish** landed: AI-summary callout now branches on `voiceDescription` (renders a "Approve a few outputs and the engine will write a summary here" placeholder when null instead of a blank card), tags row only shows when populated, approved-samples grid renders a dashed-border empty-state card with a "Generate an episode →" CTA when there are zero samples, filter chips hide entirely when there's nothing to filter, and a "Back to {showName}" link returns to `/shows/[key]`.

## 2.2 Regenerate with instruction (single output)

- [x] Repo helper `markOutputRegenerating(ctx, id, instruction)` (Phase 0.7)
- [x] Regenerate panel UI on output card with quick-action chips
- [x] `regenerateOutputAction` fires `episode/regenerate.output.requested` Inngest event
- [x] `inngest/functions/regenerate-output.ts` — loads output + episode + voice context, builds prompt with `extraInstruction` injected, calls Claude, persists new content + UsageLog, flips status to `IN_REVIEW` (instruction-driven) or `READY` (clean rerun)
- [x] `buildMessages` accepts `extraInstruction?` to inject the one-shot instruction without polluting cached blocks
- [x] **Versioning:** `markOutputRegenerating` now stamps the prior row's `supersededAt` and creates a new `GeneratedOutput` (version+1, `previousVersionId` backref, GENERATING) in one transaction; the regenerate action passes the _new_ id to Inngest; `listOutputsForEpisode` + `qualityByPlatformForEpisode` filter `supersededAt: null` so the grid always shows the current version; new `listVersionsForOutput(ctx, outputId)` repo helper + `listOutputVersionsAction` server action. 3 new unit tests cover the clone semantics + the all-versions filter (42 tests total).
- [x] Version switcher on the output card — "Version N of M" pill with prev/next chevrons, fetches the slot's history on first open via `listOutputVersionsAction`, gates Edit/Regenerate/Approve while viewing an older version. Auto-resets when the current id changes (next regen).

## 2.3 Approval workflow

- [~] Full status flow: `GENERATING → READY → IN_REVIEW → APPROVED → SCHEDULED → PUBLISHED` — READY ↔ IN_REVIEW ↔ APPROVED live now (`requestReviewOutput`, `rejectOutputForRevision`, existing `approveOutput`); SCHEDULED/PUBLISHED still wait on Phase 3.3 (scheduling).
- [x] Role gating surfaced in UI — `OutputCard` accepts `viewerRole`; Edit/Regenerate disabled with `title=` tooltip for non-editors, Approve disabled for editors, Reject only renders for approvers on IN_REVIEW rows, "Request review" only renders for non-approver editors on READY rows. Mirrors the server-side `requireRole` guards.
- [x] **`OutputTransition` model** — append-only log with denormalized `agencyId` so activity-feed reads are a single-table scan. Cascade with output, SetNull on member. Indexes: `(agencyId, createdAt)`, `(outputId, createdAt)`, `byMemberId`.
- [x] **Transition recording** — wired into `approveOutput`, `requestReviewOutput`, `rejectOutputForRevision` (in-transaction), `markOutputRegenerating` (post-txn), `generate-episode.ts` (per-platform inside the persist txn), `regenerate-output.ts` (in the persist txn). Pipeline transitions use `byMemberId: null`.
- [ ] Optional client sign-off step (links to 2.5 client portal)

## 2.4 Team seats & roles

- [x] **Team screen** (`/settings/team`) — Member list with avatars + role pills (`OWNER`/`ADMIN`/`EDITOR`/`REVIEWER`), inline role toggle (Editor ↔ Admin) for OWNER/ADMIN viewers, "Remove" with confirm dialog, self-removal blocked
- [x] `<InviteMemberForm>` — email + Editor/Admin toggle, blocked when at seat cap, shows "invite sent" success state
- [x] Server actions `inviteMemberAction`, `changeMemberRoleAction`, `removeMemberAction` — Clerk SDK calls (`createOrganizationInvitation`, `updateOrganizationMembership`, `deleteOrganizationMembership`) wrapped in role + tenant guards
- [x] Seat-limit enforcement via `assertPlanCapacity("members")` before invite
- [x] Sample-data fallback shows the current user as sole OWNER
- [x] Activity log of role changes — new `MemberTransition` table mirrors `OutputTransition` (denormalized `agencyId`, indexed by `(agencyId, createdAt)`, FK to `Agency`/`Member` ×2 / `MemberInvite`). `MemberTransitionKind` enum covers INVITED / INVITE_ACCEPTED / INVITE_REVOKED / ROLE_CHANGED / REMOVED / OWNER_TRANSFERRED. Migration `20260629064500_member_transitions` lands the table + indices + FKs. New `server/db/member-transitions.ts` exposes `buildMemberTransitionWrite` (transaction-spliceable) + `recordMemberTransition` (fire-and-forget) + `listMemberTransitions(ctx, limit)`. Recording wired into `inviteMemberAction` (INVITED), `revokeInviteAction` (INVITE_REVOKED, with email snapshotted before revoke), `changeMemberRoleAction` (ROLE_CHANGED, prior role snapshotted), `removeMemberAction` (REMOVED, snapshotted email + prior role since the Member row is gone after delete), `transferOwnershipAction` (OWNER_TRANSFERRED — single row, the prior OWNER's implicit demotion isn't a separate ROLE_CHANGED to avoid noise), and `acceptInviteAction` (INVITE_ACCEPTED — self-action, actor = target). New `<MemberActivityFeed>` rendered under "Recent team activity" on `/settings/team` (live mode only) with kind-specific dot palette + relative time + graceful "Someone"/email fallbacks for deleted rows. 3 new tenant-isolation tests: list filter shape + include shape, no-role rejection, recordMemberTransition data shape (145 tests total).
- [x] OWNER transfer flow — `transferOwnershipAction` (OWNER-only, target must be an existing ADMIN) demotes the current OWNER to ADMIN and promotes the target to OWNER in a single transaction; "Make owner" button + confirm modal in `MemberRow` when the viewer is OWNER and the target is ADMIN.

## 2.5 White-label & client portal

- [x] **White-label settings** (`/settings/branding`) — logo + accent color landed. Migration `20260630120000_agency_branding` adds `Agency.brandLogoUrl` + `Agency.brandAccentColor` (both nullable strings; client-facing surfaces fall back to Repodcast defaults on null). New `updateAgencyBranding(ctx, patch)` repo helper + `updateAgencyBrandingInput` Zod schema. Empties preprocess to `null` _before_ the `.url()` / hex-regex validators run so a "clear" gesture lands as a real unset; hex values are lowercased so persisted shapes are canonical. `updateAgencyBrandingAction` server action (OWNER/ADMIN only; sample-data mode short-circuits) revalidates the dashboard layout so the topbar / portal / etc. pick up the new branding on the next render. The page replaces the prior stub with a sectioned form: logo upload reuses `<ArtworkUpload>` (same R2-signed-PUT pipeline as client/show artwork — keys land under `artwork/<agencyId>/...`), accent color via native `<input type="color">` synced with a hex text input (invalid hex disables save), plus a live preview card that approximates the portal header + CTA so the user can see the branding before they save. Dirty-state gate disables Save when nothing has changed; non-OWNER/ADMIN viewers get a read-only render. **Subdomain config is deferred** — DNS infra is too much for this slice; the portal will use the existing `ClientPortalLink.token` URLs. **4 new tenant-isolation tests** (242 total): write where-shape, role gate (EDITOR + REVIEWER → ForbiddenError), zero-count → NotFoundError, input normalisation (empty → null, hex → lowercase, invalid hex / bad URL rejected).
- [x] **Branded output export** (`/api/episodes/[id]/export`) — agency-only, tenant-scoped via `getEpisode(ctx, id)` (404 on cross-tenant id). GET returns a single self-contained HTML document with `Content-Disposition: attachment; filename="{title}.html"` so the browser downloads it. No PDF — Puppeteer / Playwright are too heavy for one route, and the receiving client can "Save as PDF" from their browser's print dialog (the CSS `@media print` block tightens layout for that path). Pure render lives in `lib/branded-export.ts` — takes a `BrandedExportData` shape, returns a complete document with inline styles + the agency's logo + accent color baked in. The accent color is gated through `sanitiseHexColor` (strict 7-char hex regex) before any `style="..."` interpolation — protects against a malformed DB row injecting CSS. All user-controlled content (episode title / show name / host / agency name / output bodies) passes through `escapeHtml` (5 structural chars) before interpolation. `exportFilenameFor` strips filesystem-hostile chars + caps at 60 chars, falling back to `episode.html` when the title is empty after sanitisation. Episode page CTA: "Download for client" button in the header, live-mode only (sample-data would 503), gated on `approvedCount > 0` so the export isn't an empty receipt. **16 new unit tests** (268 total): escapeHtml round-trips, sanitiseHexColor accept/reject (including `#3A5BA0; color:red` and `javascript:alert(1)` injection attempts), exportFilenameFor edge cases, document render (title / logo-vs-initials avatar / accent fallback / output content escaping / empty state / recorded-at presence / approved-pill conditional).
- [x] **Read-only client portal route** (`/portal/[token]`) landed. New `server/db/client-portal.ts` exposes two surfaces: (a) **agency-side** `createPortalLink` / `revokePortalLink` / `listPortalLinks` — all tenant-scoped via `client.agencyId`, with OWNER/ADMIN gating on writes and an `assertClientInTenant` pre-check so a cross-tenant id surfaces as `NotFoundError` instead of silent rows; (b) **public** `getPortalLinkByToken` / `logPortalAccess` / `listApprovedDeliverablesForPortal` — no `TenantContext` (the token IS the credential), with expiry + revocation gates collapsing to a single `null` response so a probing visitor can't distinguish missing / revoked / expired (same 404 surface for all three). Portal lookup returns the agency's `brandLogoUrl` + `brandAccentColor` in the same query so the page can theme inline without a second round-trip. The page (`app/portal/[token]/page.tsx`, `force-dynamic`) fetches approved deliverables grouped by show → episode, renders an agency-branded header (logo or accent-initials avatar), per-episode cards with platform badges + "Approved {date}" pills tinted with the accent, and a generic empty state when nothing's been approved yet. Access logging is fire-and-forget — IP is sha-256 hashed via `node:crypto` (we never store raw IPs), user-agent + ipHash land on `ClientPortalAccessLog`. New `app/portal/layout.tsx` bypasses the dashboard chrome (no topbar/sidebar/`<UserButton>`); `middleware.ts` matcher now lists `/portal/(.*)` so Clerk doesn't gate it. **Mint/revoke UI** lives in `<PortalLinksCard>` on the client billing tab — server actions `mintPortalLinkAction` (7/30/90-day expiry select) + `revokePortalLinkAction`, both OWNER/ADMIN gated, both `revalidatePath` the billing tab on success. Card shows every link newest-first with token URL, expiry, last-access, minted-by, "Copy URL" + "Revoke" affordances; revoked rows render muted with the revocation date for audit. Share URL is composed from `NEXT_PUBLIC_APP_URL` when set, falling back to the request's `x-forwarded-proto` + `host` headers. **10 new tenant-isolation tests** (252 total): create role gate, create cross-tenant id rejection (NotFound before any write), expiresAt = now + days math, revoke updateMany where-shape (id + agencyId + revokedAt:null), revoke zero-count → NotFound, list where-shape + include shape, getPortalLinkByToken null/revoked/expired/valid branches.

## 2.6 Batch processing

- [x] **Batch generate** — `/episodes` list now offers "Generate outputs for N episodes" alongside the existing bulk-approve. New `bulkGenerateEpisodes(ctx, {episodeIds})` repo helper in `server/db/episodes.ts` does the heavy lifting: tenant-filters via `show.client.agencyId` (cross-tenant ids drop silently — they're invisible by design), filters again to status ∈ {DRAFT, FAILED} (READY/PROCESSING/ARCHIVED are skipped server-side even if a tampered request includes them), derives the platform set from each episode's current-version outputs (so a retry honours the original platform selection) with the full 7-platform default as fallback for episodes that never produced an output, and flips eligible rows to PROCESSING + clears any prior `failureReason` in a single `updateMany`. Plan capacity is checked upfront so a 50-ep batch fails fast instead of chewing through the monthly cap. WRITE_ROLES gate (OWNER/ADMIN/EDITOR). New `bulkGenerateEpisodesAction` server action wires Inngest dispatch via `Promise.allSettled` (a single Inngest blip doesn't drop the whole batch) and revalidates the `/episodes` layout. `<EpisodeListSelection>` extended: shared selectable gate covers both approve + generate roles, second "Generate outputs for N episodes" button surfaces in the sticky action bar when any selected ep is DRAFT/FAILED, new amber/accent-soft styling distinguishes it from the green approve CTA, dedicated `generate`-kind result banner reports `dispatchedCount` / `skippedCount` so the user sees exactly what landed. `EpisodeListStatus` gained `FAILED` with red palette in `STATUS_STYLES`, surfaced in the filter chip list too. **6 new tenant-isolation tests** (274 total): findMany where-shape, REVIEWER role rejection, all-ineligible short-circuit (no updateMany), eligible-mix flip (where-clause + data shape + dispatch derivation incl. all-7 fallback and outputs-derived narrow set), cross-tenant id silent strip, empty-input Zod rejection.
- [x] **Bulk approve in `/episodes` list** — already landed in 2.12; bulk-generate now shares the same selection wrapper.
- [ ] Batch progress view — minimum viable today via the existing list status pills (rows flip to PROCESSING and back) + the per-episode SSE on `/episodes/[id]`. A dedicated "batch in flight" surface (e.g. a banner showing N of M complete) is still open for later.

## 2.7 Audio upload pipeline

- [ ] Upload UI (`/episodes/new` audio path) — direct-to-R2 via `signR2UploadUrl` with progress
- [ ] Inngest function: R2 object → Deepgram Nova-2 → transcript saved to `Episode`
- [ ] Whisper fallback path when Deepgram fails
- [ ] Re-transcribe action + manual transcript correction UI
- [x] Cleanup cron: delete orphaned R2 uploads older than 24h with no Episode row — new `cleanup-orphan-audio` Inngest function on `0 3 * * *` (daily at 03:00 UTC, off-peak). Walks `audio/` prefix via paginated `ListObjectsV2`, filters to objects older than 24h, parses each key into `{agencyId, showId, episodeId, ext}` (anything that doesn't match is silently skipped — the cron never deletes mystery keys), batch-queries Prisma in 500-id chunks for "does this Episode row still exist," and `DeleteObjects`-batches the orphans in 1000-key slices. Pure helpers (`parseAudioKey` / `partitionOrphans` / `filterAgedCandidates`) live in `server/storage/audio-orphan.ts` so the parse-and-partition logic is unit-testable without an R2 client; new `listR2Objects` + `deleteR2Objects` helpers in `server/storage/r2.ts` cover the bucket-side calls. Skips gracefully when R2 isn't configured. 12 new unit tests (290 total) cover prefix sentinel, path depth, missing extension, multi-dot basenames, age cutoff, dateless objects, and unparseable-key safety.

## 2.8 RSS import

- [x] **Podcast Index API client** (`server/imports/podcastindex.ts`) — typed REST wrapper around `/podcasts/byfeedurl`, `/episodes/byfeedid`, `/episodes/byguid`. HMAC-SHA1 auth header (`X-Auth-Key`/`X-Auth-Date`/`Authorization` triple, timestamp re-minted per call) built in `buildAuthHeaders`. Lazy `requireConfig` gate so a missing `PODCAST_INDEX_KEY`/`PODCAST_INDEX_SECRET` surfaces as a clear error instead of a runtime crash, plus `isPodcastIndexConfigured()` for cheap UI gates. `parseFeedEnvelope` collapses the API's `feed: object | array | false` shape to a normalised `PodcastIndexFeed | null`; `parseEpisodeEnvelope` filters out rows missing the fields we actually need (`id` / `guid` / `enclosureUrl`) so callers can trust every row is import-ready, hoists Podcasting-2.0 `<podcast:transcript>` entries to a typed `transcripts[]`, and falls back to the legacy `transcriptUrl` as a single text/plain row. `pickTranscriptUrl` ranks VTT → SRT → plain text → JSON so the transcript path always picks the cleanest format. **No SDK** — same reasoning as Deepgram (avoid pulling Node-only deps into the Inngest bundle for three endpoints).
- [x] **Transcript fetch + normalise** (`server/imports/transcripts.ts`) — `fetchAndNormaliseTranscript(url, type)` with a 15 s timeout. Format dispatch: JSON (Podcasting-2.0 segments → `Speaker: text` per turn, collapsing runs from the same speaker), VTT (strips `WEBVTT` header + cue timing + `<v Speaker>` markup), SRT (strips ordinal numbers + `HH:MM:SS,mmm --> ...` timing lines), HTML (block-level tags become paragraph breaks before tag-strip + entity decode), plain text fallthrough. Returns `null` when the normalised body is empty so the import pipeline can fall back to audio. Custom `TranscriptFetchError` surfaces upstream `status` for the 4xx-vs-5xx branch.
- [x] **"Connect feed" + episode picker** — `Show.rssUrl` was already in the schema (Phase 1 captured it on the show form); no migration needed. New wizard-side actions in `app/(dashboard)/episodes/new/rss-actions.ts`: `connectRssFeedAction(showId, rssUrl)` looks the URL up on Podcast Index, persists the **canonical** `feed.url` back onto the show (so subsequent re-lookups are stable even when the user typed a pre-redirect URL), and returns the recent 25-episode picker shape; `listFeedEpisodesAction(showId)` is the idempotent re-fetch used when the wizard auto-loads a show that already has a feed connected. Both EDITOR+ (same gate as `createEpisode`), tenant-checked via `show.client.agencyId === auth.agency.id` _before_ any external call. Picker row shape (`FeedEpisodeForPicker`) carries `guid` / `title` / ISO-string `datePublishedIso` (server actions can't return Date over the wire) / `durationSec` / `enclosureUrl` / `enclosureType` / `hasTranscript` so the UI can pre-flag "publisher transcript available" vs "will transcribe with Deepgram."
- [x] **Wizard RSS path wired** — `<RssFeedPicker>` (new client component, `components/episodes/rss-feed-picker.tsx`) replaces the prior URL-only input stub on step 2. Auto-loads the connected feed on mount when `Show.rssUrl` is set; falls back to a "Connect feed" form otherwise. Episode list renders as a scrollable card list with per-row "transcript available" / "will transcribe with Deepgram" hint + selection highlight. Selecting a row threads `{guid, feedUrl, title}` back into the wizard's state via `onRssSelection`. Wizard's `createEpisodeAction` payload extended with `rssGuid` / `rssFeedUrl` / `rssTitle` (the publisher title falls through as the episode title default when the user leaves it blank). Step 4 gating: RSS now requires a picked selection in addition to ≥ 1 platform; CTA reads "Import + generate N outputs in {host}'s voice"; transcribing hint reads "we'll pull the publisher's transcript or download the audio." `SampleShow` gained an optional `rssUrl?: string | null` field (sample-data mode leaves it null so the connect-form path renders by default).
- [x] **RSS import Inngest function** (`inngest/functions/import-rss-episode.ts`) — triggered by the new `episode/rss.import.requested` event (`{episodeId, guid, feedUrl, platforms}`). Mirrors `transcribe-episode.ts`'s shape: validates source = RSS, idempotent skip when transcript is already filled, flips Episode → PROCESSING, re-looks up the episode on Podcast Index (so a publisher-added transcript between dispatch and run is caught), and branches **transcript-first → audio-fallback**. Transcript path: `fetchAndNormaliseTranscript` → `persist-transcript` step → `episode/generate.requested`. Audio fallback: stream the enclosure into R2 under the same `audio/<agencyId>/<showId>/<episodeId>.<ext>` key the upload pipeline uses, persist `Episode.audioUrl`, flip `Episode.source` to UPLOAD for the handoff (since `transcribe-episode` refuses non-UPLOAD sources), and fire `episode/transcribe.requested` so Deepgram takes over. 4xx Podcast Index / enclosure / transcript responses become `NonRetriableError`; 5xx + network errors fall through Inngest's default 3-retry policy. Minimum transcript floor (500 chars) protects against a publisher exposing a 1-line stub — the function silently drops to the audio path in that case. 500 MB ceiling on the audio enclosure stops a mis-tagged video feed from running up R2 egress. Registered in `inngest/functions.ts`; event typed in `inngest/events.ts`.
- [x] **`createEpisodeAction` RSS branch** — `createInput` Zod schema gained `rssGuid` / `rssFeedUrl` / `rssTitle` (all optional), plus a `.superRefine` arm that rejects RSS source without both `rssGuid` + `rssFeedUrl`. Episode row gets the GUID pinned on `externalUrl` (free-form `min(1)` validation — `createEpisodeInput.externalUrl` relaxed from `.url()` since publisher GUIDs are often UUIDs or local ids, not URLs). Inngest dispatch fans to `episode/rss.import.requested` on RSS, `episode/transcribe.requested` on UPLOAD, `episode/generate.requested` on PASTE.
- [x] **Tests** — 24 unit tests across `tests/server/imports/podcastindex.test.ts` (HMAC header building, feed/episode envelope parsing including `id: 0` no-match collapse + legacy `transcriptUrl` fallback, `pickTranscriptUrl` ranking) and `tests/server/imports/transcripts.test.ts` (VTT / SRT / JSON / HTML / plain-text normalisation with cue-stripping + speaker labels). 5 new RSS-path cases on `tests/actions/create-episode.test.ts` cover happy-path payload shape + Inngest dispatch, publisher-title fallback for blank user title, and Zod rejection for missing-guid / missing-feed-url / malformed-feed-url. Two existing UPLOAD/PASTE assertions tightened to include the new `externalUrl: null` field. 238 tests total, all green; typecheck clean.
- [ ] Integration test against a real Podcast Index sandbox + Inngest dev server — gated on the same test-DB blocker as 1.5's pipeline integration test.

## 2.9 Real-time progress (SSE)

- [x] **SSE endpoint** `app/api/episodes/[id]/stream/route.ts` (`force-dynamic`, Node runtime). Authenticates the viewer via `requireAuthContext`, tenant-checks the episode via `getEpisode(ctx, id)` (so a cross-tenant id returns 404), then opens a `text/event-stream` response. Per-connection in-memory snapshot + DB poll every 1500 ms (single consolidated `Promise.all` of `listOutputsForEpisode`, `episode.findUnique(status)`, and a `groupBy(platform)` for version counts; an extra `outputTransition.findMany` is only issued when any output is FAILED, so the latest reason can hydrate the per-card error UI). Wire format: `event: snapshot` for the initial frame (full grid), `event: output` for per-platform diffs (id / status / content / quality / version / versionCount / failureReason), `event: episode` when the parent status flips (e.g. PROCESSING → READY), `event: done` when no GENERATING outputs remain and the episode is not PROCESSING, and `:ping` comments every 15 s to keep proxies from idling out. 5-minute wall-clock cap so a stuck connection can't leak forever (client reconnects on the next render). Sample-data mode returns 503 (the UI gates the URL out, but the route defends in case it's hit directly).
- [x] **Client subscribe + reconnect** — `<OutputsView>` accepts a new `streamUrl` prop (`/api/episodes/[id]/stream` in live mode, `null` in sample-data mode). A `useEffect` opens an `EventSource` when `streamUrl` is set AND any output is currently `generating`; the connection auto-closes on the `done` event. SSE updates merge into the existing `LiveOutput[]` state by platform key — server-led fields (id/status/content/quality/version/versionCount/failureReason) always win, but transient UI state (editing, draft, showRegen, regenText, justCopied, justApproved) is preserved so a poll arriving while the user is mid-edit doesn't clobber their draft. `episode` events trigger `router.refresh()` so the parent layout's voice-strength badges + KPI counts pick up the change. Reconnect strategy: native `EventSource` auto-reconnects at ~3 s on transient drops; after >3 consecutive `onerror` we explicitly close + retry with exponential backoff (capped at 30 s).
- [ ] Integration test against a real Prisma + Inngest dev server — gated on a test DB (same blocker as Phase 1.5's pipeline integration test).

## 2.10 Onboarding — polish (core flow lives in 1.0)

> The four-step onboarding flow itself ships in 1.0 (it's a prerequisite for self-service signups). What stays here is the post-MVP polish that lifts activation rate.

- [~] PostHog funnel: `onboarding_started → agency_created → first_client_added → first_episode_generated` — all four events wired through the existing typed `EventMap`. `onboarding_started` + `agency_created` fire client-side from `<OnboardingWizard>` (mount-effect with a `useRef` gate so StrictMode's dev double-mount doesn't double-fire); `agency_created` fires after `createAgencyAction` returns ok, carrying the chosen `plan`. `first_client_added` fires server-side from `createClientAction` — a `prisma.client.count` runs _before_ the create, and the event only fires when the prior count was 0 (so it lands exactly once per agency, never on the 2nd/3rd client). `first_episode_generated` fires from `inngest/functions/generate-episode.ts` — the `mark-ready` step.run now returns whether the agency had exactly 1 READY episode after the flip; if so, the event is fired inside a separate `track-first-episode` step.run, so Inngest's memoization keeps retries from re-firing. `docs/observability.md` updated with the four new rows + a funnel-notes section explaining the dedupe gates. Drop-off alert threshold itself still TODO — needs the PostHog dashboard to be stood up first.
- [x] Progress restoration — new `Agency.onboardingStep` enum (`WORKSPACE | TEAMMATES | CLIENT | DONE`, default `DONE` so pre-2.10 rows aren't pulled back into the wizard) drives a step-based resume. `createAgencyForUser` writes `TEAMMATES` at agency creation; the wizard fires `setOnboardingStepAction` after each advance/skip/finish (fire-and-forget, never blocks the UI); the `/onboarding` layout swapped its `userHasAnyMembership` redirect for `onboardingStep === DONE`. `OnboardingPage` reads the step and seeds the wizard via a new `initialStep` prop; the wizard's `onboarding_started` analytics event is now also gated on `initialStep === "workspace"` so a resume doesn't re-fire the funnel-top event. `setOnboardingStepForUser` repo helper is monotonic — never moves the step backwards (handles double-tab races and a partial-write replay).
- [x] Drop-off recovery emails — new `OnboardingNudgeSent` dedupe table (`@@unique([agencyId, marker])`) mirroring `BillingReminderSent`. Two new React Email templates (`onboarding-finish-setup.tsx`, `onboarding-first-client.tsx`) + matching `sendOnboardingFinishSetupEmail` / `sendOnboardingFirstClientEmail` helpers. New `check-onboarding-nudges` Inngest cron on `0 * * * *` (hourly — Inngest bills per `step.run` so the precision is free, and a 14h timing slop on a "finish setup" nudge would defeat the purpose). Two markers fire independently: `24h` (createdAt window matched AND `onboardingStep !== DONE`) and `72h` (createdAt window matched AND `clients: { none: {} }`). Both can fire for the same agency by design — they're escalating reminders, not alternative paths. Claim-then-send pattern matches `check-renewals.ts`: `onboardingNudgeSent.create` first, P2002 → skip, no deliverable OWNER → release the claim so a future run can retry once a real email is on file. `markerWindow(now, hours)` returns a 1h-wide bracket `[now-(h+1), now-h)` that partitions signups across back-to-back hourly runs without overlap or gap; covered by 4 unit tests.
- [x] Sample-transcript shortcut — paste-step (step 2) textarea now defaults to **empty** (previously seeded with a 167-word stub that would silently fail the server's 500-word validator). A new `<TranscriptHint>` row below the textarea swaps between three states: empty → "Use a sample transcript" pill that loads a ~570-word demo conversation (Maya × Dani interview), sample-loaded → "Demo transcript loaded · Clear sample" affordance, real content → amber word-count gate under 500 / green check at/over. Step 4's Generate button now also gates on `wordCount < 500` for the paste method, with an inline "Add at least 500 words on step 2 before generating" hint — surfaces the validator pre-submit instead of as a generic post-submit error.
- [ ] Time-to-value target: under 5 minutes from `/sign-up` submit → first generated output visible on `/episodes/{id}`

## 2.11 Clip-moment suggestions

- [x] Extract top 5 clip moments (timestamp + snippet) during generation — `extractKeyMoments` was already running once-per-episode in `generate-episode.ts` to share narrative across platform prompts; this task now also **persists** the returned `KeyMoment[]` to `Episode.keyMoments` (new JSONB column, migration `20260629071500_episode_key_moments`). The persist step lives in its own `step.run` so retries don't double-write.
- [x] Display as a "Clip moments" panel on the outputs screen with copyable timestamps — new `<ClipMomentsPanel>` client component renders between the progress strip and the output grid on `/episodes/[id]`. Auto-fill grid of cards: bold topic, monospace-feel timestamp pill, italicized quote, one-line insight, "Copy quote" pill that flips to a "Quote copied" check for ~1.3 s. Returns null when `keyMoments` is null/empty (brand-new episode pre-generation), so no synthetic placeholder shows up. `getEpisodeForUI` surfaces the JSONB column to the UI shape; sample-data mode ships fixture moments for two of the three seeded shows so the design preview is representative.

## 2.12 Episode history

- [x] **Episodes list** (`/episodes`): filter by show/status/date, search, paginated, bulk-approve enabled. New `listEpisodesFiltered(ctx, { search?, showId?, clientId?, status?, take, skip })` repo helper + `listEpisodesFilterInput` Zod schema; tenant scope anchored via `show.client.agencyId`, case-insensitive title search, `_count: { outputs: { supersededAt: null } }` so the per-row output count matches the grid. `listEpisodesForUI` + `listEpisodeFilterOptionsForUI` shims map the rows to a list UI shape (initial+avatarBg derived per show name); sample-data mode returns the seeded episodes. New `/episodes` page (Server Component, `searchParams: Promise<…>`) renders a status-pilled list with prev/next pagination (25/page) + a `<EpisodeFilters>` client form (debounced search 250 ms, show/status selects, Clear button, page-1 reset on filter change). Sidebar gets a dedicated **Episodes** nav item; `<NavLink>` switched to a most-specific-match rule (longest matching `href` wins) so `/episodes/new` activates "New Episode" instead of double-highlighting both entries. 4 new tenant-isolation tests cover the where-shape, filter layering, empty-search predicate skip, and role gate. **Date-range filter landed** — `listEpisodesFilterInput` gained `from?` / `to?` (`z.coerce.date()` so URL strings parse cleanly); `buildEpisodeListWhere` layers them onto `where.createdAt` with `to` widened to end-of-day local time (so "through Jun 24" includes that day). `<EpisodeFilters>` got two native `<input type="date">` pickers inside a single grouped control with `min`/`max` cross-anchored so the picker UI itself blocks `to < from`. Page parser drops invalid date strings silently and echoes the original URL strings on prev/next links so the picker keeps its displayed value across pagination. 1 new tenant-isolation test asserts the where shape + end-of-day extension (146 tests total). **Bulk-approve landed** — new `bulkApproveOutputsForEpisodes(ctx, episodeIds, approvingMemberId)` repo helper finds every READY/IN_REVIEW current-version output across the supplied tenant-scoped episodes and runs `{update + transition + voice-sample}` per output inside a single `prisma.$transaction` (cuts round-trips from 3N to 1, atomically rolls back on mid-stream failure). New `bulkApproveEpisodesAction` server action (role-gated to approvers via `requireAuthContext`, Zod-bounded to ≤ 50 ids) revalidates the `/episodes`, `/voice`, `/clients` layouts. List page swapped its server-rendered row map for a new client `<EpisodeListSelection>` wrapper — per-row checkboxes (hidden for non-approver roles), a "Select all on page" toggle, a sticky bottom action bar showing the selection count + an "Approve all READY outputs in N episode(s)" button, plus a green success banner ("Approved X outputs across Y episodes") and red error banner. 3 new tenant-isolation tests cover the where-clause + transaction op count, the empty-input / no-candidates short-circuits, and the EDITOR role rejection (142 tests total).

## 2.13 Client management & billing support

> Source: `ref/Specs.docx` §4.4. Repodcast becomes the **system of record + reporting layer** for the work an agency delivers per client — billing profile metadata, an auditable deliverable ledger, white-labeled period statements, cost-to-serve, and export/hand-off to the agency's own invoicing tool.
>
> **Scope boundary: Repodcast NEVER collects, holds, or processes payments** between the agency and its clients. Becoming a payment facilitator would pull in KYC, money-transmission compliance, dispute liability, and marketplace economics — heavy scope that erodes margin and focus. Instead this layer accelerates the agency's own billing in QuickBooks / Xero / Stripe Invoicing (on the **agency's own** account) / etc. This is also part of the moat: client rosters, deliverable history, and billing metadata all accumulate in one place.
>
> Why it lands in Phase 2: it sits alongside white-label delivery (2.5), the approval workflow (2.3), and the team / activity-log work (2.4) as the **agency-operations stack**. Most of the data infrastructure is already in place — `Episode` + `GeneratedOutput` + `OutputTransition` give us the deliverable ledger; `UsageLog` gives us cost-to-serve. What's new is the per-client billing profile, statement generation + persistence, the agency-branded surfaces, and a tokenized client portal.

### 2.13.1 Schema additions

- [x] **`ClientBillingProfile`** (1:1 with `Client` via `clientId @unique`) — landed in migration `20260629075000_client_management`. Fields: `billingContactName`, `billingContactEmail`, `retainerCents Int?`, `ratePerEpisodeCents Int?` (mutually exclusive at the app layer, both nullable), `billingCycle BillingCycle @default(MONTHLY)`, `currency String @default("USD")`, `contractStartDate DateTime?`, `contractRenewalDate DateTime?`, `status ClientStatus @default(ACTIVE)`, `paymentLinkUrl String?` (out-of-app payment CTA on the portal — never processed by Repodcast), `internalNotes String?`. `onDelete: Cascade` from the parent `Client`. Indices on `status` and `contractRenewalDate` (the renewals cron pivots on the date + status together).
- [x] **`ClientStatement`** landed in the same migration. Snapshot totals (`episodeCount`, `outputCount`, `approvedCount`, `approvalRatePct Int` 0–100, `costCents`) + `generatedAt` + `generatedByMemberId String?` (SetNull on member delete, named relation `StatementAuthor`) + R2 storage keys (`pdfStorageKey?`, `csvStorageKey?`) + webhook dispatch markers (`webhookDeliveredAt?`, `webhookExternalRef?`). Composite indices `(clientId, periodStart DESC)` for the statement list and `(clientId, generatedAt DESC)` for "most recently generated."
- [x] **`ClientPortalLink`** landed — tokenized read-only access with cuid `token @unique @default(cuid())` mirroring the homegrown `MemberInvite` flow. `expiresAt DateTime`, `createdByMemberId String?` (named relation `PortalLinkAuthor`), `revokedAt?`, `lastAccessedAt?`. Indices on `(clientId, expiresAt)` for cleanup queries and on `createdByMemberId`.
- [x] **`ClientPortalAccessLog`** landed — append-only audit row per `/portal/[token]` view: `portalLinkId`, `viewedAt @default(now())`, optional `ipHash` (sha-256 of `req.ip`, to be hashed in the route — schema stores the digest only), optional `userAgent`. Index `(portalLinkId, viewedAt DESC)`.
- [x] **Enums** `BillingCycle` (`MONTHLY | QUARTERLY | ANNUAL | PROJECT`) and `ClientStatus` (`ACTIVE | PAUSED | CHURNED`) added at the top of `schema.prisma`.
- [x] **`BillingReminderSent`** dedupe table landed at the same time (used by 2.13.6 renewals cron). Composite unique `(clientId, marker)` where `marker` is `"30d"` / `"7d"`, plus `(agencyId, sentAt)` index. Cascades on both `Agency` and `Client` deletes; the second FK uses an explicit map name to avoid Prisma's default-name collision on dual-table cascades.
- [x] **`Agency.renewalRemindersEnabled Boolean @default(true)`** added — the renewals cron will respect it. Pairs with a per-agency mute toggle on `/settings/agency` (2.13.6).
- [x] **No new table for the deliverable ledger** — confirmed, will derive live from joins on `Episode` + `GeneratedOutput` + `OutputTransition` when 2.13.3 lands.
- [x] **Migration ready to apply**: `npm run db:migrate` against the live DB will land `prisma/migrations/20260629075000_client_management/migration.sql` (2 enums + 4 new tables + 1 column add). `npm run db:generate` already regenerated the Prisma client; typecheck + 161 tests stay green.

### 2.13.2 Billing profile CRUD

- [x] **Repo `server/db/client-billing.ts`** — `getClientBillingProfile(ctx, clientId)` + `upsertClientBillingProfile(ctx, clientId, input)`. Role-gated to OWNER/ADMIN (billing data is sensitive — EDITORs and REVIEWERs are blocked at the repo). `clientBillingProfileInput` Zod schema enforces a 3-letter ISO-4217 currency code, optional URL / email shapes (empty string → `undefined`), retainer-vs-rate XOR via a `refine`, and renewal-date-after-start. `upsertClientBillingProfile` verifies `Client.agencyId === ctx.agencyId` _before_ writing — a cross-tenant id surfaces as `NotFoundError`, not a row leak. Currency is upper-cased on the way in so URL-style lowercase ("usd") still lands as `"USD"` in storage.
- [x] **Server action** `updateClientBillingProfileAction` (`app/(dashboard)/clients/[key]/billing/actions.ts`). Zod-validated, calls `upsertClientBillingProfile`, revalidates `/clients/[id]` as a `layout` route so the header card + tab content both refetch. Sample-data mode short-circuits to a synthetic success.
- [x] **UI: tabbed `/clients/[key]/...` chrome** — new `app/(dashboard)/clients/[key]/layout.tsx` owns the back link + header card + tab nav (`<ClientTabNav>`). Existing `page.tsx` slimmed down to just the Shows section (Overview tab). New `app/(dashboard)/clients/[key]/billing/page.tsx` is the Deliverables & Billing tab.
- [x] **`<ClientBillingForm>`** (client component) renders contact name/email, retainer-vs-rate radio (dollars-in / cents-stored, `inputMode="decimal"`), cycle picker, currency dropdown, contract start + renewal dates with `min` cross-anchored, status select, payment-link URL, internal notes. Live status pill in the header reflects the picker. `useTransition` submit with inline error + ✓ Saved confirmation; `router.refresh()` after success so the header + tab nav stay in sync.
- [x] **Cost-to-serve + Deliverable ledger sub-panels** rendered as dashed-border placeholders on the Billing tab pointing at 2.13.3 and 2.13.5 — they slot in above/below the form when those sections land.
- [x] **Role gate (server side)** — `app/(dashboard)/clients/[key]/billing/page.tsx` redirects EDITOR/REVIEWER back to the Overview tab. The `<ClientTabNav>` already hides the tab link for those roles via `showBillingTab`, but a direct URL hit needs the server guard too.
- [x] **Tests** — 6 new tenant-isolation cases (167 total): read tenant scope (where shape via `client.agencyId` join), read role gate (EDITOR + REVIEWER), upsert parent-client tenancy check (cross-tenant id → NotFoundError, no DB write), upsert normalisation (retainer kept / rate nulled / currency upper-cased / update + create branches both carry the values), upsert XOR refine (both retainer + rate set → ValidationError), upsert write role gate (EDITOR + REVIEWER blocked before any DB lookup).

### 2.13.3 Deliverable ledger

- [x] **Repo `server/db/deliverables.ts`** — `listDeliverablesForClient(ctx, clientId, { from?, to?, platform?, status?, take, skip })` returns `{ rows, total }`. Each row is a current-version `GeneratedOutput` joined to episode title + `recordedAt` and the approving member (`name`/`email`). Tenant-scoped via the existing nested `episode.show.client.agencyId` join, plus a pre-flight `assertClientInTenant` so a cross-tenant id surfaces as `NotFoundError` instead of silent empty rows. Open to all four roles for read. Companion `streamDeliverablesForClient` shares the same where-builder for the CSV export path.
- [x] **`buildDeliverablesWhere`** internal helper layers `platform`, `status`, and `createdAt` range (with `to` widened to end-of-day local time so "through Jun 24" includes that day) onto the tenant anchor — same shape pattern as `buildEpisodeListWhere`.
- [x] **UI** — `/clients/[key]/billing` now mounts the real ledger as a `<section>` underneath the billing form (form rendered only for OWNER/ADMIN; ledger always rendered). Each row: platform badge, linked episode title, status pill (palette matches `<OutputCard>`), "Generated" date, "Approved by … · date" when approved. Empty states branched on filtered-vs-unfiltered.
- [x] **`<DeliverableLedgerFilters>`** client component mirrors the `/episodes` filter pattern — date pickers with `min`/`max` cross-anchored, platform + status selects, Clear button, page-1 reset on any change, and an Export CSV link sitting on the right that's disabled for non-OWNER/ADMIN with a `title` hint.
- [x] **Pagination** — 25/page prev-next inside the section, preserves filter params on the links.
- [x] **Tab gate flipped** — the `<ClientTabNav>` `showBillingTab` is now always on; the Billing form sub-panel inside the tab stays OWNER/ADMIN-only at the page level, and EDITOR/REVIEWER land on the ledger view directly.
- [x] **CSV export route** `app/api/clients/[id]/deliverables/route.ts` — GET, `force-dynamic`, Node runtime, OWNER/ADMIN gate via `requireAuthContext`. Resolves the client (also a tenant gate), parses `from`/`to`/`platform`/`status` from the URL, calls `streamDeliverablesForClient`, formats with RFC-4180-style escaping (cells quoted when they contain `,` / `"` / `\r` / `\n`; internal quotes doubled). Filename slugs the client name + appends `-deliverables-<from>_<to>.csv` (or `all` for an unbounded side). Sample-data mode returns 404.
- [x] **Tests** — 6 new tenant-isolation cases (173 total): pre-flight tenant gate via `assertClientInTenant` (cross-tenant id → NotFoundError, no DB write), where shape (`supersededAt: null` + nested tenant + clientId), filter layering (platform + status + EOD-extended date range), REVIEWER read access, no-role rejection, `streamDeliverablesForClient` no-pagination shape parity.

### 2.13.4 Monthly client statement

- [x] **Repo `server/db/client-statements.ts`** — `generateClientStatement(ctx, clientId, byMemberId, { periodStart, periodEnd })` runs four parallel `count`/`aggregate` calls (episode + output + approved + approval-rate denominator + sum-cost-cents via `UsageLog`), then writes a `ClientStatement` row with the snapshot. Approval-rate denominator matches the dashboard's definition (`approved / (approved + ready + in_review)`). `periodEnd` widened to end-of-day local time inside the repo. Companion `listClientStatements` (paginated, double-sorted `periodStart DESC, generatedAt DESC`) + `getClientStatement` (joined to `client` + `generatedByMember`). All gated to OWNER/ADMIN; pre-flight `assertClientInTenant` so cross-tenant ids surface as `NotFoundError`.
- [x] **Server action** `generateClientStatementAction` (`app/(dashboard)/clients/[key]/statements/actions.ts`) — Zod-validated, calls the repo, revalidates the list page, returns the new statement id for the client redirect. Sample-data short-circuit with a synthetic id.
- [x] **List page** `/clients/[key]/statements` — `<GenerateStatementForm>` (client component) at the top defaulting to current calendar month → today, with date pickers `min`/`max` cross-anchored; below it, paginated table of past statements with period range, totals, cost-to-serve formatted as USD, generated-on, and "View →" link to detail. OWNER/ADMIN server-side redirect.
- [x] **Detail page** `/clients/[key]/statements/[id]` — back link, four StatBlock cards (Episodes / Outputs / Approved-with-rate / Cost-to-serve), "About this statement" note explaining the snapshot semantics. Export buttons: **CSV active**, **PDF disabled** (deferred), **Send to client portal disabled** (waits for 2.13.8). Defence-in-depth check that the statement's `clientId` matches the URL key.
- [x] **CSV export route** `app/api/clients/[id]/statements/[statementId]/route.ts` — GET, `force-dynamic`, Node runtime, OWNER/ADMIN gated. Outputs a header block (client / period / generated-by) + totals + a blank row + a per-platform breakdown (`groupBy` on platform × status, then pivot) computed from current outputs in the window. Per-platform counts can drift if outputs are later regenerated; the snapshot totals at the top stay the contract. RFC-4180 escaping; filename slugs the client name + period dates.
- [x] **Statements tab** — `<ClientTabNav>` gained a `showStatementsTab` prop; layout enables it for OWNER/ADMIN only. Three tabs now: Overview / Deliverables & Billing / Statements.
- [x] **Tests** — 7 new tenant-isolation cases (180 total): list where shape + ordering, list role gate (EDITOR + REVIEWER), get tenant scope + include shape, get NotFoundError on missing row, generate aggregation math + persisted-row shape + end-of-day widening, generate cross-tenant + EDITOR rejection, generate zero-eligible (no outputs) handles divide-by-zero + null `_sum` → 0.
- [ ] **PDF render** — deferred. `@react-pdf/renderer` is a heavy dep; CSV covers the v1 invoicing need. PDF will slot in when the white-label branding tokens (2.5) land — they're the source-of-truth for logo + accent color.
- [ ] **Per-platform breakdown in the in-app detail page** — deferred. Already in the CSV export; the in-app surface gets it alongside the PDF preview since both share the same aggregate.
- [ ] **"Send to client portal" CTA** — disabled until 2.13.8 ships the tokenized portal route.
- [ ] **Sample-data statement fixture** — deferred. /statements list in sample-data mode shows the empty state today; not a blocker for the design preview.

### 2.13.5 Cost-to-serve & profitability

- [x] **Repo `server/db/client-cost.ts`** — `costForClient(ctx, clientId, { from?, to? })` sums `UsageLog.costCents` through the nested `episode.show.client.id + agencyId` join + counts episodes in the window in parallel; returns `{ costCents, episodeCountInWindow }` so the UI can derive `revenue = rate × episodes` without a second query. `costByClient(ctx, { periodStart, periodEnd })` agency-wide rollup: pulls all clients (+ their 1:1 `ClientBillingProfile`), fans out one `UsageLog.findMany` + one `Episode.groupBy(by: showId)` + one `Show.findMany` lookup, then pivots in memory. Defaults the window to the current calendar month (matches `planCapacity`'s `monthStart` semantics). Both gated to OWNER/ADMIN; pre-flight `assertClientInTenant` on `costForClient`. Comment in the code calls out the eventual switch to a nightly UsageLog rollup table (cross-cutting Operations item) when row counts grow past the current single-`findMany` budget.
- [x] **Per-client margin card** — new `<CostToServeCard>` mounted on `/clients/[key]/billing` (OWNER/ADMIN only, sample-data passes `null` → "connect a database" branch). Three Stat blocks: Cost-to-serve (with episode count hint), Revenue (retainer when set, else `episodes × rate` shown as the formula, else "—" with a prompt to fill in the form), Margin (`Intl.NumberFormat` currency formatting, amber when negative — surfaces under-priced clients early; green when positive; muted when no profile). Replaces the dashed-border placeholder.
- [x] **Agency-wide rollup on `/settings/billing`** — new "Cost-to-serve by client" section (OWNER/ADMIN only) below the plan ladder + above the invoices list. `<ClientCostRollupTable>` sorts negative-margin rows first so the actionable ones land on top, then no-profile, then positive descending. Columns: client name (links to `/clients/[id]/billing`), cost, revenue, margin (color-coded), episodes-in-window. Empty state when the agency has no clients. The `cache: 'force-cache'` hint mentioned in the original draft is deferred until we hit dashboard-refresh contention — current query is a single `findMany` + `aggregate` per page render.
- [x] Reuses existing `UsageLog.costCents` rows + the Phase 2.13.1 `ClientBillingProfile`. No schema change.
- [x] **Tests** — 8 new tenant-isolation cases (188 total): `costForClient` where shape via nested join, role gate (EDITOR + REVIEWER), cross-tenant client → NotFoundError, null `_sum` → 0; `costByClient` end-to-end pivot math (retainer + rate × episodes + no-profile all in one fixture), agency anchoring across all 4 queries, zero-clients short-circuit (no follow-up queries), role gate.

### 2.13.6 Billing & renewal reminders

- [x] **Inngest cron** `inngest/functions/check-renewals.ts` (id `check-renewals`, `cron: "0 14 * * *"` — 14:00 UTC, mid-morning Pacific). For each marker (30d, 7d): `markerWindow(now, days)` derives a 1-day UTC bracket (`[now+days 00:00 UTC, +1 day 00:00 UTC)`), then `ClientBillingProfile.findMany` selects ACTIVE clients with renewal in that slot **on agencies where `renewalRemindersEnabled = true`**. Reads stay OUTSIDE `step.run` so the `Date` typing survives (Inngest JSON-serialises step return values — `generate-episode.ts` documents the same gotcha). Registered in `inngest/functions.ts`.
- [x] **Idempotency** — each (clientId, marker) ping is claimed via `prisma.billingReminderSent.create`; the composite unique `(clientId, marker)` makes a duplicate insert throw Prisma `P2002`, which the cron catches and treats as "already sent." The claim is released (`deleteMany`) when no deliverable recipient exists so a future run after the agency adds an admin can re-attempt. Each `claim` / `release` / `send` is wrapped in its own `step.run` for retry memoisation.
- [x] **Email template** `server/email/templates/client-renewal-reminder.tsx` — React Email layout matching the existing welcome / invite templates: amber "Renewal in N" kicker, headline `{clientName} renews on {date}`, body explaining the cost-to-serve cue, primary CTA to `/clients/[id]/billing`, footer note pointing at the Settings → Agency mute toggle. `sendClientRenewalReminderEmail(to[], props)` helper added to `server/email/send.ts` with marker-aware subject (`"Renewal in 7 days — {client}"` vs. `"Renewal coming up — {client}"`).
- [x] **Recipients** — `prisma.member.findMany` for OWNER + ADMIN on the target agency, excluding the `@clerk.local` synthetic emails the auth-sync helpers stamp on placeholder rows.
- [x] **Mute toggle** on `/settings/agency` — `<RenewalRemindersToggle>` client component renders an accessible switch (`role="switch" aria-checked`) with optimistic flip + error rollback. Wired to a new `updateRenewalRemindersAction` server action backed by `updateRenewalReminders(ctx, { enabled })` in `server/db/agencies.ts` (`updateMany` keeps the write tenant-scoped; 0-rows → `NotFoundError`). Same OWNER/ADMIN role gate as the agency rename; non-admins see a read-only "owners and admins only" hint.
- [x] **`BillingReminderSent` dedupe table** — already created in 2.13.1; now actively used by the cron's claim/release flow.
- [x] **Tests** — 7 new pure-helper tests cover `markerWindow` (UTC midnight alignment for 30d + 7d markers, idempotency within a UTC calendar day, non-overlap between the two windows) and `daysBetween` (round-up to whole days, past renewals → 0, exact 1-day case). End-to-end cron exercise needs a Prisma + Inngest harness (deferred — 195 tests total).

### 2.13.7 Export & hand-off

- [ ] **CSV downloads** (deliverable ledger + per-statement export) — server route returns text/csv response, no server-side storage required.
- [ ] **PDF download** — signed R2 download URL of the `pdfStorageKey` written in 2.13.4. Reuses `signR2DownloadUrl`.
- [ ] **Deliverables webhook** per agency: `/settings/agency` adds a "Deliverables webhook URL" field (validated as `https://...`). When a `ClientStatement` is generated, POST the JSON payload there. Signed with HMAC-SHA256 like the Clerk / Stripe inbound webhooks (`X-Repodcast-Signature` header, `X-Repodcast-Timestamp` for replay protection). Persist the response id to `webhookExternalRef`. Retries via Inngest (3 attempts, exponential backoff).
- [ ] **Zapier instructions** in new `docs/integrations.md` — sample webhook payload, recipe templates for "When a statement is generated → create a QuickBooks invoice / Xero invoice / Stripe Invoice on my own account."
- [ ] **Stripe Invoicing handoff (deferred behind v1)** — pre-built integration that POSTs a draft invoice to the agency's own Stripe account using a stored API key (encrypted at rest with a Prisma `EncryptedString` helper; we'd write the helper in this task). Defer until v1 ships and we hear whether agencies want it; the basic webhook covers it generically.

### 2.13.8 Client-portal deliverables view

- [ ] **Tokenized read-only portal** route `/portal/[token]` (this **is** the client portal of 2.5; that section becomes the white-label settings + branding layer, this section is the route itself). Public in `middleware.ts`. Renders:
  - Header: agency-branded logo + accent color (Phase 2.5 white-label tokens).
  - Current period deliverables table (episodes processed, outputs by platform, approval rate).
  - List of past statements with download links to the signed R2 PDF/CSV.
  - "Make payment" CTA linking to `ClientBillingProfile.paymentLinkUrl` (set by the agency in 2.13.2). Wire it as an `<a target="_blank" rel="noopener noreferrer">` — explicit external navigation, no auto-redirect.
- [ ] **Token minting** — `mintClientPortalLink(ctx, clientId, { ttlDays })` in `server/db/client-portal.ts`. Default TTL 90 days; revocable from the agency-side Deliverables & Billing tab. Surfaces a copyable URL the agency emails to the client.
- [ ] **Audit log** — every portal `GET` writes a `ClientPortalAccessLog` row (request-side hash, no raw IP). Surfaced under the Deliverables & Billing tab as "Last accessed: 2 days ago · 7 views this period."
- [ ] **No payment processing inside the route** — full stop. The CTA is the only money-shaped UI element and it routes outward.

### 2.13.9 Scope boundary (docs + UI)

- [ ] New `docs/scope-billing.md` — written explanation of why Repodcast never sits in the money flow, what data Repodcast does (`ClientBillingProfile`, `UsageLog`, `ClientStatement`) and doesn't store (no card details, no bank info, no agency-to-client invoice rows) on behalf of the agency.
- [ ] `/settings/billing` gains a small disclaimer panel: "Repodcast bills your agency for platform usage. Agency-to-client invoicing happens in your own accounting tool — see Deliverables & Billing on each client to export the statement."
- [ ] Privacy / Terms updates — call out that Repodcast doesn't process agency-to-client payments. (Drafted with the launch checklist in Phase 3.)

### Resolves elsewhere in the plan

- **2.5 White-label & client portal** — the portal route (2.13.8) **is** the client portal of 2.5. White-label settings (2.5) become the source of truth for portal + statement branding (logo, accent color, custom subdomain). The two sections cross-reference.
- **Operations cron jobs** — 2.13.6 renewals cron pairs naturally with the existing "nightly UsageLog rollup" item in the cross-cutting Operations section.
- **2.4 Team & activity log** — `OutputTransition.byMemberId` already records who approved each output, so 2.13.3's ledger join is a one-line addition to the existing `listOutputsForEpisode` shape.

### Exit criteria

- An OWNER can fill in a `ClientBillingProfile` for any client; the **Deliverables & Billing tab** on the client page reflects it.
- A `ClientStatement` for any past or current period can be generated, previewed in the app, and exported as PDF or CSV.
- Cost-to-serve per client lines up with the per-agency rollup on `/settings/billing`.
- A renewal reminder email lands ≤ 24 h before each 30-day / 7-day pre-renewal marker for any opted-in agency.
- A client receiving a tokenized portal link sees the right statements + deliverables and an out-of-app "Make payment" CTA; every portal access is auditable.
- The deliverables webhook fires on statement generation and persists the response id; replays are signature-checked.
- **No Repodcast surface ever accepts or holds money on the client's behalf.** The docs + the `/settings/billing` disclaimer make this explicit.

**Exit criteria for Phase 2:** A client crossing ~20 approved samples produces output editors post with little/no editing; audio + RSS inputs work; approval, white-label, batch, **client-management + billing-support**, and teams are functional; progress streams live.

---

# Phase 3 — Growth & Scale

> Goal: public launch readiness — acquisition, retention, admin, top tier.

## 3.1 Landing page

> Promoted from "stub" to a real starting point — the reference HTML in `ref/UI/Landing/Repodcast Landing.dc.html` is the source of truth for layout, copy, and design language. Built before launch so we can ship a marketing surface alongside the app instead of after.

### Routing & auth

- [x] `app/page.tsx` renders `<LandingPage>` for everyone (signed-in users no longer auto-redirect to `/dashboard` — there were too many cases where the user wanted to see the marketing surface even while signed in).
- [x] `/` is in `middleware.ts` public matcher; unauthenticated visitors aren't bounced to `/sign-in`.
- [x] **Auth-aware CTAs** — when the visitor is signed in, the nav swaps "Sign in" + "Start free" for a single "Open dashboard" pill; the hero primary CTA flips from "Start free" → "Open dashboard" (and the trial fineprint hides); the pricing cards' plan CTAs all link to `/dashboard`; the final CTA collapses to a single "Open dashboard" button. Server-rendered via `await auth()` in the page component, passed as `isSignedIn` prop.
- [x] CTAs route to `/sign-up` (primary) and `/sign-in` (secondary) for signed-out visitors. Anchor links (`#how`, `#voice`, `#pricing`, `#faq`) scroll within page.

### Typography

- [ ] Add **JetBrains Mono** via `next/font/google` (weights 400/500) and expose as `--font-mono` in the `@theme` block. Used for kicker eyebrows ("FOR PODCAST AGENCIES"), section labels, code-like accents.
- [ ] Sora 700 for hero/section headlines with `letter-spacing: -0.035em` — the existing Sora wire-up covers this.

### Sections (mapped to `ref/UI/Landing/Repodcast Landing.dc.html`)

- [ ] **Nav** — sticky, `backdrop-filter: saturate(180%) blur(16px)` semi-transparent white. Brand mark (SVG waveform + "Repodcast" wordmark) + 4 nav links (`How it works`, `Voice Engine`, `Pricing`, `FAQ`) + `Sign in` ghost link + `Start free` primary.
- [ ] **Hero** — split grid (1.02 / 0.98). LEFT: mono kicker, Sora 700 56px headline ("Sounds exactly like you. / Gets better every episode."), sub, dual CTA, "No credit card · 14-day trial" caption. RIGHT: product mockup with episode header + "Voice: Strong" pill, animated waveform on dark band, platform tabs (LinkedIn active), generated sample, "generated in 48s" + Approve / Tweak buttons. Background: radial gradient + dotted texture + floating accent orb.
- [ ] **Logo strip** — "Trusted by growing studios" + 5 studio names in Sora 600 at reduced opacity.
- [ ] **Problem** — split grid. LEFT: kicker + 38px headline + paragraph. RIGHT: 3-column stat panel (`6–9h`, `3+`, `$40–70`) inside a bordered card.
- [ ] **How it works** — 3 numbered cards in a single hairline-grid container. Each: mono number ("01"), Sora 600 20px title, paragraph, mono pill tags.
- [ ] **Voice Engine** (dark showpiece) — `#1A2A4A` background, `#13203B` panel inset. Decorative blob + concentric rings + dotted texture. Two-column panel inside: LEFT client picker, RIGHT split (LinkedIn sample card + voice-strength panel with progress bar, "Learned traits" bullet list). Active client state drives the right panel.
- [ ] **Three Pillars** — 3 hairline-grid cards: "In your client's voice, not the AI's." / "Built for agencies, full stop." / "Gets better the more you use it."
- [ ] **Outputs** — header + tagline "7× the output, one drop-in." 4-col grid of 8 cards: 7 platforms + a dark inset card "All written in the client's voice."
- [ ] **Social Proof** — 3 testimonials in hairline grid: quote, avatar circle (initials on `#1A2A4A`), name + role/studio in mono.
- [ ] **Pricing** — centered header + 3 plan cards. Studio $99 (white), Agency $249 (dark, "Most popular" badge), Network $499 (white). Each: name, tagline, price, CTA, 4–5 feature bullets with `→` markers.
- [ ] **FAQ** — split (0.7 / 1.3). LEFT: kicker + Sora 700 34px headline. RIGHT: 6 expandable Q&A items, accordion (single open). `+` icon rotates 45deg on open.
- [ ] **Final CTA** (dark) — full-bleed `#1A2A4A` with low-opacity animated waveform bg. Split: LEFT headline + sub, RIGHT dual CTA.
- [ ] **Footer** — `#13203B`, 4-col grid (brand + Product / Company / Legal) + bottom row (copyright + tagline).

### Interactive components

- [ ] **`<ClientPicker>`** for Voice Engine — `useState` for active client index. Three demo clients (The Founder's Cut, Mid-Run Mornings, Tape & Tonic) each with show name, initials, voice strength, sample post, learned traits. Switching updates the right panel in place. Active row highlighted with `#1E3056`.
- [ ] **`<FAQAccordion>`** — `useState` for open index. Click toggles; opening a new one closes the previous. `+` ↔ `×` via `transform: rotate(45deg)` with `transition: transform .2s`.

### Animations / motion

- [ ] `@keyframes eq` waveform bars in hero + final-CTA background.
- [ ] `@keyframes floaty` for accent orbs (9s ease-in-out).
- [ ] `card-lift` hover (translateY(-2px) + border shift) on output cards.
- [ ] `html { scroll-behavior: smooth }` for anchor jumps.

### Design tokens (additions)

- [ ] `--color-marketing-ink: #1A2A4A`, `--color-marketing-deep: #13203B`.
- [ ] `--color-marketing-mint: #7FE3B0`, `--color-marketing-mint-bg: #EAF7F0`, `--color-marketing-mint-text: #1F8A5B`.
- [ ] `--color-marketing-muted: #9AA3B2`, `--color-marketing-muted-deep: #6B7BA3`, `--color-marketing-soft: #A9B6D4`.
- [ ] `--font-mono`.

### SEO (deferred polish — done with the launch checklist)

- [ ] `metadata` export on `app/page.tsx` (title, description, openGraph, twitter cards).
- [ ] OG image — render to `public/landing/og.png` (1200×630).
- [ ] `public/robots.txt` + `app/sitemap.ts`.

### Out of scope (deferred)

- Live demo widget (paste transcript → real-time outputs) — biggest dev item; left for a follow-up since it needs a sandboxed Claude call.
- Scroll-triggered animations beyond basic CSS keyframes.
- Mobile-specific layout — desktop-first; sections collapse to single column at `< 768px`.

### Exit criteria

- A logged-out visitor lands on `/` and sees the full page; smooth scroll works for the 4 anchor links.
- Primary CTAs route to `/sign-up`; secondary "Sign in" routes to `/sign-in`. Signed-in visitors at `/` redirect to `/dashboard`.
- Voice Engine client picker swaps content in-place; FAQ accordion behaves as single-open.
- `next build` clean; landing is dynamically rendered (Clerk middleware runs on every request) but cacheable on the CDN edge.

## 3.2 YouTube import

- [ ] YouTube Transcript API integration; extract transcript from a URL → episode

## 3.3 Scheduling

- [ ] **Schedule screen** (`/schedule`): calendar of queued posts
- [ ] Typefully/Buffer integration for scheduling threads/posts
- [ ] Status sync (`SCHEDULED → PUBLISHED`)

## 3.4 Affiliate program

- [ ] Integrate Rewardful or Tolt (Stripe-native); referral links + tracking
- [ ] Affiliate signup/info page

## 3.5 Network tier & priority

- [ ] Add NETWORK ($499) Stripe product + limits (25 shows, unlimited seats, batch + priority)
- [ ] Priority generation queue (Inngest concurrency keyed by plan)

## 3.6 ROOT user & platform admin backend

> **Premise:** Repodcast needs a platform-level operator role that sits **above** all agencies — for support, billing reconciliation, incident response, abuse handling, fraud review, and revenue visibility. A ROOT user is **not** a `Member` of any agency; they're a Repodcast employee with global read + scoped-write access across every tenant. This section also lands the **system-wide analytics backend** every founder/operator needs to run the business — MRR, churn, generation volume, cost-to-serve, queue health, error rates, top accounts, top consumers, retention cohorts.
>
> **Why this lands in Phase 3 (and not later):** every metric below answers a question we'd otherwise be answering by ad-hoc Prisma queries against production. Going live without it is operating blind. Per the user's ask: "we need a ROOT user to manage all agencies + detailed analytics backend of the whole system."
>
> **Strict scope boundary — what ROOT does NOT do:** ROOT does not bypass legal data-handling boundaries (we keep the same Privacy/Terms commitments), does not enter agency-to-client money flow (still no PCI scope), and does not silently mutate tenant data without an audit row. Every ROOT mutation lands in `SystemAuditLog`. Reads are unrestricted; writes are bounded, audited, and reversible where possible.

### 3.6.1 Auth & access control

- [x] **`SystemAdminRole` enum** — `ROOT | OPERATOR | SUPPORT | ANALYST`.
  - `ROOT` — full mutate access across every tenant, including suspend/delete agency, force-cancel subscription, hard-delete content. There should be **2 ROOT users max** in normal operation (founder + designated incident commander).
  - `OPERATOR` — same read access as ROOT; can act on day-to-day support tickets (extend a subscription, re-fire a stuck Inngest function, refund-flag an invoice). Cannot delete agencies or invoke schema-touching ops.
  - `SUPPORT` — read everything; can only initiate **read-only impersonation** + write to a small surface (e.g. resend a welcome email, mark a support ticket resolved, regenerate a portal token for a customer who lost it).
  - `ANALYST` — read everything; **no write access at all**. For finance/BI sharing without giving them a footgun.
- [x] **`SystemAdmin` model** — landed in migration `20260630160000_system_admin`. Fields: `id`, `clerkUserId @unique`, `email`, `name?`, `role SystemAdminRole @default(SUPPORT)`, `mfaEnforced Boolean @default(true)`, `lastActiveAt?`, `deactivatedAt?` (soft-delete tombstone so audit FKs survive), `createdAt`, `updatedAt`. **No** FK to `Member`. Seeded via `npm run admin:bootstrap-root` which reads `ROOT_BOOTSTRAP_EMAIL` + `ROOT_BOOTSTRAP_CLERK_USER_ID` and upserts an idempotent ROOT row (re-running clears `deactivatedAt`).
- [x] **Clerk-side gate** — `server/auth/system.ts#getSystemAdminContext()` resolves the active Clerk user against the `SystemAdmin` table (`deactivatedAt: null` filter). Returns `SystemAdminContext` shape mirroring the tenant `AuthContext`. A signed-in user can hold both a `SystemAdmin` row and `Member` rows; the contexts are looked up independently.
- [~] **MFA enforcement** — schema field `SystemAdmin.mfaEnforced` is in place (default `true`), but the runtime check is currently a no-op. The original code consulted `sessionClaims.factors`, which is NOT a default Clerk JWT claim — exposing it requires a custom JWT template every install must configure, OR a per-request `clerkClient.users.getUser(userId)` round-trip to read `twoFactorEnabled`. The intended redirect target was also a dead end (a signed-in user hitting `/sign-in` gets bounced to `/` by Clerk, creating a loop). Wiring this properly lands alongside write-mode impersonation (3.6.6) where MFA actually matters; the schema field is reserved so the future check can flip on without a migration.
- [ ] **IP allowlist (optional)** — `ROOT_IP_ALLOWLIST` env (comma-separated CIDR). When set, `/root/*` middleware rejects requests off-list with 404 (not 403 — don't leak the surface's existence). Off by default for solo-founder dev; documented as the hardening step before scaling the team.
- [x] **Route gate** — `app/(root)/layout.tsx` calls `requireSystemAdminContext()`. Unauthenticated → `redirect("/sign-in?redirect_url=/root")`. Authenticated without a `SystemAdmin` row → `notFound()` (renders the global 404, not a 403, so the surface stays invisible to probing). Best-effort `lastActiveAt` bump runs after the gate passes.
- [x] **No tenant `getAuthContext()` fallthrough** — the `/root` layout never calls `getAuthContext()`; the read-side helpers live under `server/db/system/*` and take a `SystemAdminContext`, not a `TenantContext`. ROOT correctness will live in its own test suite (`tests/server/auth/system-role-guard.test.ts` + `tests/server/db/system-audit.test.ts` cover step-1 surface area; 11 new tests, 301 total).

### 3.6.2 Audit logging (mandatory for every ROOT write)

- [x] **`SystemAuditLog` model** — landed in the same migration. Fields + indices match the spec (`bySystemAdminId, createdAt DESC`, `targetAgencyId, createdAt DESC`, `action, createdAt DESC`, `createdAt DESC`). FK to `SystemAdmin` is `ON DELETE RESTRICT` as a defense-in-depth backstop against an accidental hard-delete that would orphan audit history; soft-delete via `deactivatedAt` is the only supported teardown.
- [x] **Action key registry** — `server/db/system/audit-actions.ts` exports a `SYSTEM_AUDIT_ACTIONS` const map (22 keys covering agency lifecycle, subscription/invoice, member, admin, config, support, abuse, impersonation). The `action` column stays free-form `String` so adding a new action doesn't need a migration; the TS layer enforces consistency via `SystemAuditAction` union.
- [x] **`withSystemAudit(ctx, input, fn)`** — `server/db/system/audit.ts`. Wraps the callback in a single `prisma.$transaction`; passes the TX client + a `MutableAuditSnapshot` helper (`setBefore`/`setAfter`/`setNote`) so the action can refine the snapshot based on its own write result. Snapshots are deep-cloned through `JSON.parse(JSON.stringify(...))` so a later mutation of the source object can't poison the audit row. The audit row insert runs INSIDE the same TX as the mutation — either both land or both roll back. 6 unit tests cover the happy path, mutation-throws → audit-never-written, audit-throws → wrapper-rejects, default-null snapshot path, and deep-clone semantics.
- [ ] **`/root/audit` log viewer** — paginated, filterable by admin, action, target agency, date range. Read-only. Always-on, no soft-delete affordance even for the ROOT user themself (audit log is constitutional, not editable).
- [ ] **Optional: pipe `SystemAuditLog` writes to Sentry as `audit.event` breadcrumbs** so an external SIEM can ingest them too.

### 3.6.3 Route layout (`/root/*`)

> Distinct from `/admin` because that path already reads as "Clerk admin" in this codebase. `/root` is unambiguous.

- [ ] `/root` — landing dashboard (overview).
- [ ] `/root/agencies` — global agency list.
- [ ] `/root/agencies/[id]` — single agency drilldown.
- [ ] `/root/users` — cross-agency user/member search.
- [ ] `/root/finance` — Stripe-side revenue, refunds, disputes, MRR cohorts.
- [ ] `/root/operations` — cost-to-serve, AI spend, R2 storage, generation queue health.
- [ ] `/root/quality` — flagged outputs, support requests, abuse reports.
- [ ] `/root/config` — feature flags, plan-limit overrides, prompt rollouts.
- [ ] `/root/audit` — audit-log viewer.
- [ ] `/root/system` — health checks (DB, Inngest, Clerk, Stripe, R2, Resend, Sentry, PostHog reachability + latency).
- [ ] **Layout chrome:** separate sidebar from the tenant dashboard. Red-tinted top bar that reads "ROOT MODE" so an operator never forgets they're in the platform admin (preventing the classic "ran a dev query on prod" confusion).

### 3.6.4 Platform overview dashboard (`/root`)

> **Status:** initial slice landed in ship-order step 3. `server/db/system/overview.ts#getRootOverview` parallelises ~13 live aggregate queries into one payload powering the dashboard; the snapshot-backed swap lands as step 4. **Live now:** MRR / ARR / net new MRR (MTD) / paying-vs-non-paying split / gross margin (MRR − AI spend) / total agencies + members / episodes-MTD + outputs-MTD / AI spend MTD / in-flight episodes / pipeline failures 24h / failed-episodes lifetime / webhook deliveries 24h grouped by source / episodes-by-source horizontal bars / 12-week stacked-bar of current-version outputs by plan / recent platform-admin activity feed. **Marked "—" placeholders:** churn % (needs the finance dashboard's MoM movement, step 6), p95 generation latency (needs per-call duration tracking — TODO on the pipeline). MRR sums plan prices for agencies with a non-null `stripeSubscriptionId`; dev rows without a sub count as non-paying. 16 new tests pin the math (MRR pricing math + null cost-sum collapse + negative margin path + zero-fill pivots + 12-bucket Monday-UTC alignment + role gate); 332 tests total.

Single screen, KPI-dense, no scrolling for the must-see numbers.

- [ ] **Top row — money & growth**
  - MRR (sum of `Agency.plan` → monthly $ on active Stripe subs)
  - ARR (MRR × 12)
  - Net new MRR this month (signups + upgrades − cancellations − downgrades)
  - Logo churn % (agencies that cancelled in last 30d / total active at start of period)
  - Revenue churn % (cancelled-MRR / starting-MRR)
- [ ] **Second row — usage**
  - Total agencies (active + paused split)
  - Total members (across all agencies)
  - Episodes processed this month
  - Outputs generated this month
  - Total Anthropic spend MTD (sum `UsageLog.costCents`)
  - Anthropic gross margin (subscription revenue − Anthropic cost) — the **hero number** for unit economics
- [ ] **Third row — health**
  - Inngest function success rate (last 24h)
  - Pipeline failure count (last 24h) — clickable to filtered queue view
  - Webhook delivery success rate (Stripe + Clerk + Resend) — last 24h
  - Sentry error rate (per 1k requests)
  - p95 generation duration
- [ ] **Charts**
  - 90-day MRR line + cohort retention heatmap (Phase 3.6.7)
  - 12-week stacked bar of outputs generated by plan tier
  - Episodes-by-source pie (PASTE / UPLOAD / RSS / YOUTUBE) — tells us where to invest

### 3.6.5 Agency management (`/root/agencies`)

- [~] **Searchable list** — landed in step 2. Live filters: name search (debounced 250 ms), plan, status (active / suspended), `createdFrom` / `createdTo` (cross-anchored date pickers, end-of-day widening). Columns: agency + owner email, plan pill, members, episodes-MTD, outputs-MTD, cost-MTD (USD formatted), last-activity (relative), created (ISO date). 25/page pagination preserves filter params on prev/next. Per-row aggregates use bounded `groupBy` calls over the visible page only — swap to `AgencyUsageSnapshot` joins lands in step 4 of the ship order. Open for ANALYST / SUPPORT / OPERATOR / ROOT. Sortable columns + "no activity in N days" filter + CSV export still TODO.
- [ ] **CSV export** of the filtered list (same filter params as the URL).
- [~] **Agency drilldown `/root/agencies/[id]`** — Overview tab landed. Header shows name, plan, agency id, created date, owner contact, onboarding step, Stripe deep-link. Below the header: month-to-date KPI strip (episodes, outputs, AI spend, paid-invoice revenue in agency's preferred currency), lifetime totals strip (members, clients, shows, episodes, current outputs, paid invoices), and recent-platform-admin-activity feed (last 10 `SystemAuditLog` entries scoped via `targetAgencyId`). `<AgencyTabNav>` renders the other six tabs as "soon" disabled chips so the chrome is in place for steps 3–11.
  - Tabs: Overview / Members / Clients & Shows / Episodes / Billing / Usage / Audit
  - **Overview** — KPI strip + last-30d activity sparkline + last 10 audit entries scoped to this agency
  - **Members** — full Member list with role, last-active, "impersonate" button per row (gated to OPERATOR/ROOT, opens 3.6.6 read-only mode)
  - **Clients & Shows** — full client + show tree, counts, last-episode date per show
  - **Episodes** — full episode history, status, output count, generation cost
  - **Billing** — Stripe sub + invoice list with hosted PDF links, payment-method last-4, next-charge date
  - **Usage** — full `UsageLog` per-episode breakdown, model used, tokens in/out, cost, profit margin
  - **Audit** — `SystemAuditLog` filtered to `targetAgencyId == this`
- [ ] **ROOT actions per agency** (all wrapped in `withSystemAudit`):
  - **Suspend / Unsuspend** — `Agency.suspendedAt DateTime?` (new column). Suspended agencies bounce on dashboard with a "Your account is suspended — contact support" page. New schema migration. Existing read-only export still allowed (data preservation).
  - **Force-cancel subscription** — calls Stripe `subscription.cancel({ invoice_now: true, prorate: true })`, syncs back to `Agency.plan = STUDIO`. Confirm dialog required.
  - **Grant plan override** — bumps an agency to a plan above their paid tier without charging (comp account for partners, beta testers, support escalations). New `Agency.planOverride Plan?` column; `getAgencyPlan()` returns `planOverride ?? plan`. Audit row captures the comp justification.
  - **Refund last invoice** — does NOT process refund directly; opens Stripe dashboard to the invoice with a deep link, prefills a `SystemAuditLog` row with `action: "invoice.refund_request"` so the operator notes _why_ they refunded. Manual side: actual refund must happen in Stripe so the webhook path stays the single source of truth.
  - **Hard-delete agency (ROOT only, irreversible)** — confirmation modal requires typing the agency name. Triggers cascade through `onDelete: Cascade`. Pre-flight: lock all R2 objects scoped under `audio/<agencyId>/...` and `artwork/<agencyId>/...` into a 30-day quarantine prefix before delete so GDPR-style recovery is possible.

### 3.6.6 Impersonation (read-only by default)

- [x] **Read-only envelope** — `repodcast_impersonate` cookie (`{ systemAdminId, asMemberId, agencyId, mode: "read", startedAt }`) is HMAC-SHA256 signed via `IMPERSONATION_SIGNING_KEY` (≥ 32 bytes), `httpOnly` + `secure` + `sameSite: lax`, 60-minute `maxAge`. Format `<base64url(payload)>.<base64url(sig)>`, signature checked in constant time on every dashboard render. Tampered / expired / unsigned cookies decode to `null` (silently — same as no cookie).
- [x] **`getAuthContext()` swap** — when a valid envelope is present AND the SystemAdmin row still resolves, `agency` + `member` are swapped to the impersonated pair while `auth.user` still points at the SystemAdmin's Clerk profile (we never lie about who's actually clicking). Stale envelopes (admin deactivated mid-session, target member deleted, agencyId mismatch) fall through to the normal tenant lookup.
- [x] **Read-only enforcement** — chokepoint sits in `requireRole(ctx, ...)` (`server/auth/tenant.ts`): any role-gated write under `impersonation.mode === "read"` throws `ForbiddenError`. The dual `assertRole(ctx, ...)` (`server/auth/context.ts`) carries the same guard. `assertNotReadOnlyImpersonation(ctx)` exists as an explicit helper for actions that don't role-gate. Write-mode envelopes pass through the chokepoint untouched — they land with step 10.
- [x] **Banner** — `<ImpersonationBanner>` mounted in `(dashboard)/layout.tsx` whenever the resolved context carries an envelope. Bright orange in read mode, copy matches PLAN: `"VIEWING AS {name} ({email}) — agency {agencyName} — read-only — End impersonation →"`. The shape supports a red write-mode variant for step 10 with no extra wiring.
- [x] **Start / end actions** — colocated in `app/(root)/root/agencies/[id]/impersonate-actions.ts`. Start probes the signing key up front (no phantom audit row when the env is missing), gates to `SYSTEM_WRITE_ROLES`, verifies the target Member belongs to the named agency, writes `IMPERSONATE_START` via `withSystemAudit`, sets the cookie, redirects to `/dashboard`. End reads the live cookie, writes `IMPERSONATE_END`, clears the cookie, redirects back to the drilldown. Both capture IP + UA off the request headers for the audit row.
- [x] **Members panel** — `<AgencyMembersPanel>` renders on the agency Overview tab (the dedicated Members tab stays `soon` until a later slice), one row per Member sorted by role rank, "Impersonate" button hidden for SUPPORT/ANALYST viewers since the action would 403 anyway.
- [ ] **`mode: "write"` (ROOT only)** — for cases where the operator must make a change with the customer on the phone (e.g. re-name a show with a typo). Banner flips to red, mutations allowed but every action ALSO inserts a `SystemAuditLog` row with `action: "tenant.proxy_write"` so the change is double-attributed. Lands with ship-order step 10.

### 3.6.7 Financial dashboard (`/root/finance`)

- [ ] **MRR breakdown**
  - By plan (Studio / Agency / Network)
  - By cohort (signup month)
  - By currency (Phase 2 has `Agency.preferredCurrency`)
- [ ] **Movement waterfall** — for the chosen month: starting MRR + new + expansion (upgrades) − contraction (downgrades) − churn = ending MRR
- [ ] **Cohort retention heatmap** — N×M grid: rows are signup months, columns are months-since-signup, cells are "% of cohort still subscribed." Standard SaaS chart, but with `Agency.createdAt` + Stripe sub state as the source.
- [ ] **Invoices** — global table of every `Invoice` row across all agencies. Filter by status (PAID / OPEN / VOID / UNCOLLECTIBLE), agency, date range. Quick links to Stripe-hosted PDF and Stripe dashboard.
- [ ] **Disputes & failed payments** — pulled from Stripe `customer.subscription.{paused, deleted}` + `invoice.payment_failed` events (already handled in the existing webhook; surface them here).
- [ ] **CSV export** for finance/accounting hand-off (matches `/clients/[id]/statements/[id]/route.ts` shape patterns).
- [ ] **LTV / CAC scaffolding** — LTV estimate from average revenue × average lifespan (months); CAC slot is manual entry (`SystemConfig` row, see 3.6.11) since acquisition spend is off-platform. Renders LTV:CAC ratio with a 3× target line.

### 3.6.8 Operational analytics (`/root/operations`)

- [ ] **AI spend dashboard**
  - Total Anthropic spend today / MTD / lifetime
  - Spend by model (`UsageLog.model` groupBy — Claude version distribution)
  - Spend by platform (which output platforms are the most expensive to generate)
  - Spend by agency (top 20 by cost-to-serve)
  - Margin per agency (revenue − Anthropic cost) — flag agencies with negative margin
  - **Forecasted month-end spend** = MTD × (days-in-month / current-day)
- [ ] **Generation queue health**
  - Inngest function pass/fail/retry rates per function (`generate-episode`, `regenerate-output`, `transcribe-episode`, `import-rss-episode`, `refresh-voice-description`, `cleanup-orphan-audio`, `check-renewals`, `check-onboarding-nudges`)
  - p50 / p95 / p99 duration per function
  - Currently-in-flight count
  - Last 50 failures with `agencyId`, `episodeId`, error message, retry count, deep-link to Inngest dashboard
  - **Manual re-fire button** per failed run (ROOT + OPERATOR only)
- [ ] **R2 storage**
  - Total bytes stored, by prefix (`audio/` vs `artwork/` vs `statements/`)
  - Top 20 agencies by storage
  - Orphaned object count + last cleanup-cron run timestamp
- [ ] **Webhook health**
  - `WebhookDelivery` rolled up by `source` × day for last 30d
  - Recent failed dispatches (we don't currently log failures — add a `lastDispatchError String?` + `attempts Int @default(0)` to track retry exhaustion)
- [ ] **Email deliverability** (Resend)
  - Sent / delivered / bounced / complained counts per template (welcome / generation-complete / invite / renewal-reminder / onboarding-finish-setup / onboarding-first-client). Requires writing send results to a new `EmailDelivery` log table.
- [ ] **External API health** — small green/red status grid for each provider (`Anthropic`, `Deepgram`, `Podcast Index`, `Stripe`, `Clerk`, `R2`, `Resend`, `Sentry`, `PostHog`) with last successful round-trip timestamp. Sourced from a periodic Inngest ping cron.

### 3.6.9 Cross-agency user search (`/root/users`)

- [ ] Search by email / name / `clerkUserId`. Returns every `Member` row matching.
- [ ] Click → opens a side-panel with: full identity card, all agency memberships (joined dates, roles), Clerk last-sign-in, ROOT actions: resend welcome / reset password (via Clerk SDK) / open impersonation modal for any of their memberships.
- [ ] Useful for: support ticket "what agencies am I in?", abuse triage (track a bad actor across tenants), GDPR data-export requests.

### 3.6.10 Quality, abuse, and moderation (`/root/quality`)

- [ ] **Flagged outputs queue** — new `GeneratedOutput.flagReason String?` + `flaggedByMemberId String?` + `flaggedAt DateTime?` columns. Tenant members can flag (Phase 4 polish — out of scope for 3.6 ship). ROOT view lists flagged rows across all agencies with full context.
- [ ] **Abuse reports** — new `AbuseReport` table for inbound complaints (e.g. spam, copyright, brand impersonation). Fields: `id`, `reportedByEmail?` (external), `targetAgencyId?`, `targetMemberId?`, `targetOutputId?`, `category` (enum: `SPAM | COPYRIGHT | IMPERSONATION | HARASSMENT | OTHER`), `body`, `status` (`OPEN | IN_REVIEW | RESOLVED | DISMISSED`), `assignedToSystemAdminId?`, `resolution String?`, `createdAt`, `resolvedAt?`. Inbound channel: a public `/legal/report` form that posts here.
- [ ] **Support escalations queue** — surface customer-side support requests (when 3.6.13 adds a "request help" button in the dashboard). Triage by status, assigned operator, age.
- [ ] **Anti-fraud signals** — list of recently-created agencies with high spend / no payment / mismatched IP geolocation / disposable-email domains. Doesn't auto-suspend — just flags for review.

### 3.6.11 Platform configuration (`/root/config`)

- [ ] **`SystemConfig` model** — flat key/value table (`key @unique`, `value Json`, `updatedAt`, `updatedBySystemAdminId`). Stores: feature-flag overrides not in PostHog (e.g. `RSS_IMPORT_ENABLED`), per-plan limit overrides (rare — most plan limits are in `lib/plans.ts`), Anthropic model defaults, monthly cost-cap overrides per plan, CAC entry for LTV:CAC, marketing copy that can change without redeploy.
- [ ] **Per-agency plan-limit override** — sometimes a customer hits a limit and we want to comp them an extra 50 episodes without changing their plan. New `AgencyLimitOverride` table (`agencyId`, `resource`, `value Int`, `expiresAt?`, `note`, `bySystemAdminId`). `planCapacity()` consults this table and uses the override if present + unexpired. Audit-logged.
- [ ] **Prompt rollouts** — Phase 4-shaped feature: A/B test a new prompt against current production for a subset of agencies. Implemented as a `SystemConfig` row driving a deterministic hash check (`hashAgencyId(agencyId) % 100 < experiment.percent`). Outside the ROOT-shipping scope but documented here so the config surface is the right home for it.
- [ ] **Read-only "config history"** — `SystemConfig` writes hit `SystemAuditLog` with `action: "config.update"` + before/after JSON.

### 3.6.12 System health (`/root/system`)

- [ ] Extends the existing `/api/health` endpoint into a full reachability grid:
  - Postgres — `SELECT 1` + latency
  - Inngest — `GET /api/inngest` self-introspection
  - Clerk — `clerkClient.users.getCount()` smoke
  - Stripe — `stripe.balance.retrieve()` smoke
  - R2 — `headBucket()` smoke
  - Anthropic — last successful call timestamp (we don't ping just to ping; we use the most-recent `UsageLog.createdAt` as a proxy)
  - Resend — `domains.list()` smoke
  - Sentry — DSN ping
  - PostHog — `/decide` ping
- [ ] **Latency over time** — sparkline per provider for last 24h. Inngest cron writes a `HealthProbe` row every 5 min.
- [ ] **Recent error rate** — Sentry events ingested via Sentry's API (Phase 3.6 stretch — for v1 the cheap version is a deep-link to the Sentry project filtered to last 24h).

### 3.6.13 Customer-side support hook (out of scope for 3.6 but planned)

- [ ] Dashboard topbar gains a "Need help?" button → opens a modal that POSTs a `SupportRequest` row (new model: agency / member / category / body). Lands in `/root/quality` as a triage item.
- [ ] Confirmation email back to the requester via Resend.
- [ ] Why this lives in 3.6 docs: it's the inbound side of the ROOT support flow. The actual UI on the customer side is Phase 4 polish.

### 3.6.14 Schema additions summary

> All landing in one Phase 3.6 migration. Pre-flight: confirm none of these names collide with future Phase 2 work (none do — checked against existing 2.13 + 2.5 + 2.10 names).

- [ ] **Enums:** `SystemAdminRole`, `AbuseReportCategory`, `AbuseReportStatus`, `LimitOverrideResource`.
- [ ] **New models:** `SystemAdmin`, `SystemAuditLog`, `AgencyLimitOverride`, `SystemConfig`, `AbuseReport`, `SupportRequest`, `EmailDelivery`, `HealthProbe`.
- [ ] **Agency additions:** `suspendedAt DateTime?`, `planOverride Plan?`, `lastAdminNote String?` (optional CRM-style scratchpad written from the agency drilldown).
- [ ] **GeneratedOutput additions:** `flagReason String?`, `flaggedByMemberId String?`, `flaggedAt DateTime?` (for the moderation queue — kept slim, no full new table).
- [ ] **WebhookDelivery additions:** `lastDispatchError String?`, `attempts Int @default(0)` (so the operations dashboard can surface retry exhaustion).
- [ ] **No changes to existing tenant-scoped models** beyond the optional `suspendedAt` / `planOverride` / `flag*` fields above — keeping the multi-tenant repo helpers blissfully unaware of platform admin state.

### 3.6.15 Repo + server-action layer

- [ ] **`server/auth/system.ts`** — `getSystemAdminContext()`, `requireSystemAdminContext()`, `assertSystemRole(ctx, allowed)`, `assertNotReadOnlyImpersonation(ctx)`. Mirrors the tenant `auth/context.ts` API surface so the ergonomics are familiar.
- [ ] **`server/db/system/*.ts`** — repo helpers that **do not** take a `TenantContext`. One file per subject area: `agencies.ts`, `users.ts`, `audit.ts`, `finance.ts`, `operations.ts`, `quality.ts`, `config.ts`, `health.ts`. Each helper takes a `SystemAdminContext` for permission gating + audit attribution.
- [ ] **`withSystemAudit(ctx, action, before, fn)`** — transactional wrapper described in 3.6.2.
- [ ] **Server actions** — co-located under `app/(root)/.../actions.ts` mirroring the tenant pattern. Each action's first lines: `requireSystemAdminContext()` → `assertSystemRole(...)` → wrap the body in `withSystemAudit`.

### 3.6.16 Analytics implementation notes

- [ ] **Where the numbers come from**
  - MRR / churn / cohorts → derived from `Invoice` + `Agency.plan` + Stripe-side subscription state (cached in `Agency.stripeSubscriptionId`).
  - Usage / outputs / cost → existing `UsageLog`, `Episode`, `GeneratedOutput`.
  - Queue health → Inngest's introspection API (`@inngest/api`).
  - Webhooks → `WebhookDelivery` (existing).
  - Errors → Sentry's Events API + DSN.
  - Funnel events → PostHog's Insights API.
- [x] **Nightly rollup table** (`AgencyUsageSnapshot`) — landed in migration `20260630180000_agency_usage_snapshot`. Schema: `(agencyId, date)` composite unique + `plan` snapshot + `episodes` / `outputs` / `costCents` / `revenueCents` (PAID invoices). Two Inngest functions cover the surface: `nightly-usage-rollup` (`cron: 0 2 * * *`, 02:00 UTC) snapshots the prior UTC day for every agency, per-agency `step.run` so a partial-batch failure resumes cleanly; `backfill-usage-rollup` (`event: system/rollup.backfill.requested`) re-runs the same per-(day, agency) worker over an arbitrary `{fromIso, toIso}` half-open range so operators can fill historic data after the migration. Pure helpers `utcDayStart` / `priorUtcDay` / `utcDayRange` / `rollupAgencyForDay` live in `server/db/system/rollup.ts` and are unit-tested without an Inngest harness. 18 new tests (350 total) cover UTC midnight anchoring, half-open range semantics, idempotency (re-runs upsert), tenant-chain scoping, PAID-only revenue, and null-aggregate collapse to 0. **Migration needs `npm run db:migrate` against the live Neon DB to land the table.**
- [ ] **Caching strategy** — `/root` overview reads from rollup tables, not live `UsageLog`. Refresh interval ≤ 5 min via `revalidateTag("root-overview")` on rollup-cron completion.
- [ ] **Real-time gauges (queue depth, in-flight count)** — read directly from Inngest's API, NOT cached. p95 / p99 reads from the rollup.

### 3.6.17 Testing

- [ ] Unit tests for the ROOT auth gate matrix (4 roles × 6 example actions × write/read = 48 cases, table-driven).
- [ ] Tenant-isolation tests for `withSystemAudit` — assert the audit row + the mutation land in the same TX (rollback test: force the audit-write to fail mid-TX, confirm the mutation is rolled back).
- [ ] Smoke tests for `getSystemAdminContext()` — `clerkUserId` not in `SystemAdmin` → null; deactivated row → null; active row → resolved.
- [ ] Audit-immutability tests — `update` / `delete` on `SystemAuditLog` should be forbidden at the Prisma layer (`@@map` to a view, or runtime guard in `prisma.$extends`). Lock it down so even a future ROOT can't tamper.
- [ ] **Aggregate-math tests** for the MRR / cohort / margin functions — fixture an agency mix, assert the formulas. Same pattern as the existing `cost-to-serve` tests in Phase 2.13.5.

### 3.6.18 Roadmap shaping & ordering

- [~] **3.6 ship order** (intra-phase):
  1. [x] `SystemAdmin` + `SystemAuditLog` schema + auth gate + `/root` layout shell — landed. Migration `20260630160000_system_admin` adds enum + 2 tables + 4 indices. `server/auth/system.ts` exposes `getSystemAdminContext` / `requireSystemAdminContext` / `assertSystemRole` + role bundles (`SYSTEM_ROOT_ONLY`, `SYSTEM_WRITE_ROLES`, `SYSTEM_READ_ROLES`). `server/db/system/audit.ts` exposes `withSystemAudit`. Bootstrap CLI `npm run admin:bootstrap-root` mints the first ROOT row idempotently. Route group `app/(root)/` has the gated layout (red-tinted topbar + role pill + dedicated sidebar) and a `/root` overview placeholder showing live agency/member/episode/output counts + recent audit feed. 11 new tests, 301 total; typecheck + lint clean.
  2. [x] `/root/agencies` list + drilldown (Overview tab only) — landed. `server/db/system/agencies.ts` exposes `listAgenciesForRoot` (Zod-validated search / plan / status / date-range filters; per-page month-to-date aggregates derived via bounded `groupBy` calls), `getAgencyForRoot` (single-row drilldown with lifetime totals + month-to-date strip including paid-invoice revenue) and `listAgencyAuditEntries`. `/root/agencies` page uses URL-driven filters with 25/page pagination; `/root/agencies/[id]` opens the Overview tab with the other six tabs marked "soon" in `<AgencyTabNav>`. Read-open to every system role (ANALYST through ROOT) — writes for suspend / plan-override / hard-delete land with subsequent slices. 15 new tests, 316 total; typecheck + lint clean.
  3. [x] `/root` overview dashboard wired to live (uncached) queries — landed. `server/db/system/overview.ts#getRootOverview` parallelises ~13 aggregate queries (MRR via `Agency.groupBy(plan) WHERE stripeSubscriptionId != null`, episodes/outputs/AI spend MTD, pipeline failures 24h, webhook deliveries 24h, episodes-by-source pivot, 12-week outputs-by-plan in-memory bucketing). `/root/page.tsx` renders 3 KPI rows + 2 inline-SVG charts (`<EpisodesBySourceChart>` horizontal bars + `<OutputsByPlanChart>` stacked bar) + recent audit feed. KPI tones flip to amber when gross margin goes negative or pipeline failures > 0. Churn % and p95 latency marked "—" until the finance dashboard (step 6) and per-call duration tracking land. 16 new tests, 332 total; typecheck + lint clean.
  4. [x] `AgencyUsageSnapshot` rollup cron + swap dashboard to read snapshot — landed. Schema (see §3.6.16) + `nightly-usage-rollup` cron (02:00 UTC) + `backfill-usage-rollup` event-triggered companion. `getRootOverview` now uses the canonical OLAP pattern: snapshot `aggregate({ date: { gte: monthStart, lt: todayUtc } })` for closed-period MTD totals + a live tail (`episode.count` / `generatedOutput.count` / `usageLog.aggregate` filtered to `createdAt >= todayUtc`) for today. The 12-week chart switched to `agencyUsageSnapshot.findMany` and buckets the pre-aggregated rows by week + plan (snapshot row count is bounded by `agencies × 84 days`, vs. the prior unbounded `GeneratedOutput.findMany`). MRR + health metrics stay live (cheap + inherently 24h-windowed). 18 new tests, 350 total — covering the snapshot/live composition, the closed-period WHERE shape, the bucket merge across agencies, and the pure date helpers. **Transition note:** snapshots are empty on first deploy; fire `inngest.send({ name: "system/rollup.backfill.requested", data: { fromIso, toIso } })` to populate historic data or wait for the first nightly cron.
  5. [x] Impersonation (read-only mode) — landed. HMAC-signed `repodcast_impersonate` cookie + `getAuthContext` swap + `requireRole` chokepoint on read-only writes + orange `<ImpersonationBanner>` in `(dashboard)/layout.tsx` + start/end server actions wrapped in `withSystemAudit` + Members panel on the Overview tab. 15 new tests (365 total): cookie round-trip + tampering + expiry + key rotation + `requireRole` / `assertNotReadOnlyImpersonation` / `assertRole` chokepoints. Requires `IMPERSONATION_SIGNING_KEY` (≥ 32 bytes) in env; missing key fails closed (start action redirects with `impersonate_error=signing_key_missing` — no audit row).
  6. Financial dashboard.
  7. Operational analytics.
  8. Quality / moderation / abuse.
  9. Config + plan-limit overrides.
  10. Impersonation (write mode, ROOT only).
  11. Hard-delete agency + R2 quarantine.
- [ ] **What does NOT block public launch:** quality/moderation queue (3.6.10), config rollouts (3.6.11), write-mode impersonation (3.6.6). Everything above 3.6.10 _does_ block launch.

### Exit criteria

- A bootstrap script seeds a single `ROOT` user from `ROOT_BOOTSTRAP_EMAIL`. That user can sign in, land on `/root`, and see live MRR / agency count / generation volume.
- Every ROOT write produces a `SystemAuditLog` row in the same TX. Audit log is queryable and immutable.
- An OPERATOR can list all agencies, drill into one, and impersonate any member of that agency in read-only mode. The banner makes the impersonation visible at all times.
- ROOT can suspend / unsuspend an agency and grant a plan override; both flow through Stripe correctly + survive a webhook replay.
- The `/root` overview renders in < 500 ms p95 on production-scale data (rollup-backed).
- Finance dashboard reconciles MRR ± 1 % vs. Stripe's own MRR view.
- The system health page surfaces a red dot within 60 s of any provider going down (verified by killing the local Postgres connection in dev).

## 3.7 Customer-side analytics & monitoring (cross-cutting tenant features)

> Scoped to **tenant-facing** observability — what an agency OWNER sees about their own data. Platform-wide visibility for the Repodcast team lives in 3.6.

- [ ] Full PostHog funnel: register → first generation → approve → upgrade
- [ ] Sentry alerts on pipeline + webhook failures
- [ ] Per-agency cost/usage dashboard (already partially live via `/settings/billing` usage meters; this finishes the picture with monthly + 90-day trends)
- [ ] Feature flags (PostHog) for gradual rollouts

## 3.8 Launch assets

- [ ] Product Hunt assets, demo video, screenshots
- [ ] Outreach list tooling + email templates (agency GTM)

**Exit criteria for Phase 3:** Public launch-ready; acquisition + retention machinery instrumented; all three tiers live; admin visibility in place.

---

# Cross-cutting (run continuously, not separate phases)

## Testing

- [x] Vitest 4 installed; **63 unit tests** across 5 files: `requireRole` + error classes (6), tenant isolation across the new `Agency → Client → Show → Episode → Output` hierarchy including versioning + status-flow + transitions + voice-instructions save + homegrown invites (35), prompt builder (9), key-moment parser (8), voice-strength thresholds (5)
- [x] Prompt builder tests (selection strategy, cache markers, per-platform rule isolation, minimal-voice fallback) — 1.4
- [x] Key-moment parser tests (bare JSON, ` ```json ` fences, prose-wrapped output, malformed rows, whitespace trimming) — 1.5
- [x] Unit tests for plan-limit enforcement — `tests/server/billing/plan-limits.test.ts` (11 tests): `planCapacity` for each resource asserts the right Prisma table + tenant-anchored where clause (shows/members direct, episodes/generations with month-start `createdAt` cap and nested-tenant joins); `assertPlanCapacity` covers passes-below-cap, throws at-cap, throws over-cap (race-loser case), and message-shape carries plan + resource + count + "Upgrade" copy; `getAgencyPlan` covers happy + missing-row → ForbiddenError; `loadCapacityForUI` bundles into the `<PlanLimitBanner>` shape. 157 tests total.
- [ ] Integration tests against a real test database (separate Neon branch) — generation pipeline (mock Claude), Stripe webhook idempotency
- [ ] E2E (Playwright): sign-up → add client → generate → approve → upgrade
- [ ] Webhook signature tests for Stripe + Clerk

## Security & compliance

- [x] Multi-tenant scoping enforced at the repo layer with passing tests
- [x] Clerk webhook signature verification via svix
- [ ] Zod input validation in every server action + route handler (some repos export the schemas; routes don't exist yet)
- [ ] Rate-limit public + generation endpoints (e.g. Upstash Ratelimit or Vercel)
- [ ] Audit tenant scoping with a smoke test that hits every route as two different agencies and asserts no cross-leakage
- [ ] Stripe + Clerk webhook idempotency keys (idempotency-key on Stripe, dedup by `svix-id` for Clerk)
- [ ] Dependency + secret scanning in CI (GitHub Dependabot + a secret-scanner)
- [ ] No secrets in client-side bundles (only `NEXT_PUBLIC_*` exposed)

## Performance & reliability

- [x] DB indexes on FKs + hot composite indexes (Prisma schema)
- [ ] Pagination on every list view (`/episodes`, samples browser, voice samples list)
- [ ] Inngest retries/backoff + dead-letter handling for failed generations
- [ ] N+1 audit: enforce `select`/`include` discipline in every repo helper
- [ ] Caching: opt into `cacheComponents: true` once we have measurements showing PPR helps; pair with `'use cache'` + `cacheLife`

## Accessibility & UX polish

- [ ] Keyboard nav, focus states, ARIA on every interactive component
- [ ] Loading skeletons + optimistic UI + toasts for every async action
- [ ] Responsive layouts verified (desktop-first, usable on tablet; mobile not in MVP)

## DevOps & docs

- [ ] CI: typecheck + lint + test on every PR (GitHub Actions)
- [ ] Migration discipline: every PR that touches `schema.prisma` checks in a migration; CI runs `prisma migrate diff` to detect drift
- [ ] `docs/architecture.md` — high-level diagram + folder map
- [ ] `docs/prompt-system.md` — how to add a platform / iterate prompts
- [ ] `docs/runbook.md` — pipeline failures, webhook outages, Stripe disputes
- [ ] `docs/design-tokens.md` — full token reference (extracted from mockups)
- [ ] `docs/observability.md` — PostHog dashboards + Sentry projects + alert routes
- [ ] Backup/restore plan for Neon (Neon has automatic point-in-time recovery; document the RTO/RPO)

## Operations

- [ ] Cron job: nightly UsageLog rollup → `AgencyUsageSnapshot` for fast dashboard reads
- [ ] Cron job: orphaned R2 cleanup (24h+ without an Episode row)
- [ ] Cron job: churn detection (no generations in 30 days → flag for outreach)
- [x] Health-check endpoint `/api/health` — `app/api/health/route.ts` (GET, `force-dynamic`, Node runtime). Runs a `SELECT 1` DB round-trip with a latency timer (the only check that can flip the overall status to `degraded` + the HTTP code to 503) and reports config-presence for Clerk (`CLERK_SECRET_KEY`) + Inngest (`INNGEST_SIGNING_KEY` or `INNGEST_EVENT_KEY`). Missing keys downgrade to `not_configured`, not `fail` — local dev without those keys stays healthy. Always returns structured JSON: `{ status, checks: { db, clerk, inngest }, timestamp }`. Added to the middleware public matcher so uptime probes don't hit Clerk auth. Documented in `docs/observability.md` with the response shape + intended usage. Point Vercel + any external monitor at this endpoint.

---

# Risks & open decisions

- **`middleware.ts` deprecation** — Next 16 prints a warning; we can't switch to `proxy.ts` until Clerk publishes a Node-runtime variant. Track Clerk's changelog.
- **Cache Components (PPR)** — `cacheComponents: true` plus `'use cache'` would let us PPR the dashboard and rails. Defer until Phase 1 is functional and we have real measurements.
- **Voice validation gate** — originally Phase 0 hard gate; deferred to Phase 1.4 so it runs alongside the production prompt system. Must clear before Phase 1.5 (generation pipeline) ships.
- **OWNER role assignment** — resolved by 1.0: first member of an in-app-created agency is OWNER. Legacy Clerk-Org-first paths still need the explicit transfer-ownership flow from 2.4.
- **Activity log** — decided in 2.3: `OutputTransition` DB table with denormalized `agencyId` (queryable + auditable). PostHog still gets the event stream separately when 1.9 lands the typed event helpers.
- **Email-on-failure** — should we notify users when Inngest fails after retries? Probably yes; design with 1.12.

---

# Milestone summary

- [~] **Phase 0 complete** — 6 of 8 subsections done. Open: Prettier/Husky tooling, finish UI primitives, voice validation (parallel), Vercel deploy (manual), live DB migration (manual). All blockers are env-var / external-config, not code.
- [ ] **Phase 1 complete** — paid users generating outputs (MVP live)
- [ ] **Phase 2 complete** — voice moat + workflow + all inputs
- [ ] **Phase 3 complete** — public launch ready

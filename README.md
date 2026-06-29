# Repodcast

B2B SaaS for podcast production agencies: turn an episode transcript into 7 platform-ready outputs (X, LinkedIn, Instagram, TikTok, show notes, blog, newsletter) in the client's voice — under a minute.

Built on **Next.js 16** (App Router, Turbopack), **React 19.2**, **Tailwind CSS v4**, **Prisma 7 + Neon Postgres**, **Clerk** (auth + organizations), **Inngest** (background jobs), **Cloudflare R2** (storage), **PostHog** (analytics), **Sentry** (errors). See `PLAN.md` for the full build roadmap.

## Getting started

```bash
# 1. Install
npm install

# 2. Copy env and fill in values (see "Required environment" below)
cp .env.example .env.local

# 3. Generate Prisma client + apply migrations
npm run db:generate
npm run db:migrate -- --name init
npm run db:seed   # seeds the Northbeam Studio demo agency

# 4. Run the app
npm run dev

# (Optional, for background jobs)
npm run dev:inngest
```

Open [http://localhost:3000](http://localhost:3000). Without auth env vars set you'll see Clerk's middleware redirect-to-sign-in flow; once Clerk and the DB are wired the dashboard renders.

## Required environment

`.env.example` is the committed contract — copy it to `.env.local` and fill in. Variables grouped by phase:

| Group                         | Vars                                                                                               | When you need it                                           |
| ----------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| **Database** (Neon)           | `DATABASE_URL`, `DIRECT_URL`                                                                       | Always                                                     |
| **Auth** (Clerk)              | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SECRET`                    | Always (any UI page is gated)                              |
| **AI** (Anthropic / Deepgram) | `ANTHROPIC_API_KEY`, `DEEPGRAM_API_KEY`                                                            | Phase 1.4+ generation, 2.7 transcription                   |
| **Billing** (Stripe)          | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_*_PRICE_ID`                      | Phase 1.10                                                 |
| **Storage** (R2)              | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`                           | Phase 1.3 client artwork, 2.7 audio uploads                |
| **Email** (Resend)            | `RESEND_API_KEY`                                                                                   | Phase 1.12                                                 |
| **Analytics** (PostHog)       | `NEXT_PUBLIC_POSTHOG_KEY` (+ optional `NEXT_PUBLIC_POSTHOG_HOST`)                                  | Phase 0.7 onward                                           |
| **Errors** (Sentry)           | `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` (+ `SENTRY_ORG`/`SENTRY_PROJECT`/`SENTRY_AUTH_TOKEN` in CI) | Phase 0.7 onward                                           |
| **Jobs** (Inngest)            | `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`                                                         | Phase 1.5 production; local dev uses `npm run dev:inngest` |
| **Imports**                   | `PODCAST_INDEX_KEY`/`PODCAST_INDEX_SECRET`                                                         | Phase 2.8 RSS import                                       |

Each integration is **lazy-initialized** — if its env vars aren't set the related code path skips silently, so `next build` succeeds on a fresh clone without any keys.

## Project structure

```
app/
  (dashboard)/        # protected route group: dashboard, clients, episodes, voice
  sign-in/, sign-up/  # Clerk catch-all routes
  api/
    webhooks/clerk/   # Clerk → DB sync
    inngest/          # job runner registration
components/           # UI primitives + page sections
lib/sample-data/      # Mock data — being replaced with server/db queries
inngest/              # Job client + functions
prisma/               # schema.prisma + migrations + seed
server/
  auth/context.ts     # getAuthContext() / requireAuthContext()
  db/                 # Prisma singleton + repository helpers
  storage/r2.ts       # Cloudflare R2 client
```

## Deploying to Vercel

1. Push the repo to GitHub and import it in Vercel.
2. In the project's **Settings → Environment Variables**, paste every key listed under "Required environment" above. The `NEXT_PUBLIC_*` keys must be added so they ship to the browser bundle.
3. Configure the integrations after the first deploy:
   - **Clerk dashboard** → add a webhook endpoint pointing at `https://<your-domain>/api/webhooks/clerk`. Subscribe to `organization.*`, `organizationMembership.*`, `user.updated`, `user.deleted`. Paste the signing secret into `CLERK_WEBHOOK_SECRET`.
   - **Stripe dashboard** → add a webhook for `https://<your-domain>/api/webhooks/stripe` (lands in Phase 1.10).
   - **Inngest** → connect the app to Inngest and point at `https://<your-domain>/api/inngest`.
   - **Sentry** → in CI, add `SENTRY_AUTH_TOKEN` for source-map uploads.
4. Re-deploy. Vercel will run `prisma generate` automatically because `@prisma/client` is in `dependencies`.

## Scripts

```bash
npm run dev               # next dev (Turbopack)
npm run build             # next build
npm run start             # production server
npm run lint              # eslint
npm run db:generate       # regenerate Prisma client
npm run db:migrate        # prisma migrate dev
npm run db:migrate:deploy # prisma migrate deploy (CI/prod)
npm run db:push           # prisma db push (prototype-only)
npm run db:seed           # seed the demo agency
npm run db:studio         # Prisma Studio
npm run dev:inngest       # local Inngest dev server
```

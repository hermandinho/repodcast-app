/**
 * Typed PostHog event registry — single source of truth for event names
 * AND their payload shapes. Both the client wrapper (`track-client.ts`) and
 * the server wrapper (`server/analytics/track.ts`) consume this so the
 * compiler refuses any typo or payload drift between call sites.
 *
 * Adding an event: extend `EventMap`. TypeScript will then require every
 * caller to pass a payload that matches.
 */

import type { Plan, Platform, SupportTicketCategory } from "@prisma/client";

export type EventMap = {
  /**
   * Top-of-funnel pageview events. Fired client-side from tiny
   * one-shot trackers embedded in the landing / pricing / sign-up pages.
   *
   * These are separate from PostHog's autocaptured `$pageview` (which
   * fires on EVERY route change) because we care about them
   * specifically as funnel steps; putting them under distinct names
   * keeps the PostHog funnel query readable and stops false positives
   * from tab-hopping.
   *
   * `funnelPath` distinguishes the entry point when the same event can
   * fire from multiple surfaces (e.g. `pricing_viewed` from `/pricing`
   * vs from the landing embedded pricing section).
   */
  landing_hero_viewed: {
    funnelPath: string;
  };
  pricing_viewed: {
    funnelPath: string;
  };
  signup_started: {
    /** Where the visitor came from before landing on /sign-up — helps
     *  distinguish direct sign-up clicks from pricing-page conversions. */
    funnelPath: string;
  };

  /**
   * Onboarding funnel — fired in order:
   * onboarding_started → agency_created → onboarding_step_completed (step=N)
   * → first_client_added → first_episode_generated
   *
   * `first_*` events are gated server-side (count check before fire) so they
   * land exactly once per agency, not once per create.
   */
  onboarding_started: {
    /** The default-suggested name the user is shown (helps measure rename rate). */
    suggestedAgencyName: string;
  };
  /**
   * Per-step wizard completion. Fires from each onboarding
   * server action right before the redirect. `step` is 1-indexed
   * matching the visible step counter (1=workspace, 2=plan/checkout,
   * 3=first-client).
   */
  onboarding_step_completed: {
    agencyId: string;
    step: 1 | 2 | 3;
    stepName: "workspace" | "plan" | "first_client";
  };
  agency_created: {
    agencyId: string;
    plan: Plan;
  };
  first_client_added: {
    agencyId: string;
    clientId: string;
  };
  first_episode_generated: {
    agencyId: string;
    episodeId: string;
  };

  /**
   * Fired server-side from the Inngest orchestrator after a single
   * platform's output is persisted. One event per platform per episode.
   * `durationMs` is wall-clock from the `episode/generate.requested` event
   * to persist, so it includes the key-moment extraction + the slowest
   * platform's response (not platform-precise — that needs per-call timing
   * inside step.run, deferred until we benchmark Claude latency variance).
   */
  generation_completed: {
    episodeId: string;
    platform: Platform;
    /** Token output count — proxy for response length until we
     *  ship a real heuristic-or-judge quality score. */
    outputTokens: number;
    durationMs: number;
  };

  /**
   * Fired client-side from `OutputsView` after `approveOutputAction` returns
   * ok. `edited` is the read-only signal we surface on the dashboard hero
   * KPI — `editDistance > 0` means the user touched the model's draft.
   *
   * `showId`, `editRatio`, and `postReady` power the "% posted unedited"
   * north-star at the product level — PostHog can now compute per-show
   * post-ready rate directly, matching what
   * `server/ai/voice-progress.ts` renders in-app. `showId` is `null`
   * when the approval routed through the client portal (portal approves
   * don't hit the tenant-side approve action's showId lookup) and in
   * sample-data / no-op paths.
   */
  output_approved: {
    outputId: string;
    /** UI platform key (e.g. "x", "li") — what the dashboard cuts by. */
    platform: string;
    edited: boolean;
    editDistance: number;
    showId: string | null;
    /** `editDistance / max(contentLength, 1)`, clamped to [0, 1]. */
    editRatio: number;
    /** True when `editRatio <= POST_READY_MAX_RATIO` (0.10). */
    postReady: boolean;
  };

  /**
   * Fired client-side from `OutputsView` after `updateOutputContentAction`
   * returns ok. `delta` is the Levenshtein distance of *this single save*;
   * `totalEditDistance` is the cumulative running sum on the row.
   */
  output_edited: {
    outputId: string;
    platform: string;
    delta: number;
    totalEditDistance: number;
  };

  /**
   * Upgrade funnel. Two events:
   *   - `upgrade_started` fires server-side from
   *     `createCheckoutSessionAction` right before we return the hosted-
   *     checkout URL. `fromPlan` is the current plan on the agency,
   *     `toPlan` is what the user picked. `cadence` distinguishes monthly
   *     vs annual upgrades — different acquisition/retention profiles.
   *   - `upgrade_completed` fires server-side from the Stripe webhook
   *     when `checkout.session.completed` lands with a subscription id.
   *     We can't rely on client redirects (users close the tab, Stripe
   *     retries webhooks, etc.), so the webhook is the authoritative
   *     completion signal.
   *
   * Together with `agency_created`, the funnel is:
   *   agency_created → upgrade_started → upgrade_completed
   * which the PostHog dashboard can chart directly.
   */
  upgrade_started: {
    agencyId: string;
    fromPlan: Plan;
    toPlan: Plan;
    cadence: "MONTHLY" | "ANNUAL";
    currency: string;
  };
  upgrade_completed: {
    agencyId: string;
    plan: Plan;
    cadence: "MONTHLY" | "ANNUAL";
    stripeSubscriptionId: string;
  };
  /**
   * In-place plan change on an existing subscription (no fresh Checkout).
   * Fires server-side from `changePlanAction` right after
   * `stripe.subscriptions.update` succeeds — so it's a completion signal,
   * unlike `upgrade_started` which precedes the redirect. `fromTrial: true`
   * means the sub was `trialing` when the switch happened (early conversion).
   */
  plan_switched: {
    agencyId: string;
    fromPlan: Plan;
    toPlan: Plan;
    cadence: "MONTHLY" | "ANNUAL";
    currency: string;
    fromTrial: boolean;
  };

  /**
   * Trial funnel (see MarketingStrategy.md §1). Fires server-
   * side from the Stripe webhook because the client redirect isn't
   * authoritative — Stripe's `subscription.created` / `subscription.updated`
   * / `subscription.deleted` are.
   *
   *   trial_started              — first `customer.subscription.created`
   *                                whose status is `trialing`.
   *   trial_converted            — the trialing → active transition on
   *                                first successful plan charge (day 8).
   *   trial_expired_no_conversion — trial ended, payment failed after
   *                                Stripe's Smart Retries. `subscription.
   *                                deleted` with `cancellation_details.
   *                                reason !== "cancellation_requested"`.
   *   trial_canceled_early       — user canceled during the trial window.
   *                                `subscription.deleted` with reason
   *                                `cancellation_requested` while the
   *                                agency was still ACTIVE.
   */
  trial_started: {
    agencyId: string;
    plan: Plan;
    cadence: "MONTHLY" | "ANNUAL";
    stripeSubscriptionId: string;
    trialEndsAt?: string;
  };
  trial_converted: {
    agencyId: string;
    plan: Plan;
    cadence: "MONTHLY" | "ANNUAL";
    stripeSubscriptionId: string;
  };
  trial_expired_no_conversion: {
    agencyId: string;
    stripeSubscriptionId: string;
  };
  trial_canceled_early: {
    agencyId: string;
    stripeSubscriptionId: string;
  };

  /**
   * Self-service workspace deletion. Fires from `deleteWorkspaceAction`
   * immediately BEFORE the agency row is dropped — otherwise the event
   * loses its agency group and dashboards can't attribute the churn.
   * Gated to agencies with no active Stripe sub (the action refuses
   * otherwise), so this is a clean churn signal, not a mid-billing tear-down.
   */
  workspace_deleted: {
    agencyId: string;
    plan: Plan;
  };

  /**
   * First-time milestone events. Each fires exactly once per
   * agency, gated by a count check on the underlying resource (or a
   * `MemberAchievement` row for `first_launch_kit_completed`, see
   * Q2.md §"Weeks 17–19"). Read by the ROOT funnel view and used to
   * measure activation depth beyond bare signup.
   *
   * Fire order in a well-activated agency:
   *   agency_created → first_output_approved → first_clip_generated
   *   → first_launch_kit_completed → trial_converted
   */
  first_output_approved: {
    agencyId: string;
    outputId: string;
  };
  first_clip_generated: {
    agencyId: string;
    episodeId: string;
    clipId: string;
  };
  /**
   * Reward moment. Fires the first time an agency has ≥1 output
   * approved AND ≥1 clip rendered AND ≥1 artwork rendered AND ≥1
   * audiogram rendered on the same episode. See Q2.md §"Weeks 17–19"
   * for the UI reward that stacks alongside.
   */
  first_launch_kit_completed: {
    agencyId: string;
    episodeId: string;
  };

  /**
   * Public `/contact` support form submission. Fires server-side from
   * `submitSupportTicketAction` after the DB write succeeds, so a
   * spam/Turnstile reject never lands in the funnel. `fromSignedInUser`
   * distinguishes tenant-side "I need help" from a cold marketing
   * inbound; `agencyId` is set only in the signed-in case.
   */
  support_ticket_submitted: {
    ticketId: string;
    refCode: string;
    category: SupportTicketCategory;
    fromSignedInUser: boolean;
  };
};

export type EventName = keyof EventMap;
export type EventPayload<E extends EventName> = EventMap[E];

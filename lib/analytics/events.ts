/**
 * Typed PostHog event registry — single source of truth for event names
 * AND their payload shapes. Both the client wrapper (`track-client.ts`) and
 * the server wrapper (`server/analytics/track.ts`) consume this so the
 * compiler refuses any typo or payload drift between call sites.
 *
 * Adding an event: extend `EventMap`. TypeScript will then require every
 * caller to pass a payload that matches.
 */

import type { Plan, Platform } from "@prisma/client";

export type EventMap = {
  /**
   * Onboarding funnel — fired in order:
   * onboarding_started → agency_created → first_client_added → first_episode_generated
   *
   * `first_*` events are gated server-side (count check before fire) so they
   * land exactly once per agency, not once per create.
   */
  onboarding_started: {
    /** The default-suggested name the user is shown (helps measure rename rate). */
    suggestedAgencyName: string;
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
    /** Token output count — proxy for response length until Phase 1.9
     *  ships a real heuristic-or-judge quality score. */
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
   * Phase 3.7 — upgrade funnel. Two events:
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
   * Phase 3.9 — trial funnel (see MarketingStrategy.md §1). Fires server-
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
};

export type EventName = keyof EventMap;
export type EventPayload<E extends EventName> = EventMap[E];

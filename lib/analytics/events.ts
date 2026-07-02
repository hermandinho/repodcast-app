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
   */
  output_approved: {
    outputId: string;
    /** UI platform key (e.g. "x", "li") — what the dashboard cuts by. */
    platform: string;
    edited: boolean;
    editDistance: number;
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
};

export type EventName = keyof EventMap;
export type EventPayload<E extends EventName> = EventMap[E];

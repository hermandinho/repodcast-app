import { Plan } from "@/lib/enums";
import { PLAN_DISPLAY } from "@/lib/plans";

/**
 * Client-visible catalog of plan-gated features. Pairs the server-side
 * `assertMinPlan` gates in `server/db/*` with the display copy that
 * `<FeatureUpgradePrompt>` renders on-page. Keeping both sides in one map
 * stops the UI from drifting from the guard — if you add a new gate,
 * add it here and every upsell surface picks up the new title,
 * description, and minimum plan automatically.
 *
 * The featured `minPlan` values MUST match the corresponding
 * `assertMinPlan(plan, X)` call. Tests in `tests/lib/plan-features.test.ts`
 * pin this down.
 */
export type PlanFeatureKey =
  | "whiteLabel"
  | "customAccent"
  | "clientPortal"
  | "clientWorkflow"
  | "batchGeneration"
  | "priorityQueue";

export type PlanFeatureConfig = {
  key: PlanFeatureKey;
  /** Short title — becomes the card heading (e.g. "White-label branding"). */
  title: string;
  /** One-line description of what unlocks when the plan is high enough. */
  description: string;
  /** Bulleted list of the value the feature provides on-plan. */
  highlights: readonly string[];
  /** Minimum plan tier required to use this feature. */
  minPlan: Plan;
};

export const PLAN_FEATURES: Record<PlanFeatureKey, PlanFeatureConfig> = {
  whiteLabel: {
    key: "whiteLabel",
    title: "White-label branding",
    description:
      "Show your studio's logo on the client portal and branded exports — no Repodcast marks on the surfaces your clients see.",
    highlights: [
      "Upload your studio logo",
      "Branded client-portal header",
      "Branded PDF & video exports",
    ],
    minPlan: Plan.AGENCY,
  },
  customAccent: {
    key: "customAccent",
    title: "Custom brand accent",
    description:
      "Set your studio's accent color across every client-facing surface — buttons, highlights, and portal chrome.",
    highlights: [
      "Match the portal to your brand palette",
      "Applied to CTAs and highlights",
      "Live-previews across every client surface",
    ],
    minPlan: Plan.NETWORK,
  },
  clientPortal: {
    key: "clientPortal",
    title: "Client portal",
    description:
      "Share tokenized read-only URLs so clients can review approved deliverables without a login.",
    highlights: [
      "Tokenized share links",
      "Password-protected access",
      "Branded portal header + exports",
    ],
    minPlan: Plan.AGENCY,
  },
  clientWorkflow: {
    key: "clientWorkflow",
    title: "Client-approval workflow",
    description:
      "Route approvals through the client portal and email the recipients you configure when reviews land.",
    highlights: [
      "Client-side validation mode",
      "Per-client notification recipients",
      "Approve / request-changes from the portal",
    ],
    minPlan: Plan.AGENCY,
  },
  batchGeneration: {
    key: "batchGeneration",
    title: "Batch generation",
    description: "Regenerate every episode's outputs across an entire show in a single click.",
    highlights: ["Show-wide regeneration", "Higher parallelism", "One-click retry of failed runs"],
    minPlan: Plan.AGENCY,
  },
  priorityQueue: {
    key: "priorityQueue",
    title: "Priority queue",
    description:
      "Jump the shared queue — your generations run ahead of other agencies during peak load.",
    highlights: ["Reserved queue slots", "Lower average latency", "Peak-hour SLA"],
    minPlan: Plan.NETWORK,
  },
};

/**
 * Plan tier order. Duplicates `PLAN_RANK` in `server/billing/limits.ts`
 * so client components can decide whether to render the upsell without a
 * server round-trip. Keep in sync — the tests in
 * `tests/lib/plan-features.test.ts` guard against drift.
 */
const PLAN_RANK: Record<Plan, number> = {
  SOLO: 0,
  STUDIO: 1,
  AGENCY: 2,
  NETWORK: 3,
};

export function planIncludesFeature(plan: Plan, key: PlanFeatureKey): boolean {
  return PLAN_RANK[plan] >= PLAN_RANK[PLAN_FEATURES[key].minPlan];
}

export function featureFor(key: PlanFeatureKey): PlanFeatureConfig {
  return PLAN_FEATURES[key];
}

export function requiredPlanNameFor(key: PlanFeatureKey): string {
  return PLAN_DISPLAY[PLAN_FEATURES[key].minPlan].name;
}

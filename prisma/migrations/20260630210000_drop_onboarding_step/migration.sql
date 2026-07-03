-- Phase 3.x onboarding rebuild — drop the legacy wizard-step surface.
--
-- The new /pricing → /onboarding/{workspace,plan} flow gates on
-- `Agency.stripeSubscriptionId` instead of a wizard-step enum. Every code
-- path that read `Agency.onboardingStep` — the wizard component, the
-- resume-gate helpers, the drop-off nudge cron — was rewritten or removed
-- in the same commit.
--
-- Column comes off before the enum type so Postgres can drop the type
-- cleanly (a live column referencing the enum would block the DROP TYPE).

ALTER TABLE "Agency" DROP COLUMN "onboardingStep";

DROP TYPE "OnboardingStep";

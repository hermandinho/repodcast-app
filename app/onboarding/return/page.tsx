import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getOnboardingStateForUser } from "@/server/db/agencies";
import { isLiveDb } from "@/server/data/source";

export const dynamic = "force-dynamic";

/**
 * Stripe Checkout `success_url` lands here after a completed session.
 *
 * The subscription itself isn't created in Checkout on the Solo trial
 * path (mode:'payment') — it's created downstream by the
 * `checkout.session.completed` webhook. So this page polls until the
 * webhook lands the row, then redirects to /dashboard. Non-trial paths
 * (mode:'subscription') are usually done by the time the browser
 * arrives, so the first render redirects immediately in the common
 * case.
 *
 * Polling is done with a meta-refresh every 3s, plus an `attempt` query
 * parameter so we can escalate the message after ~15s of silence — that
 * usually means the webhook isn't being delivered (Stripe endpoint mis-
 * configured, `stripe listen` not running, or the tunnel URL doesn't
 * match). We surface actionable troubleshooting rather than a generic
 * spinner so the user (or dev, in test mode) can self-diagnose.
 */
export default async function OnboardingReturnPage({
  searchParams,
}: {
  searchParams: Promise<{ attempt?: string }>;
}) {
  if (!isLiveDb()) {
    redirect("/dashboard");
  }

  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const state = await getOnboardingStateForUser(userId);
  if (state.kind === "paying") redirect("/dashboard");
  if (state.kind === "no-membership") redirect("/onboarding/workspace");

  const sp = await searchParams;
  const attempt = Math.max(0, Math.min(20, Number(sp.attempt ?? "0") || 0));
  const nextAttempt = attempt + 1;

  // ~5 attempts × 3s = 15s. After that we've almost certainly missed a
  // webhook — surface a diagnostic + a manual retry hint so the user
  // isn't staring at a spinner forever.
  const isStalled = attempt >= 5;
  const isDeeplyStalled = attempt >= 10; // ~30s

  return (
    <>
      {/* Meta-refresh drives the poll. Each hop increments `attempt` so
          the page can escalate its messaging. Stop refreshing after 20
          attempts (~60s) — at that point the flow is broken and no
          amount of polling will fix it. */}
      {attempt < 20 && (
        <meta httpEquiv="refresh" content={`3;url=/onboarding/return?attempt=${nextAttempt}`} />
      )}
      <div
        className="flex flex-col items-center gap-4 text-center"
        style={{ fontFamily: "var(--font-revamp-sans)" }}
      >
        {!isStalled && (
          <>
            <div
              className="h-6 w-6 animate-spin rounded-full border-2 border-[#0a1e3c]/20 border-t-[#0a1e3c]"
              aria-hidden
            />
            <h1
              className="m-0"
              style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em", color: "#0a1e3c" }}
            >
              Finalising your subscription…
            </h1>
            <p style={{ maxWidth: 400, fontSize: 13, color: "#41506b" }}>
              Stripe is confirming the payment with us. This usually takes a couple of seconds.
            </p>
          </>
        )}

        {isStalled && !isDeeplyStalled && (
          <div
            style={{
              background: "#FBF1DE",
              border: "1px solid #E6D9B8",
              borderRadius: 12,
              padding: "18px 22px",
              maxWidth: 460,
              textAlign: "left",
              color: "#7A5410",
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 700, color: "#5C3F0A" }}>
              Taking longer than expected
            </div>
            <p style={{ fontSize: 13, marginTop: 6, lineHeight: 1.55 }}>
              Your payment was received but the webhook hasn&apos;t landed yet. This is usually a
              webhook config issue on the Stripe side — no charge is at risk.
            </p>
            <p style={{ fontSize: 13, marginTop: 6, lineHeight: 1.55 }}>
              <strong>If you&apos;re the developer:</strong> make sure your Stripe webhook endpoint
              includes{" "}
              <code style={{ fontFamily: "var(--font-revamp-mono)" }}>
                checkout.session.completed
              </code>{" "}
              in the event list — the new Solo trial flow creates the subscription in that handler.
            </p>
          </div>
        )}

        {isDeeplyStalled && (
          <div
            style={{
              background: "#FBE7E4",
              border: "1px solid #E4C5C5",
              borderRadius: 12,
              padding: "18px 22px",
              maxWidth: 460,
              textAlign: "left",
              color: "#8A2A1F",
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 700 }}>Something didn&apos;t connect</div>
            <p style={{ fontSize: 13, marginTop: 6, lineHeight: 1.55 }}>
              We waited 30 seconds and still don&apos;t see your subscription. Your card charge went
              through, but the app hasn&apos;t been told about it — check with support (or your dev
              server logs).
            </p>
            <p style={{ fontSize: 13, marginTop: 6, lineHeight: 1.55 }}>
              <strong>Dev checklist:</strong>
            </p>
            <ol style={{ fontSize: 13, marginTop: 4, paddingLeft: 20, lineHeight: 1.6 }}>
              <li>
                Stripe Dashboard → Developers → Webhooks → your endpoint → check that{" "}
                <code style={{ fontFamily: "var(--font-revamp-mono)" }}>
                  checkout.session.completed
                </code>{" "}
                is in the event list.
              </li>
              <li>
                Verify{" "}
                <code style={{ fontFamily: "var(--font-revamp-mono)" }}>STRIPE_WEBHOOK_SECRET</code>{" "}
                matches the endpoint&apos;s signing secret.
              </li>
              <li>
                Check dev server logs for{" "}
                <code style={{ fontFamily: "var(--font-revamp-mono)" }}>[stripe-webhook]</code>{" "}
                lines — the handler logs its progress and any errors.
              </li>
              <li>
                In Stripe Dashboard → your webhook endpoint → recent deliveries: check whether the{" "}
                <code style={{ fontFamily: "var(--font-revamp-mono)" }}>
                  checkout.session.completed
                </code>{" "}
                event was delivered (200) or errored.
              </li>
            </ol>
          </div>
        )}

        {(isStalled || isDeeplyStalled) && (
          <div className="flex flex-wrap items-center justify-center" style={{ gap: 12 }}>
            <Link
              href="/onboarding/return?attempt=0"
              className="no-underline"
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "#0a1e3c",
                border: "1px solid #d4dbe7",
                borderRadius: 8,
                padding: "8px 16px",
                background: "#fff",
              }}
            >
              Check again
            </Link>
            <Link
              href="/onboarding/plan"
              className="no-underline"
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "#41506b",
              }}
            >
              Back to plans
            </Link>
          </div>
        )}
      </div>
    </>
  );
}

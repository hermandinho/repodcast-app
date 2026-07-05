import Link from "next/link";
import { Plan } from "@prisma/client";
import { PLAN_DISPLAY, PLAN_ORDER, planLimitsFor, priceFor } from "@/lib/plans";
import { asSupportedCurrency, DEFAULT_CURRENCY, formatPlanPrice } from "@/lib/currencies";
import { planCapacity } from "@/server/billing/limits";
import { isLiveDb } from "@/server/data/source";
import { resolveTenantContext } from "@/server/data/tenant";
import { prisma } from "@/server/db/client";
import { BillingActions } from "@/components/settings/billing-actions";
import { PlanCTA } from "@/components/settings/plan-cta";
import { SubscriptionStatusCard } from "@/components/settings/subscription-status-card";

// Module-level helper — extracted so `Date.now()` isn't called inline
// during render (react-hooks/purity).
function daysUntil(target: Date): number {
  const ms = target.getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

// ============================================================
// Revamp visual tokens (see `ref/UI/Revamp/` 1b + user's brand:
// primary accent stays at `--color-accent = #3A5BA0`, NOT the ref's blue)
// ============================================================
const INK = "#0a1e3c";
const MUTED = "#41506b";
const LIGHT_MUTED = "#8a97ad";
const DARK_TEXT_MUTED = "#a9b8d4";
const DARK_TEXT_SUBTLE = "#5c6f92";
const CARD_BORDER = "#e4e9f1";
const ROW_BORDER = "#eef1f6";
const ACCENT = "#3A5BA0";
const ACCENT_SOFT = "#eef2fb";
const ACCENT_ON_DARK = "#8FAEE0";

export default async function BillingPage() {
  const tenant = await resolveTenantContext();

  const agency = isLiveDb()
    ? await prisma.agency
        .findUnique({
          where: { id: tenant.agencyId },
          select: {
            plan: true,
            stripeCustomerId: true,
            stripeSubscriptionId: true,
            subscriptionCancelAt: true,
            preferredCurrency: true,
            trialStatus: true,
            trialEndsAt: true,
          },
        })
        .catch(() => null)
    : null;

  const plan: Plan = agency?.plan ?? Plan.STUDIO;
  const hasSubscription = agency?.stripeSubscriptionId != null;
  const currency = asSupportedCurrency(agency?.preferredCurrency) ?? DEFAULT_CURRENCY;
  const trialStatus = agency?.trialStatus ?? "NONE";
  const trialEndsAt = agency?.trialEndsAt ?? null;
  const isTrialing = trialStatus === "ACTIVE" && trialEndsAt !== null;
  const daysLeft = isTrialing && trialEndsAt ? daysUntil(trialEndsAt) : 0;
  // Subscription status card modes:
  //   scheduled — still has a live sub but Stripe will end it on
  //   `subscriptionCancelAt`. Rendered with a Resume button.
  //   canceled — sub already gone, but the agency was billed at some
  //   point (`stripeCustomerId` set). Rendered with a resubscribe hint.
  //   Neither state renders for brand-new agencies (no customer, no sub).
  const subCancelAt = agency?.subscriptionCancelAt ?? null;
  const cancelMode: "scheduled" | "canceled" | null = hasSubscription
    ? subCancelAt
      ? "scheduled"
      : null
    : agency?.stripeCustomerId
      ? "canceled"
      : null;

  const live = isLiveDb();
  const [shows, members, episodes, generations, invoices] = live
    ? await Promise.all([
        planCapacity(tenant.agencyId, plan, "shows"),
        planCapacity(tenant.agencyId, plan, "members"),
        planCapacity(tenant.agencyId, plan, "episodes"),
        planCapacity(tenant.agencyId, plan, "generations"),
        prisma.invoice.findMany({
          where: { agencyId: tenant.agencyId },
          orderBy: { createdAt: "desc" },
          take: 12,
        }),
      ])
    : [
        { used: 3, limit: planLimitsFor(plan).shows },
        { used: 1, limit: planLimitsFor(plan).seats },
        { used: 0, limit: planLimitsFor(plan).episodesPerMonth },
        { used: 0, limit: planLimitsFor(plan).generationsPerMonth },
        [],
      ];

  const current = PLAN_DISPLAY[plan];

  const chargeDateLabel = trialEndsAt
    ? new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(trialEndsAt)
    : null;

  return (
    <div style={{ maxWidth: 980, fontFamily: "var(--font-revamp-sans)" }}>
      {/* Merged plan + trial + usage dark card */}
      <div
        style={{
          background: INK,
          color: "#ffffff",
          borderRadius: 14,
          padding: "26px 30px",
        }}
      >
        <div className="flex flex-wrap items-start justify-between" style={{ gap: 24 }}>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center" style={{ gap: 10 }}>
              <span
                style={{
                  fontFamily: "var(--font-revamp-mono)",
                  fontSize: 10.5,
                  letterSpacing: "0.12em",
                  color: ACCENT_ON_DARK,
                  fontWeight: 600,
                }}
              >
                CURRENT PLAN
              </span>
              {isTrialing ? (
                <span
                  style={{
                    fontFamily: "var(--font-revamp-mono)",
                    fontSize: 11,
                    fontWeight: 700,
                    background: "rgba(143,174,224,0.18)",
                    color: ACCENT_ON_DARK,
                    padding: "3px 10px",
                    borderRadius: 99,
                    letterSpacing: "0.04em",
                  }}
                >
                  TRIAL · {daysLeft === 0 ? "ENDS TODAY" : `${daysLeft} DAYS LEFT`}
                </span>
              ) : null}
            </div>
            <div className="flex items-baseline" style={{ gap: 10, marginTop: 10 }}>
              <span
                style={{
                  fontSize: 30,
                  fontWeight: 800,
                  letterSpacing: "-0.02em",
                  color: "#fff",
                }}
              >
                {current.name}
              </span>
              <span
                style={{
                  fontFamily: "var(--font-revamp-mono)",
                  fontSize: 14,
                  color: DARK_TEXT_MUTED,
                }}
              >
                {formatPlanPrice(priceFor(plan, currency), currency)}/mo
              </span>
            </div>
            <p
              style={{
                fontSize: 13.5,
                color: DARK_TEXT_MUTED,
                marginTop: 6,
                maxWidth: 520,
                lineHeight: 1.55,
              }}
            >
              {isTrialing && chargeDateLabel ? (
                <>
                  Card on file is charged{" "}
                  <span style={{ color: "#fff", fontWeight: 600 }}>{chargeDateLabel}</span> unless
                  you cancel. You keep everything you&apos;ve generated either way.
                </>
              ) : (
                current.tagline
              )}
            </p>
          </div>
          <div className="flex flex-shrink-0 flex-col items-end" style={{ gap: 10 }}>
            <BillingActions
              currentPlan={plan}
              hasSubscription={hasSubscription}
              hasScheduledCancel={subCancelAt !== null}
              currency={currency}
            />
          </div>
        </div>

        {/* Usage meters embedded in the dark card */}
        <div
          className="grid grid-cols-2 md:grid-cols-4"
          style={{
            gap: 14,
            marginTop: 24,
            borderTop: "1px solid rgba(255,255,255,0.10)",
            paddingTop: 20,
          }}
        >
          <DarkMeter label="Shows" used={shows.used} limit={shows.limit} />
          <DarkMeter label="Seats" used={members.used} limit={members.limit} />
          <DarkMeter label="Episodes this month" used={episodes.used} limit={episodes.limit} />
          <DarkMeter label="Generations" used={generations.used} limit={generations.limit} />
        </div>
      </div>

      {/* Subscription lifecycle status. Priority (first match wins):
          1. Scheduled cancel on an active sub → SubscriptionStatusCard
             with the effective end-date and a Resume button.
          2. Fully canceled + (no trial history OR was CONVERTED) →
             SubscriptionStatusCard with the generic canceled message.
             This overrides TrialStatusCard for CONVERTED-then-canceled
             agencies where "you're a paying customer" is stale.
          3. Trial-specific resolution (CANCELED / EXPIRED) →
             TrialStatusCard — its message references the $1 activation
             and other trial details my card doesn't carry. */}
      {cancelMode === "scheduled" ? (
        <SubscriptionStatusCard mode="scheduled" cancelAt={subCancelAt} />
      ) : cancelMode === "canceled" && (trialStatus === "NONE" || trialStatus === "CONVERTED") ? (
        <SubscriptionStatusCard mode="canceled" cancelAt={null} />
      ) : trialStatus !== "NONE" && !isTrialing ? (
        <TrialStatusCard status={trialStatus} trialEndsAt={trialEndsAt} plan={plan} />
      ) : null}

      {/* Plans grid — 3 cards; current tier gets our-accent border + soft shadow */}
      <div style={{ marginTop: 28 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: INK }}>Plans</div>

        <div className="grid grid-cols-1 md:grid-cols-3" style={{ gap: 14, marginTop: 14 }}>
          {PLAN_ORDER.map((p) => (
            <PlanTile
              key={p}
              plan={p}
              currentPlan={plan}
              currency={currency}
              isCurrent={p === plan}
              hasSubscription={hasSubscription}
            />
          ))}
        </div>
      </div>

      {/* Invoices */}
      <LightCard style={{ marginTop: 16, padding: "24px 28px" }}>
        <div className="flex flex-wrap items-baseline justify-between" style={{ gap: 12 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: INK }}>Invoices</div>
          <span
            style={{
              fontFamily: "var(--font-revamp-mono)",
              fontSize: 11,
              color: LIGHT_MUTED,
            }}
          >
            SYNCED FROM STRIPE
          </span>
        </div>
        {invoices.length === 0 ? (
          <div
            className="flex flex-col items-center"
            style={{ gap: 10, padding: "36px 0 20px", textAlign: "center" }}
          >
            <div
              className="grid place-items-center"
              style={{
                width: 40,
                height: 40,
                borderRadius: 10,
                background: "#f6f8fc",
                border: `1px solid ${ROW_BORDER}`,
                color: LIGHT_MUTED,
                fontSize: 16,
              }}
            >
              ≡
            </div>
            <div style={{ fontSize: 13.5, color: MUTED, fontWeight: 600 }}>No invoices yet</div>
            <div style={{ fontSize: 12.5, color: LIGHT_MUTED, maxWidth: 340 }}>
              {isTrialing && chargeDateLabel
                ? `Your first invoice appears here after the trial converts on ${chargeDateLabel}.`
                : "Invoices land here after your first Stripe charge."}
            </div>
          </div>
        ) : (
          <div style={{ marginTop: 8 }}>
            {invoices.map((inv) => (
              <div
                key={inv.id}
                className="flex items-center"
                style={{
                  gap: 12,
                  padding: "13px 0",
                  borderTop: `1px solid ${ROW_BORDER}`,
                }}
              >
                <div className="min-w-0 flex-1">
                  <div style={{ fontSize: 13, fontWeight: 500, color: INK }}>
                    ${(inv.amountCents / 100).toFixed(2)} {inv.currency.toUpperCase()}
                  </div>
                  <div style={{ fontSize: 11.5, color: LIGHT_MUTED }}>
                    {new Intl.DateTimeFormat("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    }).format(inv.createdAt)}
                  </div>
                </div>
                <span
                  className="rounded-full"
                  style={{
                    background: "#f6f8fc",
                    color: MUTED,
                    padding: "3px 9px",
                    fontSize: 11,
                    fontWeight: 600,
                    textTransform: "uppercase",
                  }}
                >
                  {inv.status}
                </span>
                {inv.hostedInvoiceUrl ? (
                  <Link
                    href={inv.hostedInvoiceUrl}
                    className="no-underline"
                    style={{ fontSize: 12.5, fontWeight: 500, color: ACCENT }}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    View
                  </Link>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </LightCard>
    </div>
  );
}

// ============================================================
// Local presentational helpers
// ============================================================

function LightCard({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        background: "#ffffff",
        border: `1px solid ${CARD_BORDER}`,
        borderRadius: 12,
        padding: "24px 28px",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function DarkMeter({ label, used, limit }: { label: string; used: number; limit: number }) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    <div>
      <div className="flex justify-between" style={{ fontSize: 12.5, color: DARK_TEXT_MUTED }}>
        <span>{label}</span>
        <span style={{ color: "#fff", fontWeight: 600 }}>
          {used}
          <span style={{ color: DARK_TEXT_SUBTLE }}> / {limit}</span>
        </span>
      </div>
      <div
        style={{
          height: 5,
          borderRadius: 99,
          background: "rgba(255,255,255,0.12)",
          marginTop: 8,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            borderRadius: 99,
            background: ACCENT_ON_DARK,
            transition: "width 200ms",
          }}
        />
      </div>
    </div>
  );
}

function PlanTile({
  plan,
  currentPlan,
  currency,
  isCurrent,
  hasSubscription,
}: {
  plan: Plan;
  currentPlan: Plan;
  currency: ReturnType<typeof asSupportedCurrency>;
  isCurrent: boolean;
  hasSubscription: boolean;
}) {
  const meta = PLAN_DISPLAY[plan];
  const resolvedCurrency = currency ?? DEFAULT_CURRENCY;
  const priceLabel = `${formatPlanPrice(priceFor(plan, resolvedCurrency), resolvedCurrency)}/mo`;

  return (
    <div
      className="relative flex flex-col"
      style={{
        background: "#ffffff",
        border: isCurrent ? `2px solid ${ACCENT}` : `1px solid ${CARD_BORDER}`,
        borderRadius: 12,
        padding: "22px 24px",
        boxShadow: isCurrent ? "0 12px 28px -14px rgba(58,91,160,0.35)" : "none",
      }}
    >
      {isCurrent ? (
        <span
          aria-hidden
          style={{
            position: "absolute",
            top: -10,
            left: 22,
            background: ACCENT,
            color: "#fff",
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.1em",
            padding: "3px 10px",
            borderRadius: 99,
          }}
        >
          CURRENT
        </span>
      ) : null}

      <div className="flex items-baseline justify-between">
        <span style={{ fontSize: 15, fontWeight: 700, color: INK }}>{meta.name}</span>
        <span
          style={{
            fontFamily: "var(--font-revamp-mono)",
            fontSize: 12.5,
            color: LIGHT_MUTED,
          }}
        >
          {priceLabel}
        </span>
      </div>
      <div style={{ fontSize: 12.5, color: LIGHT_MUTED, marginTop: 3 }}>{meta.tagline}</div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          fontSize: 13,
          color: MUTED,
          marginTop: 16,
          borderTop: `1px solid ${ROW_BORDER}`,
          paddingTop: 14,
        }}
      >
        {meta.highlights.map((h) => (
          <span key={h}>{h}</span>
        ))}
      </div>
      <div style={{ marginTop: "auto", paddingTop: 18 }}>
        <PlanCTA
          plan={plan}
          currentPlan={currentPlan}
          isCurrent={isCurrent}
          hasSubscription={hasSubscription}
          currency={resolvedCurrency}
        />
      </div>
    </div>
  );
}

function TrialStatusCard({
  status,
  trialEndsAt,
  plan,
}: {
  status: "CONVERTED" | "EXPIRED" | "CANCELED" | "ACTIVE";
  trialEndsAt: Date | null;
  plan: Plan;
}) {
  const dateLabel = trialEndsAt
    ? new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(trialEndsAt)
    : "—";

  const [pillLabel, pillBg, pillFg, headline, body]: [string, string, string, string, string] =
    (() => {
      switch (status) {
        case "CONVERTED":
          return [
            "CONVERTED",
            "#E6F1EA",
            "#1E7A47",
            "Trial converted",
            `You're a paying customer since ${dateLabel}. Thanks for sticking with us.`,
          ];
        case "EXPIRED":
          return [
            "EXPIRED",
            "#FBE7E4",
            "#A02B1C",
            "Trial ended without a full charge",
            `Your trial ended ${dateLabel} and the first plan invoice couldn't be charged. You're on SOLO now — restart any time by starting a subscription.`,
          ];
        case "CANCELED":
          return [
            "CANCELED",
            "#FDF1DC",
            "#7A5B1E",
            "Trial canceled",
            `You canceled on ${dateLabel} — no plan charge (the $1 activation is not refunded). You're on SOLO; upgrade any time.`,
          ];
        case "ACTIVE":
          return [
            "ACTIVE",
            "#E6F1EA",
            "#1E7A47",
            `Trial — ${plan}`,
            `Your first plan charge lands ${dateLabel} unless you cancel.`,
          ];
      }
    })();

  return (
    <LightCard style={{ marginTop: 16 }}>
      <div className="flex flex-wrap items-start justify-between" style={{ gap: 16 }}>
        <div>
          <div className="flex items-center" style={{ gap: 10 }}>
            <span style={{ fontSize: 15.5, fontWeight: 700, color: INK }}>{headline}</span>
            <span
              className="rounded-full"
              style={{
                background: pillBg,
                color: pillFg,
                padding: "3px 9px",
                fontFamily: "var(--font-revamp-mono)",
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.04em",
              }}
            >
              {pillLabel}
            </span>
          </div>
          <p style={{ fontSize: 13, color: MUTED, marginTop: 6 }}>{body}</p>
        </div>
      </div>
    </LightCard>
  );
}

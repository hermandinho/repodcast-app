import Link from "next/link";
import { MemberRole, Plan } from "@prisma/client";
import { PLAN_DISPLAY, PLAN_ORDER, planLimitsFor, priceFor } from "@/lib/plans";
import { asSupportedCurrency, DEFAULT_CURRENCY, formatPlanPrice } from "@/lib/currencies";
import { planCapacity } from "@/server/billing/limits";
import {
  costByClient,
  getAgencyUsageTrend,
  type ClientCostRollupRow,
  type UsageTrendBucket,
} from "@/server/db/client-cost";
import { isLiveDb } from "@/server/data/source";
import { resolveTenantContext } from "@/server/data/tenant";
import { prisma } from "@/server/db/client";
import { BillingActions } from "@/components/settings/billing-actions";

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
            stripeSubscriptionId: true,
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
  const limits = planLimitsFor(plan);

  const isAdminOrOwner = tenant.role === MemberRole.OWNER || tenant.role === MemberRole.ADMIN;
  const costRollup: ClientCostRollupRow[] =
    live && isAdminOrOwner ? await costByClient(tenant) : [];
  const usageTrend: UsageTrendBucket[] =
    live && isAdminOrOwner ? await getAgencyUsageTrend(tenant, 30) : [];
  const monthLabel = new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
  }).format(new Date());
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

      {/* Non-trial trial-status card (converted/expired/canceled) rendered
          as a light card below the merged dark strip so users still see the
          resolution status without the dark treatment. */}
      {trialStatus !== "NONE" && !isTrialing ? (
        <TrialStatusCard status={trialStatus} trialEndsAt={trialEndsAt} plan={plan} />
      ) : null}

      {/* Plans grid — 3 cards; current tier gets our-accent border + soft shadow */}
      <div style={{ marginTop: 28 }}>
        <div className="flex flex-wrap items-baseline justify-between" style={{ gap: 8 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: INK }}>Plans</div>
          <div style={{ fontSize: 12.5, color: LIGHT_MUTED }}>
            Monthly cost cap:{" "}
            <span style={{ fontWeight: 600, color: MUTED }}>
              ${(limits.monthlyCostCapCents / 100).toFixed(0)} of AI spend / month
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3" style={{ gap: 14, marginTop: 14 }}>
          {PLAN_ORDER.map((p) => (
            <PlanTile
              key={p}
              plan={p}
              currency={currency}
              isCurrent={p === plan}
              trialEligible={p === Plan.SOLO && trialStatus === "NONE"}
            />
          ))}
        </div>
      </div>

      {/* 30-day usage trend — OWNER/ADMIN only */}
      {isAdminOrOwner ? (
        <LightCard style={{ marginTop: 28, padding: "24px 28px" }}>
          <div className="flex flex-wrap items-baseline justify-between" style={{ gap: 12 }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: INK }}>Usage — last 30 days</div>
              <div style={{ fontSize: 12.5, color: LIGHT_MUTED, marginTop: 3 }}>
                Daily AI spend + generations across every client.
              </div>
            </div>
            {usageTrend.length > 0 ? (
              <span
                style={{
                  fontFamily: "var(--font-revamp-mono)",
                  fontSize: 11,
                  color: LIGHT_MUTED,
                }}
              >
                {usageTrend[0]!.dateIso} → {usageTrend[usageTrend.length - 1]!.dateIso}
              </span>
            ) : null}
          </div>
          <UsageTrendGraph buckets={usageTrend} />
        </LightCard>
      ) : null}

      {/* Cost-to-serve rollup — OWNER/ADMIN only */}
      {isAdminOrOwner ? (
        <LightCard style={{ marginTop: 16, padding: "24px 28px" }}>
          <div className="flex flex-wrap items-baseline justify-between" style={{ gap: 12 }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: INK }}>
                Cost-to-serve by client
              </div>
              <div style={{ fontSize: 12.5, color: LIGHT_MUTED, marginTop: 3 }}>
                {monthLabel} — what each client cost vs. what they pay. Negative margins surface
                under-priced clients early.
              </div>
            </div>
          </div>
          <div style={{ marginTop: 16 }}>
            <ClientCostRollupTable rows={costRollup} />
          </div>
        </LightCard>
      ) : null}

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
  currency,
  isCurrent,
  trialEligible,
}: {
  plan: Plan;
  currency: ReturnType<typeof asSupportedCurrency>;
  isCurrent: boolean;
  trialEligible: boolean;
}) {
  const meta = PLAN_DISPLAY[plan];
  const priceLabel = `${formatPlanPrice(priceFor(plan, currency ?? DEFAULT_CURRENCY), currency ?? DEFAULT_CURRENCY)}/mo`;

  const ctaLabel = isCurrent
    ? "Your plan"
    : trialEligible
      ? "Start trial"
      : plan === Plan.SOLO
        ? "Downgrade"
        : "Upgrade";

  const ctaBg = isCurrent ? ACCENT_SOFT : plan === Plan.NETWORK && !isCurrent ? INK : "transparent";
  const ctaColor = isCurrent ? ACCENT : plan === Plan.NETWORK && !isCurrent ? "#fff" : MUTED;
  const ctaBorder = isCurrent
    ? "none"
    : plan === Plan.NETWORK && !isCurrent
      ? "none"
      : `1px solid #d4dbe7`;

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
      <div
        className="text-center"
        style={{
          marginTop: "auto",
          paddingTop: 18,
        }}
      >
        <div
          style={{
            background: ctaBg,
            color: ctaColor,
            border: ctaBorder,
            borderRadius: 8,
            padding: "9px",
            fontWeight: 600,
            fontSize: 13,
          }}
        >
          {ctaLabel}
        </div>
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

function ClientCostRollupTable({ rows }: { rows: ClientCostRollupRow[] }) {
  if (rows.length === 0) {
    return (
      <div
        style={{
          padding: "32px 0",
          textAlign: "center",
          fontSize: 12.5,
          color: LIGHT_MUTED,
        }}
      >
        No clients yet — add a client to start seeing cost-to-serve.
      </div>
    );
  }

  const sorted = [...rows].sort((a, b) => {
    const am = a.marginCents;
    const bm = b.marginCents;
    if (am == null && bm == null) return a.name.localeCompare(b.name);
    if (am == null) return 1;
    if (bm == null) return -1;
    return am - bm;
  });

  return (
    <div className="overflow-x-auto">
      <div
        className="grid"
        style={{
          gridTemplateColumns: "2fr 1fr 1fr 1fr 0.7fr",
          gap: 12,
          padding: "10px 14px",
          fontFamily: "var(--font-revamp-mono)",
          fontSize: 10.5,
          letterSpacing: "0.1em",
          color: LIGHT_MUTED,
          borderBottom: `1px solid ${ROW_BORDER}`,
        }}
      >
        <span>CLIENT</span>
        <span style={{ textAlign: "right" }}>COST-TO-SERVE</span>
        <span style={{ textAlign: "right" }}>REVENUE</span>
        <span style={{ textAlign: "right" }}>MARGIN</span>
        <span style={{ textAlign: "right" }}>EPISODES</span>
      </div>
      {sorted.map((r) => (
        <ClientCostRow key={r.clientId} row={r} />
      ))}
    </div>
  );
}

function ClientCostRow({ row }: { row: ClientCostRollupRow }) {
  const negative = row.marginCents != null && row.marginCents < 0;
  const noProfile = row.revenueCents == null;
  const marginColor = noProfile ? LIGHT_MUTED : negative ? "#A06D12" : "#1E7A47";

  return (
    <div
      className="grid items-center"
      style={{
        gridTemplateColumns: "2fr 1fr 1fr 1fr 0.7fr",
        gap: 12,
        padding: 14,
        fontSize: 13.5,
        borderBottom: "1px solid #f4f6fa",
      }}
    >
      <div className="flex items-center" style={{ gap: 10 }}>
        <div
          className="grid flex-shrink-0 place-items-center"
          style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            background: ACCENT_SOFT,
            fontSize: 11,
            fontWeight: 700,
            color: ACCENT,
          }}
        >
          {row.name
            .split(/\s+/)
            .slice(0, 2)
            .map((w) => w[0]?.toUpperCase() ?? "")
            .join("")}
        </div>
        <Link
          href={`/clients/${row.clientId}/billing`}
          className="no-underline"
          style={{ color: INK, fontWeight: 600 }}
        >
          {row.name}
        </Link>
      </div>
      <span style={{ textAlign: "right", fontFamily: "var(--font-revamp-mono)", fontSize: 13 }}>
        {formatUsd(row.costCents)}
      </span>
      <span style={{ textAlign: "right", color: noProfile ? LIGHT_MUTED : INK }}>
        {row.revenueCents == null ? (
          <>
            —{" "}
            <Link
              href={`/clients/${row.clientId}/billing`}
              className="no-underline"
              style={{ fontSize: 11.5, color: ACCENT, fontWeight: 600 }}
            >
              add
            </Link>
          </>
        ) : (
          formatUsd(row.revenueCents)
        )}
      </span>
      <span
        style={{
          textAlign: "right",
          fontWeight: 600,
          color: marginColor,
          fontFamily: "var(--font-revamp-mono)",
        }}
      >
        {row.marginCents == null
          ? "—"
          : (negative ? "−" : "") + formatUsd(Math.abs(row.marginCents))}
      </span>
      <span
        style={{
          textAlign: "right",
          fontFamily: "var(--font-revamp-mono)",
          fontSize: 13,
          color: MUTED,
        }}
      >
        {row.episodeCountInWindow}
      </span>
    </div>
  );
}

function formatUsd(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

function UsageTrendGraph({ buckets }: { buckets: UsageTrendBucket[] }) {
  if (buckets.length === 0) {
    return (
      <div
        style={{
          border: `1px dashed ${CARD_BORDER}`,
          background: "#fbfcfe",
          borderRadius: 10,
          padding: 32,
          textAlign: "center",
          fontSize: 12.5,
          color: LIGHT_MUTED,
          marginTop: 18,
        }}
      >
        No AI spend yet — generate an episode to start populating this chart.
      </div>
    );
  }

  const totalCost = buckets.reduce((acc, b) => acc + b.costCents, 0);
  const totalGens = buckets.reduce((acc, b) => acc + b.generations, 0);
  const maxCost = Math.max(1, ...buckets.map((b) => b.costCents));
  const maxGens = Math.max(1, ...buckets.map((b) => b.generations));

  return (
    <div style={{ marginTop: 18 }}>
      <div className="grid grid-cols-2 md:grid-cols-4" style={{ gap: 14 }}>
        <TrendStat label="COST, 30 DAYS" value={formatUsd(totalCost)} />
        <TrendStat label="GENERATIONS" value={totalGens.toLocaleString()} />
        <TrendStat
          label="AVG COST / DAY"
          value={formatUsd(Math.round(totalCost / buckets.length))}
        />
        <TrendStat
          label="AVG COST / GEN"
          value={totalGens > 0 ? formatUsd(Math.round(totalCost / totalGens)) : "—"}
        />
      </div>

      <div style={{ marginTop: 22 }}>
        <div className="flex" style={{ gap: 16, fontSize: 12, color: MUTED, marginBottom: 10 }}>
          <span className="inline-flex items-center" style={{ gap: 6 }}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: 2,
                background: ACCENT,
              }}
            />
            Cost / day
          </span>
          <span className="inline-flex items-center" style={{ gap: 6 }}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: 2,
                background: "#8fd0a8",
              }}
            />
            Generations / day
          </span>
        </div>
        <BarRow buckets={buckets} max={maxCost} valueFor={(b) => b.costCents} color={ACCENT} />
        <BarRow
          buckets={buckets}
          max={maxGens}
          valueFor={(b) => b.generations}
          color="#2E9E5B"
          topSpace
        />
        <div
          className="flex justify-between"
          style={{
            fontFamily: "var(--font-revamp-mono)",
            fontSize: 10,
            color: LIGHT_MUTED,
            marginTop: 8,
          }}
        >
          <span>{buckets[0]!.dateIso}</span>
          <span>{buckets[Math.floor(buckets.length / 3)]!.dateIso}</span>
          <span>{buckets[Math.floor((buckets.length * 2) / 3)]!.dateIso}</span>
          <span>{buckets[buckets.length - 1]!.dateIso}</span>
        </div>
      </div>
    </div>
  );
}

function TrendStat({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        border: `1px solid ${ROW_BORDER}`,
        borderRadius: 10,
        padding: "14px 16px",
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-revamp-mono)",
          fontSize: 10,
          letterSpacing: "0.1em",
          color: LIGHT_MUTED,
          fontWeight: 600,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 20,
          fontWeight: 800,
          color: INK,
          marginTop: 6,
          fontFamily: "var(--font-revamp-sans)",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function BarRow({
  buckets,
  max,
  valueFor,
  color,
  topSpace = false,
}: {
  buckets: UsageTrendBucket[];
  max: number;
  valueFor: (b: UsageTrendBucket) => number;
  color: string;
  topSpace?: boolean;
}) {
  const width = 720;
  const height = 60;
  const padX = 8;
  const barAreaWidth = width - padX * 2;
  const slotWidth = barAreaWidth / buckets.length;
  const barWidth = Math.max(2, Math.min(slotWidth * 0.72, 18));

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full"
      style={{
        height: 60,
        marginTop: topSpace ? 8 : 0,
        borderBottom: topSpace ? `1px solid ${ROW_BORDER}` : "none",
      }}
      role="img"
      aria-label={`Trend row`}
    >
      <line
        x1={padX}
        x2={width - padX}
        y1={height - 2}
        y2={height - 2}
        stroke={ROW_BORDER}
        strokeWidth={1}
      />
      {buckets.map((b, i) => {
        const value = valueFor(b);
        const h = value === 0 ? 2 : Math.round((value / max) * (height - 6));
        const cx = padX + slotWidth * i + slotWidth / 2;
        return (
          <rect
            key={b.dateIso}
            x={cx - barWidth / 2}
            y={height - 2 - h}
            width={barWidth}
            height={h}
            rx={2}
            fill={color}
            opacity={value === 0 ? 0.18 : 0.9}
          >
            <title>{`${b.dateIso}: ${value}`}</title>
          </rect>
        );
      })}
    </svg>
  );
}

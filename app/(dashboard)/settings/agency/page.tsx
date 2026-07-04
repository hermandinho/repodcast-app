import Link from "next/link";
import { MemberRole, Plan } from "@prisma/client";
import { AgencyNameForm } from "@/components/settings/agency-name-form";
import { RenewalRemindersToggle } from "@/components/settings/renewal-reminders-toggle";
import { PLAN_DISPLAY, priceFor } from "@/lib/plans";
import { asSupportedCurrency, DEFAULT_CURRENCY, formatPlanPrice } from "@/lib/currencies";
import { getAuthContext } from "@/server/auth/context";
import { isLiveDb } from "@/server/data/source";
import { resolveTenantContext } from "@/server/data/tenant";
import { prisma } from "@/server/db/client";

const DATE_FMT = new Intl.DateTimeFormat("en-US", {
  month: "long",
  day: "numeric",
  year: "numeric",
});

const INK = "#0a1e3c";
const MUTED = "#41506b";
const LIGHT_MUTED = "#8a97ad";
const CARD_BORDER = "#e4e9f1";
const ROW_BORDER = "#eef1f6";
const ACCENT = "#3A5BA0";
const ACCENT_SOFT = "#eef2fb";

/**
 * Settings · Agency — revamp visual system (see `ref/UI/Revamp/` 1a).
 *
 * Structure: one workspace card (2 rows: agency name + renewal reminders,
 * each a 260px-label + 1fr-control grid), a plan summary strip, a
 * three-column meta row (members / created / workspace id), and a danger
 * zone footer. All cards use the standard `#e4e9f1` outline + 12px radius
 * on `#ffffff` surfaces against the `#f6f8fc` canvas.
 */
export default async function AgencySettingsPage() {
  const [tenant, auth] = await Promise.all([resolveTenantContext(), getAuthContext()]);

  const live = isLiveDb();
  const agency = live
    ? await prisma.agency
        .findUnique({
          where: { id: tenant.agencyId },
          select: {
            id: true,
            name: true,
            plan: true,
            createdAt: true,
            renewalRemindersEnabled: true,
            preferredCurrency: true,
            trialEndsAt: true,
            trialStatus: true,
          },
        })
        .catch(() => null)
    : null;

  const memberCount = live
    ? await prisma.member.count({ where: { agencyId: tenant.agencyId } }).catch(() => 0)
    : 0;

  const name = agency?.name ?? auth?.agency.name ?? "Northbeam Studio";
  const plan: Plan = agency?.plan ?? auth?.agency.plan ?? Plan.STUDIO;
  const createdAt = agency?.createdAt ?? null;
  const planMeta = PLAN_DISPLAY[plan];
  const role = auth?.member.role ?? MemberRole.OWNER;
  const canEdit = role === MemberRole.OWNER || role === MemberRole.ADMIN;
  const currency = asSupportedCurrency(agency?.preferredCurrency) ?? DEFAULT_CURRENCY;
  const priceLabel = `${formatPlanPrice(priceFor(plan, currency), currency)}/mo`;
  const trialEndsAt = agency?.trialEndsAt ?? null;
  const isTrialing = agency?.trialStatus === "ACTIVE" && trialEndsAt !== null;

  return (
    <div style={{ maxWidth: 860, fontFamily: "var(--font-revamp-sans)" }}>
      {/* Workspace card — agency name + renewal reminders in a 2-row grid */}
      <Card>
        <CardRow
          label="Agency name"
          description="Shown on the topbar, dashboard greeting, and outgoing emails."
          border
        >
          <AgencyNameForm initial={name} canEdit={canEdit} />
        </CardRow>
        <CardRow
          label="Renewal reminders"
          description="Email every owner and admin when a client contract renews."
        >
          <RenewalRemindersToggle
            initialEnabled={agency?.renewalRemindersEnabled ?? true}
            canEdit={canEdit}
          />
        </CardRow>
      </Card>

      {/* Plan summary strip */}
      <Link
        href="/settings/billing"
        className="mt-4 flex items-center justify-between no-underline"
        style={{
          background: "#ffffff",
          border: `1px solid ${CARD_BORDER}`,
          borderRadius: 12,
          padding: "20px 28px",
          gap: 24,
          marginTop: 16,
        }}
      >
        <div className="flex items-center" style={{ gap: 16 }}>
          <div
            className="grid place-items-center"
            style={{
              width: 38,
              height: 38,
              borderRadius: 10,
              background: ACCENT_SOFT,
              color: ACCENT,
              fontWeight: 800,
              fontSize: 15,
              flexShrink: 0,
            }}
          >
            {planMeta.name[0]}
          </div>
          <div>
            <div className="flex items-baseline" style={{ gap: 8 }}>
              <span style={{ fontSize: 15.5, fontWeight: 700, color: INK }}>{planMeta.name}</span>
              <span
                style={{
                  fontFamily: "var(--font-revamp-mono)",
                  fontSize: 12,
                  color: LIGHT_MUTED,
                }}
              >
                {priceLabel}
              </span>
            </div>
            <div style={{ fontSize: 12.5, color: LIGHT_MUTED, marginTop: 2 }}>
              {planMeta.tagline}
              {isTrialing && trialEndsAt
                ? ` · trial ends ${trialEndsAt.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
                : ""}
            </div>
          </div>
        </div>
        <span style={{ fontSize: 13.5, fontWeight: 600, color: ACCENT }}>Change plan →</span>
      </Link>

      {/* Meta row: 3 cards */}
      <div
        className="grid"
        style={{
          gridTemplateColumns: "1fr 1fr 1.4fr",
          gap: 16,
          marginTop: 16,
        }}
      >
        <MetaCard label="Members">
          <div className="flex items-baseline justify-between">
            <span style={{ fontSize: 22, fontWeight: 800, color: INK }}>{memberCount}</span>
            <Link
              href="/settings/team"
              className="no-underline"
              style={{ fontSize: 12.5, fontWeight: 600, color: ACCENT }}
            >
              Manage →
            </Link>
          </div>
        </MetaCard>
        <MetaCard label="Created">
          <div style={{ fontSize: 15, fontWeight: 700, color: INK, marginTop: 10 }}>
            {createdAt ? DATE_FMT.format(createdAt) : "—"}
          </div>
        </MetaCard>
        <MetaCard label="Workspace ID">
          <div className="flex items-center justify-between" style={{ marginTop: 10, gap: 8 }}>
            <span
              className="truncate"
              style={{
                fontFamily: "var(--font-revamp-mono)",
                fontSize: 12.5,
                color: MUTED,
              }}
            >
              {agency?.id ?? tenant.agencyId}
            </span>
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: LIGHT_MUTED,
                border: `1px solid ${CARD_BORDER}`,
                padding: "4px 10px",
                borderRadius: 6,
                flexShrink: 0,
              }}
            >
              Copy
            </span>
          </div>
        </MetaCard>
      </div>

      {/* Danger zone — UI only for now; delete-workspace action lands in a
          follow-up (there's no server action yet). */}
      {canEdit ? (
        <div
          className="flex flex-wrap items-center justify-between"
          style={{
            border: "1px dashed #e4c5c5",
            background: "#fdf8f8",
            borderRadius: 12,
            padding: "18px 28px",
            marginTop: 16,
            gap: 16,
          }}
        >
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#a13c3c" }}>Delete workspace</div>
            <div style={{ fontSize: 12.5, color: "#b98a8a", marginTop: 2 }}>
              Removes all clients, shows, and generated content. Irreversible.
            </div>
          </div>
          <button
            type="button"
            disabled
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "#a13c3c",
              border: "1px solid #e4c5c5",
              padding: "8px 16px",
              borderRadius: 8,
              background: "#fff",
              cursor: "not-allowed",
              opacity: 0.7,
              fontFamily: "inherit",
            }}
            title="Delete workflow lands in a follow-up"
          >
            Delete…
          </button>
        </div>
      ) : null}
    </div>
  );
}

// ============================================================
// Local presentational helpers
// ============================================================

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "#ffffff",
        border: `1px solid ${CARD_BORDER}`,
        borderRadius: 12,
        overflow: "hidden",
      }}
    >
      {children}
    </div>
  );
}

function CardRow({
  label,
  description,
  children,
  border = false,
}: {
  label: string;
  description: string;
  children: React.ReactNode;
  border?: boolean;
}) {
  return (
    <div
      className="grid"
      style={{
        gridTemplateColumns: "260px 1fr",
        gap: 32,
        padding: "24px 28px",
        borderBottom: border ? `1px solid ${ROW_BORDER}` : undefined,
      }}
    >
      <div>
        <div style={{ fontSize: 14.5, fontWeight: 700, color: INK }}>{label}</div>
        <div style={{ fontSize: 12.5, color: LIGHT_MUTED, lineHeight: 1.5, marginTop: 4 }}>
          {description}
        </div>
      </div>
      <div>{children}</div>
    </div>
  );
}

function MetaCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "#ffffff",
        border: `1px solid ${CARD_BORDER}`,
        borderRadius: 12,
        padding: "18px 22px",
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-revamp-mono)",
          fontSize: 10.5,
          letterSpacing: "0.12em",
          color: LIGHT_MUTED,
          fontWeight: 600,
        }}
      >
        {label.toUpperCase()}
      </div>
      <div style={{ marginTop: 8 }}>{children}</div>
    </div>
  );
}

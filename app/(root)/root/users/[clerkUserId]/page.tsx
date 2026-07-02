import Link from "next/link";
import { notFound } from "next/navigation";
import { NotFoundError } from "@/server/auth/errors";
import { requireSystemAdminContext } from "@/server/auth/system";
import {
  getMemberIdentityDetail,
  type MemberIdentityDetail,
  type MemberSearchMembership,
} from "@/server/db/system/users";
import { startImpersonationAction } from "@/app/(root)/root/agencies/[id]/impersonate-actions";
import { resendWelcomeAction, resetPasswordAction } from "../actions";

export const dynamic = "force-dynamic";

const ERROR_COPY: Record<string, string> = {
  missing_user_id: "No user id was submitted.",
  missing_target: "The action was missing a target agency or user id.",
  not_found: "Couldn't find that user in the database.",
  clerk_failed:
    "Clerk rejected the sign-in-token request. Check the Clerk dashboard and try again.",
  email_failed: "Resend rejected the email dispatch. Check the RESEND_API_KEY + retry.",
  forbidden: "This action needs a ROOT or OPERATOR system role.",
  unknown: "Something went wrong. Check the server logs.",
};

const OK_COPY: Record<string, string> = {
  reset_password_sent: "Sign-in link emailed",
  welcome_resent: "Welcome email resent",
};

function formatRelative(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const seconds = Math.round(diffMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function formatIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default async function RootUserDrilldownPage({
  params,
  searchParams,
}: {
  params: Promise<{ clerkUserId: string }>;
  searchParams: Promise<{ ok?: string; error?: string; email?: string }>;
}) {
  const [{ clerkUserId }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireSystemAdminContext();

  let detail: MemberIdentityDetail;
  try {
    detail = await getMemberIdentityDetail(ctx, clerkUserId);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }

  const canManage = ctx.admin.role === "ROOT" || ctx.admin.role === "OPERATOR";

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <nav className="text-sm text-zinc-500">
        <Link href="/root/users" className="hover:text-zinc-300">
          ← All users
        </Link>
      </nav>

      {sp.ok ? (
        <div className="rounded-lg border border-emerald-700/60 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-200">
          {OK_COPY[sp.ok] ?? "Done."}
          {sp.email ? (
            <>
              {" "}
              — sent to <span className="font-mono text-emerald-100">{sp.email}</span>
            </>
          ) : null}
        </div>
      ) : null}
      {sp.error ? (
        <div className="rounded-lg border border-red-700/60 bg-red-950/40 px-4 py-3 text-sm text-red-200">
          {ERROR_COPY[sp.error] ?? ERROR_COPY.unknown}
        </div>
      ) : null}

      <IdentityCard detail={detail} canManage={canManage} />

      <MembershipsSection detail={detail} canManage={canManage} />
    </div>
  );
}

// ============================================================
// Identity card
// ============================================================

function IdentityCard({ detail, canManage }: { detail: MemberIdentityDetail; canManage: boolean }) {
  const clerk = detail.clerk;
  return (
    <header className="flex flex-col gap-4 rounded-xl border border-zinc-800 bg-zinc-900/40 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          {clerk?.imageUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={clerk.imageUrl}
              alt=""
              className="h-14 w-14 rounded-full border border-zinc-700 bg-zinc-800 object-cover"
            />
          ) : (
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-zinc-800 font-mono text-zinc-500">
              {(detail.name ?? detail.email).slice(0, 1).toUpperCase()}
            </div>
          )}
          <div className="flex flex-col gap-1">
            <h1 className="font-display text-2xl font-semibold tracking-tight text-white">
              {detail.name ?? detail.email}
            </h1>
            {detail.name ? <div className="text-sm text-zinc-400">{detail.email}</div> : null}
            <div className="mt-1 flex items-center gap-2 font-mono text-[11px] text-zinc-500">
              <span>{detail.clerkUserId}</span>
              <span className="text-zinc-700">·</span>
              <span>last active {formatRelative(detail.lastActiveAt)}</span>
            </div>
          </div>
        </div>

        {canManage ? (
          <div className="flex flex-wrap gap-2">
            <form action={resetPasswordAction}>
              <input type="hidden" name="clerkUserId" value={detail.clerkUserId} />
              <button
                type="submit"
                className="rounded-md border border-red-500/60 bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-100 hover:bg-red-500/20"
                title="Emails a Clerk sign-in token that lets the user log in without their old password"
              >
                Reset password
              </button>
            </form>
          </div>
        ) : null}
      </div>

      {clerk ? (
        <div className="grid grid-cols-2 gap-4 border-t border-zinc-800 pt-4 md:grid-cols-4">
          <MetaTile
            label="Clerk primary email"
            value={clerk.primaryEmail ?? "—"}
            mono={Boolean(clerk.primaryEmail)}
          />
          <MetaTile
            label="Last sign-in"
            value={clerk.lastSignInAt ? formatRelative(clerk.lastSignInAt) : "never"}
          />
          <MetaTile
            label="2FA enrolled"
            value={clerk.twoFactorEnabled ? "yes" : "no"}
            tone={clerk.twoFactorEnabled ? "ok" : "warn"}
          />
          <MetaTile
            label="Account state"
            value={clerk.banned ? "banned" : "active"}
            tone={clerk.banned ? "bad" : "ok"}
          />
        </div>
      ) : (
        <div className="rounded-md border border-amber-700/40 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
          Clerk lookup failed — the identity card is showing DB-only data. Check the Clerk
          dashboard.
        </div>
      )}
    </header>
  );
}

function MetaTile({
  label,
  value,
  mono = false,
  tone = "neutral",
}: {
  label: string;
  value: string;
  mono?: boolean;
  tone?: "neutral" | "ok" | "warn" | "bad";
}) {
  const toneClass = {
    neutral: "text-zinc-200",
    ok: "text-emerald-300",
    warn: "text-amber-300",
    bad: "text-red-300",
  }[tone];
  return (
    <div>
      <div className="font-mono text-[10.5px] tracking-wider text-zinc-500 uppercase">{label}</div>
      <div className={`mt-1 truncate text-sm ${toneClass} ${mono ? "font-mono" : ""}`}>{value}</div>
    </div>
  );
}

// ============================================================
// Memberships
// ============================================================

function MembershipsSection({
  detail,
  canManage,
}: {
  detail: MemberIdentityDetail;
  canManage: boolean;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-lg font-semibold text-white">
          {detail.memberships.length} agency{" "}
          {detail.memberships.length === 1 ? "membership" : "memberships"}
        </h2>
      </div>
      <ul className="flex flex-col gap-2">
        {detail.memberships.map((m) => (
          <MembershipRow
            key={m.memberId}
            membership={m}
            clerkUserId={detail.clerkUserId}
            canManage={canManage}
          />
        ))}
      </ul>
    </section>
  );
}

function MembershipRow({
  membership,
  clerkUserId,
  canManage,
}: {
  membership: MemberSearchMembership;
  clerkUserId: string;
  canManage: boolean;
}) {
  return (
    <li className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <Link
            href={`/root/agencies/${membership.agencyId}`}
            className="truncate text-sm text-zinc-100 hover:text-white hover:underline"
          >
            {membership.agencyName}
          </Link>
          <div className="flex items-center gap-2 text-[11.5px] text-zinc-500">
            <span className="font-mono text-[10.5px] tracking-wider text-zinc-400 uppercase">
              {membership.role}
            </span>
            <span>·</span>
            <span className="font-mono text-[10.5px] tracking-wider text-zinc-500 uppercase">
              {membership.agencyPlan}
            </span>
            <span>·</span>
            <span>joined {formatIsoDate(membership.joinedAt)}</span>
            <span>·</span>
            <span>active {formatRelative(membership.lastActiveAt)}</span>
          </div>
        </div>
        {canManage ? (
          <div className="flex flex-wrap items-center gap-2">
            <form action={resendWelcomeAction}>
              <input type="hidden" name="clerkUserId" value={clerkUserId} />
              <input type="hidden" name="agencyId" value={membership.agencyId} />
              <button
                type="submit"
                className="rounded border border-zinc-700 px-3 py-1 text-[11.5px] font-semibold text-zinc-200 hover:bg-zinc-800"
                title={`Resend the welcome email for ${membership.agencyName}`}
              >
                Resend welcome
              </button>
            </form>
            <form action={startImpersonationAction}>
              <input type="hidden" name="agencyId" value={membership.agencyId} />
              <input type="hidden" name="memberId" value={membership.memberId} />
              <button
                type="submit"
                className="rounded border border-orange-500/60 px-3 py-1 text-[11.5px] font-semibold tracking-wider text-orange-300 uppercase hover:bg-orange-500/10"
                title="Open a read-only impersonation envelope for this membership"
              >
                Impersonate
              </button>
            </form>
          </div>
        ) : null}
      </div>
    </li>
  );
}

import type { SystemAdminRole } from "@prisma/client";
import {
  endImpersonationAction,
  promoteImpersonationAction,
} from "@/app/(root)/root/agencies/[id]/impersonate-actions";

/**
 * Sticky banner mounted in `(dashboard)/layout.tsx` whenever
 * the resolved tenant context carries an active impersonation envelope.
 *
 * Per PLAN: bright orange in read-only mode, red in write mode so the
 * operator cannot confuse the two. Read-mode also surfaces a "Promote to
 * WRITE" button, gated to ROOT — clicking it fires the promote action
 * which writes an audit row + swaps the cookie's mode. SUPPORT / OPERATOR
 * / ANALYST viewers see the read-mode banner without the promote
 * affordance (the action would 403 anyway).
 */
export function ImpersonationBanner({
  agencyName,
  memberEmail,
  memberName,
  mode,
  actorRole,
}: {
  agencyName: string;
  memberEmail: string;
  memberName: string | null;
  mode: "read" | "write";
  actorRole: SystemAdminRole;
}) {
  const target = memberName ? `${memberName} (${memberEmail})` : memberEmail;
  const modeCopy = mode === "read" ? "read-only" : "WRITE MODE";
  const bg = mode === "read" ? "bg-orange-500" : "bg-red-600";
  const canPromote = mode === "read" && actorRole === "ROOT";

  return (
    <div
      className={`${bg} flex w-full items-center justify-between gap-4 px-6 py-2 text-[12.5px] font-medium text-white shadow-sm`}
      role="status"
      aria-live="polite"
    >
      <div className="min-w-0 flex-1 truncate">
        VIEWING AS <span className="font-semibold">{target}</span> — agency{" "}
        <span className="font-semibold">{agencyName}</span> — {modeCopy}
      </div>
      <div className="flex items-center gap-2">
        {canPromote ? (
          <form action={promoteImpersonationAction}>
            <button
              type="submit"
              className="rounded border border-white/40 px-3 py-1 text-[11.5px] font-semibold tracking-wider uppercase hover:bg-white/10"
              title="ROOT only. Unlocks tenant-side writes for this session."
            >
              Promote to WRITE →
            </button>
          </form>
        ) : null}
        <form action={endImpersonationAction}>
          <button
            type="submit"
            className="rounded border border-white/40 px-3 py-1 text-[11.5px] font-semibold tracking-wider uppercase hover:bg-white/10"
          >
            End impersonation →
          </button>
        </form>
      </div>
    </div>
  );
}

import { endImpersonationAction } from "@/app/(root)/root/agencies/[id]/impersonate-actions";

/**
 * Phase 3.6.6 — sticky orange banner mounted in `(dashboard)/layout.tsx`
 * whenever the resolved tenant context carries an active impersonation
 * envelope.
 *
 * Per PLAN: bright orange so the operator cannot confuse it with the red
 * ROOT-mode chrome. The "End impersonation" button posts to a server
 * action that clears the cookie + writes the IMPERSONATE_END audit row.
 */
export function ImpersonationBanner({
  agencyName,
  memberEmail,
  memberName,
  mode,
}: {
  agencyName: string;
  memberEmail: string;
  memberName: string | null;
  mode: "read" | "write";
}) {
  const target = memberName ? `${memberName} (${memberEmail})` : memberEmail;
  const modeCopy = mode === "read" ? "read-only" : "WRITE MODE";
  const bg = mode === "read" ? "bg-orange-500" : "bg-red-600";

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
      <form action={endImpersonationAction}>
        <button
          type="submit"
          className="rounded border border-white/40 px-3 py-1 text-[11.5px] font-semibold tracking-wider uppercase hover:bg-white/10"
        >
          End impersonation →
        </button>
      </form>
    </div>
  );
}

import type { SystemAdminRole } from "@prisma/client";
import { startImpersonationAction } from "@/app/(root)/root/agencies/[id]/impersonate-actions";
import type { AgencyMemberForRoot } from "@/server/db/system/agencies";

/**
 * Members section on the Agency Overview tab. Hosts the
 * read-only-impersonation button per row until the full Members tab lands.
 *
 * `viewerRole` gates the Impersonate button: SUPPORT and ANALYST see the
 * member list but the button is missing for them (the start action would
 * 403 anyway — gating in UI avoids the dead-end click).
 */
export function AgencyMembersPanel({
  agencyId,
  members,
  viewerRole,
}: {
  agencyId: string;
  members: AgencyMemberForRoot[];
  viewerRole: SystemAdminRole;
}) {
  const canImpersonate = viewerRole === "ROOT" || viewerRole === "OPERATOR";

  if (members.length === 0) {
    return (
      <section className="flex flex-col gap-4">
        <h2 className="font-display text-lg font-semibold text-white">Members</h2>
        <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/40 p-6 text-center text-sm text-zinc-500">
          No members on this agency yet.
        </div>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-lg font-semibold text-white">Members</h2>
        <span className="text-sm text-zinc-500">
          {members.length} {members.length === 1 ? "member" : "members"}
        </span>
      </div>
      <ul className="flex flex-col divide-y divide-zinc-800 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/40">
        {members.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm text-zinc-100">{m.name ?? m.email}</span>
              {m.name ? (
                <span className="truncate text-[12px] text-zinc-500">{m.email}</span>
              ) : null}
            </div>
            <div className="flex items-center gap-3">
              <span className="font-mono text-[10.5px] tracking-wider text-zinc-400 uppercase">
                {m.role}
              </span>
              {canImpersonate ? (
                <form action={startImpersonationAction}>
                  <input type="hidden" name="agencyId" value={agencyId} />
                  <input type="hidden" name="memberId" value={m.id} />
                  <button
                    type="submit"
                    className="rounded border border-orange-500/60 px-3 py-1 text-[11.5px] font-semibold tracking-wider text-orange-300 uppercase hover:bg-orange-500/10"
                    title="Open a read-only impersonation envelope"
                  >
                    Impersonate
                  </button>
                </form>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

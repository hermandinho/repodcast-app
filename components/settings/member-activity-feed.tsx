import { MemberRole, type MemberTransitionKind } from "@prisma/client";
import type { MemberTransitionWithContext } from "@/server/db/member-transitions";

/**
 * Activity feed for `/settings/team`. Reads `MemberTransition` rows and
 * renders one line per event. Designed to stay readable after the related
 * Member/Invite rows are deleted — we always fall back to the snapshotted
 * email or "Someone".
 */
export function MemberActivityFeed({ items }: { items: MemberTransitionWithContext[] }) {
  if (items.length === 0) {
    return (
      <div className="border-border bg-canvas text-muted-2 rounded-2xl border border-dashed px-4 py-6 text-center text-[12.5px]">
        Team changes will appear here — invites, role updates, removals, and ownership transfers.
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-[10px]">
      {items.map((t) => {
        const palette = paletteFor(t.kind);
        return (
          <li
            key={t.id}
            className="border-border-subtle bg-surface-2 flex items-start gap-3 rounded-xl border px-3 py-[10px]"
          >
            <span
              className="mt-[6px] block h-[7px] w-[7px] flex-shrink-0 rounded-full ring-[3px]"
              style={{ background: palette.color, boxShadow: `0 0 0 4px ${palette.ring}` }}
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <div className="text-ink text-[13px]">{describe(t)}</div>
              <div className="text-muted-2 mt-[2px] text-[11.5px]">{formatWhen(t.createdAt)}</div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function actorLabel(t: MemberTransitionWithContext): string {
  if (!t.actor) return "Someone";
  return t.actor.name || t.actor.email.split("@")[0];
}

function targetLabel(t: MemberTransitionWithContext): string {
  if (t.target) return t.target.name || t.target.email.split("@")[0];
  // Falls back to the snapshotted email on the row (set at record time).
  if (t.email) return t.email;
  if (t.invite?.email) return t.invite.email;
  return "someone";
}

function roleLabel(role: MemberRole | null): string {
  switch (role) {
    case MemberRole.OWNER:
      return "Owner";
    case MemberRole.ADMIN:
      return "Admin";
    case MemberRole.EDITOR:
      return "Editor";
    case MemberRole.REVIEWER:
      return "Reviewer";
    default:
      return "—";
  }
}

function describe(t: MemberTransitionWithContext): string {
  switch (t.kind) {
    case "INVITED":
      return `${actorLabel(t)} invited ${targetLabel(t)} as ${roleLabel(t.toRole)}.`;
    case "INVITE_ACCEPTED": {
      // Self-action — the accepter is both actor + target. Render naturally
      // as "Alice joined the agency" rather than "Alice invited Alice".
      const who = t.target?.name || t.email || actorLabel(t);
      return `${who} accepted their invite and joined the agency.`;
    }
    case "INVITE_REVOKED":
      return `${actorLabel(t)} revoked the invite for ${targetLabel(t)}.`;
    case "ROLE_CHANGED":
      return `${actorLabel(t)} changed ${targetLabel(t)}'s role from ${roleLabel(
        t.fromRole,
      )} to ${roleLabel(t.toRole)}.`;
    case "REMOVED":
      return `${actorLabel(t)} removed ${targetLabel(t)} from the agency.`;
    case "OWNER_TRANSFERRED":
      return `${actorLabel(t)} transferred ownership to ${targetLabel(t)}.`;
  }
}

function paletteFor(kind: MemberTransitionKind): { color: string; ring: string } {
  switch (kind) {
    case "INVITED":
    case "INVITE_ACCEPTED":
      return { color: "#2E9E5B", ring: "#E7F4EC" };
    case "INVITE_REVOKED":
    case "REMOVED":
      return { color: "#C0392B", ring: "#FBEDEC" };
    case "ROLE_CHANGED":
      return { color: "#3A5BA0", ring: "#EEF2FB" };
    case "OWNER_TRANSFERRED":
      return { color: "#A06D12", ring: "#FBF1DE" };
  }
}

function formatWhen(date: Date): string {
  const ms = Date.now() - date.getTime();
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Member } from "@prisma/client";
import { MemberRole } from "@/lib/enums";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";
import {
  changeMemberRoleAction,
  removeMemberAction,
  transferOwnershipAction,
} from "@/app/(dashboard)/settings/team/actions";

const INK = "#0a1e3c";
const MUTED = "#41506b";
const LIGHT_MUTED = "#8a97ad";
const ACCENT = "#3A5BA0";
const ACCENT_SOFT = "#eef2fb";

const ROLE_LABEL: Record<MemberRole, string> = {
  OWNER: "OWNER",
  ADMIN: "ADMIN",
  EDITOR: "EDITOR",
  REVIEWER: "REVIEWER",
};

function initialsOf(name: string | null, email: string): string {
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean);
    return parts
      .slice(0, 2)
      .map((p) => p[0])
      .join("")
      .toUpperCase();
  }
  return (email[0] ?? "?").toUpperCase();
}

/**
 * Single member row rendered inside the Members card on the revamp Team
 * page. Revamped visual: 36×36 dark-ink circle avatar, name+email stack,
 * mono uppercase role pill (accent-soft for the viewer's own role), and
 * inline role/remove controls for admins.
 */
export function MemberRow({
  member,
  isSelf,
  viewerRole,
}: {
  member: Member;
  isSelf: boolean;
  viewerRole: MemberRole;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [confirmTransfer, setConfirmTransfer] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canManage =
    !isSelf &&
    (viewerRole === MemberRole.OWNER || viewerRole === MemberRole.ADMIN) &&
    member.role !== MemberRole.OWNER;

  const canTransferOwnership =
    !isSelf && viewerRole === MemberRole.OWNER && member.role === MemberRole.ADMIN;

  const onRoleChange = (next: "admin" | "member") => {
    setError(null);
    startTransition(async () => {
      try {
        const result = await changeMemberRoleAction({ memberId: member.id, role: next });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Update failed.");
      }
    });
  };

  const onRemove = () => {
    setError(null);
    startTransition(async () => {
      try {
        const result = await removeMemberAction({ memberId: member.id });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        router.refresh();
        setConfirmRemove(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Remove failed.");
      }
    });
  };

  const onTransferOwnership = () => {
    setError(null);
    startTransition(async () => {
      try {
        const result = await transferOwnershipAction({ memberId: member.id });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        router.refresh();
        setConfirmTransfer(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Transfer failed.");
      }
    });
  };

  return (
    <div
      className="flex flex-wrap items-center"
      style={{
        gap: 12,
        padding: "16px 28px",
        borderTop: "1px solid #f4f6fa",
      }}
    >
      <div
        className="grid flex-shrink-0 place-items-center rounded-full"
        style={{
          width: 36,
          height: 36,
          background: INK,
          color: "#ffffff",
          fontSize: 12,
          fontWeight: 700,
        }}
      >
        {initialsOf(member.name, member.email)}
      </div>
      <div className="min-w-0 flex-1">
        <div style={{ fontSize: 14, fontWeight: 600, color: INK }}>
          {member.name ?? member.email.split("@")[0]}
          {isSelf && (
            <span style={{ fontSize: 12, fontWeight: 500, color: LIGHT_MUTED, marginLeft: 8 }}>
              (you)
            </span>
          )}
        </div>
        <div style={{ fontSize: 12.5, color: LIGHT_MUTED }}>{member.email}</div>
      </div>

      {canManage ? (
        <div
          className="flex items-stretch overflow-hidden"
          style={{ border: "1px solid #e4e9f1", borderRadius: 8 }}
        >
          {(["member", "admin"] as const).map((r) => {
            const active =
              (r === "admin" && member.role === MemberRole.ADMIN) ||
              (r === "member" && member.role === MemberRole.EDITOR);
            return (
              <button
                key={r}
                type="button"
                onClick={() => !active && onRoleChange(r)}
                disabled={pending || active}
                style={{
                  padding: "6px 12px",
                  fontSize: 11.5,
                  fontWeight: 600,
                  background: active ? ACCENT_SOFT : "#fff",
                  color: active ? ACCENT : MUTED,
                  border: "none",
                  cursor: active ? "default" : "pointer",
                  fontFamily: "inherit",
                }}
              >
                {r === "member" ? "Editor" : "Admin"}
              </button>
            );
          })}
        </div>
      ) : (
        <span
          style={{
            fontFamily: "var(--font-revamp-mono)",
            fontSize: 10.5,
            letterSpacing: "0.1em",
            color: ACCENT,
            background: ACCENT_SOFT,
            padding: "4px 10px",
            borderRadius: 99,
            fontWeight: 600,
          }}
        >
          {ROLE_LABEL[member.role]}
        </span>
      )}

      {canTransferOwnership && (
        <button
          type="button"
          onClick={() => setConfirmTransfer(true)}
          disabled={pending}
          style={{
            background: "#fff",
            color: MUTED,
            border: "1px solid #d4dbe7",
            borderRadius: 8,
            padding: "6px 12px",
            fontSize: 12,
            fontWeight: 600,
            fontFamily: "inherit",
            cursor: pending ? "wait" : "pointer",
          }}
        >
          Make owner
        </button>
      )}

      {canManage && (
        <button
          type="button"
          onClick={() => setConfirmRemove(true)}
          disabled={pending}
          style={{
            background: "#fff",
            color: "#A02B1C",
            border: "1px solid #e4c5c5",
            borderRadius: 8,
            padding: "6px 12px",
            fontSize: 12,
            fontWeight: 600,
            fontFamily: "inherit",
            cursor: pending ? "wait" : "pointer",
          }}
        >
          Remove
        </button>
      )}

      {error && (
        <div
          className="basis-full"
          style={{ fontSize: 11.5, color: "#A06D12", textAlign: "right" }}
        >
          {error}
        </div>
      )}

      <Modal
        open={confirmRemove}
        onClose={() => (pending ? undefined : setConfirmRemove(false))}
        ariaLabel="Confirm remove"
      >
        <ModalHeader
          title={`Remove ${member.name ?? member.email}?`}
          description="They'll lose access to this workspace immediately. Their existing edits and approvals stay attributed to them."
          onClose={pending ? undefined : () => setConfirmRemove(false)}
        />
        <ModalBody>
          <p style={{ fontSize: 13, color: MUTED }}>
            You can re-invite them anytime from the invite row above.
          </p>
        </ModalBody>
        <ModalFooter>
          <button
            type="button"
            onClick={() => setConfirmRemove(false)}
            disabled={pending}
            style={{
              background: "#fff",
              color: MUTED,
              border: "1px solid #d4dbe7",
              borderRadius: 8,
              padding: "9px 16px",
              fontSize: 13,
              fontWeight: 600,
              cursor: pending ? "wait" : "pointer",
              fontFamily: "inherit",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onRemove}
            disabled={pending}
            style={{
              background: "#C0392B",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              padding: "9px 16px",
              fontSize: 13,
              fontWeight: 600,
              cursor: pending ? "wait" : "pointer",
              fontFamily: "inherit",
            }}
          >
            {pending ? "Removing…" : "Remove member"}
          </button>
        </ModalFooter>
      </Modal>

      <Modal
        open={confirmTransfer}
        onClose={() => (pending ? undefined : setConfirmTransfer(false))}
        ariaLabel="Confirm ownership transfer"
      >
        <ModalHeader
          title={`Transfer ownership to ${member.name ?? member.email}?`}
          description="They'll become Owner of this workspace. You'll be demoted to Admin in the same step."
          onClose={pending ? undefined : () => setConfirmTransfer(false)}
        />
        <ModalBody>
          <p style={{ fontSize: 13, color: MUTED }}>
            Only the Owner can manage billing and transfer ownership again. They can transfer it
            back to you any time.
          </p>
        </ModalBody>
        <ModalFooter>
          <button
            type="button"
            onClick={() => setConfirmTransfer(false)}
            disabled={pending}
            style={{
              background: "#fff",
              color: MUTED,
              border: "1px solid #d4dbe7",
              borderRadius: 8,
              padding: "9px 16px",
              fontSize: 13,
              fontWeight: 600,
              cursor: pending ? "wait" : "pointer",
              fontFamily: "inherit",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onTransferOwnership}
            disabled={pending}
            style={{
              background: ACCENT,
              color: "#fff",
              border: "none",
              borderRadius: 8,
              padding: "9px 16px",
              fontSize: 13,
              fontWeight: 600,
              cursor: pending ? "wait" : "pointer",
              fontFamily: "inherit",
            }}
          >
            {pending ? "Transferring…" : "Transfer ownership"}
          </button>
        </ModalFooter>
      </Modal>
    </div>
  );
}

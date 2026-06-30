"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Member } from "@prisma/client";
import { MemberRole } from "@/lib/enums";
import { Button } from "@/components/ui/button";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";
import {
  changeMemberRoleAction,
  removeMemberAction,
  transferOwnershipAction,
} from "@/app/(dashboard)/settings/team/actions";

const ROLE_LABEL: Record<MemberRole, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  EDITOR: "Editor",
  REVIEWER: "Reviewer",
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

  // Only OWNER/ADMIN can manage roles; you can't change your own role.
  const canManage =
    !isSelf &&
    (viewerRole === MemberRole.OWNER || viewerRole === MemberRole.ADMIN) &&
    member.role !== MemberRole.OWNER; // OWNER role is set out-of-band, not via this UI

  // Only the OWNER can transfer ownership, and only to an existing ADMIN.
  const canTransferOwnership =
    !isSelf && viewerRole === MemberRole.OWNER && member.role === MemberRole.ADMIN;

  const onRoleChange = (next: "admin" | "member") => {
    setError(null);
    startTransition(async () => {
      try {
        const result = await changeMemberRoleAction({
          memberId: member.id,
          role: next,
        });
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
    <div className="flex flex-wrap items-center gap-3 border-t border-[#F0F3F8] px-[6px] py-3 first:border-t-0">
      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md bg-[#2C4068] font-sans text-[12px] font-semibold text-[#CDD7E8]">
        {initialsOf(member.name, member.email)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-ink truncate font-sans text-[13.5px] font-medium">
          {member.name ?? member.email.split("@")[0]}
          {isSelf && <span className="text-muted-2 ml-2 text-[11.5px]">(you)</span>}
        </div>
        <div className="text-muted-2 truncate text-[11.5px]">{member.email}</div>
      </div>

      {canManage ? (
        <div className="border-border flex items-stretch overflow-hidden rounded-md border">
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
                className="px-[12px] py-[6px] font-sans text-[11.5px] font-semibold transition-colors disabled:cursor-default"
                style={{
                  background: active ? "var(--color-accent-soft)" : "#fff",
                  color: active ? "var(--color-accent)" : "var(--color-muted)",
                }}
              >
                {r === "member" ? "Editor" : "Admin"}
              </button>
            );
          })}
        </div>
      ) : (
        <span className="rounded-pill bg-canvas text-muted px-[9px] py-[3px] font-sans text-[11px] font-semibold uppercase">
          {ROLE_LABEL[member.role]}
        </span>
      )}

      {canTransferOwnership && (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setConfirmTransfer(true)}
          disabled={pending}
        >
          Make owner
        </Button>
      )}

      {canManage && (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setConfirmRemove(true)}
          disabled={pending}
          className="text-[#A06D12]"
        >
          Remove
        </Button>
      )}

      {error && <div className="basis-full text-right text-[11.5px] text-[#A06D12]">{error}</div>}

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
          <p className="text-muted text-[13px]">
            You can re-invite them anytime from the form below.
          </p>
        </ModalBody>
        <ModalFooter>
          <Button
            variant="secondary"
            type="button"
            onClick={() => setConfirmRemove(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={onRemove}
            disabled={pending}
            className="bg-[#C0392B] hover:!brightness-95"
          >
            {pending ? "Removing…" : "Remove member"}
          </Button>
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
          <p className="text-muted text-[13px]">
            Only the Owner can manage billing and transfer ownership again. They can transfer it
            back to you any time.
          </p>
        </ModalBody>
        <ModalFooter>
          <Button
            variant="secondary"
            type="button"
            onClick={() => setConfirmTransfer(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button type="button" onClick={onTransferOwnership} disabled={pending}>
            {pending ? "Transferring…" : "Transfer ownership"}
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}

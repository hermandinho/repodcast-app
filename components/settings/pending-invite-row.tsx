"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { MemberInvite } from "@prisma/client";
import { MemberRole } from "@/lib/enums";
import { Button } from "@/components/ui/button";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { revokeInviteAction } from "@/app/(dashboard)/settings/team/actions";

function relativeExpiry(expiresAt: Date): string {
  const ms = expiresAt.getTime() - Date.now();
  if (ms <= 0) return "expired";
  const days = Math.floor(ms / 86_400_000);
  if (days === 0) return "expires today";
  if (days === 1) return "expires tomorrow";
  return `expires in ${days} days`;
}

export function PendingInviteRow({ invite }: { invite: MemberInvite }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onRevoke = () => {
    setError(null);
    startTransition(async () => {
      try {
        const result = await revokeInviteAction({ inviteId: invite.id });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        router.refresh();
        setConfirmRevoke(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Revoke failed.");
      }
    });
  };

  const roleLabel = invite.role === MemberRole.ADMIN ? "Admin" : "Editor";

  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-[#F0F3F8] px-[6px] py-3 first:border-t-0">
      <div
        className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md font-sans text-[12px] font-semibold"
        style={{ background: "#EEF2FB", color: "#3A5BA0" }}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="2" y="3" width="10" height="8" rx="1.5" />
          <path d="M2 4.5L7 8l5-3.5" />
        </svg>
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-ink truncate font-sans text-[13.5px] font-medium">{invite.email}</div>
        <div className="text-muted-2 truncate text-[11.5px]">
          {roleLabel} · {relativeExpiry(invite.expiresAt)}
        </div>
      </div>

      <span
        className="rounded-pill px-[9px] py-[3px] font-sans text-[11px] font-semibold uppercase"
        style={{ background: "#FBF1DE", color: "#A06D12" }}
      >
        Pending
      </span>

      <Button
        variant="secondary"
        size="sm"
        onClick={() => setConfirmRevoke(true)}
        disabled={pending}
        className="text-[#A06D12]"
      >
        Revoke
      </Button>

      {error && <div className="basis-full text-right text-[11.5px] text-[#A06D12]">{error}</div>}

      <Modal
        open={confirmRevoke}
        onClose={() => (pending ? undefined : setConfirmRevoke(false))}
        ariaLabel="Confirm revoke"
      >
        <ModalHeader
          title={`Revoke invite to ${invite.email}?`}
          description="The link in their email will stop working. You can re-invite them any time."
          onClose={pending ? undefined : () => setConfirmRevoke(false)}
        />
        <ModalBody>
          <p className="text-muted text-[13px]">
            This doesn&apos;t notify them — if you want, drop them a line so they don&apos;t click a
            dead link later.
          </p>
        </ModalBody>
        <ModalFooter>
          <Button
            variant="secondary"
            type="button"
            onClick={() => setConfirmRevoke(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={onRevoke}
            disabled={pending}
            className="bg-[#C0392B] hover:!brightness-95"
          >
            {pending ? "Revoking…" : "Revoke invite"}
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}

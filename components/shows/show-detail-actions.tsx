"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { ShowFormModal } from "./show-form-modal";
import { deleteShowAction } from "@/app/(dashboard)/shows/actions";

export type ShowDetailActionsProps = {
  showId: string;
  initial: {
    name: string;
    host: string;
    description: string | null;
    artworkUrl: string | null;
    rssUrl: string | null;
    clientId: string;
    clientName: string;
  };
};

export function ShowDetailActions({ showId, initial }: ShowDetailActionsProps) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const onDelete = () => {
    setError(null);
    startTransition(async () => {
      try {
        const result = await deleteShowAction({ showId });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        router.push("/shows");
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Delete failed.");
      }
    });
  };

  return (
    <>
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setEditOpen(true)}
          leadingIcon={
            <svg
              width="13"
              height="13"
              viewBox="0 0 13 13"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 1.5l2.5 2.5L4.5 11l-3 .5.5-3z" />
            </svg>
          }
        >
          Edit
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setConfirmDelete(true)}
          className="text-[#A06D12]"
          leadingIcon={
            <svg
              width="13"
              height="13"
              viewBox="0 0 13 13"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M2 3.5h9M5 3.5V2.5h3v1M3 3.5l.5 7.5h6L10 3.5" />
            </svg>
          }
        >
          Delete
        </Button>
      </div>

      <ShowFormModal
        mode="edit"
        showId={showId}
        initial={initial}
        open={editOpen}
        onClose={() => setEditOpen(false)}
      />

      <Modal
        open={confirmDelete}
        onClose={() => (pending ? undefined : setConfirmDelete(false))}
        ariaLabel="Confirm delete"
      >
        <ModalHeader
          title="Delete this show?"
          description="This removes every episode, every generated output, every approved voice sample, and every per-platform instruction for this show. This action cannot be undone."
          onClose={pending ? undefined : () => setConfirmDelete(false)}
        />
        <ModalBody>
          <div className="rounded-md bg-[#FBF1DE] px-3 py-2 font-sans text-[12.5px] font-medium text-[#A06D12]">
            <strong>{initial.name}</strong> · all dependent records will cascade-delete.
          </div>
          {error && <div className="mt-3 text-[12.5px] text-[#A06D12]">{error}</div>}
        </ModalBody>
        <ModalFooter>
          <Button
            variant="secondary"
            type="button"
            onClick={() => setConfirmDelete(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={onDelete}
            disabled={pending}
            className="bg-[#C0392B] hover:!brightness-95"
          >
            {pending ? "Deleting…" : "Delete show"}
          </Button>
        </ModalFooter>
      </Modal>
    </>
  );
}

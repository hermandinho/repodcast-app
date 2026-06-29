"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ClientFormModal } from "./client-form-modal";

/**
 * Small client-only wrapper holding the modal open-state. Renders alongside
 * the page heading on the Clients list.
 */
export function NewClientButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        size="sm"
        onClick={() => setOpen(true)}
        leadingIcon={
          <svg
            width="13"
            height="13"
            viewBox="0 0 13 13"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <path d="M6.5 2.5v8M2.5 6.5h8" />
          </svg>
        }
      >
        New client
      </Button>
      <ClientFormModal mode="create" open={open} onClose={() => setOpen(false)} />
    </>
  );
}

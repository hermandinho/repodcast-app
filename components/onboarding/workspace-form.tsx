"use client";

import { useState } from "react";
import { createWorkspaceAction } from "@/app/onboarding/workspace/actions";
import { Input } from "@/components/ui/input";

export function WorkspaceForm({
  suggestedName,
  passthroughQs,
}: {
  suggestedName: string;
  passthroughQs?: string;
}) {
  const [name, setName] = useState(suggestedName);
  const disabled = name.trim().length === 0;

  return (
    <form action={createWorkspaceAction} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className="text-[12.5px] font-semibold text-[#5B6A85]">Workspace name</span>
        <Input
          name="agencyName"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your studio"
          required
          minLength={1}
          maxLength={120}
          autoFocus
        />
      </label>
      {passthroughQs ? <input type="hidden" name="passthroughQs" value={passthroughQs} /> : null}
      <button
        type="submit"
        disabled={disabled}
        className="mt-2 inline-flex items-center justify-center rounded-full bg-[#1A2A4A] px-5 py-2.5 text-[13.5px] font-semibold text-white transition-colors hover:bg-[#0F1D3B] disabled:cursor-not-allowed disabled:opacity-50"
      >
        Continue
      </button>
    </form>
  );
}

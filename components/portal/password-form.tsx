"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { submitPortalPasswordAction } from "@/app/portal/[token]/actions";

/**
 * Password gate rendered by `/portal/[token]/page.tsx` when the link
 * carries a shared password. Standalone client component so the
 * server page stays cache-friendly for the deliverables view — this
 * component owns the form state + submit transition.
 *
 * On success: fires `router.refresh()` so the page re-renders and picks
 * up the cookie the server action just set, revealing the deliverables.
 * On wrong password: displays inline error copy without re-navigating.
 */
export function PortalPasswordForm({
  token,
  agencyName,
  accentColor,
  brandLogoUrl,
}: {
  token: string;
  agencyName: string;
  accentColor: string;
  brandLogoUrl: string | null;
}) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = password.trim();
    if (trimmed.length === 0) {
      setError("Enter the password to continue.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await submitPortalPasswordAction({ token, password: trimmed });
      if (result.ok) {
        // Cookie is set — a refresh re-runs the server page with the
        // authorized cookie and the deliverables render.
        router.refresh();
        return;
      }
      if (result.reason === "wrong_password") {
        setError("That password doesn't match. Ask your agency contact if you're stuck.");
      } else if (result.reason === "invalid_token") {
        setError("This link is no longer valid. Ask your agency for a fresh one.");
      } else {
        setError("Something went wrong — try again.");
      }
    });
  };

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-[440px] items-center justify-center px-6 py-10">
      <form
        onSubmit={onSubmit}
        className="border-border bg-surface shadow-card w-full rounded-2xl border p-6"
      >
        <div className="mb-5 flex items-center gap-3">
          {brandLogoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={brandLogoUrl}
              alt={`${agencyName} logo`}
              className="h-10 w-10 flex-shrink-0 rounded-lg object-cover"
              style={{ background: "#EEF1F6" }}
            />
          ) : (
            <div
              className="font-display flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg text-[14px] font-semibold text-white"
              style={{ background: accentColor }}
            >
              {agencyName.slice(0, 2).toUpperCase()}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="text-muted-2 font-mono text-[10.5px] tracking-[0.06em] uppercase">
              {agencyName}
            </div>
            <div className="font-display text-ink mt-[2px] text-[16px] font-semibold tracking-[-0.005em]">
              Enter the password to view
            </div>
          </div>
        </div>
        <p className="text-muted mb-4 text-[12.5px] leading-[1.55]">
          Your agency sent this link with a password. Paste it below to see your deliverables.
        </p>
        <label className="text-muted-2 mb-1 block font-mono text-[10.5px] tracking-[0.06em] uppercase">
          Password
        </label>
        <input
          type="password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            if (error) setError(null);
          }}
          disabled={pending}
          autoFocus
          className="w-full rounded-md border border-[#E4E8F0] bg-white px-3 py-2 font-sans text-[13px] text-[#1A2A4A] outline-none focus:border-[#3A5BA0] disabled:opacity-60"
        />
        {error ? (
          <div className="mt-2 text-[12px] leading-[1.5] text-[#A03030]">{error}</div>
        ) : null}
        <button
          type="submit"
          disabled={pending}
          className="mt-4 w-full rounded-md px-4 py-[10px] font-sans text-[13px] font-semibold text-white transition-[filter] hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
          style={{ background: accentColor }}
        >
          {pending ? "Checking…" : "Continue"}
        </button>
      </form>
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PlanLimitBanner, type PlanLimitCapacity } from "@/components/billing/plan-limit-banner";
import { inviteMemberAction } from "@/app/(dashboard)/settings/team/actions";

export function InviteMemberForm({
  seatsRemaining,
  capacity = null,
}: {
  seatsRemaining: number;
  /** Current seats vs cap; nulled in sample-data mode. Powers the soft banner. */
  capacity?: PlanLimitCapacity | null;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const blocked = seatsRemaining <= 0;

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSentTo(null);
    const trimmed = email.trim();
    if (!trimmed) {
      setError("Enter an email address.");
      return;
    }
    startTransition(async () => {
      try {
        const result = await inviteMemberAction({ email: trimmed, role });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setSentTo(result.data.email);
        setEmail("");
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Invite failed.");
      }
    });
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <PlanLimitBanner capacity={capacity} />
      <div className="flex flex-col gap-3 sm:flex-row">
        <Input
          type="email"
          placeholder="teammate@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={blocked || pending}
        />
        <div className="border-border bg-surface flex items-stretch overflow-hidden rounded-[10px] border">
          {(["member", "admin"] as const).map((r) => {
            const active = role === r;
            return (
              <button
                key={r}
                type="button"
                onClick={() => setRole(r)}
                disabled={blocked || pending}
                className="px-[14px] py-[10px] font-sans text-[12.5px] font-semibold transition-colors disabled:cursor-not-allowed"
                style={{
                  background: active ? "var(--color-accent-soft)" : "transparent",
                  color: active ? "var(--color-accent)" : "var(--color-muted)",
                }}
              >
                {r === "member" ? "Editor" : "Admin"}
              </button>
            );
          })}
        </div>
        <Button type="submit" disabled={blocked || pending}>
          {pending ? "Sending…" : "Send invite"}
        </Button>
      </div>

      {blocked && (
        <div className="rounded-md bg-[#FBF1DE] px-3 py-2 font-sans text-[12.5px] font-medium text-[#A06D12]">
          You&apos;ve hit your seat limit on this plan. Upgrade in Billing to invite more teammates.
        </div>
      )}
      {error && <div className="text-[12.5px] text-[#A06D12]">{error}</div>}
      {sentTo && (
        <div className="text-[12.5px] text-[#1E7A47]">
          Invite sent to <strong>{sentTo}</strong>.
        </div>
      )}
    </form>
  );
}

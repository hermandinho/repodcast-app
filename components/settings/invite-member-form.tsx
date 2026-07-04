"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PlanLimitBanner, type PlanLimitCapacity } from "@/components/billing/plan-limit-banner";
import { inviteMemberAction } from "@/app/(dashboard)/settings/team/actions";

const INK = "#0a1e3c";
const MUTED = "#41506b";
const LIGHT_MUTED = "#8a97ad";
const OUTLINE_STRONG = "#d4dbe7";
const ACCENT = "#3A5BA0";
const PANEL_BG = "#eef1f6";

/**
 * Invite-member row rendered inside the Members card. Layout mirrors the
 * ref (email input + Editor/Admin toggle + Send invite button, all in one
 * horizontal band). The plan-limit banner still lives at the top; a hit-
 * limit state disables the whole row and shows the amber upgrade nudge.
 */
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
    <form onSubmit={onSubmit} className="flex flex-col" style={{ gap: 10 }}>
      <PlanLimitBanner capacity={capacity} />
      <div className="flex flex-wrap items-center" style={{ gap: 10 }}>
        <input
          type="email"
          placeholder="teammate@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={blocked || pending}
          aria-label="Teammate email"
          style={{
            flex: 1,
            minWidth: 200,
            border: `1px solid ${OUTLINE_STRONG}`,
            borderRadius: 8,
            padding: "10px 14px",
            fontSize: 14,
            color: INK,
            background: "#fff",
            fontFamily: "inherit",
            outline: "none",
          }}
        />
        <div
          className="flex"
          style={{
            background: PANEL_BG,
            borderRadius: 8,
            padding: 3,
            gap: 2,
          }}
        >
          {(["member", "admin"] as const).map((r) => {
            const active = role === r;
            return (
              <button
                key={r}
                type="button"
                onClick={() => setRole(r)}
                disabled={blocked || pending}
                style={{
                  padding: "7px 14px",
                  fontSize: 12.5,
                  fontWeight: active ? 600 : 500,
                  color: active ? INK : MUTED,
                  background: active ? "#fff" : "transparent",
                  border: "none",
                  borderRadius: 6,
                  boxShadow: active ? "0 1px 3px rgba(10,30,60,0.10)" : "none",
                  cursor: blocked || pending ? "not-allowed" : "pointer",
                  fontFamily: "inherit",
                }}
              >
                {r === "member" ? "Editor" : "Admin"}
              </button>
            );
          })}
        </div>
        <button
          type="submit"
          disabled={blocked || pending}
          style={{
            background: blocked ? "#f6f8fc" : ACCENT,
            color: blocked ? LIGHT_MUTED : "#fff",
            border: blocked ? "1px solid #e4e9f1" : "none",
            borderRadius: 8,
            padding: "10px 18px",
            fontSize: 13.5,
            fontWeight: 600,
            cursor: blocked || pending ? "not-allowed" : "pointer",
            fontFamily: "inherit",
          }}
        >
          {pending ? "Sending…" : "Send invite"}
        </button>
      </div>

      {blocked && (
        <div
          style={{
            background: "#FBF1DE",
            color: "#A06D12",
            padding: "8px 12px",
            borderRadius: 6,
            fontSize: 12.5,
            fontWeight: 500,
          }}
        >
          You&apos;ve hit your seat limit on this plan. Upgrade in Billing to invite more teammates.
        </div>
      )}
      {error && <div style={{ fontSize: 12.5, color: "#A06D12" }}>{error}</div>}
      {sentTo && (
        <div style={{ fontSize: 12.5, color: "#1E7A47" }}>
          Invite sent to <strong>{sentTo}</strong>.
        </div>
      )}
    </form>
  );
}

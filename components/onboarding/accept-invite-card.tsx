"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { acceptInviteAction } from "@/app/invite/[token]/actions";

type InviteViewState =
  | { kind: "valid"; agencyName: string; roleLabel: string; email: string }
  | { kind: "expired" }
  | { kind: "revoked" }
  | { kind: "already-accepted" }
  | { kind: "not-found" };

export function AcceptInviteCard({
  state,
  token,
  signedInEmail,
  autoAccept,
}: {
  state: InviteViewState;
  token: string;
  signedInEmail: string | null;
  autoAccept: boolean;
}) {
  const router = useRouter();
  const [accepting, startAccept] = useTransition();
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runAccept = () => {
    setError(null);
    startAccept(async () => {
      try {
        const result = await acceptInviteAction({ token });
        if (!result.ok) {
          setError(errorCopyFor(result.reason));
          return;
        }
        setAccepted(true);
        router.push("/dashboard");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't accept invite.");
      }
    });
  };

  // Auto-accept when the visitor is already signed in with the matching
  // email — saves a click and keeps the path predictable. The Next 16
  // set-state-in-effect rule flags `runAccept` (which schedules state
  // updates via `startTransition`), but synchronising "subscribe to a
  // boolean prop, then fire a server action" is the legitimate use case
  // the rule explicitly allows in its docs.
  useEffect(() => {
    if (autoAccept && !accepting && !accepted) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      runAccept();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoAccept]);

  return (
    <>
      <BrandHeader />
      <Card>{renderBody()}</Card>
      <p className="mt-6 text-center font-sans text-[12px]" style={{ color: "#8B95A6" }}>
        Repodcast — Voice-true content for podcast agencies
      </p>
    </>
  );

  function renderBody() {
    if (state.kind === "not-found") {
      return (
        <StatusBlock
          tone="warn"
          title="Invite not found"
          body="This invite link doesn't match anything we have. It may have been mistyped, or the invite was deleted."
        />
      );
    }
    if (state.kind === "expired") {
      return (
        <StatusBlock
          tone="warn"
          title="Invite expired"
          body="Invitations last 14 days. Ask the admin who sent it to issue a fresh one."
        />
      );
    }
    if (state.kind === "revoked") {
      return (
        <StatusBlock
          tone="warn"
          title="Invite revoked"
          body="This invite was revoked by an admin. Reach out if you think that was a mistake."
        />
      );
    }
    if (state.kind === "already-accepted") {
      return (
        <StatusBlock
          tone="success"
          title="Already accepted"
          body="This invite has been used. Sign in to reach the workspace."
          actionLabel="Sign in"
          onAction={() => router.push("/sign-in")}
        />
      );
    }

    // state.kind === "valid"
    const mismatch =
      signedInEmail !== null && signedInEmail.toLowerCase() !== state.email.toLowerCase();

    if (!signedInEmail) {
      const signUpHref = `/sign-up?redirect_url=${encodeURIComponent(`/invite/${token}`)}`;
      const signInHref = `/sign-in?redirect_url=${encodeURIComponent(`/invite/${token}`)}`;
      return (
        <>
          <Banner
            kicker="You're invited"
            title={`Join ${state.agencyName}`}
            sub={`as ${state.roleLabel.toLowerCase()}, for ${state.email}`}
          />
          <p className="mb-6 font-sans text-[13.5px] leading-[1.6]" style={{ color: "#5A6473" }}>
            Sign up or sign in with <strong>{state.email}</strong> and we&apos;ll drop you straight
            into the {state.agencyName} workspace.
          </p>
          <div className="flex flex-col gap-2">
            <SolidCTA
              label="Create account"
              disabled={false}
              onClick={() => router.push(signUpHref)}
            />
            <OutlineCTA
              label="I already have an account"
              disabled={false}
              onClick={() => router.push(signInHref)}
            />
          </div>
        </>
      );
    }

    if (mismatch) {
      return (
        <>
          <Banner
            kicker="Email mismatch"
            title={`This invite is for ${state.email}`}
            sub={`You're signed in as ${signedInEmail}`}
          />
          <p className="mb-6 font-sans text-[13.5px] leading-[1.6]" style={{ color: "#5A6473" }}>
            Switch accounts to {state.email} to accept this invite — or ask the admin to re-issue it
            for {signedInEmail}.
          </p>
          <div className="flex flex-col gap-2">
            <SolidCTA
              label="Sign out and switch"
              disabled={false}
              onClick={() => router.push("/sign-out")}
            />
          </div>
          {error && <ErrorBanner error={error} />}
        </>
      );
    }

    // Signed in with the matching email — auto-accept already kicked off,
    // but render a "Joining…" body so the page isn't blank.
    return (
      <>
        <Banner
          kicker="Welcome"
          title={`Joining ${state.agencyName}`}
          sub={`as ${state.roleLabel.toLowerCase()}`}
        />
        <p className="mb-6 font-sans text-[13.5px] leading-[1.6]" style={{ color: "#5A6473" }}>
          Hooking up your access now. This usually takes about a second.
        </p>
        <SolidCTA
          label={
            accepting
              ? "Joining…"
              : accepted
                ? "✓ Joined — taking you in"
                : `Join ${state.agencyName}`
          }
          disabled={accepting || accepted}
          onClick={runAccept}
        />
        {error && <ErrorBanner error={error} />}
      </>
    );
  }
}

/* ============================================================
   Visual primitives
   ============================================================ */

function BrandHeader() {
  return (
    <div className="mb-8 flex items-center gap-3">
      <div
        className="font-display flex h-9 w-9 items-center justify-center rounded-[10px] text-[14px] font-bold text-white"
        style={{
          background: "#1A2A4A",
          boxShadow: "0 4px 12px rgba(26,42,74,0.18)",
        }}
      >
        R
      </div>
      <div>
        <div
          className="font-display text-[16px] leading-tight font-semibold tracking-[-0.2px]"
          style={{ color: "#1A2A4A" }}
        >
          Repodcast
        </div>
        <div className="text-[11.5px]" style={{ color: "#8B95A6" }}>
          Team invitation
        </div>
      </div>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="rounded-3xl p-7 sm:p-8"
      style={{
        background: "#FFFFFF",
        border: "1px solid #E6EBF3",
        boxShadow: "0 1px 2px rgba(26,42,74,0.06), 0 24px 60px -24px rgba(26,42,74,0.18)",
      }}
    >
      {children}
    </div>
  );
}

function Banner({ kicker, title, sub }: { kicker: string; title: string; sub?: string }) {
  return (
    <header className="mb-6">
      <div
        className="mb-2 font-sans text-[12px] font-semibold tracking-[0.08em] uppercase"
        style={{ color: "#3A5BA0" }}
      >
        {kicker}
      </div>
      <h1
        className="font-display text-[26px] leading-[1.2] font-semibold tracking-[-0.4px]"
        style={{ color: "#1A2A4A" }}
      >
        {title}
      </h1>
      {sub && (
        <p className="mt-2 text-[14px] leading-[1.55]" style={{ color: "#5A6473" }}>
          {sub}
        </p>
      )}
    </header>
  );
}

function StatusBlock({
  tone,
  title,
  body,
  actionLabel,
  onAction,
}: {
  tone: "warn" | "success";
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const palette =
    tone === "warn"
      ? { bg: "#FBF1DE", text: "#A06D12", border: "#E6D9B8" }
      : { bg: "#E7F4EC", text: "#1E7A47", border: "#BFE3CD" };
  return (
    <>
      <div
        className="mb-5 inline-flex items-center gap-[6px] rounded-full px-3 py-[5px] text-[11.5px] font-semibold"
        style={{
          background: palette.bg,
          color: palette.text,
          border: `1px solid ${palette.border}`,
        }}
      >
        {tone === "warn" ? "Heads up" : "All set"}
      </div>
      <h1
        className="font-display text-[24px] leading-[1.2] font-semibold tracking-[-0.4px]"
        style={{ color: "#1A2A4A" }}
      >
        {title}
      </h1>
      <p className="mt-3 font-sans text-[13.5px] leading-[1.6]" style={{ color: "#5A6473" }}>
        {body}
      </p>
      {actionLabel && onAction && (
        <div className="mt-6">
          <SolidCTA label={actionLabel} disabled={false} onClick={onAction} />
        </div>
      )}
    </>
  );
}

/**
 * Inline-styled CTAs — same defensive approach as the onboarding wizard so
 * the buttons render even if Tailwind's @theme tokens aren't picked up
 * from a stale dev cache.
 */
function SolidCTA({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="group flex w-full items-center justify-center gap-[10px] rounded-[12px] font-sans font-semibold transition-all"
      style={{
        background: disabled ? "#C3CBD8" : "linear-gradient(135deg, #3A5BA0 0%, #2A4680 100%)",
        color: "#FFFFFF",
        fontSize: "15px",
        padding: "14px 22px",
        border: "1px solid rgba(0,0,0,0.08)",
        boxShadow: disabled
          ? "none"
          : "0 8px 20px rgba(58,91,160,0.32), inset 0 1px 0 rgba(255,255,255,0.15)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.7 : 1,
      }}
    >
      <span>{label}</span>
    </button>
  );
}

function OutlineCTA({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center justify-center gap-[8px] rounded-[12px] font-sans font-semibold transition-all"
      style={{
        background: "#FFFFFF",
        color: "#3A5BA0",
        fontSize: "14px",
        padding: "12px 22px",
        border: "1.5px solid #DDE5F4",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <span>{label}</span>
    </button>
  );
}

function ErrorBanner({ error }: { error: string }) {
  return (
    <div
      className="mt-5 flex items-start gap-2 rounded-[10px] px-3 py-[10px] text-[12.5px]"
      style={{
        background: "#FBF1DE",
        border: "1px solid #E6D9B8",
        color: "#A06D12",
      }}
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
        className="mt-[1px] flex-shrink-0"
      >
        <circle cx="7" cy="7" r="5.5" />
        <path d="M7 4.5v3M7 9.5v.01" />
      </svg>
      <span>{error}</span>
    </div>
  );
}

function errorCopyFor(
  reason:
    | "not-signed-in"
    | "not-found"
    | "expired"
    | "revoked"
    | "already-accepted"
    | "email-mismatch"
    | "not-configured",
): string {
  switch (reason) {
    case "not-signed-in":
      return "You need to be signed in to accept this invite.";
    case "not-found":
      return "This invite link is invalid.";
    case "expired":
      return "This invite has expired. Ask the admin who sent it for a fresh one.";
    case "revoked":
      return "This invite was revoked by an admin.";
    case "already-accepted":
      return "This invite was already used. Sign in to reach the workspace.";
    case "email-mismatch":
      return "This invite is for a different email. Switch accounts and try again.";
    case "not-configured":
      return "Workspace is in demo mode right now.";
  }
}

"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import type { Plan } from "@prisma/client";
import { Button } from "@/components/ui/button";
import {
  mintPortalLinkAction,
  revokePortalLinkAction,
} from "@/app/(dashboard)/clients/[key]/billing/portal-actions";

const PORTAL_MIN_PLAN: Plan = "AGENCY";

const DATE_FMT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

const EXPIRY_OPTIONS = [
  { value: 7, label: "7 days" },
  { value: 30, label: "30 days" },
  { value: 90, label: "90 days" },
] as const;

export type PortalLinkRow = {
  id: string;
  token: string;
  expiresAtIso: string;
  revokedAtIso: string | null;
  lastAccessedAtIso: string | null;
  createdByName: string | null;
};

/**
 * Mint / revoke client portal links on the billing tab.
 *
 * Lists every link minted for the client, newest first. Each row carries
 * a "Copy URL" affordance + a "Revoke" button (active links only).
 * Revoked rows render as muted with the revocation date so the operator
 * can see the history.
 *
 * `canManage` gates the create form + the revoke button — viewers (READ
 * roles below OWNER/ADMIN) see the list but can't edit it.
 */
export function PortalLinksCard({
  clientId,
  initialLinks,
  baseUrl,
  canManage,
  plan,
}: {
  clientId: string;
  initialLinks: PortalLinkRow[];
  /** Public origin used to compose the share URL (e.g. https://repodcastapp.com). */
  baseUrl: string;
  canManage: boolean;
  /** Effective agency plan. `null` in sample-data mode → treat as unlocked. */
  plan: Plan | null;
}) {
  // Client portals unlock at AGENCY (see PORTAL_MIN_PLAN + the
  // `createPortalLink` gate in `server/db/client-portal.ts`). Solo and
  // Studio agencies see an inline upsell instead of a mint form whose
  // submit would just throw. Existing links stay visible + revocable so
  // a downgrade doesn't strand deliverables the client already has a
  // URL for.
  const planUnlocksMint = plan === null || plan === "AGENCY" || plan === "NETWORK";
  const [links, setLinks] = useState<PortalLinkRow[]>(initialLinks);
  const [expiresInDays, setExpiresInDays] = useState<number>(30);
  const [passwordEnabled, setPasswordEnabled] = useState(false);
  const [password, setPassword] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  // Captured once at mount via `useState`'s initializer (the React-sanctioned
  // way to call impure functions in a render-pure component). Used to flag
  // already-expired links in the list. Any state change re-renders and the
  // expiry status stays accurate enough at human time scales.
  const [mountedAtMs] = useState<number>(() => Date.now());

  const onMint = () => {
    if (!canManage) return;
    if (passwordEnabled && password.trim().length === 0) {
      setError("Enter a password or turn off password protection.");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const result = await mintPortalLinkAction({
          clientId,
          expiresInDays,
          password: passwordEnabled ? password.trim() : undefined,
        });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        // Optimistically prepend the new row so the operator sees it
        // immediately; the server revalidates the route so the next nav
        // pulls the canonical list.
        setLinks((prev) => [
          {
            id: `optimistic_${result.data.token}`,
            token: result.data.token,
            expiresAtIso: result.data.expiresAtIso,
            revokedAtIso: null,
            lastAccessedAtIso: null,
            createdByName: null,
          },
          ...prev,
        ]);
        // Reset the password inputs so a second mint doesn't reuse the
        // last shared secret unless the operator opts in again.
        setPassword("");
        setPasswordEnabled(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't mint link.");
      }
    });
  };

  const onRevoke = (linkId: string) => {
    if (!canManage) return;
    if (!confirm("Revoke this link? Anyone holding the URL will see a 404.")) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await revokePortalLinkAction({ linkId, clientId });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        // Reflect locally — server-side revalidate fires too.
        setLinks((prev) =>
          prev.map((l) => (l.id === linkId ? { ...l, revokedAtIso: new Date().toISOString() } : l)),
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't revoke link.");
      }
    });
  };

  const onCopy = async (token: string) => {
    const url = `${baseUrl}/portal/${token}`;
    try {
      await navigator.clipboard?.writeText(url);
      setCopied(token);
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      setError("Couldn't copy — try selecting the URL manually.");
    }
  };

  return (
    <section className="border-border bg-surface rounded-3xl border p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <div className="font-display text-ink text-[15px] font-semibold">Client portal</div>
          <div className="text-muted-2 mt-[3px] text-[12.5px]">
            Mint a tokenized read-only URL so this client can see approved deliverables. No login
            required for them.
          </div>
        </div>
      </div>

      {canManage && planUnlocksMint && (
        <div className="border-border bg-canvas mb-4 flex flex-col gap-3 rounded-2xl border border-dashed p-3">
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-muted-2 font-sans text-[12px] font-semibold">Expires in</label>
            <select
              value={expiresInDays}
              onChange={(e) => setExpiresInDays(Number(e.target.value))}
              disabled={pending}
              className="rounded-md px-3 py-[7px] font-sans text-[12.5px] text-[#2A3550] outline-none"
              style={{ border: "1px solid #C9D4E8", background: "#fff" }}
            >
              {EXPIRY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <label className="text-muted-2 inline-flex cursor-pointer items-center gap-[6px] font-sans text-[12px] font-semibold select-none">
              <input
                type="checkbox"
                checked={passwordEnabled}
                onChange={(e) => {
                  setPasswordEnabled(e.target.checked);
                  if (!e.target.checked) setPassword("");
                  if (error) setError(null);
                }}
                disabled={pending}
                className="h-[14px] w-[14px] rounded accent-[var(--color-accent)]"
              />
              Protect with password
            </label>
            <Button onClick={onMint} disabled={pending} size="sm">
              {pending ? "Minting…" : "Mint new link"}
            </Button>
            {error && <span className="text-[12px] text-[#A06D12]">{error}</span>}
          </div>
          {passwordEnabled && (
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (error) setError(null);
                }}
                disabled={pending}
                maxLength={200}
                autoComplete="off"
                placeholder="Shared password for this link"
                className="min-w-[240px] flex-1 rounded-md px-3 py-[7px] font-sans text-[12.5px] text-[#2A3550] outline-none focus:border-[#3A5BA0]"
                style={{ border: "1px solid #C9D4E8", background: "#fff" }}
              />
              <span className="text-muted-2 text-[11px] leading-[1.4]">
                Emailed to the client along with the URL. Stored plaintext — think of it as a shared
                secret, not a login.
              </span>
            </div>
          )}
        </div>
      )}

      {canManage && !planUnlocksMint && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#E6D9B8] bg-[#FBF1DE] p-3">
          <div className="min-w-0 text-[12.5px] text-[#7A5410]">
            <span className="font-semibold">
              Client portals unlock on the {PORTAL_MIN_PLAN} plan.
            </span>{" "}
            Upgrade to mint tokenized share links for this client.
          </div>
          <Link
            href="/settings/billing"
            className="rounded-md border border-[#E6D9B8] bg-white px-3 py-[6px] font-sans text-[12px] font-semibold text-[#A06D12] hover:bg-[#FBF1DE]"
          >
            Upgrade
          </Link>
        </div>
      )}

      {links.length === 0 ? (
        <div className="border-border bg-canvas text-muted-2 rounded-2xl border border-dashed px-4 py-6 text-center text-[12.5px]">
          {canManage
            ? "No portal links yet — mint one to share with this client."
            : "No portal links yet."}
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {links.map((link) => {
            const expired = new Date(link.expiresAtIso).getTime() <= mountedAtMs;
            const revoked = link.revokedAtIso !== null;
            const inactive = expired || revoked;
            const url = `${baseUrl}/portal/${link.token}`;
            return (
              <li
                key={link.id}
                className="border-border bg-surface shadow-card flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-[12px]"
                style={{ opacity: inactive ? 0.6 : 1 }}
              >
                <div className="min-w-0 flex-1">
                  <code className="bg-canvas block max-w-full overflow-hidden rounded px-2 py-[2px] font-mono text-[11.5px] text-ellipsis whitespace-nowrap text-[#2A3550]">
                    {url}
                  </code>
                  <div className="text-muted-2 mt-1 text-[11.5px]">
                    {revoked
                      ? `Revoked ${DATE_FMT.format(new Date(link.revokedAtIso!))}`
                      : expired
                        ? `Expired ${DATE_FMT.format(new Date(link.expiresAtIso))}`
                        : `Expires ${DATE_FMT.format(new Date(link.expiresAtIso))}`}
                    {link.lastAccessedAtIso && !revoked && (
                      <>
                        {" · last viewed "}
                        {DATE_FMT.format(new Date(link.lastAccessedAtIso))}
                      </>
                    )}
                    {link.createdByName && <> · minted by {link.createdByName}</>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onCopy(link.token)}
                    disabled={inactive}
                    className="text-muted hover:bg-canvas hover:text-ink rounded-md px-3 py-[6px] font-sans text-[12px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {copied === link.token ? "Copied" : "Copy URL"}
                  </button>
                  {canManage && !revoked && (
                    <button
                      type="button"
                      onClick={() => onRevoke(link.id)}
                      disabled={pending}
                      className="rounded-md border border-[#E6D9B8] bg-white px-3 py-[6px] font-sans text-[12px] font-semibold text-[#A06D12] hover:bg-[#FBF1DE] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Revoke
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  mintPortalLinkAction,
  revokePortalLinkAction,
} from "@/app/(dashboard)/clients/[key]/billing/portal-actions";

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
 * Phase 2.5 — mint / revoke client portal links on the billing tab.
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
}: {
  clientId: string;
  initialLinks: PortalLinkRow[];
  /** Public origin used to compose the share URL (e.g. https://app.repodcast.com). */
  baseUrl: string;
  canManage: boolean;
}) {
  const [links, setLinks] = useState<PortalLinkRow[]>(initialLinks);
  const [expiresInDays, setExpiresInDays] = useState<number>(30);
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
    setError(null);
    startTransition(async () => {
      try {
        const result = await mintPortalLinkAction({ clientId, expiresInDays });
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

      {canManage && (
        <div className="border-border bg-canvas mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-dashed p-3">
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
          <Button onClick={onMint} disabled={pending} size="sm">
            {pending ? "Minting…" : "Mint new link"}
          </Button>
          {error && <span className="text-[12px] text-[#A06D12]">{error}</span>}
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

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Platform } from "@prisma/client";
import type { IntegrationSummary } from "@/server/db/integrations";

const PLATFORM_LABELS: Partial<Record<Platform, string>> = {
  TWITTER: "Twitter / X",
  LINKEDIN: "LinkedIn",
  INSTAGRAM: "Instagram",
  TIKTOK: "TikTok",
};

export function BufferIntegrationCard({
  integration,
  canManage,
}: {
  integration: IntegrationSummary | null;
  canManage: boolean;
}) {
  const router = useRouter();
  const [disconnectConfirm, setDisconnectConfirm] = useState("");
  const [pending, startTransition] = useTransition();
  const [refreshing, startRefresh] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [refreshOk, setRefreshOk] = useState<string | null>(null);

  const onDisconnect = () => {
    if (disconnectConfirm !== "disconnect") {
      setError('Type "disconnect" to confirm.');
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/integrations/buffer/disconnect", { method: "POST" });
        if (!res.ok) {
          const body = await res.text();
          throw new Error(body || `Disconnect failed (${res.status})`);
        }
        router.push("/settings/integrations?buffer=disconnected");
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Disconnect failed.");
      }
    });
  };

  const onRefresh = () => {
    setError(null);
    setRefreshOk(null);
    startRefresh(async () => {
      try {
        const res = await fetch("/api/integrations/buffer/refresh", { method: "POST" });
        const body = (await res.json()) as {
          ok: boolean;
          error?: string;
          organizationCount?: number;
          channelCount?: number;
        };
        if (!res.ok || !body.ok) {
          throw new Error(body.error ?? `Refresh failed (${res.status})`);
        }
        setRefreshOk(
          `Synced ${body.channelCount ?? 0} channel${
            (body.channelCount ?? 0) === 1 ? "" : "s"
          } across ${body.organizationCount ?? 0} organization${
            (body.organizationCount ?? 0) === 1 ? "" : "s"
          }.`,
        );
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Refresh failed.");
      }
    });
  };

  return (
    <div className="border-border bg-surface shadow-card rounded-3xl border p-6">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <div className="text-muted-2 font-sans text-[11.5px] font-semibold tracking-[0.06em] uppercase">
            Scheduling
          </div>
          <div className="font-display text-ink mt-1 text-[18px] font-semibold">Buffer</div>
          <p className="text-muted mt-1 max-w-[640px] text-[12.5px] leading-[1.55]">
            Connect your agency&apos;s Buffer account to schedule approved posts to Twitter,
            LinkedIn, Instagram, and TikTok. Non-social outputs (show notes, blog, newsletter) stay
            manual regardless — Buffer doesn&apos;t publish to those.
          </p>
        </div>
        {integration ? (
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-800">
            Connected
          </span>
        ) : (
          <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-[11px] font-semibold text-zinc-600">
            Not connected
          </span>
        )}
      </div>

      {integration ? (
        <>
          <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2">
            <InfoRow
              label="Connected by"
              value={
                integration.connectedByName ??
                integration.connectedByEmail ??
                "(member no longer in agency)"
              }
            />
            <InfoRow
              label="Connected on"
              value={integration.createdAt.toISOString().slice(0, 10)}
            />
            <InfoRow
              label="Last sync"
              value={
                integration.lastSyncedAt
                  ? integration.lastSyncedAt.toISOString().slice(0, 16).replace("T", " ") + " UTC"
                  : "never"
              }
            />
            <InfoRow
              label="Auto mark published"
              value={integration.autoMarkPublished ? "on" : "off"}
            />
          </div>

          <div className="mt-5">
            <div className="flex items-center justify-between">
              <div className="text-muted-2 font-sans text-[11.5px] font-semibold tracking-[0.06em] uppercase">
                Connected profiles
              </div>
              {canManage ? (
                <button
                  type="button"
                  onClick={onRefresh}
                  disabled={refreshing}
                  className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-[11.5px] font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
                  title="Re-enumerate channels + organizations from Buffer. Use this after adding a new social channel in Buffer."
                >
                  {refreshing ? "Refreshing…" : "Refresh channels"}
                </button>
              ) : null}
            </div>
            <ul className="mt-2 flex flex-wrap gap-2">
              {(Object.keys(PLATFORM_LABELS) as Platform[]).map((p) => {
                const has = integration.meta?.profiles?.[p];
                return (
                  <li
                    key={p}
                    className={`rounded-full border px-2.5 py-1 text-[11.5px] font-medium ${
                      has
                        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                        : "border-zinc-200 bg-zinc-50 text-zinc-500"
                    }`}
                  >
                    {PLATFORM_LABELS[p]} {has ? "✓" : "—"}
                  </li>
                );
              })}
            </ul>
            {refreshOk ? (
              <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11.5px] text-emerald-900">
                {refreshOk}
              </div>
            ) : null}
          </div>

          {integration.lastSyncError ? (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
              Last sync error: {integration.lastSyncError}
            </div>
          ) : null}

          {canManage ? (
            <div className="border-border mt-6 border-t pt-5">
              <div className="text-muted-2 font-sans text-[11.5px] font-semibold tracking-[0.06em] uppercase">
                Disconnect
              </div>
              <p className="text-muted mt-1 text-[12.5px] leading-[1.55]">
                Type <code className="font-mono text-[11.5px]">disconnect</code> to confirm.
                Anything still SCHEDULED on Buffer gets downgraded to manual — the posts don&apos;t
                disappear from Buffer, we just stop syncing.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <input
                  value={disconnectConfirm}
                  onChange={(e) => setDisconnectConfirm(e.target.value)}
                  placeholder="disconnect"
                  className="border-border rounded-xl border bg-white px-3 py-2 text-[13px] outline-none"
                />
                <button
                  type="button"
                  onClick={onDisconnect}
                  disabled={pending}
                  className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] font-semibold text-red-800 hover:bg-red-100 disabled:opacity-50"
                >
                  {pending ? "Disconnecting…" : "Disconnect Buffer"}
                </button>
              </div>
              {error ? <div className="mt-2 text-[12px] text-red-700">{error}</div> : null}
            </div>
          ) : null}
        </>
      ) : (
        <div className="mt-2">
          {canManage ? (
            <a
              href="/api/integrations/buffer/connect"
              className="bg-accent inline-flex items-center gap-2 rounded-xl px-4 py-2 font-sans text-[13px] font-semibold text-white transition-[filter] hover:brightness-95"
            >
              Connect Buffer →
            </a>
          ) : (
            <div className="text-muted text-[12.5px]">
              Ask an OWNER or ADMIN to connect Buffer for this agency.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-muted-2 font-sans text-[11px] tracking-[0.04em] uppercase">{label}</div>
      <div className="text-ink mt-0.5 text-[13px]">{value}</div>
    </div>
  );
}

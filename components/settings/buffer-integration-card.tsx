"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Platform } from "@prisma/client";
import type { IntegrationSummary } from "@/server/db/integrations";

const INK = "#0a1e3c";
const MUTED = "#41506b";
const LIGHT_MUTED = "#8a97ad";
const CARD_BORDER = "#e4e9f1";
const ROW_BORDER = "#eef1f6";
const ACCENT = "#3A5BA0";
const ACCENT_SOFT = "#eef2fb";

const PLATFORM_LABELS: Partial<Record<Platform, string>> = {
  TWITTER: "Twitter / X",
  LINKEDIN: "LinkedIn",
  INSTAGRAM: "Instagram",
  TIKTOK: "TikTok",
};

/**
 * Settings · Integrations — Buffer card (revamp visual system).
 *
 * Layout mirrors the ref (2c): left cluster carries an ink icon tile,
 * title + SCHEDULING pill, description, and coverage chips for the four
 * platforms Buffer supports. Right cluster shows connection status + the
 * Connect/Disconnect CTA. The connected state expands below with meta
 * rows, refresh action, and the confirm-typed-disconnect flow.
 */
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

  const connected = Boolean(integration);

  return (
    <div
      style={{
        background: "#ffffff",
        border: `1px solid ${CARD_BORDER}`,
        borderRadius: 12,
        padding: "24px 28px",
      }}
    >
      <div className="flex flex-wrap items-start justify-between" style={{ gap: 24 }}>
        <div className="flex" style={{ gap: 16, flex: 1, minWidth: 320 }}>
          <div
            className="grid flex-shrink-0 place-items-center"
            style={{
              width: 44,
              height: 44,
              borderRadius: 11,
              background: INK,
              color: "#ffffff",
              fontWeight: 800,
              fontSize: 17,
            }}
          >
            B
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center" style={{ gap: 10 }}>
              <span style={{ fontSize: 16, fontWeight: 700, color: INK }}>Buffer</span>
              <span
                style={{
                  fontFamily: "var(--font-revamp-mono)",
                  fontSize: 10,
                  letterSpacing: "0.1em",
                  color: LIGHT_MUTED,
                  background: "#f1f4f9",
                  padding: "3px 9px",
                  borderRadius: 99,
                  fontWeight: 600,
                }}
              >
                SCHEDULING
              </span>
            </div>
            <p
              style={{
                fontSize: 13.5,
                color: MUTED,
                lineHeight: 1.6,
                marginTop: 6,
                maxWidth: 520,
              }}
            >
              Schedule approved posts straight to your social queues. One connection covers your
              whole agency.
            </p>
            <div className="flex flex-wrap" style={{ gap: 6, marginTop: 12 }}>
              {(Object.keys(PLATFORM_LABELS) as Platform[]).map((p) => {
                const has = connected && integration?.meta?.profiles?.[p];
                return (
                  <span
                    key={p}
                    style={{
                      fontSize: 11.5,
                      fontWeight: 600,
                      color: has ? ACCENT : MUTED,
                      border: `1px solid ${has ? ACCENT_SOFT : CARD_BORDER}`,
                      background: has ? ACCENT_SOFT : "#fff",
                      padding: "4px 11px",
                      borderRadius: 99,
                    }}
                  >
                    {PLATFORM_LABELS[p]}
                  </span>
                );
              })}
            </div>
          </div>
        </div>

        <div className="flex flex-shrink-0 flex-col items-end" style={{ gap: 10 }}>
          <span
            className="flex items-center"
            style={{
              gap: 6,
              fontSize: 11.5,
              fontWeight: 600,
              color: connected ? "#1E7A47" : LIGHT_MUTED,
            }}
          >
            <span
              aria-hidden
              style={{
                width: 7,
                height: 7,
                borderRadius: 99,
                background: connected ? "#8fd0a8" : "#d4dbe7",
              }}
            />
            {connected ? "Connected" : "Not connected"}
          </span>
          {canManage ? (
            connected ? null : (
              <a
                href="/api/integrations/buffer/connect"
                className="inline-flex items-center no-underline"
                style={{
                  background: ACCENT,
                  color: "#fff",
                  fontWeight: 600,
                  fontSize: 13.5,
                  padding: "10px 18px",
                  borderRadius: 8,
                  fontFamily: "inherit",
                }}
              >
                Connect Buffer →
              </a>
            )
          ) : (
            <div style={{ fontSize: 12, color: LIGHT_MUTED, textAlign: "right", maxWidth: 220 }}>
              Ask an OWNER or ADMIN to connect Buffer.
            </div>
          )}
        </div>
      </div>

      {connected && integration ? (
        <>
          <div
            className="grid"
            style={{
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: 16,
              marginTop: 20,
              paddingTop: 20,
              borderTop: `1px solid ${ROW_BORDER}`,
            }}
          >
            <InfoRow
              label="CONNECTED BY"
              value={
                integration.connectedByName ??
                integration.connectedByEmail ??
                "(member no longer in agency)"
              }
            />
            <InfoRow
              label="CONNECTED ON"
              value={integration.createdAt.toISOString().slice(0, 10)}
            />
            <InfoRow
              label="LAST SYNC"
              value={
                integration.lastSyncedAt
                  ? integration.lastSyncedAt.toISOString().slice(0, 16).replace("T", " ") + " UTC"
                  : "never"
              }
            />
            <InfoRow label="AUTO PUBLISHED" value={integration.autoMarkPublished ? "on" : "off"} />
          </div>

          <div style={{ marginTop: 18 }}>
            <div className="flex items-center justify-between">
              <span
                style={{
                  fontFamily: "var(--font-revamp-mono)",
                  fontSize: 10.5,
                  letterSpacing: "0.12em",
                  color: LIGHT_MUTED,
                  fontWeight: 600,
                }}
              >
                CONNECTED PROFILES
              </span>
              {canManage ? (
                <button
                  type="button"
                  onClick={onRefresh}
                  disabled={refreshing}
                  style={{
                    background: "#fff",
                    color: MUTED,
                    border: `1px solid ${CARD_BORDER}`,
                    borderRadius: 8,
                    padding: "5px 12px",
                    fontSize: 11.5,
                    fontWeight: 600,
                    cursor: refreshing ? "wait" : "pointer",
                    fontFamily: "inherit",
                  }}
                  title="Re-enumerate channels + organizations from Buffer."
                >
                  {refreshing ? "Refreshing…" : "Refresh channels"}
                </button>
              ) : null}
            </div>
            {refreshOk ? (
              <div
                style={{
                  marginTop: 8,
                  fontSize: 11.5,
                  color: "#1E7A47",
                  background: "#E6F1EA",
                  padding: "6px 10px",
                  borderRadius: 6,
                }}
              >
                {refreshOk}
              </div>
            ) : null}
          </div>

          {integration.lastSyncError ? (
            <div
              style={{
                marginTop: 14,
                background: "#FBF1DE",
                color: "#A06D12",
                border: "1px solid #E6D9B8",
                borderRadius: 8,
                padding: "8px 12px",
                fontSize: 12,
              }}
            >
              Last sync error: {integration.lastSyncError}
            </div>
          ) : null}

          {canManage ? (
            <div style={{ marginTop: 20, paddingTop: 18, borderTop: `1px solid ${ROW_BORDER}` }}>
              <div
                style={{
                  fontFamily: "var(--font-revamp-mono)",
                  fontSize: 10.5,
                  letterSpacing: "0.12em",
                  color: LIGHT_MUTED,
                  fontWeight: 600,
                }}
              >
                DISCONNECT
              </div>
              <p style={{ fontSize: 12.5, color: MUTED, marginTop: 6, lineHeight: 1.55 }}>
                Type <code style={{ fontFamily: "var(--font-revamp-mono)" }}>disconnect</code> to
                confirm. Anything still SCHEDULED on Buffer gets downgraded to manual — the posts
                don&apos;t disappear from Buffer, we just stop syncing.
              </p>
              <div className="flex flex-wrap items-center" style={{ gap: 8, marginTop: 12 }}>
                <input
                  value={disconnectConfirm}
                  onChange={(e) => setDisconnectConfirm(e.target.value)}
                  placeholder="disconnect"
                  style={{
                    border: `1px solid ${CARD_BORDER}`,
                    background: "#fff",
                    borderRadius: 8,
                    padding: "8px 12px",
                    fontSize: 13,
                    outline: "none",
                    fontFamily: "inherit",
                  }}
                />
                <button
                  type="button"
                  onClick={onDisconnect}
                  disabled={pending}
                  style={{
                    background: "#fff",
                    color: "#A02B1C",
                    border: "1px solid #e4c5c5",
                    borderRadius: 8,
                    padding: "8px 14px",
                    fontSize: 12.5,
                    fontWeight: 600,
                    cursor: pending ? "wait" : "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  {pending ? "Disconnecting…" : "Disconnect Buffer"}
                </button>
              </div>
              {error ? (
                <div style={{ marginTop: 8, fontSize: 12, color: "#A02B1C" }}>{error}</div>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}

      {!connected ? (
        <div
          className="flex items-center"
          style={{
            gap: 8,
            background: "#f6f8fc",
            border: `1px solid ${ROW_BORDER}`,
            borderRadius: 8,
            padding: "9px 14px",
            fontSize: 12.5,
            color: MUTED,
            marginTop: 18,
          }}
        >
          <span style={{ color: ACCENT }}>ⓘ</span>
          Non-social outputs — show notes, blog, newsletter — stay manual regardless; Buffer
          doesn&apos;t publish to those.
        </div>
      ) : null}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div
        style={{
          fontFamily: "var(--font-revamp-mono)",
          fontSize: 10,
          letterSpacing: "0.1em",
          color: LIGHT_MUTED,
          fontWeight: 600,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 13, color: INK, marginTop: 4 }}>{value}</div>
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { ArtworkUpload } from "@/components/clients/artwork-upload";
import { updateAgencyBrandingAction } from "@/app/(dashboard)/settings/branding/actions";

const INK = "#0a1e3c";
const MUTED = "#41506b";
const LIGHT_MUTED = "#8a97ad";
const CARD_BORDER = "#e4e9f1";
const ROW_BORDER = "#eef1f6";
const OUTLINE_STRONG = "#d4dbe7";
const ACCENT = "#3A5BA0";
const ACCENT_SOFT = "#eef2fb";

const DEFAULT_ACCENT = "#3A5BA0";
const HEX_RE = /^#[0-9a-fA-F]{6}$/u;

/** Curated accent swatches — first is our brand default. */
const SWATCHES = [DEFAULT_ACCENT, "#0a1e3c", "#1f8a5b", "#b3452e", "#6b4dd6"];

/**
 * Settings · Branding form — revamp visual system (see `ref/UI/Revamp/` 2b).
 *
 * Two-column layout:
 *   - Left card: sectioned controls (heading + WHITE-LABEL pill, Logo
 *     upload, Accent swatches + hex input, sticky save footer).
 *   - Right column: LIVE PREVIEW label + framed portal mock that reacts to
 *     the picked accent and uploaded logo in real time.
 */
export function BrandingForm({
  agencyName,
  initialLogoUrl,
  initialAccentColor,
  canEdit,
}: {
  agencyName: string;
  initialLogoUrl: string | null;
  initialAccentColor: string | null;
  canEdit: boolean;
}) {
  const [logoUrl, setLogoUrl] = useState<string>(initialLogoUrl ?? "");
  const [accent, setAccent] = useState<string>(initialAccentColor ?? "");
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const accentTrimmed = accent.trim();
  const accentValid = accentTrimmed.length === 0 || HEX_RE.test(accentTrimmed);
  const accentForPreview = accentValid && accentTrimmed.length > 0 ? accentTrimmed : DEFAULT_ACCENT;

  const initialLogo = initialLogoUrl ?? "";
  const initialAccent = initialAccentColor ?? "";
  const dirty = logoUrl !== initialLogo || accentTrimmed !== initialAccent;

  const onSave = () => {
    if (!canEdit || !accentValid || !dirty || pending) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await updateAgencyBrandingAction({
          brandLogoUrl: logoUrl.trim().length > 0 ? logoUrl.trim() : null,
          brandAccentColor: accentTrimmed.length > 0 ? accentTrimmed : null,
        });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setSavedAt(Date.now());
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't save branding.");
      }
    });
  };

  const displayAccent = accentTrimmed.length > 0 ? accentTrimmed.toUpperCase() : DEFAULT_ACCENT;
  const isDefault = accentTrimmed.length === 0;

  return (
    <div
      className="grid"
      style={{
        gridTemplateColumns: "1fr 1.1fr",
        gap: 20,
        alignItems: "start",
      }}
    >
      {/* Left column — controls */}
      <div
        style={{
          background: "#ffffff",
          border: `1px solid ${CARD_BORDER}`,
          borderRadius: 12,
          overflow: "hidden",
        }}
      >
        {/* Section header */}
        <div style={{ padding: "20px 26px", borderBottom: `1px solid ${ROW_BORDER}` }}>
          <div className="flex items-center" style={{ gap: 8 }}>
            <span style={{ fontSize: 15.5, fontWeight: 700, color: INK }}>
              Client-facing branding
            </span>
            <span
              style={{
                fontFamily: "var(--font-revamp-mono)",
                fontSize: 10,
                letterSpacing: "0.1em",
                color: ACCENT,
                background: ACCENT_SOFT,
                padding: "3px 8px",
                borderRadius: 99,
                fontWeight: 600,
              }}
            >
              WHITE-LABEL
            </span>
          </div>
          <div style={{ fontSize: 12.5, color: LIGHT_MUTED, lineHeight: 1.55, marginTop: 6 }}>
            Only affects surfaces your clients see — the portal and branded exports. Your dashboard
            keeps the default theme.
          </div>
        </div>

        {/* Logo */}
        <div style={{ padding: "20px 26px", borderBottom: `1px solid ${ROW_BORDER}` }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: INK }}>Logo</div>
          <div style={{ fontSize: 12.5, color: LIGHT_MUTED, marginTop: 3 }}>
            JPG, PNG, WebP, or AVIF. Square works best.
          </div>
          <div style={{ marginTop: 14 }}>
            {canEdit ? (
              <ArtworkUpload value={logoUrl} onChange={setLogoUrl} />
            ) : logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoUrl}
                alt="Agency logo"
                className="rounded-md object-cover"
                style={{ width: 56, height: 56, background: ROW_BORDER }}
              />
            ) : (
              <div style={{ fontSize: 12.5, color: LIGHT_MUTED }}>No logo set.</div>
            )}
          </div>
        </div>

        {/* Accent color */}
        <div style={{ padding: "20px 26px", borderBottom: `1px solid ${ROW_BORDER}` }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: INK }}>Accent color</div>
          <div style={{ fontSize: 12.5, color: LIGHT_MUTED, marginTop: 3 }}>
            Buttons + highlights on client-facing surfaces.
          </div>
          <div className="flex flex-wrap items-center" style={{ gap: 10, marginTop: 14 }}>
            {SWATCHES.map((c) => {
              const selected =
                (accentTrimmed.length > 0 && accentTrimmed.toLowerCase() === c.toLowerCase()) ||
                (isDefault && c === DEFAULT_ACCENT);
              return (
                <button
                  key={c}
                  type="button"
                  aria-label={`Use ${c}`}
                  disabled={!canEdit}
                  onClick={() => setAccent(c === DEFAULT_ACCENT ? "" : c)}
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 99,
                    background: c,
                    outline: selected ? `2px solid ${c}` : "none",
                    outlineOffset: selected ? 3 : 0,
                    border: "none",
                    cursor: canEdit ? "pointer" : "not-allowed",
                    padding: 0,
                    opacity: canEdit ? 1 : 0.5,
                  }}
                />
              );
            })}
            <div
              aria-hidden
              style={{ width: 1, height: 24, background: ROW_BORDER, margin: "0 4px" }}
            />
            <input
              type="text"
              value={displayAccent}
              onChange={(e) => setAccent(e.target.value)}
              placeholder="#3A5BA0"
              disabled={!canEdit}
              aria-label="Accent color hex"
              style={{
                border: `1px solid ${OUTLINE_STRONG}`,
                borderRadius: 8,
                padding: "8px 12px",
                fontFamily: "var(--font-revamp-mono)",
                fontSize: 12.5,
                color: MUTED,
                background: "#fff",
                outline: "none",
                width: 120,
              }}
            />
          </div>
          {isDefault ? (
            <div style={{ fontSize: 12, color: LIGHT_MUTED, marginTop: 10 }}>
              Using default — Repodcast blue
            </div>
          ) : !accentValid ? (
            <div style={{ fontSize: 12, color: "#A06D12", marginTop: 10 }}>
              Use a 6-digit hex like #3A5BA0
            </div>
          ) : null}
        </div>

        {/* Save footer */}
        <div
          className="flex items-center justify-between"
          style={{ background: "#f6f8fc", padding: "16px 26px", gap: 12 }}
        >
          <span style={{ fontSize: 12.5, color: LIGHT_MUTED }}>
            {error ? (
              <span style={{ color: "#A06D12" }}>{error}</span>
            ) : savedAt ? (
              <span style={{ color: "#1E7A47" }}>Saved · applied to the portal instantly</span>
            ) : (
              "Changes apply to the portal instantly"
            )}
          </span>
          <button
            type="button"
            onClick={onSave}
            disabled={!canEdit || !accentValid || !dirty || pending}
            style={{
              background: !canEdit || !dirty ? "#c9d4e8" : ACCENT,
              color: "#fff",
              border: "none",
              borderRadius: 8,
              padding: "10px 20px",
              fontSize: 13.5,
              fontWeight: 600,
              cursor: !canEdit || !accentValid || !dirty || pending ? "not-allowed" : "pointer",
              fontFamily: "inherit",
            }}
          >
            {pending ? "Saving…" : "Save branding"}
          </button>
        </div>
      </div>

      {/* Right column — live preview */}
      <div>
        <div className="flex items-center justify-between" style={{ marginBottom: 10 }}>
          <span
            style={{
              fontFamily: "var(--font-revamp-mono)",
              fontSize: 10.5,
              letterSpacing: "0.12em",
              color: LIGHT_MUTED,
              fontWeight: 600,
            }}
          >
            LIVE PREVIEW · CLIENT PORTAL
          </span>
        </div>
        <div
          style={{
            border: `1px solid ${CARD_BORDER}`,
            borderRadius: 14,
            overflow: "hidden",
            boxShadow: "0 16px 40px -18px rgba(10,30,60,0.2)",
            background: "#fff",
          }}
        >
          {/* Browser chrome */}
          <div
            className="flex items-center"
            style={{
              gap: 8,
              background: "#f1f4f9",
              borderBottom: `1px solid ${CARD_BORDER}`,
              padding: "10px 14px",
            }}
          >
            <div className="flex" style={{ gap: 5 }}>
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  style={{ width: 9, height: 9, borderRadius: 99, background: "#dfe5ee" }}
                />
              ))}
            </div>
            <div
              className="flex-1"
              style={{
                background: "#fff",
                border: `1px solid ${CARD_BORDER}`,
                borderRadius: 6,
                padding: "5px 12px",
                fontFamily: "var(--font-revamp-mono)",
                fontSize: 11,
                color: LIGHT_MUTED,
              }}
            >
              portal.repodcast.app/{slugify(agencyName)}
            </div>
          </div>

          {/* Portal header */}
          <div
            className="flex items-center justify-between"
            style={{ padding: "16px 22px", borderBottom: `1px solid ${ROW_BORDER}` }}
          >
            <div className="flex items-center" style={{ gap: 11 }}>
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={logoUrl}
                  alt={`${agencyName} logo`}
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 9,
                    objectFit: "cover",
                    background: ROW_BORDER,
                  }}
                />
              ) : (
                <div
                  className="grid place-items-center"
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 9,
                    background: accentForPreview,
                    color: "#fff",
                    fontSize: 12,
                    fontWeight: 800,
                  }}
                >
                  {initialsOf(agencyName)}
                </div>
              )}
              <div>
                <div style={{ fontSize: 14.5, fontWeight: 700, color: INK }}>{agencyName}</div>
                <div style={{ fontSize: 11.5, color: LIGHT_MUTED }}>Client portal</div>
              </div>
            </div>
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: MUTED,
                border: `1px solid ${CARD_BORDER}`,
                padding: "6px 12px",
                borderRadius: 7,
              }}
            >
              The Great Client ▾
            </span>
          </div>

          {/* Portal body */}
          <div style={{ padding: "20px 22px" }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, color: INK }}>
              Ready for your review
            </div>
            <div
              style={{
                border: `1px solid ${ROW_BORDER}`,
                borderRadius: 10,
                padding: 16,
                background: "#fdfefe",
              }}
            >
              <div className="flex items-center justify-between" style={{ marginBottom: 10 }}>
                <span
                  style={{
                    fontFamily: "var(--font-revamp-mono)",
                    fontSize: 10.5,
                    color: LIGHT_MUTED,
                    letterSpacing: "0.06em",
                  }}
                >
                  EP 41 · LINKEDIN POST
                </span>
                <span
                  style={{
                    fontSize: 10.5,
                    fontWeight: 600,
                    color: accentForPreview,
                    background: hexAlpha(accentForPreview, 0.12),
                    padding: "3px 9px",
                    borderRadius: 99,
                  }}
                >
                  Strong voice
                </span>
              </div>
              <div style={{ fontSize: 13, lineHeight: 1.65, color: "#2c3a52" }}>
                Most founders don&apos;t have a growth problem. They have a focus problem. This
                week: why saying no is the highest-leverage thing you&apos;ll do all quarter.
              </div>
              <div className="flex" style={{ gap: 8, marginTop: 14 }}>
                <span
                  style={{
                    background: accentForPreview,
                    color: "#fff",
                    fontSize: 12,
                    fontWeight: 600,
                    padding: "8px 16px",
                    borderRadius: 7,
                  }}
                >
                  Approve outputs
                </span>
                <span
                  style={{
                    border: `1px solid ${CARD_BORDER}`,
                    color: MUTED,
                    fontSize: 12,
                    fontWeight: 600,
                    padding: "8px 16px",
                    borderRadius: 7,
                  }}
                >
                  Request changes
                </span>
              </div>
            </div>
            <div
              className="flex items-center justify-center"
              style={{ gap: 8, fontSize: 11.5, color: LIGHT_MUTED, marginTop: 14 }}
            >
              Powered by Repodcast ·{" "}
              <span style={{ color: MUTED, fontWeight: 600 }}>hidden on Network plan</span>
            </div>
          </div>
        </div>

        <div
          className="flex items-center"
          style={{
            gap: 8,
            background: "#fff",
            border: `1px solid ${ROW_BORDER}`,
            borderRadius: 8,
            padding: "9px 14px",
            fontSize: 12.5,
            color: MUTED,
            marginTop: 12,
          }}
        >
          <span style={{ color: ACCENT }}>ⓘ</span>
          The accent applies to the primary CTA and highlights — try a swatch to see it live.
        </div>

        {!canEdit && (
          <div style={{ fontSize: 12, color: LIGHT_MUTED, marginTop: 10 }}>
            Read-only — owners and admins can edit branding.
          </div>
        )}
      </div>
    </div>
  );
}

function initialsOf(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  return parts
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 40);
}

function hexAlpha(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  if (clean.length !== 6) return hex;
  const bigint = parseInt(clean, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

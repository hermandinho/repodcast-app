"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ArtworkUpload } from "@/components/clients/artwork-upload";
import { updateAgencyBrandingAction } from "@/app/(dashboard)/settings/branding/actions";

const DEFAULT_ACCENT = "#3A5BA0";
const HEX_RE = /^#[0-9a-fA-F]{6}$/u;

/**
 * Phase 2.5 — agency white-label form. Owns:
 *   - Logo: reuses `<ArtworkUpload>` (R2 direct-upload via the same signed
 *     PUT pipeline as client/show artwork; keys land under
 *     `artwork/<agencyId>/...`).
 *   - Accent color: native `<input type="color">` + a synced hex text
 *     input so power users can paste a brand color rather than fiddle with
 *     the OS picker. Invalid hex disables save.
 *   - Live preview card: chip + pill + button styled with the picked
 *     color so the user can see what the portal / branded export will
 *     look like before saving.
 *
 * Read-only mode (REVIEWER/EDITOR) renders the same surfaces but disables
 * every interactive control; the server gate would 403 a write anyway.
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

  // Empty accent is allowed (means "use the Repodcast default") — the
  // regex check only fires for non-empty values.
  const accentTrimmed = accent.trim();
  const accentValid = accentTrimmed.length === 0 || HEX_RE.test(accentTrimmed);
  const accentForPreview = accentValid && accentTrimmed.length > 0 ? accentTrimmed : DEFAULT_ACCENT;

  // Dirty check — disable Save when nothing's changed from the persisted
  // values. Empty string normalises to null on the wire, so compare
  // empties and nulls as equal.
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

  const onReset = () => {
    setLogoUrl(initialLogo);
    setAccent(initialAccent);
    setError(null);
    setSavedAt(null);
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Logo */}
      <Section
        title="Logo"
        hint="Shown to clients in the portal + on branded exports. JPG, PNG, WebP, or AVIF. Square works best."
      >
        {canEdit ? (
          <ArtworkUpload value={logoUrl} onChange={setLogoUrl} />
        ) : (
          <ReadOnlyImagePreview value={logoUrl} alt="Agency logo" />
        )}
      </Section>

      {/* Accent color */}
      <Section
        title="Accent color"
        hint="Buttons + highlights on client-facing surfaces. Leave blank to keep Repodcast blue."
      >
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="color"
            value={accentForPreview}
            onChange={(e) => setAccent(e.target.value)}
            disabled={!canEdit}
            className="h-10 w-12 cursor-pointer rounded-md border border-[#C9D4E8] bg-white p-1 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Pick accent color"
          />
          <input
            type="text"
            value={accent}
            onChange={(e) => setAccent(e.target.value)}
            placeholder="#3A5BA0"
            disabled={!canEdit}
            className="w-[140px] rounded-[10px] px-3 py-2 font-mono text-[13px] text-[#2A3550] outline-none disabled:cursor-not-allowed disabled:opacity-50"
            style={{ border: "1px solid #C9D4E8", background: "#FBFCFE" }}
            aria-label="Accent color hex"
          />
          {accent.trim().length === 0 && (
            <span className="text-muted-2 text-[12px]">Using default (Repodcast blue)</span>
          )}
          {!accentValid && (
            <span className="text-[12px] text-[#A06D12]">Use a 6-digit hex like #3A5BA0</span>
          )}
        </div>
      </Section>

      {/* Live preview */}
      <Section title="Preview" hint="Approximates what your client will see on the portal.">
        <div
          className="border-border rounded-2xl border bg-white p-5"
          style={{ boxShadow: "0 1px 2px rgba(26,42,74,.04)" }}
        >
          <div className="mb-4 flex items-center gap-3">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoUrl}
                alt={`${agencyName} logo`}
                className="h-9 w-9 flex-shrink-0 rounded-md object-cover"
                style={{ background: "#EEF1F6" }}
              />
            ) : (
              <div
                className="font-display flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md text-[13px] font-semibold text-white"
                style={{ background: accentForPreview }}
              >
                {agencyName.slice(0, 2).toUpperCase()}
              </div>
            )}
            <div className="font-display text-ink text-[16px] font-semibold">{agencyName}</div>
          </div>
          <div className="text-muted mb-4 text-[13px]">
            This is how the portal header reads for your client. Approved outputs render below with
            the accent applied to the primary CTA.
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled
              className="rounded-[10px] px-4 py-[10px] font-sans text-[13px] font-semibold text-white"
              style={{ background: accentForPreview, opacity: 0.95 }}
            >
              Approve outputs
            </button>
            <span
              className="rounded-pill px-3 py-1 font-sans text-[12px] font-semibold"
              style={{
                background: `${accentForPreview}1A`, // ~10% alpha tint
                color: accentForPreview,
              }}
            >
              Strong voice
            </span>
          </div>
        </div>
      </Section>

      {/* Footer */}
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={onSave} disabled={!canEdit || !accentValid || !dirty || pending}>
          {pending ? "Saving…" : "Save branding"}
        </Button>
        {dirty && (
          <button
            type="button"
            onClick={onReset}
            disabled={pending}
            className="text-muted hover:text-ink font-sans text-[12.5px] font-semibold disabled:opacity-50"
          >
            Discard changes
          </button>
        )}
        {!canEdit && (
          <span className="text-muted-2 text-[12px]">
            Read-only — owners and admins can edit branding.
          </span>
        )}
        {error && <span className="text-[12px] text-[#A06D12]">{error}</span>}
        {savedAt && !error && <span className="text-[12px] text-[#1E7A47]">✓ Branding saved</span>}
      </div>
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2">
        <div className="text-ink font-sans text-[13.5px] font-semibold">{title}</div>
        <div className="text-muted-2 mt-[2px] max-w-[560px] text-[12px] leading-[1.5]">{hint}</div>
      </div>
      {children}
    </div>
  );
}

function ReadOnlyImagePreview({ value, alt }: { value: string; alt: string }) {
  if (!value) {
    return <div className="text-muted-2 text-[12.5px]">No logo set.</div>;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={value}
      alt={alt}
      className="h-12 w-12 flex-shrink-0 rounded-md object-cover"
      style={{ background: "#EEF1F6" }}
    />
  );
}

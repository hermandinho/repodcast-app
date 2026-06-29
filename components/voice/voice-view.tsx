"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { Platform } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { PlatformBadge } from "@/components/ui/platform-badge";
import { VoiceStrengthBars } from "@/components/ui/voice-strength-bars";
import type { SampleShow } from "@/lib/sample-data/shows";
import { platforms, type PlatformKey, type PlatformMeta } from "@/lib/sample-data/platforms";
import type { VoiceInstructions, VoiceProfile } from "@/lib/sample-data/voice-profiles";
import { voiceLabel, voiceTextColor } from "@/lib/sample-data/voice-strength";
import { saveVoiceInstructionsAction } from "@/app/(dashboard)/voice/[showKey]/actions";

const PLATFORM_KEY_TO_ENUM: Record<PlatformKey, Platform> = {
  x: Platform.TWITTER,
  li: Platform.LINKEDIN,
  ig: Platform.INSTAGRAM,
  tt: Platform.TIKTOK,
  notes: Platform.SHOW_NOTES,
  blog: Platform.BLOG,
  news: Platform.NEWSLETTER,
};

const platformByKey = new Map<PlatformKey, PlatformMeta>(platforms.map((p) => [p.key, p]));

type FilterKey = "all" | PlatformKey;

export function VoiceView({ show, profile }: { show: SampleShow; profile: VoiceProfile }) {
  // Local alias keeps the renderer below readable — the entity is a Show
  // (it has host, samples, platformSamples) but everywhere in this file
  // it's been called `client` historically.
  const client = show;
  const [filter, setFilter] = useState<FilterKey>("all");
  const [instructions, setInstructions] = useState<VoiceInstructions>(profile.instructions);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  // Filter chip counts per platform — only show chips for platforms with samples.
  const sampleCounts = useMemo(() => {
    const counts: Partial<Record<PlatformKey, number>> = {};
    for (const s of profile.samples) {
      counts[s.platform] = (counts[s.platform] ?? 0) + 1;
    }
    return counts;
  }, [profile.samples]);

  const filterChips: { key: FilterKey; label: string; count: number }[] = useMemo(() => {
    const chips: { key: FilterKey; label: string; count: number }[] = [
      { key: "all", label: "All", count: profile.samples.length },
    ];
    for (const p of platforms) {
      const n = sampleCounts[p.key];
      if (n) chips.push({ key: p.key, label: p.name, count: n });
    }
    return chips;
  }, [profile.samples.length, sampleCounts]);

  const visibleSamples = useMemo(
    () =>
      filter === "all" ? profile.samples : profile.samples.filter((s) => s.platform === filter),
    [filter, profile.samples],
  );

  const onSave = () => {
    setSaveError(null);
    // In sample-data mode `client.key` is the static "ff"/"te"/"mt" slug;
    // in live mode it's the real Client.id (mapped in server/data/source.ts).
    // Either way, this matches what the server action expects.
    const perPlatform = Object.fromEntries(
      (Object.keys(PLATFORM_KEY_TO_ENUM) as PlatformKey[]).map((k) => [
        PLATFORM_KEY_TO_ENUM[k],
        instructions.perPlatform[k] ?? "",
      ]),
    ) as Record<Platform, string>;

    startSaving(async () => {
      try {
        const result = await saveVoiceInstructionsAction({
          showId: client.key,
          global: instructions.global,
          perPlatform,
        });
        if (!result.ok) {
          setSaveError(result.error);
          return;
        }
        setSaved(true);
        window.setTimeout(() => setSaved(false), 1700);
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : "Couldn't save voice rules.");
      }
    });
  };

  return (
    <div className="px-[30px] pt-[28px] pb-[60px]">
      <div className="mx-auto max-w-[1080px]">
        <Link
          href={`/shows/${encodeURIComponent(client.key)}`}
          className="text-muted hover:text-ink mb-4 inline-flex items-center gap-[6px] font-sans text-[12.5px] font-medium transition-colors"
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 13 13"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M8 3L4 6.5l4 3.5" />
          </svg>
          Back to {client.name}
        </Link>

        {/* HEADER */}
        <div className="mb-5 flex items-center gap-[14px]">
          <div
            className="font-display flex h-12 w-12 items-center justify-center rounded-xl text-[18px] font-bold text-white"
            style={{
              background: client.avatarBg,
              boxShadow: "inset 0 -14px 24px rgba(0,0,0,.18)",
            }}
          >
            {client.initial}
          </div>
          <div className="flex-1">
            <div className="text-muted-2 text-[12.5px]">Voice profile</div>
            <h1 className="font-display text-ink text-[23px] font-semibold tracking-[-0.4px]">
              {client.name}
            </h1>
          </div>
          <div className="text-right">
            <div className="flex items-center justify-end gap-[9px]">
              <VoiceStrengthBars samples={client.samples} size="lg" />
              <span
                className="font-sans text-[15px] font-semibold"
                style={{ color: voiceTextColor(client.samples) }}
              >
                {voiceLabel(client.samples)}
              </span>
            </div>
            <div className="text-muted-2 mt-[5px] text-[12px]">
              Trained on {client.samples} approved samples
            </div>
          </div>
        </div>

        {/* AI DESCRIPTION CALLOUT */}
        <div className="border-accent-border bg-accent-soft relative mb-[18px] overflow-hidden rounded-3xl border px-6 py-[22px]">
          <div className="bg-accent absolute inset-y-0 left-0 w-1" />
          <div className="mb-3 flex items-center gap-2">
            <svg
              width="15"
              height="15"
              viewBox="0 0 15 15"
              fill="none"
              stroke="var(--color-accent)"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M7.5 1.5l1.6 3.7 4 .4-3 2.7.9 3.9-3.5-2.1-3.5 2.1.9-3.9-3-2.7 4-.4z" />
            </svg>
            <span className="text-accent font-sans text-[12px] font-semibold tracking-[0.04em] uppercase">
              AI-generated voice summary
            </span>
          </div>
          {profile.description.trim() ? (
            <>
              <p className="m-0 max-w-[760px] font-sans text-[16px] leading-[1.62] text-[#2A3550]">
                {profile.description}
              </p>
              {profile.tags.length > 0 && (
                <div className="mt-4 mb-[6px] flex flex-wrap gap-2">
                  {profile.tags.map((t) => (
                    <span
                      key={t}
                      className="rounded-pill text-accent border border-[#D6DEEC] bg-white px-[11px] py-[5px] font-sans text-[12px] font-semibold"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              )}
              <div className="text-muted mt-[14px] flex items-center gap-[7px] text-[12px]">
                <span className="h-[7px] w-[7px] rounded-full bg-[#2E9E5B]" />
                Updated automatically every time you approve an output.
              </div>
            </>
          ) : (
            <p className="text-muted m-0 max-w-[760px] font-sans text-[14.5px] leading-[1.6]">
              Approve a few outputs for {client.host}&apos;s show and the engine will write a voice
              summary here — the style traits, recurring phrases, and tone signatures it&apos;s
              learned. Empty until then.
            </p>
          )}
        </div>

        {/* TWO COLUMNS */}
        <div className="mb-[18px] grid grid-cols-1 items-start gap-[18px] md:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
          {/* Strength by platform */}
          <section className="border-border bg-surface rounded-3xl border p-5">
            <div className="font-display text-ink text-[15px] font-semibold">
              Strength by platform
            </div>
            <div className="text-muted-2 mt-[3px] mb-[18px] text-[12.5px]">
              Weak 0–5 · Developing 6–15 · Strong 16+
            </div>
            <div className="flex flex-col gap-[15px]">
              {platforms.map((p) => {
                const n = client.platformSamples[p.key] ?? 0;
                return (
                  <div key={p.key} className="flex items-center gap-3">
                    <PlatformBadge platform={p} />
                    <div className="min-w-0 flex-1">
                      <div className="mb-[6px] flex items-center justify-between">
                        <span className="text-[13px] font-medium text-[#39435A]">{p.name}</span>
                        <span
                          className="font-sans text-[11.5px] font-semibold"
                          style={{ color: voiceTextColor(n) }}
                        >
                          {voiceLabel(n)} · {n}
                        </span>
                      </div>
                      <VoiceStrengthBars samples={n} size="sm" />
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Custom instructions */}
          <section className="border-border bg-surface rounded-3xl border p-5">
            <div className="mb-[14px] flex items-start justify-between gap-3">
              <div>
                <div className="font-display text-ink text-[15px] font-semibold">
                  Custom instructions
                </div>
                <div className="text-muted-2 mt-[3px] text-[12.5px]">
                  Global rules the AI always follows for this client.
                </div>
              </div>
              <Button
                size="sm"
                variant={saved ? "success-locked" : "primary"}
                onClick={onSave}
                disabled={saving}
              >
                {saving ? "Saving…" : saved ? "✓ Saved" : "Save rules"}
              </Button>
            </div>
            {saveError && (
              <div className="mb-3 rounded-md border border-[#E6D9B8] bg-[#FBF1DE] px-3 py-2 text-[12px] text-[#A06D12]">
                {saveError}
              </div>
            )}

            <div className="text-muted-2 mb-2 font-sans text-[11.5px] font-semibold tracking-[0.04em] uppercase">
              Always
            </div>
            <textarea
              value={instructions.global}
              onChange={(e) => setInstructions((s) => ({ ...s, global: e.target.value }))}
              className="mb-[18px] h-[104px] w-full resize-y rounded-[11px] px-[13px] py-3 font-sans text-[13px] leading-[1.55] text-[#2A3550] outline-none"
              style={{ border: "1px solid #C9D4E8", background: "#FBFCFE" }}
            />

            <div className="text-muted-2 mb-[10px] font-sans text-[11.5px] font-semibold tracking-[0.04em] uppercase">
              Per-platform rules
            </div>
            <div className="flex flex-col gap-[9px]">
              {platforms.map((p) => (
                <div key={p.key} className="flex items-center gap-[10px]">
                  <span
                    className="font-display flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-[11px] font-bold"
                    style={{
                      background: p.badgeBg,
                      color: p.badgeColor,
                      border: `1px solid ${p.badgeBorder}`,
                    }}
                  >
                    {p.badge}
                  </span>
                  <input
                    value={instructions.perPlatform[p.key] ?? ""}
                    onChange={(e) =>
                      setInstructions((s) => ({
                        ...s,
                        perPlatform: { ...s.perPlatform, [p.key]: e.target.value },
                      }))
                    }
                    placeholder={`Add a rule for ${p.name}…`}
                    className="min-w-0 flex-1 rounded-[9px] px-[11px] py-[9px] font-sans text-[12.5px] text-[#2A3550] outline-none focus:border-[#C7D2E6]"
                    style={{ border: "1px solid #E1E7F0", background: "#FBFCFE" }}
                  />
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* APPROVED SAMPLES BROWSER */}
        <section className="border-border bg-surface rounded-3xl border p-5">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-[14px]">
            <div>
              <div className="font-display text-ink text-[15px] font-semibold">
                Approved voice samples
              </div>
              <div className="text-muted-2 mt-[3px] text-[12.5px]">
                The exact outputs teaching the engine how {client.host} sounds.
              </div>
            </div>
            {profile.samples.length > 0 && (
              <div className="flex flex-wrap gap-[7px]">
                {filterChips.map((chip) => {
                  const selected = chip.key === filter;
                  return (
                    <button
                      key={chip.key}
                      type="button"
                      onClick={() => setFilter(chip.key)}
                      className="rounded-pill flex items-center gap-[6px] px-[11px] py-[5px] font-sans text-[12px] font-semibold"
                      style={
                        selected
                          ? {
                              background: "var(--color-accent)",
                              color: "#fff",
                              border: "1px solid var(--color-accent)",
                            }
                          : { background: "#fff", color: "#5A6473", border: "1px solid #E1E7F0" }
                      }
                    >
                      {chip.label}
                      <span style={{ opacity: 0.7, fontWeight: 500 }}>{chip.count}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {profile.samples.length === 0 ? (
            <div className="border-border bg-canvas rounded-2xl border border-dashed px-6 py-10 text-center">
              <div className="bg-accent-soft text-accent mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl">
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M3 8.5v0M7 5v7M11 2.5v12M15 5.5v6M19 8.5v0" />
                </svg>
              </div>
              <div className="font-display text-ink text-[15.5px] font-semibold">
                No approved samples yet
              </div>
              <p className="text-muted mx-auto mt-2 max-w-[460px] text-[13px]">
                Each time you approve a generated output, we save it here as a training sample. The
                engine learns {client.host}&apos;s voice from these — the more approvals, the
                sharper the next draft.
              </p>
              <div className="mt-4 inline-flex">
                <Link
                  href={`/episodes/new?showId=${encodeURIComponent(client.key)}`}
                  className="bg-accent shadow-card inline-flex items-center gap-[7px] rounded-lg px-[14px] py-[8px] font-sans text-[13px] font-semibold text-white transition-[filter] hover:brightness-95"
                >
                  Generate an episode
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 13 13"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M5 3l4 3.5L5 10" />
                  </svg>
                </Link>
              </div>
            </div>
          ) : (
            <div
              className="grid gap-[13px]"
              style={{ gridTemplateColumns: "repeat(auto-fill, minmax(248px, 1fr))" }}
            >
              {visibleSamples.map((s, i) => {
                const p = platformByKey.get(s.platform);
                if (!p) return null;
                return (
                  <div
                    key={`${s.platform}-${i}`}
                    className="border-border-subtle bg-surface-2 flex flex-col gap-[11px] rounded-[13px] border p-[14px]"
                  >
                    <div className="flex items-center gap-[9px]">
                      <PlatformBadge platform={p} size="sm" />
                      <span className="font-sans text-[12px] font-semibold text-[#39435A]">
                        {p.name}
                      </span>
                      <span className="rounded-pill ml-auto inline-flex items-center gap-1 bg-[#E7F4EC] px-[7px] py-[2px] font-sans text-[10px] font-semibold text-[#1E7A47]">
                        <svg
                          width="9"
                          height="9"
                          viewBox="0 0 10 10"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M2 5.3l2 2L8 3" />
                        </svg>
                        Trained
                      </span>
                    </div>
                    <div
                      className="overflow-hidden font-sans text-[12.5px] leading-[1.55] text-[#39435A]"
                      style={{
                        display: "-webkit-box",
                        WebkitLineClamp: 3,
                        WebkitBoxOrient: "vertical",
                      }}
                    >
                      {s.text}
                    </div>
                    <div className="text-subtle mt-auto text-[11px]">
                      {s.episode} · {s.date}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

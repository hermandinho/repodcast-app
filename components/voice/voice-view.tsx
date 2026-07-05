"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { Platform } from "@/lib/enums";
import { PlatformBadge } from "@/components/ui/platform-badge";
import type { SampleShow } from "@/lib/sample-data/shows";
import { platforms, type PlatformKey, type PlatformMeta } from "@/lib/sample-data/platforms";
import type { VoiceInstructions, VoiceProfile } from "@/lib/sample-data/voice-profiles";
import { voiceLabel } from "@/lib/sample-data/voice-strength";
import { saveVoiceInstructionsAction } from "@/app/(dashboard)/voice/[showKey]/actions";

/**
 * Voice profile page — revamp per ref/UI/Revamp/Voice.html option 4b.
 *
 * Layout: sticky left training rail (320px) + one-column main content.
 * The rail owns the "how sharp is this voice" story (score, checklist,
 * summary unlock) so the main column can be a flat scan of coverage,
 * rules, and the actual approved samples.
 *
 * Color: matches the ref's typographic + spacing scale exactly. Every
 * accented blue in the ref (`#2e5bff`) is intentionally mapped to
 * `var(--color-accent)` so the page inherits the workspace brand color
 * instead of the ref's placeholder blue.
 */

// Milestone thresholds for the strength ladder — mirror the numbers in
// `voice-strength.ts` (Weak 0–5, Developing 6–15, Strong 16+). The rail
// derives its progress math and "N more to Strong" copy from these.
const DEVELOPING_MIN = 6;
const STRONG_MIN = 16;
/** How many approvals unlock the auto-generated voice summary. */
const SUMMARY_UNLOCK = 10;

const WEAK = "#C9952B";
const WEAK_TEXT = "#A06D12";
const WEAK_BG_SOFT = "#F9F1DE";
const AMBER_STRIP = "#E0A33E";
const STRONG_TEXT = "#1E7A47";
const STRONG_BG_SOFT = "#E4F3EC";

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
  // Legacy alias — the underlying entity is a Show but every downstream
  // helper still uses `client`.
  const client = show;
  const [instructions, setInstructions] = useState<VoiceInstructions>(profile.instructions);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  // Which platforms have an in-progress "add rule" input open. A rule is
  // considered "configured" when the persisted value or draft is non-empty,
  // so this set only tracks the rare case of an empty draft the user is
  // typing into.
  const [addingFor, setAddingFor] = useState<Set<PlatformKey>>(new Set());
  // Sample list filter.
  const [filter, setFilter] = useState<FilterKey>("all");

  const totalSamples = client.samples;
  const level = voiceLabel(totalSamples);
  const nextMilestone = totalSamples < DEVELOPING_MIN ? DEVELOPING_MIN : STRONG_MIN;
  const untilStrong = Math.max(0, STRONG_MIN - totalSamples);
  const untilNext = Math.max(0, nextMilestone - totalSamples);
  const summaryUnlocked = totalSamples >= SUMMARY_UNLOCK;
  const summaryPct = Math.min(100, Math.round((totalSamples / SUMMARY_UNLOCK) * 100));

  // Dirty tracking — the "Save rules" affordance activates only when the
  // committed profile diverges from what the operator has typed. Keeps the
  // button honest and gives the "N unsaved change" copy something to count.
  const dirtyCount = useMemo(() => {
    let n = 0;
    if ((instructions.global ?? "").trim() !== (profile.instructions.global ?? "").trim()) n += 1;
    for (const k of Object.keys(PLATFORM_KEY_TO_ENUM) as PlatformKey[]) {
      const a = (instructions.perPlatform[k] ?? "").trim();
      const b = (profile.instructions.perPlatform[k] ?? "").trim();
      if (a !== b) n += 1;
    }
    return n;
  }, [instructions, profile.instructions]);
  const canSave = dirtyCount > 0 && !saving;

  // Configured rules — anything with a non-empty rule string. Drives the
  // ordered "existing rules" list; platforms without a rule surface under
  // the "Add platform rule" affordance instead.
  const configuredRules = useMemo(() => {
    return platforms
      .filter(
        (p) => (instructions.perPlatform[p.key] ?? "").trim().length > 0 || addingFor.has(p.key),
      )
      .map((p) => p.key);
  }, [instructions.perPlatform, addingFor]);
  const unconfiguredPlatforms = useMemo(() => {
    return platforms.filter(
      (p) => (instructions.perPlatform[p.key] ?? "").trim().length === 0 && !addingFor.has(p.key),
    );
  }, [instructions.perPlatform, addingFor]);

  // Sample filter chips — same shape as before (count-tagged pills).
  const sampleCounts = useMemo(() => {
    const counts: Partial<Record<PlatformKey, number>> = {};
    for (const s of profile.samples) counts[s.platform] = (counts[s.platform] ?? 0) + 1;
    return counts;
  }, [profile.samples]);
  const filterChips: { key: FilterKey; label: string; count: number }[] = useMemo(() => {
    const chips: { key: FilterKey; label: string; count: number }[] = [
      { key: "all", label: "All platforms", count: profile.samples.length },
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

  // Next-best-actions checklist. Kept declarative so the checklist renders
  // as pure derivation from `profile` + local `instructions`.
  const platformsCovered = platforms.filter((p) => (client.platformSamples[p.key] ?? 0) > 0).length;
  const allPlatformsCovered = platformsCovered === platforms.length;
  const hasGlobalRule = (instructions.global ?? "").trim().length > 0;
  const actions = useMemo(() => {
    return [
      untilStrong > 0
        ? {
            key: "approve",
            done: false,
            title:
              untilNext === 0
                ? `Approve more outputs`
                : `Approve ${untilNext} more output${untilNext === 1 ? "" : "s"}`,
            body:
              untilStrong > 0
                ? `Fastest path to ${untilStrong === untilNext ? "Strong" : nextMilestone === DEVELOPING_MIN ? "Developing" : "Strong"}`
                : "Voice is trained",
          }
        : {
            key: "approve",
            done: true,
            title: "Reached Strong",
            body: "Every new approval keeps the voice sharp",
          },
      {
        key: "global-rule",
        done: hasGlobalRule,
        title: "Add an Always rule",
        body: hasGlobalRule
          ? "Guardrails apply from the next generation"
          : "Guardrails apply from the next generation",
      },
      {
        key: "coverage",
        done: allPlatformsCovered,
        title: `Cover all ${platforms.length} platforms`,
        body: allPlatformsCovered
          ? `Done — ${platformsCovered} / ${platforms.length}`
          : `${platformsCovered} of ${platforms.length} covered so far`,
      },
    ];
  }, [untilStrong, untilNext, nextMilestone, hasGlobalRule, allPlatformsCovered, platformsCovered]);

  const onSave = () => {
    setSaveError(null);
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
        // Drain any dangling "adding" affordances whose input is empty —
        // those are speculative slots the operator opened but didn't fill.
        setAddingFor((prev) => {
          const next = new Set(prev);
          for (const k of Array.from(prev)) {
            if ((instructions.perPlatform[k] ?? "").trim().length === 0) next.delete(k);
          }
          return next;
        });
        window.setTimeout(() => setSaved(false), 1700);
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : "Couldn't save voice rules.");
      }
    });
  };

  const openAddFor = (k: PlatformKey) => {
    setAddingFor((prev) => {
      const next = new Set(prev);
      next.add(k);
      return next;
    });
  };
  const removePlatformRule = (k: PlatformKey) => {
    setInstructions((s) => ({
      ...s,
      perPlatform: { ...s.perPlatform, [k]: "" },
    }));
    setAddingFor((prev) => {
      if (!prev.has(k)) return prev;
      const next = new Set(prev);
      next.delete(k);
      return next;
    });
  };

  return (
    <div className="bg-[#F6F8FC]">
      {/* Top strip — breadcrumb + status pill on the left, review CTA
          on the right. Matches the ref's in-header bar. */}
      <div className="border-b border-[#EEF1F6] bg-white px-8 py-3">
        <div className="mx-auto flex max-w-[1240px] items-center justify-between gap-4">
          <nav
            aria-label="Breadcrumb"
            className="flex items-center gap-[10px] text-[13px] text-[#8A97AD]"
          >
            <Link href="/voice" className="font-semibold text-[#41506B] hover:text-[#0A1E3C]">
              Voice
            </Link>
            <span>/</span>
            <span className="font-bold text-[#0A1E3C]">{client.name}</span>
            <span
              className="ml-1 rounded-full px-[9px] py-[3px] font-mono text-[10px] tracking-[0.1em] uppercase"
              style={{ background: WEAK_BG_SOFT, color: WEAK_TEXT }}
            >
              {level}
            </span>
          </nav>
          <Link
            href={`/shows/${encodeURIComponent(client.key)}`}
            className="bg-accent rounded-lg px-4 py-[9px] font-sans text-[13.5px] font-semibold text-white no-underline transition-[filter] hover:brightness-95"
          >
            Review pending outputs
          </Link>
        </div>
      </div>

      <div className="mx-auto max-w-[1240px] px-8 pt-7 pb-14">
        <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
          {/* ============================================================
              TRAINING RAIL (left, sticky on lg+)
              ============================================================ */}
          <aside className="flex flex-col gap-[14px] lg:sticky lg:top-6">
            {/* Dark hero card */}
            <div className="rounded-[14px] p-6 text-white" style={{ background: "#0A1E3C" }}>
              <div className="flex items-center gap-3">
                <div
                  className="font-display flex h-11 w-11 items-center justify-center rounded-[12px] text-[14px] font-bold"
                  style={{ background: "var(--color-accent)" }}
                >
                  {client.initial}
                </div>
                <div className="min-w-0">
                  <div className="text-[17px] font-extrabold tracking-[-0.01em]">{client.name}</div>
                  <div className="mt-[2px] text-[12px] text-[#A9B8D4]">
                    {client.host}
                    {client.clientKey ? ` · ${clientNameFromKey(client.clientKey)}` : ""}
                  </div>
                </div>
              </div>

              <div className="mt-[22px] flex items-baseline gap-2">
                <span className="text-[38px] font-extrabold tracking-[-0.03em]">
                  {totalSamples}
                </span>
                <span className="text-[13px] text-[#A9B8D4]">approved samples</span>
              </div>

              {/* Three-segment strength ladder: Weak (0–5) · Developing
                  (6–15) · Strong (16+). Each segment's flex weight matches
                  its width in the ladder (5:10:6) and is filled by the
                  amber fill up to `totalSamples`. */}
              <div className="mt-[14px] flex gap-1">
                <LadderSegment
                  weight={5}
                  filled={Math.min(totalSamples, 5) / 5}
                  color={WEAK}
                  active={totalSamples > 0}
                />
                <LadderSegment
                  weight={10}
                  filled={Math.max(0, Math.min(totalSamples - 5, 10)) / 10}
                  color={WEAK}
                  active={totalSamples >= DEVELOPING_MIN}
                />
                <LadderSegment
                  weight={6}
                  filled={Math.max(0, Math.min(totalSamples - 15, 6)) / 6}
                  color={AMBER_STRIP}
                  active={totalSamples >= STRONG_MIN}
                />
              </div>
              <div className="mt-2 flex justify-between font-mono text-[9.5px] tracking-[0.08em] text-[#5C6F92]">
                <span className={level === "Weak" ? "text-[#E0A33E]" : ""}>WEAK</span>
                <span className={level === "Developing" ? "text-[#E0A33E]" : ""}>DEVELOPING</span>
                <span className={level === "Strong" ? "text-[#E0A33E]" : ""}>STRONG</span>
              </div>

              <div className="mt-[14px] text-[12.5px] leading-[1.5] text-[#A9B8D4]">
                {untilStrong > 0 ? (
                  <>
                    <span className="font-semibold text-white">
                      {untilStrong} more approval{untilStrong === 1 ? "" : "s"}
                    </span>{" "}
                    until this voice reads as Strong.
                  </>
                ) : (
                  <>
                    <span className="font-semibold text-white">Voice is Strong.</span> Keep
                    approving to hold it there.
                  </>
                )}
              </div>
            </div>

            {/* Next best actions */}
            <div className="rounded-[14px] border border-[#E4E9F1] bg-white px-[22px] py-5">
              <div className="font-mono text-[10.5px] tracking-[0.12em] text-[#8A97AD]">
                NEXT BEST ACTIONS
              </div>
              <div className="mt-2 flex flex-col">
                {actions.map((a, i) => {
                  const isLast = i === actions.length - 1;
                  return (
                    <div
                      key={a.key}
                      className={`flex items-start gap-[11px] py-[11px] ${
                        !isLast ? "border-b border-[#F4F6FA]" : ""
                      }`}
                    >
                      {a.done ? (
                        <span
                          className="mt-[1px] flex h-[18px] w-[18px] flex-none items-center justify-center rounded-full text-[10px]"
                          style={{ background: STRONG_BG_SOFT, color: STRONG_TEXT }}
                        >
                          ✓
                        </span>
                      ) : (
                        <span
                          className="mt-[1px] block h-[18px] w-[18px] flex-none rounded-full border-[1.5px]"
                          style={{ borderColor: "var(--color-accent)" }}
                        />
                      )}
                      <div>
                        <div
                          className={`text-[13px] font-semibold ${
                            a.done ? "text-[#8A97AD] line-through" : "text-[#0A1E3C]"
                          }`}
                        >
                          {a.title}
                        </div>
                        <div className="mt-[2px] text-[11.5px] text-[#8A97AD]">{a.body}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Voice summary — locked chip until enough approvals; once
                unlocked, replaces the placeholder with the profile's
                actual generated description. */}
            <div className="rounded-[14px] border border-[#E4E9F1] bg-white px-[22px] py-5">
              <div className="flex items-center gap-2">
                <span className="text-[14px] font-bold text-[#0A1E3C]">Voice summary</span>
                <span className="rounded-full bg-[#F1F4F9] px-[7px] py-[3px] font-mono text-[9.5px] tracking-[0.1em] text-[#8A97AD]">
                  {totalSamples} / {SUMMARY_UNLOCK}
                </span>
              </div>
              {summaryUnlocked && profile.description.trim().length > 0 ? (
                <p className="mt-[6px] text-[12.5px] leading-[1.55] text-[#41506B]">
                  {profile.description}
                </p>
              ) : (
                <p className="mt-[6px] text-[12.5px] leading-[1.55] text-[#8A97AD]">
                  Unlocks at {SUMMARY_UNLOCK} approvals — the engine will write {client.host}
                  &apos;s style traits and tone signatures here.
                </p>
              )}
              <div className="mt-3 h-[5px] rounded-full bg-[#EEF1F6]">
                <div
                  className="h-full rounded-full transition-[width] duration-500"
                  style={{ width: `${summaryPct}%`, background: "var(--color-accent)" }}
                />
              </div>
            </div>
          </aside>

          {/* ============================================================
              MAIN COLUMN
              ============================================================ */}
          <div className="flex min-w-0 flex-col gap-4">
            {/* Platform coverage */}
            <section className="rounded-[12px] border border-[#E4E9F1] bg-white px-6 py-5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[15px] font-bold text-[#0A1E3C]">Platform coverage</span>
                <span className="text-[12.5px] text-[#8A97AD]">
                  {coverageBlurb(client.platformSamples, platforms.length)}
                </span>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-[10px] sm:grid-cols-4 lg:grid-cols-7">
                {platforms.map((p) => {
                  const n = client.platformSamples[p.key] ?? 0;
                  const lvl = voiceLabel(n);
                  const tint =
                    lvl === "Strong"
                      ? STRONG_TEXT
                      : lvl === "Developing"
                        ? "var(--color-accent)"
                        : WEAK_TEXT;
                  return (
                    <div
                      key={p.key}
                      className="rounded-[10px] border border-[#EEF1F6] p-3 text-center"
                    >
                      <div className="mx-auto flex justify-center">
                        <PlatformBadge platform={p} size="sm" />
                      </div>
                      <div className="mt-2 text-[11.5px] font-semibold text-[#0A1E3C]">
                        {p.name}
                      </div>
                      <div
                        className="mt-[3px] font-mono text-[9.5px] tracking-[0.04em] uppercase"
                        style={{ color: tint }}
                      >
                        {lvl} · {n}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Rules */}
            <section className="overflow-hidden rounded-[12px] border border-[#E4E9F1] bg-white">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#EEF1F6] px-6 py-[18px]">
                <div className="flex items-baseline gap-[10px]">
                  <span className="text-[15px] font-bold text-[#0A1E3C]">Rules</span>
                  <span className="text-[12.5px] text-[#8A97AD]">
                    Guardrails every generation follows
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  {dirtyCount > 0 && !saved && (
                    <span className="text-[12px] font-semibold" style={{ color: WEAK_TEXT }}>
                      {dirtyCount} unsaved change{dirtyCount === 1 ? "" : "s"}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={onSave}
                    disabled={!canSave}
                    className="bg-accent rounded-lg px-4 py-[9px] font-sans text-[13px] font-semibold text-white transition-[filter] hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {saving ? "Saving…" : saved ? "✓ Saved" : "Save rules"}
                  </button>
                </div>
              </div>
              {saveError && (
                <div
                  className="mx-6 mt-3 rounded-md border px-3 py-2 text-[12px]"
                  style={{
                    borderColor: "#E6D9B8",
                    background: WEAK_BG_SOFT,
                    color: WEAK_TEXT,
                  }}
                >
                  {saveError}
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2">
                {/* Always column */}
                <div className="border-b border-[#EEF1F6] px-6 py-[18px] md:border-r md:border-b-0">
                  <div className="font-mono text-[10.5px] tracking-[0.12em] text-[#8A97AD]">
                    ALWAYS
                  </div>
                  <textarea
                    value={instructions.global}
                    onChange={(e) => setInstructions((s) => ({ ...s, global: e.target.value }))}
                    placeholder='e.g. "Write like John talks — short sentences, no corporate filler, never mention competitors."'
                    className="mt-[10px] min-h-[74px] w-full resize-y rounded-[9px] border border-[#D4DBE7] px-[14px] py-3 font-sans text-[13px] leading-[1.55] text-[#0A1E3C] placeholder:text-[#B0BACB] focus:border-[#B7C3D6] focus:outline-none"
                  />
                </div>

                {/* Per-platform column */}
                <div className="px-6 py-[18px]">
                  <div className="flex items-baseline justify-between">
                    <span className="font-mono text-[10.5px] tracking-[0.12em] text-[#8A97AD]">
                      PER-PLATFORM
                    </span>
                    <span className="text-[11.5px] text-[#8A97AD]">
                      {configuredRules.length} of {platforms.length}
                    </span>
                  </div>

                  <div className="mt-[10px] flex flex-col gap-2">
                    {configuredRules.map((k) => {
                      const p = platformByKey.get(k)!;
                      return (
                        <div
                          key={k}
                          className="flex items-start gap-[10px] rounded-[9px] border border-[#E4E9F1] bg-[#FDFEFE] px-[14px] py-[11px]"
                        >
                          <div className="flex-none">
                            <PlatformBadge platform={p} size="sm" />
                          </div>
                          <div className="flex-1">
                            <div className="text-[11.5px] font-bold text-[#41506B]">{p.name}</div>
                            <input
                              value={instructions.perPlatform[k] ?? ""}
                              onChange={(e) =>
                                setInstructions((s) => ({
                                  ...s,
                                  perPlatform: { ...s.perPlatform, [k]: e.target.value },
                                }))
                              }
                              placeholder={`Add a rule for ${p.name}…`}
                              autoFocus={
                                addingFor.has(k) && (instructions.perPlatform[k] ?? "").length === 0
                              }
                              className="mt-1 w-full border-0 bg-transparent p-0 font-sans text-[13px] leading-[1.5] text-[#0A1E3C] placeholder:text-[#B0BACB] focus:outline-none"
                            />
                          </div>
                          <button
                            type="button"
                            onClick={() => removePlatformRule(k)}
                            className="flex-none text-[11.5px] font-semibold text-[#8A97AD] hover:text-[#41506B]"
                          >
                            Remove
                          </button>
                        </div>
                      );
                    })}

                    {/* Add-platform-rule affordance — collapses when every
                        platform already has a rule. */}
                    {unconfiguredPlatforms.length > 0 && (
                      <div className="rounded-[9px] border-[1.5px] border-dashed border-[#D4DBE7] px-3 py-[10px]">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[12.5px] font-semibold text-[#41506B]">
                            ＋ Add a rule for
                          </span>
                          {unconfiguredPlatforms.map((p) => (
                            <button
                              key={p.key}
                              type="button"
                              onClick={() => openAddFor(p.key)}
                              className="rounded-full border border-[#E4E9F1] bg-white px-[11px] py-[4px] font-sans text-[12px] font-semibold text-[#41506B] hover:border-[#B7C3D6]"
                            >
                              {p.name}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </section>

            {/* Approved samples */}
            <section className="overflow-hidden rounded-[12px] border border-[#E4E9F1] bg-white">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#EEF1F6] px-6 py-[18px]">
                <div className="flex items-baseline gap-[10px]">
                  <span className="text-[15px] font-bold text-[#0A1E3C]">Approved samples</span>
                  <span className="font-mono text-[12px] text-[#8A97AD]">
                    {profile.samples.length}
                  </span>
                </div>
                {profile.samples.length > 0 && (
                  <div className="flex flex-wrap gap-[6px]">
                    {filterChips.map((chip) => {
                      const selected = chip.key === filter;
                      return (
                        <button
                          key={chip.key}
                          type="button"
                          onClick={() => setFilter(chip.key)}
                          className="rounded-full px-[12px] py-[6px] text-[12.5px] font-semibold"
                          style={
                            selected
                              ? { background: "#0A1E3C", color: "#fff" }
                              : {
                                  background: "#fff",
                                  color: "#41506B",
                                  border: "1px solid #E4E9F1",
                                }
                          }
                        >
                          {chip.label}
                          <span
                            className="ml-1 font-mono text-[10.5px]"
                            style={{ opacity: 0.7, fontWeight: 500 }}
                          >
                            {chip.count}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {profile.samples.length === 0 ? (
                <div className="px-6 py-12 text-center">
                  <div className="text-[15px] font-bold text-[#0A1E3C]">
                    No approved samples yet
                  </div>
                  <p className="mx-auto mt-2 max-w-[440px] text-[13px] text-[#8A97AD]">
                    Each time you approve a generated output, we save it here as a training sample.
                    The engine learns {client.host}&apos;s voice from these — the more approvals,
                    the sharper the next draft.
                  </p>
                  <Link
                    href={`/episodes/new?showId=${encodeURIComponent(client.key)}`}
                    className="bg-accent mt-4 inline-flex items-center gap-[7px] rounded-lg px-[14px] py-[9px] font-sans text-[13px] font-semibold text-white no-underline transition-[filter] hover:brightness-95"
                  >
                    Generate an episode
                  </Link>
                </div>
              ) : (
                <div className="flex flex-col">
                  {visibleSamples.map((s, i) => {
                    const p = platformByKey.get(s.platform);
                    if (!p) return null;
                    const isLast = i === visibleSamples.length - 1;
                    return (
                      <div
                        key={`${s.platform}-${i}`}
                        className={`grid items-center gap-4 px-6 py-[13px] ${
                          !isLast ? "border-b border-[#F4F6FA]" : ""
                        }`}
                        style={{ gridTemplateColumns: "150px minmax(0, 1fr) auto auto" }}
                      >
                        <div className="flex items-center gap-[9px]">
                          <PlatformBadge platform={p} size="sm" />
                          <span className="text-[12.5px] font-bold text-[#0A1E3C]">{p.name}</span>
                        </div>
                        <div className="truncate text-[13px] text-[#41506B]">{s.text}</div>
                        <span className="font-mono text-[10.5px] tracking-[0.04em] text-[#B0BACB] uppercase">
                          {s.episode ? s.episode : ""}
                          {s.episode && s.date ? " · " : ""}
                          {s.date}
                        </span>
                        <button
                          type="button"
                          aria-label="Sample actions"
                          className="text-[13px] font-semibold text-[#8A97AD] hover:text-[#41506B]"
                        >
                          ···
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Single segment of the three-part strength ladder shown on the dark
 * training card. `weight` sets flex-grow (the ref uses 5:10:6). `filled`
 * is 0–1: any partial value renders an amber inner bar on a translucent
 * white track; a full 1 shows a solid amber bar so the visual progression
 * across segments is legible.
 */
function LadderSegment({
  weight,
  filled,
  color,
  active,
}: {
  weight: number;
  filled: number;
  color: string;
  active: boolean;
}) {
  const clamped = Math.max(0, Math.min(1, filled));
  return (
    <div
      className="h-[6px] overflow-hidden rounded-full"
      style={{
        flexGrow: weight,
        flexBasis: 0,
        background: active && clamped === 1 ? color : "rgba(255,255,255,0.14)",
        position: "relative",
      }}
    >
      {clamped > 0 && clamped < 1 && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            width: `${clamped * 100}%`,
            background: color,
          }}
        />
      )}
    </div>
  );
}

function coverageBlurb(perPlatform: Record<PlatformKey, number>, totalPlatforms: number): string {
  const buckets = platforms.reduce(
    (acc, p) => {
      const n = perPlatform[p.key] ?? 0;
      const lvl = voiceLabel(n);
      acc[lvl] += 1;
      return acc;
    },
    { Weak: 0, Developing: 0, Strong: 0 } as Record<"Weak" | "Developing" | "Strong", number>,
  );
  if (buckets.Strong === totalPlatforms) return "Every platform is Strong.";
  if (buckets.Weak === totalPlatforms) return "All platforms Weak — ~3 samples each moves them up";
  const parts: string[] = [];
  if (buckets.Strong > 0) parts.push(`${buckets.Strong} Strong`);
  if (buckets.Developing > 0) parts.push(`${buckets.Developing} Developing`);
  if (buckets.Weak > 0) parts.push(`${buckets.Weak} Weak`);
  return parts.join(" · ");
}

/**
 * Best-effort humanization of the client key when a proper client name
 * isn't threaded through. Sample-data clients (`northwind`, etc.) render
 * as their capitalized slug; live-mode cuids surface as an empty hint.
 */
function clientNameFromKey(clientKey: string): string {
  if (clientKey.length === 0) return "";
  // Prisma cuid — starts with `c` then 24 alphanumerics. Skip prettification.
  if (/^c[a-z0-9]{20,}$/i.test(clientKey)) return "";
  return clientKey
    .split(/[-_]/)
    .map((part) => (part.length === 0 ? part : part[0].toUpperCase() + part.slice(1)))
    .join(" ");
}

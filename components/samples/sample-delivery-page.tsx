import Link from "next/link";
import { platforms, type PlatformKey } from "@/lib/sample-data/platforms";
import type { ResolvedSample } from "@/lib/samples/registry";

/**
 * Public "sample delivery" surface. Renders one curated
 * episode's full launch kit (seven text posts + three clip tiles + three
 * artwork tiles + three audiogram tiles) so cold traffic can see what a
 * real deliverable looks like without signing up.
 *
 * The seven text outputs are REAL — sourced from
 * `lib/sample-data/episode-outputs.ts` (same content that powers
 * sample-data mode inside the app). Clips, artwork, and audiograms are
 * REPRESENTATIVE — SVG mockups + real hook lines / concepts, because
 * generating actual media for a marketing page has diminishing returns
 * compared to a well-composed illustration.
 *
 * That distinction is disclosed inline (see the `<Disclosure>` block)
 * so cold-traffic buyers aren't misled.
 */

// ============================================================
// Design tokens — mirror the landing palette
// ============================================================
const INK = "#0A1E3C";
const MUTED = "#41506B";
const MUTED_2 = "#8A97AD";
const MUTED_3 = "#B0BACB";
const BORDER = "#E4E9F1";
const BORDER_SOFT = "#EEF1F6";
const CANVAS = "#F6F8FC";

const PLATFORM_LOOKUP = Object.fromEntries(platforms.map((p) => [p.key, p])) as Record<
  PlatformKey,
  (typeof platforms)[number]
>;

export function SampleDeliveryPage({ sample }: { sample: ResolvedSample }) {
  return (
    <div className="w-full overflow-x-hidden bg-white">
      <Hero sample={sample} />
      <PostsSection sample={sample} />
      <ClipsSection sample={sample} />
      <ArtworkSection sample={sample} />
      <AudiogramsSection sample={sample} />
      <Disclosure />
      <FinalCTA />
    </div>
  );
}

// ============================================================
// Hero — episode header
// ============================================================

function Hero({ sample }: { sample: ResolvedSample }) {
  return (
    <section
      className="px-5 pt-10 pb-10 sm:px-8 sm:pt-14 lg:px-14 lg:pt-16"
      style={{ background: `linear-gradient(180deg,#fff 0%,${CANVAS} 100%)` }}
    >
      <div className="mx-auto" style={{ maxWidth: 1180 }}>
        <div
          className="mb-4 font-mono text-[11px] font-semibold uppercase"
          style={{ letterSpacing: "0.14em", color: "var(--color-accent)" }}
        >
          Sample launch kit
        </div>
        <h1
          className="m-0 text-[30px] leading-[1.08] sm:text-[38px] lg:text-[46px]"
          style={{
            fontFamily: "var(--font-display)",
            fontWeight: 800,
            letterSpacing: "-0.03em",
            color: INK,
            maxWidth: 900,
          }}
        >
          {sample.episodeTitle}
        </h1>
        <div
          className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13.5px]"
          style={{ color: MUTED_2 }}
        >
          <span className="font-semibold" style={{ color: MUTED }}>
            {sample.show.name}
          </span>
          <span>·</span>
          <span>with {sample.show.host}</span>
          <span>·</span>
          <span>{sample.episodeMeta}</span>
        </div>
        <p
          className="m-0 mt-5 max-w-[720px] text-[16px] leading-[1.65] sm:text-[17px]"
          style={{ color: MUTED }}
        >
          {sample.tagline}
        </p>

        {/* Kit summary chips */}
        <div className="mt-6 flex flex-wrap gap-2">
          <KitChip label="7 written posts" />
          <KitChip label="3 vertical clips" />
          <KitChip label="Hero artwork · 3 aspects" />
          <KitChip label="3 audiograms" />
        </div>
      </div>
    </section>
  );
}

function KitChip({ label }: { label: string }) {
  return (
    <span
      className="rounded-full px-[12px] py-[6px] font-mono text-[11.5px] font-semibold"
      style={{
        background: "var(--color-accent-soft)",
        color: "var(--color-accent)",
      }}
    >
      {label}
    </span>
  );
}

// ============================================================
// Written posts — the 7 real outputs
// ============================================================

function PostsSection({ sample }: { sample: ResolvedSample }) {
  return (
    <section
      className="px-5 py-12 sm:px-8 sm:py-16 lg:px-14 lg:py-20"
      style={{ background: "#fff", borderTop: `1px solid ${BORDER_SOFT}` }}
    >
      <div className="mx-auto" style={{ maxWidth: 1180 }}>
        <SectionHeader
          kicker="Written"
          title="Seven platform posts, in-voice."
          note="Real output — the same generator ships this content on every episode."
        />
        <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2">
          {sample.outputs.map((o) => {
            const meta = PLATFORM_LOOKUP[o.key];
            return (
              <div
                key={o.id}
                className="rounded-[14px] p-5 sm:p-6"
                style={{ border: `1px solid ${BORDER}`, background: "#fff" }}
              >
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-[10px]">
                    <span
                      className="grid h-[28px] w-[28px] place-items-center rounded-md text-[12px] font-bold"
                      style={{
                        background: meta.badgeBg,
                        color: meta.badgeColor,
                        border: `1px solid ${meta.badgeBorder}`,
                      }}
                    >
                      {meta.badge}
                    </span>
                    <div>
                      <div className="text-[13.5px] font-semibold" style={{ color: INK }}>
                        {meta.name}
                      </div>
                      <div className="text-[11.5px]" style={{ color: MUTED_3 }}>
                        {meta.desc}
                      </div>
                    </div>
                  </div>
                  <span
                    className="rounded-full px-[10px] py-[3px] font-mono text-[10.5px] font-semibold uppercase"
                    style={{
                      letterSpacing: "0.08em",
                      background: CANVAS,
                      color: MUTED_2,
                    }}
                  >
                    Voice-true
                  </span>
                </div>
                <pre
                  className="m-0 rounded-[10px] p-4 text-[13px] leading-[1.6] whitespace-pre-wrap"
                  style={{
                    background: CANVAS,
                    color: "#2C3A52",
                    fontFamily: "var(--font-sans, inherit)",
                    border: `1px solid ${BORDER_SOFT}`,
                  }}
                >
                  {o.content}
                </pre>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ============================================================
// Clips — 3 vertical 9:16 mock tiles
// ============================================================

function ClipsSection({ sample }: { sample: ResolvedSample }) {
  return (
    <section
      className="px-5 py-12 sm:px-8 sm:py-16 lg:px-14 lg:py-20"
      style={{ background: CANVAS, borderTop: `1px solid ${BORDER_SOFT}` }}
    >
      <div className="mx-auto" style={{ maxWidth: 1180 }}>
        <SectionHeader
          kicker="Video"
          title="Three vertical clips, captions burned in."
          note="Mock render — real clips ship as 9:16 MP4s ready for Reels, Shorts, and TikTok."
        />
        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3 sm:gap-5">
          {sample.clips.map((clip, i) => (
            <div
              key={i}
              className="overflow-hidden rounded-[14px]"
              style={{
                border: `1px solid ${BORDER}`,
                background: "#fff",
                boxShadow: "0 12px 30px -18px rgba(10,30,60,0.18)",
              }}
            >
              <ClipPoster hookLine={clip.hookLine} />
              <div className="p-4">
                <div
                  className="flex items-center justify-between font-mono text-[11.5px]"
                  style={{ color: MUTED_2 }}
                >
                  <span>{clip.spanSeconds}s · 9:16</span>
                  <span>score {clip.score.toFixed(2)}</span>
                </div>
                <p className="m-0 mt-2 text-[13px] leading-[1.5]" style={{ color: MUTED }}>
                  &ldquo;{clip.quote}&rdquo;
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/**
 * SVG-composed 9:16 poster tile. Show name + a big centered hook line
 * over a brand-tinted gradient. Not a screenshot — an illustrative
 * placeholder that reads "this is what a vertical clip looks like."
 */
function ClipPoster({ hookLine }: { hookLine: string }) {
  return (
    <div
      className="relative overflow-hidden"
      style={{
        aspectRatio: "9 / 16",
        background: `linear-gradient(160deg, ${INK} 0%, #14284A 60%, #1B345E 100%)`,
      }}
    >
      {/* faint noise dots */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: "radial-gradient(rgba(255,255,255,0.05) 1px, transparent 1px)",
          backgroundSize: "18px 18px",
        }}
      />
      {/* top-right timecode */}
      <div
        className="absolute top-3 right-3 rounded-md px-2 py-1 font-mono text-[10px] font-semibold"
        style={{
          background: "rgba(255,255,255,0.12)",
          color: "#DBE4F5",
          letterSpacing: "0.06em",
        }}
      >
        REEL
      </div>
      {/* caption bar, mimics burnt-in ASS caption */}
      <div className="absolute inset-x-4 bottom-6">
        <div
          className="rounded-[8px] px-3 py-2 text-center font-bold"
          style={{
            background: "rgba(0,0,0,0.55)",
            color: "#fff",
            fontSize: 13,
            lineHeight: 1.35,
            border: "1px solid rgba(255,255,255,0.16)",
            textShadow: "0 2px 6px rgba(0,0,0,0.5)",
          }}
        >
          {hookLine}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Artwork — 3 aspect-ratio mock frames
// ============================================================

function ArtworkSection({ sample }: { sample: ResolvedSample }) {
  return (
    <section
      className="px-5 py-12 sm:px-8 sm:py-16 lg:px-14 lg:py-20"
      style={{ background: "#fff", borderTop: `1px solid ${BORDER_SOFT}` }}
    >
      <div className="mx-auto" style={{ maxWidth: 1180 }}>
        <SectionHeader
          kicker="Visual"
          title="Hero artwork · three aspect ratios."
          note="Concept only — real deliveries ship PNGs at 16:9 for YouTube, 1:1 for Apple Podcasts + Instagram, 9:16 for vertical."
        />
        <div className="mt-8 grid grid-cols-1 gap-5 md:grid-cols-3">
          {sample.artwork.map((a) => (
            <div
              key={a.aspect}
              className="rounded-[14px] p-5"
              style={{ border: `1px solid ${BORDER}`, background: "#fff" }}
            >
              <ArtworkFrame aspect={a.aspect} />
              <div className="mt-4">
                <div
                  className="font-mono text-[11px] font-semibold uppercase"
                  style={{ letterSpacing: "0.12em", color: "var(--color-accent)" }}
                >
                  {a.aspect}
                </div>
                <p className="m-0 mt-2 text-[13px] leading-[1.55]" style={{ color: MUTED }}>
                  {a.concept}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ArtworkFrame({ aspect }: { aspect: "16:9" | "1:1" | "9:16" }) {
  const style: React.CSSProperties = {
    aspectRatio: aspect.replace(":", " / "),
    background: `linear-gradient(135deg, #F1E4C4 0%, #E9CFA0 40%, #3A5BA0 120%)`,
    border: `1px solid ${BORDER}`,
  };
  return (
    <div className="relative overflow-hidden rounded-[10px]" style={style}>
      {/* Grid overlay */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(0deg, rgba(10,30,60,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(10,30,60,0.1) 1px, transparent 1px)",
          backgroundSize: "36px 36px",
        }}
      />
      {/* Corner mark */}
      <div
        className="absolute bottom-3 left-3 rounded-md px-2 py-1 font-mono text-[10px] font-semibold"
        style={{
          background: "rgba(255,255,255,0.7)",
          color: INK,
          letterSpacing: "0.08em",
        }}
      >
        {aspect}
      </div>
    </div>
  );
}

// ============================================================
// Audiograms — 3 waveform + caption tiles
// ============================================================

function AudiogramsSection({ sample }: { sample: ResolvedSample }) {
  return (
    <section
      className="px-5 py-12 sm:px-8 sm:py-16 lg:px-14 lg:py-20"
      style={{ background: CANVAS, borderTop: `1px solid ${BORDER_SOFT}` }}
    >
      <div className="mx-auto" style={{ maxWidth: 1180 }}>
        <SectionHeader
          kicker="Audio"
          title="Audiograms · one per social output."
          note="Mock render — real audiograms ship as vertical MP4s with waveform + burnt-in captions, one per social post."
        />
        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3 sm:gap-5">
          {sample.audiograms.map((a, i) => {
            const meta = PLATFORM_LOOKUP[a.platform];
            return (
              <div
                key={`${a.platform}-${i}`}
                className="overflow-hidden rounded-[14px]"
                style={{
                  border: `1px solid ${BORDER}`,
                  background: "#fff",
                  boxShadow: "0 12px 30px -18px rgba(10,30,60,0.14)",
                }}
              >
                <AudiogramPoster caption={a.captionPreview} platformBadge={meta.badge} />
                <div className="p-4">
                  <div
                    className="flex items-center justify-between font-mono text-[11.5px]"
                    style={{ color: MUTED_2 }}
                  >
                    <span>{meta.name}</span>
                    <span>{a.spanSeconds}s · 9:16</span>
                  </div>
                  <p className="m-0 mt-2 text-[13px] leading-[1.5]" style={{ color: MUTED }}>
                    &ldquo;{a.captionPreview}&rdquo;
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function AudiogramPoster({ caption, platformBadge }: { caption: string; platformBadge: string }) {
  // 30 deterministic bar heights so the waveform renders identically SSR
  // + client and doesn't reflow on hydration.
  const wave = [
    22, 34, 18, 40, 26, 44, 20, 32, 46, 24, 36, 30, 42, 28, 38, 22, 34, 18, 40, 26, 44, 20, 32, 46,
    24, 36, 30, 42, 28, 38,
  ];
  return (
    <div
      className="relative overflow-hidden"
      style={{
        aspectRatio: "9 / 16",
        background: `radial-gradient(circle at 30% 20%, rgba(233,207,160,0.35) 0%, rgba(233,207,160,0) 60%), linear-gradient(160deg, ${INK} 0%, #1B345E 100%)`,
      }}
    >
      {/* Platform mark, top-left */}
      <div
        className="absolute top-3 left-3 grid h-[26px] w-[26px] place-items-center rounded-md text-[10px] font-bold"
        style={{ background: "#fff", color: INK }}
      >
        {platformBadge}
      </div>
      {/* Waveform, centered horizontally */}
      <div className="absolute inset-x-6 top-1/2 flex -translate-y-1/2 items-center justify-center gap-[3px]">
        {wave.map((h, i) => (
          <div
            key={i}
            className="rounded-[1.5px]"
            style={{
              width: 3,
              height: h,
              background: i % 2 === 0 ? "#7FE3B0" : "rgba(255,255,255,0.35)",
            }}
          />
        ))}
      </div>
      {/* Burnt-in caption */}
      <div className="absolute inset-x-4 bottom-6">
        <div
          className="rounded-[8px] px-3 py-2 text-center font-bold"
          style={{
            background: "rgba(0,0,0,0.55)",
            color: "#fff",
            fontSize: 12.5,
            lineHeight: 1.35,
            border: "1px solid rgba(255,255,255,0.16)",
          }}
        >
          {caption}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Disclosure + Final CTA
// ============================================================

function Disclosure() {
  return (
    <section
      className="px-5 py-8 sm:px-8 sm:py-10 lg:px-14"
      style={{ background: "#fff", borderTop: `1px solid ${BORDER_SOFT}` }}
    >
      <div
        className="mx-auto rounded-[12px] px-5 py-4 text-[12.5px] leading-[1.55]"
        style={{
          maxWidth: 940,
          background: CANVAS,
          border: `1px solid ${BORDER}`,
          color: MUTED,
        }}
      >
        <strong className="font-semibold" style={{ color: INK }}>
          About this sample:
        </strong>{" "}
        The seven written posts are real output from the Repodcast voice engine, using this
        episode&apos;s transcript. The clip, artwork, and audiogram tiles are stylized placeholders
        — the actual deliverables ship as MP4 and PNG files. Sign up to try the same pipeline on
        your own episode.
      </div>
    </section>
  );
}

function FinalCTA() {
  return (
    <section
      className="px-5 py-14 text-white sm:px-8 sm:py-16 lg:px-14 lg:py-[76px]"
      style={{ background: INK }}
    >
      <div
        className="mx-auto flex flex-wrap items-center justify-between gap-6"
        style={{ maxWidth: 1180 }}
      >
        <div>
          <div
            className="mb-3 text-[28px] leading-[1.14] font-extrabold sm:text-[32px] sm:leading-[1.12]"
            style={{ letterSpacing: "-0.02em" }}
          >
            Get this for every episode of your show.
          </div>
          <p className="m-0 max-w-[540px] text-[15px] leading-[1.6]" style={{ color: "#A9B8D4" }}>
            One transcript in, a full launch kit out — in your show&apos;s voice. Start on any plan;
            switch or cancel from Settings.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/pricing"
            className="rounded-[9px] px-5 py-3 text-[14px] font-semibold text-white no-underline transition-[filter] hover:brightness-110 sm:px-6 sm:py-[13px] sm:text-[15px]"
            style={{ background: "var(--color-accent)" }}
          >
            See pricing
          </Link>
          <Link
            href="/sign-up"
            className="rounded-[9px] px-5 py-3 text-[14px] font-semibold no-underline sm:px-6 sm:py-[13px] sm:text-[15px]"
            style={{
              background: "rgba(255,255,255,0.08)",
              color: "#fff",
              border: "1px solid rgba(255,255,255,0.18)",
            }}
          >
            Start free trial
          </Link>
        </div>
      </div>
    </section>
  );
}

// ============================================================
// Shared display helpers
// ============================================================

function SectionHeader({ kicker, title, note }: { kicker: string; title: string; note: string }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div style={{ maxWidth: 620 }}>
        <div
          className="mb-2 font-mono text-[11px] font-semibold uppercase"
          style={{ letterSpacing: "0.14em", color: "var(--color-accent)" }}
        >
          {kicker}
        </div>
        <h2
          className="m-0 text-[24px] leading-[1.14] sm:text-[28px] lg:text-[32px]"
          style={{
            fontFamily: "var(--font-display)",
            fontWeight: 800,
            letterSpacing: "-0.02em",
            color: INK,
          }}
        >
          {title}
        </h2>
      </div>
      <p className="m-0 max-w-[380px] text-[13px] leading-[1.55]" style={{ color: MUTED_2 }}>
        {note}
      </p>
    </div>
  );
}

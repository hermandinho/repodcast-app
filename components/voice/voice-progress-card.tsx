import type { VoiceProgressResult, VoiceProgressPoint } from "@/lib/voice-progress-shape";

/**
 * Voice-progress card — the single feature that makes the voice engine
 * sell itself: a per-show line showing **% posted unedited** climbing
 * over episodes. Renders inline SVG (no chart-library dep) so the
 * bundle stays lean; the line is one small trend, not a data-viz suite.
 *
 * Three surfaces the render adapts to:
 *   - **Empty** — no shipped outputs since edit tracking landed. Show a
 *     "Collecting data" prompt, no chart.
 *   - **Low-data (1 episode)** — headline % but no line (a 1-point line
 *     is meaningless).
 *   - **Series** — headline % on top, inline-SVG line with milestone
 *     markers at the episode where cumulative shipped-outputs crossed
 *     Developing (6) / Strong (16).
 *
 * Copy leads with the north-star label ("% posted unedited") so the
 * whole app tells one consistent story.
 */

const INK = "#0A1E3C";
const MUTED = "#41506B";
const LIGHT_MUTED = "#8A97AD";
const CARD_BORDER = "#E4E9F1";
const ROW_BORDER = "#EEF1F6";
const ACCENT = "#3A5BA0";
const ACCENT_SOFT = "#EEF2FB";
const STRONG_TEXT = "#1E7A47";
const AMBER_TEXT = "#A06D12";

// SVG geometry — the card's chart body is a fixed viewport that scales
// to the container width via `preserveAspectRatio`. All coords work
// against this so the arithmetic reads cleanly.
const CHART_W = 260;
const CHART_H = 96;
const PADDING_X = 6;
const PADDING_TOP = 8;
const PADDING_BOTTOM = 14;

export function VoiceProgressCard({ progress }: { progress: VoiceProgressResult }) {
  const { series, headline, milestones } = progress;

  return (
    <div
      className="rounded-[14px] border bg-white"
      style={{ borderColor: CARD_BORDER, padding: "18px 22px" }}
    >
      <div className="flex items-center justify-between">
        <span
          className="font-mono"
          style={{
            fontSize: 10.5,
            letterSpacing: "0.12em",
            color: LIGHT_MUTED,
            fontWeight: 600,
          }}
        >
          VOICE PROGRESS
        </span>
        <HeadlineBadge value={headline.postReadyRate} />
      </div>

      <div style={{ marginTop: 10 }}>
        {series.length === 0 ? (
          <EmptyState />
        ) : series.length === 1 ? (
          <LowDataState point={series[0]} />
        ) : (
          <ChartBody series={series} milestones={milestones} />
        )}
      </div>

      <p
        style={{
          fontSize: 11.5,
          lineHeight: 1.5,
          color: LIGHT_MUTED,
          marginTop: 12,
          marginBottom: 0,
        }}
      >
        % posted unedited — the share of outputs you shipped without meaningful edits. This is the
        number that climbs as the voice learns.
      </p>
    </div>
  );
}

// ============================================================
// Headline
// ============================================================

function HeadlineBadge({ value }: { value: number | null }) {
  if (value === null) {
    return (
      <span
        className="font-mono"
        style={{
          fontSize: 10,
          letterSpacing: "0.08em",
          color: LIGHT_MUTED,
          background: ROW_BORDER,
          padding: "3px 8px",
          borderRadius: 99,
          fontWeight: 600,
        }}
      >
        NO DATA YET
      </span>
    );
  }
  const pct = Math.round(value * 100);
  const color = pct >= 80 ? STRONG_TEXT : pct >= 50 ? ACCENT : AMBER_TEXT;
  return (
    <span
      style={{
        fontSize: 22,
        fontWeight: 800,
        color,
        letterSpacing: "-0.02em",
        lineHeight: 1,
      }}
    >
      {pct}
      <span
        style={{
          fontSize: 12,
          fontWeight: 700,
          color,
          marginLeft: 2,
        }}
      >
        %
      </span>
    </span>
  );
}

// ============================================================
// Empty / low-data states
// ============================================================

function EmptyState() {
  return (
    <div
      className="rounded-[10px] border border-dashed"
      style={{
        borderColor: CARD_BORDER,
        background: "#FDFEFE",
        padding: "18px 14px",
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: 12.5, color: MUTED, fontWeight: 600 }}>Collecting data</div>
      <div style={{ fontSize: 11.5, color: LIGHT_MUTED, marginTop: 4, lineHeight: 1.45 }}>
        Approve outputs across a couple of episodes to see the curve.
      </div>
    </div>
  );
}

function LowDataState({ point }: { point: VoiceProgressPoint }) {
  const pct = Math.round(point.postReadyRate * 100);
  return (
    <div
      className="rounded-[10px] border border-dashed"
      style={{
        borderColor: CARD_BORDER,
        background: "#FDFEFE",
        padding: "14px",
      }}
    >
      <div style={{ fontSize: 12, color: LIGHT_MUTED }}>
        First episode landed at <b style={{ color: INK }}>{pct}% post-ready</b>.
      </div>
      <div style={{ fontSize: 11.5, color: LIGHT_MUTED, marginTop: 4 }}>
        One more episode and the curve starts drawing itself.
      </div>
    </div>
  );
}

// ============================================================
// Chart body — inline SVG line, milestone markers, tiny y-axis
// ============================================================

function ChartBody({
  series,
  milestones,
}: {
  series: readonly VoiceProgressPoint[];
  milestones: { developing: number | null; strong: number | null };
}) {
  const innerW = CHART_W - PADDING_X * 2;
  const innerH = CHART_H - PADDING_TOP - PADDING_BOTTOM;
  const n = series.length;
  // Two-point line is a special-case: use 100% of the width, not `n-1`.
  const xFor = (i: number) => PADDING_X + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const yFor = (rate: number) => PADDING_TOP + innerH * (1 - rate);

  const linePath = series
    .map(
      (p, i) => `${i === 0 ? "M" : "L"} ${xFor(i).toFixed(2)} ${yFor(p.postReadyRate).toFixed(2)}`,
    )
    .join(" ");

  // Filled area under the line for visual weight — same path plus a
  // baseline stroke back to the origin.
  const areaPath = `${linePath} L ${xFor(n - 1).toFixed(2)} ${(CHART_H - PADDING_BOTTOM).toFixed(2)} L ${xFor(0).toFixed(2)} ${(CHART_H - PADDING_BOTTOM).toFixed(2)} Z`;

  return (
    <div>
      <svg
        role="img"
        aria-label={`% posted unedited across ${n} episodes`}
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        preserveAspectRatio="none"
        style={{ width: "100%", height: 96, display: "block" }}
      >
        {/* Baselines at 0 / 50 / 100 % */}
        {[0, 0.5, 1].map((r) => (
          <line
            key={r}
            x1={PADDING_X}
            x2={CHART_W - PADDING_X}
            y1={yFor(r)}
            y2={yFor(r)}
            stroke={ROW_BORDER}
            strokeWidth={r === 0.5 ? 0.6 : 0.8}
            strokeDasharray={r === 0.5 ? "2 3" : undefined}
          />
        ))}

        {/* Milestone verticals — placed at the episode index (1-based).
            The line is soft and labelled so it reads as narrative, not
            noise. */}
        {milestones.developing !== null ? (
          <MilestoneLine xVal={xFor(milestones.developing - 1)} label="Developing" color={ACCENT} />
        ) : null}
        {milestones.strong !== null ? (
          <MilestoneLine xVal={xFor(milestones.strong - 1)} label="Strong" color={STRONG_TEXT} />
        ) : null}

        {/* Area + line */}
        <path d={areaPath} fill={ACCENT_SOFT} opacity={0.9} />
        <path
          d={linePath}
          fill="none"
          stroke={ACCENT}
          strokeWidth={1.75}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Point dots */}
        {series.map((p, i) => (
          <circle
            key={p.episodeId}
            cx={xFor(i)}
            cy={yFor(p.postReadyRate)}
            r={2.2}
            fill="#fff"
            stroke={ACCENT}
            strokeWidth={1.4}
          >
            <title>{`Ep ${p.episodeIndex} · ${Math.round(p.postReadyRate * 100)}% (${p.sampleCount} output${p.sampleCount === 1 ? "" : "s"})`}</title>
          </circle>
        ))}
      </svg>

      {/* X-axis end labels — Ep 1 / Ep N */}
      <div
        className="flex items-center justify-between"
        style={{
          marginTop: 6,
          fontFamily: "var(--font-revamp-mono)",
          fontSize: 10,
          letterSpacing: "0.06em",
          color: LIGHT_MUTED,
        }}
      >
        <span>EP {series[0].episodeIndex}</span>
        <span>EP {series[n - 1].episodeIndex}</span>
      </div>
    </div>
  );
}

function MilestoneLine({ xVal, label, color }: { xVal: number; label: string; color: string }) {
  return (
    <g>
      <line
        x1={xVal}
        x2={xVal}
        y1={PADDING_TOP - 2}
        y2={CHART_H - PADDING_BOTTOM}
        stroke={color}
        strokeWidth={0.7}
        strokeDasharray="2 3"
        opacity={0.55}
      />
      <text
        x={xVal}
        y={PADDING_TOP - 2}
        fontSize={8}
        fontFamily="var(--font-revamp-mono)"
        textAnchor="middle"
        fill={color}
        opacity={0.85}
        style={{ letterSpacing: "0.04em" }}
      >
        {label.toUpperCase()}
      </text>
    </g>
  );
}

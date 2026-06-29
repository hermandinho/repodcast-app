import Link from "next/link";
import { notFound } from "next/navigation";
import { PlatformBadge } from "@/components/ui/platform-badge";
import { StatusPill } from "@/components/ui/status-pill";
import { VoiceStrengthBars } from "@/components/ui/voice-strength-bars";
import { ShowDetailActions } from "@/components/shows/show-detail-actions";
import { getShowForUI, getShowEditInitialForUI } from "@/server/data/source";
import { resolveTenantContext } from "@/server/data/tenant";
import { platforms } from "@/lib/sample-data/platforms";
import { voiceLabel, voiceTextColor } from "@/lib/sample-data/voice-strength";

export default async function ShowDetailPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const tenant = await resolveTenantContext();
  const [show, editInitial] = await Promise.all([
    getShowForUI(tenant, key),
    getShowEditInitialForUI(tenant, key),
  ]);
  if (!show) notFound();

  const label = voiceLabel(show.samples);
  const color = voiceTextColor(show.samples);

  return (
    <div className="px-[30px] py-[28px] pb-[60px]">
      <Link
        href="/shows"
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
        All shows
      </Link>

      <div className="border-border bg-surface mb-[18px] flex flex-wrap items-center gap-5 rounded-3xl border p-5">
        {show.artworkUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={show.artworkUrl}
            alt=""
            className="h-[74px] w-[74px] flex-shrink-0 rounded-2xl object-cover"
            style={{ background: "#EEF1F6" }}
          />
        ) : (
          <div
            className="font-display flex h-[74px] w-[74px] flex-shrink-0 items-center justify-center rounded-2xl text-[26px] font-bold text-white"
            style={{
              background: show.avatarBg,
              boxShadow: "inset 0 -22px 36px rgba(0,0,0,.18)",
            }}
          >
            {show.initial}
          </div>
        )}

        <div className="min-w-[200px] flex-1">
          <h1 className="font-display text-ink text-[22px] font-semibold tracking-[-0.4px]">
            {show.name}
          </h1>
          <div className="text-muted mt-[5px] text-[13.5px]">
            Hosted by {show.host} · {show.episodeCount} episodes · Updated {show.lastActivity}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-[14px]">
          <div className="text-right">
            <div className="flex items-center justify-end gap-[9px]">
              <VoiceStrengthBars samples={show.samples} size="lg" />
              <span className="font-sans text-[14px] font-semibold" style={{ color }}>
                {label}
              </span>
            </div>
            <div className="text-muted-2 mt-[5px] text-[12px]">
              {show.samples} approved voice samples
            </div>
          </div>

          <Link
            href={`/episodes/new?showId=${encodeURIComponent(show.key)}`}
            className="bg-accent shadow-card inline-flex items-center gap-[7px] rounded-lg px-4 py-[11px] font-sans text-[13.5px] font-semibold text-white transition-[filter] hover:brightness-95"
            style={{ border: "1px solid rgba(0,0,0,.06)" }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            >
              <path d="M7 3v8M3 7h8" />
            </svg>
            Add episode
          </Link>

          <Link
            href={`/voice/${encodeURIComponent(show.key)}`}
            className="border-border text-muted hover:bg-canvas inline-flex items-center gap-[7px] rounded-lg border bg-white px-4 py-[10px] font-sans text-[13.5px] font-semibold transition-colors"
          >
            Voice profile
          </Link>

          {editInitial && <ShowDetailActions showId={show.key} initial={editInitial} />}
        </div>
      </div>

      <div className="grid items-start gap-[18px] md:grid-cols-2">
        <section className="border-border bg-surface rounded-3xl border p-5">
          <div className="font-display text-ink text-[15px] font-semibold">
            Voice strength by platform
          </div>
          <div className="text-muted-2 mt-[3px] mb-[18px] text-[12.5px]">
            Each platform trains on its own approved outputs.
          </div>
          <div className="flex flex-col gap-[15px]">
            {platforms.map((p) => {
              const n = show.platformSamples[p.key] ?? 0;
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

        <section className="border-border bg-surface rounded-3xl border px-5 pt-5 pb-2">
          <div className="mb-[6px] flex items-center justify-between">
            <div className="font-display text-ink text-[15px] font-semibold">Recent episodes</div>
            <span className="text-muted-2 font-sans text-[12px] font-medium">
              {show.episodeCount} total
            </span>
          </div>
          <div>
            {show.episodes.map((e, i) => (
              <div
                key={i}
                className="flex items-center gap-3 border-t border-[#F0F3F8] px-1 py-[13px] transition-colors hover:bg-[#FAFBFD]"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-ink truncate text-[13px] font-medium">{e.title}</div>
                  <div className="text-muted-2 mt-[2px] text-[11.5px]">
                    {e.date} · {e.outputs}
                  </div>
                </div>
                <StatusPill status={e.status} />
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

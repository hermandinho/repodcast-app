import Link from "next/link";
import { notFound } from "next/navigation";
import { VoiceStrengthBars } from "@/components/ui/voice-strength-bars";
import { NewShowButton } from "@/components/shows/new-show-button";
import { loadCapacityForUI, type PlanCapacityForUI } from "@/server/billing/limits";
import { getClientForUI, isLiveDb, listShowsForClientUI } from "@/server/data/source";
import { resolveTenantContext } from "@/server/data/tenant";
import { voiceLabel, voiceTextColor } from "@/lib/sample-data/voice-strength";

/**
 * Client detail — **Overview tab**. Shared back link + header card + tab nav
 * live in `layout.tsx`; this page only owns the per-tab content.
 */
export default async function ClientOverviewPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const tenant = await resolveTenantContext();
  const client = await getClientForUI(tenant, key);
  if (!client) notFound();

  const [shows, capacity] = await Promise.all([
    listShowsForClientUI(tenant, client.key),
    isLiveDb()
      ? loadCapacityForUI(tenant.agencyId, "shows")
      : Promise.resolve<PlanCapacityForUI | null>(null),
  ]);

  return (
    <section className="border-border bg-surface rounded-3xl border p-5">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <div className="font-display text-ink text-[15px] font-semibold">Shows</div>
          <div className="text-muted-2 mt-[3px] text-[12.5px]">
            {shows.length} podcast{shows.length === 1 ? "" : "s"} under {client.name}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/shows"
            className="text-accent font-sans text-[12.5px] font-semibold hover:underline"
          >
            All shows →
          </Link>
          <NewShowButton
            clients={[{ id: client.key, name: client.name }]}
            defaultClientId={client.key}
            capacity={capacity}
          />
        </div>
      </div>

      {shows.length === 0 ? (
        <div className="border-border bg-canvas text-muted flex flex-col items-center gap-2 rounded-xl border border-dashed py-8 text-center text-[13px]">
          <span>No shows yet for {client.name}.</span>
          <NewShowButton
            clients={[{ id: client.key, name: client.name }]}
            defaultClientId={client.key}
            capacity={capacity}
            variant="inline"
          />
        </div>
      ) : (
        <div className="flex flex-col gap-[10px]">
          {shows.map((s) => (
            <Link
              key={s.key}
              href={`/shows/${s.key}`}
              className="border-border-subtle bg-surface-2 hover:border-border-2 flex items-center gap-3 rounded-xl border p-[14px] transition-colors"
            >
              {s.artworkUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={s.artworkUrl}
                  alt=""
                  className="h-10 w-10 flex-shrink-0 rounded-lg object-cover"
                  style={{ background: "#EEF1F6" }}
                />
              ) : (
                <div
                  className="font-display flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg text-[13px] font-bold text-white"
                  style={{ background: s.avatarBg }}
                >
                  {s.initial}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-ink truncate font-sans text-[14px] font-semibold">
                    {s.name}
                  </span>
                  {s.rssUrl && (
                    <span
                      className="bg-accent-soft text-accent inline-flex flex-shrink-0 items-center gap-[4px] rounded-full px-[7px] py-[2px] font-sans text-[10px] font-semibold tracking-[0.04em] uppercase"
                      title="RSS feed connected"
                    >
                      <span className="h-[5px] w-[5px] rounded-full bg-[#2E9E5B]" />
                      RSS
                    </span>
                  )}
                </div>
                <div className="text-muted-2 mt-[2px] truncate text-[12px]">
                  Hosted by {s.host} · {s.episodeCount} episode
                  {s.episodeCount === 1 ? "" : "s"} · Updated {s.lastActivity}
                </div>
              </div>
              <div className="flex flex-shrink-0 items-center gap-2">
                <VoiceStrengthBars samples={s.samples} size="sm" />
                <span
                  className="font-sans text-[11.5px] font-semibold"
                  style={{ color: voiceTextColor(s.samples) }}
                >
                  {voiceLabel(s.samples)}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * Seed: create the "Northbeam Studio" demo agency with one parent customer
 * Client ("Northwind Media") that owns three Shows (FF / TE / MT). Each Show
 * gets its voice profile, custom instructions, one sample episode, the 7
 * generated outputs, and approved-output voice samples.
 *
 * Idempotent: deletes the demo agency by name first, then re-inserts.
 * Run with: `npm run db:seed` (which is `tsx prisma/seed.ts`).
 */

import { PrismaClient, Platform, OutputStatus } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { loadEnvLocal } from "../scripts/load-env-local";
import { sampleShows } from "../lib/sample-data/shows";
import { sampleEpisodes } from "../lib/sample-data/episode-outputs";
import type { EpisodeStatus as UiEpisodeStatus } from "../lib/sample-data/episode-status";
import type { PlatformKey } from "../lib/sample-data/platforms";
import { voiceProfiles } from "../lib/sample-data/voice-profiles";

// `tsx prisma/seed.ts` doesn't auto-load `.env.local` (only `next dev` does),
// so we load it manually here. Existing process.env wins.
loadEnvLocal();

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.");
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg(url) });

const PLATFORM_BY_KEY: Record<PlatformKey, Platform> = {
  x: Platform.TWITTER,
  li: Platform.LINKEDIN,
  ig: Platform.INSTAGRAM,
  tt: Platform.TIKTOK,
  notes: Platform.SHOW_NOTES,
  blog: Platform.BLOG,
  news: Platform.NEWSLETTER,
};

function mapOutputStatus(status: UiEpisodeStatus): OutputStatus {
  switch (status) {
    case "generating":
      return OutputStatus.GENERATING;
    case "ready":
      return OutputStatus.READY;
    case "review":
      return OutputStatus.IN_REVIEW;
    case "approved":
      return OutputStatus.APPROVED;
    case "scheduled":
      return OutputStatus.SCHEDULED;
    case "failed":
      return OutputStatus.FAILED;
  }
}

const AGENCY_NAME = "Northbeam Studio";
const DEMO_USER_ID = "user_demo_eli";
const DEMO_CLIENT_NAME = "Northwind Media";

async function main() {
  console.log(`[seed] resetting demo agency "${AGENCY_NAME}"`);
  await prisma.agency.deleteMany({ where: { name: AGENCY_NAME } });

  const agency = await prisma.agency.create({
    data: {
      name: AGENCY_NAME,
      plan: "AGENCY",
      members: {
        create: {
          clerkUserId: DEMO_USER_ID,
          role: "OWNER",
          email: "eli@northbeam.studio",
          name: "Eli Mara",
        },
      },
    },
    include: { members: true },
  });
  const owner = agency.members[0];
  console.log(`[seed] agency ${agency.id} + owner ${owner.id}`);

  // Single demo customer that owns all three shows — illustrates the
  // many-shows-per-client case. (Real agencies will likely have multiple
  // clients with 1–3 shows each.)
  const client = await prisma.client.create({
    data: {
      agencyId: agency.id,
      name: DEMO_CLIENT_NAME,
      description: "Independent podcast network with three flagship shows.",
      contactName: "Avery Lin",
      contactEmail: "avery@northwind.media",
    },
  });
  console.log(`[seed]   client ${client.id} (${DEMO_CLIENT_NAME})`);

  for (const sc of sampleShows) {
    const profile = voiceProfiles[sc.key];
    const episode = sampleEpisodes[sc.key];

    const show = await prisma.show.create({
      data: {
        clientId: client.id,
        name: sc.name,
        host: sc.host,
        description: episode?.description ?? null,
        voiceDescription: profile?.description ?? null,
        globalInstructions: profile?.instructions.global ?? null,
        platformInstructions: profile
          ? {
              create: (Object.entries(profile.instructions.perPlatform) as [PlatformKey, string][])
                .filter(([, rule]) => rule && rule.trim().length > 0)
                .map(([key, rule]) => ({
                  platform: PLATFORM_BY_KEY[key],
                  rule,
                })),
            }
          : undefined,
      },
    });
    console.log(`[seed]     show ${sc.key} → ${show.id}`);

    if (episode) {
      const created = await prisma.episode.create({
        data: {
          showId: show.id,
          title: episode.episode,
          // Seeded transcript is just a stub — real transcripts arrive via
          // the Phase 1.6 New Episode flow.
          transcript: `${episode.episode}\n\n${episode.episodeMeta}`,
          source: "PASTE",
          status: "READY",
          outputs: {
            create: episode.outputs.map((o) => {
              const status = mapOutputStatus(o.status);
              return {
                platform: PLATFORM_BY_KEY[o.key],
                content: o.content,
                status,
                quality: o.quality,
                approvedAt: status === "APPROVED" ? new Date() : null,
                approvedByMemberId: status === "APPROVED" ? owner.id : null,
              };
            }),
          },
        },
        include: { outputs: true },
      });

      const approved = created.outputs.filter((o) => o.status === "APPROVED");
      if (approved.length > 0) {
        await prisma.voiceSample.createMany({
          data: approved.map((o) => ({
            showId: show.id,
            platform: o.platform,
            content: o.content,
            generatedOutputId: o.id,
            episodeId: created.id,
          })),
        });
      }
      console.log(
        `[seed]       episode ${created.id} (${created.outputs.length} outputs, ${approved.length} approved)`,
      );
    }

    if (profile && profile.samples.length > 0) {
      await prisma.voiceSample.createMany({
        data: profile.samples.map((s) => ({
          showId: show.id,
          platform: PLATFORM_BY_KEY[s.platform],
          content: s.text,
        })),
      });
      console.log(`[seed]       +${profile.samples.length} voice samples from voice-profiles`);
    }
  }

  console.log("[seed] done");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

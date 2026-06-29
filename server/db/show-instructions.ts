import "server-only";

import { MemberRole, Platform, type Prisma, type ShowPlatformInstruction } from "@prisma/client";
import { z } from "zod";
import { NotFoundError } from "@/server/auth/errors";
import { requireRole, type TenantContext } from "@/server/auth/tenant";
import { prisma } from "./client";

// ============================================================
// Input schema — exposed for the server action to validate against.
// ============================================================

export const voiceInstructionsInput = z.object({
  showId: z.string().min(1),
  global: z.string().max(2000).optional(),
  // Partial because the editor sends only the platforms it knows about;
  // missing keys are treated the same as empty strings (rule deleted).
  perPlatform: z.record(z.nativeEnum(Platform), z.string().max(1000)).optional(),
});

export type VoiceInstructionsInput = {
  showId: string;
  global?: string;
  perPlatform?: Partial<Record<Platform, string>>;
};

const WRITE_ROLES = [MemberRole.OWNER, MemberRole.ADMIN, MemberRole.EDITOR] as const;

/**
 * Persist a show's voice-customisation editor in one transaction:
 *   - `Show.globalInstructions` — overwritten when `global` is provided
 *   - `ShowPlatformInstruction(showId, platform)` — upserted per platform
 *     when the rule is non-empty, deleted when empty/missing
 *
 * Returns the latest set of per-platform rules so the UI can refresh from a
 * single round-trip.
 */
export async function saveVoiceInstructions(
  ctx: TenantContext,
  input: VoiceInstructionsInput,
): Promise<{ perPlatform: ShowPlatformInstruction[] }> {
  requireRole(ctx, WRITE_ROLES);

  // Tenancy check via the parent Client → Agency chain.
  const show = await prisma.show.findFirst({
    where: { id: input.showId, client: { agencyId: ctx.agencyId } },
    select: { id: true },
  });
  if (!show) throw new NotFoundError(`Show ${input.showId} not found`);

  const ops: Prisma.PrismaPromise<unknown>[] = [];

  if (input.global !== undefined) {
    ops.push(
      prisma.show.update({
        where: { id: show.id },
        data: { globalInstructions: input.global.trim() || null },
      }),
    );
  }

  if (input.perPlatform) {
    for (const platform of Object.values(Platform)) {
      const rule = input.perPlatform[platform];
      const trimmed = rule?.trim() ?? "";
      if (trimmed.length === 0) {
        // Empty input deletes the rule rather than storing a blank — keeps
        // the prompt builder from injecting "" into cached blocks.
        ops.push(
          prisma.showPlatformInstruction.deleteMany({
            where: { showId: show.id, platform },
          }),
        );
      } else {
        ops.push(
          prisma.showPlatformInstruction.upsert({
            where: {
              showId_platform: { showId: show.id, platform },
            },
            create: { showId: show.id, platform, rule: trimmed },
            update: { rule: trimmed },
          }),
        );
      }
    }
  }

  await prisma.$transaction(ops);

  const perPlatform = await prisma.showPlatformInstruction.findMany({
    where: { showId: show.id },
    orderBy: { platform: "asc" },
  });
  return { perPlatform };
}

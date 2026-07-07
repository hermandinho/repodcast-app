import "server-only";

import type { SuggestionType } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/server/db/client";

/**
 * Tenant-facing create path for the Feedback button. The reporter must be
 * signed in — we snapshot their email/name + agency + member so the ROOT
 * queue reads correctly even if the member is later removed. Fire-and-forget
 * email notification is layered on top by the caller.
 */

const SUGGESTION_TYPE_VALUES = [
  "BUG",
  "FEATURE_REQUEST",
  "IMPROVEMENT",
  "QUESTION",
  "OTHER",
] as const satisfies readonly SuggestionType[];

export const SUGGESTION_TYPE_OPTIONS: readonly SuggestionType[] = SUGGESTION_TYPE_VALUES;

export const createSuggestionInput = z.object({
  type: z.enum(SUGGESTION_TYPE_VALUES),
  title: z.string().trim().min(3).max(200),
  body: z.string().trim().min(10).max(10_000),
  /** Optional pathname the reporter was on when they hit "Send feedback". */
  contextUrl: z
    .string()
    .trim()
    .max(2_000)
    .startsWith("/")
    .optional()
    .or(z.literal("").transform(() => undefined)),
});
export type CreateSuggestionInput = z.input<typeof createSuggestionInput>;

export type CreateSuggestionContext = {
  agencyId: string | null;
  memberId: string | null;
  reporterEmail: string;
  reporterName: string | null;
};

export async function createSuggestion(
  reporter: CreateSuggestionContext,
  rawInput: CreateSuggestionInput,
): Promise<{ id: string }> {
  const input = createSuggestionInput.parse(rawInput);

  const row = await prisma.suggestion.create({
    data: {
      agencyId: reporter.agencyId,
      memberId: reporter.memberId,
      reporterEmail: reporter.reporterEmail,
      reporterName: reporter.reporterName,
      type: input.type,
      title: input.title,
      body: input.body,
      contextUrl: input.contextUrl ?? null,
    },
    select: { id: true },
  });
  return row;
}

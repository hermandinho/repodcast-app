import "server-only";

import { randomBytes } from "node:crypto";
import type { SupportTicketCategory } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/server/db/client";

/**
 * Durable inbox behind the public `/contact` support form. Anyone can
 * submit — the Turnstile challenge + IP-hash + user-agent snapshot back
 * the anti-abuse story; the row is what ROOT will triage from once the
 * `/root/support` queue lands. Email notifications (admin + submitter)
 * are layered on top by the server action, fire-and-forget so a Resend
 * hiccup can never fail the submission itself.
 */

const SUPPORT_TICKET_CATEGORY_VALUES = [
  "BUG",
  "QUESTION",
  "BILLING",
  "ACCOUNT",
  "FEATURE_REQUEST",
  "OTHER",
] as const satisfies readonly SupportTicketCategory[];

export const SUPPORT_TICKET_CATEGORY_OPTIONS: readonly SupportTicketCategory[] =
  SUPPORT_TICKET_CATEGORY_VALUES;

/**
 * Public form input. Same schema regardless of whether the submitter is
 * signed in — signed-in prefill happens in the client; the auth-derived
 * agencyId/memberId are threaded in through the `context` argument.
 */
export const createSupportTicketInput = z.object({
  name: z.string().trim().min(2, "Add your name.").max(120),
  email: z.string().trim().email("Enter a valid email address.").max(320),
  category: z.enum(SUPPORT_TICKET_CATEGORY_VALUES),
  subject: z.string().trim().min(3, "Add a short subject.").max(200),
  body: z
    .string()
    .trim()
    .min(10, "Give us a bit more detail (at least 10 characters).")
    .max(10_000),
  /** Optional URL — a pathname the submitter was on, or an external link
   *  they're referencing. Accept `/`-prefixed OR http(s)://. */
  contextUrl: z
    .string()
    .trim()
    .max(2_000)
    .refine((v) => v.startsWith("/") || /^https?:\/\//i.test(v), {
      message: "Context URL must start with / or http(s)://",
    })
    .optional()
    .or(z.literal("").transform(() => undefined)),
});
export type CreateSupportTicketInput = z.input<typeof createSupportTicketInput>;

export type CreateSupportTicketContext = {
  /** Set only when the submitter was signed in. */
  agencyId: string | null;
  memberId: string | null;
  /** User-agent snapshot for abuse forensics. Truncated at 500 chars. */
  userAgent: string | null;
  /** Hashed submitter IP. Never store raw IP. */
  ipHash: string | null;
};

// Crockford-ish alphabet — no ambiguous chars (0/O/1/I/L/U). Short,
// human-readable ref codes for the confirmation email + admin subject
// line.
const REF_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
const REF_CODE_LENGTH = 6;

/**
 * `SUP-XXXXXX` — 6 chars from a 30-char alphabet gives ~7.3×10^8 codes.
 * Collision-safe at any realistic ticket volume; the `@unique` constraint
 * on `refCode` is the belt-and-braces.
 */
function generateRefCode(): string {
  const bytes = randomBytes(REF_CODE_LENGTH);
  let out = "";
  for (let i = 0; i < REF_CODE_LENGTH; i++) {
    out += REF_CODE_ALPHABET[bytes[i]! % REF_CODE_ALPHABET.length];
  }
  return `SUP-${out}`;
}

export async function createSupportTicket(
  context: CreateSupportTicketContext,
  rawInput: CreateSupportTicketInput,
): Promise<{ id: string; refCode: string }> {
  const input = createSupportTicketInput.parse(rawInput);

  const row = await prisma.supportTicket.create({
    data: {
      refCode: generateRefCode(),
      name: input.name,
      email: input.email,
      category: input.category,
      subject: input.subject,
      body: input.body,
      contextUrl: input.contextUrl ?? null,
      agencyId: context.agencyId,
      memberId: context.memberId,
      userAgent: context.userAgent?.slice(0, 500) ?? null,
      ipHash: context.ipHash,
    },
    select: { id: true, refCode: true },
  });
  return row;
}

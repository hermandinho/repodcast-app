import type {
  BillingCycle as PrismaBillingCycle,
  ClientStatus as PrismaClientStatus,
  MemberRole as PrismaMemberRole,
  OnboardingStep as PrismaOnboardingStep,
  OutputStatus as PrismaOutputStatus,
  Plan as PrismaPlan,
  Platform as PrismaPlatform,
  TranscriptSource as PrismaTranscriptSource,
} from "@prisma/client";

// Client components can't import enum values from `@prisma/client` — Prisma 7's
// `prisma-client-js` generator emits a `require('.prisma/client/index-browser')`
// stub that Turbopack 16 can't resolve. Mirror the schema enums here so client
// code has runtime access. The `satisfies` clauses anchor each mirror to its
// Prisma type, so drift in `prisma/schema.prisma` surfaces as a type error.

export const Plan = {
  STUDIO: "STUDIO",
  AGENCY: "AGENCY",
  NETWORK: "NETWORK",
} as const satisfies Record<PrismaPlan, PrismaPlan>;
export type Plan = PrismaPlan;

export const MemberRole = {
  OWNER: "OWNER",
  ADMIN: "ADMIN",
  EDITOR: "EDITOR",
  REVIEWER: "REVIEWER",
} as const satisfies Record<PrismaMemberRole, PrismaMemberRole>;
export type MemberRole = PrismaMemberRole;

export const Platform = {
  TWITTER: "TWITTER",
  LINKEDIN: "LINKEDIN",
  INSTAGRAM: "INSTAGRAM",
  TIKTOK: "TIKTOK",
  SHOW_NOTES: "SHOW_NOTES",
  BLOG: "BLOG",
  NEWSLETTER: "NEWSLETTER",
} as const satisfies Record<PrismaPlatform, PrismaPlatform>;
export type Platform = PrismaPlatform;

export const OutputStatus = {
  GENERATING: "GENERATING",
  READY: "READY",
  IN_REVIEW: "IN_REVIEW",
  APPROVED: "APPROVED",
  SCHEDULED: "SCHEDULED",
  PUBLISHED: "PUBLISHED",
  FAILED: "FAILED",
} as const satisfies Record<PrismaOutputStatus, PrismaOutputStatus>;
export type OutputStatus = PrismaOutputStatus;

export const TranscriptSource = {
  PASTE: "PASTE",
  UPLOAD: "UPLOAD",
  RSS: "RSS",
  YOUTUBE: "YOUTUBE",
} as const satisfies Record<PrismaTranscriptSource, PrismaTranscriptSource>;
export type TranscriptSource = PrismaTranscriptSource;

export const BillingCycle = {
  MONTHLY: "MONTHLY",
  QUARTERLY: "QUARTERLY",
  ANNUAL: "ANNUAL",
  PROJECT: "PROJECT",
} as const satisfies Record<PrismaBillingCycle, PrismaBillingCycle>;
export type BillingCycle = PrismaBillingCycle;

export const ClientStatus = {
  ACTIVE: "ACTIVE",
  PAUSED: "PAUSED",
  CHURNED: "CHURNED",
} as const satisfies Record<PrismaClientStatus, PrismaClientStatus>;
export type ClientStatus = PrismaClientStatus;

export const OnboardingStep = {
  WORKSPACE: "WORKSPACE",
  TEAMMATES: "TEAMMATES",
  CLIENT: "CLIENT",
  DONE: "DONE",
} as const satisfies Record<PrismaOnboardingStep, PrismaOnboardingStep>;
export type OnboardingStep = PrismaOnboardingStep;

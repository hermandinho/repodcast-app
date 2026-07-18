import "server-only";

import { HeadBucketCommand } from "@aws-sdk/client-s3";
import { clerkClient } from "@clerk/nextjs/server";
import { assertSystemRole, SYSTEM_READ_ROLES, type SystemAdminContext } from "@/server/auth/system";
import { getStripeClient } from "@/server/billing/stripe";
import { prisma } from "@/server/db/client";
import { getResendClient } from "@/server/email/client";
import { getR2Client } from "@/server/storage/r2";

/**
 * `/root/system` reachability grid.
 *
 * v1 scope: live parallel probes for every backing service. Each probe is
 * bounded to `PROBE_TIMEOUT_MS` — a hung provider must not take the health
 * page hostage.
 *
 * Convention:
 *   - `ok`           — probe returned successfully within the timeout
 *   - `degraded`     — probe completed but the response was ambiguous
 *   - `down`         — probe threw or timed out
 *   - `unconfigured` — env vars for this service aren't set (fresh clone,
 *                      unbootstrapped provider). Rendered as a muted tile
 *                      rather than red — an unconfigured Sentry isn't
 *                      "down", it's just off.
 *
 * Deferred (blocked on schema + cron):
 *   - Latency-over-time sparklines. Needs the `HealthProbe` table from
 *     §3.6.14 + a 5-min Inngest ping cron writing rows. v1 shows the *current*
 *     latency only.
 *   - Recent-error rate via Sentry Events API. v1 exposes only the DSN
 *     presence + a deep link to the Sentry project.
 *
 * Note on Anthropic: we deliberately do NOT ping Anthropic on every page
 * load — a real inference call is metered. The freshest `UsageLog.createdAt`
 * is our proxy for "the pipeline can reach Anthropic". If nothing's been
 * generated in the last 24h the tile drops to `degraded`.
 */

const PROBE_TIMEOUT_MS = 2500;
const ANTHROPIC_DEGRADED_AFTER_HOURS = 24;

export type HealthStatus = "ok" | "degraded" | "down" | "unconfigured";

export type HealthProbe = {
  service:
    | "postgres"
    | "clerk"
    | "stripe"
    | "r2"
    | "resend"
    | "anthropic"
    | "inngest"
    | "sentry"
    | "posthog";
  label: string;
  status: HealthStatus;
  /** Round-trip time in ms; `null` if the probe never ran (unconfigured). */
  latencyMs: number | null;
  /** Short one-liner rendered under the status dot. Never a stack trace. */
  detail: string;
  /** When the probe finished (or was skipped). */
  checkedAt: Date;
};

export type SystemHealth = {
  probes: HealthProbe[];
  /** Worst status across the grid — drives the top-of-page banner. */
  worstStatus: HealthStatus;
  /** Total wall-clock time (ms) for all probes. */
  totalDurationMs: number;
};

/**
 * Run every probe in parallel. Open to every system read role — an ANALYST
 * needs the health grid too.
 */
export async function getSystemHealth(ctx: SystemAdminContext): Promise<SystemHealth> {
  assertSystemRole(ctx, SYSTEM_READ_ROLES);

  const start = Date.now();
  const probes = await Promise.all([
    probePostgres(),
    probeClerk(),
    probeStripe(),
    probeR2(),
    probeResend(),
    probeAnthropic(),
    probeInngest(),
    probeSentry(),
    probePostHog(),
  ]);
  const totalDurationMs = Date.now() - start;

  return {
    probes,
    worstStatus: worstOf(probes),
    totalDurationMs,
  };
}

// ============================================================
// Probe wrapper
// ============================================================

/**
 * Bound a live probe by `PROBE_TIMEOUT_MS`. On timeout the probe is `down`
 * with a "timed out after Nms" detail. On thrown error the probe is `down`
 * with the error's message (truncated).
 *
 * Exported for tests — the behaviour matters more than any specific probe.
 */
export async function runProbe<T>(
  service: HealthProbe["service"],
  label: string,
  fn: () => Promise<{ status: HealthStatus; detail: string; result?: T }>,
): Promise<HealthProbe> {
  const start = Date.now();
  const timeoutMs = PROBE_TIMEOUT_MS;

  try {
    const result = await Promise.race([
      fn().then((r) => ({ kind: "resolved" as const, r })),
      timeoutAfter(timeoutMs).then(() => ({ kind: "timed_out" as const })),
    ]);
    const latencyMs = Date.now() - start;

    if (result.kind === "timed_out") {
      return {
        service,
        label,
        status: "down",
        latencyMs,
        detail: `Timed out after ${timeoutMs}ms`,
        checkedAt: new Date(),
      };
    }
    return {
      service,
      label,
      status: result.r.status,
      latencyMs,
      detail: result.r.detail,
      checkedAt: new Date(),
    };
  } catch (err) {
    return {
      service,
      label,
      status: "down",
      latencyMs: Date.now() - start,
      detail: truncate(errorMessage(err), 200),
      checkedAt: new Date(),
    };
  }
}

function timeoutAfter(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "Unknown error";
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

// ============================================================
// Individual probes
// ============================================================

async function probePostgres(): Promise<HealthProbe> {
  return runProbe("postgres", "Postgres", async () => {
    // `$queryRawUnsafe` avoids the template tag's parameter binding — SELECT 1
    // takes no user input so the "unsafe" bit is a misnomer here.
    await prisma.$queryRawUnsafe("SELECT 1");
    return { status: "ok", detail: "SELECT 1 succeeded" };
  });
}

async function probeClerk(): Promise<HealthProbe> {
  if (!process.env.CLERK_SECRET_KEY) {
    return unconfigured("clerk", "Clerk", "CLERK_SECRET_KEY not set");
  }
  return runProbe("clerk", "Clerk", async () => {
    const client = await clerkClient();
    const count = await client.users.getCount();
    return { status: "ok", detail: `${count.toLocaleString()} users` };
  });
}

async function probeStripe(): Promise<HealthProbe> {
  const stripe = getStripeClient();
  if (!stripe) {
    return unconfigured("stripe", "Stripe", "STRIPE_SECRET_KEY not set");
  }
  return runProbe("stripe", "Stripe", async () => {
    const balance = await stripe.balance.retrieve();
    const primary = balance.available[0];
    const detail = primary
      ? `balance available: ${primary.amount / 100} ${primary.currency.toUpperCase()}`
      : "balance retrieved";
    return { status: "ok", detail };
  });
}

async function probeR2(): Promise<HealthProbe> {
  const r2 = getR2Client();
  if (!r2) {
    return unconfigured("r2", "Cloudflare R2", "R2 credentials not set");
  }
  return runProbe("r2", "Cloudflare R2", async () => {
    await r2.client.send(new HeadBucketCommand({ Bucket: r2.bucket }));
    return { status: "ok", detail: `bucket ${r2.bucket} reachable` };
  });
}

async function probeResend(): Promise<HealthProbe> {
  const resend = getResendClient();
  if (!resend) {
    return unconfigured("resend", "Resend", "RESEND_API_KEY not set");
  }
  return runProbe("resend", "Resend", async () => {
    const { data, error } = await resend.domains.list();
    if (error) {
      return { status: "down", detail: `API error: ${error.message}` };
    }
    const count = data?.data?.length ?? 0;
    return { status: "ok", detail: `${count} sender domain${count === 1 ? "" : "s"}` };
  });
}

async function probeAnthropic(): Promise<HealthProbe> {
  const viaGateway = Boolean(process.env.AI_GATEWAY_API_KEY);
  const hasDirect = Boolean(process.env.ANTHROPIC_API_KEY);
  if (!viaGateway && !hasDirect) {
    return unconfigured("anthropic", "Anthropic", "AI_GATEWAY_API_KEY / ANTHROPIC_API_KEY not set");
  }
  const via = viaGateway ? "via Vercel AI Gateway" : "direct";
  // We don't ping Anthropic on every page load — inference is metered. Use
  // the freshest `UsageLog.createdAt` as a proxy for "the pipeline can reach
  // Anthropic". `degraded` if nothing's been generated in the last N hours.
  return runProbe("anthropic", "Anthropic", async () => {
    const latest = await prisma.usageLog.findFirst({
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    if (!latest) {
      return {
        status: "degraded",
        detail: `${via} · no UsageLog rows yet — status will resolve after the first generation`,
      };
    }
    const ageMs = Date.now() - latest.createdAt.getTime();
    const ageHours = ageMs / (1000 * 60 * 60);
    if (ageHours > ANTHROPIC_DEGRADED_AFTER_HOURS) {
      return {
        status: "degraded",
        detail: `${via} · last successful call ${Math.round(ageHours)}h ago (proxy — no live ping to avoid billing every render)`,
      };
    }
    return {
      status: "ok",
      detail: `${via} · last successful call ${formatRelative(ageMs)} (proxy — no live ping)`,
    };
  });
}

/**
 * Inngest exposes an introspection GET on the app's own `/api/inngest`
 * handler, but calling it from within the same server process is a footgun
 * (SSR round-trip, no domain). v1 checks env presence + surfaces the
 * signing/event-key posture. Live introspection lands with the HealthProbe
 * cron slice.
 */
async function probeInngest(): Promise<HealthProbe> {
  const hasEventKey = Boolean(process.env.INNGEST_EVENT_KEY);
  const hasSigningKey = Boolean(process.env.INNGEST_SIGNING_KEY);
  if (!hasEventKey && !hasSigningKey) {
    return unconfigured("inngest", "Inngest", "Neither key set");
  }
  return {
    service: "inngest",
    label: "Inngest",
    status: "ok",
    latencyMs: 0,
    detail: `env present · dev-mode=${process.env.INNGEST_DEV === "1" ? "yes" : "no"} (live introspection deferred)`,
    checkedAt: new Date(),
  };
}

async function probeSentry(): Promise<HealthProbe> {
  const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return unconfigured("sentry", "Sentry", "SENTRY_DSN not set");
  return {
    service: "sentry",
    label: "Sentry",
    status: "ok",
    latencyMs: 0,
    detail: "DSN configured (live event count deferred — needs Events API)",
    checkedAt: new Date(),
  };
}

async function probePostHog(): Promise<HealthProbe> {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return unconfigured("posthog", "PostHog", "NEXT_PUBLIC_POSTHOG_KEY not set");
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com";
  return {
    service: "posthog",
    label: "PostHog",
    status: "ok",
    latencyMs: 0,
    detail: `key configured · host ${host}`,
    checkedAt: new Date(),
  };
}

function unconfigured(service: HealthProbe["service"], label: string, detail: string): HealthProbe {
  return {
    service,
    label,
    status: "unconfigured",
    latencyMs: null,
    detail,
    checkedAt: new Date(),
  };
}

// ============================================================
// Aggregation helpers
// ============================================================

const STATUS_RANK: Record<HealthStatus, number> = {
  ok: 0,
  unconfigured: 1,
  degraded: 2,
  down: 3,
};

export function worstOf(probes: HealthProbe[]): HealthStatus {
  let worst: HealthStatus = "ok";
  for (const p of probes) {
    if (STATUS_RANK[p.status] > STATUS_RANK[worst]) worst = p.status;
  }
  return worst;
}

function formatRelative(ageMs: number): string {
  const seconds = Math.round(ageMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

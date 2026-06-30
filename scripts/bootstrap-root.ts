/**
 * Bootstrap the first ROOT user (Phase 3.6.1).
 *
 * Usage:  npm run admin:bootstrap-root
 *
 * Reads `ROOT_BOOTSTRAP_EMAIL` and `ROOT_BOOTSTRAP_CLERK_USER_ID` from env
 * (`.env.local`-aware via `loadEnvLocal`). Upserts a single `SystemAdmin`
 * row with role `ROOT` keyed on `clerkUserId`. Idempotent — re-running
 * promotes an existing row back to ROOT + clears `deactivatedAt`, never
 * creates duplicates.
 *
 * Why a separate script (not a /root UI flow):
 *   - The /root surface is itself gated on a SystemAdmin row. You can't
 *     mint the first one from inside.
 *   - Bootstrapping a privileged identity is exactly the kind of thing
 *     that should require shell access + a deliberate command, not a
 *     web form.
 *
 * Operations:
 *   1. In Clerk dashboard, find the user-id for the operator (`user_…`).
 *   2. Add to `.env.local`:
 *        ROOT_BOOTSTRAP_EMAIL=ops@yourcompany.com
 *        ROOT_BOOTSTRAP_CLERK_USER_ID=user_xxxxxxxxxxxx
 *   3. `npm run admin:bootstrap-root`
 *   4. Sign in as that user and visit `/root`.
 *
 * Subsequent admins are minted from inside `/root/config` once that lands
 * (3.6.11) — every mutation flowing through `withSystemAudit` so we don't
 * lose attribution.
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { loadEnvLocal } from "./load-env-local";

loadEnvLocal();

const databaseUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "";
if (!databaseUrl) {
  console.error(
    "Missing DATABASE_URL / DIRECT_URL — set them in .env.local before running this script.",
  );
  process.exit(1);
}

const email = required("ROOT_BOOTSTRAP_EMAIL");
const clerkUserId = required("ROOT_BOOTSTRAP_CLERK_USER_ID");
const name = process.env.ROOT_BOOTSTRAP_NAME ?? null;

if (!clerkUserId.startsWith("user_")) {
  console.warn(
    `[bootstrap-root] WARNING: clerkUserId "${clerkUserId}" does not start with "user_". Did you paste the right id?`,
  );
}

async function main(): Promise<void> {
  const prisma = new PrismaClient({ adapter: new PrismaPg(databaseUrl) });

  try {
    const row = await prisma.systemAdmin.upsert({
      where: { clerkUserId },
      create: {
        clerkUserId,
        email: email.toLowerCase(),
        name,
        role: "ROOT",
        mfaEnforced: true,
      },
      update: {
        email: email.toLowerCase(),
        name: name ?? undefined,
        role: "ROOT",
        deactivatedAt: null,
      },
      select: { id: true, email: true, role: true, mfaEnforced: true, createdAt: true },
    });

    console.log(`✔ SystemAdmin upserted (role=ROOT)`);
    console.log(`  id           ${row.id}`);
    console.log(`  email        ${row.email}`);
    console.log(`  clerkUserId  ${clerkUserId}`);
    console.log(`  mfaEnforced  ${row.mfaEnforced}`);
    console.log(`  createdAt    ${row.createdAt.toISOString()}`);
    console.log("");
    console.log(
      "Sign in as that user in Clerk and visit /root — the gate will resolve them as ROOT.",
    );
    if (row.mfaEnforced) {
      console.log(
        "Note: MFA is enforced by default. Make sure the operator has a second factor configured in their Clerk profile, or /root will redirect to MFA setup.",
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

function required(key: string): string {
  const v = process.env[key];
  if (!v) {
    console.error(`Missing required env var: ${key}`);
    process.exit(1);
  }
  return v;
}

main().catch((err) => {
  console.error("[bootstrap-root] failed:", err);
  process.exit(1);
});

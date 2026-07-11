import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SignOutButton } from "@clerk/nextjs";
import { getAuthContext } from "@/server/auth/context";
import { CONTACT_EMAILS } from "@/lib/contact-emails";

/**
 * Landing surface for tenants whose Agency has `suspendedAt` set. Sits
 * OUTSIDE the `(dashboard)` route group so the layout gate can redirect
 * here without recursing. Uses `getAuthContext` directly (not
 * `requireAuthContext`) for the same reason — the require variant would
 * bounce a suspended user in a loop.
 *
 * Access rules:
 *   - Unauthenticated → /sign-in (nothing sensitive to leak).
 *   - Authenticated but NOT suspended → /dashboard (a resumed user hitting
 *     this URL bookmark shouldn't get trapped).
 *   - Impersonating operator → /dashboard (the layout lets them through
 *     for suspended tenants; the same skip-rule applies here).
 */
export const metadata: Metadata = {
  title: "Workspace suspended — Repodcast",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const INK = "#0a1e3c";
const MUTED = "#41506b";
const CARD_BORDER = "#e4e9f1";
const ACCENT = "#3A5BA0";

export default async function SuspendedPage() {
  const auth = await getAuthContext();
  if (!auth) redirect("/sign-in");
  if (auth.agency.suspendedAt === null || auth.impersonation) redirect("/dashboard");

  const suspendedOn = auth.agency.suspendedAt.toISOString().slice(0, 10);

  return (
    <main
      className="flex min-h-screen w-full flex-col items-center justify-center px-6"
      style={{ background: "#f6f8fc", fontFamily: "var(--font-revamp-sans)" }}
    >
      <div
        className="flex w-full max-w-lg flex-col items-center text-center"
        style={{
          background: "#ffffff",
          border: `1px solid ${CARD_BORDER}`,
          borderRadius: 14,
          padding: "40px 36px",
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-revamp-mono)",
            fontSize: 10.5,
            letterSpacing: "0.14em",
            color: "#A02B1C",
            fontWeight: 700,
            background: "#FBE7E4",
            padding: "4px 10px",
            borderRadius: 99,
          }}
        >
          WORKSPACE SUSPENDED
        </span>

        <h1
          style={{
            fontSize: 26,
            fontWeight: 800,
            letterSpacing: "-0.02em",
            color: INK,
            marginTop: 18,
          }}
        >
          {auth.agency.name} is on hold
        </h1>

        <p style={{ fontSize: 14.5, color: MUTED, marginTop: 12, lineHeight: 1.6 }}>
          Access to this workspace has been suspended as of {suspendedOn}. Your data is preserved —
          nothing has been deleted. Reach out to support to restore access.
        </p>

        <a
          href={`mailto:${CONTACT_EMAILS.support}?subject=Suspended%20workspace%20${encodeURIComponent(auth.agency.name)}`}
          style={{
            marginTop: 22,
            background: ACCENT,
            color: "#ffffff",
            fontWeight: 600,
            fontSize: 14,
            padding: "11px 22px",
            borderRadius: 8,
            textDecoration: "none",
          }}
        >
          Email support
        </a>

        <div
          style={{
            marginTop: 20,
            fontSize: 12.5,
            color: MUTED,
            display: "flex",
            gap: 14,
            alignItems: "center",
          }}
        >
          <Link href="/" style={{ color: MUTED }}>
            Home
          </Link>
          <span style={{ color: "#8a97ad" }}>·</span>
          <SignOutButton>
            <button
              type="button"
              style={{
                background: "transparent",
                border: "none",
                padding: 0,
                fontSize: 12.5,
                color: MUTED,
                fontFamily: "inherit",
                textDecoration: "underline",
                textUnderlineOffset: 3,
                cursor: "pointer",
              }}
            >
              Sign out
            </button>
          </SignOutButton>
        </div>
      </div>
    </main>
  );
}

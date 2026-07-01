import Link from "next/link";
import { BrandMark } from "@/components/landing/nav";

/**
 * Shared chrome for /sign-in + /sign-up (and any future Clerk-hosted
 * auth surface). Matches /onboarding + /pricing hero rhythm:
 *   - Radial-gradient page background with two decorative orbs
 *   - Sticky top row with BrandMark ← + a small utility link (Sign in / Get started)
 *   - Centered container the Clerk widget mounts into
 *   - Small footnote below the widget (T&Cs / support link placeholder)
 *
 * Deliberately server-rendered — Clerk's `<SignIn>` / `<SignUp>` inside
 * `{children}` are the only client subtrees.
 */
export function AuthShell({
  children,
  altHref,
  altLabel,
  footNote,
}: {
  children: React.ReactNode;
  /** Utility link opposite the brand mark (e.g. "Sign in" on the sign-up page). */
  altHref: string;
  altLabel: string;
  /** Optional secondary line rendered below the Clerk widget. */
  footNote?: React.ReactNode;
}) {
  return (
    <div
      className="relative min-h-screen w-full overflow-hidden"
      style={{
        background: "radial-gradient(120% 80% at 100% 0%, #EEF2FB 0%, #F4F6FA 45%, #F4F6FA 100%)",
        color: "#1A2A4A",
      }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 -right-32 h-[420px] w-[420px] rounded-full"
        style={{
          background: "radial-gradient(circle, rgba(58,91,160,0.16) 0%, rgba(58,91,160,0) 70%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-40 -left-32 h-[460px] w-[460px] rounded-full"
        style={{
          background: "radial-gradient(circle, rgba(46,158,91,0.12) 0%, rgba(46,158,91,0) 70%)",
        }}
      />

      <div className="relative mx-auto flex min-h-screen max-w-[520px] flex-col px-5 py-8 sm:py-10">
        <header className="mb-8 flex items-center justify-between">
          <Link href="/" className="no-underline">
            <BrandMark />
          </Link>
          <Link
            href={altHref}
            className="text-[13.5px] font-medium no-underline transition-colors"
            style={{ color: "#5A6473" }}
          >
            {altLabel} →
          </Link>
        </header>

        <div className="flex flex-1 flex-col justify-center">
          <div className="flex justify-center" suppressHydrationWarning>
            {children}
          </div>
          {footNote ? (
            <p className="mt-6 text-center text-[12px]" style={{ color: "#8B95A6" }}>
              {footNote}
            </p>
          ) : null}
        </div>

        <footer className="pt-8">
          <p
            className="m-0 text-center text-[11px] font-medium uppercase"
            style={{
              fontFamily: "var(--font-mono)",
              color: "#A6AEBC",
              letterSpacing: "0.14em",
            }}
          >
            Repodcast — Voice-true content for podcast agencies
          </p>
        </footer>
      </div>
    </div>
  );
}

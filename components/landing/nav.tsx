import Link from "next/link";

export function BrandMark({ darkBg = false }: { darkBg?: boolean }) {
  return (
    <div className="flex items-center gap-[9px]">
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <rect x="0.5" y="0.5" width="21" height="21" rx="6" fill={darkBg ? "#3A5BA0" : "#1A2A4A"} />
        <rect x="7" y="9" width="2" height="4" rx="1" fill="#fff" />
        <rect x="10" y="6" width="2" height="10" rx="1" fill="#fff" />
        <rect x="13" y="8" width="2" height="6" rx="1" fill="#fff" />
      </svg>
      <span
        className="text-[17.5px] font-bold"
        style={{
          fontFamily: "var(--font-display)",
          color: darkBg ? "#FFFFFF" : "#1A2A4A",
          letterSpacing: "-0.03em",
        }}
      >
        Repodcast
      </span>
    </div>
  );
}

/**
 * Marketing-surface nav. Sticky, glass-blurred top bar shared by the
 * landing page, /pricing, /about, /contact, and the legal surfaces so
 * signed-in visitors always see a working "Continue" affordance and
 * everyone else sees the same "Sign in / Get started" pair.
 *
 * `hashLinks` controls how the menu items ("How it works", "Voice
 * Engine", "FAQ") resolve:
 *   - `false` (default) — absolute `/#section` targets. Every non-landing
 *     surface uses this; a bare `#how` on `/pricing` scrolls to nothing.
 *   - `true` — bare `#section` anchors. Landing page only, since that's
 *     the surface where those IDs actually live in the DOM.
 */
export function LandingNav({
  isSignedIn,
  hashLinks = false,
}: {
  isSignedIn: boolean;
  hashLinks?: boolean;
}) {
  const anchor = (id: string) => (hashLinks ? `#${id}` : `/#${id}`);
  return (
    <header
      className="sticky top-0 z-50"
      style={{
        background: "rgba(255,255,255,0.85)",
        backdropFilter: "saturate(180%) blur(16px)",
        WebkitBackdropFilter: "saturate(180%) blur(16px)",
        borderBottom: "1px solid #ECEEF3",
      }}
    >
      <nav
        className="mx-auto flex items-center justify-between gap-6 px-7 py-[15px]"
        style={{ maxWidth: 1180 }}
      >
        <div className="flex items-center gap-[38px]">
          <Link href="/" className="no-underline">
            <BrandMark />
          </Link>
          <div
            className="hidden items-center gap-[26px] text-[14px] font-normal md:flex"
            style={{ color: "#5A6473" }}
          >
            <a
              href={anchor("how")}
              className="no-underline transition-colors hover:text-[#1A2A4A]"
              style={{ color: "inherit" }}
            >
              How it works
            </a>
            <a
              href={anchor("voice")}
              className="no-underline transition-colors hover:text-[#1A2A4A]"
              style={{ color: "inherit" }}
            >
              Voice Engine
            </a>
            <Link
              href="/pricing"
              className="no-underline transition-colors hover:text-[#1A2A4A]"
              style={{ color: "inherit" }}
            >
              Pricing
            </Link>
            <a
              href={anchor("faq")}
              className="no-underline transition-colors hover:text-[#1A2A4A]"
              style={{ color: "inherit" }}
            >
              FAQ
            </a>
          </div>
        </div>
        <div className="flex items-center gap-[18px]">
          {isSignedIn ? (
            <Link
              href="/after-sign-in"
              className="rounded-lg text-[14px] font-medium no-underline transition-colors"
              style={{
                background: "#1A2A4A",
                color: "#FFFFFF",
                padding: "9px 17px",
              }}
            >
              Continue
            </Link>
          ) : (
            <>
              <Link
                href="/sign-in"
                className="text-[14px] font-medium no-underline"
                style={{ color: "#1A2A4A" }}
              >
                Sign in
              </Link>
              <Link
                href="/pricing"
                className="rounded-lg text-[14px] font-medium no-underline transition-colors"
                style={{
                  background: "#1A2A4A",
                  color: "#FFFFFF",
                  padding: "9px 17px",
                }}
              >
                Get started
              </Link>
            </>
          )}
        </div>
      </nav>
    </header>
  );
}

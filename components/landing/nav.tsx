"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

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
 * Below `md` (768px) the four anchor links + the secondary "Sign in"
 * collapse into a burger drawer — the top bar keeps the primary CTA
 * (Get started / Continue) so the "act on this" button never disappears.
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
  const [menuOpen, setMenuOpen] = useState(false);

  // Close on Escape so the drawer respects the same dismissal pattern
  // every keyboard user expects from an overlay.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  const navLinks: { label: string; href: string; internal: boolean }[] = [
    { label: "How it works", href: anchor("how"), internal: false },
    { label: "Voice Engine", href: anchor("voice"), internal: false },
    { label: "Pricing", href: "/pricing", internal: true },
    { label: "Blog", href: "/blog", internal: true },
    { label: "FAQ", href: anchor("faq"), internal: false },
  ];

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
        className="mx-auto flex items-center justify-between gap-4 px-4 py-[13px] sm:gap-6 sm:px-7 sm:py-[15px]"
        style={{ maxWidth: 1180 }}
      >
        <div className="flex items-center gap-6 md:gap-[38px]">
          <Link href="/" className="no-underline" onClick={() => setMenuOpen(false)}>
            <BrandMark />
          </Link>
          <div
            className="hidden items-center gap-[26px] text-[14px] font-normal md:flex"
            style={{ color: "#5A6473" }}
          >
            {navLinks.map((l) =>
              l.internal ? (
                <Link
                  key={l.label}
                  href={l.href}
                  className="no-underline transition-colors hover:text-[#1A2A4A]"
                  style={{ color: "inherit" }}
                >
                  {l.label}
                </Link>
              ) : (
                <a
                  key={l.label}
                  href={l.href}
                  className="no-underline transition-colors hover:text-[#1A2A4A]"
                  style={{ color: "inherit" }}
                >
                  {l.label}
                </a>
              ),
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 sm:gap-[18px]">
          {isSignedIn ? (
            <Link
              href="/after-sign-in"
              className="rounded-lg px-4 py-[9px] text-[13.5px] font-medium no-underline transition-colors sm:px-[17px] sm:text-[14px]"
              style={{
                background: "#1A2A4A",
                color: "#FFFFFF",
              }}
            >
              Continue
            </Link>
          ) : (
            <>
              {/* Sign in hides on mobile — it's the secondary CTA and
                  lives inside the burger drawer to keep the top bar
                  from crowding the brand mark on narrow phones. */}
              <Link
                href="/sign-in"
                className="hidden text-[13.5px] font-medium no-underline sm:inline sm:text-[14px]"
                style={{ color: "#1A2A4A" }}
              >
                Sign in
              </Link>
              <Link
                href="/sign-up"
                className="rounded-lg px-4 py-[9px] text-[13.5px] font-medium no-underline transition-colors sm:px-[17px] sm:text-[14px]"
                style={{
                  background: "#1A2A4A",
                  color: "#FFFFFF",
                }}
              >
                Get started
              </Link>
            </>
          )}

          {/* Burger — visible below `md`. Toggles the drawer that carries
              the anchor links (+ Sign in for signed-out visitors). */}
          <button
            type="button"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            aria-controls="landing-mobile-menu"
            onClick={() => setMenuOpen((v) => !v)}
            className="flex h-[38px] w-[38px] flex-shrink-0 items-center justify-center rounded-lg border transition-colors md:hidden"
            style={{
              borderColor: "#E4E9F1",
              background: menuOpen ? "#F6F8FC" : "#fff",
              color: "#1A2A4A",
            }}
          >
            {menuOpen ? (
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                aria-hidden
              >
                <path d="M3 3l10 10M13 3L3 13" />
              </svg>
            ) : (
              <svg
                width="18"
                height="18"
                viewBox="0 0 18 18"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
                aria-hidden
              >
                <path d="M3 5h12M3 9h12M3 13h12" />
              </svg>
            )}
          </button>
        </div>
      </nav>

      {/* Mobile drawer — full-width panel that drops below the nav bar
          on <md. Kept inside the sticky <header> so it slides with the
          bar and inherits its blurred background style. */}
      {menuOpen && (
        <div
          id="landing-mobile-menu"
          className="border-t md:hidden"
          style={{
            background: "rgba(255,255,255,0.96)",
            backdropFilter: "saturate(180%) blur(16px)",
            WebkitBackdropFilter: "saturate(180%) blur(16px)",
            borderColor: "#ECEEF3",
          }}
        >
          <div className="mx-auto px-4 py-3 sm:px-7" style={{ maxWidth: 1180 }}>
            <ul className="flex flex-col">
              {navLinks.map((l) => (
                <li key={l.label} className="border-b" style={{ borderColor: "#F1F4F9" }}>
                  {l.internal ? (
                    <Link
                      href={l.href}
                      onClick={() => setMenuOpen(false)}
                      className="block py-[13px] text-[15px] font-medium no-underline"
                      style={{ color: "#1A2A4A" }}
                    >
                      {l.label}
                    </Link>
                  ) : (
                    <a
                      href={l.href}
                      onClick={() => setMenuOpen(false)}
                      className="block py-[13px] text-[15px] font-medium no-underline"
                      style={{ color: "#1A2A4A" }}
                    >
                      {l.label}
                    </a>
                  )}
                </li>
              ))}
              {!isSignedIn && (
                <li>
                  <Link
                    href="/sign-in"
                    onClick={() => setMenuOpen(false)}
                    className="block py-[13px] text-[15px] font-medium no-underline"
                    style={{ color: "#1A2A4A" }}
                  >
                    Sign in
                  </Link>
                </li>
              )}
            </ul>
          </div>
        </div>
      )}
    </header>
  );
}

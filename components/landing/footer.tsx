import Link from "next/link";
import { CookiePreferencesButton } from "@/components/consent/cookie-preferences-button";
import { getLandingSocialLinks } from "@/lib/landing-social-links";
import { BrandMark } from "./nav";
import { SocialIcon, socialLabel } from "./social-icon";

const COLUMNS = [
  {
    title: "Product",
    links: [
      { label: "Voice Engine", href: "/#voice" },
      { label: "How it works", href: "/#how" },
      { label: "Pricing", href: "/pricing" },
      { label: "Blog", href: "/blog" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About", href: "/about" },
      { label: "Contact", href: "/contact" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Privacy", href: "/legal/privacy" },
      { label: "Terms", href: "/legal/terms" },
      { label: "Security", href: "/legal/security" },
      { label: "Report abuse", href: "/legal/report" },
    ],
  },
];

/**
 * Async server component — self-fetches the `LANDING_SOCIAL_LINKS` config
 * so every page that renders the footer (landing, /pricing, /blog, legal,
 * etc.) gets the icons without each caller re-doing the plumbing. Empty
 * list → the social row is hidden entirely (no placeholder icons).
 */
export async function LandingFooter() {
  const socialLinks = await getLandingSocialLinks();
  return (
    <footer className="px-5 pt-12 pb-8 sm:px-7 sm:pt-14 sm:pb-10" style={{ background: "#13203B" }}>
      <div className="mx-auto" style={{ maxWidth: 1180 }}>
        <div
          className="grid grid-cols-2 gap-8 pb-8 sm:gap-10 md:grid-cols-[1.6fr_1fr_1fr_1fr] md:pb-[42px]"
          style={{
            borderBottom: "1px solid #2A3C60",
          }}
        >
          <div className="col-span-2 md:col-span-1">
            <div className="mb-[14px]">
              <BrandMark darkBg />
            </div>
            <p
              className="m-0 text-[13.5px]"
              style={{ color: "#8794B5", lineHeight: 1.6, maxWidth: 280 }}
            >
              Platform-ready content from every client episode — in their voice, sharper every time.
            </p>
            {socialLinks.links.length > 0 ? (
              <div className="mt-5 flex flex-wrap items-center gap-3">
                {socialLinks.links.map((link) => (
                  <a
                    key={link.platform}
                    href={link.href}
                    target="_blank"
                    rel="noreferrer noopener"
                    aria-label={socialLabel(link.platform)}
                    className="inline-flex size-9 items-center justify-center rounded-md border transition-colors"
                    style={{
                      borderColor: "#2A3C60",
                      color: "#A9B6D4",
                      background: "transparent",
                    }}
                  >
                    <SocialIcon platform={link.platform} className="size-4" />
                  </a>
                ))}
              </div>
            ) : null}
          </div>
          {COLUMNS.map((col) => (
            <div key={col.title}>
              <div
                className="mb-4 text-[11px] font-medium uppercase"
                style={{
                  fontFamily: "var(--font-mono)",
                  color: "#6B7BA3",
                  letterSpacing: "0.06em",
                }}
              >
                {col.title}
              </div>
              <div className="flex flex-col gap-[11px] text-[13.5px]">
                {col.links.map((l) =>
                  l.href.startsWith("/") ? (
                    <Link
                      key={l.label}
                      href={l.href}
                      className="no-underline transition-colors hover:text-white"
                      style={{ color: "#A9B6D4" }}
                    >
                      {l.label}
                    </Link>
                  ) : (
                    <a
                      key={l.label}
                      href={l.href}
                      className="no-underline transition-colors hover:text-white"
                      style={{ color: "#A9B6D4" }}
                    >
                      {l.label}
                    </a>
                  ),
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 pt-6">
          <span
            className="text-[12px]"
            style={{ fontFamily: "var(--font-mono)", color: "#6B7BA3" }}
          >
            © 2026 Repodcast, Inc.
          </span>
          <div
            className="flex items-center gap-4 text-[12px]"
            style={{ fontFamily: "var(--font-mono)", color: "#6B7BA3" }}
          >
            <CookiePreferencesButton
              className="cursor-pointer transition-colors hover:text-white"
              style={{ color: "#6B7BA3", background: "transparent", border: 0, padding: 0 }}
            />
            <span>Made for the studios doing the work.</span>
          </div>
        </div>
      </div>
    </footer>
  );
}

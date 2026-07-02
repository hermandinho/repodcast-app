import Link from "next/link";
import { BrandMark } from "./nav";

const COLUMNS = [
  {
    title: "Product",
    links: [
      { label: "Voice Engine", href: "/#voice" },
      { label: "How it works", href: "/#how" },
      { label: "Pricing", href: "/pricing" },
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

export function LandingFooter() {
  return (
    <footer className="px-7" style={{ background: "#13203B", padding: "56px 28px 38px" }}>
      <div className="mx-auto" style={{ maxWidth: 1180 }}>
        <div
          className="grid gap-10 pb-[42px]"
          style={{
            gridTemplateColumns: "1.6fr 1fr 1fr 1fr",
            borderBottom: "1px solid #2A3C60",
          }}
        >
          <div>
            <div className="mb-[14px]">
              <BrandMark darkBg />
            </div>
            <p
              className="m-0 text-[13.5px]"
              style={{ color: "#8794B5", lineHeight: 1.6, maxWidth: 280 }}
            >
              Platform-ready content from every client episode — in their voice, sharper every time.
            </p>
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
          <span
            className="text-[12px]"
            style={{ fontFamily: "var(--font-mono)", color: "#6B7BA3" }}
          >
            Made for the studios doing the work.
          </span>
        </div>
      </div>
    </footer>
  );
}

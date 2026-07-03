import { LandingFooter } from "../landing/footer";
import { LandingNav } from "../landing/nav";

/**
 * Shared shell for `/legal/privacy`, `/legal/terms`, `/legal/security`.
 *
 * Wraps content between the same sticky nav + footer as the landing so the
 * marketing surface reads as one site. Children are rendered inside a
 * `.legal-prose` container — styling for h2/h3/p/ul/li/a lives in
 * `globals.css` so page bodies stay content-focused.
 */
export function LegalPageLayout({
  isSignedIn,
  eyebrow,
  title,
  intro,
  lastUpdated,
  children,
}: {
  isSignedIn: boolean;
  eyebrow: string;
  title: string;
  intro?: string;
  lastUpdated: string;
  children: React.ReactNode;
}) {
  return (
    <div className="w-full overflow-x-hidden">
      <LandingNav isSignedIn={isSignedIn} />
      <main style={{ background: "#FBFCFE" }}>
        <div className="mx-auto px-7" style={{ maxWidth: 780, paddingTop: 72, paddingBottom: 96 }}>
          <p
            className="m-0 text-[11px] font-medium uppercase"
            style={{
              fontFamily: "var(--font-mono)",
              color: "#6B7BA3",
              letterSpacing: "0.1em",
            }}
          >
            {eyebrow}
          </p>
          <h1
            className="mt-3 mb-4 text-[38px] leading-[1.1] font-semibold"
            style={{
              fontFamily: "var(--font-display)",
              color: "#1A2A4A",
              letterSpacing: "-0.02em",
            }}
          >
            {title}
          </h1>
          {intro ? (
            <p
              className="m-0 text-[15.5px]"
              style={{ color: "#5A6473", lineHeight: 1.7, maxWidth: 640 }}
            >
              {intro}
            </p>
          ) : null}
          <p
            className="mt-5 text-[12.5px]"
            style={{ fontFamily: "var(--font-mono)", color: "#6B7BA3" }}
          >
            Last updated {lastUpdated}
          </p>
          <div className="legal-prose mt-12">{children}</div>
        </div>
      </main>
      <LandingFooter />
    </div>
  );
}

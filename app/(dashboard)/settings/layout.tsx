import { SettingsNav } from "@/components/settings/settings-nav";

/**
 * Settings shell — revamp visual system (see `ref/UI/Revamp/`).
 *
 * Container width tracks the widest child page (Billing at ~980, Branding
 * at ~1060) via `max-w-[1060px]` — narrower pages self-cap with an inner
 * wrapper. `#f6f8fc` canvas comes from the dashboard layout background.
 *
 * Header: big "Settings" title (28/800), muted subtitle, pill tab
 * switcher (see `<SettingsNav>`).
 */
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="mx-auto w-full"
      style={{
        maxWidth: 1060,
        padding: "36px 32px 48px",
        fontFamily: "var(--font-revamp-sans)",
        color: "#0a1e3c",
      }}
    >
      <h1
        style={{
          fontFamily: "var(--font-revamp-sans)",
          fontSize: 28,
          fontWeight: 800,
          letterSpacing: "-0.02em",
          lineHeight: 1.1,
          margin: 0,
        }}
      >
        Settings
      </h1>
      <p style={{ fontSize: 14, color: "#8a97ad", marginTop: 4 }}>
        Workspace, billing, team, and branding.
      </p>
      <SettingsNav />
      <div style={{ marginTop: 28 }}>{children}</div>
    </div>
  );
}

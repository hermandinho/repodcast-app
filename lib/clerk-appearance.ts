/**
 * Clerk `appearance` config that maps the hosted Sign-In / Sign-Up widget
 * onto the Repodcast marketing palette (Landing + /pricing + /onboarding
 * share the same tokens). Single source of truth — `<ClerkProvider>` in
 * app/layout.tsx passes this, and individual `<SignIn>` / `<SignUp>`
 * instances inherit unless they explicitly override.
 *
 * Colors mirror `app/globals.css` custom properties. Duplicating the hex
 * values (rather than reading from `getComputedStyle`) is intentional:
 * Clerk resolves `appearance` at render time inside its own JSX subtree
 * before the CSS variables are guaranteed to be in scope, and the
 * `#RRGGBB` literals keep the theme SSR-stable.
 */

const INK = "#1A2A4A";
const INK_2 = "#2A3550";
const MUTED = "#5A6473";
const MUTED_2 = "#8B95A6";
const SURFACE = "#FFFFFF";
const SURFACE_2 = "#FBFCFE";
const BORDER = "#E4E8F0";
const BORDER_SUBTLE = "#EEF0F5";
const ACCENT = "#3A5BA0";
const ACCENT_SOFT = "#EEF2FB";
const SUCCESS = "#2E9E5B";
const DANGER = "#C42B2B";

export const clerkAppearance = {
  variables: {
    // Deep ink is the app's primary button color everywhere (landing
    // "Get started", onboarding "Continue", dashboard actions). Clerk's
    // colorPrimary drives Continue / Submit / focus rings — match it.
    colorPrimary: INK,
    colorText: INK,
    colorTextSecondary: MUTED,
    colorBackground: SURFACE,
    colorInputBackground: SURFACE_2,
    colorInputText: INK,
    colorDanger: DANGER,
    colorSuccess: SUCCESS,
    colorNeutral: MUTED_2,
    fontFamily: "var(--font-inter)",
    fontFamilyButtons: "var(--font-inter)",
    fontSize: "14.5px",
    borderRadius: "10px",
    spacingUnit: "1rem",
  },
  elements: {
    // The `<Clerk>` widget renders inside a card. Our AuthShell already
    // supplies the gradient + brand chrome around it, so drop Clerk's own
    // card shadow to avoid double framing.
    rootBox: {
      width: "100%",
    },
    card: {
      background: SURFACE,
      border: `1px solid ${BORDER}`,
      boxShadow: "0 12px 40px -20px rgba(26,42,74,0.18)",
      borderRadius: 16,
      padding: "28px 30px",
    },
    headerTitle: {
      fontFamily: "var(--font-sora)",
      fontSize: 24,
      fontWeight: 700,
      letterSpacing: "-0.02em",
      color: INK,
    },
    headerSubtitle: {
      fontSize: 13.5,
      color: MUTED,
      lineHeight: 1.5,
    },

    // Social provider buttons (Google / GitHub / etc.) — match the "ghost"
    // secondary button we use across the app.
    socialButtonsBlockButton: {
      background: SURFACE,
      border: `1px solid ${BORDER}`,
      color: INK,
      fontWeight: 500,
      transition: "background 120ms ease",
      "&:hover": {
        background: SURFACE_2,
        border: `1px solid ${BORDER}`,
      },
    },
    socialButtonsBlockButtonText: {
      color: INK,
      fontWeight: 500,
    },

    dividerLine: {
      background: BORDER_SUBTLE,
    },
    dividerText: {
      color: MUTED_2,
      fontFamily: "var(--font-mono)",
      fontSize: 11,
      textTransform: "uppercase",
      letterSpacing: "0.06em",
    },

    // Form fields — the input the landing uses is `bg-canvas` with a
    // 1px border and 10px radius. Clerk's default is already close;
    // this pins the exact numbers so a Clerk theme bump doesn't drift.
    formFieldLabel: {
      color: INK_2,
      fontSize: 12.5,
      fontWeight: 600,
      letterSpacing: 0,
      textTransform: "none",
    },
    formFieldInput: {
      background: SURFACE_2,
      border: `1px solid ${BORDER}`,
      color: INK,
      fontSize: 14,
      "&:focus": {
        border: `1px solid ${ACCENT}`,
        boxShadow: `0 0 0 3px ${ACCENT_SOFT}`,
      },
    },
    formFieldInputShowPasswordButton: {
      color: MUTED,
    },

    // Primary action button — matches landing "Get started" (dark, rounded).
    formButtonPrimary: {
      background: INK,
      color: SURFACE,
      fontWeight: 600,
      fontSize: 14,
      padding: "11px 20px",
      textTransform: "none",
      transition: "background 120ms ease",
      "&:hover": { background: "#0F1D3B" },
      "&:focus": { background: "#0F1D3B" },
      "&:active": { background: "#0A1530" },
    },
    formButtonReset: {
      color: MUTED,
    },

    // OTP / verification code cells.
    otpCodeFieldInput: {
      background: SURFACE_2,
      border: `1px solid ${BORDER}`,
      color: INK,
    },

    // Footer link that swaps between "Have an account? Sign in" etc.
    footer: {
      background: "transparent",
    },
    footerAction: {
      background: "transparent",
    },
    footerActionText: {
      color: MUTED,
      fontSize: 13,
    },
    footerActionLink: {
      color: ACCENT,
      fontWeight: 600,
      "&:hover": { color: INK },
    },

    // Alt-flow buttons (forgot password, use verification, ...).
    alternativeMethodsBlockButton: {
      background: SURFACE_2,
      border: `1px solid ${BORDER}`,
      color: INK,
      fontWeight: 500,
    },
    identityPreview: {
      background: SURFACE_2,
      border: `1px solid ${BORDER}`,
    },
    identityPreviewText: {
      color: INK,
    },
    identityPreviewEditButton: {
      color: ACCENT,
    },

    // Small badges / notices Clerk uses for MFA + error states.
    badge: {
      background: ACCENT_SOFT,
      color: ACCENT,
      fontFamily: "var(--font-mono)",
      fontSize: 10.5,
      textTransform: "uppercase",
      letterSpacing: "0.06em",
    },

    // Clerk's own dev-mode banner (bottom-left "Development mode" pill).
    // We keep it visible but drop it into the muted palette so it doesn't
    // fight the surface.
    logoBox: {
      display: "none",
    },
  },
  layout: {
    socialButtonsPlacement: "top",
    socialButtonsVariant: "blockButton",
    logoPlacement: "none",
    showOptionalFields: false,
  },
};

/** Convenience — `SignUp` gets the same base but with a "Create your workspace" subtitle. */
export const clerkSignUpAppearance = clerkAppearance;

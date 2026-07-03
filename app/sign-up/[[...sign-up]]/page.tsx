import Link from "next/link";
import { AuthShell } from "@/components/auth/auth-shell";
import { ClerkSignUpMount } from "@/components/auth/clerk-widget-mount";

// See app/sign-in/[[...sign-in]]/page.tsx — same client-only mount pattern
// to sidestep the React 19 hydration mismatch on Clerk's widget container.
// Theme comes from <ClerkProvider> in app/layout.tsx.
//
// `fallbackRedirectUrl` mirrors sign-in — /after-sign-in resolves the
// caller's role. Signups arriving from /pricing carry their own
// `?redirect_url=/onboarding/plan?…` which overrides the fallback.
export default function SignUpPage() {
  return (
    <AuthShell
      altHref="/sign-in"
      altLabel="Sign in"
      footNote={
        <>
          By creating an account you agree to our{" "}
          <Link href="#" className="underline" style={{ color: "#5A6473" }}>
            Terms
          </Link>{" "}
          and{" "}
          <Link href="#" className="underline" style={{ color: "#5A6473" }}>
            Privacy
          </Link>
          .
        </>
      }
    >
      <ClerkSignUpMount fallbackRedirectUrl="/after-sign-in" signInUrl="/sign-in" />
    </AuthShell>
  );
}

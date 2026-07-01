import { SignUp } from "@clerk/nextjs";
import Link from "next/link";
import { AuthShell } from "@/components/auth/auth-shell";

// See app/sign-in/[[...sign-in]]/page.tsx — same Clerk `withClerk` HOC
// handoff. `AuthShell` scopes `suppressHydrationWarning` around the mount.
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
      <SignUp fallbackRedirectUrl="/after-sign-in" signInUrl="/sign-in" />
    </AuthShell>
  );
}

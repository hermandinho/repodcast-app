import Link from "next/link";
import { AuthShell } from "@/components/auth/auth-shell";
import { ClerkSignInMount } from "@/components/auth/clerk-widget-mount";

// Clerk's `<SignIn>` is rendered client-only via `ClerkSignInMount` — under
// React 19 the widget mismatches on hydration (see the wrapper's comment).
// Theme still comes from `lib/clerk-appearance.ts` via <ClerkProvider> in
// app/layout.tsx.
//
// `fallbackRedirectUrl` sends anyone without an explicit `?redirect_url=...`
// through /after-sign-in, which resolves the caller's role (SystemAdmin,
// paying member, unpaid member, no membership) and forwards to the right
// surface. Keeps ROOT-only users out of the /dashboard → /onboarding loop.
export default function SignInPage() {
  return (
    <AuthShell
      altHref="/sign-up"
      altLabel="Get started"
      footNote={
        <>
          Trouble signing in?{" "}
          <Link href="/pricing" className="underline" style={{ color: "#5A6473" }}>
            Back to pricing
          </Link>
          .
        </>
      }
    >
      <ClerkSignInMount fallbackRedirectUrl="/after-sign-in" signUpUrl="/sign-up" />
    </AuthShell>
  );
}

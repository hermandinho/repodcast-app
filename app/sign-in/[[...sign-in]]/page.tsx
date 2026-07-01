import { SignIn } from "@clerk/nextjs";
import Link from "next/link";
import { AuthShell } from "@/components/auth/auth-shell";

// Clerk's `<SignIn>` is wrapped in a `withClerk` HOC that returns `null` until
// the client-side Clerk instance loads. `AuthShell` scopes
// `suppressHydrationWarning` around the mount so React 19 doesn't flag the
// portal handoff. Theme comes from `lib/clerk-appearance.ts` via
// <ClerkProvider> in app/layout.tsx — no need to pass `appearance` here.
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
      <SignIn fallbackRedirectUrl="/after-sign-in" signUpUrl="/sign-up" />
    </AuthShell>
  );
}

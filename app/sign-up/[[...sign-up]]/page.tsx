import { SignUp } from "@clerk/nextjs";

// See note in app/sign-in/[[...sign-in]]/page.tsx — same Clerk `withClerk` HOC
// returns null on the server and a portal mount target on the client, so we
// suppress the hydration mismatch on the immediate wrapper.
export default function SignUpPage() {
  return (
    <div className="bg-canvas flex min-h-screen items-center justify-center px-4 py-12">
      <div suppressHydrationWarning>
        <SignUp />
      </div>
    </div>
  );
}

import { SignIn } from "@clerk/nextjs";

// Clerk's `<SignIn>` is wrapped in a `withClerk` HOC that returns `null` until
// the client-side Clerk instance loads, then renders a `<div data-clerk-component="SignIn">`
// portal mount target. The server-rendered HTML is empty for that subtree, so React
// 19 flags the mismatch on hydration. `suppressHydrationWarning` is the canonical
// escape hatch for third-party portal mounts whose first paint deliberately differs
// from SSR. Scoped tightly to the Clerk subtree.
export default function SignInPage() {
  return (
    <div className="bg-canvas flex min-h-screen items-center justify-center px-4 py-12">
      <div suppressHydrationWarning>
        <SignIn />
      </div>
    </div>
  );
}

"use client";

import { SignIn, SignUp } from "@clerk/nextjs";
import { useSyncExternalStore, type ComponentProps } from "react";

/**
 * Client-only mount wrappers for Clerk's `<SignIn>` / `<SignUp>` widgets.
 *
 * Under React 19 + Next 16, Clerk's widget produces a hydration mismatch:
 * the server renders up to `<ClerkHostRenderer>` while the client
 * additionally inserts a `<div data-clerk-component="…">` container with a
 * live ref. `AuthShell`'s `suppressHydrationWarning` only covers one level,
 * so the deeper mismatch surfaces as a fatal hydration error.
 *
 * Deferring the widget until after hydration bypasses the mismatch entirely
 * — the widget is client-rendered only, and there's no server tree for
 * React to reconcile against. We use `useSyncExternalStore` for the "am I
 * on the client?" gate rather than `useEffect(setState)` because the latter
 * trips React 19's cascading-render lint.
 *
 * Tradeoff: users see a brief empty container between hydration and Clerk
 * client bootstrap. The surrounding chrome (brand mark, footer, gradient)
 * is still SSR'd, so the surface never appears blank.
 */

const noopSubscribe = () => () => {};
const trueOnClient = () => true;
const falseOnServer = () => false;

function useHasHydrated(): boolean {
  return useSyncExternalStore(noopSubscribe, trueOnClient, falseOnServer);
}

export function ClerkSignInMount(props: ComponentProps<typeof SignIn>) {
  const hydrated = useHasHydrated();
  if (!hydrated) return null;
  return <SignIn {...props} />;
}

export function ClerkSignUpMount(props: ComponentProps<typeof SignUp>) {
  const hydrated = useHasHydrated();
  if (!hydrated) return null;
  return <SignUp {...props} />;
}

"use client";

import { resetConsent } from "@/lib/consent";

/**
 * Footer entry point that reopens the consent banner. Wiring is trivial —
 * `resetConsent` clears the stored choice and fires the change event the
 * banner subscribes to, so it pops back into view without a page reload.
 */
export function CookiePreferencesButton({
  className,
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <button type="button" onClick={() => resetConsent()} className={className} style={style}>
      Cookie preferences
    </button>
  );
}

import "server-only";

/**
 * Cloudflare Turnstile server-side verification. Called from the
 * `/contact` support form action to gate anti-abuse before we touch the
 * DB — a missing/failed token is a hard reject, not fire-and-forget.
 *
 * Environment posture:
 *   - `TURNSTILE_SECRET_KEY` unset → verification is a no-op that returns
 *     ok. Convenient for local dev without a Cloudflare account. Prod
 *     MUST have the key set; the boot-time check for it lives on the
 *     public form (`TURNSTILE_SITE_KEY`) — if you deploy without either,
 *     the widget won't render and the form will refuse to submit.
 *   - `TURNSTILE_SITE_KEY` (public) is the widget-side key, consumed by
 *     `TurnstileWidget` — this file never reads it.
 */

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export type TurnstileResult = { ok: true } | { ok: false; error: string };

export async function verifyTurnstile(
  token: string | null | undefined,
  remoteIp: string | null | undefined,
): Promise<TurnstileResult> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    // Dev shortcut — see file header. Log so it's obvious when a prod
    // deploy is missing the key.
    console.warn("[turnstile] TURNSTILE_SECRET_KEY not set — skipping verification");
    return { ok: true };
  }

  if (!token) {
    return { ok: false, error: "Please complete the anti-spam challenge." };
  }

  const body = new URLSearchParams({ secret, response: token });
  if (remoteIp) body.set("remoteip", remoteIp);

  try {
    const res = await fetch(VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      // Cloudflare's verify endpoint is fast — bound it tightly so a
      // regional hiccup doesn't stretch the submit into a spinner.
      signal: AbortSignal.timeout(4_000),
    });

    if (!res.ok) {
      console.warn(`[turnstile] siteverify returned ${res.status}`);
      return { ok: false, error: "Couldn't verify the anti-spam challenge. Please try again." };
    }

    const data = (await res.json()) as {
      success: boolean;
      "error-codes"?: string[];
    };

    if (!data.success) {
      console.warn("[turnstile] siteverify rejected", data["error-codes"]);
      return { ok: false, error: "Anti-spam challenge failed. Please refresh and try again." };
    }
    return { ok: true };
  } catch (err) {
    console.warn("[turnstile] siteverify threw", err);
    return { ok: false, error: "Couldn't verify the anti-spam challenge. Please try again." };
  }
}

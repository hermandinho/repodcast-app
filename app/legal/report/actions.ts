"use server";

import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { submitPublicAbuseReport } from "@/server/db/system/quality";

/**
 * Public-intake server action for `/legal/report`.
 *
 * Not authenticated — the route is on the middleware's public list. To
 * cut spam volume without adding an edge rate-limiter, the form ships a
 * honeypot input named `website` that humans leave blank. A non-empty
 * value here fails silently to the success page so bots stop retrying.
 */
export async function submitLegalReportAction(formData: FormData): Promise<void> {
  const honeypot = strOrEmpty(formData.get("website"));
  if (honeypot.length > 0) {
    // Bots fill hidden fields; humans don't. Fail silently to look like
    // a real submit without actually persisting.
    redirect("/legal/report?ok=1");
  }

  try {
    await submitPublicAbuseReport({
      reportedByEmail: strOrUndef(formData.get("reportedByEmail")),
      category: strOrEmpty(formData.get("category")) as
        "SPAM" | "COPYRIGHT" | "IMPERSONATION" | "HARASSMENT" | "OTHER",
      body: strOrEmpty(formData.get("body")),
      targetHint: strOrUndef(formData.get("targetHint")),
    });
  } catch (err) {
    // Redirect vs. throw so the browser lands on a clean URL — Next
    // otherwise renders the error page which leaks internals.
    if (err instanceof ZodError) {
      redirect(`/legal/report?error=invalid`);
    }
    console.error("submitLegalReportAction failed", err);
    redirect(`/legal/report?error=unknown`);
  }

  redirect("/legal/report?ok=1");
}

function strOrEmpty(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v : "";
}

function strOrUndef(v: FormDataEntryValue | null): string | undefined {
  if (typeof v !== "string") return undefined;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

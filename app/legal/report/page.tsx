import Link from "next/link";
import { submitLegalReportAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Public abuse-report intake. Anyone can hit this page and submit a
 * report — the row lands in `AbuseReport` with status OPEN and the
 * operator queue at `/root/quality` picks it up for triage.
 *
 * Deliberately minimal: title + short intro + form. No branding, no
 * marketing chrome. This is the same UX we'd point a rights-holder or a
 * harassment complainant at, so it needs to feel administrative, not
 * salesy.
 */
export default async function LegalReportPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const submitted = sp.ok === "1";

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-8 px-6 py-16">
      <header>
        <p className="font-mono text-[11px] tracking-[0.1em] text-zinc-500 uppercase">
          Repodcast — Trust & Safety
        </p>
        <h1 className="font-display mt-2 text-2xl font-semibold text-zinc-900">Report abuse</h1>
        <p className="mt-3 text-sm leading-relaxed text-zinc-600">
          Report spam, copyright infringement, impersonation, or harassment involving content
          created or shared through Repodcast. We review every submission. For urgent legal matters,
          email{" "}
          <a href="mailto:legal@repodcast.io" className="text-zinc-900 underline">
            legal@repodcast.io
          </a>{" "}
          instead.
        </p>
      </header>

      {submitted ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-900">
          <div className="font-semibold">Thanks — your report was received.</div>
          <p className="mt-1 text-emerald-800">
            An operator will review it. If you left an email address, we&apos;ll reply when
            there&apos;s an update. Submit another report{" "}
            <Link href="/legal/report" className="underline">
              here
            </Link>
            .
          </p>
        </div>
      ) : (
        <ReportForm error={sp.error ?? null} />
      )}

      <footer className="text-xs text-zinc-500">
        <Link href="/" className="hover:text-zinc-800">
          ← Back to Repodcast
        </Link>
      </footer>
    </main>
  );
}

function ReportForm({ error }: { error: string | null }) {
  return (
    <form action={submitLegalReportAction} className="flex flex-col gap-5">
      {error === "invalid" ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          A required field was missing or the body was too short. Please fix and resubmit — the body
          needs at least 20 characters.
        </div>
      ) : error === "unknown" ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          Something went wrong on our end. Try again in a minute, or email legal@repodcast.io
          directly.
        </div>
      ) : null}

      <Field label="Category" required>
        <select
          name="category"
          required
          defaultValue=""
          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-500"
        >
          <option value="" disabled>
            Select a category…
          </option>
          <option value="COPYRIGHT">Copyright infringement</option>
          <option value="IMPERSONATION">Impersonation or misleading brand use</option>
          <option value="HARASSMENT">Harassment or abusive content</option>
          <option value="SPAM">Spam or misleading content</option>
          <option value="OTHER">Other (explain below)</option>
        </select>
      </Field>

      <Field
        label="What did you see, and where?"
        required
        hint="Paste links, handles, or a description. The more specific, the faster we can act."
      >
        <textarea
          name="body"
          required
          minLength={20}
          maxLength={10000}
          rows={6}
          placeholder="I saw @handle on twitter.com/… republishing my podcast episode without attribution. The Repodcast-generated post appears at …"
          className="w-full resize-y rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-zinc-500"
        />
      </Field>

      <Field
        label="Target URL or ID"
        hint="Optional — a link or reference to the content being reported. Helps triage but isn't required."
      >
        <input
          name="targetHint"
          type="text"
          maxLength={1000}
          placeholder="https://…  or  @username  or  post ID"
          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-zinc-500"
        />
      </Field>

      <Field
        label="Your email"
        hint="Optional. If provided, we'll email you when the report is resolved. We do not share this address."
      >
        <input
          name="reportedByEmail"
          type="email"
          maxLength={320}
          placeholder="you@example.com"
          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-zinc-500"
        />
      </Field>

      {/* Honeypot — real users leave this blank; bots fill it. Server
          action redirects silently to the success page so the bot
          doesn't retry. */}
      <div className="hidden" aria-hidden>
        <label>
          Website (leave blank)
          <input name="website" type="text" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      <div className="flex items-center justify-between border-t border-zinc-200 pt-5">
        <p className="text-xs text-zinc-500">
          By submitting you agree that your report may be shared with the reported party as part of
          our review.
        </p>
        <button
          type="submit"
          className="rounded-lg bg-zinc-900 px-5 py-2 text-sm font-semibold text-white transition-[filter] hover:brightness-110"
        >
          Submit report
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  hint,
  required = false,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[13px] font-semibold text-zinc-900">
        {label}
        {required ? <span className="ml-1 text-zinc-400">*</span> : null}
      </span>
      {children}
      {hint ? <span className="text-[11.5px] text-zinc-500">{hint}</span> : null}
    </label>
  );
}

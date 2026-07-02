import { ExternalScheduler, MemberRole } from "@prisma/client";
import { requireAuthContext } from "@/server/auth/context";
import { toTenantContext } from "@/server/auth/tenant";
import { listIntegrationsForAgency } from "@/server/db/integrations";
import { BufferIntegrationCard } from "@/components/settings/buffer-integration-card";

export const dynamic = "force-dynamic";

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ buffer?: string; error?: string }>;
}) {
  const [auth, sp] = await Promise.all([requireAuthContext(), searchParams]);
  const ctx = toTenantContext(auth);
  const integrations = await listIntegrationsForAgency(ctx);
  const buffer = integrations.find((i) => i.provider === ExternalScheduler.BUFFER) ?? null;

  const canManage = auth.member.role === MemberRole.OWNER || auth.member.role === MemberRole.ADMIN;

  return (
    <div className="flex flex-col gap-4">
      {sp.buffer === "connected" ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] text-emerald-900">
          Buffer connected. Approved posts on Twitter, LinkedIn, Instagram, and TikTok can now be
          scheduled through Buffer.
        </div>
      ) : null}
      {sp.buffer === "disconnected" ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900">
          Buffer disconnected. In-flight scheduled posts have been downgraded to manual — verify
          them on Buffer&apos;s side.
        </div>
      ) : null}
      {sp.error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-900">
          {BUFFER_ERROR_COPY[sp.error] ?? BUFFER_ERROR_COPY.unknown}
        </div>
      ) : null}

      <BufferIntegrationCard integration={buffer} canManage={canManage} />

      <div className="border-border bg-surface shadow-card rounded-3xl border p-6 opacity-60">
        <div className="text-muted-2 font-sans text-[11.5px] font-semibold tracking-[0.06em] uppercase">
          Coming soon
        </div>
        <div className="font-display text-ink mt-1 text-[18px] font-semibold">
          Typefully & native publishing
        </div>
        <p className="text-muted mt-1 max-w-[640px] text-[12.5px] leading-[1.55]">
          Typefully-style thread drafting, plus first-party publishing directly to Twitter,
          LinkedIn, Instagram, and TikTok, are on the roadmap. For now, Buffer covers the same four
          platforms with a single connection.
        </p>
      </div>
    </div>
  );
}

const BUFFER_ERROR_COPY: Record<string, string> = {
  missing_code: "Buffer didn't return an authorization code — try connecting again.",
  bad_state: "Security check failed on the OAuth callback. Try the flow again.",
  token_exchange_failed:
    "Buffer rejected the authorization code. It may have already been used — try again.",
  missing_encryption_key:
    "INTEGRATION_ENCRYPTION_KEY isn't set on this environment. Add it to .env.local and restart the dev server.",
  missing_verifier:
    "PKCE verifier cookie was missing on the OAuth return — try connecting again from the same browser tab.",
  missing_buffer_client_id:
    "BUFFER_CLIENT_ID isn't set. Create a Buffer OAuth app at https://buffer.com/developers/apps and add the Client ID to .env.local.",
  missing_buffer_client_secret:
    "BUFFER_CLIENT_SECRET isn't set. Copy the Client Secret from your Buffer OAuth app into .env.local.",
  token_vault_unavailable:
    "The integration encryption key isn't configured on this environment. Contact support.",
  unknown: "Something went wrong connecting Buffer. Try again or reach out to support.",
};

/**
 * Generic 404 for invalid / revoked / expired portal links.
 *
 * Deliberately vague — we render the same surface regardless of *why*
 * the token didn't resolve so a probing visitor can't distinguish "no
 * such link" from "revoked" or "expired". The agency operator who
 * owns the link sees the real state in `/clients/[key]/billing`.
 */
export default function PortalNotFound() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-[480px] items-center justify-center px-6 py-10 text-center">
      <div>
        <div className="font-display text-ink text-[24px] font-semibold">Link unavailable</div>
        <p className="text-muted mt-3 text-[13.5px] leading-[1.6]">
          This link isn&apos;t valid, has expired, or was revoked. Ask whoever sent it for a fresh
          URL.
        </p>
      </div>
    </div>
  );
}

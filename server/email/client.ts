import "server-only";

import { Resend } from "resend";

let _resend: Resend | null = null;

export function getResendClient(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  if (!_resend) _resend = new Resend(key);
  return _resend;
}

export function requireResendClient(): Resend {
  const client = getResendClient();
  if (!client) throw new Error("RESEND_API_KEY is not set");
  return client;
}

export const FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? "Repodcast <no-reply@repodcast.app>";

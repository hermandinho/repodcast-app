import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Phase 3.3 — AES-256-GCM helper for Buffer / Typefully OAuth tokens.
 *
 * Storage format: `<iv_b64>.<ciphertext_b64>.<authTag_b64>` (three base64url
 * segments, joined with `.`). Reasoning: `INTEGRATION_ENCRYPTION_KEY` grants
 * post-authoring rights on customer social graphs — a plaintext leak from a
 * DB dump is materially worse than the tiny ergonomics cost of a wrapper.
 *
 * The key is a base64-encoded 32-byte random value. In dev, generate one
 * with:  `node -e 'console.log(require("crypto").randomBytes(32).toString("base64"))'`
 *
 * Missing/invalid key → `TokenVaultUnavailableError`. Callers surface this
 * as a "feature disabled" state instead of a 500.
 */

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;

export class TokenVaultUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenVaultUnavailableError";
  }
}

export class TokenVaultDecryptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenVaultDecryptError";
  }
}

function loadKey(): Buffer {
  const raw = process.env.INTEGRATION_ENCRYPTION_KEY;
  if (!raw) {
    throw new TokenVaultUnavailableError(
      "INTEGRATION_ENCRYPTION_KEY not set. Scheduling integrations require a 32-byte base64 key.",
    );
  }
  let buf: Buffer;
  try {
    buf = Buffer.from(raw, "base64");
  } catch {
    throw new TokenVaultUnavailableError("INTEGRATION_ENCRYPTION_KEY is not valid base64.");
  }
  if (buf.byteLength !== KEY_BYTES) {
    throw new TokenVaultUnavailableError(
      `INTEGRATION_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes, got ${buf.byteLength}.`,
    );
  }
  return buf;
}

export function isTokenVaultAvailable(): boolean {
  try {
    loadKey();
    return true;
  } catch {
    return false;
  }
}

export function encryptToken(plaintext: string): string {
  const key = loadKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${ct.toString("base64")}.${tag.toString("base64")}`;
}

export function decryptToken(payload: string): string {
  const key = loadKey();
  const parts = payload.split(".");
  if (parts.length !== 3) {
    throw new TokenVaultDecryptError("Ciphertext payload is malformed.");
  }
  const [ivB64, ctB64, tagB64] = parts;
  const iv = Buffer.from(ivB64!, "base64");
  const ct = Buffer.from(ctB64!, "base64");
  const tag = Buffer.from(tagB64!, "base64");
  if (iv.byteLength !== IV_BYTES) {
    throw new TokenVaultDecryptError(
      `IV length mismatch (expected ${IV_BYTES}, got ${iv.byteLength}).`,
    );
  }
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch {
    throw new TokenVaultDecryptError(
      "Ciphertext failed authentication — key rotated or payload tampered.",
    );
  }
}

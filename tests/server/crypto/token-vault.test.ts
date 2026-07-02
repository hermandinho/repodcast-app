/**
 * Phase 3.3 — token vault coverage.
 *
 * Verifies:
 *   - Round-trip encrypt/decrypt with a known key.
 *   - Tampered ciphertext raises `TokenVaultDecryptError` (GCM auth tag).
 *   - Missing key raises `TokenVaultUnavailableError`, not a silent success.
 *   - Malformed key length is rejected up front.
 */

import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const KEY_B64 = randomBytes(32).toString("base64");

async function loadFresh() {
  // The module reads the env var lazily, so we can mutate + re-import for
  // each test scenario without contaminating other test files.
  const mod = await import("@/server/crypto/token-vault");
  return mod;
}

describe("token-vault", () => {
  let original: string | undefined;

  beforeEach(() => {
    original = process.env.INTEGRATION_ENCRYPTION_KEY;
    process.env.INTEGRATION_ENCRYPTION_KEY = KEY_B64;
  });

  afterEach(() => {
    if (original === undefined) delete process.env.INTEGRATION_ENCRYPTION_KEY;
    else process.env.INTEGRATION_ENCRYPTION_KEY = original;
  });

  it("round-trips plaintext through encrypt/decrypt", async () => {
    const { encryptToken, decryptToken } = await loadFresh();
    const plaintext = "buffer_access_token_abc123";
    const ciphertext = encryptToken(plaintext);
    expect(ciphertext.split(".").length).toBe(3);
    expect(ciphertext).not.toContain(plaintext);
    expect(decryptToken(ciphertext)).toBe(plaintext);
  });

  it("rejects tampered ciphertext with a decrypt error", async () => {
    const { encryptToken, decryptToken, TokenVaultDecryptError } = await loadFresh();
    const ciphertext = encryptToken("hello");
    const parts = ciphertext.split(".");
    // Flip a byte in the middle segment to invalidate the GCM auth tag.
    const raw = Buffer.from(parts[1]!, "base64");
    raw[0] = raw[0]! ^ 0xff;
    const tampered = `${parts[0]}.${raw.toString("base64")}.${parts[2]}`;
    expect(() => decryptToken(tampered)).toThrow(TokenVaultDecryptError);
  });

  it("throws TokenVaultUnavailableError when key is missing", async () => {
    delete process.env.INTEGRATION_ENCRYPTION_KEY;
    const { encryptToken, TokenVaultUnavailableError, isTokenVaultAvailable } = await loadFresh();
    expect(isTokenVaultAvailable()).toBe(false);
    expect(() => encryptToken("x")).toThrow(TokenVaultUnavailableError);
  });

  it("throws when the key isn't 32 bytes", async () => {
    process.env.INTEGRATION_ENCRYPTION_KEY = Buffer.alloc(16).toString("base64");
    const { encryptToken, TokenVaultUnavailableError } = await loadFresh();
    expect(() => encryptToken("x")).toThrow(TokenVaultUnavailableError);
  });

  it("rejects a malformed 3-segment payload", async () => {
    const { decryptToken, TokenVaultDecryptError } = await loadFresh();
    expect(() => decryptToken("only.two")).toThrow(TokenVaultDecryptError);
  });
});

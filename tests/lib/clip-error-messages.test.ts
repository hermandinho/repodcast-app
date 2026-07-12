import { describe, expect, it } from "vitest";
import { translateClipRenderError } from "@/lib/clip-error-messages";

describe("translateClipRenderError", () => {
  it("returns null for null input", () => {
    expect(translateClipRenderError(null)).toBeNull();
  });

  it("maps YouTube 'Video unavailable' to a friendly translation", () => {
    const t = translateClipRenderError("Video unavailable");
    expect(t?.friendly).toMatch(/YouTube isn't letting/i);
    expect(t?.hint).toBeDefined();
    expect(t?.raw).toBe("Video unavailable");
  });

  it("maps 'Sign in to confirm you're not a bot' to the bot-check message", () => {
    const t = translateClipRenderError(
      "Sign in to confirm you're not a bot. This helps protect our community.",
    );
    expect(t?.friendly).toMatch(/prove we're not a bot/i);
  });

  it("distinguishes 404 from 403 in direct-fetch errors", () => {
    const t403 = translateClipRenderError("source fetch failed: 403 Forbidden");
    const t404 = translateClipRenderError("source fetch failed: 404 Not Found");
    // 403 → "refusing our request", 404 → "gone"
    expect(t403?.friendly).toMatch(/refusing/i);
    expect(t404?.friendly).toMatch(/gone/i);
  });

  it("maps 'no video stream' to the audiogram-hint message", () => {
    const t = translateClipRenderError("Output file does not contain any stream: no video stream");
    expect(t?.friendly).toMatch(/video track/i);
    expect(t?.hint).toMatch(/audiogram/i);
  });

  it("differentiates 5xx and 4xx worker errors", () => {
    const t5xx = translateClipRenderError("RenderWorker 502: bad gateway");
    const t4xx = translateClipRenderError("RenderWorker 400: invalid request");
    expect(t5xx?.friendly).toMatch(/temporary/i);
    expect(t4xx?.friendly).toMatch(/rejected/i);
  });

  it("catches timeouts", () => {
    expect(translateClipRenderError("ETIMEDOUT after 300000ms")?.friendly).toMatch(/too long/i);
    expect(translateClipRenderError("Command timed out")?.friendly).toMatch(/too long/i);
  });

  it("falls back to a generic message when nothing matches", () => {
    const t = translateClipRenderError("some obscure ffmpeg error 0x8badf00d");
    expect(t?.friendly).toBe("The clip failed to render.");
    expect(t?.hint).toContain("0x8badf00d");
  });

  it("keeps the raw error string intact for the tooltip", () => {
    const raw = "Video unavailable — copyright claim by Sony Music";
    const t = translateClipRenderError(raw);
    expect(t?.raw).toBe(raw);
  });
});

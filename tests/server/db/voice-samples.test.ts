import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemberRole, Platform } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  prisma: {
    generatedOutput: { findFirst: vi.fn() },
    voiceSample: { create: vi.fn() },
  },
}));

vi.mock("@/server/db/client", () => ({ prisma: mocks.prisma }));

import { createSampleFromOutput, createSampleFromOutputRaw } from "@/server/db/voice-samples";
import type { TenantContext } from "@/server/auth/tenant";

const ctx: TenantContext = {
  agencyId: "a1",
  role: MemberRole.OWNER,
};

// A well-formed LinkedIn output that easily clears the quality floor.
// (Length inside 700–1400 + 3+ paragraphs + no hashtag spam ⇒ ~100 pts.)
const GOOD_LINKEDIN_CONTENT = [
  "Founders keep telling me the same thing: their team is drowning in customer feedback and no one has time to make sense of it.",
  "The pattern I see over and over — the founders who eventually break through are the ones who stop treating this as a research problem and start treating it as a routing problem.",
  "You don't need a synthesis. You need a fast, cheap way to decide which conversations belong in the roadmap review vs. the sales-enablement drawer.",
  "Try this next week: bucket every inbound note into one of three folders before you read it. Watch what happens to your triage time.",
].join("\n\n");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("writeSampleFromOutput quality gate", () => {
  it("persists a VoiceSample when the output clears the quality floor", async () => {
    mocks.prisma.generatedOutput.findFirst.mockResolvedValueOnce({
      id: "o1",
      platform: Platform.LINKEDIN,
      content: GOOD_LINKEDIN_CONTENT,
      episodeId: "ep1",
      episode: { showId: "s1" },
    });
    mocks.prisma.voiceSample.create.mockResolvedValueOnce({ id: "vs1" });

    const sample = await createSampleFromOutput(ctx, "o1");

    expect(sample).not.toBeNull();
    expect(mocks.prisma.voiceSample.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        showId: "s1",
        platform: Platform.LINKEDIN,
        generatedOutputId: "o1",
        episodeId: "ep1",
      }),
    });
  });

  it("skips the VoiceSample write when the output falls below the floor", async () => {
    // 5-char content on BLOG scores near zero on both axes.
    mocks.prisma.generatedOutput.findFirst.mockResolvedValueOnce({
      id: "o2",
      platform: Platform.BLOG,
      content: "hi",
      episodeId: "ep1",
      episode: { showId: "s1" },
    });

    const sample = await createSampleFromOutput(ctx, "o2");

    expect(sample).toBeNull();
    expect(mocks.prisma.voiceSample.create).not.toHaveBeenCalled();
  });

  it("portal path also enforces the quality floor", async () => {
    mocks.prisma.generatedOutput.findFirst.mockResolvedValueOnce({
      id: "o3",
      platform: Platform.BLOG,
      content: "",
      episodeId: "ep1",
      episode: { showId: "s1" },
    });

    const sample = await createSampleFromOutputRaw("o3", "a1");

    expect(sample).toBeNull();
    expect(mocks.prisma.voiceSample.create).not.toHaveBeenCalled();
  });
});

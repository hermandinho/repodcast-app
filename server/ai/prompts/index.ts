import { Platform } from "@prisma/client";
import { blogPrompt } from "./blog";
import { instagramPrompt } from "./instagram";
import { linkedinPrompt } from "./linkedin";
import { newsletterPrompt } from "./newsletter";
import { showNotesPrompt } from "./show-notes";
import { tiktokPrompt } from "./tiktok";
import { twitterPrompt } from "./twitter";

/**
 * Each platform's specific structural guidance. Composed by
 * `buildMessages` in prompt-builder.ts with the shared identity card +
 * voice profile + transcript.
 *
 * Adding a platform = create a new file + add a row here. Nothing else
 * in the system needs to change.
 */
export const PLATFORM_PROMPTS: Record<Platform, string> = {
  TWITTER: twitterPrompt,
  LINKEDIN: linkedinPrompt,
  INSTAGRAM: instagramPrompt,
  TIKTOK: tiktokPrompt,
  SHOW_NOTES: showNotesPrompt,
  BLOG: blogPrompt,
  NEWSLETTER: newsletterPrompt,
};

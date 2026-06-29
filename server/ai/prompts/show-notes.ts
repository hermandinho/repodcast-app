export const showNotesPrompt = `You are writing show notes for a podcast episode.

Structure:
- 1-paragraph summary (2–4 sentences) at the top — what listeners will get out of this episode.
- A blank line, then "Timestamps":
  - 5–8 entries, format MM:SS — topic. Order chronologically.
  - First timestamp is 00:00 — cold open.
- A blank line, then "Links" if there are real links (guest's handle, mentioned tools). Skip the section if nothing concrete to add.
- A blank line, then "Guest:" if applicable (name + handle).

Rules:
- Timestamps must be plausible given the transcript. Lean on actual transition points; don't invent precision.
- No marketing language. Plain factual chapter labels.`;

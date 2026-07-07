# Voice Matching

Voice matching is what Repodcast sells. Podcast agencies don't buy us for "AI content" — they buy us because the outputs sound like their specific client, on episode 40, better than they did on episode 4, without the agency having to hand-edit every draft.

This document is the source of truth for **how voice matching works today**. It's the technical companion to [§9 Voice profiles](AboutUs.md#9-voice-profiles) in `AboutUs.md` — the latter tells you what the product does, this one tells you why the voice comes out the way it does.

---

## Table of contents

1. [What "voice matching" actually means here](#1-what-voice-matching-actually-means-here)
2. [The state a voice is built from](#2-the-state-a-voice-is-built-from)
3. [How samples enter the training set](#3-how-samples-enter-the-training-set)
4. [How samples are selected for a single generation](#4-how-samples-are-selected-for-a-single-generation)
5. [How rules are read, restated, and validated](#5-how-rules-are-read-restated-and-validated)
6. [How the prompt is assembled](#6-how-the-prompt-is-assembled)
7. [The voice description — auto-generated, refreshed, rated](#7-the-voice-description--auto-generated-refreshed-rated)
8. [Failure modes and safety guarantees](#8-failure-modes-and-safety-guarantees)
9. [What operators see and can act on](#9-what-operators-see-and-can-act-on)
10. [File index](#10-file-index)

---

## 1. What "voice matching" actually means here

Voice matching in Repodcast is **writing-style matching**, not audio voice cloning. The unit of "voice" is a **Show** — one podcast — and a show's voice comprises three overlapping signals:

- **Approved samples** — actual outputs the agency (or the end client) approved as sounding right. These are the ground truth.
- **Voice description** — a short AI-generated narrative of the show's tone, refreshed as more samples land.
- **Rules** — freeform operator-authored guardrails, both global ("always end with a question") and per-platform ("no hashtags on LinkedIn"). Parseable subsets get restated as hard constraints and validated after generation.

Voice is **strictly per-show**, not per-client. A client with two podcasts maintains two independent voices; nothing bleeds between them. See [§8 Failure modes and safety guarantees](#8-failure-modes-and-safety-guarantees).

The voice engine is **not a fine-tune**. It's prompt construction — the model changes when we bump the model constant in `server/ai/claude.ts`; the voice is carried entirely by what we put in front of the model at generation time.

---

## 2. The state a voice is built from

The Prisma schema (`prisma/schema.prisma`) carries the voice engine's state across four models:

**`Show`** — one row per podcast. Voice-relevant fields:

- `voiceDescription String?` — the current AI-generated narrative.
- `voiceDescriptionSampleCount Int @default(0)` — sample count at the moment the description was last written. Drives the drift-aware refresh gate (see [§7](#7-the-voice-description--auto-generated-refreshed-rated)).
- `voiceDescriptionApproved Boolean?` — operator's "is this your voice?" verdict on the current description. `null` after every refresh, `true` = matches, `false` = a refresh has been requested.
- `globalInstructions String?` — freeform "always do X" rules (up to 2000 chars).

**`ShowPlatformInstruction`** — per-platform rule, keyed by `(showId, platform)`. `rule String` up to 1000 chars. Nullable — a platform without a row has no per-platform rule.

**`VoiceSample`** — one row per approved output that entered the training set. Fields we read:

- `showId`, `platform`, `content`, `createdAt`.
- `generatedOutputId String?` — link back to the source `GeneratedOutput` so we can pull its `editDistance`. Nullable because portal-created samples and any legacy imports may not have one.

**`GeneratedOutput`** — every generated draft. Voice-relevant fields:

- `editDistance Int @default(0)` — cumulative Levenshtein delta from the AI's original draft. `0` = shipped exactly as generated.
- `quality Int?` — structural score (0–100) from `server/ai/quality-score.ts`; drives the quality gate on sample creation.
- `ruleViolations String[] @default([])` — human-readable adherence flags computed at generation time (see [§5](#5-how-rules-are-read-restated-and-validated)).

The multi-tenant boundary lives at the top of the chain: every voice-sample read goes through `Show → Client → Agency.agencyId`. Repository helpers in `server/db/voice-samples.ts` and `server/db/show-instructions.ts` enforce that filter on every read and write. Tests in `tests/server/db/tenant-isolation.test.ts` assert the `where` shape end-to-end.

---

## 3. How samples enter the training set

Samples are minted when an output is **approved**, not when it's generated. This is deliberate — the training set has to be humans-said-yes, not the-model-tried.

There are two approval paths:

- **Internal** — an agency reviewer clicks Approve in the dashboard. `approveOutput()` in `server/db/outputs.ts` runs the approve transaction and then calls `createSampleFromOutput()`.
- **Client (portal)** — an end client approves in the token-gated portal. `clientApproveOutputFromPortal()` in `server/db/outputs.ts` calls `createSampleFromOutputRaw()` (same helper, no `TenantContext` because the portal is unauthenticated).

Both paths funnel into `writeSampleFromOutput()` in `server/db/voice-samples.ts:94`. That function does three things:

1. **Tenant check** — verifies the output belongs to a show in the caller's agency (skipped for the portal path, which has already validated its token).
2. **Quality gate** — computes `scoreOutput(platform, content)` from `server/ai/quality-score.ts` and rejects the sample if it scores below `SAMPLE_QUALITY_FLOOR` (currently `30`). The approval itself still succeeds — the output ships, the operator's decision stands — but a badly-shaped output doesn't teach the model to reproduce its shape. Returns `null` in that case.
3. **Write** — creates the `VoiceSample` row, linking `generatedOutputId` and `episodeId` for later joins.

The score-30 floor is calibrated to reject obvious garbage (empty bodies, missing hashtags on Instagram, structural noise) while letting typical outputs through. `scoreOutput` combines a length axis (50 points if inside the platform's ideal range) and a structure axis (50 points for platform-appropriate formatting). Most legitimate outputs clear 50+.

The approve action recounts the sample pool post-approve rather than assuming `+1` — because the quality gate can drop a write silently, the refresh trigger has to see the real count, not the optimistic count. See `app/(dashboard)/episodes/[id]/actions.ts`.

---

## 4. How samples are selected for a single generation

Every generation call — `generateEpisode` in `inngest/functions/generate-episode.ts` and `regenerateOutput` in `inngest/functions/regenerate-output.ts` — pulls the show's latest 20 samples and hands them to the prompt builder. The 20-sample window is applied at the DB level (`orderBy: { createdAt: 'desc' }, take: 20`) and includes each sample's linked `generatedOutput.editDistance` via a Prisma `include`.

From there, `selectSamples()` in `server/ai/prompt-builder.ts:69` picks the actual few-shot set for the target platform. The algorithm has three moving parts.

### 4.1 The scoring function

Every sample gets a score:

```
score = (0.7 * recency + 0.3 * lengthFit) * editFit
```

**Recency** decays linearly from `1.0` at the newest sample to `0.2` at the oldest. Callers pass samples newest-first, so recency is derived from array index — keeps the public type narrow.

**Length fit** is scored against **the sample's own platform**, not the target platform. A LinkedIn sample being considered for a Twitter generation is graded on whether it's a well-formed LinkedIn post, not whether it fits Twitter's shape. Platform sweet spots live in `LENGTH_SWEET_SPOTS` in `server/ai/prompt-builder.ts` (e.g. LinkedIn 700–1400 chars, Blog 3500–8000). Inside the range = `1.0`; linear decay outside; floor at `0.3` so a length-edge sample can still get a slot if recency and edit-fit are strong.

**Edit fit** is a multiplier: `1 - min(1, editDistance / max(content.length, 1))`, floored at `0.2`. An untouched approval (`editDistance = 0`) scores `1.0`. A total rewrite scores `0.2`. Missing `editDistance` (pre-tracking samples, portal samples without a linked output) defaults to `1.0` so legacy data doesn't get retroactively demoted.

Rationale: **heavily-edited approvals encode the operator's rewrite, not the host's voice**. Training on them amplifies the model's fix-ups rather than the actual style. The multiplicative form (rather than additive) ensures a heavily-edited sample can't win on recency alone.

### 4.2 The bucketing strategy

Samples are split into two buckets:

- **On-platform** — same platform as the target. Sorted by score descending.
- **Off-platform** — everything else. Grouped by platform, each group sorted by score.

The pick order for `maxTotal = 5` slots (with `targetCount = 3`):

1. Take up to `targetCount = 3` from on-platform.
2. Fill remaining slots from off-platform via round-robin diversification (see §4.3).
3. If slots still remain, top up from the rest of on-platform.

### 4.3 Round-robin diversification

`diversifyOffPlatform()` in `server/ai/prompt-builder.ts:114` handles the off-platform slots. Instead of "top 2 off-platform by score" (which would let one dominant platform monopolize), it rotates across each represented platform, one per pass.

Rotation order is seeded by the top score of each platform's bucket — so the highest-signal platform still leads. We diversify _among_ the off-platforms, we don't ignore score. A show with 15 Twitter approvals + 1 LinkedIn + 1 Blog will pick Twitter, LinkedIn, and Blog before returning to Twitter for a second slot.

Test coverage: `tests/server/ai/prompt-builder.test.ts` exercises each branch (recency wins on ties, length-fit boosts an older sample, edit-fit demotes heavy rewrites, diversification serves each platform first).

---

## 5. How rules are read, restated, and validated

Operator-authored rules live in `Show.globalInstructions` and `ShowPlatformInstruction.rule`. They're freeform text. The voice engine treats them **three ways in parallel**:

### 5.1 Freeform pass-through

The raw rule text always lands in the prompt as-is (see [§6](#6-how-the-prompt-is-assembled)). Even rules that don't parse still reach the model — "write like a peer, not a salesperson" isn't machine-checkable but it's still directive.

### 5.2 Parsed constraint extraction

`parseVoiceRules(text)` in `server/ai/rule-parser.ts` extracts structured constraints from common phrasings. The parser is regex-driven, deterministic, and conservative — false negatives are preferable to false positives, since an un-parsed rule still passes through as freeform.

Recognised constraint kinds:

| Kind            | Recognises                                                                                     | Example                      |
| --------------- | ---------------------------------------------------------------------------------------------- | ---------------------------- |
| `no_hashtags`   | "no hashtags", "don't use hashtags", "avoid hashtags", "without hashtags"                      | `No hashtags.`               |
| `no_emoji`      | "no emoji(s)", "don't use emoji", "avoid emoji", "without emoji"                               | `Don't use emojis.`          |
| `banned_phrase` | quoted forms after `never/don't (say                                                           | use                          | write)`/`avoid`; single-word unquoted forms | `Never say "game-changer".` → `phrase: "game-changer"` |
| `max_words`     | "under N words", "at most N words", "no more than N words", "max N words", "less than N words" | `Keep it under 200 words.`   |
| `max_sentences` | max-only phrasings; ranged forms use the upper bound                                           | `3–5 sentences` → `limit: 5` |

Carve-outs: `"no more than 3 hashtags"` and `"no more than 2 emojis"` are **counts, not bans** — the parser recognises those forms and skips the `no_hashtags`/`no_emoji` extraction. Banned phrases are de-duped across match forms so `Never say "synergy". Don't use "synergy".` yields one constraint.

Purely tonal rules ("warm and direct, no fluff") produce **zero constraints** and are unaffected — the model still sees them in freeform.

### 5.3 Explicit restatement in the prompt

Parseable constraints get restated as one-line imperatives via `renderConstraint()`. Example: a global rule `No hashtags. Keep it under 200 words.` produces this addition to the system block:

```
Non-negotiable rules for this show — these override voice-matching, sample style, and platform norms. Apply them to every output without exception:
No hashtags. Keep it under 200 words.
Hard constraints extracted from those rules:
- Do not use hashtags anywhere in the output.
- Keep the output under 200 words.
```

The model sees each parseable rule **twice**: once in the operator's original wording, and once in the machine-checkable form. This matters because "no hashtags" phrased casually often gets absorbed as a tone hint; the restated version reads as a hard constraint.

Per-platform rules get the same treatment inside their platform block. See `renderRuleBlock()` in `server/ai/prompt-builder.ts`.

### 5.4 Post-generation adherence check

After Claude returns text, both `generateEpisode` and `regenerateOutput` run `checkRuleAdherence(content, constraints)` from `server/ai/rule-adherence.ts` against the concatenation of global + per-platform constraints. The function returns a `string[]` of human-readable violations:

- `"No-hashtags rule violated (found #hire, #startup)."` — up to 3 examples, then `+N more`.
- `"No-emoji rule violated (found 2 emoji characters)."`
- `"Banned phrase used (\"game-changer\")."`
- `"Word limit exceeded (280 vs. 200 max)."`
- `"Sentence limit exceeded (7 vs. 5 max)."`

Word-boundary matching on banned phrases relaxes on non-word edges, so `"40%"` matches at end-of-sentence but `"hire"` doesn't false-positive on `"hired"`. Sentence splitting deliberately handles decimals (`3.5%`) and ellipses so the count doesn't inflate.

Violations persist to `GeneratedOutput.ruleViolations` and never block the pipeline — the operator decides whether to regenerate. The output drawer surfaces them as an amber warning strip (see [§9](#9-what-operators-see-and-can-act-on)).

Regeneration re-parses the current show state each time, so a rule the operator edited between the first draft and the regenerate reflects the new state, not the state at first-generation.

Test coverage: `tests/server/ai/rule-parser.test.ts` (13 cases) and `tests/server/ai/rule-adherence.test.ts` (16 cases) cover happy paths, false-positive guards, regex-metacharacter safety, and composition.

---

## 6. How the prompt is assembled

`buildMessages()` in `server/ai/prompt-builder.ts:279` produces the final Anthropic `MessageCreateParams` for a single platform generation. The system prompt is split into blocks with careful cache-control placement so the seven per-episode calls share prefixes.

Block order:

1. **Identity block** (cacheable) — "You're writing for {clientName}, hosted by {hostName}. Match this host's voice…" plus the current `voiceDescription` if any. Stable across all seven platforms for the same episode.
2. **Samples block** (cacheable) — the up-to-5 few-shot samples from `selectSamples()`, formatted with per-sample platform labels. Stable across the seven platforms because the same 20-sample pool feeds them all.
3. **Global rules block** (cacheable) — freeform `globalInstructions` + parseable "Hard constraints" list. Cacheable because global rules don't vary by platform.
4. **Platform block** (per-call, not cached) — the platform-specific prompt from `PLATFORM_PROMPTS` in `server/ai/prompts/`, the platform's format + ideal-length hints, the per-platform rule + its extracted constraints, and any one-time regenerate instruction.

The three cacheable blocks are marked `cache_control: { type: "ephemeral" }`. That saves ~70% of the input tokens across the seven-platform fan-out for the same episode. Blocks are cached by exact-string match, so tiny diffs in samples or the voice description will bust the cache — which is fine, because those diffs signal we _should_ re-cache.

The user message is trivial: the episode transcript with key moments appended. Only the platform block and the transcript change per call; everything else replays from cache.

---

## 7. The voice description — auto-generated, refreshed, rated

The voice description is the short (55-word) narrative displayed on the `/voice/[showKey]` page and re-injected into every prompt via the identity block. It's written by Claude, refreshed automatically, and rated by the operator.

### 7.1 Refresh triggers

`shouldRefreshVoiceDescription()` in `server/ai/voice-strength.ts:146` is the central gate. It fires if **any** of three conditions holds:

1. **Milestone crossing** — the sample count crossed one of `[1, 6, 16, 30]`. Preserves the onboarding funnel: the first sample writes the first description, sample 6 promotes to Developing, sample 16 to Strong, sample 30 locks in a "trained" profile.
2. **Periodic past the last milestone** — every `VOICE_PERIODIC_REFRESH_INTERVAL = 15` samples once the show is past 30. Before this, a show that kept approving stayed represented by a 30-sample snapshot indefinitely — that's the drift bug this fixes.
3. **Drift trigger** — when the recent-window mean edit ratio crosses `VOICE_DRIFT_RATIO_THRESHOLD = 0.35`, with a `VOICE_DRIFT_COOLDOWN_SAMPLES = 5` cooldown between drift-triggered refreshes so a heavy-edit streak can't refire on every approval.

Drift is computed by `computeRecentDriftRatio()` in `server/ai/voice-strength.ts:133`. For each of the last 10 samples that has a linked `editDistance`, it computes `min(1, editDistance / max(content.length, 1))` and takes the mean. Returns `undefined` when no sample in the window has an edit distance — treated as no signal, not zero drift.

All three checks are **pure** — they take state and return a boolean, no Prisma reads. The approve-action caller in `app/(dashboard)/episodes/[id]/actions.ts` supplies the state (previous count, new count, sample-count-at-last-refresh from `Show.voiceDescriptionSampleCount`, drift ratio from a recent-window query) and dispatches the Inngest event on `true`. Fire-and-forget — an Inngest outage never rolls back the approve.

Only INTERNAL-mode approvals fire this. CLIENT-mode approvals hand off to the portal; portal-side approvals don't currently dispatch a refresh (tracked separately). See the code comment in `approveOutputAction`.

### 7.2 The refresh function

`refreshVoiceDescription` in `inngest/functions/refresh-voice-description.ts` handles the `voice/refresh.requested` event. Three retries. Steps:

1. Pull the show identity + agency id.
2. Pull the latest 20 approved samples.
3. Call `summariseVoice()` in `server/ai/voice-description.ts` — one Claude call, `max_tokens: 280`, a system prompt that asks for 2–3 sentences on tone + craft tells + close, no adjectives like "engaging" or "authentic".
4. Read the sample count **post-Claude** (`prisma.voiceSample.count`) so approvals landing during the call are counted against this refresh's snapshot.
5. Persist in one transaction:
   - `Show.voiceDescription` — the new narrative.
   - `Show.voiceDescriptionSampleCount` — the just-read count.
   - `Show.voiceDescriptionApproved: null` — reset the rating so the fresh description is rated on its own merit.
   - `UsageLog` — token counts and cost cents.

### 7.3 Operator rating — "is this your voice?"

Under the voice summary on `/voice/[showKey]`, once the description is unlocked (`totalSamples >= 10`), the operator sees a small affordance:

- **Unrated** (`voiceDescriptionApproved === null`) — "Is this your voice?" plus "👍 Sounds right" / "👎 Not my voice" buttons.
- **Approved** (`true`) — a green "✓ You said this matches" pill with a "Change my mind" undo link.
- **Rejected** (`false`) — an amber "Regenerating description…" pill until the refresh lands and the field resets to `null`.

Server side: `rateVoiceDescriptionAction()` in `app/(dashboard)/voice/[showKey]/actions.ts` calls `rateVoiceDescription()` in `server/db/show-instructions.ts`. Reviewers can rate — they're the ones closest to the voice signal. On `false`, the action fires `voice/refresh.requested`, best-effort. The refresh handler resets `voiceDescriptionApproved` when it writes the new description.

Rating an empty description is refused server-side (`NotFoundError`) so the UI can't race the initial threshold-triggered write.

---

## 8. Failure modes and safety guarantees

**Cross-show isolation** — every voice-relevant read filters by `Show → Client → Agency.agencyId`. A malicious caller can't pull samples or rules from a show they don't own. Repo helpers enforce the filter in `server/db/voice-samples.ts` and `server/db/show-instructions.ts`; `tests/server/db/tenant-isolation.test.ts` asserts the `where` shape end-to-end.

**Same-agency, different-show isolation** — `VoiceSample.showId` scopes the sample; there is no cross-show query in the generation pipeline. A client with two podcasts on the same agency maintains two independent voice pools.

**Legacy-data compatibility** — every new field added to the voice engine either defaults to a "safe absence" value or treats absence as "no signal":

- `editDistance` missing on a sample → `editFit = 1.0` (no downgrade).
- `voiceDescriptionSampleCount` new at `0` → the first post-migration approval refreshes on the next threshold as before.
- `voiceDescriptionApproved` never set → `null`, rating UI simply appears the first time.
- `ruleViolations` empty by default → UI treats absence as "no violations", not "unknown".
- `descriptionApproved` in the sample-data fixtures set to `null`.

**Silent-skip modes for testing** — when `DATABASE_URL` is absent (sample-data mode), all actions short-circuit with a no-op `ok` response. The refresh path, the rating path, and the approve path all check `isLiveDb()` first.

**Refresh dispatch never blocks approves** — every `inngest.send({ name: "voice/refresh.requested" })` is wrapped in `try/catch` with `console.error` on failure. The approve transaction is already committed before dispatch runs.

**Portal-side approvals don't currently trigger drift refresh** — this is a known gap. INTERNAL-mode approvals go through the dashboard action, which does the count query and dispatches. CLIENT-mode approvals land via `clientApproveOutputFromPortal` and only write the sample — no refresh event fires. The threshold refresh from the internal side will pick up the samples added by the portal on the next INTERNAL approve, but pure-CLIENT-mode shows never trigger a refresh on their own. Tracked separately.

**Rule parsing is conservative by design** — an ambiguous rule that fails to parse still lands in the prompt as freeform. The parser never over-triggers; false-positive constraints would be worse than no constraints.

**Adherence violations never block the pipeline** — they persist, they surface as a warning, they don't fail the run. The operator is the reviewer; automated rejection would remove their agency over edge cases.

---

## 9. What operators see and can act on

The voice page (`app/(dashboard)/voice/[showKey]/page.tsx`, rendered by `components/voice/voice-view.tsx`) is the main operator surface. The layout is a sticky left training rail (300px on `xl+`) plus a main content column.

**Left rail — the training story:**

- **Dark hero card** — sample count, three-segment strength ladder (Weak 0–5 / Developing 6–15 / Strong 16+), "N more approvals to Strong" copy.
- **Next best actions** — a checklist: approve N more, add an Always rule, cover all 7 platforms.
- **Voice summary** — the current `voiceDescription` when unlocked (>= 10 samples), plus the rating affordance (see [§7.3](#73-operator-rating--is-this-your-voice)).

**Main column — coverage, rules, samples:**

- **Platform coverage** — 7-tile grid showing sample count and voice strength per platform.
- **Rules editor** — Always column (global instructions) + Per-platform column (dynamic list of configured platforms, plus an "Add a rule for…" affordance for uncovered platforms). Dirty tracking, unsaved-changes counter, single-button save.
- **Approved samples** — filterable list of `VoiceSample` rows (all platforms or one).

Separately, in the **output drawer** on `/episodes/[id]`, `components/episodes/output-drawer.tsx` surfaces two voice-relevant readouts:

- **Signal strip** — a "Voice match" card showing bars keyed to the output's quality score.
- **Rule adherence strip** — an amber warning bar listing each `ruleViolations` entry when the output broke one of the show's parseable rules, with a "Regenerate to retry" hint.

The adherence strip renders on `READY` and `IN_REVIEW` states; hidden on `GENERATING` (skeleton reads cleanly) and on client-approved rows (frozen, nothing to act on).

---

## 10. File index

Core voice-engine modules (no I/O; pure functions where possible):

- `server/ai/prompt-builder.ts` — `buildMessages`, `selectSamples`, `diversifyOffPlatform`, `renderRuleBlock`, `LENGTH_SWEET_SPOTS`.
- `server/ai/rule-parser.ts` — `parseVoiceRules`, `renderConstraint`, `RuleConstraint` union.
- `server/ai/rule-adherence.ts` — `checkRuleAdherence`.
- `server/ai/voice-strength.ts` — `voiceLevel`, `crossedVoiceRefreshThreshold`, `shouldRefreshVoiceDescription`, `computeRecentDriftRatio`, constants for milestones/interval/threshold/cooldown/window.
- `server/ai/voice-description.ts` — `summariseVoice` (the one Claude call that writes the narrative).
- `server/ai/quality-score.ts` — `scoreOutput` (structural quality heuristic used by the sample-quality gate).

Database helpers (tenanted, tested):

- `server/db/voice-samples.ts` — `createSampleFromOutput`, `createSampleFromOutputRaw`, `writeSampleFromOutput`, `countSamplesByPlatform`, `listVoiceSamplesForShow`.
- `server/db/show-instructions.ts` — `saveVoiceInstructions`, `rateVoiceDescription`.

Pipeline entry points:

- `inngest/functions/generate-episode.ts` — full episode fan-out: builds messages, runs the seven Claude calls, scores outputs, checks adherence, persists.
- `inngest/functions/regenerate-output.ts` — single-output regen with the same prompt-builder + adherence flow.
- `inngest/functions/refresh-voice-description.ts` — `voice/refresh.requested` handler.

Server actions (auth-gated, revalidate on success):

- `app/(dashboard)/episodes/[id]/actions.ts` — `approveOutputAction` (dispatches the drift-aware refresh trigger).
- `app/(dashboard)/voice/[showKey]/actions.ts` — `saveVoiceInstructionsAction`, `rateVoiceDescriptionAction`.

UI:

- `components/voice/voice-view.tsx` — the `/voice/[showKey]` page.
- `components/episodes/output-drawer.tsx` — the output drawer with the adherence strip.
- `components/episodes/output-card.tsx` — the `OutputState` type carries `ruleViolations`.

Migrations:

- `20260706010000_show_voice_description_sample_count/`
- `20260706020000_show_voice_description_approved/`
- `20260706030000_generated_output_rule_violations/`

Tests:

- `tests/server/ai/prompt-builder.test.ts` — sample selection and diversification.
- `tests/server/ai/voice-strength.test.ts` — refresh gate and drift-ratio math.
- `tests/server/ai/rule-parser.test.ts` — constraint extraction.
- `tests/server/ai/rule-adherence.test.ts` — violation detection.
- `tests/server/db/voice-samples.test.ts` — quality gate on persistence.
- `tests/server/db/tenant-isolation.test.ts` — every voice-touching helper filters by agency.

---

_Last updated as of the current dev branch. Update this file whenever the voice engine gains or loses a signal — the point of the doc is to be honest about the state of the differentiator, not the aspiration._

import "server-only";

/**
 * Lightweight Deepgram REST client. Phase 2.7's transcribe pipeline points
 * Deepgram at a signed R2 GET URL — Deepgram fetches the audio itself —
 * which means we never proxy the bytes through our own server.
 *
 * We deliberately avoid `@deepgram/sdk`: their SDK pulls in a Node-only
 * websocket dep that bloats the Inngest function bundle, and we only need
 * the synchronous REST endpoint.
 *
 * Reference:
 *   - POST https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&...
 *   - Auth: `Token <DEEPGRAM_API_KEY>`
 *   - Body: { url: "<signed-url>" }
 *   - Response: { results: { channels: [{ alternatives: [{ transcript, ... }] }] }, metadata: { ... } }
 */

const DEEPGRAM_URL = "https://api.deepgram.com/v1/listen";
/** Nova-2 is current general-purpose; supports diarization, smart_format, punctuation. */
const DEFAULT_MODEL = "nova-2";

export type DeepgramOptions = {
  /** Override the model (defaults to nova-2). */
  model?: string;
  /** Add speaker labels to the transcript. Slightly slower but worth it for podcasts. */
  diarize?: boolean;
  /** Apply punctuation + casing + smart number formatting. Default true. */
  smartFormat?: boolean;
  /** Detect language code from audio. Default true. */
  detectLanguage?: boolean;
};

export type DeepgramResult = {
  /** Plain-text transcript (speaker-labeled when `diarize` was on). */
  transcript: string;
  /** Audio duration in seconds, when Deepgram reports it. */
  durationSec: number | null;
  /** Detected language code (e.g. "en"), if reported. */
  language: string | null;
  /** Raw word objects — kept so callers can derive timestamps if they need to. */
  words: DeepgramWord[];
};

export type DeepgramWord = {
  word: string;
  start: number;
  end: number;
  speaker?: number;
  punctuated_word?: string;
};

type RawDeepgramResponse = {
  metadata?: {
    duration?: number;
    detected_language?: string;
  };
  results?: {
    channels?: Array<{
      detected_language?: string;
      alternatives?: Array<{
        transcript?: string;
        words?: DeepgramWord[];
      }>;
    }>;
  };
};

export class DeepgramError extends Error {
  readonly status: number;
  readonly body: string;
  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = "DeepgramError";
    this.status = status;
    this.body = body;
  }
}

/**
 * Transcribe a URL-addressable audio file with Deepgram.
 *
 * The URL must be reachable from the Deepgram side — sign your R2 object
 * with a TTL long enough that the fetch + processing window doesn't expire
 * mid-job. 30 minutes is a safe default.
 */
export async function transcribeUrl(
  url: string,
  options: DeepgramOptions = {},
): Promise<DeepgramResult> {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Deepgram is not configured — set DEEPGRAM_API_KEY before triggering transcribe-episode.",
    );
  }

  const params = new URLSearchParams();
  params.set("model", options.model ?? DEFAULT_MODEL);
  params.set("smart_format", String(options.smartFormat ?? true));
  params.set("punctuate", "true");
  if (options.diarize !== false) params.set("diarize", "true");
  if (options.detectLanguage !== false) params.set("detect_language", "true");

  const res = await fetch(`${DEEPGRAM_URL}?${params.toString()}`, {
    method: "POST",
    headers: {
      Authorization: `Token ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url }),
  });

  if (!res.ok) {
    const body = await safeReadBody(res);
    throw new DeepgramError(`Deepgram returned ${res.status} ${res.statusText}`, res.status, body);
  }

  const raw = (await res.json()) as RawDeepgramResponse;
  return parseDeepgramResponse(raw);
}

async function safeReadBody(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

/**
 * Pull the most-likely transcript text + metadata out of Deepgram's
 * nested response shape. When `diarize` was set we render a simple
 * `Speaker N: ...` view from the word list — Deepgram's `paragraphs`
 * feature would give better fidelity but it's a separate option flag
 * and the simple render is enough for an LLM consumer.
 *
 * Exported for the unit tests; the production path always goes through
 * `transcribeUrl`.
 */
export function parseDeepgramResponse(raw: RawDeepgramResponse): DeepgramResult {
  const channel = raw.results?.channels?.[0];
  const alt = channel?.alternatives?.[0];
  const rawTranscript = alt?.transcript?.trim() ?? "";
  const words = alt?.words ?? [];

  // Speaker-labeled rendering when diarization is present. Group adjacent
  // words by `speaker`, prefix the first line of each speaker turn with
  // a `Speaker N:` label, and keep punctuation from `punctuated_word` if
  // Deepgram supplied it.
  const hasSpeakers = words.some((w) => typeof w.speaker === "number");
  const transcript = hasSpeakers ? renderWithSpeakers(words) : rawTranscript;

  return {
    transcript,
    durationSec: raw.metadata?.duration ?? null,
    language: channel?.detected_language ?? raw.metadata?.detected_language ?? null,
    words,
  };
}

function renderWithSpeakers(words: DeepgramWord[]): string {
  if (words.length === 0) return "";
  const lines: string[] = [];
  let currentSpeaker: number | null = null;
  let buffer: string[] = [];

  const flush = () => {
    if (buffer.length === 0) return;
    const label = currentSpeaker == null ? "Speaker" : `Speaker ${currentSpeaker + 1}`;
    lines.push(`${label}: ${buffer.join(" ")}`);
    buffer = [];
  };

  for (const w of words) {
    const speaker = typeof w.speaker === "number" ? w.speaker : 0;
    if (speaker !== currentSpeaker) {
      flush();
      currentSpeaker = speaker;
    }
    buffer.push(w.punctuated_word ?? w.word);
  }
  flush();
  return lines.join("\n\n");
}

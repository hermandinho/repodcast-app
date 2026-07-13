import "server-only";

import { Readable } from "node:stream";
import { S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Upload } from "@aws-sdk/lib-storage";
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";

type R2Env = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
};

function readEnv(): R2Env | null {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;
  return { accountId, accessKeyId, secretAccessKey, bucket };
}

const globalForR2 = globalThis as unknown as { r2Client?: S3Client };

/**
 * Returns a configured S3Client for Cloudflare R2, or null if the env vars
 * aren't set yet. Callers should handle the null case explicitly — it's only
 * meaningful for code paths that legitimately precede R2 setup.
 */
export function getR2Client(): { client: S3Client; bucket: string } | null {
  const env = readEnv();
  if (!env) return null;

  if (!globalForR2.r2Client) {
    const config: S3ClientConfig = {
      region: "auto",
      endpoint: `https://${env.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: env.accessKeyId,
        secretAccessKey: env.secretAccessKey,
      },
    };
    globalForR2.r2Client = new S3Client(config);
  }
  return { client: globalForR2.r2Client, bucket: env.bucket };
}

/** Throws when R2 is unconfigured — use this when callers can't proceed without it. */
export function requireR2Client(): { client: S3Client; bucket: string } {
  const r2 = getR2Client();
  if (!r2) {
    throw new Error(
      "R2 is not configured — set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET",
    );
  }
  return r2;
}

// ============================================================
// Convenience helpers
// ============================================================

export async function putR2Object(
  key: string,
  body: Uint8Array | string | Buffer,
  contentType?: string,
): Promise<void> {
  const { client, bucket } = requireR2Client();
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

/**
 * Streams `body` to R2 via S3-multipart upload — the caller never has to
 * buffer the whole payload into Node's heap. Right choice for anything
 * that could plausibly be >50 MB (podcast enclosures, large branded
 * exports).
 *
 * Accepts either a Node `Readable` or a Web `ReadableStream<Uint8Array>`
 * (e.g. `res.body` off `fetch`). Web streams get bridged via
 * `Readable.fromWeb`; if the input stream errors mid-upload,
 * lib-storage's `Upload` aborts the multipart cleanly so no orphaned
 * partial object survives.
 *
 * Part size 8 MB (S3 minimum is 5 MB, and R2 mirrors that). At 8 MB per
 * part with `queueSize: 4`, a 2 GB upload is 250 parts × 4 concurrent —
 * bounded memory, network-limited throughput.
 *
 * `abortSignal` — pass through the same `AbortController.signal` that
 * gates the source fetch. When it aborts we call `upload.abort()`
 * explicitly, which lets lib-storage:
 *   (a) `AbortMultipartUpload` the R2-side session cleanly, and
 *   (b) attach its own error listeners to the in-flight `UploadPart`
 *       rejections so their socket-write cancellations don't leak as
 *       unhandled `ECONNABORTED` errors.
 * Without this wiring, the source stream still errors and the Upload
 * eventually rejects, but the tear-down of the 3–4 concurrent part
 * uploads happens in an uncoordinated way and a stray socket error
 * escapes to Node's async void.
 */
export async function streamR2Object(
  key: string,
  body: Readable | ReadableStream<Uint8Array>,
  contentType?: string,
  abortSignal?: AbortSignal,
): Promise<void> {
  const { client, bucket } = requireR2Client();
  const stream =
    body instanceof Readable
      ? body
      : // Node 18+ has Readable.fromWeb; the type overlap between the
        // built-in `ReadableStream` and Node's stream-web import is
        // narrow enough that a cast is cleaner than the alternative.
        Readable.fromWeb(body as never);
  const upload = new Upload({
    client,
    params: {
      Bucket: bucket,
      Key: key,
      Body: stream,
      ContentType: contentType,
    },
    partSize: 8 * 1024 * 1024,
    queueSize: 4,
  });

  // Wire the caller's abort signal to lib-storage's own abort path.
  // Doing it as a `once` listener so a resolved upload doesn't leave a
  // dangling reference on a long-lived AbortController.
  const onAbort = () => {
    // `.abort()` returns a promise; we intentionally don't await it here
    // — the primary `upload.done()` rejection is what the caller cares
    // about, and the abort is fire-and-forget cleanup on top of that.
    // Swallow the resulting rejection so it doesn't leak.
    upload.abort().catch(() => {});
  };
  if (abortSignal) {
    if (abortSignal.aborted) onAbort();
    else abortSignal.addEventListener("abort", onAbort, { once: true });
  }

  try {
    await upload.done();
  } finally {
    if (abortSignal) abortSignal.removeEventListener("abort", onAbort);
  }
}

export async function deleteR2Object(key: string): Promise<void> {
  const { client, bucket } = requireR2Client();
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

/**
 * Pre-signed PUT URL for direct browser uploads. The URL expires after
 * `expiresInSec` (default 5 min) — caller is responsible for storing the
 * resulting object key after upload completes.
 */
export async function signR2UploadUrl(
  key: string,
  contentType: string,
  expiresInSec = 300,
): Promise<string> {
  const { client, bucket } = requireR2Client();
  return getSignedUrl(
    client,
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: contentType,
    }),
    { expiresIn: expiresInSec },
  );
}

/** Pre-signed GET URL — for serving private R2 objects via temporary links. */
export async function signR2DownloadUrl(key: string, expiresInSec = 300): Promise<string> {
  const { client, bucket } = requireR2Client();
  return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
    expiresIn: expiresInSec,
  });
}

// ============================================================
// Bulk read / delete
// ============================================================

export type R2ObjectSummary = {
  key: string;
  /** Server-side LastModified, or `null` when R2 doesn't surface it (rare). */
  lastModified: Date | null;
  /** Object size in bytes when available — used by callers that report freed storage. */
  size: number | null;
};

/**
 * Paginated walk under a key prefix. Returns every object in the bucket
 * under `prefix`. Bounded by `maxObjects` (default 10_000) so a runaway
 * bucket doesn't melt the cron's wall-clock budget.
 *
 * Throws if R2 isn't configured — callers should `getR2Client()`-gate
 * before invoking (the cron skips silently in dev).
 */
export async function listR2Objects(
  prefix: string,
  maxObjects = 10_000,
): Promise<R2ObjectSummary[]> {
  const { client, bucket } = requireR2Client();
  const out: R2ObjectSummary[] = [];
  let continuationToken: string | undefined;

  while (out.length < maxObjects) {
    const res = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );
    for (const obj of res.Contents ?? []) {
      if (!obj.Key) continue;
      out.push({
        key: obj.Key,
        lastModified: obj.LastModified ?? null,
        size: obj.Size ?? null,
      });
      if (out.length >= maxObjects) break;
    }
    if (!res.IsTruncated || !res.NextContinuationToken) break;
    continuationToken = res.NextContinuationToken;
  }
  return out;
}

/**
 * Batch delete. S3's `DeleteObjects` accepts up to 1000 keys per call, so
 * we chunk transparently. Returns the count actually deleted (server-side
 * confirmation), which a caller can compare to `keys.length` to spot any
 * AWS-side failures.
 */
export async function deleteR2Objects(keys: string[]): Promise<number> {
  if (keys.length === 0) return 0;
  const { client, bucket } = requireR2Client();
  const BATCH = 1000;
  let deleted = 0;
  for (let i = 0; i < keys.length; i += BATCH) {
    const slice = keys.slice(i, i + BATCH);
    const res = await client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: slice.map((k) => ({ Key: k })), Quiet: true },
      }),
    );
    // Quiet mode means `Deleted` is omitted on success — fall back to the
    // slice length when AWS doesn't enumerate, but trust enumerated errors.
    const errored = res.Errors?.length ?? 0;
    deleted += slice.length - errored;
  }
  return deleted;
}

/**
 * Server-side copy — no download/upload round-trip. The AWS SDK v3 handles
 * the CopySource header encoding for us, so plain `${bucket}/${key}` works
 * even when the key contains `/` separators.
 */
export async function copyR2Object(sourceKey: string, destKey: string): Promise<void> {
  const { client, bucket } = requireR2Client();
  await client.send(
    new CopyObjectCommand({
      Bucket: bucket,
      Key: destKey,
      CopySource: `${bucket}/${sourceKey}`,
    }),
  );
}

// ============================================================
// Agency-wide quarantine (hard-delete)
// ============================================================

/** Prefixes we walk when quarantining an agency's assets. Keep in sync with
 *  the write-side paths (see `audio-actions.ts` + `artwork-actions.ts`). */
const AGENCY_ASSET_PREFIXES = ["audio", "artwork"] as const;

/** Root prefix under which every quarantined object lands. Bucket lifecycle
 *  policy should auto-expire this branch after 30 days — set it via the R2
 *  dashboard or `wrangler r2 bucket lifecycle` (see `scripts/configure-r2-cors.ts`
 *  for the sibling pattern). */
export const R2_QUARANTINE_ROOT = "_quarantine";

export type QuarantineSummary = {
  /** Total objects copied into the quarantine prefix. */
  copied: number;
  /** Total objects deleted from their original prefix. */
  deleted: number;
  /** Full destination prefixes populated by this quarantine run — surfaced
   *  in the audit row so an operator can find the objects to restore. */
  quarantinePrefixes: string[];
};

/**
 * Copy every object under `audio/<agencyId>/` and `artwork/<agencyId>/` into
 * `_quarantine/<agencyId>/<isoTimestamp>/<originalKey>`, then delete the
 * originals. Pairs with `hardDeleteAgency` in `server/db/system/agencies.ts`:
 * the DB row is only deleted after this returns cleanly.
 *
 * The destination structure preserves the ORIGINAL key verbatim beneath the
 * quarantine root, so restoration is a straight prefix strip — no rebuilding
 * of nested paths.
 *
 * Bounded to 20k objects per prefix (via `listR2Objects`'s cap). A wildly
 * larger agency would need chunked runs; that scale isn't a v1 concern.
 */
export async function quarantineR2AgencyPrefixes(
  agencyId: string,
  timestamp: string,
): Promise<QuarantineSummary> {
  let copied = 0;
  let deleted = 0;
  const quarantinePrefixes: string[] = [];
  const quarantineRoot = `${R2_QUARANTINE_ROOT}/${agencyId}/${timestamp}`;

  for (const prefix of AGENCY_ASSET_PREFIXES) {
    const source = `${prefix}/${agencyId}/`;
    const objects = await listR2Objects(source, 20_000);
    if (objects.length === 0) continue;

    // Copy each object server-side. Serial is fine — this only fires when
    // an operator hard-deletes an agency (rare) and the copies are internal
    // to R2 (fast). Parallelising with `Promise.all` risks 429s on tiny
    // agencies that Cloudflare rate-limits; not worth it.
    for (const obj of objects) {
      const destKey = `${quarantineRoot}/${obj.key}`;
      await copyR2Object(obj.key, destKey);
      copied += 1;
    }

    const removed = await deleteR2Objects(objects.map((o) => o.key));
    deleted += removed;
    quarantinePrefixes.push(`${quarantineRoot}/${prefix}/${agencyId}/`);
  }

  return { copied, deleted, quarantinePrefixes };
}

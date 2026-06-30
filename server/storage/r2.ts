import "server-only";

import { S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
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
// Convenience helpers (Phase 1.3 artwork + Phase 2.7 audio)
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
// Bulk read / delete (Phase 2.7 orphan-cleanup cron)
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

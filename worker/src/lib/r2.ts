import { createReadStream, statSync } from "node:fs";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";

/**
 * Worker-side R2 client. Mirrors `server/storage/r2.ts` on the app side but
 * lives here so the worker has zero coupling to the Next.js app's build.
 * Uses the same env-var contract.
 */

type R2Env = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicBaseUrl: string;
};

let cached: { env: R2Env; client: S3Client } | null = null;

function readEnv(): R2Env {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;
  const publicBaseUrl = process.env.R2_PUBLIC_BASE_URL?.replace(/\/$/, "");
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !publicBaseUrl) {
    throw new Error(
      "R2 not configured — set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE_URL",
    );
  }
  return { accountId, accessKeyId, secretAccessKey, bucket, publicBaseUrl };
}

function requireClient(): { env: R2Env; client: S3Client } {
  if (cached) return cached;
  const env = readEnv();
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${env.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: env.accessKeyId, secretAccessKey: env.secretAccessKey },
  });
  cached = { env, client };
  return cached;
}

/**
 * Stream an on-disk file to R2 using multipart upload. Streams from the
 * filesystem so the worker never has to buffer the whole rendered MP4 in
 * memory (a 60 s 9:16 clip is ~10–15 MB; still, keep the pattern honest).
 */
export async function uploadFile(
  localPath: string,
  key: string,
  contentType: string,
): Promise<{ url: string; bytes: number }> {
  const { env, client } = requireClient();
  const bytes = statSync(localPath).size;
  const upload = new Upload({
    client,
    params: {
      Bucket: env.bucket,
      Key: key,
      Body: createReadStream(localPath),
      ContentType: contentType,
    },
    partSize: 8 * 1024 * 1024,
    queueSize: 4,
  });
  await upload.done();
  return { url: `${env.publicBaseUrl}/${key}`, bytes };
}

/**
 * Small-object upload — used for captions.srt. Buffers whole payload,
 * which is fine for a few KB of subtitles.
 */
export async function putObject(
  key: string,
  body: string | Uint8Array,
  contentType: string,
): Promise<string> {
  const { env, client } = requireClient();
  await client.send(
    new PutObjectCommand({
      Bucket: env.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
  return `${env.publicBaseUrl}/${key}`;
}

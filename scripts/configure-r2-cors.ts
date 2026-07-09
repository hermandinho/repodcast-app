/**
 * One-shot CORS configuration for the R2 bucket used by direct browser
 * uploads (artwork, audio, …). R2 ships with no CORS policy — without
 * this script, `xhr.onerror` fires on every direct PUT.
 *
 * Usage:  npm run r2:cors
 *
 * Re-running is idempotent: `PutBucketCors` replaces the policy wholesale.
 *
 * Origins:
 *   - `http://localhost:3000`, `http://localhost:3001` (dev)
 *   - `https://repodcastapp.com`, `https://www.repodcastapp.com` (prod)
 *   - `NEXT_PUBLIC_APP_URL` if set (for staging / preview overrides)
 */

import { GetBucketCorsCommand, PutBucketCorsCommand, S3Client } from "@aws-sdk/client-s3";
import { loadEnvLocal } from "./load-env-local";

loadEnvLocal();

const accountId = required("R2_ACCOUNT_ID");
const accessKeyId = required("R2_ACCESS_KEY_ID");
const secretAccessKey = required("R2_SECRET_ACCESS_KEY");
const bucket = required("R2_BUCKET");

const allowedOrigins = new Set<string>([
  "http://localhost:3000",
  "http://localhost:3001",
  "https://repodcastapp.com",
  "https://www.repodcastapp.com",
]);
if (process.env.NEXT_PUBLIC_APP_URL) {
  allowedOrigins.add(process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, ""));
}

const client = new S3Client({
  region: "auto",
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId, secretAccessKey },
});

const corsRules = [
  {
    AllowedOrigins: [...allowedOrigins],
    AllowedMethods: ["PUT", "GET", "HEAD"],
    AllowedHeaders: ["*"],
    ExposeHeaders: ["ETag"],
    MaxAgeSeconds: 3600,
  },
];

async function main(): Promise<void> {
  console.log(`Applying CORS to bucket "${bucket}" for origins:`);
  for (const o of allowedOrigins) console.log(`  - ${o}`);

  await client.send(
    new PutBucketCorsCommand({
      Bucket: bucket,
      CORSConfiguration: { CORSRules: corsRules },
    }),
  );

  const verify = await client.send(new GetBucketCorsCommand({ Bucket: bucket }));
  console.log("\nApplied. Bucket now reports:");
  console.log(JSON.stringify(verify.CORSRules, null, 2));
}

function required(key: string): string {
  const v = process.env[key];
  if (!v) {
    console.error(`Missing required env var: ${key}`);
    process.exit(1);
  }
  return v;
}

main().catch((err) => {
  console.error("Failed to apply CORS:", err);
  process.exit(1);
});

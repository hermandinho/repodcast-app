import { defineConfig } from "prisma/config";
import { loadEnvLocal } from "./scripts/load-env-local";

// Prisma's CLI loads `.env` natively but not `.env.local` — the file Next.js
// projects use by convention. Load it here so `prisma migrate` / `prisma db
// push` / `prisma studio` all see the URL the rest of the app uses.
loadEnvLocal();

// Prisma 7 moves connection URLs out of schema.prisma into this file.
// We point migrations at DIRECT_URL (unpooled) and fall back to DATABASE_URL
// if the unpooled one isn't set in a given environment.
const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

if (!url) {
  // Surface the actual problem clearly. Prisma 7's default message blames
  // the config file, which masks the missing-env-var root cause.
  // Don't throw here — `prisma generate` doesn't need the URL and we want
  // it to keep working. `prisma migrate` will surface the proper error
  // from the schema-engine when url is undefined.
   
  console.warn(
    "[prisma.config] DATABASE_URL / DIRECT_URL not found in process.env, .env.local, or .env. " +
      "`prisma migrate` will fail until you set them.",
  );
}

export default defineConfig({
  schema: "./prisma/schema.prisma",
  datasource: {
    url,
  },
  migrations: {
    path: "./prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
});

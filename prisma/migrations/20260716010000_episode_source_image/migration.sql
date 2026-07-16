-- Publisher-supplied artwork captured at RSS import time. Coexists with
-- the AI-generated hero/square/vertical variants so the operator can see
-- the original alongside anything the artwork pipeline produces.
ALTER TABLE "Episode" ADD COLUMN "sourceImageUrl" TEXT;

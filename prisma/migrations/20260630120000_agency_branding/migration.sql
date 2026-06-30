-- Phase 2.5 — agency white-label branding fields.
--
-- `brandLogoUrl` references an R2 object (uploaded via the existing
-- artwork pipeline). `brandAccentColor` is a 7-char hex string (`#RRGGBB`);
-- free-form String at the DB layer so we can support `#RRGGBBAA` or
-- named-color shorthands later without another migration. Both nullable
-- so existing agencies render with the Repodcast defaults until they opt
-- in.

ALTER TABLE "Agency" ADD COLUMN "brandLogoUrl" TEXT;
ALTER TABLE "Agency" ADD COLUMN "brandAccentColor" TEXT;

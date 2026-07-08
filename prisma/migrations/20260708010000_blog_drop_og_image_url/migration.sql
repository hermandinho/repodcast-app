-- Drop `BlogPost.ogImageUrl` — the admin form now uses `coverImageUrl` for
-- both the hero image and the OG / Twitter social share card. Keeping a
-- separate column was dead weight the moment we removed the field from the
-- form (and the reader stopped reading it), so we retire the schema entry
-- to match.
--
-- Existing values (if any) are lost — the intent of the design change is
-- "one image serves both", so retaining the OG override would defeat the
-- point. If a specific post needs a divergent social card, the follow-up
-- would be a re-add + form field, not a hidden legacy value.

ALTER TABLE "BlogPost" DROP COLUMN "ogImageUrl";

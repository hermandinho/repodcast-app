-- AlterTable: persist rule-adherence flags on each generated output.
-- Empty array = no violations (either every parseable rule passed, or
-- the show has no parseable rules). Default keeps existing rows valid;
-- the generation pipeline overwrites on the next write.
ALTER TABLE "GeneratedOutput" ADD COLUMN "ruleViolations" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

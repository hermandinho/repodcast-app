-- AlterEnum: fill the Studio → Network gap with a mid-tier "AGENCY" plan
-- (12 shows, 6 seats, 150 episodes/mo). Positioned after STUDIO and
-- before NETWORK to preserve the tier-order semantics `PLAN_RANK` reads.
-- Postgres appends new enum values at the end by default; the explicit
-- `BEFORE NETWORK` clause keeps the underlying enum order matching the
-- application-level rank. Existing rows retain their current plan.
ALTER TYPE "Plan" ADD VALUE 'AGENCY' BEFORE 'NETWORK';

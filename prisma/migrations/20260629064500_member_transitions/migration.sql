-- CreateEnum
CREATE TYPE "MemberTransitionKind" AS ENUM ('INVITED', 'INVITE_ACCEPTED', 'INVITE_REVOKED', 'ROLE_CHANGED', 'REMOVED', 'OWNER_TRANSFERRED');

-- CreateTable
CREATE TABLE "MemberTransition" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "kind" "MemberTransitionKind" NOT NULL,
    "byMemberId" TEXT,
    "targetMemberId" TEXT,
    "inviteId" TEXT,
    "email" TEXT,
    "fromRole" "MemberRole",
    "toRole" "MemberRole",
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemberTransition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MemberTransition_agencyId_createdAt_idx" ON "MemberTransition"("agencyId", "createdAt");

-- CreateIndex
CREATE INDEX "MemberTransition_targetMemberId_idx" ON "MemberTransition"("targetMemberId");

-- CreateIndex
CREATE INDEX "MemberTransition_byMemberId_idx" ON "MemberTransition"("byMemberId");

-- CreateIndex
CREATE INDEX "MemberTransition_inviteId_idx" ON "MemberTransition"("inviteId");

-- AddForeignKey
ALTER TABLE "MemberTransition" ADD CONSTRAINT "MemberTransition_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberTransition" ADD CONSTRAINT "MemberTransition_byMemberId_fkey" FOREIGN KEY ("byMemberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberTransition" ADD CONSTRAINT "MemberTransition_targetMemberId_fkey" FOREIGN KEY ("targetMemberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberTransition" ADD CONSTRAINT "MemberTransition_inviteId_fkey" FOREIGN KEY ("inviteId") REFERENCES "MemberInvite"("id") ON DELETE SET NULL ON UPDATE CASCADE;

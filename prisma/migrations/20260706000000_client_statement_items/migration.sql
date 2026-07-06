-- AlterTable: freeze the statement's currency at generation time so
-- historical rows keep rendering with the currency they were priced in,
-- independent of the billing profile changing later. Default USD so the
-- backfill is trivial for existing rows.
ALTER TABLE "ClientStatement" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'USD';

-- CreateTable: billable line items on a statement. Auto-seeded from the
-- billing profile on generate; agency can edit before sending. Sum of
-- `amountCents` across items = what the client owes for the period.
CREATE TABLE "ClientStatementItem" (
    "id" TEXT NOT NULL,
    "statementId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(10,2) NOT NULL,
    "unitAmountCents" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientStatementItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClientStatementItem_statementId_sortOrder_idx" ON "ClientStatementItem"("statementId", "sortOrder");

-- AddForeignKey
ALTER TABLE "ClientStatementItem" ADD CONSTRAINT "ClientStatementItem_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "ClientStatement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

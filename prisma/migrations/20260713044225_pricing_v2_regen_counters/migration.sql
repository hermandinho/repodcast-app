-- CreateTable
CREATE TABLE "AgencyRegenCounter" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "clipRegens" INTEGER NOT NULL DEFAULT 0,
    "artworkRegens" INTEGER NOT NULL DEFAULT 0,
    "audiogramRegens" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgencyRegenCounter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgencyRegenCounter_agencyId_idx" ON "AgencyRegenCounter"("agencyId");

-- CreateIndex
CREATE UNIQUE INDEX "AgencyRegenCounter_agencyId_month_key" ON "AgencyRegenCounter"("agencyId", "month");

-- AddForeignKey
ALTER TABLE "AgencyRegenCounter" ADD CONSTRAINT "AgencyRegenCounter_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

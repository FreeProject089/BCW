-- B14 Phase 1: Community Charity storage. Two new tables, fully additive — no existing table
-- or row is touched. `CharityPot` = one pot per month (org share frozen at close + the manual
-- donation proof); `CharityContribution` = the community's voluntary gifts, kept as a separate
-- stream that sums into the pot. userId/paymentId are bare (nullable) — gifts can be anonymous
-- and must outlive the contributor deleting their account.

CREATE TABLE "CharityPot" (
    "id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "orgContribCents" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'chf',
    "pollId" TEXT,
    "association" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'open',
    "paidAt" TIMESTAMP(3),
    "proofUrl" TEXT NOT NULL DEFAULT '',
    "proofNote" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CharityPot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CharityContribution" (
    "id" TEXT NOT NULL,
    "potId" TEXT NOT NULL,
    "userId" TEXT,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'chf',
    "paymentId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'stripe',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CharityContribution_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CharityPot_month_key" ON "CharityPot"("month");

CREATE INDEX "CharityContribution_potId_idx" ON "CharityContribution"("potId");

ALTER TABLE "CharityContribution" ADD CONSTRAINT "CharityContribution_potId_fkey" FOREIGN KEY ("potId") REFERENCES "CharityPot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

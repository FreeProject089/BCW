-- Boosts that come WITH a hosting plan, and the ledger of the ones granted.
--
-- Defaults are the no-op on purpose: every plan that exists today included no boosts, and a
-- column whose default changes behaviour for existing rows is a migration that quietly grants
-- something nobody sold.
ALTER TABLE "HostingPlan" ADD COLUMN "boostsPerPeriod"   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "HostingPlan" ADD COLUMN "boostPeriodMonths" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "HostingPlan" ADD COLUMN "boostDays"         INTEGER NOT NULL DEFAULT 7;

-- A LEDGER, not a counter on the subscription. "You have 2 boosts" answers nothing when
-- somebody asks where the others went; a row per credit says which period granted it, when it
-- expires and what it was spent on. A counter would also have to be adjusted by every writer,
-- and would drift the first time one of them failed halfway.
CREATE TABLE "BoostCredit" (
    "id"             TEXT NOT NULL,
    "ownerId"        TEXT NOT NULL,
    "subscriptionId" TEXT,
    "planId"         TEXT,
    "days"           INTEGER NOT NULL DEFAULT 7,
    "periodStart"    TIMESTAMP(3) NOT NULL,
    "seq"            INTEGER NOT NULL DEFAULT 0,
    "expiresAt"      TIMESTAMP(3),
    "usedAt"         TIMESTAMP(3),
    "usedRepoId"     TEXT,
    "usedCatalogId"  TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BoostCredit_pkey" PRIMARY KEY ("id")
);

-- What makes granting idempotent. The sweeper can run twice, or two containers can run it at
-- once, and neither can mint the same credit a second time.
CREATE UNIQUE INDEX "BoostCredit_subscriptionId_periodStart_seq_key"
    ON "BoostCredit"("subscriptionId", "periodStart", "seq");
-- "How many do I have left" is the only hot read.
CREATE INDEX "BoostCredit_ownerId_usedAt_idx" ON "BoostCredit"("ownerId", "usedAt");

ALTER TABLE "BoostCredit" ADD CONSTRAINT "BoostCredit_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- SET NULL, not CASCADE: a cancelled subscription must not erase the record of a credit that
-- was granted and spent while it was live.
ALTER TABLE "BoostCredit" ADD CONSTRAINT "BoostCredit_subscriptionId_fkey"
    FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

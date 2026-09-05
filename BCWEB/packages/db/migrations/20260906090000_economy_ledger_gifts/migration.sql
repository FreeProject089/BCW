-- Economy: a ledger of every point movement, reveal/expiry/gift fields on purchases, and the
-- role a bot action gives or takes. All additive.

ALTER TABLE "EconomyPurchase" ADD COLUMN "revealedAt" TIMESTAMP(3),
ADD COLUMN "expiresAt" TIMESTAMP(3),
ADD COLUMN "giftedFromId" TEXT;

CREATE INDEX "EconomyPurchase_itemId_idx" ON "EconomyPurchase"("itemId");

CREATE TABLE "EconomyLedger" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "balance" INTEGER NOT NULL,
    "ref" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EconomyLedger_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EconomyLedger_userId_createdAt_idx" ON "EconomyLedger"("userId", "createdAt");
CREATE INDEX "EconomyLedger_kind_createdAt_idx" ON "EconomyLedger"("kind", "createdAt");

ALTER TABLE "EconomyLedger" ADD CONSTRAINT "EconomyLedger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BotAction" ADD COLUMN "roleId" TEXT;

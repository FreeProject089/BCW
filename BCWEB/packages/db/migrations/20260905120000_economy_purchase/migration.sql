-- Points-shop purchases (the inventory). Additive: one new table keyed to the account. Both
-- doors (Discord /shop and the site's Boutique) write here through lib/economy-shop.mjs.

CREATE TABLE "EconomyPurchase" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "cost" INTEGER NOT NULL,
    "via" TEXT NOT NULL DEFAULT 'site',
    "status" TEXT NOT NULL DEFAULT 'delivered',
    "delivery" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EconomyPurchase_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EconomyPurchase_userId_createdAt_idx" ON "EconomyPurchase"("userId", "createdAt");
CREATE INDEX "EconomyPurchase_status_idx" ON "EconomyPurchase"("status");

ALTER TABLE "EconomyPurchase" ADD CONSTRAINT "EconomyPurchase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Recurring products, the platform margin, and where a buyer goes to use what they bought.
--
-- `billing`/`intervalMonths`/`stripePriceId` make a product sellable as a subscription; a
-- one-time product is untouched and keeps the default.
--
-- `feePercentBp` is basis points (1000 = 10%), NULL = the site default in AdminSetting
-- `marketplace.feePercentBp`. Per PRODUCT rather than per project because it is the number
-- actually charged on a sale, and three places that can disagree about one percentage is
-- how a payout report stops matching the invoices.
--
-- `feeCents`/`netCents` are written onto the PURCHASE at the moment of sale, not derived
-- later: the percentage can change, and a payout has to be computable from what was true
-- when the money moved.
ALTER TABLE "ProjectProduct" ADD COLUMN "billing" TEXT NOT NULL DEFAULT 'one_time';
ALTER TABLE "ProjectProduct" ADD COLUMN "intervalMonths" INTEGER;
ALTER TABLE "ProjectProduct" ADD COLUMN "stripePriceId" TEXT;
ALTER TABLE "ProjectProduct" ADD COLUMN "redeemUrl" TEXT;
ALTER TABLE "ProjectProduct" ADD COLUMN "redeemNote" TEXT;
ALTER TABLE "ProjectProduct" ADD COLUMN "feePercentBp" INTEGER;

ALTER TABLE "ProjectProductPurchase" ADD COLUMN "feeCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ProjectProductPurchase" ADD COLUMN "netCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ProjectProductPurchase" ADD COLUMN "expiresAt" TIMESTAMP(3);
ALTER TABLE "ProjectProductPurchase" ADD COLUMN "stripeSubId" TEXT;

CREATE INDEX IF NOT EXISTS "ProjectProductPurchase_stripeSubId_idx" ON "ProjectProductPurchase"("stripeSubId");

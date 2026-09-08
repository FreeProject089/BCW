-- Stripe Connect: the marketplace can now PAY the seller, not just say what it owes them.
--
-- Every marketplace sale already wrote feeCents/netCents onto the purchase — the platform's
-- cut and the seller's share, as they were at the moment of sale. Nothing moved the second
-- number anywhere. All of it landed in the platform's Stripe account and the column recorded
-- a debt that only a manual transfer could discharge.
--
-- MarketplaceSeller is the missing payee, scoped by the same string as the per-project
-- margin ("project:<key>" / "showcase:<id>"), so the two decisions about a page — how much
-- we keep, and who gets the rest — are made at the same level and cannot drift apart.
--
-- The enabled flags mirror Stripe's account.updated event. They are never inferred: an
-- account exists from the instant onboarding begins and cannot accept a charge until Stripe
-- has finished its checks, so a checkout that assumed "created" meant "usable" would fail
-- for the BUYER, with nothing on screen to explain it.
--
-- ProjectProductPurchase.sellerAccountId records where a given sale's money actually went.
-- NULL means it stayed with the platform — no payee, one not yet enabled, or a sale from
-- before any of this existed. Every historic row is that third case, which is why the column
-- is nullable and gets no backfill: inventing a destination for a transfer that never
-- happened would make the payout report confidently wrong.
CREATE TABLE "MarketplaceSeller" (
    "id"               TEXT NOT NULL,
    "scope"            TEXT NOT NULL,
    "stripeAccountId"  TEXT NOT NULL,
    "connectedById"    TEXT NOT NULL,
    "chargesEnabled"   BOOLEAN NOT NULL DEFAULT false,
    "payoutsEnabled"   BOOLEAN NOT NULL DEFAULT false,
    "detailsSubmitted" BOOLEAN NOT NULL DEFAULT false,
    "country"          TEXT,
    "disabledReason"   TEXT,
    "requirements"     JSONB,
    "syncedAt"         TIMESTAMP(3),
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketplaceSeller_pkey" PRIMARY KEY ("id")
);

-- One payee per page, and one page per account. The second is the load-bearing half: two
-- pages sharing an account makes a Stripe transfer impossible to attribute to either.
CREATE UNIQUE INDEX "MarketplaceSeller_scope_key" ON "MarketplaceSeller"("scope");
CREATE UNIQUE INDEX "MarketplaceSeller_stripeAccountId_key" ON "MarketplaceSeller"("stripeAccountId");

ALTER TABLE "ProjectProductPurchase" ADD COLUMN "sellerAccountId" TEXT;

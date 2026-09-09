-- One checkout session, one purchase — enforced by the database rather than by a read.
--
-- The webhook's idempotency guard was `findFirst` on delivery->>'sessionId' followed by a
-- create. Two overlapping deliveries of the same Stripe event both read "none yet" and both
-- proceeded: two purchase rows, two keys claimed out of the pool, and sold incremented twice
-- for one payment. Stripe resends on timeout, and a slow fulfilment is exactly when that
-- resend lands.
--
-- Backfilled from the JSON the old guard read, so existing rows carry their session and the
-- constraint is true of history as well as of new writes.
ALTER TABLE "ProjectProductPurchase" ADD COLUMN "checkoutSessionId" TEXT;

UPDATE "ProjectProductPurchase"
   SET "checkoutSessionId" = "delivery"->>'sessionId'
 WHERE "delivery" ? 'sessionId'
   AND "delivery"->>'sessionId' IS NOT NULL;

-- If history already holds a duplicate (a resend that landed before this fix), keep the
-- FIRST and null the later ones rather than failing the migration: the rows are real
-- purchases somebody made and deleting them is not this migration's decision to take.
UPDATE "ProjectProductPurchase" p
   SET "checkoutSessionId" = NULL
  FROM (
    SELECT "id", ROW_NUMBER() OVER (PARTITION BY "checkoutSessionId" ORDER BY "createdAt", "id") AS rn
      FROM "ProjectProductPurchase"
     WHERE "checkoutSessionId" IS NOT NULL
  ) d
 WHERE p."id" = d."id" AND d.rn > 1;

CREATE UNIQUE INDEX "ProjectProductPurchase_checkoutSessionId_key"
    ON "ProjectProductPurchase"("checkoutSessionId");

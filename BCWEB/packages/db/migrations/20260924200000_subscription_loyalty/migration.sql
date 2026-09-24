-- N-hosting (agent-hosting-N): loyalty (tenure) pricing on hosting subscriptions.
-- tenureStartAt: when the continuous tenure started (NULL = createdAt).
-- loyaltyPct: the loyalty discount currently applied as a Stripe coupon (0 = none).
ALTER TABLE "Subscription" ADD COLUMN "tenureStartAt" TIMESTAMP(3);
ALTER TABLE "Subscription" ADD COLUMN "loyaltyPct" INTEGER NOT NULL DEFAULT 0;

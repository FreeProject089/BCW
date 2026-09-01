-- B14 Phase 2: idempotency for the contribution webhook. The Stripe checkout session id makes a
-- retried webhook credit the pot exactly once. Additive + nullable.
ALTER TABLE "CharityContribution" ADD COLUMN "sessionId" TEXT;
CREATE UNIQUE INDEX "CharityContribution_sessionId_key" ON "CharityContribution"("sessionId");

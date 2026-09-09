-- Hold a pool key for a checkout that has not paid yet.
--
-- Counting free keys at checkout and claiming one in the webhook leaves a window: the pool can
-- empty in between, and the money is then taken for something that cannot be handed over.
-- Refunding that is repair. Holding the key is prevention, and key_pool is the only delivery
-- kind whose resource is genuinely finite and local — content, files, links, roles, static and
-- minted keys are all unlimited.
ALTER TABLE "ProjectKey" ADD COLUMN "reservedFor" TEXT;
ALTER TABLE "ProjectKey" ADD COLUMN "reservedUntil" TIMESTAMP(3);

-- The reservation lookup: a product's free keys, filtered by hold state.
CREATE INDEX "ProjectKey_productId_claimedAt_reservedUntil_idx"
    ON "ProjectKey"("productId", "claimedAt", "reservedUntil");
-- Finding the key held for one checkout session, and releasing it.
CREATE INDEX "ProjectKey_reservedFor_idx" ON "ProjectKey"("reservedFor");

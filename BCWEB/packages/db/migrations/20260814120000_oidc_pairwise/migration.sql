-- Pairwise subject identifiers (OIDC core §8).
--
-- 'public' (the default, and today's behaviour): `sub` is the BetterCommunity user id, so
-- every client sees the same value and two of them can work out they have the same user.
-- 'pairwise': `sub` is opaque and unique per client, so they cannot.
--
-- The mapping is STORED, not derived. A computed sub needs nothing persisted right up
-- until the salt is rotated, at which point every user of every pairwise client becomes a
-- stranger with an empty account and no way back.
--
-- Default 'public' so no existing client changes behaviour: switching an existing client
-- to pairwise re-identifies all of its users at once, which orphans accounts rather than
-- merging them. It is a decision made at client creation.

-- AlterTable
ALTER TABLE "OAuthClient" ADD COLUMN "subjectType" TEXT NOT NULL DEFAULT 'public';

-- CreateTable
CREATE TABLE "OAuthPairwiseSub" (
    "sub" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OAuthPairwiseSub_pkey" PRIMARY KEY ("sub")
);

-- CreateIndex
CREATE UNIQUE INDEX "OAuthPairwiseSub_userId_clientId_key" ON "OAuthPairwiseSub"("userId", "clientId");
CREATE INDEX "OAuthPairwiseSub_clientId_idx" ON "OAuthPairwiseSub"("clientId");

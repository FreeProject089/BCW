-- A social sign-in that matched an existing account's e-mail now waits for proof of
-- ownership instead of linking on the address alone.
CREATE TABLE "OAuthLinkProposal" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "username" TEXT,
    "avatar" TEXT,
    "codeHash" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OAuthLinkProposal_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OAuthLinkProposal_tokenHash_key" ON "OAuthLinkProposal"("tokenHash");
CREATE INDEX "OAuthLinkProposal_userId_idx" ON "OAuthLinkProposal"("userId");

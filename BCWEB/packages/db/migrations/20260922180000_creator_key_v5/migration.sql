-- Creator key v5: the key pin, the hashed fingerprint components, the proof nonces.
-- See packages/db/schema.prisma (CreatorKeyPin) and apps/api/src/lib/creator-identity.mjs.

-- CreateTable
CREATE TABLE "CreatorKeyPin" (
    "creatorId" TEXT NOT NULL,
    "kid" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreatorKeyPin_pkey" PRIMARY KEY ("creatorId")
);

-- CreateTable
CREATE TABLE "CreatorFingerprint" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "component" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreatorFingerprint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreatorProofNonce" (
    "nonce" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreatorProofNonce_pkey" PRIMARY KEY ("nonce")
);

-- CreateIndex
CREATE INDEX "CreatorFingerprint_component_hash_idx" ON "CreatorFingerprint"("component", "hash");

-- CreateIndex
CREATE INDEX "CreatorFingerprint_lastSeenAt_idx" ON "CreatorFingerprint"("lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "CreatorFingerprint_creatorId_component_hash_key" ON "CreatorFingerprint"("creatorId", "component", "hash");

-- CreateIndex
CREATE INDEX "CreatorProofNonce_expiresAt_idx" ON "CreatorProofNonce"("expiresAt");


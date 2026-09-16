-- CreateTable
CREATE TABLE "MediaHash" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "ownerId" TEXT,
    "refType" TEXT,
    "refId" TEXT,
    "contentType" TEXT NOT NULL DEFAULT '',
    "bytes" INTEGER NOT NULL DEFAULT 0,
    "sha256" TEXT,
    "phash" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "hashedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaHash_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaFlag" (
    "id" TEXT NOT NULL,
    "hashId" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "distance" INTEGER NOT NULL,
    "reason" TEXT NOT NULL DEFAULT 'near',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "note" TEXT NOT NULL DEFAULT '',
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaFlag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MediaHash_key_key" ON "MediaHash"("key");

-- CreateIndex
CREATE INDEX "MediaHash_status_createdAt_idx" ON "MediaHash"("status", "createdAt");

-- CreateIndex
CREATE INDEX "MediaHash_phash_idx" ON "MediaHash"("phash");

-- CreateIndex
CREATE INDEX "MediaHash_sha256_idx" ON "MediaHash"("sha256");

-- CreateIndex
CREATE INDEX "MediaHash_ownerId_idx" ON "MediaHash"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "MediaFlag_hashId_matchId_key" ON "MediaFlag"("hashId", "matchId");

-- CreateIndex
CREATE INDEX "MediaFlag_status_createdAt_idx" ON "MediaFlag"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "MediaFlag" ADD CONSTRAINT "MediaFlag_hashId_fkey" FOREIGN KEY ("hashId") REFERENCES "MediaHash"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaFlag" ADD CONSTRAINT "MediaFlag_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "MediaHash"("id") ON DELETE CASCADE ON UPDATE CASCADE;

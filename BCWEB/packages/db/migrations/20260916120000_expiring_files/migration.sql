-- CreateTable
CREATE TABLE "ExpiringFile" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "fileName" TEXT NOT NULL DEFAULT '',
    "contentType" TEXT NOT NULL DEFAULT '',
    "bytes" INTEGER NOT NULL DEFAULT 0,
    "kind" TEXT NOT NULL,
    "refId" TEXT,
    "ownerId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "downloadAfterDays" INTEGER,
    "firstDownloadAt" TIMESTAMP(3),
    "downloads" INTEGER NOT NULL DEFAULT 0,
    "maxDownloads" INTEGER,
    "revokedAt" TIMESTAMP(3),
    "purgedAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExpiringFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExpiringFile_token_key" ON "ExpiringFile"("token");

-- CreateIndex
CREATE INDEX "ExpiringFile_kind_refId_idx" ON "ExpiringFile"("kind", "refId");

-- CreateIndex
CREATE INDEX "ExpiringFile_expiresAt_idx" ON "ExpiringFile"("expiresAt");

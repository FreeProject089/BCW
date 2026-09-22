-- CreateTable
CREATE TABLE "EntityHostingSettings" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'inherit',
    "maxItems" INTEGER NOT NULL DEFAULT 0,
    "maxKB" INTEGER NOT NULL DEFAULT 0,
    "poolId" TEXT,
    "quotaBytes" BIGINT NOT NULL DEFAULT 0,
    "attachments" TEXT NOT NULL DEFAULT 'inherit',
    "maxAttachmentMB" INTEGER NOT NULL DEFAULT 0,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EntityHostingSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EntityHostingSettings_poolId_idx" ON "EntityHostingSettings"("poolId");

-- CreateIndex
CREATE UNIQUE INDEX "EntityHostingSettings_kind_ref_key" ON "EntityHostingSettings"("kind", "ref");


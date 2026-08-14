-- AlterTable
ALTER TABLE "Sanction" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "archivedById" TEXT,
ADD COLUMN     "edits" JSONB;

-- CreateTable
CREATE TABLE "SanctionAttachment" (
    "id" TEXT NOT NULL,
    "sanctionId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "storageKey" TEXT,
    "url" TEXT,
    "name" TEXT NOT NULL,
    "mime" TEXT,
    "bytes" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "addedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SanctionAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SanctionAttachment_sanctionId_createdAt_idx" ON "SanctionAttachment"("sanctionId", "createdAt");

-- CreateIndex
CREATE INDEX "Sanction_archivedAt_idx" ON "Sanction"("archivedAt");

-- AddForeignKey
ALTER TABLE "SanctionAttachment" ADD CONSTRAINT "SanctionAttachment_sanctionId_fkey" FOREIGN KEY ("sanctionId") REFERENCES "Sanction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SanctionAttachment" ADD CONSTRAINT "SanctionAttachment_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


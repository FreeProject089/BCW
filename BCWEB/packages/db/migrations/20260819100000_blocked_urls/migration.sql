-- An address that may not be listed again.
--
-- The Terms promise this in "Listings that point somewhere else": when an item is only a
-- LINK, taking the listing down is most of what we can do, and stopping the same address
-- being posted straight back is the rest. The promise shipped before the mechanism; this
-- is the mechanism.
--
-- The unique key is (scope, pattern) with the pattern stored NORMALISED, so the same
-- address cannot be added twice in two spellings and read as two different rules.
--
-- Both foreign keys are SET NULL, not CASCADE, and that is the whole point: deleting the
-- notice that caused a block, or the staff account that added it, must never silently
-- remove the block itself.

-- CreateTable
CREATE TABLE "BlockedUrl" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'domain',
    "pattern" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "noticeId" TEXT,
    "createdById" TEXT,
    "hits" INTEGER NOT NULL DEFAULT 0,
    "lastHitAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BlockedUrl_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BlockedUrl_createdAt_idx" ON "BlockedUrl"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BlockedUrl_scope_pattern_key" ON "BlockedUrl"("scope", "pattern");

-- AddForeignKey
ALTER TABLE "BlockedUrl" ADD CONSTRAINT "BlockedUrl_noticeId_fkey" FOREIGN KEY ("noticeId") REFERENCES "ContactMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlockedUrl" ADD CONSTRAINT "BlockedUrl_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


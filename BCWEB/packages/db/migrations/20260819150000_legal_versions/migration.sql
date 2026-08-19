-- Published, frozen copies of the legal documents.
--
-- User.termsAcceptedAt recorded WHEN somebody accepted and never WHAT. That was survivable
-- while the text lived in the source and git held the history; it stopped being survivable
-- when the pages became editable from the dashboard. A timestamp pointing at a mutable
-- document proves nothing in a dispute.
--
-- LegalVersion.sections is a denormalised snapshot on purpose: a snapshot that joins to
-- live rows is not a snapshot. Rows here are never updated, only added.

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "termsVersion" INTEGER;

-- CreateTable
CREATE TABLE "LegalVersion" (
    "id" TEXT NOT NULL,
    "doc" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "sections" JSONB NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedById" TEXT,

    CONSTRAINT "LegalVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LegalVersion_doc_publishedAt_idx" ON "LegalVersion"("doc", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "LegalVersion_doc_version_key" ON "LegalVersion"("doc", "version");

-- AddForeignKey
ALTER TABLE "LegalVersion" ADD CONSTRAINT "LegalVersion_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


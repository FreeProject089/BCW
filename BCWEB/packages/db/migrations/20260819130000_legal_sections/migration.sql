-- Legal pages, editable from the dashboard.
--
-- No rows means the built-in defaults in legal.jsx are served, so a fresh install and an
-- un-migrated one both render exactly as before. Import is per DOCUMENT, all or nothing:
-- a policy assembled half from code and half from the database is one nobody can diff.

-- CreateTable
CREATE TABLE "LegalSection" (
    "id" TEXT NOT NULL,
    "doc" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "titleFr" TEXT,
    "body" TEXT NOT NULL DEFAULT '',
    "bodyFr" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "LegalSection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LegalSection_doc_order_idx" ON "LegalSection"("doc", "order");

-- AddForeignKey
ALTER TABLE "LegalSection" ADD CONSTRAINT "LegalSection_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


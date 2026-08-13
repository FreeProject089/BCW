-- Edit history for a project page's config blob.
--
-- The config lives in an AdminSetting row, which keeps only the CURRENT value, so an edit
-- that broke a page left nothing to compare against and nobody to ask. One snapshot per
-- save: the whole config, who saved it, and when.
--
-- editorId is a plain column, not a foreign key: a revision must outlive the account that
-- wrote it (the same choice BlogRevision.editorId already makes).

-- CreateTable
CREATE TABLE "ProjectConfigRevision" (
    "id" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "editorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectConfigRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectConfigRevision_target_createdAt_idx" ON "ProjectConfigRevision"("target", "createdAt");

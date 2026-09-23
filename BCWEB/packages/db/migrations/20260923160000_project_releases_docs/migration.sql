-- G2 + G3 (PLAN-SEPT23): a project's release entries, and its own docs and legal pages.
-- Separate from DocPage / LegalSection (the site's), see schema.prisma.
-- CreateTable
CREATE TABLE "ProjectRelease" (
    "id" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'stable',
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "content" JSONB NOT NULL DEFAULT '{}',
    "assets" JSONB NOT NULL DEFAULT '[]',
    "links" JSONB NOT NULL DEFAULT '{}',
    "published" BOOLEAN NOT NULL DEFAULT true,
    "source" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectRelease_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectDoc" (
    "id" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "icon" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "published" BOOLEAN NOT NULL DEFAULT true,
    "content" JSONB NOT NULL DEFAULT '{}',
    "source" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectDoc_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectRelease_target_date_idx" ON "ProjectRelease"("target", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectRelease_target_version_key" ON "ProjectRelease"("target", "version");

-- CreateIndex
CREATE INDEX "ProjectDoc_target_kind_idx" ON "ProjectDoc"("target", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectDoc_target_kind_slug_key" ON "ProjectDoc"("target", "kind", "slug");


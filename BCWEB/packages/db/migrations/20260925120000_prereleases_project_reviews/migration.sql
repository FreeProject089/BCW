-- prerelease (agent-prerelease): early access (PreRelease, PreReleaseSignup), per-project reviews
-- (ProjectReview, ProjectReviewSettings), and where a release was announced (ProjectRelease).

-- AlterTable
ALTER TABLE "ProjectRelease" ADD COLUMN     "announcedAt" TIMESTAMP(3),
ADD COLUMN     "announcement" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "PreRelease" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT '',
    "title" TEXT NOT NULL,
    "titleFr" TEXT NOT NULL DEFAULT '',
    "pitch" TEXT NOT NULL DEFAULT '',
    "pitchFr" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL DEFAULT '',
    "bodyFr" TEXT NOT NULL DEFAULT '',
    "published" BOOLEAN NOT NULL DEFAULT false,
    "opensAt" TIMESTAMP(3),
    "closesAt" TIMESTAMP(3),
    "capacity" INTEGER,
    "mode" TEXT NOT NULL DEFAULT 'manual',
    "selectCount" INTEGER,
    "notifyNotSelected" BOOLEAN NOT NULL DEFAULT false,
    "downloadKey" TEXT,
    "downloadUrl" TEXT,
    "downloadName" TEXT NOT NULL DEFAULT '',
    "downloadSize" INTEGER,
    "seed" TEXT NOT NULL,
    "seedHash" TEXT NOT NULL,
    "draws" JSONB NOT NULL DEFAULT '[]',
    "selectedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PreRelease_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PreReleaseSignup" (
    "id" TEXT NOT NULL,
    "prereleaseId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "message" TEXT NOT NULL DEFAULT '',
    "decidedAt" TIMESTAMP(3),
    "notifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PreReleaseSignup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectReview" (
    "id" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL,
    "lang" TEXT NOT NULL DEFAULT 'en',
    "rating" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "visibility" TEXT NOT NULL DEFAULT 'public',
    "anonymous" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectReviewSettings" (
    "target" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectReviewSettings_pkey" PRIMARY KEY ("target")
);

-- CreateIndex
CREATE UNIQUE INDEX "PreRelease_slug_key" ON "PreRelease"("slug");

-- CreateIndex
CREATE INDEX "PreRelease_target_idx" ON "PreRelease"("target");

-- CreateIndex
CREATE INDEX "PreRelease_published_closedAt_idx" ON "PreRelease"("published", "closedAt");

-- CreateIndex
CREATE INDEX "PreReleaseSignup_userId_idx" ON "PreReleaseSignup"("userId");

-- CreateIndex
CREATE INDEX "PreReleaseSignup_prereleaseId_status_createdAt_idx" ON "PreReleaseSignup"("prereleaseId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PreReleaseSignup_prereleaseId_userId_key" ON "PreReleaseSignup"("prereleaseId", "userId");

-- CreateIndex
CREATE INDEX "ProjectReview_target_status_idx" ON "ProjectReview"("target", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectReview_userId_target_key" ON "ProjectReview"("userId", "target");

-- AddForeignKey
ALTER TABLE "PreReleaseSignup" ADD CONSTRAINT "PreReleaseSignup_prereleaseId_fkey" FOREIGN KEY ("prereleaseId") REFERENCES "PreRelease"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreReleaseSignup" ADD CONSTRAINT "PreReleaseSignup_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectReview" ADD CONSTRAINT "ProjectReview_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


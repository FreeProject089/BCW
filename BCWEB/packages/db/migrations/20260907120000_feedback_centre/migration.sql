-- Feedback & crash centre: one inbox per project for feedback, bug reports and crash dumps.
CREATE TABLE "Feedback" (
    "id" TEXT NOT NULL,
    "projectKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL DEFAULT '',
    "appVersion" TEXT NOT NULL DEFAULT '',
    "os" TEXT NOT NULL DEFAULT '',
    "meta" JSONB,
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "fingerprint" TEXT NOT NULL DEFAULT '',
    "count" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'new',
    "userId" TEXT,
    "email" TEXT NOT NULL DEFAULT '',
    "creatorId" TEXT NOT NULL DEFAULT '',
    "ipHash" TEXT NOT NULL DEFAULT '',
    "reportId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Feedback_projectKey_status_idx" ON "Feedback"("projectKey", "status");
CREATE INDEX "Feedback_fingerprint_idx" ON "Feedback"("fingerprint");
CREATE INDEX "Feedback_userId_idx" ON "Feedback"("userId");
CREATE INDEX "Feedback_createdAt_idx" ON "Feedback"("createdAt");

-- moderation (agent-moderation): the review queue of the rules-first moderation engine.

-- CreateTable
CREATE TABLE "ModerationCase" (
    "id" TEXT NOT NULL,
    "surface" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL DEFAULT 'text',
    "subjectId" TEXT NOT NULL DEFAULT '',
    "decision" TEXT NOT NULL,
    "rawDecision" TEXT NOT NULL DEFAULT 'ALLOW',
    "mode" TEXT NOT NULL DEFAULT 'flag',
    "score" INTEGER NOT NULL DEFAULT 0,
    "reasons" JSONB NOT NULL DEFAULT '[]',
    "ai" JSONB,
    "status" TEXT NOT NULL DEFAULT 'open',
    "held" BOOLEAN NOT NULL DEFAULT false,
    "authorId" TEXT,
    "authorKey" TEXT NOT NULL DEFAULT '',
    "excerpt" TEXT,
    "payload" JSONB,
    "textHash" TEXT NOT NULL DEFAULT '',
    "resolverId" TEXT,
    "resolution" TEXT,
    "note" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "purgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModerationCase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ModerationCase_status_createdAt_idx" ON "ModerationCase"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ModerationCase_surface_status_idx" ON "ModerationCase"("surface", "status");

-- CreateIndex
CREATE INDEX "ModerationCase_subjectType_subjectId_idx" ON "ModerationCase"("subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "ModerationCase_authorId_idx" ON "ModerationCase"("authorId");

-- CreateIndex
CREATE INDEX "ModerationCase_resolvedAt_idx" ON "ModerationCase"("resolvedAt");

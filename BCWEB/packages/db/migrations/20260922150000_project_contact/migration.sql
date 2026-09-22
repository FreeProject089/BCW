-- AlterTable
ALTER TABLE "ContactThread" ADD COLUMN     "topic" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "ProjectContactSettings" (
    "ref" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "basicTopics" TEXT[] DEFAULT ARRAY['question', 'bug', 'translation', 'suggestion', 'other']::TEXT[],
    "customTopics" JSONB NOT NULL DEFAULT '[]',
    "editorsSeeInbox" BOOLEAN NOT NULL DEFAULT true,
    "inboxUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "ProjectContactSettings_pkey" PRIMARY KEY ("ref")
);


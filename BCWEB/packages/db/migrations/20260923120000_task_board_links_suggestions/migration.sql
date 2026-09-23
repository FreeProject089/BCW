-- The task board, second pass: several people on one task, links between tasks, and tasks
-- the site proposes from its own state.
--
-- 1. AdminTask.assigneeId (one person) becomes AdminTask.assigneeIds (a list). The new
--    column is added and BACKFILLED before the old one is dropped, so every task assigned
--    today is still assigned to the same person after this runs. No FK, for the reason the
--    admin_tasks migration gives for every user id on these tables: a finished task records
--    who did the work, and neither CASCADE nor SET NULL is what a log wants.
-- 2. AdminTaskLink: blocks / relates, both ends ON DELETE CASCADE. The API refuses an edge
--    that would close a cycle in the blocks graph; the database only refuses duplicates.
-- 3. TaskSuggestion: a draft task per incident, deduplicated on `dedupKey`. Its text is
--    scrubbed by the API before it is written (lib/task-suggest.mjs): no URL, no path, no
--    token-shaped string (CWE-532).

-- AlterTable: add the list, copy the single assignee into it, then drop the column.
ALTER TABLE "AdminTask" ADD COLUMN "assigneeIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
UPDATE "AdminTask" SET "assigneeIds" = ARRAY["assigneeId"] WHERE "assigneeId" IS NOT NULL;

-- DropIndex
DROP INDEX "AdminTask_assigneeId_state_idx";

ALTER TABLE "AdminTask" DROP COLUMN "assigneeId";

-- CreateTable
CREATE TABLE "AdminTaskLink" (
    "id" TEXT NOT NULL,
    "fromId" TEXT NOT NULL,
    "toId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminTaskLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskSuggestion" (
    "id" TEXT NOT NULL,
    "dedupKey" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceCap" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "href" TEXT,
    "count" INTEGER NOT NULL DEFAULT 1,
    "state" TEXT NOT NULL DEFAULT 'open',
    "taskId" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdminTaskLink_toId_idx" ON "AdminTaskLink"("toId");

-- CreateIndex
CREATE UNIQUE INDEX "AdminTaskLink_fromId_toId_kind_key" ON "AdminTaskLink"("fromId", "toId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "TaskSuggestion_dedupKey_key" ON "TaskSuggestion"("dedupKey");

-- CreateIndex
CREATE INDEX "TaskSuggestion_state_lastSeenAt_idx" ON "TaskSuggestion"("state", "lastSeenAt");

-- AddForeignKey
ALTER TABLE "AdminTaskLink" ADD CONSTRAINT "AdminTaskLink_fromId_fkey" FOREIGN KEY ("fromId") REFERENCES "AdminTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminTaskLink" ADD CONSTRAINT "AdminTaskLink_toId_fkey" FOREIGN KEY ("toId") REFERENCES "AdminTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

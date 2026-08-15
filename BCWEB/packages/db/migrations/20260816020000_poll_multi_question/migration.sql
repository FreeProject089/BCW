-- Multi-question polls: the tables only. Nothing reads them yet.
--
-- Step 1 of the plan in BCWEB/guides/reference/POLLS_V2_DESIGN_EN.md, and deliberately
-- invisible: Poll, PollOption and PollVote are UNTOUCHED and keep serving every existing poll.
-- A migration that swapped the reader in the same release would have no way back if the new
-- reader were wrong about something; leaving the old tables in place costs a few megabytes and
-- turns the rollback into a code revert instead of a restore.
--
-- PollAnswer carries four TYPED value columns rather than one Json. Json would be shorter and
-- would make every question kind free, but "average rating" over a Json column cannot use an
-- index, and the statistics are the entire reason this feature exists.
--
-- Additive only: three new tables, their indexes and their foreign keys. No existing table is
-- altered, no row is rewritten, and the backfill is a separate, re-runnable script.

-- CreateTable
CREATE TABLE "PollQuestion" (
    "id" TEXT NOT NULL,
    "pollId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'choice',
    "label" TEXT NOT NULL,
    "help" TEXT NOT NULL DEFAULT '',
    "required" BOOLEAN NOT NULL DEFAULT false,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "config" JSONB,
    "showIf" JSONB,

    CONSTRAINT "PollQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PollChoice" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PollChoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PollAnswer" (
    "id" TEXT NOT NULL,
    "pollId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "choiceId" TEXT,
    "text" TEXT,
    "number" DOUBLE PRECISION,
    "date" TIMESTAMP(3),
    "userId" TEXT,
    "voterKey" TEXT,
    "wasLoggedIn" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PollAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PollQuestion_pollId_sort_idx" ON "PollQuestion"("pollId", "sort");

-- CreateIndex
CREATE INDEX "PollChoice_questionId_sort_idx" ON "PollChoice"("questionId", "sort");

-- CreateIndex
CREATE INDEX "PollAnswer_pollId_createdAt_idx" ON "PollAnswer"("pollId", "createdAt");

-- CreateIndex
CREATE INDEX "PollAnswer_questionId_idx" ON "PollAnswer"("questionId");

-- CreateIndex
CREATE INDEX "PollAnswer_userId_idx" ON "PollAnswer"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PollAnswer_questionId_userId_choiceId_key" ON "PollAnswer"("questionId", "userId", "choiceId");

-- CreateIndex
CREATE UNIQUE INDEX "PollAnswer_questionId_voterKey_choiceId_key" ON "PollAnswer"("questionId", "voterKey", "choiceId");

-- AddForeignKey
ALTER TABLE "PollQuestion" ADD CONSTRAINT "PollQuestion_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "Poll"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PollChoice" ADD CONSTRAINT "PollChoice_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "PollQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PollAnswer" ADD CONSTRAINT "PollAnswer_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "Poll"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PollAnswer" ADD CONSTRAINT "PollAnswer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "PollQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PollAnswer" ADD CONSTRAINT "PollAnswer_choiceId_fkey" FOREIGN KEY ("choiceId") REFERENCES "PollChoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PollAnswer" ADD CONSTRAINT "PollAnswer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


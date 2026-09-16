-- The staff task board: teams of admins/moderators, a chief each, and the work handed out.
--
-- WHY THE SHAPE IS THIS SHAPE
--
-- Four tables and, deliberately, only three foreign keys. The keys that exist are the ones
-- between these tables, and each cascade is a decision:
--
--   StaffTeamMember.teamId  ON DELETE CASCADE   a membership of a team that is gone is not a
--                                               fact about anything.
--   AdminTask.teamId        ON DELETE SET NULL  dissolving a team must NOT delete its work.
--                                               The tasks fall back into the unfiled pool
--                                               where an admin re-files them; the API also
--                                               clears the assignee of the still-open ones,
--                                               because a task with no team has no chief and
--                                               must not look quietly owned.
--   AdminTaskEvent.taskId   ON DELETE CASCADE   the history is part of the task, not a
--                                               separate record of it.
--
-- The user ids (chiefId, assigneeId, creatorId, closedById, actorId, StaffTeamMember.userId)
-- carry NO foreign key, matching ExpiringFile.ownerId and MediaFlag.resolvedById. Two
-- reasons, one structural and one about the data. Structural: a Prisma relation needs a
-- back-reference field on User, the most contended model in this schema. About the data: a
-- closed task records WHO DID THE WORK, and an ON DELETE CASCADE would erase finished history
-- when somebody leaves, while an ON DELETE SET NULL would silently rewrite it. Neither is
-- what you want from a log. A dangling id resolves to nothing and the screen says so.
--
-- `state` and `priority` are TEXT with a default rather than Postgres enums. The vocabulary
-- lives in TASK_STATES / TASK_PRIORITIES in apps/api/src/lib/tasks.mjs, which is also where
-- the rules over it are written; a second copy in the database would be a second copy to
-- migrate every time a state is added, for a constraint the routes already enforce with zod.
-- CreateTable
CREATE TABLE "StaffTeam" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "chiefId" TEXT NOT NULL,
    "createdById" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffTeam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffTeamMember" (
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "addedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffTeamMember_pkey" PRIMARY KEY ("teamId","userId")
);

-- CreateTable
CREATE TABLE "AdminTask" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "state" TEXT NOT NULL DEFAULT 'todo',
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "teamId" TEXT,
    "assigneeId" TEXT,
    "creatorId" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminTaskEvent" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "actorId" TEXT,
    "kind" TEXT NOT NULL,
    "fromValue" TEXT,
    "toValue" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminTaskEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StaffTeam_slug_key" ON "StaffTeam"("slug");

-- CreateIndex
CREATE INDEX "StaffTeam_chiefId_idx" ON "StaffTeam"("chiefId");

-- CreateIndex
CREATE INDEX "StaffTeamMember_userId_idx" ON "StaffTeamMember"("userId");

-- CreateIndex
CREATE INDEX "AdminTask_state_priority_dueAt_idx" ON "AdminTask"("state", "priority", "dueAt");

-- CreateIndex
CREATE INDEX "AdminTask_assigneeId_state_idx" ON "AdminTask"("assigneeId", "state");

-- CreateIndex
CREATE INDEX "AdminTask_teamId_state_idx" ON "AdminTask"("teamId", "state");

-- CreateIndex
CREATE INDEX "AdminTaskEvent_taskId_createdAt_idx" ON "AdminTaskEvent"("taskId", "createdAt");

-- AddForeignKey
ALTER TABLE "StaffTeamMember" ADD CONSTRAINT "StaffTeamMember_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "StaffTeam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminTask" ADD CONSTRAINT "AdminTask_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "StaffTeam"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminTaskEvent" ADD CONSTRAINT "AdminTaskEvent_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "AdminTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;


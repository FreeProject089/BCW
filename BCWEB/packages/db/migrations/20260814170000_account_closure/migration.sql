-- Account closure: a request with a month of grace, not an act.
--
-- What finally happens is ANONYMISATION, never a row delete. Twenty-nine tables point at a
-- user and the ones that matter most — payments, the audit chain — are exactly the ones
-- that must survive for as long as the law requires. The row stays; everything personal is
-- scrubbed off it, so every invoice remains attached to something without remaining
-- attached to a person.
--
-- closureToken is the cancel link, usable while the closure is pending. Somebody changing
-- their mind may be reading the email on a device they are not signed in on, and "log in
-- first to stop your account being deleted" is a trap.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "closureRequestedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "closureScheduledFor" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "closureToken" TEXT;
ALTER TABLE "User" ADD COLUMN "closedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "User_closureToken_key" ON "User"("closureToken");

-- CreateTable
CREATE TABLE "AccountClosureSurvey" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "comment" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountClosureSurvey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccountClosureSurvey_outcome_createdAt_idx" ON "AccountClosureSurvey"("outcome", "createdAt");

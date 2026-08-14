-- Two things the closure feature was missing.
--
-- 1. A closure can be started by STAFF. closureReason/closureBy are null on a self-request,
--    which is how the two are told apart — including by the email, which for a staff
--    closure must say WHY and offer a way to argue rather than a one-click undo.
--
-- 2. A closed account can be recognised when its owner comes back. Closing erases the
--    email address, which is the point, but it also erases the only link between the closed
--    account and the person returning: someone banned for cause could re-register with the
--    same address and arrive with a clean record, and someone returning in good faith would
--    lose the history they earned. closedEmailHash is a SHA-256 of the old address — enough
--    to confirm "same mailbox", impossible to read back into one — and priorUserId records
--    the match.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "closureReason" TEXT;
ALTER TABLE "User" ADD COLUMN "closureBy" TEXT;
ALTER TABLE "User" ADD COLUMN "closedEmailHash" TEXT;
ALTER TABLE "User" ADD COLUMN "priorUserId" TEXT;

-- CreateIndex
CREATE INDEX "User_closedEmailHash_idx" ON "User"("closedEmailHash");
CREATE INDEX "User_priorUserId_idx" ON "User"("priorUserId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_priorUserId_fkey" FOREIGN KEY ("priorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

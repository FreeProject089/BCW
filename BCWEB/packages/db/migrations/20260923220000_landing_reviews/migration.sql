-- M11: members can post a landing review, held for moderation. One per account; deleting
-- the account deletes it. Existing (staff-written) rows become status 'approved'.
-- AlterTable
ALTER TABLE "Review" ADD COLUMN     "lang" TEXT NOT NULL DEFAULT 'en',
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'approved',
ADD COLUMN     "userId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Review_userId_key" ON "Review"("userId");

-- CreateIndex
CREATE INDEX "Review_status_idx" ON "Review"("status");

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


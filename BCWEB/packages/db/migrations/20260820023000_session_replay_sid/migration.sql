-- AlterTable
ALTER TABLE "SessionReplay" ADD COLUMN     "sid" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "SessionReplay_sid_key" ON "SessionReplay"("sid");


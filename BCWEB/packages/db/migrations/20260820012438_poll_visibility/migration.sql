-- AlterTable
ALTER TABLE "Poll" ADD COLUMN     "shareKey" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "visibility" TEXT NOT NULL DEFAULT 'public';

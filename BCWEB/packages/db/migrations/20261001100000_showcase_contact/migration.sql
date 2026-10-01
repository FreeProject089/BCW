-- agent-bcw-rules: the follow-up contact of a listing request (Project Policy).

-- AlterTable
ALTER TABLE "ShowcaseRequest" ADD COLUMN     "contactDiscord" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "contactEmail" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "contactLang" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "contactUrl" TEXT NOT NULL DEFAULT '';

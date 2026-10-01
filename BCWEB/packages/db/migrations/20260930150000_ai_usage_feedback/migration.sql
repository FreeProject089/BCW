-- AI suggestion feedback: how many suggestions members applied (accepted) or dismissed
-- (rejected), per (day, feature, provider). Counts only, never the text. Two columns with a
-- default: safe for a rolling deploy.

-- AlterTable
ALTER TABLE "AiUsageDay" ADD COLUMN     "accepted" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "rejected" INTEGER NOT NULL DEFAULT 0;

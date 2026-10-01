-- agent-laya-triage: automatic triage of the feedback / bug / crash intake (lib/feedback-triage.mjs).
-- Tags, category, severity hint and duplicate hint on the row, who set them (rules | laya | staff)
-- and whether Laya still has to look. Additive, defaulted/nullable: safe for a rolling deploy.
-- Existing rows keep triageSource NULL; the sweeper's backfill gives them the rules' triage.

-- AlterTable
ALTER TABLE "Feedback" ADD COLUMN     "triageCategory" TEXT,
ADD COLUMN     "triageDupOfId" TEXT,
ADD COLUMN     "triageDupScore" DOUBLE PRECISION,
ADD COLUMN     "triagePending" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "triageSeverity" TEXT,
ADD COLUMN     "triageSource" TEXT,
ADD COLUMN     "triageTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "triagedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Feedback_triagePending_triageSource_idx" ON "Feedback"("triagePending", "triageSource");

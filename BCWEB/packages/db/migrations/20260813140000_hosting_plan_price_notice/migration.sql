-- A price change that has been announced but is not in force yet.
--
-- The Payments policy promises advance notice and that a new price applies from the next
-- renewal, never to a period already paid for. Writing priceMonthlyCents directly cannot
-- keep that promise — it takes effect on Save, silently. An increase is staged in these
-- columns instead: subscribers are emailed when it is scheduled, and the sweeper swaps
-- the price in on the day.
--
-- Nullable with no backfill: every existing plan simply has no pending change.

-- AlterTable
ALTER TABLE "HostingPlan" ADD COLUMN "pendingPriceCents" INTEGER;
ALTER TABLE "HostingPlan" ADD COLUMN "pendingPriceAt" TIMESTAMP(3);
ALTER TABLE "HostingPlan" ADD COLUMN "pendingNoticeAt" TIMESTAMP(3);
ALTER TABLE "HostingPlan" ADD COLUMN "pendingNoticeCount" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "HostingPlan_pendingPriceAt_idx" ON "HostingPlan"("pendingPriceAt");

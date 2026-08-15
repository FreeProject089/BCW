-- Finish what 20260815050000_report_reporter_nullable started.
--
-- That migration made Report.reporterId nullable and said so in its comment: "Nullable makes
-- anonymising possible". It is not, on its own. The foreign key was left at its default, so
-- deleting a user who had filed a report FAILS on the constraint instead of clearing the
-- column — the exact operation the change existed to allow, still impossible.
--
-- The schema has said `onDelete: SetNull` the whole time. Only the database disagreed, which
-- is why nothing looked wrong: prisma migrate status reported "up to date" while a drift diff
-- against the live database asked for this every time.
--
-- Widening only. No row is rewritten and no reporter is lost.
ALTER TABLE "Report" DROP CONSTRAINT "Report_reporterId_fkey";
ALTER TABLE "Report" ADD CONSTRAINT "Report_reporterId_fkey"
    FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The report a sanction came out of. A decision with no recorded cause cannot be reviewed.
ALTER TABLE "Sanction" ADD COLUMN "reportId" TEXT;
CREATE INDEX "Sanction_reportId_idx" ON "Sanction"("reportId");
ALTER TABLE "Sanction" ADD CONSTRAINT "Sanction_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE SET NULL ON UPDATE CASCADE;

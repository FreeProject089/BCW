-- ErrorEvent.source: distinguish a browser-reported error from a server 5xx.
-- Existing rows are all client reports (the API never wrote here before), so the
-- default backfills them correctly.
ALTER TABLE "ErrorEvent" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'client';

-- The admin error view filters by source over a time window.
CREATE INDEX "ErrorEvent_source_createdAt_idx" ON "ErrorEvent"("source", "createdAt");

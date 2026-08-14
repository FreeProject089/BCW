-- Acknowledgement turns the alert log into a queue the admin tab can badge.
ALTER TABLE "ServerAlertLog" ADD COLUMN "ackAt" TIMESTAMP(3);
ALTER TABLE "ServerAlertLog" ADD COLUMN "ackById" TEXT;
CREATE INDEX "ServerAlertLog_ackAt_idx" ON "ServerAlertLog"("ackAt");

-- Outage history: one row per period a dependency was down, with the message that opened it.
CREATE TABLE "ServiceOutage" (
    "id" TEXT NOT NULL,
    "dep" TEXT NOT NULL,
    "cause" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "ServiceOutage_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ServiceOutage_dep_startedAt_idx" ON "ServiceOutage"("dep", "startedAt");
CREATE INDEX "ServiceOutage_endedAt_idx" ON "ServiceOutage"("endedAt");

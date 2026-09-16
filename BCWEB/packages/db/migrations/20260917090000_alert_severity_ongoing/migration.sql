-- An alert list ordered only by "recent" cannot be worked through: the one row that needs
-- somebody tonight sits in the middle of forty that do not, and a two-week-old incident that
-- fixed itself looks exactly like the outage happening right now.
--
-- `severity` is decided where the alert is raised, not by the colour of a badge.
-- `key` is the CONDITION rather than this sighting of it, which is what lets the monitor
-- close an alert when the condition stops being true. `resolvedAt` is that closing: distinct
-- from `ackAt`, which says a human looked, not that the machine is well.
--
-- Existing rows keep the default 'warning' and a NULL key: they are history, they were never
-- tracked as conditions, and backfilling a key for them would claim a row is "ongoing" on the
-- strength of a guess.
ALTER TABLE "ServerAlertLog" ADD COLUMN     "key" TEXT,
ADD COLUMN     "resolvedAt" TIMESTAMP(3),
ADD COLUMN     "severity" TEXT NOT NULL DEFAULT 'warning';

CREATE INDEX "ServerAlertLog_key_resolvedAt_idx" ON "ServerAlertLog"("key", "resolvedAt");

-- Nothing that predates this migration is claimed to be still happening.
UPDATE "ServerAlertLog" SET "resolvedAt" = "createdAt" WHERE "resolvedAt" IS NULL;

-- The two that were always the "the box is about to fall over" kinds, said out loud.
UPDATE "ServerAlertLog" SET "severity" = 'critical' WHERE "kind" IN ('disk', 'service_down');

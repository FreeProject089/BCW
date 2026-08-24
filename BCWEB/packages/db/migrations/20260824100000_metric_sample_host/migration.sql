-- Tag each server-metric sample with the hostname that wrote it. Two processes on
-- different machines sharing one database interleave into a single series otherwise,
-- and the dashboard draws a sawtooth alternating between two real machines.
ALTER TABLE "ServerMetricSample" ADD COLUMN "host" TEXT NOT NULL DEFAULT '';

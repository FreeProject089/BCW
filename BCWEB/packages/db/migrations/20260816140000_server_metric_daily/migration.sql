-- A daily summary of the server metrics, kept forever.
--
-- Raw samples are pruned at 30 days, so any comparison further back had nothing to read. This
-- is ~365 rows a year: cheap to keep, and the only thing that makes "versus six months ago"
-- answerable at all.
CREATE TABLE "ServerMetricDaily" (
    "day"         DATE NOT NULL,
    "cpuAvg"      DOUBLE PRECISION NOT NULL,
    "cpuMax"      DOUBLE PRECISION NOT NULL,
    "memAvg"      DOUBLE PRECISION NOT NULL,
    "memMax"      DOUBLE PRECISION NOT NULL,
    "diskAvg"     DOUBLE PRECISION NOT NULL,
    "diskMax"     DOUBLE PRECISION NOT NULL,
    "loadAvg"     DOUBLE PRECISION NOT NULL,
    "latencyAvg"  INTEGER,
    "netRxAvg"    INTEGER,
    "netTxAvg"    INTEGER,
    "samples"     INTEGER NOT NULL DEFAULT 0,
    "downMinutes" INTEGER NOT NULL DEFAULT 0,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServerMetricDaily_pkey" PRIMARY KEY ("day")
);

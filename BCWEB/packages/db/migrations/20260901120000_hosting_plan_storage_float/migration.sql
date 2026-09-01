-- HostingPlan.storageGB: Int -> Float (double precision).
-- Lets a plan or an admin-set service cap be expressed below 1 GB (the Hosting-settings UI
-- offers MB / GB / TB and stores the canonical GB value). Existing whole-GB values are
-- preserved exactly by the widening cast.
ALTER TABLE "HostingPlan" ALTER COLUMN "storageGB" SET DATA TYPE DOUBLE PRECISION;

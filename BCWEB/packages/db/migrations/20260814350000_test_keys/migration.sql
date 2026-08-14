-- A test key simulates every write it makes, with no per-request header to forget.
ALTER TABLE "ApiKey" ADD COLUMN "testMode" BOOLEAN NOT NULL DEFAULT false;

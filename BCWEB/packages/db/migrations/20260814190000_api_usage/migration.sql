-- What the public API is actually being used for, in two tables that answer two questions.
--
-- ApiUsageDay is the count: one row per key per day, exact, kept. ApiRequest is a sample of
-- individual calls: detailed, pruned within days. Merging them would force a choice between
-- a usage graph that lies (because it was sampled) and an access log that never stops
-- growing inside the primary database.
--
-- keyId is nullable with ON DELETE SET NULL, and userId is denormalised, so the history
-- outlives the key it describes — tidying up a token must not silently rewrite last
-- quarter's usage.

-- CreateTable
CREATE TABLE "ApiUsageDay" (
    "id" TEXT NOT NULL,
    "keyId" TEXT,
    "userId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "errors" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ApiUsageDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiRequest" (
    "id" TEXT NOT NULL,
    "keyId" TEXT,
    "userId" TEXT,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "status" INTEGER NOT NULL,
    "ms" INTEGER NOT NULL DEFAULT 0,
    "ip" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ApiUsageDay_keyId_day_key" ON "ApiUsageDay"("keyId", "day");
CREATE INDEX "ApiUsageDay_userId_day_idx" ON "ApiUsageDay"("userId", "day");
CREATE INDEX "ApiUsageDay_day_idx" ON "ApiUsageDay"("day");
CREATE INDEX "ApiRequest_at_idx" ON "ApiRequest"("at");
CREATE INDEX "ApiRequest_userId_at_idx" ON "ApiRequest"("userId", "at");
CREATE INDEX "ApiRequest_keyId_at_idx" ON "ApiRequest"("keyId", "at");

-- AddForeignKey
ALTER TABLE "ApiUsageDay" ADD CONSTRAINT "ApiUsageDay_keyId_fkey" FOREIGN KEY ("keyId") REFERENCES "ApiKey"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ApiRequest" ADD CONSTRAINT "ApiRequest_keyId_fkey" FOREIGN KEY ("keyId") REFERENCES "ApiKey"("id") ON DELETE SET NULL ON UPDATE CASCADE;

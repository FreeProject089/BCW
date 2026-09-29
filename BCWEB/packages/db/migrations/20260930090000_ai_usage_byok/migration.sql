-- aios (agent-bcw-ai-os): AI usage analytics (aggregates only, no text), per-user daily AI usage,
-- and members' own AI keys (BYOK, sealed at rest). New tables only: safe for a rolling deploy.

-- CreateTable
CREATE TABLE "AiUsageDay" (
    "id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "feature" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "calls" INTEGER NOT NULL DEFAULT 0,
    "ok" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "timeout" INTEGER NOT NULL DEFAULT 0,
    "dropped" INTEGER NOT NULL DEFAULT 0,
    "rateLimited" INTEGER NOT NULL DEFAULT 0,
    "cacheHit" INTEGER NOT NULL DEFAULT 0,
    "breakerOpen" INTEGER NOT NULL DEFAULT 0,
    "breakerRefused" INTEGER NOT NULL DEFAULT 0,
    "killed" INTEGER NOT NULL DEFAULT 0,
    "disabled" INTEGER NOT NULL DEFAULT 0,
    "badAnswer" INTEGER NOT NULL DEFAULT 0,
    "latencySumMs" BIGINT NOT NULL DEFAULT 0,
    "latencyHist" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "tokensIn" INTEGER NOT NULL DEFAULT 0,
    "tokensOut" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "changed" INTEGER NOT NULL DEFAULT 0,
    "falsePositive" INTEGER NOT NULL DEFAULT 0,
    "confirmed" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AiUsageDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiUserUsageDay" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "feature" TEXT NOT NULL,
    "calls" INTEGER NOT NULL DEFAULT 0,
    "tokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "AiUserUsageDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiUserKey" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "model" TEXT NOT NULL DEFAULT '',
    "keySecret" TEXT NOT NULL,
    "keyLast4" TEXT NOT NULL DEFAULT '',
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiUserKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiUsageDay_day_idx" ON "AiUsageDay"("day");

-- CreateIndex
CREATE UNIQUE INDEX "AiUsageDay_day_feature_provider_key" ON "AiUsageDay"("day", "feature", "provider");

-- CreateIndex
CREATE INDEX "AiUserUsageDay_day_idx" ON "AiUserUsageDay"("day");

-- CreateIndex
CREATE UNIQUE INDEX "AiUserUsageDay_userId_day_feature_key" ON "AiUserUsageDay"("userId", "day", "feature");

-- CreateIndex
CREATE UNIQUE INDEX "AiUserKey_userId_key" ON "AiUserKey"("userId");

-- AddForeignKey
ALTER TABLE "AiUserUsageDay" ADD CONSTRAINT "AiUserUsageDay_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiUserKey" ADD CONSTRAINT "AiUserKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


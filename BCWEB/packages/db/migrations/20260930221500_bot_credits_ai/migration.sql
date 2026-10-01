-- agent-bcw-bot: Discord bot credit wallet (ledger), per-server monthly AI usage, per-server AI
-- source + sealed BYOK key. New tables only: safe for a rolling deploy.

-- CreateTable
CREATE TABLE "BotCreditLedger" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "ref" TEXT,
    "userId" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BotCreditLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BotAiUsage" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "platform" INTEGER NOT NULL DEFAULT 0,
    "byok" INTEGER NOT NULL DEFAULT 0,
    "overQuota" INTEGER NOT NULL DEFAULT 0,
    "creditsSpent" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "BotAiUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BotAiSettings" (
    "guildId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'platform',
    "baseUrl" TEXT NOT NULL DEFAULT '',
    "model" TEXT NOT NULL DEFAULT '',
    "keySecret" TEXT NOT NULL DEFAULT '',
    "keyLast4" TEXT NOT NULL DEFAULT '',
    "monthlyCap" INTEGER NOT NULL DEFAULT 0,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BotAiSettings_pkey" PRIMARY KEY ("guildId")
);

-- CreateIndex
CREATE UNIQUE INDEX "BotCreditLedger_ref_key" ON "BotCreditLedger"("ref");

-- CreateIndex
CREATE INDEX "BotCreditLedger_guildId_createdAt_idx" ON "BotCreditLedger"("guildId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BotAiUsage_guildId_month_key" ON "BotAiUsage"("guildId", "month");

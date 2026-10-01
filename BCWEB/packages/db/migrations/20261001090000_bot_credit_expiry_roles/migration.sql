-- agent-bcw-bot: credit packs expire (per lot, spent oldest first) and purchased Discord roles
-- are taken back at the end of a subscription by each server's policy.

-- AlterTable
ALTER TABLE "BotCreditLedger" ADD COLUMN "expiresAt" TIMESTAMP(3),
ADD COLUMN "remaining" INTEGER NOT NULL DEFAULT 0;

-- Existing positive rows become lots holding what they added. Purchases made before the rule
-- get the default 12 months from the day it was announced (2026-10-01), as the terms say;
-- gifts and corrections keep no expiry.
UPDATE "BotCreditLedger" SET "remaining" = "delta" WHERE "delta" > 0;
-- The duration is the admin's configured one (bot.billing.expiryMonths), 12 when unset; 0 means
-- never. lib/bot-billing.mjs backfillLegacyLots applies the same rule from the sweeper.
UPDATE "BotCreditLedger" SET "expiresAt" = TIMESTAMP '2026-10-01 00:00:00' + make_interval(months => m.months)
FROM (SELECT COALESCE((SELECT ("value"->>'expiryMonths')::int FROM "AdminSetting" WHERE "key" = 'bot.billing'), 12) AS months) m
WHERE "BotCreditLedger"."delta" > 0 AND "BotCreditLedger"."reason" = 'purchase' AND "BotCreditLedger"."expiresAt" IS NULL AND m.months > 0;

-- CreateTable
CREATE TABLE "BotRoleRemoval" (
    "id" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "removeAt" TIMESTAMP(3) NOT NULL,
    "outcome" TEXT,
    "doneAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BotRoleRemoval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BotCreditLedger_expiresAt_idx" ON "BotCreditLedger"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "BotRoleRemoval_purchaseId_discordId_key" ON "BotRoleRemoval"("purchaseId", "discordId");

-- CreateIndex
CREATE INDEX "BotRoleRemoval_doneAt_removeAt_idx" ON "BotRoleRemoval"("doneAt", "removeAt");

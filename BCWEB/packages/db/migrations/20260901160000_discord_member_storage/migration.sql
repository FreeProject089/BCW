-- B4: per-guild Discord member storage, mode config, and moderation logs.
--
-- DiscordActivity is now keyed per guild. It is a rebuildable CACHE (the bot's member scan
-- repopulates it), so the safe migration for an empty dev DB and a populated prod one alike is
-- to clear it and re-key — existing rows carry no guildId and would repopulate on the next scan.
DELETE FROM "DiscordActivity";
ALTER TABLE "DiscordActivity" DROP CONSTRAINT "DiscordActivity_pkey";
ALTER TABLE "DiscordActivity" ADD COLUMN "guildId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "DiscordActivity" ADD CONSTRAINT "DiscordActivity_pkey" PRIMARY KEY ("guildId", "discordId");
DROP INDEX "DiscordActivity_updatedAt_idx";
CREATE INDEX "DiscordActivity_guildId_updatedAt_idx" ON "DiscordActivity"("guildId", "updatedAt");
CREATE INDEX "DiscordActivity_discordId_idx" ON "DiscordActivity"("discordId");

-- Per-guild bot config + member-storage budget.
CREATE TABLE "BotGuild" (
  "guildId" TEXT NOT NULL,
  "name" TEXT,
  "memberMode" TEXT NOT NULL DEFAULT 'none',
  "logChannelId" TEXT,
  "storeLogs" BOOLEAN NOT NULL DEFAULT false,
  "hostingGroupId" TEXT,
  "storageQuotaBytes" BIGINT NOT NULL DEFAULT 0,
  "memberCount" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BotGuild_pkey" PRIMARY KEY ("guildId")
);
CREATE INDEX "BotGuild_memberMode_idx" ON "BotGuild"("memberMode");

-- Moderation actions (persisted only for pool / moderation+storeLogs guilds).
CREATE TABLE "ModerationLog" (
  "id" TEXT NOT NULL,
  "guildId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "reason" TEXT,
  "auto" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ModerationLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ModerationLog_guildId_createdAt_idx" ON "ModerationLog"("guildId", "createdAt");

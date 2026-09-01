-- B10: record who may manage a guild from the user-facing dashboard.
-- The bot reports the guild owner (+ best-effort Manage-Server admins) on every heartbeat,
-- so these are populated for every guild the bot is in, regardless of member mode.
ALTER TABLE "BotGuild" ADD COLUMN "ownerDiscordId" TEXT;
ALTER TABLE "BotGuild" ADD COLUMN "managerDiscordIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

CREATE INDEX "BotGuild_ownerDiscordId_idx" ON "BotGuild"("ownerDiscordId");

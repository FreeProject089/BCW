-- XP / level / points of Discord members who have not linked a BetterCommunity account yet.
-- Merged into "UserEconomy" (and deleted) the moment the member links.
CREATE TABLE "DiscordEconomy" (
    "discordId" TEXT NOT NULL,
    "xp" INTEGER NOT NULL DEFAULT 0,
    "level" INTEGER NOT NULL DEFAULT 0,
    "points" INTEGER NOT NULL DEFAULT 0,
    "voiceSeconds" INTEGER NOT NULL DEFAULT 0,
    "messages" INTEGER NOT NULL DEFAULT 0,
    "reactions" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DiscordEconomy_pkey" PRIMARY KEY ("discordId")
);
CREATE INDEX "DiscordEconomy_level_idx" ON "DiscordEconomy"("level");

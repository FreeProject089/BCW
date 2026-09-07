-- Giveaways refonte: two kinds (admin / user), an audience gate, site entrants, prize kinds
-- (promo code / custom content), and a per-guild grouping for the user-giveaway cap. All
-- additive; channelId becomes nullable for site-only giveaways.
ALTER TABLE "Giveaway" ALTER COLUMN "channelId" DROP NOT NULL;
ALTER TABLE "Giveaway" ADD COLUMN "siteEntrants" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "Giveaway" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'admin';
ALTER TABLE "Giveaway" ADD COLUMN "audience" TEXT NOT NULL DEFAULT 'discord';
ALTER TABLE "Giveaway" ADD COLUMN "guildId" TEXT;
ALTER TABLE "Giveaway" ADD COLUMN "hostDiscordId" TEXT;
ALTER TABLE "Giveaway" ADD COLUMN "prizeKind" TEXT NOT NULL DEFAULT 'promo';
ALTER TABLE "Giveaway" ADD COLUMN "prizeContent" TEXT;
CREATE INDEX "Giveaway_guildId_status_idx" ON "Giveaway"("guildId", "status");

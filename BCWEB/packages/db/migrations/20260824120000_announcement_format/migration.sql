-- How an announcement is presented, chosen per announcement rather than fixed in the bot.
--
-- 'embed' is the default because it is what every existing row was rendered as; a plain
-- message ('text') is what you want when the announcement should read as somebody talking
-- rather than as a card, and 'both' covers the case where the text carries the mention and
-- the embed carries the detail.
ALTER TABLE "BotAnnouncement" ADD COLUMN "format" TEXT NOT NULL DEFAULT 'embed';
-- An accent colour and a banner image, both optional. NULL keeps the per-kind colour the
-- bot already picks, so nothing changes for a row that does not set one.
ALTER TABLE "BotAnnouncement" ADD COLUMN "color" TEXT;
ALTER TABLE "BotAnnouncement" ADD COLUMN "image" TEXT;

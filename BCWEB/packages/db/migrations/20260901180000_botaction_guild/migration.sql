-- B4 Phase 3: which guild a moderation action targets, so a successful one can be recorded in
-- that guild's ModerationLog. Additive + nullable — no data touched.
ALTER TABLE "BotAction" ADD COLUMN "guildId" TEXT;

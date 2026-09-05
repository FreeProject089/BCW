-- The bot's language per server (onboarding card / "/setup"): null = auto (the member's Discord locale).
ALTER TABLE "BotGuild" ADD COLUMN "language" TEXT;

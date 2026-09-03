-- B-econ Phase 2: per-user levelling / economy balances. One new table, fully additive, keyed
-- to the BCWEB account (XP only accrues once a Discord is linked). The bot reports raw activity
-- deltas; the API turns XP into a level and grants points. Settings live in bot.config.economy.

CREATE TABLE "UserEconomy" (
    "userId" TEXT NOT NULL,
    "xp" INTEGER NOT NULL DEFAULT 0,
    "level" INTEGER NOT NULL DEFAULT 0,
    "points" INTEGER NOT NULL DEFAULT 0,
    "voiceSeconds" INTEGER NOT NULL DEFAULT 0,
    "messages" INTEGER NOT NULL DEFAULT 0,
    "reactions" INTEGER NOT NULL DEFAULT 0,
    "statsPublic" BOOLEAN,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserEconomy_pkey" PRIMARY KEY ("userId")
);

CREATE INDEX "UserEconomy_level_idx" ON "UserEconomy"("level");

ALTER TABLE "UserEconomy" ADD CONSTRAINT "UserEconomy_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

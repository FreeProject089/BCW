-- The 404 leaderboard runs in monthly seasons, and a finished season awards a podium.
--
-- Existing rows are backfilled from the month they were last updated in, NOT from today:
-- stamping every historical score with the current month would hand the current season to
-- whoever happened to play in March, and the podium is decided from exactly this column.

ALTER TABLE "GameScore" ADD COLUMN "season" TEXT NOT NULL DEFAULT '';
UPDATE "GameScore" SET "season" = to_char("updatedAt" AT TIME ZONE 'UTC', 'YYYY-MM') WHERE "season" = '';

-- One best score per player per game PER SEASON.
DROP INDEX IF EXISTS "GameScore_userId_game_key";
CREATE UNIQUE INDEX "GameScore_userId_game_season_key" ON "GameScore"("userId", "game", "season");

DROP INDEX IF EXISTS "GameScore_game_score_idx";
CREATE INDEX "GameScore_game_season_score_idx" ON "GameScore"("game", "season", "score");

CREATE TABLE "GameAward" (
    "id" TEXT NOT NULL,
    "game" TEXT NOT NULL DEFAULT 'orbfall',
    "season" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "percentOff" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameAward_pkey" PRIMARY KEY ("id")
);

-- What makes awarding idempotent: the sweeper runs on boot and hourly, and the second run
-- must not mint a second code for the same podium place.
CREATE UNIQUE INDEX "GameAward_game_season_rank_key" ON "GameAward"("game", "season", "rank");
CREATE INDEX "GameAward_userId_idx" ON "GameAward"("userId");

-- A code can require a long term OR a big enough basket. See promoMeetsMinimum().
ALTER TABLE "PromoCode" ADD COLUMN "minAmountCents" INTEGER;

-- Member roles, so the admin screen can show what somebody IS before deciding what to do
-- about them. Names, not ids: a moderator cannot resolve a snowflake.
ALTER TABLE "DiscordActivity" ADD COLUMN "roles" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "DiscordActivity" ADD COLUMN "nickname" TEXT;

-- The moderation queue. The API cannot reach into Discord; the bot polls for work and reports
-- back, which is how every other bot feature here already works.
CREATE TABLE "BotAction" (
    "id"               TEXT NOT NULL,
    "kind"             TEXT NOT NULL,
    "discordId"        TEXT NOT NULL,
    "targetLabel"      TEXT NOT NULL DEFAULT '',
    "reason"           TEXT NOT NULL DEFAULT '',
    "minutes"          INTEGER,
    "requestedById"    TEXT,
    "requestedByLabel" TEXT NOT NULL DEFAULT '',
    "status"           TEXT NOT NULL DEFAULT 'pending',
    "error"            TEXT,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attemptedAt"      TIMESTAMP(3),

    CONSTRAINT "BotAction_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BotAction_status_createdAt_idx" ON "BotAction"("status", "createdAt");
CREATE INDEX "BotAction_discordId_idx" ON "BotAction"("discordId");

-- The requester may leave; the record of what they asked for stays.
ALTER TABLE "BotAction" ADD CONSTRAINT "BotAction_requestedById_fkey"
    FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

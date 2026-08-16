-- Editorial announcements the bot should post: events, promotions, commission requests,
-- incidents. Queued for the same reason as BotAction — the API cannot reach Discord.
CREATE TABLE "BotAnnouncement" (
    "id"        TEXT NOT NULL,
    "kind"      TEXT NOT NULL,
    "title"     TEXT NOT NULL,
    "body"      TEXT NOT NULL DEFAULT '',
    "channelId" TEXT,
    "url"       TEXT,
    "urgent"    BOOLEAN NOT NULL DEFAULT false,
    "status"    TEXT NOT NULL DEFAULT 'pending',
    "error"     TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt"    TIMESTAMP(3),

    CONSTRAINT "BotAnnouncement_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "BotAnnouncement_status_createdAt_idx" ON "BotAnnouncement"("status", "createdAt");

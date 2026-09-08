-- "Tell me when there is room": a visitor turned away by a full disk, and how to reach them.
CREATE TABLE "HostingWaitlist" (
    "id"         TEXT NOT NULL,
    "email"      TEXT NOT NULL,
    "userId"     TEXT,
    "wantedGB"   INTEGER NOT NULL,
    "freeTier"   BOOLEAN NOT NULL DEFAULT false,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notifiedAt" TIMESTAMP(3),

    CONSTRAINT "HostingWaitlist_pkey" PRIMARY KEY ("id")
);

-- One open request per address per size: asking three times is one person waiting.
CREATE UNIQUE INDEX "HostingWaitlist_email_wantedGB_freeTier_key" ON "HostingWaitlist"("email", "wantedGB", "freeTier");
-- The sweeper reads "who is still waiting, and for how much" on every tick.
CREATE INDEX "HostingWaitlist_notifiedAt_wantedGB_idx" ON "HostingWaitlist"("notifiedAt", "wantedGB");
CREATE INDEX "HostingWaitlist_userId_idx" ON "HostingWaitlist"("userId");

-- Who wants telling when something breaks. Double opt-in for e-mail; a Discord channel needs no
-- confirmation because only an admin can add one.
CREATE TABLE "StatusSubscriber" (
    "id"           TEXT NOT NULL,
    "kind"         TEXT NOT NULL DEFAULT 'email',
    "target"       TEXT NOT NULL,
    "deps"         TEXT[] DEFAULT ARRAY[]::TEXT[],
    "confirmed"    BOOLEAN NOT NULL DEFAULT false,
    "confirmToken" TEXT,
    "token"        TEXT NOT NULL,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSentAt"   TIMESTAMP(3),

    CONSTRAINT "StatusSubscriber_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StatusSubscriber_confirmToken_key" ON "StatusSubscriber"("confirmToken");
CREATE UNIQUE INDEX "StatusSubscriber_token_key" ON "StatusSubscriber"("token");
CREATE UNIQUE INDEX "StatusSubscriber_kind_target_key" ON "StatusSubscriber"("kind", "target");
CREATE INDEX "StatusSubscriber_confirmed_idx" ON "StatusSubscriber"("confirmed");

-- What a human says about an outage, kept apart from the detection of it: the outage is found
-- by a probe, this is written afterwards, and merging them would leave automatic rows carrying
-- empty prose with no way to tell "unexplained" from "nothing to say".
CREATE TABLE "IncidentNote" (
    "id"          TEXT NOT NULL,
    "outageId"    TEXT NOT NULL,
    "state"       TEXT NOT NULL DEFAULT 'investigating',
    "body"        TEXT NOT NULL,
    "publicNote"  BOOLEAN NOT NULL DEFAULT true,
    "authorId"    TEXT,
    "authorLabel" TEXT NOT NULL DEFAULT '',
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncidentNote_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "IncidentNote_outageId_createdAt_idx" ON "IncidentNote"("outageId", "createdAt");
ALTER TABLE "IncidentNote" ADD CONSTRAINT "IncidentNote_outageId_fkey"
    FOREIGN KEY ("outageId") REFERENCES "ServiceOutage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

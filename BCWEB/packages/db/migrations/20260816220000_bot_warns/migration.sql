-- A warning given to a Discord member, and the reason for it. Not an action: nothing happens
-- to the member when one is written. The value is the COUNT (three mean something the third
-- does not mean alone) and the REASON, because a warning nobody can quote is one nobody can
-- appeal.
--
-- A revoked warning is kept, never deleted: "withdrawn on the 4th" is part of the record, and
-- a count that silently drops rows makes an escalation impossible to explain afterwards.
CREATE TABLE "BotWarn" (
    "id"            TEXT NOT NULL,
    "discordId"     TEXT NOT NULL,
    "targetLabel"   TEXT NOT NULL DEFAULT '',
    "reason"        TEXT NOT NULL,
    "guildId"       TEXT,
    "issuedById"    TEXT,
    "issuedByLabel" TEXT NOT NULL DEFAULT '',
    "triggered"     TEXT,
    "revokedAt"     TIMESTAMP(3),
    "revokedById"   TEXT,
    "revokedReason" TEXT,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BotWarn_pkey" PRIMARY KEY ("id")
);

-- The count query: active warnings for one member.
CREATE INDEX "BotWarn_discordId_revokedAt_idx" ON "BotWarn"("discordId", "revokedAt");
CREATE INDEX "BotWarn_createdAt_idx" ON "BotWarn"("createdAt");

-- SetNull, not Cascade: the staff member who issued a warning may close their account, and
-- the warning must survive them. Their name is already copied into issuedByLabel for exactly
-- that reason.
ALTER TABLE "BotWarn" ADD CONSTRAINT "BotWarn_issuedById_fkey"
    FOREIGN KEY ("issuedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

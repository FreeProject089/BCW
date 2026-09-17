-- Confirming your e-mail address becomes part of creating an account, and a sign-in from
-- somewhere new becomes something you can be told about.
--
-- SHAPE
--
-- User.verifyDeadline   — when an unconfirmed password sign-up stops being an account.
--                         NULLABLE with no default, and that is the whole safety of this
--                         migration: every row that already exists gets NULL, and the sweeper
--                         only ever looks at rows where it is SET. So no account that predates
--                         this rule can be touched by it, and an OAuth account (whose provider
--                         already proved the address) never gets one either. Only
--                         /auth/register sets it.
-- User.verifyRemindedAt — stamped when the single day-7 reminder goes out, so it goes out once
--                         rather than on every ten-minute sweeper tick.
--
-- LoginAlert            — one row per sign-in notice actually raised. It exists to answer
--                         "have we already told them this?", which is the difference between
--                         an alert worth reading and a mail every time a phone changes cell.
--                         The dedup key is the second index: (user, reason, fingerprint, time).
--                         `fingerprint` is browser|os|device lowercased, NOT the IP — an IP
--                         changes several times a day without anybody going anywhere.
--                         `sessionId` is a plain column with no foreign key on purpose: the
--                         session sweeper prunes device rows long before these are pruned, and
--                         a cascade would delete the record of the warning at exactly the
--                         moment somebody goes looking for what happened. The userId FK does
--                         cascade — an account that is gone has no alerts to read.
--
-- Additive throughout: two nullable columns and one new table. Nothing is rewritten and
-- nothing is dropped, so it is safe to apply to a live database.

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "verifyDeadline" TIMESTAMP(3),
ADD COLUMN     "verifyRemindedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "LoginAlert" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "country" TEXT,
    "ip" TEXT,
    "sessionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LoginAlert_userId_createdAt_idx" ON "LoginAlert"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "LoginAlert_userId_reason_fingerprint_createdAt_idx" ON "LoginAlert"("userId", "reason", "fingerprint", "createdAt");

-- AddForeignKey
ALTER TABLE "LoginAlert" ADD CONSTRAINT "LoginAlert_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


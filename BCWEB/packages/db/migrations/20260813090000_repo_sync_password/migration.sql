-- Optional download password on a hosted repo, argon2 hash. NULL = no password, which is
-- what BMM's own mini-server means by a blank one, so an existing repo keeps behaving
-- exactly as it does today.
--
-- Hashed rather than stored in clear: it is a user-chosen secret. The read path pays
-- argon2 once per client per window and caches the verdict in memory, because BMM sends
-- the password on every file request and a sync is hundreds of them.

-- AlterTable
ALTER TABLE "ServerRepo" ADD COLUMN "syncPasswordHash" TEXT;

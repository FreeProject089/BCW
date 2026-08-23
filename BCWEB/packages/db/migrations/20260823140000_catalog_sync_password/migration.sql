-- Optional download password for a community catalog, argon2 hash.
-- Null / empty = no password, matching ServerRepo.syncPasswordHash and BMM's own
-- mini-server, both of which treat a blank password as "not required".
ALTER TABLE "CommunityCatalog" ADD COLUMN "syncPasswordHash" TEXT;

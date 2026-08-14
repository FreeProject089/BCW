-- The Project row itself, in a SEPARATE migration from the enum value.
--
-- Postgres refuses to use a new enum value in the same transaction that added it ("unsafe
-- use of new value"), and Prisma runs each migration file in one transaction. Two files is
-- not tidiness here, it is the only order that applies.
--
-- Created by migration rather than by the seed so the space exists on a production database
-- that will never run the seed again.
INSERT INTO "Project" ("id", "key", "name", "showOnHomeNews", "showBlogTab")
SELECT 'proj_developers', 'developers', 'Developers', false, true
WHERE NOT EXISTS (SELECT 1 FROM "Project" WHERE "key" = 'developers');

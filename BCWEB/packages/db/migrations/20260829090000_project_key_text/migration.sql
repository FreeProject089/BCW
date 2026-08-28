-- Adding an official project required a schema migration, because `Project.key` was an enum.
--
-- A ShowcaseProject already gives a custom page a name, an icon, a blog and a visibility
-- gate. What it cannot be is the target of a CatalogItem or of a projectKey permission grant
-- — those point at Project — so "add an official project" meant editing the enum, writing a
-- migration and deploying. That is not something an admin screen can do.
--
-- USING key::text on each column first, then the type: dropping an enum still referenced by a
-- column fails, and the cast is free because every existing value is already one of the five
-- names.
ALTER TABLE "Project" ALTER COLUMN "key" TYPE TEXT USING "key"::text;
ALTER TABLE "BlogPermission" ALTER COLUMN "projectKey" TYPE TEXT USING "projectKey"::text;
ALTER TABLE "ProjectPermission" ALTER COLUMN "projectKey" TYPE TEXT USING "projectKey"::text;
DROP TYPE "ProjectKey";

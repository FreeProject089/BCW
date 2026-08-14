-- Which notification categories an account has switched off.
--
-- { "hosting": false } — absent means enabled, so a category added later starts on for
-- everybody and nobody has to opt in to hearing about their own repositories. JSON rather
-- than a table because it is a handful of booleans read on every notification write; a join
-- there would be a cost paid thousands of times to store six values.
ALTER TABLE "User" ADD COLUMN "notifPrefs" JSONB;

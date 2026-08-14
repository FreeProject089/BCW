-- Calls made from the developer console's sandbox.
--
-- They authenticate and are scope-checked like any other call — a console that skipped those
-- would teach people an API that does not exist — but they write nothing. Flagged so they
-- can be told apart from real traffic: somebody exploring the API should not show up in the
-- usage figures as a customer hammering it.
ALTER TABLE "ApiRequest" ADD COLUMN "sandbox" BOOLEAN NOT NULL DEFAULT false;

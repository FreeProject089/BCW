-- What the account's content looked like before a pending closure suspended it.
--
-- During the grace period nothing is deleted: repositories, catalogs and catalog items are
-- SUSPENDED, so the account stops serving while it is on its way out and nothing is lost if
-- it changes its mind. Cancelling then has to put each one back where it WAS — a repo that
-- was OFFLINE returns to OFFLINE, not to ONLINE — and that is only possible if the previous
-- state was recorded. It is recorded here.
ALTER TABLE "User" ADD COLUMN "closureSuspendState" JSONB;

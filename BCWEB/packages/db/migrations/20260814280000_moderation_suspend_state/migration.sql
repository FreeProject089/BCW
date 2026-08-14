-- What an account's content looked like before a MODERATION suspension froze it.
--
-- Separate from closureSuspendState because the two events can overlap: an account can be
-- suspended and then scheduled for closure, and a single field would let the second event
-- overwrite the first's memory of the original state — so lifting the suspension would
-- restore whatever the closure happened to see rather than what was really there.
ALTER TABLE "User" ADD COLUMN "moderationSuspendState" JSONB;

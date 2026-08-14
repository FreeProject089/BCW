-- Whether the account holder may call a scheduled closure off.
--
-- True for anything they asked for themselves — that is the whole point of the grace month.
-- Staff choose per closure: one meant as a sanction that the target undoes with a click is
-- not a sanction, and an irreversible one should be a deliberate choice rather than a side
-- effect of who pressed the button. When false, no cancel token is minted at all: an email
-- carrying a link that refuses to work is worse than an email carrying no link.
ALTER TABLE "User" ADD COLUMN "closureCancellable" BOOLEAN NOT NULL DEFAULT true;

-- A declined transfer can carry the recipient's reason, so the sender is told "no, because"
-- rather than just "no". Empty for every other status.
ALTER TABLE "OwnershipTransfer" ADD COLUMN "reason" TEXT NOT NULL DEFAULT '';

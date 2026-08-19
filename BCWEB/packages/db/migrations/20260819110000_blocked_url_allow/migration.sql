-- An allow entry: an exception that beats every block entry, whichever is more specific.
-- Not a specificity contest, because a rule you cannot predict is one nobody dares use.

-- AlterTable
ALTER TABLE "BlockedUrl" ADD COLUMN     "allow" BOOLEAN NOT NULL DEFAULT false;


-- Re-acceptance of a changed policy.
--
-- requiresAcceptance is deliberately separate from merely notifying: telling everyone is
-- cheap and usually right, while demanding agreement again interrupts every single user and
-- is only right when the change actually alters what they agreed to.

-- AlterTable
ALTER TABLE "LegalVersion" ADD COLUMN     "requiresAcceptance" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "legalAcceptedAt" TIMESTAMP(3);


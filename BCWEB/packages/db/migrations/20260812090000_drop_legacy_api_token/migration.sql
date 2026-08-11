-- The legacy single-token system never reached production; nothing depends on these.
-- DropIndex
DROP INDEX "User_apiToken_key";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "apiToken",
DROP COLUMN "apiTokenCreatedAt";

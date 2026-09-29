-- assetskey (agent-assets-key): the CI publish key for platform-asset slots.
-- ApiKey.assetSlots binds an `assets:publish` key to named slots; PlatformAsset.sha256 records
-- the verified hash of the stored file. Additive, defaulted/nullable: safe for a rolling deploy.

-- AlterTable
ALTER TABLE "ApiKey" ADD COLUMN     "assetSlots" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "PlatformAsset" ADD COLUMN     "sha256" TEXT;

-- Anyone can register an OAuth client now, so a client needs an owner and a review flag.
--
-- ownerId null = created by staff, which is what every existing client is. `verified` does
-- NOT gate whether the client works: refusing to sign people in until a human looks would
-- make self-service registration pointless. It gates what the CONSENT SCREEN says — "which
-- app is this, really" is the question that screen exists to answer, and anyone can type
-- any name into a registration form.
ALTER TABLE "OAuthClient" ADD COLUMN "ownerId" TEXT;
ALTER TABLE "OAuthClient" ADD COLUMN "verified" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "OAuthClient" ADD COLUMN "description" TEXT NOT NULL DEFAULT '';
ALTER TABLE "OAuthClient" ADD COLUMN "homepageUrl" TEXT;

CREATE INDEX "OAuthClient_ownerId_idx" ON "OAuthClient"("ownerId");

ALTER TABLE "OAuthClient" ADD CONSTRAINT "OAuthClient_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Every client that existed before this was created by staff, and staff-created clients are
-- the ones we can vouch for.
UPDATE "OAuthClient" SET "verified" = true WHERE "ownerId" IS NULL;

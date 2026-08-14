-- auth_time, carried from /authorize to the ID token minted at /token.
--
-- A client that sends `max_age` will validate `auth_time` on the way back. Without this
-- column the claim cannot be populated, so the provider looks fine until the first client
-- that actually checks it rejects every token we issue.
--
-- Nullable: authorization codes created before this simply have no recorded time, and a
-- missing auth_time is the correct answer there rather than a guess.

-- AlterTable
ALTER TABLE "OAuthCode" ADD COLUMN "authTime" INTEGER;

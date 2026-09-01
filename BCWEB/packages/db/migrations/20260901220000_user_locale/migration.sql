-- B9 Phase 5: persist a user's preferred UI language so it follows the account across devices.
-- Additive + nullable; null means "no account preference, use the browser choice".
ALTER TABLE "User" ADD COLUMN "locale" TEXT;

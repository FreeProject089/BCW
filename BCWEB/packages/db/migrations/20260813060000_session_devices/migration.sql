-- Signed-in devices. Auth stays stateless (a JWT in bcw_session); this row is what the
-- token's `sid` claim points at, so the owner can see their sessions and revoke one
-- device without rotating anything global.
--
-- Geo is denormalized on purpose: it is resolved once at sign-in, must survive a later
-- GeoIP database update, and re-resolving per read would turn listing into a batch of
-- lookups.

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "device" TEXT,
    "browser" TEXT,
    "os" TEXT,
    "country" TEXT,
    "region" TEXT,
    "city" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- The list query is always "this user's live sessions".
CREATE INDEX "Session_userId_revokedAt_idx" ON "Session"("userId", "revokedAt");

-- CreateIndex
-- The sweeper prunes by age.
CREATE INDEX "Session_lastSeenAt_idx" ON "Session"("lastSeenAt");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

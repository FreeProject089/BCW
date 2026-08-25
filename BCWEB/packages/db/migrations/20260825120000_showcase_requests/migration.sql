-- A way in to the "Other projects" grid.
--
-- The showcase was admin-only: the pages existed, the grid rendered them, and there was no
-- way to ask from outside. This is the request, and it is always REVIEWED — including a paid
-- one. Paying buys a place in the queue, never a listing; a page that appears because money
-- arrived is an advert, and the grid stops meaning anything the moment it holds one.
--
-- `slug` is NOT unique here. It is what the applicant proposes, two people may well propose
-- the same one, and both deserve an answer — uniqueness belongs to ShowcaseProject, which is
-- checked at approval.
CREATE TABLE "ShowcaseRequest" (
    "id"          TEXT NOT NULL,
    "userId"      TEXT NOT NULL,
    "slug"        TEXT NOT NULL,
    "name"        TEXT NOT NULL,
    "short"       TEXT NOT NULL,
    "url"         TEXT NOT NULL DEFAULT '',
    "icon"        TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "pitch"       TEXT NOT NULL DEFAULT '',
    "status"      TEXT NOT NULL DEFAULT 'pending',
    "paid"        BOOLEAN NOT NULL DEFAULT false,
    "paidCents"   INTEGER NOT NULL DEFAULT 0,
    "currency"    TEXT NOT NULL DEFAULT 'usd',
    "reviewNote"  TEXT NOT NULL DEFAULT '',
    "reviewedAt"  TIMESTAMP(3),
    "reviewerId"  TEXT,
    "projectId"   TEXT,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ShowcaseRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ShowcaseRequest_userId_idx" ON "ShowcaseRequest"("userId");
CREATE INDEX "ShowcaseRequest_status_idx" ON "ShowcaseRequest"("status");

-- CASCADE: a deleted account takes its requests with it. There is no state where the person
-- is gone and their pitch is still sitting in a moderation queue.
ALTER TABLE "ShowcaseRequest" ADD CONSTRAINT "ShowcaseRequest_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Appended last so every existing Payment row keeps its ordinal.
ALTER TYPE "PaymentKind" ADD VALUE IF NOT EXISTS 'SHOWCASE_LISTING';

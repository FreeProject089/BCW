-- Live traffic for catalogues and for storage pools.
--
-- WHY A TABLE AND NOT A COUNTER
--
-- A community catalog already counted `views` and `downloads`, and a lifetime counter can
-- answer "how popular is this" but never "who is pulling this right now" — which is the
-- question the repo traffic view answers (RepoAccessEvent, 15-minute feed + 24h rollup) and
-- the one now being asked of catalogues and of the pools that hold them. A pool holds repos
-- AND catalogues, so a pool-level answer that only knew about repos would be wrong in the
-- direction nobody checks: it would look right, and quietly under-report.
--
-- WHAT IS DELIBERATELY ABSENT
--
-- RepoAccessEvent stores `accessKey` — the repo's ?key= sandbox key, which its owner hands
-- out and wants to read back in their own dashboard. A catalogue's equivalent, ?k=, is its
-- PRIVATE SHARE LINK: a bearer secret whose entire value is that it is not written down
-- anywhere readable. So this table has no column for it. `keyed` records only THAT a valid
-- share key was presented (decided with a constant-time compare), never which one.
-- Likewise `path` holds a stored relative path ('catalog.json', or an item slug) and never
-- a request URL, because a URL carries the query string and the query string is the secret
-- (CWE-532).
--
-- THE TWO INDEXES
--
-- (catalogId, createdAt) serves one catalogue's own view. (createdAt) serves the pool and
-- global views, which ask for a time window across many subjects and cannot use the
-- composite one at all. The same index is added to RepoAccessEvent, where the identical
-- query — /admin/repos/traffic's "last 15 minutes across every repo" — has been doing a
-- sequential scan since it was written.
--
-- Purely additive: one new table and two new indexes. Nothing is rewritten, nothing is
-- dropped, and no existing row is touched, so it is safe to apply to a live database.

-- CreateTable
CREATE TABLE "CatalogAccessEvent" (
    "id" TEXT NOT NULL,
    "catalogId" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "keyed" BOOLEAN NOT NULL DEFAULT false,
    "userId" TEXT,
    "discordId" TEXT,
    "path" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CatalogAccessEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CatalogAccessEvent_catalogId_createdAt_idx" ON "CatalogAccessEvent"("catalogId", "createdAt");

-- CreateIndex
CREATE INDEX "CatalogAccessEvent_createdAt_idx" ON "CatalogAccessEvent"("createdAt");

-- CreateIndex
CREATE INDEX "RepoAccessEvent_createdAt_idx" ON "RepoAccessEvent"("createdAt");

-- AddForeignKey
-- ON DELETE CASCADE: a deleted catalogue has no traffic to read, and leaving orphan rows
-- behind would block the delete the moment anyone had ever fetched the feed.
ALTER TABLE "CatalogAccessEvent" ADD CONSTRAINT "CatalogAccessEvent_catalogId_fkey" FOREIGN KEY ("catalogId") REFERENCES "CommunityCatalog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

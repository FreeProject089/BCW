-- A community catalog can say which Better* app it is for.
--
-- Needed because a client has to be able to ignore catalogs meant for something else, and
-- there was nothing to decide that on: the model had `kinds` (app/plugin/theme/preset)
-- but no notion of WHICH application those belong to. A BSM theme catalog and a BMM theme
-- catalog were indistinguishable in the feed.
--
-- Nullable, and no backfill. Every catalog that exists predates this column, so any value
-- written now would be a guess — and a guess here means a client silently filtering out a
-- catalog that was fine, or pulling in one that is not for it. The feed omits the field
-- when it is null rather than defaulting it, and the owner can set it.
--
-- ON DELETE SET NULL: removing a project must not cascade into deleting people's
-- catalogs. Losing the label is recoverable; losing the catalog is not.
ALTER TABLE "CommunityCatalog" ADD COLUMN "projectId" TEXT;

ALTER TABLE "CommunityCatalog"
  ADD CONSTRAINT "CommunityCatalog_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The feed filters by (project, listed, status) on every request, and the index browser
-- filters by project alone.
CREATE INDEX "CommunityCatalog_projectId_idx" ON "CommunityCatalog"("projectId");

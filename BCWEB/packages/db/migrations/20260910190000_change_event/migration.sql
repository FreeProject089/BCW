-- The history of a repo, a catalogue or a storage pool.
--
-- There was a per-repo audit log already, and it had the weakness every audit log has: a
-- free-text `detail`, so the most common row on the platform read "sandbox settings updated".
-- True, useless, and unanswerable — somebody reading it wants to know WHICH setting and what it
-- was before. `changes` holds that: [{ field, from, to }], built by diffFields() in
-- lib/changelog.mjs, which is also the single place deciding what may never appear in it.
--
-- Three nullable subject columns rather than a polymorphic (type, id) pair, so the foreign keys
-- are real and deleting a repo takes its history with it instead of leaving orphans nothing
-- will ever clean up.
CREATE TABLE "ChangeEvent" (
    "id"         TEXT NOT NULL,
    "repoId"     TEXT,
    "catalogId"  TEXT,
    "groupId"    TEXT,
    "actorId"    TEXT,
    -- Frozen at write time. Joining the display name on read would rename a person
    -- retroactively through the whole history the day they change it.
    "actorLabel" TEXT NOT NULL DEFAULT '',
    "action"     TEXT NOT NULL,
    "summary"    TEXT NOT NULL DEFAULT '',
    "changes"    JSONB,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChangeEvent_pkey" PRIMARY KEY ("id")
);

-- Every read is "the history of ONE subject, newest first", so each subject gets that index.
CREATE INDEX "ChangeEvent_repoId_createdAt_idx"    ON "ChangeEvent"("repoId", "createdAt");
CREATE INDEX "ChangeEvent_catalogId_createdAt_idx" ON "ChangeEvent"("catalogId", "createdAt");
CREATE INDEX "ChangeEvent_groupId_createdAt_idx"   ON "ChangeEvent"("groupId", "createdAt");

ALTER TABLE "ChangeEvent" ADD CONSTRAINT "ChangeEvent_repoId_fkey"
    FOREIGN KEY ("repoId") REFERENCES "ServerRepo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChangeEvent" ADD CONSTRAINT "ChangeEvent_catalogId_fkey"
    FOREIGN KEY ("catalogId") REFERENCES "CommunityCatalog"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChangeEvent" ADD CONSTRAINT "ChangeEvent_groupId_fkey"
    FOREIGN KEY ("groupId") REFERENCES "HostingGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Exactly one subject, for the same reason CustomDomain has the equivalent: a row pointing at
-- two things, or at none, forces every reader downstream to invent an answer for what it means.
ALTER TABLE "ChangeEvent" ADD CONSTRAINT "ChangeEvent_one_subject"
    CHECK ((("repoId" IS NOT NULL)::int + ("catalogId" IS NOT NULL)::int + ("groupId" IS NOT NULL)::int) = 1);

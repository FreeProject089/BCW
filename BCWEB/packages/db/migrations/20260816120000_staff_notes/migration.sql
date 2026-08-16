-- Staff notes about an account, and the record of why one was closed or erased.
--
-- subjectId carries NO foreign key on purpose: a note explaining why somebody was removed is
-- the note you need after they are gone, and a cascade would delete it at exactly that moment.
CREATE TABLE "StaffNote" (
    "id"           TEXT NOT NULL,
    "subjectId"    TEXT NOT NULL,
    "subjectLabel" TEXT NOT NULL DEFAULT '',
    "kind"         TEXT NOT NULL DEFAULT 'note',
    "body"         TEXT NOT NULL,
    "notified"     BOOLEAN NOT NULL DEFAULT false,
    "notifiedTo"   TEXT,
    "authorId"     TEXT,
    "authorLabel"  TEXT NOT NULL DEFAULT '',
    "pinned"       BOOLEAN NOT NULL DEFAULT false,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffNote_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StaffNote_subjectId_createdAt_idx" ON "StaffNote"("subjectId", "createdAt");
CREATE INDEX "StaffNote_kind_idx" ON "StaffNote"("kind");

-- The author MAY go; the note stays and keeps `authorLabel`.
ALTER TABLE "StaffNote" ADD CONSTRAINT "StaffNote_authorId_fkey"
    FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

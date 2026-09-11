-- Rights notices and protected works.
--
-- A rights-holder notice used to arrive as a contact message of kind "copyright" -- free text,
-- no target, no work, no way to act on it except by hand. It is a record now, with every
-- element the legal page promises to act on and a queue of its own; and the works it names
-- can be registered so the same file is caught the next time it lands (Swiss CopA 39d).
CREATE TABLE "ProtectedWork" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "owner" TEXT NOT NULL DEFAULT '',
    "contact" TEXT NOT NULL DEFAULT '',
    "urls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "hashes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "patterns" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "hits" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProtectedWork_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RightsNotice" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'copyright',
    "status" TEXT NOT NULL DEFAULT 'new',
    "reporterId" TEXT,
    "name" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "org" TEXT NOT NULL DEFAULT '',
    "onBehalfOf" TEXT NOT NULL DEFAULT 'owner',
    "address" TEXT NOT NULL DEFAULT '',
    "country" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "targets" JSONB NOT NULL DEFAULT '[]',
    "work" JSONB NOT NULL DEFAULT '{}',
    "explanation" TEXT NOT NULL DEFAULT '',
    "goodFaith" BOOLEAN NOT NULL DEFAULT false,
    "accurate" BOOLEAN NOT NULL DEFAULT false,
    "signature" TEXT NOT NULL DEFAULT '',
    "ip" TEXT NOT NULL DEFAULT '',
    "reviewedById" TEXT,
    "decision" TEXT NOT NULL DEFAULT '',
    "decisionAt" TIMESTAMP(3),
    "internalNote" TEXT NOT NULL DEFAULT '',
    "sanctionIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ownerIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "counter" JSONB,
    "restoredAt" TIMESTAMP(3),
    "workId" TEXT,
    "matchVia" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RightsNotice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RightsNotice_code_key" ON "RightsNotice"("code");
CREATE INDEX "RightsNotice_status_createdAt_idx" ON "RightsNotice"("status", "createdAt");
CREATE INDEX "RightsNotice_reporterId_idx" ON "RightsNotice"("reporterId");
CREATE INDEX "RightsNotice_email_idx" ON "RightsNotice"("email");
CREATE INDEX "RightsNotice_workId_idx" ON "RightsNotice"("workId");

ALTER TABLE "ProtectedWork" ADD CONSTRAINT "ProtectedWork_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RightsNotice" ADD CONSTRAINT "RightsNotice_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RightsNotice" ADD CONSTRAINT "RightsNotice_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RightsNotice" ADD CONSTRAINT "RightsNotice_workId_fkey" FOREIGN KEY ("workId") REFERENCES "ProtectedWork"("id") ON DELETE SET NULL ON UPDATE CASCADE;

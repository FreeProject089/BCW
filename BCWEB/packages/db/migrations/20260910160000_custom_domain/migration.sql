-- A hostname the owner controls, served by us.
--
-- A row here is permission to spend a real resource on somebody else's name: the edge asks us
-- before obtaining a TLS certificate for a host, so "is this allowed" has to be answerable
-- from one place and has to stay answerable as things lapse. Hence proof of control (a TXT
-- record at _bcw-verify.<host>) before verifiedAt is set, and a paid pool as the product gate.
--
-- repoId and catalogId are both nullable and both UNIQUE: exactly one is set, and the database
-- enforces "one domain per repo" / "one per catalogue" itself rather than trusting every
-- writer to remember.
CREATE TABLE "CustomDomain" (
    "id"            TEXT NOT NULL,
    "host"          TEXT NOT NULL,
    "ownerId"       TEXT NOT NULL,
    "repoId"        TEXT,
    "catalogId"     TEXT,
    "verifyToken"   TEXT NOT NULL,
    "verifiedAt"    TIMESTAMP(3),
    "lastCheckedAt" TIMESTAMP(3),
    "lastError"     TEXT,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomDomain_pkey" PRIMARY KEY ("id")
);

-- The host is looked up on every request that arrives on a name we do not recognise, so it is
-- the hot index as well as the uniqueness rule: two accounts must never both hold one name.
CREATE UNIQUE INDEX "CustomDomain_host_key" ON "CustomDomain"("host");
CREATE UNIQUE INDEX "CustomDomain_repoId_key" ON "CustomDomain"("repoId");
CREATE UNIQUE INDEX "CustomDomain_catalogId_key" ON "CustomDomain"("catalogId");
CREATE INDEX "CustomDomain_ownerId_idx" ON "CustomDomain"("ownerId");

ALTER TABLE "CustomDomain" ADD CONSTRAINT "CustomDomain_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomDomain" ADD CONSTRAINT "CustomDomain_repoId_fkey"
    FOREIGN KEY ("repoId") REFERENCES "ServerRepo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomDomain" ADD CONSTRAINT "CustomDomain_catalogId_fkey"
    FOREIGN KEY ("catalogId") REFERENCES "CommunityCatalog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Exactly one subject. Without this a row can point at both a repo and a catalogue, or at
-- neither, and every reader downstream has to invent its own answer for what that means.
ALTER TABLE "CustomDomain" ADD CONSTRAINT "CustomDomain_one_subject"
    CHECK (("repoId" IS NOT NULL AND "catalogId" IS NULL) OR ("repoId" IS NULL AND "catalogId" IS NOT NULL));

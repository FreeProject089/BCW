-- A server the repo's OWNER runs, allowed to talk to us on that repo's behalf.
--
-- The request was "let me manage a repo on another server from BCWEB", whose obvious shape is
-- an SSH key. We do not take one: a private key that opens a shell on somebody else's machine
-- is the worst asset to hold, because a breach here stops costing accounts and starts costing
-- our users their servers. The direction is reversed instead — their machine holds a bearer
-- token for US, hashed here the same way an ApiKey is, and can say "I am alive, here is what I
-- serve" and pick up a job the owner queued. Nothing in this table can reach into their box.
--
-- One row per repo on purpose (repoId UNIQUE): rotating replaces it, which is the entire
-- vocabulary an owner needs for one machine.
CREATE TABLE "RepoAgent" (
    "id"           TEXT NOT NULL,
    "repoId"       TEXT NOT NULL,
    "label"        TEXT NOT NULL DEFAULT '',
    "prefix"       TEXT NOT NULL,
    "hash"         TEXT NOT NULL,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt"    TIMESTAMP(3),
    "lastSeenAt"   TIMESTAMP(3),
    "lastIp"       TEXT,
    "agentVersion" TEXT,
    "hostLabel"    TEXT,
    "pendingCmd"   TEXT,
    "pendingAt"    TIMESTAMP(3),
    "reportedAt"   TIMESTAMP(3),
    "reportOk"     BOOLEAN NOT NULL DEFAULT false,
    "reportError"  TEXT,
    "fileCount"    INTEGER,
    "totalBytes"   BIGINT,
    "manifestSha"  TEXT,

    CONSTRAINT "RepoAgent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RepoAgent_repoId_key" ON "RepoAgent"("repoId");
-- Authentication looks the token up by hash on every agent call, so it is the hot index.
CREATE UNIQUE INDEX "RepoAgent_hash_key" ON "RepoAgent"("hash");

ALTER TABLE "RepoAgent" ADD CONSTRAINT "RepoAgent_repoId_fkey"
    FOREIGN KEY ("repoId") REFERENCES "ServerRepo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One encryption key per user, so a deletion request can reach the backups.
--
-- Row backups are git-committed JSON and git is append-only: a user deleted from the live
-- tables stays in every snapshot taken before that. Rewriting git history is not a fix —
-- it invalidates every hash, breaks every restore that referenced one, and has to be redone
-- on every clone.
--
-- So each user's backups are encrypted with their own key, and erasure is deleting the key:
-- exactly one person becomes unreadable, everybody else stays restorable, no hash moves,
-- and copies already synced elsewhere are ciphertext there too.
--
-- ON DELETE CASCADE is deliberate. A user row removed for real takes its key with it, which
-- is the erasure — there is no state where the account is gone and the key survives it.
CREATE TABLE "UserDataKey" (
    "userId"    TEXT NOT NULL,
    "key"       BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserDataKey_pkey" PRIMARY KEY ("userId")
);

ALTER TABLE "UserDataKey" ADD CONSTRAINT "UserDataKey_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

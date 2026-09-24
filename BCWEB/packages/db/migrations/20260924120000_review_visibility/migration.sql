-- N10: a member chooses a public or a private review, and whether it is signed.
ALTER TABLE "Review" ADD COLUMN "visibility" TEXT NOT NULL DEFAULT 'public';
ALTER TABLE "Review" ADD COLUMN "anonymous" BOOLEAN NOT NULL DEFAULT false;

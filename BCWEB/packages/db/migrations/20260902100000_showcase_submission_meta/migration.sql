-- Submission metadata for "Other projects" listing requests: open-source/licence, ownership
-- (rights-holder vs fan), private proof-of-rights for closed-source, terms acceptance, and the
-- linked contact thread.
ALTER TABLE "ShowcaseRequest" ADD COLUMN "isOpenSource" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "ShowcaseRequest" ADD COLUMN "license" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ShowcaseRequest" ADD COLUMN "ownership" TEXT NOT NULL DEFAULT 'owner';
ALTER TABLE "ShowcaseRequest" ADD COLUMN "proofKey" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ShowcaseRequest" ADD COLUMN "proofName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ShowcaseRequest" ADD COLUMN "tosAcceptedAt" TIMESTAMP(3);
ALTER TABLE "ShowcaseRequest" ADD COLUMN "contactReportId" TEXT;

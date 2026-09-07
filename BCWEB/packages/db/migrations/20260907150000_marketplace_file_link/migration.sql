-- Marketplace delivery: a file and a link.
--
-- `fileKey` holds the object-storage key, not a URL: the download is a short-lived signed link
-- minted per buyer, so what ends up in a purchase row is not a distributable address. `linkUrl`
-- is the plain-URL kind, which used to be a paragraph pasted into `content`.
ALTER TABLE "ProjectProduct" ADD COLUMN "fileKey" TEXT;
ALTER TABLE "ProjectProduct" ADD COLUMN "fileName" TEXT;
ALTER TABLE "ProjectProduct" ADD COLUMN "linkUrl" TEXT;

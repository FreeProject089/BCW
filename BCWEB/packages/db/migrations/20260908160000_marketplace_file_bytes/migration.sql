-- How much a product file weighs, so the marketplace can be metered like everything else.
ALTER TABLE "ProjectProduct" ADD COLUMN "fileBytes" INTEGER;

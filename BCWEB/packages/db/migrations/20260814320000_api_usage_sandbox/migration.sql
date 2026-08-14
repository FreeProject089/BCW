-- Sandbox calls counted apart from real usage (never added to "count").
ALTER TABLE "ApiUsageDay" ADD COLUMN "sandbox" INTEGER NOT NULL DEFAULT 0;

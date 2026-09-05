-- A custom role may be limited to a set of projects / showcase pages (see CustomRole.scope).
ALTER TABLE "CustomRole" ADD COLUMN "scope" JSONB;

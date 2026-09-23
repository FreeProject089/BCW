-- PLAN-STUDIO-2026 phase 2: what a per-project grant allows. 'pages' (the old meaning) and/or
-- 'studio'. Existing rows take the default, so no grant that existed before gives the studio.
-- AlterTable
ALTER TABLE "ProjectPermission" ADD COLUMN     "rights" TEXT[] DEFAULT ARRAY['pages']::TEXT[];

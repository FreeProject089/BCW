-- B9 Phase 1: runtime-added languages. One new table, fully additive — the compiled en/fr
-- dictionaries are unaffected. An added locale is a partial override layer consulted by t();
-- untranslated keys fall back to English exactly as a missing translation already does.

CREATE TABLE "SiteLocale" (
    "code" TEXT NOT NULL,
    "nativeName" TEXT NOT NULL,
    "englishName" TEXT NOT NULL DEFAULT '',
    "rtl" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "strings" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteLocale_pkey" PRIMARY KEY ("code")
);

CREATE INDEX "SiteLocale_enabled_idx" ON "SiteLocale"("enabled");

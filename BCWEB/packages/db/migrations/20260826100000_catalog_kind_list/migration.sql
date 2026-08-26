-- Shared MOD LISTS (.mm) become a hostable catalog kind, like tutorials and modpacks before
-- them. A .mm is the oldest shareable thing BMM has — a named set of mods with their
-- addresses — and it was the last one with no catalogue of its own, so people passed them
-- around a file at a time.
--
-- ADD VALUE IF NOT EXISTS, appended: an enum value added at the end leaves every existing
-- row's ordinal alone.
ALTER TYPE "CatalogKind" ADD VALUE IF NOT EXISTS 'LIST';

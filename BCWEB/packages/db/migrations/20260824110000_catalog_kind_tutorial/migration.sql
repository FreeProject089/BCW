-- Interactive tutorials (.bmmtut) become a hostable catalog kind, like modpacks before
-- them: BMM's tutorial hub follows catalogues and installs from them.
ALTER TYPE "CatalogKind" ADD VALUE IF NOT EXISTS 'TUTORIAL';

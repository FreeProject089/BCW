-- agent-bcw-rules: the Project Policy (how "Other projects" are chosen) and two new built-in
-- legal documents (pools & payment links, the Discord bot). Their text ships in the web
-- bundle; these rows put them in the legal menu.

-- AlterTable
ALTER TABLE "ShowcaseRequest" ADD COLUMN     "causeNote" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "reviewChecks" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "sourceAccess" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "testsConsent" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "usesAi" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "usesBetterInstaller" BOOLEAN NOT NULL DEFAULT false;

INSERT INTO "LegalPage" ("id", "key", "label", "labelFr", "icon", "order", "builtIn", "updatedAt") VALUES
    ('lgp_projects', 'projects', 'Project Policy',          'Politique des projets',          'badge-check', 7, true, CURRENT_TIMESTAMP),
    ('lgp_pools',    'pools',    'Pools & payment links',   'Pools et liens de paiement',     'wallet',      8, true, CURRENT_TIMESTAMP),
    ('lgp_bot',      'bot',      'Discord bot terms',       'Conditions du bot Discord',      'bot',         9, true, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

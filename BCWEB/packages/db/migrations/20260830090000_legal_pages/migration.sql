-- Legal documents an admin can create, grouped into categories.
--
-- There were five, named in an array in the route file and again in the web bundle. That was
-- fine while a site was one product; it stopped being fine the moment several projects each
-- needed their own terms, because "add a sixth" meant editing two packages and shipping a
-- release, and there was nowhere at all to say which project a document belonged to.
--
-- `LegalSection.doc` is deliberately NOT turned into a foreign key here. It holds a key
-- (`privacy`, `terms`, …) and every existing row already holds a valid one; adding a
-- constraint would mean either rewriting live rows or refusing to migrate a database whose
-- sections were written before this table existed. The key stays the join, and deleting a
-- page deletes its sections explicitly rather than by cascade — see the route.

CREATE TABLE "LegalCategory" (
    "id"        TEXT NOT NULL,
    -- A slug, so a category can be linked to: /legal#bmm
    "key"       TEXT NOT NULL,
    "label"     TEXT NOT NULL,
    "labelFr"   TEXT,
    "order"     INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LegalCategory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LegalCategory_key_key" ON "LegalCategory"("key");
CREATE INDEX "LegalCategory_order_idx" ON "LegalCategory"("order");

CREATE TABLE "LegalPage" (
    "id"         TEXT NOT NULL,
    -- The URL segment and the value of LegalSection.doc. The five built-ins keep the keys
    -- they have always had, so every stored section, version and acceptance still resolves.
    "key"        TEXT NOT NULL,
    "label"      TEXT NOT NULL,
    "labelFr"    TEXT,
    "summary"    TEXT NOT NULL DEFAULT '',
    "summaryFr"  TEXT NOT NULL DEFAULT '',
    -- Any name IconGlyph resolves; empty falls back to the document icon for a built-in key
    -- and to a generic one otherwise.
    "icon"       TEXT NOT NULL DEFAULT '',
    "order"      INTEGER NOT NULL DEFAULT 0,
    -- TRUE for the five that ship in the web bundle. They may be renamed, recategorised and
    -- reordered; they may not be deleted, because their text has a compiled-in fallback and
    -- removing the row would leave the page rendering that fallback under no menu entry.
    "builtIn"    BOOLEAN NOT NULL DEFAULT false,
    -- A page can be hidden without being deleted: a policy that does not apply yet is not the
    -- same as one that never existed, and the archive still has to resolve its versions.
    "published"  BOOLEAN NOT NULL DEFAULT true,
    "categoryId" TEXT,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"  TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LegalPage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LegalPage_key_key" ON "LegalPage"("key");
CREATE INDEX "LegalPage_categoryId_order_idx" ON "LegalPage"("categoryId", "order");

-- SetNull, not Cascade: deleting a category must not delete the documents in it. A policy
-- disappearing because somebody tidied a heading is not a recoverable mistake.
ALTER TABLE "LegalPage" ADD CONSTRAINT "LegalPage_categoryId_fkey"
    FOREIGN KEY ("categoryId") REFERENCES "LegalCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The five that already exist, so an upgraded database has the same menu it had a minute ago.
-- `builtIn` is true for all of them; the labels here are the English ones, and the French
-- come from the web bundle's dictionary exactly as they did before this table existed.
INSERT INTO "LegalPage" ("id", "key", "label", "labelFr", "icon", "order", "builtIn", "updatedAt") VALUES
    ('lgp_about',    'about',    'About',                'À propos',                       'sparkles',    0, true, CURRENT_TIMESTAMP),
    ('lgp_privacy',  'privacy',  'Privacy Policy',       'Politique de confidentialité',   'lock',        1, true, CURRENT_TIMESTAMP),
    ('lgp_terms',    'terms',    'Terms of Service',     'Conditions d''utilisation',      'shield-check', 2, true, CURRENT_TIMESTAMP),
    ('lgp_cookies',  'cookies',  'Cookie Policy',        'Politique de cookies',           'cookie',      3, true, CURRENT_TIMESTAMP),
    ('lgp_refunds',  'refunds',  'Payments & Refunds',   'Paiements & remboursements',     'receipt',     4, true, CURRENT_TIMESTAMP);

-- Menu rows for two built-in legal documents whose text ships in the web bundle:
-- "submissions" (Submission Terms) never had one, so the tab list — built from this table
-- once it has rows — left it out; "dpa" is the new Data Processing Addendum.
INSERT INTO "LegalPage" ("id", "key", "label", "labelFr", "icon", "order", "builtIn", "updatedAt") VALUES
    ('lgp_submissions', 'submissions', 'Submission Terms',          'Conditions de soumission',          'file-text',      5, true, CURRENT_TIMESTAMP),
    ('lgp_dpa',         'dpa',         'Data Processing Addendum',  'Accord de traitement des données',  'file-signature', 6, true, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

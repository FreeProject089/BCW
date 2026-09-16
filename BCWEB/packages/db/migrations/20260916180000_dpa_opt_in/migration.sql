-- The Data Processing Addendum is OPT-IN: its page ships with the app but stays unpublished
-- until a deployment decides to offer that contract (Admin → Legal → the Addendum switch).
-- The previous migration inserted the row with the table's default (published), which would
-- have turned it on for everyone the moment it ran.
UPDATE "LegalPage" SET "published" = false WHERE "key" = 'dpa';

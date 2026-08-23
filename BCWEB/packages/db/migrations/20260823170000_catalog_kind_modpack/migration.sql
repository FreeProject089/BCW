-- A modpack is a catalogue kind.
--
-- Appended, never reordered: Postgres enum values carry an ordinal, and inserting MODPACK
-- before PRESET would renumber it under every row that already holds it.
--
-- IF NOT EXISTS so re-running against a database that already has it is a no-op rather than
-- an error that stops the whole deploy on its second attempt.
ALTER TYPE "CatalogKind" ADD VALUE IF NOT EXISTS 'MODPACK';

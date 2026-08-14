-- A blog space for developers.
--
-- A ProjectKey rather than a new "category" concept: a blog space already carries
-- everything this needs — its own page, the home-news toggle, per-space blog permissions,
-- the visibility gate — and a parallel taxonomy would have to grow all of that again, and
-- differently. The row is created here so the space exists on a database that will never
-- run the seed again.
ALTER TYPE "ProjectKey" ADD VALUE IF NOT EXISTS 'developers';

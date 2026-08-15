-- A report can outlive the person who filed it.
--
-- It is about somebody ELSE'S content, so erasing its author must not erase moderation
-- history about other people — and must not leave a link to an account that was told it was
-- gone. Nullable makes anonymising possible, which is the only outcome that costs neither.
--
-- Widening only: every existing row keeps its reporter, and nothing is rewritten.
ALTER TABLE "Report" ALTER COLUMN "reporterId" DROP NOT NULL;

-- Which element the slowest interaction landed on.
--
-- INP without attribution is a number you can watch and cannot fix: "383 ms on /auth" does
-- not say whether it was the email field, the submit button, or a menu. The client sends a
-- tag plus an aria-label or name — identity only, never a field's value, because this table
-- is read by staff.
ALTER TABLE "WebVital" ADD COLUMN "label" TEXT;

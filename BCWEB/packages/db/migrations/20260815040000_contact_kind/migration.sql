-- What a contact message is about.
--
-- Two of the kinds — data_export and data_delete — are legal deadlines rather than support
-- tickets, and they used to arrive as free text in the same list as a broken button. A kind
-- makes them countable, and a countable thing can be surfaced and chased.
--
-- Defaulted rather than backfilled by guessing: every existing message becomes 'other',
-- which is what it was filed as. Reading old bodies for the word "delete" would invent a
-- classification nobody made.
ALTER TABLE "ContactMessage" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'other';
CREATE INDEX "ContactMessage_kind_status_idx" ON "ContactMessage"("kind", "status");

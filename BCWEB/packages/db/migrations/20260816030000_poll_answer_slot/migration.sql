-- Grid questions: PollAnswer.slot, and the unique keys widened to include it.
--
-- A grid asks the same columns of several rows, and one voter picking the SAME column twice
-- ("Speed: good, Docs: good") is the NORMAL case, not an error. The existing unique keys —
-- (question, voter, choice) — call the second pick a duplicate of the first, and the write path
-- uses createMany({ skipDuplicates: true }), so it would not even raise: the second row would be
-- dropped and the grid would come back half-answered with nothing anywhere saying why.
--
-- `slot` says WHICH sub-item of the question a row answers: 0 for every kind that has only one
-- (choice, text, scale, number, date, ranking), the row index for a grid. NOT NULL with a
-- default, because a nullable discriminator discriminates nothing in Postgres — every NULL is
-- distinct from every other, so a nullable column in a unique key silently disables it.
--
-- The default backfills every existing row to 0, which is what they all are, so the widened
-- keys are exactly as strict as the old ones for every kind that exists today.

ALTER TABLE "PollAnswer" ADD COLUMN "slot" INTEGER NOT NULL DEFAULT 0;

DROP INDEX "PollAnswer_questionId_userId_choiceId_key";
DROP INDEX "PollAnswer_questionId_voterKey_choiceId_key";

CREATE UNIQUE INDEX "PollAnswer_questionId_userId_choiceId_slot_key" ON "PollAnswer"("questionId", "userId", "choiceId", "slot");
CREATE UNIQUE INDEX "PollAnswer_questionId_voterKey_choiceId_slot_key" ON "PollAnswer"("questionId", "voterKey", "choiceId", "slot");

// Turn every existing poll into a one-question poll on the new tables.
//
// Step 1 of BCWEB/guides/reference/POLLS_V2_DESIGN_EN.md. The old Poll/PollOption/PollVote rows
// are READ and never touched: they keep serving every existing poll until the reader moves, so
// a mistake here is a re-run, not a restore.
//
//   node src/backfill-polls.mjs            # report what it would do, change nothing
//   node src/backfill-polls.mjs --commit   # do it
//
// Re-runnable by construction. Every insert is skipped when its target already exists, keyed on
// the ORIGINAL id — PollChoice keeps its PollOption's id, so a second run finds its own work and
// does nothing rather than duplicating a poll's options.
import { PrismaClient } from '@prisma/client';

const COMMIT = process.argv.includes('--commit');
const p = new PrismaClient();

const polls = await p.poll.findMany({ include: { options: { orderBy: { sort: 'asc' } }, votes: true } });
let questions = 0, choices = 0, answers = 0, skipped = 0;

for (const poll of polls) {
    // One question per poll, and its id is the poll's — so "has this poll been converted?" is a
    // lookup rather than a heuristic, and a re-run cannot create a second question.
    const qid = poll.id;
    const existing = await p.pollQuestion.findUnique({ where: { id: qid } });
    if (existing) { skipped++; continue; }

    if (COMMIT) {
        await p.pollQuestion.create({
            data: {
                id: qid,
                pollId: poll.id,
                kind: 'choice',
                label: poll.question,
                sort: 0,
                // The two flags that lived on the poll are properties of the QUESTION now.
                config: { multiple: poll.multiple, maxChoices: poll.maxChoices },
            },
        });
        // Choices keep their option ids, so anything that still references an option id keeps
        // resolving, and the vote → answer mapping below needs no lookup table.
        for (const o of poll.options) {
            await p.pollChoice.create({ data: { id: o.id, questionId: qid, label: o.label, sort: o.sort } });
        }
        for (const v of poll.votes) {
            await p.pollAnswer.create({
                data: {
                    id: v.id,
                    pollId: poll.id,
                    questionId: qid,
                    choiceId: v.optionId,
                    userId: v.userId,
                    voterKey: v.voterKey,
                    // Carried verbatim. Recomputing it from userId would move a closed
                    // account's answer into the anonymous column and change a published result.
                    wasLoggedIn: v.wasLoggedIn,
                    createdAt: v.createdAt,
                },
            });
        }
    }
    questions++; choices += poll.options.length; answers += poll.votes.length;
}

console.log(COMMIT ? 'Backfilled:' : 'Would backfill (nothing changed):');
console.log(`  ${questions} question(s), ${choices} choice(s), ${answers} answer(s)`);
if (skipped) console.log(`  ${skipped} poll(s) already converted — skipped`);
if (!polls.length) console.log('  no polls in this database');

await p.$disconnect();

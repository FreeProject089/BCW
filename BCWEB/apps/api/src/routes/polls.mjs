// Polls: ask a question, count the answers, and never pretend the count is better than it
// is.
//
// The one design decision everything else follows from: a poll open to everybody cannot be
// deduplicated honestly. A device fingerprint puts two people behind one router in the same
// box and splits one person across their phone and laptop. So anonymous answers are counted
// separately from signed-in ones, everywhere, all the way to the admin screen — a merged
// total would look precise and be wrong, and it is the merged number that gets quoted.
import { z } from 'zod';
import { viewQuestions, viewMyAnswers } from '../lib/poll-view.mjs';
import crypto from 'node:crypto';
import { db, requireRole, requireCap, optionalAuth, logAudit } from '../lib/lib.mjs';
import { clientIp } from '../lib/geo.mjs';
import { pollStats, questionStats, completion } from '../lib/poll-stats.mjs';
import { planQuestionUpdate } from '../lib/poll-edit.mjs';
import { mayViewPoll, listWhere, shareKeyFor, newShareKey, POLL_VISIBILITIES } from '../lib/poll-visibility.mjs';
import { validateAnswer, maxAnswers, validateRanking, validateGrid, ALL_QUESTION_KINDS, isAnswerable } from '../lib/poll-answer.mjs';

/** Per-poll device fingerprint for anonymous voters.
 *
 *  Deliberately NOT visitorHash(): that one rotates daily by design, which for analytics is
 *  a privacy feature and for a poll would quietly let everybody vote again every midnight.
 *  Salted per poll so the same value cannot be correlated across polls.
 */
const voterKeyFor = (req, pollId) => crypto.createHash('sha256')
  .update(`${clientIp(req)}|${req.headers['user-agent'] || ''}|${pollId}|${process.env.JWT_SECRET || 'salt'}`)
  .digest('hex').slice(0, 32);

/** Is this poll answerable right now? Schedule beats status: a poll whose window closed is
 *  closed whether or not anybody has pressed the button. */
function openNow(poll) {
  if (poll.status !== 'open') return false;
  const now = Date.now();
  if (poll.opensAt && new Date(poll.opensAt).getTime() > now) return false;
  if (poll.closesAt && new Date(poll.closesAt).getTime() <= now) return false;
  return true;
}

/** The public shape. Never leaks who voted for what — only totals. */
function publicPoll(poll, { myVotes = [], showResults = false } = {}) {
  const tally = new Map(poll.options.map((o) => [o.id, { users: 0, anon: 0 }]));
  for (const v of poll.votes || []) {
    const slot = tally.get(v.optionId);
    if (slot) slot[v.wasLoggedIn ? 'users' : 'anon'] += 1;
  }
  const options = poll.options.map((o) => {
    const c = tally.get(o.id) || { users: 0, anon: 0 };
    return { id: o.id, label: o.label, sort: o.sort, ...(showResults ? { votes: c.users + c.anon, userVotes: c.users, anonVotes: c.anon } : {}) };
  });
  const total = (poll.votes || []).length;
  const userTotal = (poll.votes || []).filter((v) => v.wasLoggedIn).length;
  return {
    id: poll.id, question: poll.question, description: poll.description,
    audience: poll.audience, multiple: poll.multiple, maxChoices: poll.maxChoices,
    status: poll.status, opensAt: poll.opensAt, closesAt: poll.closesAt,
    results: poll.results, pinned: poll.pinned, createdAt: poll.createdAt,
    visibility: poll.visibility || 'public',
    open: openNow(poll),
    options,
    myVotes,
    ...(showResults ? { total, userTotal, anonTotal: total - userTotal } : {}),
  };
}

/** May this viewer see the tally? */
const canSeeResults = (poll, voted) =>
  // 'staff' first, and it wins outright. The clause below reads "a poll nobody can answer any
  // more may as well show its result", which is right for always/after_vote and was a LEAK
  // here: results:'staff' means the owner marked the numbers private, and !openNow is true for
  // a closed poll, a scheduled one before it opens, and any poll past closesAt. So a staff-only
  // tally became public to everyone simply by waiting for the poll to close. It was private
  // while open, which is exactly why nobody would notice.
  //
  // The same rule, stated once and tested, lives in lib/poll-view.mjs (maySeeResults) for the
  // multi-question reader. This one stays minimal on purpose — it is a fix, not a refactor of
  // a path that serves real polls.
  poll.results !== 'staff' &&
  (poll.results === 'always' || (poll.results === 'after_vote' && voted) || !openNow(poll));

export default async function pollRoutes(app) {
  // ── Public ──────────────────────────────────────────────────────────────────

  /** Which options THIS viewer picked — by account when signed in, by fingerprint when not. */
  const myVotesOf = (req, poll) => {
    const uid = req.user?.uid;
    const vk = uid ? null : voterKeyFor(req, poll.id);
    return (poll.votes || [])
      .filter((v) => (uid ? v.userId === uid : v.voterKey && v.voterKey === vk))
      .map((v) => v.optionId);
  };

  app.get('/polls', { preHandler: optionalAuth() }, async (req) => {
    const p = await db();
    const polls = await p.poll.findMany({
      // The rule lives in poll-visibility.mjs, next to the predicate this must agree with.
      // Written out here instead, it would be the second copy of a rule — and the day the
      // two disagree is the day a staff-only poll is listed on the public page.
      // `?home=1` narrows to the pinned ones, for the home page. Same rule, same shape, one
      // extra clause — rather than a second endpoint that would have to be kept in step with
      // this one's visibility filter.
      where: { ...listWhere({ role: req.user?.role || null }), ...(req.query?.home ? { pinned: true, status: 'open' } : {}) },
      orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
      take: req.query?.home ? 2 : 50,
      include: {
        options: { orderBy: { sort: 'asc' } },
        votes: { select: { optionId: true, wasLoggedIn: true, userId: true, voterKey: true } },
        // Loaded here after all. I left it out arguing that questions for fifty listed polls
        // would be "work nothing reads" — wrong, and only opening the page showed it: /polls is
        // where a poll is rendered AND answered, so without this the multi-question form could
        // never appear anywhere. A feature that exists and cannot be reached, built by the
        // person who spent the day fixing that exact shape.
        questions: { include: { choices: { orderBy: { sort: 'asc' } } }, orderBy: { sort: 'asc' } },
      },
    });
    // This viewer's own answers, for every listed poll, in ONE query. Without them a form
    // poll cannot tell that anybody answered — see viewMyAnswers.
    //
    // An anonymous voterKey is salted PER POLL, so there is no single key to match on: the
    // filter is a list of (pollId, voterKey) pairs. A signed-in viewer is one clause.
    const uid = req.user?.uid || null;
    const withQs = polls.filter((x) => (x.questions || []).length);
    const myRows = withQs.length
      ? await p.pollAnswer.findMany({
        where: uid
          ? { userId: uid, pollId: { in: withQs.map((x) => x.id) } }
          : { OR: withQs.map((x) => ({ pollId: x.id, voterKey: voterKeyFor(req, x.id) })) },
      })
      : [];

    // Per-question tallies, for the polls this viewer may see them for.
    //
    // A question-based poll showed its readers NOTHING, ever. `canSeeResults` was computed and
    // passed along, `viewPoll`/`maySeeResults` were written and tested — and no tally was ever
    // produced for a question, so with results:'always', a closed poll and hundreds of answers,
    // a visitor got "this poll is closed" while the admin saw the full breakdown.
    //
    // Loaded only for the polls that will actually show one: answers for fifty polls nobody may
    // see is a table scan spent on nothing.
    const visible = polls.filter((poll) => {
      if (!(poll.questions || []).length) return false;
      const mine = myVotesOf(req, poll);
      const answered = myRows.some((r) => r.pollId === poll.id);
      return canSeeResults(poll, mine.length > 0 || answered);
    });
    const allAnswers = visible.length
      ? await p.pollAnswer.findMany({ where: { pollId: { in: visible.map((x) => x.id) } } })
      : [];

    return {
      polls: polls
        // A poll for signed-in users is still LISTED to a visitor — hiding it would make the
        // site look emptier than it is, and "sign in to answer" is a better invitation than
        // a blank page.
        .map((poll) => {
          const mine = myVotesOf(req, poll);
          const rows = myRows.filter((r) => r.pollId === poll.id);
          const answered = rows.length > 0;
          const show = canSeeResults(poll, mine.length > 0 || answered);
          const body = publicPoll(poll, { myVotes: mine, showResults: show });
          const qs = viewQuestions(poll);
          if (qs.length) {
            body.questions = qs;
            body.myAnswers = viewMyAnswers(qs, rows);
            body.hasAnswered = answered;
            if (show) {
              const mineAll = allAnswers.filter((r) => r.pollId === poll.id);
              // The same counting the admin sees, from the same tested module — one tally, not
              // a second implementation that agrees until it does not.
              body.questionStats = (poll.questions || []).map((q) =>
                questionStats(q, mineAll, q.choices || []));
            }
          }
          return body;
        }),
    };
  });

  app.get('/polls/:id', { preHandler: optionalAuth() }, async (req, reply) => {
    const p = await db();
    const poll = await p.poll.findUnique({
      where: { id: req.params.id },
      include: {
        options: { orderBy: { sort: 'asc' } },
        votes: { select: { optionId: true, wasLoggedIn: true, userId: true, voterKey: true } },
        // Loaded HERE and not in the list endpoint: this is the only place a poll is actually
        // rendered, and pulling questions + choices for fifty listed polls would be work
        // nothing reads.
        questions: { include: { choices: true } },
      },
    });
    // 404 rather than 403 for every refusal: a 403 confirms the poll exists, which is the
    // one fact an unlisted poll is trying not to leak.
    if (!mayViewPoll(poll, { role: req.user?.role || null, key: req.query?.k || null })) {
      return reply.code(404).send({ error: 'not_found' });
    }
    const mine = myVotesOf(req, poll);
    const questions = viewQuestions(poll);
    // Read BEFORE the body is built. `showResults` is not a field on the response — it decides
    // whether the options carry their counts — so deciding it afterwards would change nothing
    // and look like it had.
    const uid = req.user?.uid || null;
    const rows = questions.length
      ? await p.pollAnswer.findMany({
        where: { pollId: poll.id, ...(uid ? { userId: uid } : { voterKey: voterKeyFor(req, poll.id) }) },
      })
      : [];
    // A form poll's tally is unlocked by having ANSWERED, which for it means PollAnswer rows:
    // the legacy `voted` is about PollVote, which that path never writes, so it is always
    // false here and `after_vote` would hide the result from the person who just answered.
    // Computed ONCE and reused for both shapes. It used to be inlined into the publicPoll call,
    // which meant the question path had no way to ask the same question without recomputing it
    // — and a second computation of "may they see the tally" is a second answer waiting to
    // disagree with the first.
    const maySeeTally = canSeeResults(poll, mine.length > 0 || rows.length > 0);
    const body = publicPoll(poll, { myVotes: mine, showResults: maySeeTally });
    // Additive, and deliberately alongside `options` rather than replacing it. Every backfilled
    // poll has exactly one question saying the same thing as `question` + `options`, so the
    // current client keeps working untouched while the multi-question reader is built. The old
    // fields go when nothing reads them, not before — that is the whole point of the order.
    if (questions.length) {
      body.questions = questions;
      body.myAnswers = viewMyAnswers(questions, rows);
      body.hasAnswered = rows.length > 0;
      // The aggregates, which this endpoint never sent.
      //
      // The LIST endpoint has served them since question polls shipped; this one did not, and
      // nothing said so — the page simply showed a form poll with no results, at every setting,
      // including "always" and including after the poll closed. It is also the page every share
      // link points at, so the poll you deliberately sent somebody was the one that could not
      // show them what it found.
      //
      // Same module, same call shape as the list. A second tally written here would agree until
      // the day it did not.
      if (maySeeTally) {
        const all = await p.pollAnswer.findMany({ where: { pollId: poll.id } });
        body.questionStats = (poll.questions || []).map((q) => questionStats(q, all, q.choices || []));
      }
    }
    return body;
  });

  app.post('/polls/:id/vote', { preHandler: optionalAuth(), config: { rateLimit: { max: 20, timeWindow: '5 minutes' } } }, async (req, reply) => {
    const b = z.object({ optionIds: z.array(z.string()).min(1).max(20) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const poll = await p.poll.findUnique({ where: { id: req.params.id }, include: { options: { select: { id: true } } } });
    if (!poll) return reply.code(404).send({ error: 'not_found' });
    // Same gate as reading it. Without this, knowing an id is enough to answer a poll that
    // is not listed anywhere and was never meant for you — the read side would hide it and
    // the write side would take the vote.
    if (!mayViewPoll(poll, { role: req.user?.role || null, key: req.query?.k || null })) {
      return reply.code(404).send({ error: 'not_found' });
    }
    if (!openNow(poll)) return reply.code(409).send({ error: 'closed' });
    if (poll.audience === 'users' && !req.user?.uid) return reply.code(401).send({ error: 'sign_in_required' });

    const valid = new Set(poll.options.map((o) => o.id));
    const picks = [...new Set(b.data.optionIds)].filter((id) => valid.has(id));
    if (!picks.length) return reply.code(400).send({ error: 'invalid_option' });
    if (!poll.multiple && picks.length > 1) return reply.code(400).send({ error: 'single_choice' });
    if (poll.maxChoices > 0 && picks.length > poll.maxChoices) return reply.code(400).send({ error: 'too_many', max: poll.maxChoices });

    const userId = req.user?.uid || null;
    const voterKey = userId ? null : voterKeyFor(req, poll.id);
    // Asked once, before the transaction, because the mirror below is skipped without it.
    const hasQuestion = (await p.pollQuestion.count({ where: { id: poll.id } })) > 0;

    // Changing your mind replaces the previous answer rather than adding to it. The
    // alternative — refusing a second vote — means a mis-click is permanent, and on a
    // single-choice poll that is the most common thing that happens.
    // Both shapes, in ONE transaction. The backfill converted the votes that existed, but a
    // new vote written only to PollVote would leave the new tables stale from the first person
    // who answers — and stale is worse than empty, because it looks like data.
    //
    // In a transaction rather than best-effort-with-a-log: if the mirror cannot be written the
    // vote must fail loudly. A logged failure nobody reads is exactly how the two shapes drift
    // apart while every screen keeps looking right.
    const answerRows = picks.map((choiceId) => ({
      pollId: poll.id, questionId: poll.id, choiceId, userId, voterKey, wasLoggedIn: !!userId,
    }));
    await p.$transaction([
      p.pollVote.deleteMany({ where: { pollId: poll.id, ...(userId ? { userId } : { voterKey }) } }),
      p.pollVote.createMany({
        data: picks.map((optionId) => ({ pollId: poll.id, optionId, userId, voterKey, wasLoggedIn: !!userId })),
        skipDuplicates: true,
      }),
      // The backfill gives a converted poll a question whose id IS the poll's id, so the
      // mirror needs no lookup. A poll with no question yet (created after the migration and
      // never backfilled) writes nothing here rather than inventing one — createMany with an
      // unknown questionId would fail the whole vote, and a missing question is the backfill's
      // job, not the vote endpoint's.
      p.pollAnswer.deleteMany({ where: { pollId: poll.id, ...(userId ? { userId } : { voterKey }) } }),
      p.pollAnswer.createMany({ data: hasQuestion ? answerRows : [], skipDuplicates: true }),
    ]);

    const fresh = await p.poll.findUnique({
      where: { id: poll.id },
      include: { options: { orderBy: { sort: 'asc' } }, votes: { select: { optionId: true, wasLoggedIn: true, userId: true, voterKey: true } } },
    });
    return publicPoll(fresh, { myVotes: picks, showResults: canSeeResults(fresh, true) });
  });

  /**
   * Answer a multi-question poll.
   *
   * Separate from /vote, which takes optionIds and is what every existing poll uses. One door
   * per shape rather than one door that guesses: a body with both would have to decide which
   * the caller meant, and guessing wrong writes an answer nobody gave.
   *
   * Replaces the whole submission, like /vote replaces a previous answer — a form you cannot
   * correct is a form people abandon.
   */
  app.post('/polls/:id/answers', { preHandler: optionalAuth(), config: { rateLimit: { max: 20, timeWindow: '5 minutes' } } }, async (req, reply) => {
    const b = z.object({
      answers: z.array(z.object({
        questionId: z.string(),
        // One value, or several for a multi-choice question. Unknown types are rejected by
        // validateAnswer, not here, so the reason returned is specific.
        value: z.any().optional(),
        values: z.array(z.any()).optional(),
      })).max(200),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });

    const p = await db();
    const poll = await p.poll.findUnique({
      where: { id: req.params.id },
      include: { questions: { include: { choices: { select: { id: true } } } } },
    });
    if (!poll) return reply.code(404).send({ error: 'not_found' });
    // Same gate as reading it. Without this, knowing an id is enough to answer a poll that
    // is not listed anywhere and was never meant for you — the read side would hide it and
    // the write side would take the vote.
    if (!mayViewPoll(poll, { role: req.user?.role || null, key: req.query?.k || null })) {
      return reply.code(404).send({ error: 'not_found' });
    }
    if (!openNow(poll)) return reply.code(409).send({ error: 'closed' });
    if (poll.audience === 'users' && !req.user?.uid) return reply.code(401).send({ error: 'sign_in_required' });
    if (!poll.questions.length) return reply.code(409).send({ error: 'no_questions' });

    const userId = req.user?.uid || null;
    const voterKey = userId ? null : voterKeyFor(req, poll.id);
    const byId = new Map(poll.questions.map((q) => [q.id, q]));
    const rows = [];

    for (const q of poll.questions) {
      // A note is content — a heading, an explanation. Nothing is expected, nothing is
      // stored, and a client that sends one is ignored rather than refused: the question set
      // is public, so a stale page holding a note that has since been added is a normal
      // thing to receive, not an attack to reject.
      if (!isAnswerable(q.kind)) continue;
      const sent = b.data.answers.find((a) => a.questionId === q.id);
      const choiceIds = (q.choices || []).map((c) => c.id);

      // Ranking is validated as a LIST, not item by item: a duplicate, a stranger and a short
      // list are all properties of the whole submission and invisible from one entry.
      if (q.kind === 'ranking') {
        const order = Array.isArray(sent?.values) ? sent.values : [];
        const rk = validateRanking(order, choiceIds, { required: q.required });
        if (!rk.ok) return reply.code(400).send({ error: rk.error, questionId: q.id, ...(rk.expected ? { expected: rk.expected, got: rk.got } : {}) });
        for (const row of rk.rows) {
          rows.push({ pollId: poll.id, questionId: q.id, userId, voterKey, wasLoggedIn: !!userId, ...row });
        }
        continue;
      }

      // A grid is validated as a whole for the same reason, plus one of its own: a row nobody
      // filled is only visible by counting, and averaging a column over people who filled
      // different rows compares numbers that do not mean the same thing.
      if (q.kind === 'grid') {
        const entries = Array.isArray(sent?.values) ? sent.values : [];
        const gr = validateGrid(entries, q, choiceIds);
        if (!gr.ok) {
          const { ok, rows: _ignored, ...detail } = gr;
          return reply.code(400).send({ ...detail, questionId: q.id });
        }
        for (const row of gr.rows) {
          rows.push({ pollId: poll.id, questionId: q.id, userId, voterKey, wasLoggedIn: !!userId, ...row });
        }
        continue;
      }

      const raws = sent ? (Array.isArray(sent.values) ? sent.values : [sent.value]) : [undefined];
      const cap = maxAnswers(q);
      if (raws.length > cap) return reply.code(400).send({ error: 'too_many', questionId: q.id, max: cap });

      for (const raw of raws) {
        const v = validateAnswer(q, raw, choiceIds);
        // The question is named in the error. "invalid_input" on a ten-question form tells the
        // person nothing about which field to look at.
        if (!v.ok) return reply.code(400).send({ error: v.error, questionId: q.id });
        // A blank optional answer stores nothing — "skipped" and "answered with nothing" are
        // different facts, and the completion funnel counts them differently.
        if (v.value === null) continue;
        rows.push({
          pollId: poll.id, questionId: q.id, userId, voterKey, wasLoggedIn: !!userId,
          [v.column]: v.value,
        });
      }
    }

    // An answer aimed at a question this poll does not own is refused rather than dropped: a
    // silently ignored answer looks accepted and is not recorded.
    const stray = b.data.answers.find((a) => !byId.has(a.questionId));
    if (stray) return reply.code(400).send({ error: 'unknown_question', questionId: stray.questionId });

    await p.$transaction([
      p.pollAnswer.deleteMany({ where: { pollId: poll.id, ...(userId ? { userId } : { voterKey }) } }),
      p.pollAnswer.createMany({ data: rows, skipDuplicates: true }),
    ]);

    return { ok: true, answers: rows.length };
  });

  /** Withdraw an answer. A poll you cannot un-answer is a poll people hesitate to answer. */
  app.delete('/polls/:id/vote', { preHandler: optionalAuth() }, async (req, reply) => {
    const p = await db();
    const poll = await p.poll.findUnique({ where: { id: req.params.id } });
    if (!poll) return reply.code(404).send({ error: 'not_found' });
    // Same gate as reading it. Without this, knowing an id is enough to answer a poll that
    // is not listed anywhere and was never meant for you — the read side would hide it and
    // the write side would take the vote.
    if (!mayViewPoll(poll, { role: req.user?.role || null, key: req.query?.k || null })) {
      return reply.code(404).send({ error: 'not_found' });
    }
    if (!openNow(poll)) return reply.code(409).send({ error: 'closed' });
    const userId = req.user?.uid || null;
    const where = { pollId: poll.id, ...(userId ? { userId } : { voterKey: voterKeyFor(req, poll.id) }) };
    // The mirror goes with it. Withdrawing from PollVote alone would leave the answer standing
    // in the new tables — the same drift the vote path avoids, arrived at from the other end,
    // and the one that turns "I removed my vote" into a lie once the new reader ships.
    const [r] = await p.$transaction([
      p.pollVote.deleteMany({ where }),
      p.pollAnswer.deleteMany({ where }),
    ]);
    return { ok: true, removed: r.count };
  });

  /** The polls one user answered — for the profile, the dashboard, and admin User details.
   *
   * `votes` is PollVote: the single-question shape, one row per chosen option. It was the whole
   * of this endpoint, and that made every MULTI-QUESTION poll invisible here — those write
   * PollAnswer rows and never touch PollVote, so somebody who had filled in a five-question
   * form was told they had answered nothing.
   *
   * So `answered` is the same question asked of the other table, deduplicated to one row per
   * poll (a form poll has one PollAnswer per question, and listing "you answered this" five
   * times is not what anybody meant). And `open` is what is still waiting for them, which is
   * the half a dashboard actually needs — a list of what you already did prompts nobody.
   */
  app.get('/me/polls', { preHandler: requireRole() }, async (req) => {
    const p = await db();
    const uid = req.user.uid;
    const [votes, answerRows] = await Promise.all([
      p.pollVote.findMany({
        where: { userId: uid }, orderBy: { createdAt: 'desc' }, take: 100,
        include: { option: { select: { label: true } }, poll: { select: { id: true, question: true, status: true } } },
      }),
      p.pollAnswer.findMany({
        where: { userId: uid }, orderBy: { createdAt: 'desc' }, take: 500,
        select: { pollId: true, createdAt: true, poll: { select: { id: true, question: true, status: true, visibility: true } } },
      }),
    ]);

    const seen = new Set();
    const answered = [];
    for (const r of answerRows) {
      if (!r.poll || seen.has(r.pollId)) continue;
      seen.add(r.pollId);
      answered.push({ pollId: r.pollId, at: r.createdAt, poll: r.poll });
    }

    // Every poll id this person has already engaged with, by either mechanism.
    const done = new Set([...seen, ...votes.map((v) => v.poll?.id).filter(Boolean)]);

    // Still open, still public, not yet answered. Unlisted and private polls are excluded by
    // listWhere — a dashboard that advertised them would undo the point of hiding them.
    const openPolls = await p.poll.findMany({
      where: { ...listWhere({ role: null }), status: 'open' },
      orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
      take: 20,
      select: { id: true, question: true, description: true, closesAt: true, pinned: true },
    });

    return { votes, answered, open: openPolls.filter((x) => !done.has(x.id)) };
  });

  // ── Admin (manage_polls) ────────────────────────────────────────────────────

  const pollBody = z.object({
    question: z.string().min(3).max(300),
    // Raised from 2000 when the description became markdown. An image URL plus a couple of
    // BCWEB blocks eats a thousand characters before a word is written, and the old cap cut
    // people off mid-embed — which reads as the editor being broken, not as a limit.
    description: z.string().max(8000).default(''),
    audience: z.enum(['users', 'all']).default('users'),
    // WHERE it can be found. Distinct from `audience`, which is who may answer: a poll can
    // be answerable by anyone and still be listed nowhere.
    visibility: z.enum(POLL_VISIBILITIES).default('public'),
    multiple: z.boolean().default(false),
    maxChoices: z.number().int().min(0).max(20).default(0),
    status: z.enum(['draft', 'open', 'closed']).default('draft'),
    opensAt: z.string().datetime().nullable().optional(),
    closesAt: z.string().datetime().nullable().optional(),
    results: z.enum(['always', 'after_vote', 'staff']).default('after_vote'),
    pinned: z.boolean().default(false),
    // Two at least — for the LEGACY shape, which is a poll that is one choice question and
    // stores its answers in PollOption/PollVote. A question-based poll uses neither, so an
    // empty list is allowed and means "this one is a form": the questions are set by
    // PUT /admin/polls/:id/questions immediately after. Requiring two here forced the
    // new-poll screen to invent "Option 1" and "Option 2" for a poll that would never use
    // them, and then to hide them.
    options: z.array(z.string().min(1).max(200)).max(20).refine(
      (v) => v.length === 0 || v.length >= 2,
      { message: 'give two options or none' },
    ),
  });

  app.get('/admin/polls', { preHandler: requireCap('manage_polls') }, async () => {
    const p = await db();
    const polls = await p.poll.findMany({
      orderBy: [{ createdAt: 'desc' }],
      include: {
        options: { orderBy: { sort: 'asc' } },
        votes: { select: { optionId: true, wasLoggedIn: true, userId: true, voterKey: true } },
        createdBy: { select: { displayName: true } },
        // The editable multi-question shape. The public detail endpoint cannot serve this to an
        // admin working on a DRAFT — it 404s drafts on purpose — so the admin list carries it.
        questions: { include: { choices: { orderBy: { sort: 'asc' } } }, orderBy: { sort: 'asc' } },
      },
    });
    // Answers per question, so the editor can warn about what an edit would destroy BEFORE the
    // save is attempted. One grouped query for every poll rather than one per poll.
    const counts = await p.pollAnswer.groupBy({ by: ['questionId'], _count: true });
    const answersBy = Object.fromEntries(counts.map((c) => [c.questionId, c._count]));
    return {
      polls: polls.map((poll) => ({
        ...publicPoll(poll, { showResults: true }),
        author: poll.createdBy?.displayName || null,
        // The admin screen is where the share link is copied from, so this is the one
        // listing that carries keys — and requireCap('manage_polls') is what makes that safe.
        shareKey: shareKeyFor(poll, { role: 'ADMIN' }),
        questions: viewQuestions(poll).map((q) => ({ ...q, answers: answersBy[q.id] || 0 })),
      })),
    };
  });

  app.post('/admin/polls', { preHandler: requireCap('manage_polls') }, async (req, reply) => {
    const b = pollBody.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input', detail: b.error.issues[0]?.message });
    const p = await db();
    const { options, opensAt, closesAt, ...rest } = b.data;
    const poll = await p.poll.create({
      data: {
        ...rest,
        // Only an unlisted poll needs one, and it is minted with the poll rather than on
        // first use — a share button that has to create the key before it can copy it is a
        // share button that fails the first time somebody presses it.
        shareKey: rest.visibility === 'unlisted' ? newShareKey() : '',
        opensAt: opensAt ? new Date(opensAt) : null,
        closesAt: closesAt ? new Date(closesAt) : null,
        createdById: req.user.uid,
        options: { create: options.map((label, i) => ({ label, sort: i })) },
      },
      include: { options: true },
    });
    await logAudit(p, req.user.uid, 'poll.created', poll.question, clientIp(req));
    return { ok: true, poll };
  });

  app.put('/admin/polls/:id', { preHandler: requireCap('manage_polls') }, async (req, reply) => {
    const b = pollBody.partial().safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const existing = await p.poll.findUnique({ where: { id: req.params.id }, include: { options: true, _count: { select: { votes: true } } } });
    if (!existing) return reply.code(404).send({ error: 'not_found' });

    const { options, opensAt, closesAt, ...rest } = b.data;
    // Options are only replaceable while nobody has answered. After that, editing the list
    // would silently reattribute or destroy votes — the tally would still add up and would
    // no longer mean anything. Labels stay editable (a typo fix changes no answer).
    if (options) {
      if (existing._count.votes > 0) return reply.code(409).send({ error: 'has_votes', detail: 'Options cannot be replaced once people have answered.' });
      await p.pollOption.deleteMany({ where: { pollId: existing.id } });
      await p.pollOption.createMany({ data: options.map((label, i) => ({ pollId: existing.id, label, sort: i })) });
    }
    // Becoming unlisted needs a key; it is minted once and then KEPT, even when the poll is
    // switched back to public. Clearing it would mean that turning unlisted off and on again
    // silently rotates the link — and the people holding the old one would get a 404 with
    // nothing to tell them why. `shareKeyFor` already refuses to hand the key out while the
    // poll is not unlisted, so keeping it costs nothing.
    const needsKey = rest.visibility === 'unlisted' && !existing.shareKey;

    const poll = await p.poll.update({
      where: { id: existing.id },
      data: {
        ...rest,
        ...(needsKey ? { shareKey: newShareKey() } : {}),
        ...(opensAt !== undefined ? { opensAt: opensAt ? new Date(opensAt) : null } : {}),
        ...(closesAt !== undefined ? { closesAt: closesAt ? new Date(closesAt) : null } : {}),
      },
      include: { options: { orderBy: { sort: 'asc' } } },
    });
    // Visibility is the field somebody will ask about later ("why can nobody see this?"), so
    // it is named in the audit line rather than folded into a generic "updated".
    if (rest.visibility && rest.visibility !== existing.visibility) {
      await logAudit(p, req.user.uid, 'poll.visibility', `${poll.question}: ${existing.visibility} -> ${rest.visibility}`, clientIp(req));
    }
    await logAudit(p, req.user.uid, 'poll.updated', poll.question, clientIp(req));
    return { ok: true, poll };
  });

  /**
   * Replace a poll's questions.
   *
   * The whole set at once rather than per-question CRUD: reordering, adding and removing in one
   * screen is what an editor does, and three endpoints would let a client land the poll in a
   * state no single request describes.
   *
   * Refuses by default when it would destroy answers, and says which questions and how many —
   * see lib/poll-edit.mjs. `force: true` proceeds, having been told.
   */
  app.put('/admin/polls/:id/questions', { preHandler: requireCap('manage_polls') }, async (req, reply) => {
    const b = z.object({
      force: z.boolean().default(false),
      questions: z.array(z.object({
        id: z.string().optional(),
        // DERIVED, not restated. Written out by hand this list said choice/text/scale/date/
        // number — so the editor offered `ranking`, the save returned a bare `invalid_input`,
        // and nothing named the field. COLUMN_FOR_KIND is the one place a kind is declared, and
        // a kind that cannot be stored cannot be reached from here either.
        kind: z.enum(ALL_QUESTION_KINDS),
        label: z.string().min(1).max(500),
        help: z.string().max(1000).default(''),
        required: z.boolean().default(false),
        config: z.record(z.any()).default({}),
        showIf: z.object({ questionId: z.string(), equals: z.string() }).nullable().default(null),
        choices: z.array(z.object({ id: z.string().optional(), label: z.string().min(1).max(300) })).default([]),
      })).max(100),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });

    const p = await db();
    const poll = await p.poll.findUnique({
      where: { id: req.params.id },
      include: { questions: { include: { choices: { orderBy: { sort: 'asc' } } } } },
    });
    if (!poll) return reply.code(404).send({ error: 'not_found' });

    // Counted per question, not in total: the refusal has to name what it would cost.
    const grouped = await p.pollAnswer.groupBy({ by: ['questionId'], where: { pollId: poll.id }, _count: true });
    const answerCounts = Object.fromEntries(grouped.map((g) => [g.questionId, g._count]));
    // And per CHOICE, because deleting an option destroys answers without deleting a question —
    // the loss the old plan could not see and therefore never warned about.
    const byChoice = await p.pollAnswer.groupBy({ by: ['choiceId'], where: { pollId: poll.id, choiceId: { not: null } }, _count: true });
    const choiceAnswerCounts = Object.fromEntries(byChoice.map((g) => [g.choiceId, g._count]));

    const plan = planQuestionUpdate(poll.questions, b.data.questions, answerCounts, { force: b.data.force, choiceAnswerCounts });
    if (!plan.ok) return reply.code(409).send(plan);

    // One transaction. A half-applied question set is a poll whose reader and whose answers
    // disagree, and there is no screen that would show you which half landed.
    await p.$transaction([
      ...(plan.removedIds.length ? [p.pollQuestion.deleteMany({ where: { id: { in: plan.removedIds } } })] : []),
      // A retyped question drops its answers with it: they live in a column its new kind will
      // never read. Deleted explicitly rather than left as unreachable rows.
      ...(plan.retypedIds.length ? [p.pollAnswer.deleteMany({ where: { questionId: { in: plan.retypedIds } } })] : []),
      ...plan.ordered.map((q) => (q.id
        ? p.pollQuestion.update({
            where: { id: q.id },
            data: { kind: q.kind, label: q.label, help: q.help, required: q.required, sort: q.sort, config: q.config, showIf: q.showIf },
          })
        : p.pollQuestion.create({
            data: {
              pollId: poll.id, kind: q.kind, label: q.label, help: q.help, required: q.required,
              sort: q.sort, config: q.config, showIf: q.showIf,
              choices: { create: q.choices.map((c, i) => ({ label: c.label, sort: i })) },
            },
          }))),
      // Choices for questions that already existed. In the SAME transaction as the questions:
      // a poll whose labels landed and whose options did not is a state no screen would show
      // you. Deletes first, so renaming A→B while adding a new A cannot collide on nothing.
      ...(plan.choicePlan || []).flatMap((cp) => [
        ...(cp.removeIds.length ? [p.pollChoice.deleteMany({ where: { id: { in: cp.removeIds } } })] : []),
        ...cp.update.map((c) => p.pollChoice.update({ where: { id: c.id }, data: { label: c.label, sort: c.sort } })),
        ...(cp.create.length ? [p.pollChoice.createMany({ data: cp.create.map((c) => ({ questionId: cp.questionId, label: c.label, sort: c.sort })) })] : []),
      ]),
    ]);

    await logAudit(req, 'poll.questions.update', { pollId: poll.id, questions: plan.ordered.length, answersLost: plan.answersLost });
    const fresh = await p.poll.findUnique({
      where: { id: poll.id },
      include: { questions: { include: { choices: true }, orderBy: { sort: 'asc' } } },
    });
    return { ok: true, answersLost: plan.answersLost, questions: fresh.questions };
  });

  app.delete('/admin/polls/:id', { preHandler: requireCap('manage_polls') }, async (req, reply) => {
    const p = await db();
    const poll = await p.poll.findUnique({ where: { id: req.params.id }, select: { id: true, question: true } });
    if (!poll) return reply.code(404).send({ error: 'not_found' });
    await p.poll.delete({ where: { id: poll.id } }); // options + votes cascade
    await logAudit(p, req.user.uid, 'poll.deleted', poll.question, clientIp(req));
    return { ok: true };
  });

  /** Full stats for one poll, including the split nobody should be able to avoid seeing. */
  app.get('/admin/polls/:id/stats', { preHandler: requireCap('manage_polls') }, async (req, reply) => {
    const p = await db();
    const poll = await p.poll.findUnique({
      where: { id: req.params.id },
      include: {
        options: { orderBy: { sort: 'asc' } },
        votes: { include: { user: { select: { id: true, displayName: true, email: true } }, option: { select: { label: true } } }, orderBy: { createdAt: 'desc' } },
        questions: { include: { choices: true }, orderBy: { sort: 'asc' } },
        answers: true,
      },
    });
    if (!poll) return reply.code(404).send({ error: 'not_found' });

    // The counting lives in poll-stats.mjs, where it is tested and mutation-checked, and the
    // richer numbers it produces ride along beside the ones this route already returned.
    // `stats.counts.voters` and this route's `voters` are the same idea computed twice —
    // kept because the shape below is what the admin screen already reads, and quietly
    // changing it would break that screen to save a few lines.
    //
    // The library adds what could not be answered here: turnout over time, picks per voter,
    // days since the last vote, and whether the lead is big enough to mean anything.
    const stats = pollStats(poll, poll.options, poll.votes, new Date());

    // Per-question numbers, present only once a poll HAS questions. Added beside the existing
    // shape rather than replacing it: this route is what the admin screen reads today, and
    // rewriting its response to serve a screen that does not exist yet would break the one
    // that does.
    //
    // A backfilled poll answers both ways and agrees with itself, because both sides count
    // people through the same voterCount rather than each counting rows its own way.
    const perQuestion = (poll.questions || []).map((q) =>
      questionStats(q, poll.answers || [], q.choices || []));

    // What people WROTE, for the free-text questions.
    //
    // questionStats deliberately reports a count and no words — averaging free writing into a
    // "top answer" invents a consensus. But the count on its own made the answers unreachable:
    // people typed, and no screen anywhere ever showed a line of it. So the words go to the
    // admin screen, which is already behind manage_polls, and never to the public card.
    //
    // Newest first and capped: a popular question is thousands of rows, and a stats endpoint
    // that returns all of them is a stats endpoint that times out on the poll worth reading.
    const texts = {};
    for (const q of poll.questions || []) {
      if (q.kind !== 'text') continue;
      texts[q.id] = (poll.answers || [])
        .filter((a) => a.questionId === q.id && typeof a.text === 'string' && a.text.trim() !== '')
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 200)
        .map((a) => a.text.slice(0, 2000));
    }

    // Distinct voters, not ticks: on a multi-choice poll one person can be several rows.
    const voterOf = (v) => (v.userId ? `u:${v.userId}` : `a:${v.voterKey}`);
    const voters = new Set(poll.votes.map(voterOf));
    const userVoters = new Set(poll.votes.filter((v) => v.wasLoggedIn).map(voterOf));

    const byOption = poll.options.map((o) => {
      const rows = poll.votes.filter((v) => v.optionId === o.id);
      return {
        id: o.id, label: o.label,
        users: rows.filter((v) => v.wasLoggedIn).length,
        anon: rows.filter((v) => !v.wasLoggedIn).length,
        total: rows.length,
      };
    });

    const byDay = new Map();
    for (const v of poll.votes) {
      const d = v.createdAt.toISOString().slice(0, 10);
      const slot = byDay.get(d) || { day: d, users: 0, anon: 0 };
      slot[v.wasLoggedIn ? 'users' : 'anon'] += 1;
      byDay.set(d, slot);
    }

    return {
      poll: publicPoll(poll, { showResults: true }),
      byOption,
      byDay: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)),
      voters: voters.size,
      userVoters: userVoters.size,
      anonVoters: voters.size - userVoters.size,
      // Named for what it is. An anonymous count is an estimate, and the admin screen says
      // so rather than leaving the reader to assume it is exact.
      anonIsEstimate: poll.audience === 'all',
      // Who answered, when — signed-in voters only. There is nothing to show for an
      // anonymous one, and inventing a row for a fingerprint would suggest otherwise.
      recent: poll.votes.filter((v) => v.user).slice(0, 100).map((v) => ({
        at: v.createdAt, option: v.option.label, user: v.user,
      })),
      // Added beside the existing shape, never replacing it: turnout per day, picks per
      // voter, days since the last vote, and whether the lead is large enough to be called
      // one. `lead.decided` is false under 20 voters or inside a 5% margin — a 3-1 split is
      // a room, not a sample.
      stats,
      // Only when the poll has questions, so the field's presence is the signal rather than an
      // empty array a screen has to distinguish from "none yet".
      ...(perQuestion.length ? {
        questions: perQuestion,
        completion: completion(poll.questions, poll.answers || []),
        // Keyed by question id, so a screen renders what it has and says nothing about what it
        // does not. Empty for a poll with no free-text question, which is most of them.
        texts,
      } : {}),
    };
  });

  /** One user's answers — used by the admin User details panel. */
  app.get('/admin/polls/users/:id', { preHandler: requireCap('manage_polls') }, async (req) => {
    const p = await db();
    const votes = await p.pollVote.findMany({
      where: { userId: req.params.id }, orderBy: { createdAt: 'desc' }, take: 100,
      include: { option: { select: { label: true } }, poll: { select: { id: true, question: true, status: true } } },
    });
    return { votes };
  });
}

// Polls: ask a question, count the answers, and never pretend the count is better than it
// is.
//
// The one design decision everything else follows from: a poll open to everybody cannot be
// deduplicated honestly. A device fingerprint puts two people behind one router in the same
// box and splits one person across their phone and laptop. So anonymous answers are counted
// separately from signed-in ones, everywhere, all the way to the admin screen — a merged
// total would look precise and be wrong, and it is the merged number that gets quoted.
import { z } from 'zod';
import { viewQuestions } from '../lib/poll-view.mjs';
import crypto from 'node:crypto';
import { db, requireRole, requireCap, optionalAuth, logAudit } from '../lib/lib.mjs';
import { clientIp } from '../lib/geo.mjs';
import { pollStats, questionStats, completion } from '../lib/poll-stats.mjs';

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
      where: { status: { in: ['open', 'closed'] } },
      orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
      take: 50,
      include: { options: { orderBy: { sort: 'asc' } }, votes: { select: { optionId: true, wasLoggedIn: true, userId: true, voterKey: true } } },
    });
    return {
      polls: polls
        // A poll for signed-in users is still LISTED to a visitor — hiding it would make the
        // site look emptier than it is, and "sign in to answer" is a better invitation than
        // a blank page.
        .map((poll) => {
          const mine = myVotesOf(req, poll);
          return publicPoll(poll, { myVotes: mine, showResults: canSeeResults(poll, mine.length > 0) });
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
    if (!poll || poll.status === 'draft') return reply.code(404).send({ error: 'not_found' });
    const mine = myVotesOf(req, poll);
    const body = publicPoll(poll, { myVotes: mine, showResults: canSeeResults(poll, mine.length > 0) });
    // Additive, and deliberately alongside `options` rather than replacing it. Every backfilled
    // poll has exactly one question saying the same thing as `question` + `options`, so the
    // current client keeps working untouched while the multi-question reader is built. The old
    // fields go when nothing reads them, not before — that is the whole point of the order.
    const questions = viewQuestions(poll);
    if (questions.length) body.questions = questions;
    return body;
  });

  app.post('/polls/:id/vote', { preHandler: optionalAuth(), config: { rateLimit: { max: 20, timeWindow: '5 minutes' } } }, async (req, reply) => {
    const b = z.object({ optionIds: z.array(z.string()).min(1).max(20) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const poll = await p.poll.findUnique({ where: { id: req.params.id }, include: { options: { select: { id: true } } } });
    if (!poll || poll.status === 'draft') return reply.code(404).send({ error: 'not_found' });
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

  /** Withdraw an answer. A poll you cannot un-answer is a poll people hesitate to answer. */
  app.delete('/polls/:id/vote', { preHandler: optionalAuth() }, async (req, reply) => {
    const p = await db();
    const poll = await p.poll.findUnique({ where: { id: req.params.id } });
    if (!poll) return reply.code(404).send({ error: 'not_found' });
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

  /** The polls one user answered — for the profile, and for admin User details. */
  app.get('/me/polls', { preHandler: requireRole() }, async (req) => {
    const p = await db();
    const votes = await p.pollVote.findMany({
      where: { userId: req.user.uid }, orderBy: { createdAt: 'desc' }, take: 100,
      include: { option: { select: { label: true } }, poll: { select: { id: true, question: true, status: true } } },
    });
    return { votes };
  });

  // ── Admin (manage_polls) ────────────────────────────────────────────────────

  const pollBody = z.object({
    question: z.string().min(3).max(300),
    description: z.string().max(2000).default(''),
    audience: z.enum(['users', 'all']).default('users'),
    multiple: z.boolean().default(false),
    maxChoices: z.number().int().min(0).max(20).default(0),
    status: z.enum(['draft', 'open', 'closed']).default('draft'),
    opensAt: z.string().datetime().nullable().optional(),
    closesAt: z.string().datetime().nullable().optional(),
    results: z.enum(['always', 'after_vote', 'staff']).default('after_vote'),
    pinned: z.boolean().default(false),
    options: z.array(z.string().min(1).max(200)).min(2).max(20),
  });

  app.get('/admin/polls', { preHandler: requireCap('manage_polls') }, async () => {
    const p = await db();
    const polls = await p.poll.findMany({
      orderBy: [{ createdAt: 'desc' }],
      include: {
        options: { orderBy: { sort: 'asc' } },
        votes: { select: { optionId: true, wasLoggedIn: true, userId: true, voterKey: true } },
        createdBy: { select: { displayName: true } },
      },
    });
    return {
      polls: polls.map((poll) => ({
        ...publicPoll(poll, { showResults: true }),
        author: poll.createdBy?.displayName || null,
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
    const poll = await p.poll.update({
      where: { id: existing.id },
      data: {
        ...rest,
        ...(opensAt !== undefined ? { opensAt: opensAt ? new Date(opensAt) : null } : {}),
        ...(closesAt !== undefined ? { closesAt: closesAt ? new Date(closesAt) : null } : {}),
      },
      include: { options: { orderBy: { sort: 'asc' } } },
    });
    await logAudit(p, req.user.uid, 'poll.updated', poll.question, clientIp(req));
    return { ok: true, poll };
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

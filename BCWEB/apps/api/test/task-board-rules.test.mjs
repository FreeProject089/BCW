// The task board's second pass, pure: several people on a task, links, the site's proposals,
// and the capability model — including a non-escalation matrix that is MUTATION-CHECKED here,
// in the suite, rather than once by hand.
//
// The matrix's expectations are written from the owner's sentences, in `spec` below, and NOT
// from lib/tasks.mjs. A matrix that asks the implementation what the answer should be tests
// nothing: it agrees with every bug.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as tasks from '../src/lib/tasks.mjs';
import { scrub, candidatesFrom, planSuggestions, canSeeSuggestion, safeHref, SNOOZE_MS, STALE_MS } from '../src/lib/task-suggest.mjs';

const {
  assignmentChange, wouldCycle, linkFromSide, canLink, visibilityWhere, MAX_ASSIGNEES, tasksToRelease, canEdit, canSetState,
} = tasks;

const HERE = dirname(fileURLToPath(import.meta.url));
const T = 'team-1';
const task = (over = {}) => ({ id: 't1', title: 'x', state: 'todo', priority: 'normal', teamId: T, assigneeIds: ['u-mem'], creatorId: 'u-chief', ...over });
const members = [{ teamId: T, userId: 'u-mem' }, { teamId: T, userId: 'u-chief' }, { teamId: T, userId: 'u-mem2' }, { teamId: 'team-2', userId: 'u-far' }];
const chief = { uid: 'u-chief', role: 'MOD', perms: [] };
const member = { uid: 'u-mem', role: 'MOD', perms: [] };
const disp = { uid: 'u-disp', role: 'USER', perms: ['manage_tasks'] };
const ctxChief = { chiefOf: [T], memberOf: [T] };
const ctxMember = { chiefOf: [], memberOf: [T] };

describe('several people on one task', () => {
  test('a chief puts two of their own team on it; nobody from elsewhere', () => {
    const ok = assignmentChange(chief, task(), ['u-mem', 'u-mem2'], members, ctxChief);
    assert.equal(ok.ok, true);
    assert.deepEqual(ok.added, ['u-mem2']);
    assert.equal(assignmentChange(chief, task(), ['u-mem', 'u-far'], members, ctxChief).error, 'cannot_assign');
  });
  test('a dispatcher picks from every team', () => {
    assert.equal(assignmentChange(disp, task(), ['u-mem', 'u-far'], members, {}).ok, true);
  });
  test('a member may take themselves off, and nobody else', () => {
    const t = task({ assigneeIds: ['u-mem', 'u-mem2'] });
    assert.equal(assignmentChange(member, t, ['u-mem2'], members, ctxMember).ok, true, 'not me');
    assert.equal(assignmentChange(member, t, ['u-mem'], members, ctxMember).ok, false, 'not you');
    assert.equal(assignmentChange(member, t, ['u-mem', 'u-mem2', 'u-chief'], members, ctxMember).ok, false, 'nor adding somebody');
  });
  test('taking from the pool needs standing and an empty task', () => {
    const pool = task({ assigneeIds: [] });
    assert.equal(assignmentChange(member, pool, ['u-mem'], members, ctxMember).ok, true);
    assert.equal(assignmentChange(member, task({ assigneeIds: ['u-mem2'] }), ['u-mem2', 'u-mem'], members, ctxMember).ok, false,
      'joining somebody else\'s task is the chief\'s call');
    assert.equal(assignmentChange({ uid: 'u-x', role: 'MOD', perms: [] }, pool, ['u-x'], members, {}).ok, false, 'no standing, no grab');
  });
  test('a cap, and a closed task keeps its people', () => {
    const many = Array.from({ length: MAX_ASSIGNEES + 1 }, (_, i) => `u${i}`);
    assert.equal(assignmentChange(disp, task(), many, members.concat(many.map((userId) => ({ teamId: T, userId }))), {}).error, 'too_many_assignees');
    assert.equal(assignmentChange(chief, task({ state: 'done' }), [], members, ctxChief).error, 'task_closed');
  });
  test('any of the people on it moves it; the author may edit only while nobody else is on it', () => {
    const t = task({ assigneeIds: ['u-mem', 'u-mem2'] });
    assert.equal(canSetState({ uid: 'u-mem2', role: 'MOD', perms: [] }, t, 'done', ctxMember), true);
    const own = { uid: 'u-a', role: 'MOD', perms: [] };
    assert.equal(canEdit(own, task({ creatorId: 'u-a', teamId: null, assigneeIds: ['u-a'] }), {}), true);
    assert.equal(canEdit(own, task({ creatorId: 'u-a', teamId: null, assigneeIds: ['u-a', 'u-b'] }), {}), false);
  });
  test('leaving a team releases the person, not the task', () => {
    const rows = [{ id: 'a', assigneeIds: ['u-mem', 'u-mem2'], state: 'todo', teamId: T }, { id: 'b', assigneeIds: ['u-mem'], state: 'done', teamId: T }];
    assert.deepEqual(tasksToRelease(rows, 'u-mem', T), ['a']);
  });
});

describe('the list only fetches what the viewer may read', () => {
  test('a reader of everything gets no filter, anybody else a closed one', () => {
    assert.deepEqual(visibilityWhere({ uid: 'u', role: 'USER', perms: ['view_tasks'] }, {}), {});
    const w = visibilityWhere(member, ctxMember);
    assert.deepEqual(w.OR, [{ assigneeIds: { has: 'u-mem' } }, { creatorId: 'u-mem' }, { teamId: { in: [T] } }]);
    assert.equal(visibilityWhere({ uid: 'u', role: 'USER', perms: ['manage_faq'] }, {}).OR.length, 2, 'no team, no team clause');
  });
});

describe('links', () => {
  const e = (fromId, toId) => ({ fromId, toId });
  test('a cycle, of any length, is refused', () => {
    assert.equal(wouldCycle([], 'a', 'a'), true, 'a task blocking itself');
    assert.equal(wouldCycle([e('a', 'b')], 'b', 'a'), true);
    assert.equal(wouldCycle([e('a', 'b'), e('b', 'c'), e('c', 'd')], 'd', 'a'), true);
    assert.equal(wouldCycle([e('a', 'b'), e('b', 'c')], 'a', 'c'), false, 'a shortcut is not a cycle');
    assert.equal(wouldCycle([e('a', 'b'), e('c', 'd')], 'b', 'c'), false);
  });
  test('the same row reads as blocks from one end and blocked by from the other', () => {
    const l = { fromId: 'a', toId: 'b', kind: 'blocks' };
    assert.deepEqual(linkFromSide(l, 'a'), { kind: 'blocks', otherId: 'b' });
    assert.deepEqual(linkFromSide(l, 'b'), { kind: 'blocked_by', otherId: 'a' });
    assert.deepEqual(linkFromSide({ fromId: 'a', toId: 'b', kind: 'relates' }, 'b'), { kind: 'relates', otherId: 'a' });
  });
  test('linking needs the right to edit one end and to READ the other', () => {
    const mine = task();
    const theirs = task({ id: 't2', teamId: 'team-2', assigneeIds: [], creatorId: 'u-far' });
    assert.equal(canLink(chief, mine, theirs, ctxChief), false, 'another team\'s task stays invisible');
    assert.equal(canLink(disp, mine, theirs, {}), true);
    assert.equal(canLink(member, mine, task({ id: 't3' }), ctxMember), false, 'a member does not edit');
  });
});

describe('proposals from the site', () => {
  test('scrub removes every URL, path, query, token, e-mail and IP, and keeps the words', () => {
    const raw = 'Cannot GET /r/cmf1abc2def3ghi4jkl?k=9f3c2a7b1e0d4c5b6a79 from https://x.test/a?token=abc '
      + 'auth Bearer eyJhbGciOi.eyJzdWIiOjF9.sig for bob@example.com at 10.0.0.7:5432 password=hunter2 '
      + 'PrismaClientKnownRequestError 3/4 done\u0000';
    const out = scrub(raw, 1000);
    for (const bad of ['/r/', 'cmf1abc', '9f3c2a7b', 'k=9', 'x.test', 'token=abc', 'eyJ', 'bob@', 'example.com', '10.0.0.7', 'hunter2', '\u0000']) {
      assert.equal(out.includes(bad), false, `"${bad}" survived: ${out}`);
    }
    assert.match(out, /Cannot GET \[path\]/);
    assert.match(out, /PrismaClientKnownRequestError/, 'a class name is a word, not a token');
    assert.match(out, /3\/4 done/, 'a fraction is not a path');
    assert.equal(scrub('x'.repeat(400)).length, 160);
  });
  test('the secret-bearing PATH forms are gone too', () => {
    for (const p of ['/threads/t/ab12cd34ef56gh78ij90', '/f/Zx9Yw8Vu7Ts6Rq5Po4', '/auth/oauth/link/tok123tok456tok789']) {
      const out = scrub(`failed at ${p}`);
      assert.equal(out, 'failed at [path]', out);
    }
  });
  test('one proposal per incident, and no queue item is ever copied', () => {
    const c = candidatesFrom({
      outages: [{ id: 'o1', dep: 'db', label: 'Database', startedAt: '2026-09-23T08:00:00Z' }],
      queues: [
        { key: 'dataRequests', cap: 'manage_users', to: '/admin?s=contact', n: 3 },
        { key: 'submissions', cap: 'manage_catalogs', to: '/admin?s=moderation', n: 0 },
        { key: 'alerts', cap: 'manage_server', to: '/admin?s=serverperf', n: 2 },
      ],
      alerts: [{ id: 'a1', title: 'CPU at 95% on /r/secret?k=abc123abc123abc123', sub: 'cpu' }],
      errors: [{ id: 'g1', title: 'boom at https://evil.test/?k=1', sub: 'server · ×12' }],
    });
    assert.deepEqual(c.map((x) => x.dedupKey), ['status:o1', 'pending:dataRequests', 'alert:a1', 'error:g1'],
      'an empty queue proposes nothing; alerts/errors are per ROW, not also as a queue');
    const dr = c.find((x) => x.dedupKey === 'pending:dataRequests');
    assert.equal(dr.sourceCap, 'manage_users');
    assert.equal(/\d/.test(dr.title + dr.body), false, 'not even the count goes into the text');
    assert.equal(dr.count, 3, 'the count lives on the proposal, for the people who may see the queue');
    const all = JSON.stringify(c);
    for (const bad of ['secret', 'abc123', 'evil.test', 'k=1']) assert.equal(all.includes(bad), false, bad);
    assert.equal(c.find((x) => x.source === 'error').priority, 'high', '×12 is a lot');
    assert.equal(c.find((x) => x.source === 'status').sourceCap, null, 'the status page is public');
  });
  test('a link is an admin path from the fixed list, or nothing', () => {
    assert.equal(safeHref('/admin?s=errors'), '/admin?s=errors');
    assert.equal(safeHref('/admin?s=messages&k=legal'), '/admin?s=messages&k=legal');
    for (const bad of ['https://evil.test', '//evil.test', '/r/x?k=y', 'javascript:alert(1)', '/admin?s=x&k=y&z=1']) assert.equal(safeHref(bad), null, bad);
  });
  test('the plan: create, refresh, keep a decision, reopen when the work is over, withdraw what cleared', () => {
    const now = Date.parse('2026-09-23T12:00:00Z');
    const cand = (k, source = 'error') => ({ dedupKey: k, source, title: 't', body: 'b', priority: 'normal', count: 2, href: null, sourceCap: 'manage_analytics' });
    const rows = [
      { id: 'r-open', dedupKey: 'error:open', source: 'error', state: 'open', lastSeenAt: new Date(now - 10e3) },
      { id: 'r-acc-live', dedupKey: 'error:acc-live', source: 'error', state: 'accepted', taskId: 'tl' },
      { id: 'r-acc-done', dedupKey: 'error:acc-done', source: 'error', state: 'accepted', taskId: 'td' },
      { id: 'r-dis-new', dedupKey: 'error:dis-new', source: 'error', state: 'dismissed', decidedAt: new Date(now - 1000) },
      { id: 'r-dis-old', dedupKey: 'error:dis-old', source: 'error', state: 'dismissed', decidedAt: new Date(now - SNOOZE_MS - 1) },
      { id: 'r-gone', dedupKey: 'error:gone', source: 'error', state: 'open', lastSeenAt: new Date(now - STALE_MS - 1) },
      { id: 'r-gone-fresh', dedupKey: 'error:gone2', source: 'error', state: 'open', lastSeenAt: new Date(now - 1000) },
      { id: 'r-unread', dedupKey: 'status:x', source: 'status', state: 'open', lastSeenAt: new Date(now - STALE_MS - 1) },
    ];
    const plan = planSuggestions(
      ['new', 'open', 'acc-live', 'acc-done', 'dis-new', 'dis-old', 'new'].map((k) => cand(`error:${k}`)),
      rows, { tl: 'in_progress', td: 'done' }, ['error'], now,
    );
    const by = Object.fromEntries(plan.map((o) => [o.id || o.data.dedupKey, o.op]));
    assert.equal(plan.filter((o) => o.op === 'create').length, 1, 'the same incident twice in one scan is one proposal');
    assert.equal(by['error:new'], 'create');
    assert.equal(by['r-open'], 'refresh');
    assert.equal(by['r-acc-live'], 'touch', 'accepted and still being worked: leave it alone');
    assert.equal(by['r-acc-done'], 'reopen', 'the work is done and the condition is back');
    assert.equal(by['r-dis-new'], 'touch', 'a dismissal is respected');
    assert.equal(by['r-dis-old'], 'reopen', 'until the snooze runs out');
    assert.equal(by['r-gone'], 'expire');
    assert.equal(by['r-gone-fresh'], undefined, 'not withdrawn on one missed scan');
    assert.equal(by['r-unread'], undefined, 'a source that was not read withdraws nothing');
  });
  test('a proposal is shown only to somebody who could read its source', () => {
    const s = { sourceCap: 'manage_analytics' };
    assert.equal(canSeeSuggestion(disp, s), false, 'dispatching tasks is not reading the error log');
    assert.equal(canSeeSuggestion({ ...disp, perms: ['manage_tasks', 'manage_analytics'] }, s), true);
    assert.equal(canSeeSuggestion({ uid: 'a', role: 'ADMIN', perms: [] }, { sourceCap: 'manage_server' }), true);
    assert.equal(canSeeSuggestion({ ...disp, perms: ['manage_tasks', 'manage_analytics'] }, { sourceCap: 'manage_server' }), false,
      'manage_server is no grant at all: admin-only');
    assert.equal(canSeeSuggestion(disp, { sourceCap: null }), true);
  });
});

// ── Non-escalation, pure ───────────────────────────────────────────────────────────────────
//
// Every role × every subset of the three task capabilities × every team standing, against
// every "may I" the board asks. `spec` is the owner's rules, restated from scratch.

const ROLES = ['USER', 'MOD', 'ADMIN', 'SUPERADMIN'];
const CAPS = ['view_tasks', 'manage_tasks', 'manage_teams'];
const SUBSETS = [0, 1, 2, 3, 4, 5, 6, 7].map((m) => CAPS.filter((_, i) => m & (1 << i)));
const STANDINGS = ['none', 'member', 'chief'];

function actors() {
  const out = [];
  for (const role of ROLES) for (const caps of SUBSETS) for (const standing of STANDINGS) {
    out.push({ role, caps, standing, user: { uid: 'me', role, perms: [...caps, 'manage_faq'] } });
  }
  return out;
}

/** The rules as sentences. Nothing here imports lib/tasks.mjs. */
function spec(a) {
  const admin = a.role === 'ADMIN' || a.role === 'SUPERADMIN';
  const has = (c) => admin || a.caps.includes(c);
  const dispatch = has('manage_tasks');
  const chief = a.standing === 'chief';
  const onTeam = a.standing !== 'none';
  return {
    viewTeamTask: dispatch || has('view_tasks') || onTeam,
    assign: dispatch || chief,
    cancel: dispatch || chief,
    moveTeam: dispatch,
    del: admin,
    runTeams: has('manage_teams'),
    nameChiefOther: has('manage_teams') && dispatch,
    nameChiefSelf: admin,
    addStaff: (has('manage_teams') && dispatch) || chief,
    addOutsider: has('manage_teams') && dispatch,
    addSelf: admin,
    removeOther: has('manage_teams') || chief,
  };
}

function decide(lib, a) {
  const ctx = a.standing === 'chief' ? { chiefOf: [T], memberOf: [T] } : a.standing === 'member' ? { chiefOf: [], memberOf: [T] } : {};
  const team = { id: T, chiefId: a.standing === 'chief' ? 'me' : 'u-chief' };
  const t = { id: 'x', state: 'todo', teamId: T, assigneeIds: ['u-other'], creatorId: 'u-other' };
  const u = a.user;
  return {
    viewTeamTask: lib.canView(u, t, ctx),
    assign: lib.canAssign(u, t, ctx),
    cancel: lib.canSetState(u, t, 'cancelled', ctx),
    moveTeam: lib.canMoveTeam(u),
    del: lib.canDelete(u),
    runTeams: lib.canRunTeams(u),
    nameChiefOther: lib.canNameChief(u, 'u-other'),
    nameChiefSelf: lib.canNameChief(u, 'me'),
    addStaff: lib.canAddMember(u, team, { id: 'u-other', staff: true }, ctx),
    addOutsider: lib.canAddMember(u, team, { id: 'u-out', staff: false }, ctx),
    addSelf: lib.canAddMember(u, team, { id: 'me', staff: true }, ctx),
    removeOther: lib.canRemoveMember(u, team, 'u-other', ctx),
  };
}

function mismatches(lib) {
  const bad = [];
  for (const a of actors()) {
    const want = spec(a);
    const got = decide(lib, a);
    for (const k of Object.keys(want)) {
      if (want[k] !== got[k]) bad.push(`${a.role}+[${a.caps.join(',')}]/${a.standing} ${k}: want ${want[k]} got ${got[k]}`);
    }
  }
  return bad;
}

describe('non-escalation matrix (pure)', () => {
  test(`${ROLES.length} roles × ${SUBSETS.length} capability sets × ${STANDINGS.length} standings × 12 decisions agree with the spec`, () => {
    const bad = mismatches(tasks);
    assert.deepEqual(bad, [], bad.slice(0, 10).join('\n'));
  });

  // Each mutant is one guard written the way it would plausibly be got wrong. The matrix must
  // catch every one of them; a mutant that survives is a rule the matrix does not test.
  const MUTANTS = {
    'naming a chief needs only manage_teams': ['if (!canRunTeams(user) || !isDispatcher(user)) return false;', 'if (!canRunTeams(user)) return false;'],
    'you may name yourself chief': ['return isAdmin(user) || targetId !== user.uid;', 'return true;'],
    'a chief may bring in an outsider': ['return isChiefOf(user, team, ctx) && !!target.staff;', 'return isChiefOf(user, team, ctx);'],
    'you may add yourself': ["if (target.id === user.uid && !isAdmin(user)) return false;", ''],
    'manage_teams alone adds members': ['if (canRunTeams(user) && isDispatcher(user)) return true;', 'if (canRunTeams(user)) return true;'],
    'a dispatcher may delete': ['export const canDelete = (user) => isAdmin(user);', 'export const canDelete = (user) => isDispatcher(user);'],
    'a chief may move a task between teams': ['export const canMoveTeam = (user) => isDispatcher(user);', 'export const canMoveTeam = (user) => !!user;'],
    'view_tasks dispatches': ["export const isDispatcher = (user) => !!user && canDispatchTasks(user);", "export const isDispatcher = (user) => !!user && (canDispatchTasks(user) || (user.perms || []).includes('view_tasks'));"],
    'a member counts as a chief': ["if (task?.teamId && chiefOf.includes(task.teamId)) return 'chief';", "if (task?.teamId && memberOf.includes(task.teamId)) return 'chief';"],
    'every account sees every task': ['export const seesAllTasks = (user) => !!user && canReadAllTasks(user);', 'export const seesAllTasks = (user) => !!user;'],
    'removing a member needs nothing': ['if (targetId === user.uid) return true;\n  return canRunTeams(user) || isChiefOf(user, team, ctx);', 'return true;'],
  };
  const src = readFileSync(join(HERE, '../src/lib/tasks.mjs'), 'utf8');
  const libUrl = pathToFileURL(join(HERE, '../src/lib/lib.mjs')).href;

  for (const [name, [from, to]] of Object.entries(MUTANTS)) {
    test(`mutant killed: ${name}`, async () => {
      assert.equal(src.split(from).length, 2, `the guard to mutate is not in lib/tasks.mjs any more: ${from}`);
      const dir = mkdtempSync(join(tmpdir(), 'tasks-mutant-'));
      try {
        const file = join(dir, 'tasks.mjs');
        writeFileSync(file, src.replace(from, to).replace("from './lib.mjs'", `from '${libUrl}'`));
        const mutant = await import(pathToFileURL(file).href);
        assert.ok(mismatches(mutant).length > 0, `the matrix did not notice "${name}"`);
      } finally { rmSync(dir, { recursive: true, force: true }); }
    });
  }
});

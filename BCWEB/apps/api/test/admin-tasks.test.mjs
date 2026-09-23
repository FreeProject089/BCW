// The staff task board's rules, pure.
//
// Every assertion here is a sentence somebody could argue with, which is the point: these
// are policy decisions, not arithmetic. If one of them is wrong the right move is to change
// the rule AND the test together, not to loosen the test.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  TASK_STATES, TASK_PRIORITIES, TERMINAL_STATES, isAdmin, isStaffish, standingFor,
  canView, canAssign, canRelease, canEdit, canMoveTeam, canSetState, canComment, canDelete,
  canManageTeam, canRunTeams, assignableIds, tasksToRelease, orphanedByTeamLoss,
  sortTasks, isOverdue, slugifyTeamName, serTask, serEvent, serStaffTeam, statesFor,
} from '../src/lib/tasks.mjs';

const admin = { uid: 'u-admin', role: 'ADMIN', perms: [] };
const chief = { uid: 'u-chief', role: 'MOD', perms: [] };
const member = { uid: 'u-mem', role: 'MOD', perms: [] };
const stranger = { uid: 'u-str', role: 'MOD', perms: [] };
const grantee = { uid: 'u-gr', role: 'USER', perms: ['manage_faq'] };
const outsider = { uid: 'u-out', role: 'USER', perms: [] };

const T = 'team-1';
const ctxChief = { chiefOf: [T], memberOf: [T] };
const ctxMember = { chiefOf: [], memberOf: [T] };
const ctxNone = { chiefOf: [], memberOf: [] };

const task = (over = {}) => ({
  id: 't1', title: 'Check the queue', body: '', state: 'todo', priority: 'normal',
  teamId: T, assigneeIds: ['u-mem'], creatorId: 'u-chief', dueAt: null, createdAt: new Date('2026-09-01'),
  ...over,
});

describe('the door', () => {
  test('the admin surface is the population, not a new capability', () => {
    assert.equal(isStaffish(admin), true);
    assert.equal(isStaffish(chief), true, 'a moderator is staff');
    assert.equal(isStaffish(grantee), true, 'somebody who holds a granted capability does the work a task is about');
    assert.equal(isStaffish(outsider), false);
    assert.equal(isStaffish(outsider, true), true, 'putting somebody on a staff team is the whole act');
    assert.equal(isStaffish(null), false);
  });
  test('admin is the role, not a capability bundle', () => {
    assert.equal(isAdmin(admin), true);
    assert.equal(isAdmin({ uid: 'x', role: 'SUPERADMIN' }), true);
    assert.equal(isAdmin(chief), false);
    assert.equal(isAdmin(grantee), false);
  });
});

describe('standing', () => {
  test('chief inside their team, member on theirs, nothing elsewhere', () => {
    assert.equal(standingFor(admin, task(), ctxNone), 'admin', 'an admin needs no membership');
    assert.equal(standingFor(chief, task(), ctxChief), 'chief');
    assert.equal(standingFor(member, task(), ctxMember), 'member');
    assert.equal(standingFor(stranger, task(), ctxNone), 'none');
    assert.equal(standingFor(chief, task({ teamId: 'other' }), ctxChief), 'none',
      'a chief outside their own team is an ordinary account');
  });
  test('an unfiled task has no chief, by construction', () => {
    assert.equal(standingFor(chief, task({ teamId: null }), ctxChief), 'none');
    assert.equal(standingFor(admin, task({ teamId: null }), ctxNone), 'admin');
  });
});

describe('who may see it', () => {
  test('the team sees the team’s work; a stranger sees nothing', () => {
    assert.equal(canView(member, task(), ctxMember), true);
    assert.equal(canView(stranger, task(), ctxNone), false);
  });
  test('the person it is on, and the person who asked, always see it', () => {
    const t = task({ teamId: 'other', assigneeIds: [stranger.uid] });
    assert.equal(canView(stranger, t, ctxNone), true, 'assignee');
    assert.equal(canView(chief, task({ teamId: 'other' }), ctxNone), true, 'creator');
  });
});

describe('who may hand the work out', () => {
  const members = [
    { teamId: T, userId: 'u-mem' }, { teamId: T, userId: 'u-chief' },
    { teamId: 'team-2', userId: 'u-str' },
  ];
  test('an admin dispatches across teams, a chief only inside their own', () => {
    assert.deepEqual(assignableIds(admin, task(), members, ctxNone), ['u-mem', 'u-chief', 'u-str']);
    assert.deepEqual(assignableIds(chief, task(), members, ctxChief), ['u-mem', 'u-chief']);
  });
  test('a member may hand nobody anything', () => {
    assert.deepEqual(assignableIds(member, task(), members, ctxMember), []);
    assert.equal(canAssign(member, task(), ctxMember), false);
    assert.equal(canAssign(chief, task(), ctxChief), true);
    assert.equal(canAssign(admin, task(), ctxNone), true);
  });
  test('"not me" is always sayable, "you" never is', () => {
    assert.equal(canRelease(member, task(), ctxMember), true, 'the assignee can hand it back');
    assert.equal(canRelease(stranger, task({ assigneeIds: ['u-mem'] }), ctxNone), false);
    assert.equal(canRelease(member, task({ state: 'done' }), ctxMember), false, 'a closed task is not handed back');
  });
  test('an unfiled task can be dispatched by nobody but an admin', () => {
    const unfiled = task({ teamId: null, assigneeIds: [] });
    assert.deepEqual(assignableIds(chief, unfiled, members, ctxChief), []);
    assert.equal(assignableIds(admin, unfiled, members, ctxNone).length, 3);
  });
});

describe('who may change the wording', () => {
  test('senior standings always; the author only until somebody else holds it', () => {
    assert.equal(canEdit(admin, task(), ctxNone), true);
    assert.equal(canEdit(chief, task(), ctxChief), true);
    assert.equal(canEdit(member, task(), ctxMember), false, 'the assignee works from the wording, they do not own it');
    const mine = task({ creatorId: stranger.uid, assigneeIds: [], teamId: 'other' });
    assert.equal(canEdit(stranger, mine, ctxNone), true, 'an author may correct an unassigned task');
    assert.equal(canEdit(stranger, { ...mine, assigneeIds: ['u-mem'] }, ctxNone), false,
      'changing the wording under the person doing the work is how it gets done wrong');
  });
  test('moving a task between teams crosses a boundary, so it is admin-only', () => {
    assert.equal(canMoveTeam(admin), true);
    assert.equal(canMoveTeam(chief), false);
  });
});

describe('states', () => {
  test('the assignee owns the progress and nothing else', () => {
    assert.equal(canSetState(member, task(), 'in_progress', ctxMember), true);
    assert.equal(canSetState(member, task(), 'done', ctxMember), true);
    assert.equal(canSetState(member, task(), 'cancelled', ctxMember), false,
      'whether the work should happen at all is not the assignee’s call');
  });
  test('cancelling is the chief’s, the admin’s, or the author’s on an untouched task', () => {
    assert.equal(canSetState(chief, task(), 'cancelled', ctxChief), true);
    assert.equal(canSetState(admin, task(), 'cancelled', ctxNone), true);
    const own = task({ creatorId: stranger.uid, assigneeIds: [], teamId: 'other' });
    assert.equal(canSetState(stranger, own, 'cancelled', ctxNone), true);
    assert.equal(canSetState(stranger, { ...own, assigneeIds: ['u-mem'] }, 'cancelled', ctxNone), false);
  });
  test('reopening takes the same standing as closing', () => {
    const closed = task({ state: 'done' });
    assert.equal(canSetState(member, closed, 'todo', ctxMember), false);
    assert.equal(canSetState(chief, closed, 'todo', ctxChief), true);
  });
  test('an unknown state is refused, and statesFor never offers the current one', () => {
    assert.equal(canSetState(admin, task(), 'wat', ctxNone), false);
    const offered = statesFor(member, task(), ctxMember);
    assert.equal(offered.includes('todo'), false, 'already there');
    assert.equal(offered.includes('cancelled'), false);
    assert.deepEqual(offered, ['in_progress', 'blocked', 'done']);
  });
});

describe('notes and deletion', () => {
  test('anyone who can read it can answer it', () => {
    assert.equal(canComment(member, task(), ctxMember), true);
    assert.equal(canComment(stranger, task(), ctxNone), false);
  });
  test('deleting destroys the history, so only an admin may', () => {
    assert.equal(canDelete(admin), true);
    assert.equal(canDelete(chief), false);
  });
});

describe('teams', () => {
  const team = { id: T, chiefId: chief.uid };
  test('the chief runs the membership, the admin runs the team', () => {
    assert.equal(canManageTeam(chief, team), true);
    assert.equal(canManageTeam(admin, team), true);
    assert.equal(canManageTeam(member, team), false);
    assert.equal(canRunTeams(chief), false, 'a chief may not name a chief, including elsewhere');
    assert.equal(canRunTeams(admin), true);
  });
});

describe('what happens when somebody leaves', () => {
  const tasks = [
    { id: 'a', assigneeIds: ['u-mem'], state: 'todo', teamId: T },
    { id: 'b', assigneeIds: ['u-mem'], state: 'in_progress', teamId: T },
    { id: 'c', assigneeIds: ['u-mem'], state: 'done', teamId: T },
    { id: 'd', assigneeIds: ['u-mem'], state: 'cancelled', teamId: T },
    { id: 'e', assigneeIds: ['u-other'], state: 'todo', teamId: T },
    { id: 'f', assigneeIds: ['u-mem'], state: 'todo', teamId: 'team-2' },
  ];
  test('their open work goes back to the pool; their finished work keeps their name', () => {
    assert.deepEqual(tasksToRelease(tasks, 'u-mem', T), ['a', 'b'],
      'done and cancelled keep their assignee: the row records who did the work');
  });
  test('leaving one team does not empty their queue in another', () => {
    assert.deepEqual(tasksToRelease(tasks, 'u-mem', 'team-2'), ['f']);
    assert.deepEqual(tasksToRelease(tasks, 'u-mem'), ['a', 'b', 'f'], 'no team = every team');
  });
  test('dissolving a team unassigns its open work and leaves the rest alone', () => {
    assert.deepEqual(orphanedByTeamLoss(tasks), ['a', 'b', 'e', 'f']);
    assert.deepEqual(orphanedByTeamLoss([]), []);
  });
});

describe('the order the board reads in', () => {
  test('open before finished, then priority, then the due date, then newest', () => {
    const rows = [
      { id: 'done-urgent', state: 'done', priority: 'urgent', createdAt: '2026-09-10' },
      { id: 'low', state: 'todo', priority: 'low', createdAt: '2026-09-10' },
      { id: 'urgent', state: 'todo', priority: 'urgent', createdAt: '2026-09-10' },
      { id: 'high-due', state: 'todo', priority: 'high', dueAt: '2026-09-20', createdAt: '2026-09-10' },
      { id: 'high-nodue', state: 'todo', priority: 'high', createdAt: '2026-09-11' },
    ];
    assert.deepEqual(sortTasks(rows).map((r) => r.id),
      ['urgent', 'high-due', 'high-nodue', 'low', 'done-urgent']);
  });
  test('a deadline is information, its absence is not: no due date sorts last within a priority', () => {
    const rows = [
      { id: 'none', state: 'todo', priority: 'normal', createdAt: '2026-09-01' },
      { id: 'soon', state: 'todo', priority: 'normal', dueAt: '2026-09-18', createdAt: '2026-09-01' },
    ];
    assert.deepEqual(sortTasks(rows).map((r) => r.id), ['soon', 'none']);
  });
  test('sortTasks does not mutate its input', () => {
    const rows = [{ id: 'a', state: 'done', priority: 'low' }, { id: 'b', state: 'todo', priority: 'urgent' }];
    sortTasks(rows);
    assert.equal(rows[0].id, 'a');
  });
});

describe('overdue', () => {
  const now = new Date('2026-09-17T12:00:00Z');
  test('only an OPEN task can be overdue', () => {
    assert.equal(isOverdue({ state: 'todo', dueAt: '2026-09-16T00:00:00Z' }, now), true);
    assert.equal(isOverdue({ state: 'todo', dueAt: '2026-09-18T00:00:00Z' }, now), false);
    assert.equal(isOverdue({ state: 'done', dueAt: '2026-09-16T00:00:00Z' }, now), false,
      'a finished task cannot be late, it is finished');
    assert.equal(isOverdue({ state: 'todo', dueAt: null }, now), false);
    assert.equal(isOverdue(null, now), false);
  });
});

describe('shapes', () => {
  test('the vocabulary is what the schema comments and the zod enums say', () => {
    assert.deepEqual(TASK_STATES, ['todo', 'in_progress', 'blocked', 'done', 'cancelled']);
    assert.deepEqual(TASK_PRIORITIES, ['low', 'normal', 'high', 'urgent']);
    assert.deepEqual(TERMINAL_STATES, ['done', 'cancelled']);
  });
  test('serTask is an allowlist, so a column added later cannot leak by accident', () => {
    const out = serTask({ ...task(), secretInternalNote: 'nope', updatedAt: null, closedAt: null, closedById: null });
    assert.equal('secretInternalNote' in out, false);
    assert.equal(out.title, 'Check the queue');
    assert.equal(out.overdue, false);
    assert.equal(serTask(null), null);
  });
  test('serEvent renames the columns to what a reader calls them', () => {
    const e = serEvent({ id: 'e1', kind: 'assigned', actorId: 'a', fromValue: null, toValue: 'b', note: '', createdAt: 1 });
    assert.deepEqual(e, { id: 'e1', kind: 'assigned', actorId: 'a', from: null, to: 'b', note: '', createdAt: 1 });
  });
  test('serStaffTeam carries the chief, because a team without one cannot dispatch', () => {
    assert.equal(serStaffTeam({ id: 'x', name: 'n', slug: 's', chiefId: 'c' }).chiefId, 'c');
    assert.equal(serStaffTeam(null), null);
  });
  test('a team name always yields a usable slug', () => {
    assert.equal(slugifyTeamName('Modération & Catalogues'), 'moderation-catalogues');
    assert.equal(slugifyTeamName('   '), 'team', 'never an empty slug');
    assert.equal(slugifyTeamName('!!!'), 'team');
    assert.equal(slugifyTeamName('x'.repeat(80)).length, 40);
  });
});

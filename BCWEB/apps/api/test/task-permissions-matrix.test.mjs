// Non-escalation, over HTTP: every capability-gated task/team route, every role, every subset
// of the three task capabilities, the team standings, a custom role, a SCOPED custom role, a
// per-project grant — and the routes that hand out capabilities and roles.
//
// HOW IT IS BUILT, AND WHY
//
//   · The expectations come from `oracle()` below, restated from the owner's rules. Nothing in
//     it imports lib/tasks.mjs: a matrix that asks the implementation what the answer is agrees
//     with every bug in it.
//   · The REFUSAL pass sends only the requests the oracle says must be refused — refused
//     requests change nothing, so the whole matrix runs against one fixture — and then checks
//     that nothing changed. A refusal must be a real one: 403/404 (or the 400 the grant routes
//     give for "your own account"), and never `2fa_required` or `unauthenticated`, which would
//     mean the fixture was broken and the matrix measured nothing.
//   · The POSITIVE pass sends each probe once, with the LEAST privileged actor the oracle
//     allows, on fresh fixtures. Without it a probe aimed at a route that does not exist (404)
//     would count as a refusal, and a guard that refused everybody would pass.
//
// MUTATION CHECK. The pure half (test/task-board-rules.test.mjs) mutates lib/tasks.mjs in the
// suite. For this half the report lists the guards that were broken by hand and the probes that
// went red; see the comment at the bottom of this file.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { lockRow, unlockRow } from './row-lock.mjs';

const RUN = !!process.env.DATABASE_URL;
const skip = RUN ? false : 'set DATABASE_URL to a throwaway Postgres to run the task permission matrix';
process.env.JWT_SECRET ||= 'task-matrix-test-secret';

const TAG = `taskmx-${Date.now()}-`;
const CAPS = ['view_tasks', 'manage_tasks', 'manage_teams'];
const SUBSETS = [0, 1, 2, 3, 4, 5, 6, 7].map((m) => CAPS.filter((_, i) => m & (1 << i)));

let p, app, seq = 0;
const A = {};          // actor name → { user, cookie, spec }
const F = {};          // fixture ids
let suggestionsBefore = [];

async function mkUser(name, data = {}) {
  const u = await p.user.create({ data: { email: `${TAG}${name}-${seq++}@bettercommunity.invalid`, displayName: `${TAG}${name}`, role: 'USER', totpEnabled: true, emailVerified: true, ...data } });
  const sess = await p.session.create({ data: { userId: u.id }, select: { id: true } });
  return { user: u, cookie: `bcw_session=${jwt.sign({ uid: u.id, role: u.role, sid: sess.id }, process.env.JWT_SECRET)}` };
}

/**
 * `spec`: role, the capabilities the account EFFECTIVELY holds (a scoped role contributes
 * none, a wide one contributes its list), and its standing on team T.
 */
async function actor(name, spec, data = {}) {
  const made = await mkUser(name, { role: spec.role, permissions: spec.perms || [], ...data });
  A[name] = { ...made, spec };
  return A[name];
}

before(async () => {
  if (!RUN) return;
  const lib = await import('../src/lib/lib.mjs');
  p = await lib.db();
  // The proposals table is snapshotted and put back by BOTH suggestion-touching files, and a
  // scan writes rows from the dev database into it: they take turns (row-lock.mjs).
  await lockRow(p, 'task.suggestions');
  suggestionsBefore = await p.taskSuggestion.findMany();

  // Roles × every subset of the three task capabilities, standing none.
  for (const role of ['USER', 'MOD']) {
    for (const caps of SUBSETS) await actor(`${role}-${caps.join('+') || 'none'}`, { role, caps, standing: 'none', perms: caps });
  }
  await actor('ADMIN', { role: 'ADMIN', caps: [], standing: 'none' });
  await actor('SUPERADMIN', { role: 'SUPERADMIN', caps: [], standing: 'none' });
  await actor('faq', { role: 'USER', caps: ['manage_faq'], standing: 'none', perms: ['manage_faq'] });
  await actor('dispAnalytics', { role: 'USER', caps: ['manage_tasks', 'manage_analytics'], standing: 'none', perms: ['manage_tasks', 'manage_analytics'] });
  await actor('chief', { role: 'MOD', caps: [], standing: 'chief' });
  await actor('member', { role: 'MOD', caps: [], standing: 'member' });
  await actor('userMember', { role: 'USER', caps: [], standing: 'member' });
  // A chief who ALSO shapes teams, but does not dispatch: may rename, may still only add staff.
  await actor('chiefTeams', { role: 'MOD', caps: ['manage_teams'], standing: 'chief', chiefOf: 'T2' }, { permissions: ['manage_teams'] });

  // Capabilities through a custom role: a wide one counts, a scoped one grants nothing.
  const wide = await p.customRole.create({ data: { name: `${TAG}wide`, capabilities: ['manage_tasks'], color: '#3b82f6', createdBy: A.SUPERADMIN.user.id } });
  const scoped = await p.customRole.create({ data: { name: `${TAG}scoped`, capabilities: ['manage_tasks', 'manage_teams', 'view_tasks'], color: '#3b82f6', createdBy: A.SUPERADMIN.user.id, scope: { projectKeys: ['bmm'], showcaseIds: [], allShowcase: false, rights: ['pages'] } } });
  F.wideRole = wide.id;
  await actor('wideRole', { role: 'USER', caps: ['manage_tasks'], standing: 'none' }, { customRoleIds: [wide.id] });
  await actor('scopedRole', { role: 'USER', caps: [], standing: 'none' }, { customRoleIds: [scoped.id] });
  // A per-project edit grant is content rights, never board rights.
  const pg = await actor('projGrant', { role: 'USER', caps: [], standing: 'none' });
  await p.projectPermission.create({ data: { userId: pg.user.id, allShowcase: true, grantedBy: pg.user.id } });

  F.target = (await mkUser('target')).user.id;            // an outsider: plain USER, no team
  F.staffTarget = (await mkUser('staffTarget', { role: 'MOD' })).user.id;

  const fx = await freshBoard();
  Object.assign(F, fx);
  const t2 = await p.staffTeam.create({ data: { name: `${TAG}T2`, slug: `${TAG}t2`, chiefId: A.chiefTeams.user.id, members: { create: [{ userId: A.chiefTeams.user.id }] } } });
  F.T2 = t2.id;

  const Fastify = (await import('fastify')).default;
  app = Fastify();
  await app.register((await import('@fastify/cookie')).default);
  await app.register((await import('../src/routes/tasks.mjs')).default);
  await app.register((await import('../src/routes/misc.mjs')).default);
  await app.register((await import('../src/routes/roles.mjs')).default);
  await app.ready();
});

/** A team T (chief, member, userMember), a task X in it, an unfiled task Y, an error proposal S. */
async function freshBoard() {
  const n = seq++;
  const T = await p.staffTeam.create({
    data: {
      name: `${TAG}T-${n}`, slug: `${TAG}t-${n}`, chiefId: A.chief.user.id,
      members: { create: [A.chief.user.id, A.member.user.id, A.userMember.user.id].map((userId) => ({ userId })) },
    },
  });
  const X = await p.adminTask.create({ data: { title: `${TAG}X-${n}`, teamId: T.id, assigneeIds: [A.member.user.id], creatorId: A.chief.user.id } });
  const Y = await p.adminTask.create({ data: { title: `${TAG}Y-${n} secretword${n}`, teamId: null, assigneeIds: [], creatorId: A.ADMIN.user.id } });
  const S = await p.taskSuggestion.create({ data: { dedupKey: `${TAG}error-${n}`, source: 'error', sourceCap: 'manage_analytics', title: 'Server error: boom', body: 'b', href: '/admin?s=errors' } });
  return { T: T.id, X: X.id, Y: Y.id, S: S.id, word: `secretword${n}` };
}

after(async () => {
  if (!RUN) return;
  const users = await p.user.findMany({ where: { email: { startsWith: TAG } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  const none = ids.length ? ids : ['-'];
  await p.adminTask.deleteMany({ where: { OR: [{ creatorId: { in: none } }, { title: { startsWith: TAG } }] } });
  await p.staffTeam.deleteMany({ where: { name: { startsWith: TAG } } });
  await p.staffTeamMember.deleteMany({ where: { userId: { in: none } } });
  // The proposals: this run's, and whatever a forced scan wrote from the dev database. The rows
  // that were there before are put back as they were.
  const keep = new Set(suggestionsBefore.map((s) => s.id));
  await p.taskSuggestion.deleteMany({ where: { id: { notIn: [...keep, '-'] } } });
  for (const s of suggestionsBefore) {
    const { id, ...rest } = s;
    await p.taskSuggestion.update({ where: { id }, data: rest }).catch(() => null);
  }
  await p.customRole.deleteMany({ where: { name: { startsWith: TAG } } });
  await p.projectPermission.deleteMany({ where: { userId: { in: none } } });
  await p.notification.deleteMany({ where: { userId: { in: none } } });
  await p.auditLogEntry.deleteMany({ where: { actorId: { in: none } } });
  await p.session.deleteMany({ where: { userId: { in: none } } });
  await p.user.deleteMany({ where: { email: { startsWith: TAG } } });
  await unlockRow(p, 'task.suggestions');
  await app?.close();
  await p?.$disconnect?.();
});

// ── The oracle: the owner's rules, restated ────────────────────────────────────────────────
function oracle(name) {
  const s = A[name].spec;
  const admin = s.role === 'ADMIN' || s.role === 'SUPERADMIN';
  const has = (c) => admin || (s.caps || []).includes(c);
  const onT = s.standing === 'chief' && !s.chiefOf ? true : s.standing === 'member';
  const chiefT = s.standing === 'chief' && !s.chiefOf;
  const onAnyTeam = s.standing !== 'none';
  const staff = ['MOD', 'ADMIN', 'SUPERADMIN'].includes(s.role) || (s.caps || []).length > 0 || onAnyTeam;
  const dispatch = has('manage_tasks');
  const teams = has('manage_teams');
  const sees = dispatch || has('view_tasks');
  return {
    teamsList: staff,
    viewX: staff && (sees || onT),
    viewY: staff && sees,
    assignX: staff && (dispatch || chiefT),
    moveX: staff && dispatch,
    cancelX: staff && (dispatch || chiefT),
    deleteX: admin,
    createTeamOther: teams && dispatch,
    createTeamSelf: admin,
    renameT: teams,
    chiefT: teams && dispatch,
    chiefSelf: admin,
    addStaff: staff && ((teams && dispatch) || chiefT),
    addOutsider: staff && teams && dispatch,
    addSelf: admin,
    dissolveT: teams,
    removeMember: staff && (teams || chiefT || name === 'userMember'),
    suggestionsList: dispatch,
    acceptS: dispatch && has('manage_analytics'),
    linkXY: staff && dispatch,
    // The routes that hand out capabilities and roles. Admin-tier, and never to yourself.
    grantPerms: admin,
    grantSelfPerms: false,
    setRole: s.role === 'SUPERADMIN',
    setSelfRole: false,
    createRole: s.role === 'SUPERADMIN',
    assignRole: s.role === 'SUPERADMIN',
    assignSelfRole: false,
    projectGrant: admin,
  };
}

// ── The probes ─────────────────────────────────────────────────────────────────────────────
const probes = (me, f) => ({
  teamsList: ['GET', '/admin/tasks/teams'],
  viewX: ['GET', `/admin/tasks/${f.X}`],
  viewY: ['GET', `/admin/tasks/${f.Y}`],
  assignX: ['POST', `/admin/tasks/${f.X}/assign`, { userIds: [A.member.user.id, A.chief.user.id] }],
  moveX: ['PATCH', `/admin/tasks/${f.X}`, { teamId: null }],
  cancelX: ['POST', `/admin/tasks/${f.X}/state`, { state: 'cancelled' }],
  deleteX: ['DELETE', `/admin/tasks/${f.X}`],
  createTeamOther: ['POST', '/admin/tasks/teams', { name: `${TAG}new`, chiefId: F.staffTarget }],
  createTeamSelf: ['POST', '/admin/tasks/teams', { name: `${TAG}mine`, chiefId: me }],
  renameT: ['PATCH', `/admin/tasks/teams/${f.T}`, { name: `${TAG}renamed` }],
  chiefT: ['PATCH', `/admin/tasks/teams/${f.T}`, { chiefId: F.staffTarget }],
  chiefSelf: ['PATCH', `/admin/tasks/teams/${f.T}`, { chiefId: me }],
  addStaff: ['POST', `/admin/tasks/teams/${f.T}/members`, { userId: F.staffTarget }],
  addOutsider: ['POST', `/admin/tasks/teams/${f.T}/members`, { userId: f.target || F.target }],
  addSelf: ['POST', `/admin/tasks/teams/${f.T}/members`, { userId: me }],
  dissolveT: ['DELETE', `/admin/tasks/teams/${f.T}`],
  removeMember: ['DELETE', `/admin/tasks/teams/${f.T}/members/${A.userMember.user.id}`],
  suggestionsList: ['GET', '/admin/tasks/suggestions'],
  acceptS: ['POST', `/admin/tasks/suggestions/${f.S}/accept`, {}],
  linkXY: ['POST', `/admin/tasks/${f.X}/links`, { otherId: f.Y, kind: 'relates' }],
  grantPerms: ['PUT', `/admin/users/${f.target || F.target}/permissions`, { permissions: ['manage_tasks', 'manage_teams', 'view_tasks'] }],
  grantSelfPerms: ['PUT', `/admin/users/${me}/permissions`, { permissions: ['manage_tasks', 'manage_teams', 'view_tasks'] }],
  setRole: ['PUT', `/admin/users/${f.target || F.target}/role`, { role: 'ADMIN' }],
  setSelfRole: ['PUT', `/admin/users/${me}/role`, { role: 'SUPERADMIN' }],
  createRole: ['POST', '/admin/custom-roles', { name: `${TAG}made-${seq++}`, capabilities: ['manage_tasks', 'manage_teams'] }],
  assignRole: ['PUT', `/admin/users/${f.target || F.target}/custom-roles`, { customRoleIds: [F.wideRole] }],
  assignSelfRole: ['PUT', `/admin/users/${me}/custom-roles`, { customRoleIds: [F.wideRole] }],
  projectGrant: ['POST', '/admin/project-permissions', { userId: f.target || F.target, allShowcase: true }],
});

const send = (name, [method, url, payload]) => app.inject({ method, url, headers: { cookie: A[name].cookie }, ...(payload !== undefined ? { payload } : {}) });
const BROKEN_FIXTURE = ['2fa_required', 'unauthenticated', 'session_revoked'];

async function snapshot() {
  const [team, members, x, y, target, staffTarget, s, roles, grants, links, teams] = await Promise.all([
    p.staffTeam.findUnique({ where: { id: F.T }, select: { name: true, chiefId: true, archivedAt: true } }),
    p.staffTeamMember.findMany({ where: { teamId: F.T }, select: { userId: true }, orderBy: { userId: 'asc' } }),
    p.adminTask.findUnique({ where: { id: F.X }, select: { state: true, teamId: true, assigneeIds: true } }),
    p.adminTask.findUnique({ where: { id: F.Y }, select: { state: true, teamId: true, assigneeIds: true } }),
    p.user.findUnique({ where: { id: F.target }, select: { role: true, permissions: true, customRoleIds: true } }),
    p.user.findUnique({ where: { id: F.staffTarget }, select: { role: true, permissions: true, customRoleIds: true } }),
    p.taskSuggestion.findUnique({ where: { id: F.S }, select: { state: true } }),
    p.customRole.count({ where: { name: { startsWith: `${TAG}made` } } }),
    p.projectPermission.count({ where: { userId: F.target } }),
    p.adminTaskLink.count({ where: { OR: [{ fromId: F.X }, { toId: F.X }] } }),
    p.staffTeam.count({ where: { name: { startsWith: TAG } } }),
  ]);
  // Every actor's own role and grants, too: "nobody grants THEMSELVES" is checked on the row.
  const selves = await p.user.findMany({ where: { email: { startsWith: TAG } }, select: { id: true, role: true, permissions: true, customRoleIds: true }, orderBy: { id: 'asc' } });
  return JSON.stringify({ team, members, x, y, target, staffTarget, s, roles, grants, links, teams, selves });
}

describe('task permission matrix (db)', { skip }, () => {
  test('every request the oracle refuses is refused, for the right reason, and changes nothing', async (t) => {
    const before = await snapshot();
    const wrong = [];
    let sent = 0;
    for (const name of Object.keys(A)) {
      const want = oracle(name);
      const all = probes(A[name].user.id, F);
      for (const [probe, allowed] of Object.entries(want)) {
        if (allowed) continue;
        sent++;
        const r = await send(name, all[probe]);
        const body = (() => { try { return r.json(); } catch { return {}; } })();
        const refused = r.statusCode === 403 || r.statusCode === 404
          || (r.statusCode === 400 && /^cannot_change_own/.test(body.error || ''));
        if (!refused || BROKEN_FIXTURE.includes(body.error)) wrong.push(`${name} ${probe}: ${r.statusCode} ${r.body.slice(0, 120)}`);
      }
    }
    assert.deepEqual(wrong, [], `${wrong.length} of ${sent} refusals did not hold:\n${wrong.slice(0, 20).join('\n')}`);
    assert.ok(sent > 400, `the matrix sent only ${sent} refusals`);
    t.diagnostic(`${sent} refusals over ${Object.keys(A).length} actors`);
    assert.equal(await snapshot(), before, 'a refused request changed something');
  });

  test('the list and its count only ever cover what the viewer may read', async () => {
    const wrong = [];
    for (const name of Object.keys(A)) {
      const want = oracle(name);
      const r = await send(name, ['GET', `/admin/tasks?scope=all&q=${F.word}`]);
      if (!want.teamsList) { if (r.statusCode !== 403) wrong.push(`${name}: board open (${r.statusCode})`); continue; }
      const body = r.json();
      const n = want.viewY ? 1 : 0;
      // `total` was counted over rows the viewer could not see: with `q=` it answered whether
      // any task anywhere contains a word.
      if (body.total !== n || body.tasks.length !== n) wrong.push(`${name}: total=${body.total} rows=${body.tasks.length}, want ${n}`);
    }
    assert.deepEqual(wrong, []);
  });

  test('each probe is reachable by the least privileged actor the oracle allows', async () => {
    const pick = {
      teamsList: 'userMember', viewX: 'userMember', viewY: 'USER-view_tasks', assignX: 'chief', moveX: 'USER-manage_tasks',
      cancelX: 'chief', deleteX: 'ADMIN', createTeamOther: 'USER-manage_tasks+manage_teams', createTeamSelf: 'ADMIN',
      renameT: 'USER-manage_teams', chiefT: 'USER-manage_tasks+manage_teams', chiefSelf: 'ADMIN', addStaff: 'chief',
      addOutsider: 'USER-manage_tasks+manage_teams', addSelf: 'ADMIN', dissolveT: 'USER-manage_teams', removeMember: 'userMember',
      suggestionsList: 'wideRole', acceptS: 'dispAnalytics', linkXY: 'wideRole', grantPerms: 'ADMIN', setRole: 'SUPERADMIN',
      createRole: 'SUPERADMIN', assignRole: 'SUPERADMIN', projectGrant: 'ADMIN',
    };
    const wrong = [];
    for (const [probe, name] of Object.entries(pick)) {
      assert.equal(oracle(name)[probe], true, `${name} is not allowed ${probe} by the oracle — the pick is wrong`);
      const f = { ...(await freshBoard()), target: (await mkUser('t2')).user.id };
      const r = await send(name, probes(A[name].user.id, f)[probe]);
      if (r.statusCode < 200 || r.statusCode > 299) wrong.push(`${probe} by ${name}: ${r.statusCode} ${r.body.slice(0, 160)}`);
    }
    assert.deepEqual(wrong, []);
  });

  test('a chief who also shapes teams runs their own team and still cannot hand out dispatch', async () => {
    const me = A.chiefTeams.user.id;
    const add = await send('chiefTeams', ['POST', `/admin/tasks/teams/${F.T2}/members`, { userId: F.target }]);
    assert.equal(add.statusCode, 403, 'an outsider takes manage_tasks too');
    const staff = await send('chiefTeams', ['POST', `/admin/tasks/teams/${F.T2}/members`, { userId: F.staffTarget }]);
    assert.equal(staff.statusCode, 200, staff.body);
    const chief = await send('chiefTeams', ['PATCH', `/admin/tasks/teams/${F.T2}`, { chiefId: F.staffTarget }]);
    assert.equal(chief.statusCode, 403, 'naming a chief hands out dispatch');
    const who = await p.staffTeam.findUnique({ where: { id: F.T2 }, select: { chiefId: true } });
    assert.equal(who.chiefId, me);
  });
});

// MUTATION CHECK, BY HAND (Sept 23 2026). Each guard broken, the suite run, the guard put back:
//   1. PATCH /admin/tasks/teams/:id without its `canNameChief` line
//      → red: "chiefTeams chiefT: 200", "chiefTeams chiefSelf: 200" (and the chiefTeams test)
//   2. PATCH /admin/tasks/teams/:id with the board guard instead of requireCap('manage_teams')
//      → red: "USER-view_tasks renameT: 200", "MOD-none renameT: 200", …
//   3. DELETE /admin/tasks/teams/:id with the board guard → red: "USER-view_tasks dissolveT: 200"
//   4. lib.mjs canReadAllTasks reading manage_faq instead of view_tasks → red in all three
//      passes (refusals, the list count, the positive viewY)
//   5. GET /admin/tasks without visibilityWhere → red: "MOD-none: total=1 rows=0, want 0"
//   6. the suggestion routes without the source-capability check
//      → red: "USER-manage_tasks acceptS: 201" (a proposal from the error log, accepted by an
//      account that cannot read the error log)
// One mutant SURVIVED, and it is an equivalent one: POST /admin/tasks/teams with the board guard
// instead of requireCap('manage_teams') is still refused for everybody without manage_teams,
// because creating a team names a chief and canNameChief asks for manage_teams itself.

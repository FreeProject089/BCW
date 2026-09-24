// Zero elevation, over HTTP: every capability x every capability-gated route, every role-gated
// route against every capability at once, and the editor door — for the WHOLE API.
//
// Why this exists: the Sept-9 capability refactor converted guards file by file, and a file
// that was not one section lost a guard on 94 routes (memory: pentest-sept9-2026, P-1). The
// two matrices beside this one (task-permissions-matrix, studio-permissions-matrix) prove
// their own corner. Nothing proved the door of every other route, so this does.
//
// HOW IT IS BUILT
//   · The ROUTE LIST is derived from the code: every `src/routes/*.mjs` is registered in one
//     Fastify instance, and `parseRoutes` (lib/rbac-map.mjs) reads which guard each route
//     declares. A route that is live but was not parsed fails the suite, so a route added
//     tomorrow in a shape the parser cannot read is caught here instead of skipped.
//   · Every HANDLER is replaced by a stub (an `onRoute` hook) that answers { reached: <route> }.
//     The guards (preHandler, onRequest) run for real; the handlers never do. That is what
//     lets this send thousands of requests at admin routes — server power, database, grants —
//     without any of them doing anything, and it is also its limit: a rule checked INSIDE a
//     handler (canEditProject, the task board's standings, mayGrant) is not measured here.
//     Those have their own matrices.
//   · The EXPECTATION is restated by hand in `oracle()`: nothing here imports hasCap or the
//     guards to decide what the answer should be. The capability LIST is imported (it is the
//     vocabulary, not a rule), plus the parsed guard of each route.
//   · Controls both ways: the single holder of a capability must PASS its routes (so a guard
//     that refuses everybody fails), and every refusal must be a real one — never
//     `unauthenticated` for a signed-in actor, which would mean the fixture was broken.
//
// The refusal statuses a guard gives: 401 unauthenticated, 403 forbidden (role),
// 403 missing_permission (capability), 403 2fa_required, 403 account_<status>.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import jwt from 'jsonwebtoken';

const RUN = !!process.env.DATABASE_URL;
const skip = RUN ? false : 'set DATABASE_URL to a throwaway Postgres to run the capability route matrix';
process.env.JWT_SECRET ||= 'capability-matrix-test-secret';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROUTES_DIR = path.join(HERE, '..', 'src', 'routes');
const TAG = `capmx-${Date.now().toString(36)}-`;
const GUARD_ERRORS = ['unauthenticated', 'forbidden', 'missing_permission', '2fa_required', 'session_revoked'];

let p, app, CAPS, seq = 0;
const A = {};            // actor name -> { cookie, spec }
let parsed = [];         // [{ verb, path, guard, file }]
const live = new Set();  // 'VERB /path' as Fastify registered it

async function actor(name, spec, data = {}) {
  const u = await p.user.create({ data: {
    email: `${TAG}${seq++}@bettercommunity.invalid`, displayName: `${TAG}${name}`.slice(0, 40),
    role: spec.role || 'USER', permissions: spec.caps || [], totpEnabled: spec.twofa !== false, emailVerified: true, canControlServer: true, ...data,
  } });
  const sess = await p.session.create({ data: { userId: u.id }, select: { id: true } });
  // Every actor also carries a server-control ELEVATION bound to itself, and every account may
  // control the server: those two guards stack AFTER the role guard on the terminal / database
  // / backup routes, and this matrix measures the role and capability door, not them. With
  // them in place, a refusal here can only come from the door under test.
  const elevated = jwt.sign({ uid: u.id, purpose: 'server-control' }, process.env.JWT_SECRET);
  A[name] = { id: u.id, spec, cookie: `bcw_session=${jwt.sign({ uid: u.id, role: u.role, sid: sess.id }, process.env.JWT_SECRET)}; bcw_elevated=${elevated}` };
}

before(async () => {
  if (!RUN) return;
  const lib = await import('../src/lib/lib.mjs');
  CAPS = [...lib.CAPABILITIES];
  p = await lib.db();

  // ── the route list, from the code ──
  const { parseRoutes } = await import('../src/lib/rbac-map.mjs');
  const files = fs.readdirSync(ROUTES_DIR).filter((f) => f.endsWith('.mjs'));
  parsed = files.flatMap((f) => parseRoutes(f, fs.readFileSync(path.join(ROUTES_DIR, f), 'utf8')));

  // ── the app, every route file, every handler a stub ──
  const Fastify = (await import('fastify')).default;
  app = Fastify({ logger: false });
  await app.register((await import('@fastify/cookie')).default);
  app.addHook('onRoute', (o) => {
    const label = `${[].concat(o.method).filter((m) => m !== 'HEAD').join(',')} ${o.url}`;
    for (const m of [].concat(o.method)) if (m !== 'HEAD') live.add(`${m} ${o.url}`);
    delete o.schema;   // a schema would refuse the probe's empty body before the guard ran
    o.handler = async () => ({ reached: label });
  });
  for (const f of files) {
    const mod = await import(pathToFileURL(path.join(ROUTES_DIR, f)).href);
    if (typeof mod.default === 'function') await app.register(mod.default);
  }
  await app.ready();

  // ── the actors ──
  await actor('USER', {});
  await actor('USER+all', { caps: CAPS });
  await actor('MOD', { role: 'MOD' });
  await actor('MOD+all', { role: 'MOD', caps: CAPS });
  await actor('ADMIN', { role: 'ADMIN' });
  await actor('SUPERADMIN', { role: 'SUPERADMIN' });
  await actor('ADMIN-no2fa', { role: 'ADMIN', twofa: false });
  await actor('USER+all-no2fa', { caps: CAPS, twofa: false });
  for (const c of CAPS) {
    await actor(`only:${c}`, { caps: [c] });
    await actor(`all-but:${c}`, { caps: CAPS.filter((x) => x !== c) });
  }
  // SUSPENDED staff. A suspension stops the account's services and leaves sign-in open, so the
  // person can read why and appeal (lib.mjs accountLock). Its staff powers are not something it
  // needs for that: a suspended moderator must not go on suspending others.
  const susp = { status: 'suspended', moderationUntil: new Date(Date.now() + 86_400_000), moderationReason: 'capability matrix' };
  await actor('suspended:MOD', { role: 'MOD', suspended: true }, susp);
  await actor('suspended:USER+all', { caps: CAPS, suspended: true }, susp);
  await actor('suspended:ADMIN', { role: 'ADMIN', suspended: true }, susp);
  // Every capability through a WIDE custom role: must behave exactly like USER+all.
  const wide = await p.customRole.create({ data: { name: `${TAG}wide`, capabilities: CAPS, color: '#3b82f6', createdBy: A.SUPERADMIN.id } });
  await actor('role:wide-all', { caps: CAPS, via: 'role' }, { permissions: [], customRoleIds: [wide.id] });
  // The same capabilities on a SCOPED role: a scope limits a role to elements, so its
  // capability list must open nothing site-wide.
  const scoped = await p.customRole.create({ data: { name: `${TAG}scoped`, capabilities: CAPS, color: '#3b82f6', createdBy: A.SUPERADMIN.id, scope: { projectKeys: ['bmm'], showcaseIds: [], allShowcase: true, rights: ['pages', 'blog', 'market', 'inbox', 'studio'] } } });
  await actor('role:scoped-all', { caps: [], via: 'scoped' }, { permissions: [], customRoleIds: [scoped.id] });
  // Per-project grants on everything: edit rights on elements, never a capability.
  await actor('grants:everything', {});
  await p.projectPermission.create({ data: { userId: A['grants:everything'].id, allShowcase: true, rights: ['pages', 'studio'], grantedBy: A.SUPERADMIN.id } });
  await p.projectPermission.create({ data: { userId: A['grants:everything'].id, projectKey: 'bmm', rights: ['pages', 'studio'], grantedBy: A.SUPERADMIN.id } });
});

after(async () => {
  if (!RUN) return;
  try {
    const ids = (await p.user.findMany({ where: { email: { startsWith: TAG } }, select: { id: true } })).map((u) => u.id);
    const none = ids.length ? ids : ['-'];
    await p.projectPermission.deleteMany({ where: { userId: { in: none } } });
    await p.customRole.deleteMany({ where: { name: { startsWith: TAG } } });
    await p.auditLogEntry.deleteMany({ where: { actorId: { in: none } } }).catch(() => null);
    await p.notification.deleteMany({ where: { userId: { in: none } } }).catch(() => null);
    await p.session.deleteMany({ where: { userId: { in: none } } });
    await p.user.deleteMany({ where: { id: { in: none } } });
  } finally {
    await app?.close();
  }
});

// ── the rule, restated by hand ─────────────────────────────────────────────────────────────
const ADMINS = ['ADMIN', 'SUPERADMIN'];
const STAFF_TIER = ['MOD', 'ADMIN', 'SUPERADMIN'];
/** What the guard of `r` must answer `name`: 'pass', or the refusal it must give. */
function oracle(name, r) {
  if (!name) return 'unauthenticated';
  const s = A[name].spec;
  const role = s.role || 'USER';
  const caps = s.caps || [];
  const g = r.guard;
  if (g.kind === 'cap') {
    // ADMIN / SUPERADMIN hold every capability; MOD holds manage_users; alsoRoles open the
    // door by role. Nobody else passes without the capability itself.
    const has = ADMINS.includes(role) || (role === 'MOD' && g.capability === 'manage_users')
      || caps.includes(g.capability) || g.alsoRoles.includes(role);
    if (!has) return 'missing_permission';
    if (s.suspended) return 'account_suspended';
    return s.twofa === false ? '2fa_required' : 'pass';
  }
  if (g.kind === 'role') {
    if (role !== 'SUPERADMIN' && !g.roles.includes(role)) return 'forbidden';
    if (s.suspended) return 'account_suspended';
    return STAFF_TIER.includes(role) && s.twofa === false ? '2fa_required' : 'pass';
  }
  if (g.kind === 'editor') return s.twofa === false ? '2fa_required' : 'pass';
  return null;   // not a door this matrix measures
}

/** A concrete URL for a route pattern: params and wildcards filled with ids nothing has. */
const concrete = (pattern) => pattern.replace(/:[A-Za-z_]\w*(\([^)]*\))?/g, 'zz-none').replace(/\*/g, 'zz');

async function send(name, r) {
  const res = await app.inject({
    method: r.verb, url: concrete(r.path),
    headers: { ...(name ? { cookie: A[name].cookie } : {}), ...(r.verb === 'GET' || r.verb === 'DELETE' ? {} : { 'content-type': 'application/json' }) },
    ...(r.verb === 'GET' || r.verb === 'DELETE' ? {} : { payload: '{}' }),
  });
  let body = null; try { body = res.json(); } catch { /* not json */ }
  return { status: res.statusCode, body };
}
/** Did the answer match what the oracle wants? `pass` = the stub of THIS route answered. */
function verdict(want, r, got) {
  if (want === 'pass') {
    // Past the capability/role door. A route may stack a further guard after it (server
    // control, elevation) whose refusal is not a guard error; that still means THIS door
    // opened. The stub's label proves the request reached this route and not a neighbour.
    if (got.status === 200) return got.body?.reached?.endsWith(` ${r.path}`) ? null : `reached ${got.body?.reached}`;
    return got.status === 403 && !GUARD_ERRORS.includes(got.body?.error) ? null : `${got.status} ${got.body?.error}`;
  }
  const code = want === 'unauthenticated' ? 401 : 403;
  return got.status === code && got.body?.error === want ? null : `${got.status} ${got.body?.error || JSON.stringify(got.body)?.slice(0, 80)} (want ${want})`;
}

/** Run `pairs` in small parallel batches; returns the mismatches. */
async function sweep(pairs) {
  const wrong = [];
  for (let i = 0; i < pairs.length; i += 24) {
    await Promise.all(pairs.slice(i, i + 24).map(async ([name, r]) => {
      const want = oracle(name, r);
      if (!want) return;
      const bad = verdict(want, r, await send(name, r));
      if (bad) wrong.push(`${name || 'anonymous'} ${r.verb} ${r.path} [${r.file}]: ${bad}`);
    }));
  }
  return wrong;
}
const doors = (kind) => parsed.filter((r) => r.guard.kind === kind);

describe('capability route matrix', { skip }, () => {
  test('the route list is the code: every live route was parsed, and the other way round', () => {
    const keys = new Set(parsed.map((r) => `${r.verb} ${r.path}`));
    const unparsed = [...live].filter((k) => !keys.has(k));
    const ghost = [...keys].filter((k) => !live.has(k));
    assert.deepEqual(unparsed, [], 'live routes the parser did not read: the matrix would skip them');
    assert.deepEqual(ghost, [], 'parsed routes that are not live: the parser invented them');
    assert.ok(doors('cap').length > 300 && doors('role').length > 150, `too few doors parsed (cap ${doors('cap').length}, role ${doors('role').length})`);
  });

  test('anonymous is refused at every capability, role and editor door', async () => {
    const wrong = await sweep([...doors('cap'), ...doors('role'), ...doors('editor')].map((r) => [null, r]));
    assert.deepEqual(wrong, [], wrong.slice(0, 30).join('\n'));
  });

  test('every capability x every capability route: only that capability (or its roles) opens it', async (t) => {
    const names = [...CAPS.map((c) => `only:${c}`), 'USER', 'MOD', 'grants:everything', 'role:scoped-all'];
    const pairs = doors('cap').flatMap((r) => names.map((n) => [n, r]));
    const wrong = await sweep(pairs);
    t.diagnostic(`${pairs.length} requests over ${doors('cap').length} capability routes`);
    assert.deepEqual(wrong, [], `${wrong.length} wrong:\n${wrong.slice(0, 40).join('\n')}`);
  });

  test('holding every OTHER capability never opens a capability route', async () => {
    const pairs = doors('cap').flatMap((r) => (CAPS.includes(r.guard.capability) ? [[`all-but:${r.guard.capability}`, r]] : []));
    const wrong = await sweep(pairs);
    assert.deepEqual(wrong, [], wrong.slice(0, 40).join('\n'));
  });

  test('no capability, however many, opens a role-only route', async () => {
    const names = ['USER+all', 'role:wide-all', 'role:scoped-all', 'grants:everything', 'MOD+all', 'ADMIN', 'SUPERADMIN'];
    const pairs = doors('role').flatMap((r) => names.map((n) => [n, r]));
    const wrong = await sweep(pairs);
    assert.deepEqual(wrong, [], `${wrong.length} wrong:\n${wrong.slice(0, 40).join('\n')}`);
  });

  test('the wide custom role opens exactly what the same direct grants open', async () => {
    const pairs = doors('cap').map((r) => ['role:wide-all', r]);
    const wrong = await sweep(pairs);
    assert.deepEqual(wrong, [], wrong.slice(0, 40).join('\n'));
  });

  test('without 2FA, no capability and no admin role gets past a staff door', async () => {
    const pairs = [...doors('cap'), ...doors('role'), ...doors('editor')].flatMap((r) => [['USER+all-no2fa', r], ['ADMIN-no2fa', r]]);
    const wrong = await sweep(pairs);
    assert.deepEqual(wrong, [], wrong.slice(0, 40).join('\n'));
  });

  test('a suspended account keeps none of its staff powers', async () => {
    // Before the fix all three passed every door they held: the guards asked accountLock only
    // the SIGN-IN question, which a suspension answers "yes" to on purpose.
    const pairs = [...doors('cap'), ...doors('role')].flatMap((r) => ['suspended:MOD', 'suspended:USER+all', 'suspended:ADMIN'].map((n) => [n, r]));
    const wrong = await sweep(pairs);
    assert.deepEqual(wrong, [], `${wrong.length} wrong:\n${wrong.slice(0, 40).join('\n')}`);
  });

  test('the concrete case, real handler: a suspended moderator cannot suspend somebody', async () => {
    // The stubbed matrix above proves the door; this proves the harm it stood in front of.
    const Fastify = (await import('fastify')).default;
    const real = Fastify({ logger: false });
    await real.register((await import('@fastify/cookie')).default);
    await real.register((await import('../src/routes/misc.mjs')).default);
    await real.ready();
    try {
      const victim = await p.user.create({ data: { email: `${TAG}victim@bettercommunity.invalid`, displayName: `${TAG}victim`, role: 'USER' } });
      const r = await real.inject({ method: 'POST', url: `/admin/users/${victim.id}/moderate`, headers: { cookie: A['suspended:MOD'].cookie, 'content-type': 'application/json' }, payload: { action: 'suspend', durationHours: 1, reason: 'matrix' } });
      assert.equal(r.statusCode, 403, r.body);
      assert.equal(r.json().error, 'account_suspended');
      assert.equal((await p.user.findUnique({ where: { id: victim.id }, select: { status: true } })).status, 'active', 'the victim was suspended');
      // Control: the same moderator, not suspended, is let through by the same route.
      const ok = await real.inject({ method: 'POST', url: `/admin/users/${victim.id}/moderate`, headers: { cookie: A.MOD.cookie, 'content-type': 'application/json' }, payload: { action: 'suspend', durationHours: 1, reason: 'matrix' } });
      assert.equal(ok.statusCode, 200, ok.body);
    } finally {
      await real.close();
    }
  });

  test('a capability that is not grantable cannot be granted, and nobody grants themselves', async () => {
    // manage_server is enforced by routes and deliberately absent from CAPABILITIES: the grant
    // routes validate against that list, so it can only ever be held through the ADMIN role.
    const enforced = new Set(doors('cap').map((r) => r.guard.capability));
    const ungrantable = [...enforced].filter((c) => !CAPS.includes(c));
    assert.deepEqual(ungrantable, ['manage_server'], 'a capability is enforced that the grant list does not name');
    // The grant routes are role-only doors (covered above); this pins WHICH role.
    const grantDoors = {
      'PUT /admin/users/:id/permissions': ['ADMIN'], 'PUT /admin/users/:id/role': ['SUPERADMIN'],
      'PUT /admin/users/:id/custom-roles': ['SUPERADMIN'], 'POST /admin/custom-roles': ['SUPERADMIN'],
      'PUT /admin/custom-roles/:id': ['SUPERADMIN'], 'POST /admin/project-permissions': ['ADMIN'],
      'POST /admin/blog-permissions': ['ADMIN'], 'PUT /admin/server-control/:userId': ['SUPERADMIN'],
      'PUT /admin/telemetry-access/:userId': ['SUPERADMIN'],
    };
    for (const [k, roles] of Object.entries(grantDoors)) {
      const r = parsed.find((x) => `${x.verb} ${x.path}` === k);
      assert.ok(r, `${k} is not a route any more`);
      assert.deepEqual(r.guard, { kind: 'role', role: roles.join(' or '), roles }, `${k} changed its guard`);
    }
  });
});

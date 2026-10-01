// agent-bcw-pools: the routes, over HTTP, on a throwaway Postgres (skipped without DATABASE_URL).
//   · the early_access right: its holder runs pre-releases of ITS project and nothing else, and
//     only a project manager (or manage_prereleases) hands it out;
//   · a pool dedicated to a project: attached by manage_hosting, refused when too small, and the
//     project's pre-release file is then measured against the pool;
//   · payment links: created by manage_hosting only, the public view leaks nothing, the limit
//     and the revocation are enforced before any Checkout is opened (no Stripe call here).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

const RUN = !!process.env.DATABASE_URL;
const skip = RUN ? false : 'set DATABASE_URL to a throwaway Postgres to run the pools / payment-link routes';
process.env.JWT_SECRET ||= 'pools-test-secret';
process.env.S3_ACCESS_KEY ||= 'test-access';
process.env.S3_SECRET_KEY ||= 'test-secret-key';
const DAY = 864e5;
const STAMP = Date.now().toString(36);
const TAG = `pools-${STAMP}-`;
const KA = `ppa${STAMP}`;
const KB = `ppb${STAMP}`;
let p, app, seq = 0;
const A = {};

async function actor(name, data = {}, grants = []) {
  const u = await p.user.create({ data: {
    email: `${TAG}${name}-${seq++}@bettercommunity.invalid`, displayName: `${TAG}${name}`, role: 'USER', totpEnabled: true,
    emailVerified: true, createdAt: new Date(Date.now() - 10 * DAY), ...data,
  } });
  const sess = await p.session.create({ data: { userId: u.id }, select: { id: true } });
  for (const g of grants) await p.projectPermission.create({ data: { userId: u.id, grantedBy: u.id, rights: ['pages'], ...g } });
  A[name] = { user: u, cookie: `bcw_session=${jwt.sign({ uid: u.id, role: u.role, sid: sess.id }, process.env.JWT_SECRET)}` };
}
async function call(name, method, url, payload) {
  const res = await app.inject({ method, url, headers: name ? { cookie: A[name].cookie } : {}, payload });
  let body = null; try { body = res.json(); } catch { /* not json */ }
  return { status: res.statusCode, body };
}

before(async () => {
  if (!RUN) return;
  const lib = await import('../src/lib/lib.mjs');
  p = await lib.db();
  for (const k of [KA, KB]) {
    await p.project.create({ data: { key: k, name: `${TAG}${k}` } });
    await p.adminSetting.create({ data: { key: `project.${k}`, value: { name: `Proj ${k}` } } });
  }
  (await import('../src/lib/project-keys.mjs')).forgetProjectKeys();
  await actor('ADMIN', { role: 'ADMIN' });
  await actor('hoster', { permissions: ['manage_hosting'] });
  await actor('eaWide', { permissions: ['manage_prereleases'] });
  await actor('managerProjects', { permissions: ['manage_projects'] });
  await actor('editorA', {}, [{ projectKey: KA }]);
  await actor('eaA', {}, [{ projectKey: KA, rights: ['early_access'] }]);
  await actor('USER');
  await actor('target');
  const Fastify = (await import('fastify')).default;
  app = Fastify();
  await app.register((await import('@fastify/cookie')).default);
  await app.register((await import('../src/routes/prereleases.mjs')).default);
  await app.register((await import('../src/routes/project-pools.mjs')).default);
  await app.register((await import('../src/routes/paylinks.mjs')).default);
  await app.ready();
});

after(async () => {
  if (!RUN) return;
  try {
    await p.preRelease.deleteMany({ where: { target: { in: [KA, KB] } } });
    const ids = (await p.user.findMany({ where: { email: { startsWith: TAG } }, select: { id: true } })).map((u) => u.id);
    const none = ids.length ? ids : ['-'];
    await p.paymentLink.deleteMany({ where: { createdById: { in: none } } });
    const pools = await p.hostingGroup.findMany({ where: { ownerId: { in: none } }, select: { id: true } });
    await p.subscription.deleteMany({ where: { hostingGroupId: { in: pools.map((g) => g.id) } } });
    await p.hostingGroup.deleteMany({ where: { ownerId: { in: none } } });
    await p.hostingPlan.deleteMany({ where: { name: { startsWith: `Payment link: ${TAG}` } } });
    await p.projectPermission.deleteMany({ where: { userId: { in: none } } });
    await p.adminSetting.deleteMany({ where: { key: { in: [`project.${KA}`, `project.${KB}`] } } });
    await p.project.deleteMany({ where: { key: { in: [KA, KB] } } });
    await p.auditLogEntry.deleteMany({ where: { actorId: { in: none } } }).catch(() => null);
    await p.notification.deleteMany({ where: { userId: { in: none } } }).catch(() => null);
    await p.session.deleteMany({ where: { userId: { in: none } } });
    await p.user.deleteMany({ where: { id: { in: none } } });
    (await import('../src/lib/project-keys.mjs')).forgetProjectKeys();
  } finally { await app?.close(); }
});

describe('the early_access right', { skip }, () => {
  test('its holder opens a pre-release on its project, not on another; a plain member cannot', async () => {
    const ok = await call('eaA', 'POST', `/projects-prereleases/${KA}`, { title: `${TAG}beta`, published: true, mode: 'all' });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    assert.equal((await call('eaA', 'POST', `/projects-prereleases/${KB}`, { title: `${TAG}nope` })).status, 403);
    assert.equal((await call('USER', 'POST', `/projects-prereleases/${KA}`, { title: `${TAG}nope` })).status, 403);
    const wide = await call('eaWide', 'POST', `/projects-prereleases/${KB}`, { title: `${TAG}wide` });
    assert.equal(wide.status, 201, 'manage_prereleases reaches every project');
  });
  test('the creation form lists only the projects the caller may use', async () => {
    const r = await call('eaA', 'GET', '/prerelease-manage/projects');
    assert.equal(r.status, 200);
    const refs = r.body.projects.map((x) => x.ref);
    assert.ok(refs.includes(KA) && !refs.includes(KB));
  });
  test('only a manager hands it out; a page editor or a holder cannot; nobody grants themselves', async () => {
    const email = A.target.user.email;
    assert.equal((await call('editorA', 'POST', `/prerelease-access/${KA}`, { email })).status, 403);
    assert.equal((await call('eaA', 'POST', `/prerelease-access/${KA}`, { email })).status, 403);
    assert.equal((await call('managerProjects', 'POST', `/prerelease-access/${KA}`, { email: A.managerProjects.user.email })).status, 400);
    const g = await call('managerProjects', 'POST', `/prerelease-access/${KA}`, { email: email.toUpperCase() });
    assert.equal(g.status, 201, JSON.stringify(g.body));
    const list = await call('editorA', 'GET', `/prerelease-access/${KA}`);
    assert.equal(list.status, 200);
    assert.ok(list.body.holders.some((h) => h.userId === A.target.user.id));
    assert.equal(list.body.canGrant, false);
    // Merged into an existing row: the page right the editor had is kept.
    await call('eaWide', 'POST', `/prerelease-access/${KA}`, { email: A.editorA.user.email });
    const row = await p.projectPermission.findFirst({ where: { userId: A.editorA.user.id, projectKey: KA } });
    assert.deepEqual([...row.rights].sort(), ['early_access', 'pages']);
    const del = await call('eaWide', 'DELETE', `/prerelease-access/${KA}/${A.editorA.user.id}`);
    assert.equal(del.status, 200);
    const after = await p.projectPermission.findFirst({ where: { userId: A.editorA.user.id, projectKey: KA } });
    assert.deepEqual(after.rights, ['pages'], 'taking early access back leaves the page right alone');
  });
});

describe('a pool dedicated to a project', { skip }, () => {
  test('manage_hosting attaches it; a member cannot; the file upload is then measured against it', async () => {
    const pool = await p.hostingGroup.create({ data: { ownerId: A.hoster.user.id, name: `${TAG}pool`, poolBytes: 1000n } });
    assert.equal((await call('USER', 'PUT', `/admin/hosting/pools/${pool.id}/project`, { ref: KA })).status, 403);
    const at = await call('hoster', 'PUT', `/admin/hosting/pools/${pool.id}/project`, { ref: KA });
    assert.equal(at.status, 200, JSON.stringify(at.body));
    assert.equal(at.body.pool.projectTarget, KA);
    // A second pool for the same project is refused.
    const pool2 = await p.hostingGroup.create({ data: { ownerId: A.hoster.user.id, name: `${TAG}pool2`, poolBytes: 1000n } });
    assert.equal((await call('hoster', 'PUT', `/admin/hosting/pools/${pool2.id}/project`, { ref: KA })).status, 409);
    // The pre-release file: 2000 bytes do not fit in a 1000-byte pool.
    const pr = await p.preRelease.findFirst({ where: { target: KA } });
    const up = await call('eaA', 'POST', `/prerelease-manage/${pr.id}/file`, { filename: 'a.zip', contentType: 'application/zip', size: 2000 });
    assert.equal(up.status, 413);
    assert.equal(up.body.error, 'pool_full');
    const view = await call('eaA', 'GET', `/projects-pool/${KA}`);
    assert.equal(view.status, 200);
    assert.equal(view.body.pool.poolBytes, 1000);
    assert.equal((await call('USER', 'GET', `/projects-pool/${KA}`)).status, 403);
    // Freed: back on the site limits.
    assert.equal((await call('hoster', 'PUT', `/admin/hosting/pools/${pool.id}/project`, { ref: null })).status, 200);
    assert.equal((await p.hostingGroup.findUnique({ where: { id: pool.id } })).projectTarget, null);
  });
  test('a pool too small for what the project already stores is refused', async () => {
    const pr = await p.preRelease.findFirst({ where: { target: KA } });
    await p.preRelease.update({ where: { id: pr.id }, data: { downloadKey: `prerelease/${pr.id}/x`, downloadSize: 5000 } });
    const tiny = await p.hostingGroup.create({ data: { ownerId: A.hoster.user.id, name: `${TAG}tiny`, poolBytes: 100n } });
    const r = await call('hoster', 'PUT', `/admin/hosting/pools/${tiny.id}/project`, { ref: KA });
    assert.equal(r.status, 409);
    assert.equal(r.body.error, 'pool_too_small');
    await p.preRelease.update({ where: { id: pr.id }, data: { downloadKey: null, downloadSize: null } });
  });
});

describe('payment links', { skip }, () => {
  let link;
  test('only manage_hosting creates one; a pool link carries its own hidden plan', async () => {
    const body = { title: `${TAG}50 GB`, kind: 'pool', pool: { storageGB: 50, months: 3, projectRef: KB }, priceMode: 'custom', amountCents: 4000, maxUses: 1 };
    assert.equal((await call('USER', 'POST', '/admin/hosting/paylinks', body)).status, 403);
    const r = await call('hoster', 'POST', '/admin/hosting/paylinks', body);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    link = r.body.link;
    const row = await p.paymentLink.findUnique({ where: { id: link.id } });
    assert.equal(row.provision.projectTarget, KB);
    const plan = await p.hostingPlan.findUnique({ where: { id: row.provision.planId } });
    assert.equal(plan.active, false);
    assert.equal((await call('hoster', 'POST', '/admin/hosting/paylinks', { ...body, amountCents: 10 })).body.error, 'amount_required');
  });
  test('the public view: no creator, no restriction address, the places left', async () => {
    const r = await call(null, 'GET', `/pay/${link.token}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.link.left, 1);
    assert.equal(r.body.signedIn, false);
    assert.ok(!('createdById' in r.body.link) && !('onlyEmail' in r.body.link));
    assert.equal((await call(null, 'GET', '/pay/nope-nope')).status, 404);
  });
  test('sold out and stopped links refuse before any Checkout; a checkout needs an account', async () => {
    assert.equal((await call(null, 'POST', `/pay/${link.token}/checkout`)).status, 401);
    await p.paymentLinkUse.create({ data: { linkId: link.id, userId: A.target.user.id, sessionId: `${TAG}cs`, status: 'paid', holdUntil: new Date() } });
    const sold = await call('USER', 'GET', `/pay/${link.token}`);
    assert.equal(sold.body.why, 'sold_out');
    const stop = await call('hoster', 'PATCH', `/admin/hosting/paylinks/${link.id}`, { revoked: true });
    assert.equal(stop.status, 200);
    assert.equal((await call('USER', 'GET', `/pay/${link.token}`)).body.why, 'revoked');
    const detail = await call('hoster', 'GET', `/admin/hosting/paylinks/${link.id}`);
    assert.equal(detail.body.uses.length, 1);
    assert.equal(detail.body.link.paid, 1);
    await p.paymentLinkUse.deleteMany({ where: { linkId: link.id } });
  });
});

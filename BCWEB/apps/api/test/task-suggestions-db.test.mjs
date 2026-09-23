// The site's proposals, end to end through the real scan: one error group with a private share
// link, a token and an e-mail in its message, raised twelve times.
//
// What it pins:
//   · twelve sightings, two scans → ONE proposal (dedup on the error group), its count refreshed
//   · nothing secret crosses into the proposal, nor into the task accepted from it (CWE-532)
//   · an account that dispatches tasks but cannot read the error log never sees it, and cannot
//     accept it by id
//   · accepted → the scan leaves it alone while the task is open, proposes it again once the
//     task is closed and the errors are still there; dismiss → restore puts it back
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { lockRow, unlockRow } from './row-lock.mjs';

const RUN = !!process.env.DATABASE_URL;
const skip = RUN ? false : 'set DATABASE_URL to a throwaway Postgres to run the task suggestion tests';
process.env.JWT_SECRET ||= 'task-suggest-test-secret';

const TAG = `tasksg-${Date.now()}-`;
const SECRETS = ['S3CR3TKEY0123456789abc', 'cm9zz8yy7xx6ww5vv4', 'evil.test', 'token=abc', 'ops@example.com', 'example.com', '/r/', 'k=S3'];
const MSG = `${TAG}boom: GET /r/cm9zz8yy7xx6ww5vv4?k=S3CR3TKEY0123456789abc failed, see https://evil.test/x?token=abc and mail ops@example.com`;
let p, app, admin, disp, key, before0 = [];

async function mk(name, data) {
  const u = await p.user.create({ data: { email: `${TAG}${name}@bettercommunity.invalid`, displayName: name, totpEnabled: true, emailVerified: true, ...data } });
  const s = await p.session.create({ data: { userId: u.id }, select: { id: true } });
  return { id: u.id, cookie: `bcw_session=${jwt.sign({ uid: u.id, role: u.role, sid: s.id }, process.env.JWT_SECRET)}` };
}

before(async () => {
  if (!RUN) return;
  const lib = await import('../src/lib/lib.mjs');
  const { errorGroupId } = await import('../src/lib/errorlog.mjs');
  p = await lib.db();
  // The proposals table is snapshotted and put back by BOTH suggestion-touching files, and a
  // scan writes rows from the dev database into it: they take turns (row-lock.mjs).
  await lockRow(p, 'task.suggestions');
  before0 = await p.taskSuggestion.findMany();
  admin = await mk('admin', { role: 'ADMIN' });
  disp = await mk('disp', { role: 'USER', permissions: ['manage_tasks'] });
  await p.errorEvent.createMany({ data: Array.from({ length: 12 }, () => ({ message: MSG, path: '/r/cm9zz8yy7xx6ww5vv4', source: 'server' })) });
  key = `error:${errorGroupId('server', MSG)}`;
  const Fastify = (await import('fastify')).default;
  app = Fastify();
  await app.register((await import('@fastify/cookie')).default);
  await app.register((await import('../src/routes/tasks.mjs')).default);
  await app.ready();
});

after(async () => {
  if (!RUN) return;
  const ids = [admin?.id, disp?.id].filter(Boolean);
  await p.errorEvent.deleteMany({ where: { message: MSG } });
  await p.adminTask.deleteMany({ where: { creatorId: { in: ids.length ? ids : ['-'] } } });
  const keep = new Set(before0.map((s) => s.id));
  await p.taskSuggestion.deleteMany({ where: { id: { notIn: [...keep, '-'] } } });
  for (const s of before0) { const { id, ...rest } = s; await p.taskSuggestion.update({ where: { id }, data: rest }).catch(() => null); }
  await p.notification.deleteMany({ where: { userId: { in: ids } } });
  await p.auditLogEntry.deleteMany({ where: { actorId: { in: ids } } });
  await p.session.deleteMany({ where: { userId: { in: ids } } });
  await p.user.deleteMany({ where: { email: { startsWith: TAG } } });
  await unlockRow(p, 'task.suggestions');
  await app?.close();
  await p?.$disconnect?.();
});

const as = (who, method, url, payload) => app.inject({ method, url, headers: { cookie: who.cookie }, ...(payload ? { payload } : {}) });
const scan = () => as(admin, 'GET', '/admin/tasks/suggestions?refresh=1');
const clean = (label, text) => { for (const s of SECRETS) assert.equal(String(text).includes(s), false, `${label} carries "${s}": ${text}`); };

describe('the site proposes, scrubbed and once (db)', { skip }, () => {
  test('twelve sightings, two scans, one proposal, nothing secret in it', async () => {
    assert.equal((await scan()).statusCode, 200);
    assert.equal((await scan()).statusCode, 200);
    const rows = await p.taskSuggestion.findMany({ where: { dedupKey: key } });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].count, 12);
    assert.equal(rows[0].sourceCap, 'manage_analytics');
    clean('the stored title', rows[0].title);
    clean('the stored body', rows[0].body);
    // The words survive, the run tag included in the token it looks like; everything else is a placeholder.
    assert.equal(rows[0].title, 'Server error: [token]: GET [path] failed, see [url] and mail [email]');
  });

  test('a dispatcher who cannot read the error log neither sees it nor accepts it by id', async () => {
    const row = await p.taskSuggestion.findUnique({ where: { dedupKey: key } });
    const list = await as(disp, 'GET', '/admin/tasks/suggestions');
    assert.equal(list.statusCode, 200);
    assert.equal(list.json().suggestions.some((s) => s.id === row.id), false);
    assert.equal((await as(disp, 'POST', `/admin/tasks/suggestions/${row.id}/accept`, {})).statusCode, 404);
    assert.equal((await as(disp, 'POST', `/admin/tasks/suggestions/${row.id}/dismiss`, {})).statusCode, 404);
  });

  test('accepted, it becomes a task that is still clean; closed, the incident is proposed again', async () => {
    const row = await p.taskSuggestion.findUnique({ where: { dedupKey: key } });
    const r = await as(admin, 'POST', `/admin/tasks/suggestions/${row.id}/accept`, { priority: 'high' });
    assert.equal(r.statusCode, 201, r.body);
    const task = r.json().task;
    clean('the task title', task.title);
    clean('the task body', task.body);
    assert.match(task.body, /\[Open the source\]\(\/admin\?s=errors\)/);
    assert.equal((await as(admin, 'POST', `/admin/tasks/suggestions/${row.id}/accept`, {})).statusCode, 409, 'accepted once');

    await scan();
    let again = await p.taskSuggestion.findMany({ where: { dedupKey: key } });
    assert.equal(again.length, 1);
    assert.equal(again[0].state, 'accepted', 'the task is open: nothing new to say');

    assert.equal((await as(admin, 'POST', `/admin/tasks/${task.id}/state`, { state: 'done' })).statusCode, 200);
    await scan();
    again = await p.taskSuggestion.findMany({ where: { dedupKey: key } });
    assert.equal(again.length, 1, 'still one row: the same incident, reopened');
    assert.equal(again[0].state, 'open');
    assert.equal(again[0].taskId, null);
  });

  test('dismiss, then restore: the undo puts it back', async () => {
    const row = await p.taskSuggestion.findUnique({ where: { dedupKey: key } });
    assert.equal((await as(admin, 'POST', `/admin/tasks/suggestions/${row.id}/dismiss`, {})).statusCode, 200);
    await scan();
    assert.equal((await p.taskSuggestion.findUnique({ where: { dedupKey: key } })).state, 'dismissed', 'a scan respects a dismissal');
    const dismissed = await as(admin, 'GET', '/admin/tasks/suggestions?state=dismissed');
    assert.ok(dismissed.json().suggestions.some((s) => s.id === row.id));
    assert.equal((await as(admin, 'POST', `/admin/tasks/suggestions/${row.id}/restore`, {})).statusCode, 200);
    assert.equal((await p.taskSuggestion.findUnique({ where: { dedupKey: key } })).state, 'open');
  });
});

// Early access (agent-prerelease, Sept 25 2026): routes/prereleases.mjs, lib/prerelease.mjs.
//
// PURE (always runs): the phases, the draw (reproducible from its record, sensitive to the seed,
// fair over many seeds, unbiased), every selection mode, the CSV that a spreadsheet cannot run,
// and the serialiser that never prints the seed before a round nor the file's key or URL.
//
// OVER HTTP (DATABASE_URL, a throwaway Postgres, like every DB test here):
//   · the doors: anonymous 401, a plain member 403, the editor of ANOTHER project 403, the
//     editor without 2FA 403, the project's editor 2xx, a studio-only grant 403;
//   · sign-up: an account, a confirmed address when mail is on, a day-old account, the window,
//     the capacity, one per account; the confirmation mail through the mail stub;
//   · each selection mode end to end, the draw recomputed from the stored record, the preview
//     equal to the run, a changed list refused, the selected / not-selected mails and the mute;
//   · the download: anonymous, not signed up, pending, not selected, withdrawn, closed, and the
//     selected member (a two-minute presigned GET, or the external URL); never in a response;
//   · what leaks: drafts and whitelisted projects stay out of listings, a member sees only their
//     own status, the sign-up list is the editors';
//   · closing an account deletes its sign-ups.
//
// BORN RED, checked 2026-09-26 by a mutation script, 7 of 7 red then green again (each mutation made, the named test watched fail, reverted):
//   · download route: `signup.status !== 'selected'` -> `false`        => "a pending member ... 403" red
//   · drawWinners: `uniformBelow(gen, a.length - i)` -> `0`             => "fair over many seeds" red
//   · selection: dropping the entrantsHash comparison                   => "a changed list is refused" red
//   · signup: removing the capacity check                               => "the capacity is a hard cap" red
//   · closure.mjs: removing the preReleaseSignup.deleteMany line         => "closing an account" red
//   · manageTarget: `may = canEditTarget(...)` -> `may = true`          => "every management route refuses" red
//   · serPublic: printing the seed before any round                      => "never carries the seed" red
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import jwt from 'jsonwebtoken';
import {
  phaseOf, drawWinners, selectRound, canonicalEntrants, entrantsHash, seedHashOf, newSeed, csvCell, signupsCsv,
  serPublic, windowOf, isOwnFileKey, prereleaseWriteSchema, DRAW_ALGO,
} from '../src/lib/prerelease.mjs';

const HOUR = 3600_000;
const DAY = 24 * HOUR;

// ── pure ─────────────────────────────────────────────────────────────────────────────────
describe('pre-release: pure rules', () => {
  const base = { published: true, closedAt: null, opensAt: null, closesAt: null, selectedAt: null, mode: 'draw' };
  test('phases follow the dates, the selection and the close', () => {
    const now = Date.parse('2026-09-25T12:00:00Z');
    assert.equal(phaseOf({ ...base, published: false }, now), 'draft');
    assert.equal(phaseOf({ ...base, opensAt: new Date(now + HOUR) }, now), 'upcoming');
    assert.equal(phaseOf(base, now), 'open');
    assert.equal(phaseOf({ ...base, closesAt: new Date(now - HOUR) }, now), 'selecting');
    assert.equal(phaseOf({ ...base, selectedAt: new Date(now - HOUR) }, now), 'available', 'a round ends the window');
    assert.equal(phaseOf({ ...base, closedAt: new Date(now) }, now), 'closed');
    assert.equal(phaseOf({ ...base, mode: 'all', selectedAt: new Date(now) }, now), 'open', 'open-to-all keeps its window');
    assert.equal(phaseOf({ ...base, mode: 'all', closesAt: new Date(now - 1) }, now), 'available');
  });

  test('the window: closing before opening is refused, and an edit keeps what it does not name', () => {
    assert.equal(windowOf({ opensAt: '2026-10-02', closesAt: '2026-10-01' }).error, 'closes_before_opens');
    const w = windowOf({ closesAt: '2026-10-05' }, { opensAt: new Date('2026-10-01') });
    assert.equal(w.opensAt.toISOString().slice(0, 10), '2026-10-01');
    assert.equal(w.closesAt.toISOString().slice(0, 10), '2026-10-05');
  });

  test('the draw is a pure function of seed, entrants, count and round', () => {
    const seed = 'a'.repeat(64);
    const ids = Array.from({ length: 30 }, (_, i) => `s${i}`);
    const one = drawWinners(seed, ids, 5, 1);
    assert.deepEqual(drawWinners(seed, ids, 5, 1), one, 'same inputs, same winners');
    assert.equal(new Set(one).size, 5, 'no one drawn twice');
    assert.ok(one.every((id) => ids.includes(id)));
    assert.notDeepEqual(drawWinners('b'.repeat(64), ids, 5, 1), one, 'another seed, another draw');
    assert.notDeepEqual(drawWinners(seed, ids, 5, 2), one, 'another round, another draw');
    assert.deepEqual(drawWinners(seed, ids, 99, 1).sort(), [...ids].sort(), 'more places than entrants: everybody');
    assert.deepEqual(drawWinners(seed, [], 3, 1), []);
    assert.throws(() => drawWinners('short', ids, 1, 1), /32 bytes/);
  });

  test('the draw can be recomputed by anyone from the published algorithm', () => {
    // An independent re-implementation of hmac-sha256-fisher-yates-v1, written from the comment
    // and not from the code: this is what a sceptical member would write.
    function check(seed, entrants, n, round) {
      const a = [...entrants];
      let counter = 0; let buf = []; const next = () => {
        if (!buf.length) { const h = createHmac('sha256', Buffer.from(seed, 'hex')).update(`${round}:${counter++}`).digest(); for (let i = 0; i < 32; i += 4) buf.push(h.readUInt32BE(i)); }
        return buf.shift();
      };
      for (let i = 0; i < Math.min(n, a.length); i++) {
        const m = a.length - i; const lim = Math.floor(2 ** 32 / m) * m; let u; do { u = next(); } while (u >= lim);
        const j = i + (u % m); [a[i], a[j]] = [a[j], a[i]];
      }
      return a.slice(0, Math.min(n, a.length));
    }
    for (let k = 0; k < 20; k++) {
      const seed = newSeed();
      const ids = Array.from({ length: 7 + k }, (_, i) => `id-${k}-${i}`);
      assert.deepEqual(drawWinners(seed, ids, 3, 1 + (k % 3)), check(seed, ids, 3, 1 + (k % 3)));
    }
    assert.equal(DRAW_ALGO, 'hmac-sha256-fisher-yates-v1');
  });

  test('fair over many seeds: every entrant is picked about n/m of the time, in any position', () => {
    const ids = Array.from({ length: 10 }, (_, i) => `e${i}`);
    const runs = 6000; const n = 3;
    const hits = Object.fromEntries(ids.map((id) => [id, 0]));
    for (let r = 0; r < runs; r++) {
      const seed = createHash('sha256').update(`fair-${r}`).digest('hex');
      for (const w of drawWinners(seed, ids, n, 1)) hits[w]++;
    }
    const expected = runs * n / ids.length; // 1800
    // 5 sigma of a binomial(6000, 0.3) is about 177: a real bias is far outside, noise inside.
    for (const [id, c] of Object.entries(hits)) assert.ok(Math.abs(c - expected) < 180, `${id} picked ${c} times, expected about ${expected}`);
    // The first and the last entrant in canonical order are not favoured either.
    assert.ok(Math.abs(hits.e0 - hits.e9) < 250);
  });

  test('selection modes over the pending sign-ups', () => {
    const t0 = Date.parse('2026-09-20T00:00:00Z');
    const pending = [
      { id: 'c', createdAt: new Date(t0 + 3000) }, { id: 'a', createdAt: new Date(t0 + 1000) },
      { id: 'b2', createdAt: new Date(t0 + 2000) }, { id: 'b1', createdAt: new Date(t0 + 2000) },
    ];
    assert.deepEqual(canonicalEntrants(pending), ['a', 'b1', 'b2', 'c'], 'time, then id');
    assert.deepEqual(selectRound(pending, { mode: 'first', count: 2 }).winners, ['a', 'b1']);
    assert.deepEqual(selectRound(pending, { mode: 'all' }).winners, ['a', 'b1', 'b2', 'c']);
    assert.deepEqual(selectRound(pending, { mode: 'manual', signupIds: ['c', 'a'] }).winners, ['a', 'c'], 'kept in canonical order');
    assert.equal(selectRound(pending, { mode: 'manual', signupIds: ['nobody'] }).error, 'not_a_pending_signup');
    assert.equal(selectRound(pending, { mode: 'manual', signupIds: [] }).error, 'nobody_picked');
    assert.equal(selectRound(pending, { mode: 'first' }).error, 'invalid_count');
    const seed = 'c'.repeat(64);
    assert.deepEqual(selectRound(pending, { mode: 'draw', count: 2, seed, round: 1 }).winners, drawWinners(seed, ['a', 'b1', 'b2', 'c'], 2, 1));
  });

  test('the public shape never carries the seed before a round, nor the file', () => {
    const seed = newSeed();
    const row = { id: 'x', slug: 's', title: 'T', published: true, mode: 'draw', seed, seedHash: seedHashOf(seed), draws: [], downloadKey: 'prerelease/x/k', downloadUrl: 'https://files.example.com/secret.zip' };
    const before = JSON.stringify(serPublic(row));
    assert.ok(!before.includes(seed), 'the seed leaked before any round');
    assert.ok(!before.includes('prerelease/x/k') && !before.includes('secret.zip'), 'the file leaked');
    assert.equal(serPublic(row).hasFile, true);
    const after = serPublic({ ...row, draws: [{ round: 1, mode: 'draw', entrants: ['a'], winners: ['a'], entrantsHash: entrantsHash(['a']) }] });
    assert.equal(after.seed, seed, 'revealed after the first round');
    assert.equal(seedHashOf(after.seed), after.seedHash, 'and it matches the commitment');
  });

  test('a stored file key must be this pre-release own', () => {
    assert.equal(isOwnFileKey('abc', 'prerelease/abc/1-a.zip'), true);
    assert.equal(isOwnFileKey('abc', 'prerelease/abd/1-a.zip'), false);
    assert.equal(isOwnFileKey('abc', 'blog/x.png'), false);
    assert.equal(isOwnFileKey('abc', 'prerelease/abc/../../uploads/u/x'), false);
  });

  test('an external download must be https', () => {
    assert.equal(prereleaseWriteSchema.safeParse({ title: 'Tt', downloadUrl: 'javascript:alert(1)' }).success, false);
    assert.equal(prereleaseWriteSchema.safeParse({ title: 'Tt', downloadUrl: 'http://x.example/a.zip' }).success, false);
    assert.equal(prereleaseWriteSchema.safeParse({ title: 'Tt', downloadUrl: 'https://x.example/a.zip' }).success, true);
  });

  test('the CSV export cannot run in a spreadsheet', () => {
    assert.equal(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
    assert.equal(csvCell('+1'), "'+1");
    assert.equal(csvCell('@a'), "'@a");
    assert.equal(csvCell('plain'), 'plain');
    const csv = signupsCsv([{ id: 's1', userId: 'u1', user: { displayName: '-cmd' }, status: 'pending', createdAt: new Date(0), decidedAt: null, message: 'a,b' }]);
    assert.match(csv, /^signup_id,member,/);
    assert.match(csv, /s1,'-cmd,u1,pending,1970-01-01T00:00:00.000Z,,"a,b"/);
  });
});

// ── over HTTP ────────────────────────────────────────────────────────────────────────────
const RUN = !!process.env.DATABASE_URL;
const skip = RUN ? false : 'set DATABASE_URL to a throwaway Postgres to run the pre-release routes';
process.env.JWT_SECRET ||= 'prerelease-test-secret';
// storage.mjs signs URLs locally; it needs credentials to exist, not to be valid.
process.env.S3_ACCESS_KEY ||= 'test-access';
process.env.S3_SECRET_KEY ||= 'test-secret-key';

const STAMP = Date.now().toString(36);
const TAG = `prel-${STAMP}-`;
const KA = `pra${STAMP}`;
const KB = `prb${STAMP}`;
let p, app, seq = 0;
const A = {};
const F = {};
const mails = [];

async function actor(name, data = {}, grants = []) {
  const u = await p.user.create({ data: {
    email: `${TAG}${name}-${seq++}@bettercommunity.invalid`, displayName: `${TAG}${name}`, role: 'USER', totpEnabled: true,
    emailVerified: true, createdAt: new Date(Date.now() - 10 * DAY), ...data,
  } });
  const sess = await p.session.create({ data: { userId: u.id }, select: { id: true } });
  for (const g of grants) await p.projectPermission.create({ data: { userId: u.id, rights: ['pages'], grantedBy: u.id, ...g } });
  A[name] = { user: u, cookie: `bcw_session=${jwt.sign({ uid: u.id, role: u.role, sid: sess.id }, process.env.JWT_SECRET)}` };
}
async function call(name, method, url, payload) {
  const res = await app.inject({ method, url, headers: name ? { cookie: A[name].cookie } : {}, payload });
  let body = null; try { body = res.json(); } catch { /* not json */ }
  return { status: res.statusCode, body, headers: res.headers, raw: res.body };
}
const mailsTo = (name, mailId) => mails.filter((m) => m.to === A[name].user.email && (!mailId || m.mailId === mailId));

/** Open a pre-release on project KA as its editor, published and open. */
async function open(extra = {}) {
  const r = await call('editorA', 'POST', `/projects-prereleases/${KA}`, { title: `Early ${seq++}`, pitch: 'Try it first', published: true, mode: 'manual', ...extra });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.prerelease;
}
const signup = (name, slug, payload = {}) => call(name, 'POST', `/prereleases/${slug}/signup`, payload);

before(async () => {
  if (!RUN) return;
  const lib = await import('../src/lib/lib.mjs');
  p = await lib.db();
  for (const k of [KA, KB]) {
    await p.project.create({ data: { key: k, name: `${TAG}${k}` } });
    await p.adminSetting.create({ data: { key: `project.${k}`, value: { name: `Proj ${k}` } } });
  }
  (await import('../src/lib/project-keys.mjs')).forgetProjectKeys();
  const W = await p.showcaseProject.create({ data: { slug: `${TAG}wl`, name: `${TAG}WL`, short: 'WL', published: true, visibility: 'whitelist', visibilityWhitelist: [], config: {} } });
  F.W = W; F.refW = `sc:${W.slug}`;
  await actor('ADMIN', { role: 'ADMIN' });
  await actor('USER');
  await actor('editorA', {}, [{ projectKey: KA }]);
  await actor('editorB', {}, [{ projectKey: KB }]);
  await actor('editorA_no2fa', { totpEnabled: false }, [{ projectKey: KA }]);
  await actor('studioOnlyA');
  await p.projectPermission.create({ data: { userId: A.studioOnlyA.user.id, rights: ['studio'], grantedBy: A.ADMIN.user.id, projectKey: KA } });
  for (const n of ['m1', 'm2', 'm3', 'm4', 'm5', 'm6']) await actor(n);
  await actor('muted', { notifPrefs: { releases: false } });
  await actor('fresh', { createdAt: new Date() });
  await actor('unverified', { emailVerified: false });
  await actor('leaver');

  const { setPrereleaseSender } = await import('../src/lib/prerelease-mail.mjs');
  setPrereleaseSender(async (m) => { mails.push(m); return true; });
  const Fastify = (await import('fastify')).default;
  app = Fastify();
  await app.register((await import('@fastify/cookie')).default);
  await app.register((await import('../src/routes/prereleases.mjs')).default);
  await app.ready();
});

after(async () => {
  if (!RUN) return;
  try {
    const targets = [KA, KB, `sc:${F.W?.id}`];
    await p.preRelease.deleteMany({ where: { target: { in: targets } } });
    const ids = (await p.user.findMany({ where: { email: { startsWith: TAG } }, select: { id: true } })).map((u) => u.id);
    const none = ids.length ? ids : ['-'];
    await p.projectPermission.deleteMany({ where: { userId: { in: none } } });
    await p.adminSetting.deleteMany({ where: { key: { in: [`project.${KA}`, `project.${KB}`] } } });
    await p.project.deleteMany({ where: { key: { in: [KA, KB] } } });
    await p.showcaseProject.deleteMany({ where: { slug: { startsWith: TAG } } });
    await p.auditLogEntry.deleteMany({ where: { actorId: { in: none } } }).catch(() => null);
    await p.notification.deleteMany({ where: { userId: { in: none } } }).catch(() => null);
    await p.session.deleteMany({ where: { userId: { in: none } } });
    await p.user.deleteMany({ where: { id: { in: none } } });
    (await import('../src/lib/project-keys.mjs')).forgetProjectKeys();
    (await import('../src/lib/prerelease-mail.mjs')).setPrereleaseSender(null);
  } finally { await app?.close(); }
});

describe('pre-release: who may manage one', { skip }, () => {
  test('create: anonymous 401, member 403, another project editor 403, no 2FA 403, studio-only 403, editor 201', async () => {
    const body = { title: 'Door test', published: false };
    assert.equal((await call(null, 'POST', `/projects-prereleases/${KA}`, body)).status, 401);
    assert.equal((await call('USER', 'POST', `/projects-prereleases/${KA}`, body)).status, 403);
    assert.equal((await call('editorB', 'POST', `/projects-prereleases/${KA}`, body)).status, 403);
    const no2fa = await call('editorA_no2fa', 'POST', `/projects-prereleases/${KA}`, body);
    assert.equal(no2fa.status, 403); assert.equal(no2fa.body.error, '2fa_required');
    assert.equal((await call('studioOnlyA', 'POST', `/projects-prereleases/${KA}`, body)).status, 403);
    const ok = await call('editorA', 'POST', `/projects-prereleases/${KA}`, body);
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    F.draftId = ok.body.prerelease.id; F.draftSlug = ok.body.prerelease.slug;
    assert.equal(ok.body.prerelease.seed, null, 'the seed was returned on creation');
    assert.match(ok.body.prerelease.seedHash, /^[0-9a-f]{64}$/);
  });

  test('every management route refuses a member and another project editor, and opens for the editor', async () => {
    const id = F.draftId;
    const routes = [
      ['GET', `/prerelease-manage/${id}`], ['PATCH', `/prerelease-manage/${id}`, { pitch: 'x' }],
      ['POST', `/prerelease-manage/${id}/file`, { filename: 'a.zip', contentType: 'application/zip', size: 10 }],
      ['POST', `/prerelease-manage/${id}/selection/preview`, { mode: 'all' }],
      ['POST', `/prerelease-manage/${id}/selection`, { mode: 'all' }],
      ['GET', `/prerelease-manage/${id}/export.csv`], ['POST', `/prerelease-manage/${id}/close`],
      ['DELETE', `/prerelease-manage/${id}`],
    ];
    for (const [m, u, b] of routes) {
      assert.equal((await call(null, m, u, b)).status, 401, `${m} ${u} anonymous`);
      assert.equal((await call('USER', m, u, b)).status, 403, `${m} ${u} member`);
      assert.equal((await call('editorB', m, u, b)).status, 403, `${m} ${u} editor of B`);
      assert.equal((await call('studioOnlyA', m, u, b)).status, 403, `${m} ${u} studio-only grant`);
    }
    // And the editor passes each door (the destructive ones last).
    assert.equal((await call('editorA', 'GET', `/prerelease-manage/${id}`)).status, 200);
    assert.equal((await call('editorA', 'PATCH', `/prerelease-manage/${id}`, { pitch: 'x' })).status, 200);
    const csv = await call('editorA', 'GET', `/prerelease-manage/${id}/export.csv`);
    assert.equal(csv.status, 200); assert.match(csv.headers['content-type'], /text\/csv/);
    const f = await call('editorA', 'POST', `/prerelease-manage/${id}/file`, { filename: 'a.zip', contentType: 'application/zip', size: 10 });
    assert.equal(f.status, 200, JSON.stringify(f.body));
    assert.ok(f.body.key.startsWith(`prerelease/${id}/`));
    assert.equal((await call('ADMIN', 'GET', `/prerelease-manage/${id}`)).status, 200, 'a manager of every project');
    // The manage list is scoped: B's editor sees none of A's.
    const listB = await call('editorB', 'GET', '/prerelease-manage');
    assert.ok(!listB.body.prereleases.some((x) => x.id === id));
    assert.ok((await call('editorA', 'GET', '/prerelease-manage')).body.prereleases.some((x) => x.id === id));
  });

  test('a file key that is not this pre-release own is refused', async () => {
    const r = await call('editorA', 'PATCH', `/prerelease-manage/${F.draftId}`, { downloadKey: 'uploads/someone/secret.zip' });
    assert.equal(r.status, 400); assert.equal(r.body.error, 'invalid_file_key');
  });

  test('a draft is nobody else business: 404, and absent from every listing', async () => {
    assert.equal((await call(null, 'GET', `/prereleases/${F.draftSlug}`)).status, 404);
    assert.equal((await call('USER', 'GET', `/prereleases/${F.draftSlug}`)).status, 404);
    assert.equal((await call('editorA', 'GET', `/prereleases/${F.draftSlug}`)).status, 200);
    assert.ok(!(await call(null, 'GET', '/prereleases')).body.prereleases.some((x) => x.slug === F.draftSlug));
    assert.ok(!(await call(null, 'GET', `/projects-prereleases/${KA}`)).body.prereleases.some((x) => x.slug === F.draftSlug));
    assert.equal((await signup('m1', F.draftSlug)).status, 404);
  });
});

describe('pre-release: signing up', { skip }, () => {
  let pr;
  before(async () => { if (RUN) pr = await open({ capacity: 3 }); });

  test('anonymous: 401; a day-old account only; one per account', async () => {
    assert.equal((await signup(null, pr.slug)).status, 401);
    const young = await signup('fresh', pr.slug);
    assert.equal(young.status, 403); assert.equal(young.body.error, 'account_too_new');
    const r = await signup('m1', pr.slug, { message: 'I test on Linux' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.me.status, 'pending');
    const again = await signup('m1', pr.slug);
    assert.equal(again.status, 409); assert.equal(again.body.error, 'already_signed_up');
  });

  test('the confirmation mail goes through the mail stub, and links to the page, not a file', () => {
    const m = mailsTo('m1', 'prerelease-signup');
    assert.equal(m.length, 1);
    assert.match(m[0].html, new RegExp(`/prereleases/${pr.slug}`));
    assert.doesNotMatch(m[0].html, /\/download/);
  });

  test('when mail is on, an unconfirmed address is refused', async () => {
    const saved = [process.env.EMAIL_ENABLED, process.env.SMTP_HOST];
    process.env.EMAIL_ENABLED = 'true'; process.env.SMTP_HOST = 'smtp.invalid';
    try {
      const r = await signup('unverified', pr.slug);
      assert.equal(r.status, 403); assert.equal(r.body.error, 'email_unverified');
    } finally {
      if (saved[0] === undefined) delete process.env.EMAIL_ENABLED; else process.env.EMAIL_ENABLED = saved[0];
      if (saved[1] === undefined) delete process.env.SMTP_HOST; else process.env.SMTP_HOST = saved[1];
    }
  });

  test('the capacity is a hard cap, even for requests that arrive together', async () => {
    const rs = await Promise.all(['m2', 'm3', 'm4', 'm5'].map((n) => signup(n, pr.slug)));
    assert.equal(rs.filter((r) => r.status === 201).length, 2, rs.map((r) => r.status).join(','));
    assert.ok(rs.filter((r) => r.status === 409).every((r) => r.body.error === 'full'));
    assert.equal(await p.preReleaseSignup.count({ where: { prereleaseId: pr.id } }), 3);
  });

  test('a member sees their own status, and nothing about anybody else', async () => {
    const d = await call('m1', 'GET', `/prereleases/${pr.slug}`);
    assert.equal(d.body.me.status, 'pending');
    assert.equal(d.body.canManage, false);
    const text = JSON.stringify(d.body);
    for (const other of ['m2', 'm3', 'm4', 'm5']) {
      assert.ok(!text.includes(A[other].user.id) && !text.includes(A[other].user.displayName), `${other} leaked into m1's view`);
    }
    assert.equal(d.body.prerelease.signups, 3, 'a count is fine');
    assert.equal(d.body.prerelease.spotsLeft, 0);
    const mine = await call('m1', 'GET', '/me/prereleases');
    assert.ok(mine.body.signups.some((s) => s.prerelease.slug === pr.slug && s.me.status === 'pending'));
    // The editor reads the list, with the message and no address.
    const ed = await call('editorA', 'GET', `/prerelease-manage/${pr.id}`);
    assert.equal(ed.body.signups.length, 3);
    assert.ok(ed.body.signups.some((s) => s.message === 'I test on Linux'));
    assert.ok(!JSON.stringify(ed.body).includes('@bettercommunity.invalid'), 'an address reached a project editor');
  });

  test('outside the window, no sign-up', async () => {
    const later = await open({ opensAt: new Date(Date.now() + DAY).toISOString() });
    const r = await signup('m6', later.slug);
    assert.equal(r.status, 409); assert.equal(r.body.error, 'closed');
    const ended = await open({ closesAt: new Date(Date.now() + 50).toISOString() });
    await new Promise((res) => setTimeout(res, 80));
    assert.equal((await signup('m6', ended.slug)).body.error, 'closed');
  });
});

describe('pre-release: selection modes', { skip }, () => {
  test('manual: exactly the picked sign-ups, others stay pending unless told', async () => {
    const pr = await open({ mode: 'manual' });
    for (const n of ['m1', 'm2', 'm3']) assert.equal((await signup(n, pr.slug)).status, 201);
    const ed = await call('editorA', 'GET', `/prerelease-manage/${pr.id}`);
    const pick = ed.body.signups.find((s) => s.userId === A.m2.user.id).id;
    mails.length = 0;
    const r = await call('editorA', 'POST', `/prerelease-manage/${pr.id}/selection`, { mode: 'manual', signupIds: [pick] });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.selected, 1);
    const rows = await p.preReleaseSignup.findMany({ where: { prereleaseId: pr.id } });
    assert.deepEqual(rows.filter((s) => s.status === 'selected').map((s) => s.userId), [A.m2.user.id]);
    assert.equal(rows.filter((s) => s.status === 'pending').length, 2, 'others are not decided without notifyOthers');
    assert.equal(mailsTo('m2', 'prerelease-selected').length, 1);
    assert.equal(mails.filter((m) => m.mailId === 'prerelease-not-selected').length, 0);
    // The member sees it; the round ended the window.
    assert.equal((await call('m2', 'GET', `/prereleases/${pr.slug}`)).body.me.status, 'selected');
    assert.equal((await call('m1', 'GET', `/prereleases/${pr.slug}`)).body.prerelease.phase, 'available');
    assert.equal((await signup('m4', pr.slug)).body.error, 'closed');
    // A pick that is not a pending sign-up is refused.
    assert.equal((await call('editorA', 'POST', `/prerelease-manage/${pr.id}/selection`, { mode: 'manual', signupIds: [pick] })).body.error, 'not_a_pending_signup');
  });

  test('first come: the earliest N', async () => {
    const pr = await open({ mode: 'first' });
    for (const n of ['m3', 'm1', 'm2']) { assert.equal((await signup(n, pr.slug)).status, 201); await new Promise((res) => setTimeout(res, 5)); }
    const r = await call('editorA', 'POST', `/prerelease-manage/${pr.id}/selection`, { mode: 'first', count: 2 });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const sel = (await p.preReleaseSignup.findMany({ where: { prereleaseId: pr.id, status: 'selected' } })).map((s) => s.userId).sort();
    assert.deepEqual(sel, [A.m3.user.id, A.m1.user.id].sort());
  });

  test('open to all: a sign-up is selected at once, and gets the access mail', async () => {
    const pr = await open({ mode: 'all' });
    mails.length = 0;
    const r = await signup('m5', pr.slug);
    assert.equal(r.status, 201); assert.equal(r.body.me.status, 'selected');
    assert.equal(mailsTo('m5', 'prerelease-selected').length, 1);
    assert.equal((await call('m5', 'GET', `/prereleases/${pr.slug}`)).body.prerelease.phase, 'open', 'the window stays open');
  });

  test('draw: the preview is the run, the record recomputes, the seed matches its commitment', async () => {
    const pr = await open({ mode: 'draw', selectCount: 2, notifyNotSelected: true });
    const committed = pr.seedHash;
    for (const n of ['m1', 'm2', 'm3', 'm4', 'muted']) assert.equal((await signup(n, pr.slug)).status, 201);
    const pub = await call(null, 'GET', `/prereleases/${pr.slug}`);
    assert.equal(pub.body.prerelease.seed, null, 'the seed is public before the draw');
    assert.equal(pub.body.prerelease.seedHash, committed);
    const prev = await call('editorA', 'POST', `/prerelease-manage/${pr.id}/selection/preview`, { mode: 'draw' });
    assert.equal(prev.status, 200, JSON.stringify(prev.body));
    assert.equal(prev.body.winners.length, 2);
    assert.equal(prev.body.entrants, 5);
    mails.length = 0;
    const run = await call('editorA', 'POST', `/prerelease-manage/${pr.id}/selection`, { mode: 'draw', entrantsHash: prev.body.entrantsHash });
    assert.equal(run.status, 200, JSON.stringify(run.body));
    const row = await p.preRelease.findUnique({ where: { id: pr.id } });
    const rec = row.draws[0];
    assert.deepEqual(rec.winners, prev.body.winners.map((w) => w.id), 'the run is not the preview');
    assert.equal(seedHashOf(row.seed), committed, 'the seed is not the committed one');
    assert.deepEqual(drawWinners(row.seed, rec.entrants, 2, rec.round), rec.winners, 'the record does not recompute');
    assert.equal(entrantsHash(rec.entrants), rec.entrantsHash);
    // Public after the round: seed, entrants and winners by sign-up id, enough to recompute.
    const after = (await call(null, 'GET', `/prereleases/${pr.slug}`)).body.prerelease;
    assert.equal(after.seed, row.seed);
    assert.deepEqual(drawWinners(after.seed, after.rounds[0].entrantIds, 2, 1), after.rounds[0].winnerIds);
    // The audit chain has the round.
    const audit = await p.auditLogEntry.findFirst({ where: { actorId: A.editorA.user.id, action: 'prerelease.selection', detail: { contains: pr.slug } } });
    assert.ok(audit, 'no audit entry for the draw');
    assert.match(audit.detail, new RegExp(`seed=${committed.slice(0, 16)}`));
    // Mails: 2 selected; the others told, except the account that muted releases.
    assert.equal(mails.filter((m) => m.mailId === 'prerelease-selected').length, 2);
    const losers = (await p.preReleaseSignup.findMany({ where: { prereleaseId: pr.id, status: 'not_selected' }, select: { userId: true } })).map((s) => s.userId);
    assert.equal(losers.length, 3);
    const expectMailed = losers.filter((id) => id !== A.muted.user.id).length;
    assert.equal(mails.filter((m) => m.mailId === 'prerelease-not-selected').length, expectMailed);
    assert.equal(mailsTo('muted', 'prerelease-not-selected').length, 0, 'a muted account was mailed');
  });

  test('a draw over a list that changed since its preview is refused', async () => {
    const pr = await open({ mode: 'draw', selectCount: 1 });
    for (const n of ['m1', 'm2']) await signup(n, pr.slug);
    const prev = await call('editorA', 'POST', `/prerelease-manage/${pr.id}/selection/preview`, { mode: 'draw' });
    await signup('m3', pr.slug);
    const run = await call('editorA', 'POST', `/prerelease-manage/${pr.id}/selection`, { mode: 'draw', entrantsHash: prev.body.entrantsHash });
    assert.equal(run.status, 409); assert.equal(run.body.error, 'entrants_changed');
    assert.equal(await p.preReleaseSignup.count({ where: { prereleaseId: pr.id, status: 'selected' } }), 0);
  });

  test('the mode is locked once a round has run', async () => {
    const pr = await open({ mode: 'first', selectCount: 1 });
    await signup('m1', pr.slug);
    await call('editorA', 'POST', `/prerelease-manage/${pr.id}/selection`, { mode: 'first' });
    const r = await call('editorA', 'PATCH', `/prerelease-manage/${pr.id}`, { mode: 'draw' });
    assert.equal(r.status, 409); assert.equal(r.body.error, 'mode_locked');
  });
});

describe('pre-release: the download is for the selected only', { skip }, () => {
  let pr, key;
  before(async () => {
    if (!RUN) return;
    pr = await open({ mode: 'manual' });
    const f = await call('editorA', 'POST', `/prerelease-manage/${pr.id}/file`, { filename: 'Early build.zip', contentType: 'application/zip', size: 1234 });
    key = f.body.key;
    assert.equal((await call('editorA', 'PATCH', `/prerelease-manage/${pr.id}`, { downloadKey: key, downloadName: 'Early build.zip', downloadSize: 1234 })).status, 200);
    for (const n of ['m1', 'm2', 'm3']) await signup(n, pr.slug);
    const ed = await call('editorA', 'GET', `/prerelease-manage/${pr.id}`);
    const ids = ed.body.signups.filter((s) => [A.m1.user.id, A.m3.user.id].includes(s.userId)).map((s) => s.id);
    await call('editorA', 'POST', `/prerelease-manage/${pr.id}/selection`, { mode: 'manual', signupIds: ids });
  });

  test('anonymous 401; not signed up 403; a pending member 403', async () => {
    assert.equal((await call(null, 'GET', `/prereleases/${pr.slug}/download`)).status, 401);
    const stranger = await call('m6', 'GET', `/prereleases/${pr.slug}/download`);
    assert.equal(stranger.status, 403); assert.equal(stranger.body.error, 'not_selected');
    const pending = await call('m2', 'GET', `/prereleases/${pr.slug}/download`);
    assert.equal(pending.status, 403); assert.equal(pending.body.error, 'not_selected');
  });

  test('a selected member gets a two-minute presigned GET of this file, never cached', async () => {
    const r = await call('m1', 'GET', `/prereleases/${pr.slug}/download`);
    assert.equal(r.status, 302, r.raw);
    assert.ok(r.headers.location.includes(`/${key}?`), r.headers.location);
    assert.match(r.headers.location, /X-Amz-Expires=120\b/);
    assert.equal(r.headers['cache-control'], 'no-store');
  });

  test('the file key and URL are in no response a reader gets', async () => {
    for (const who of [null, 'm1', 'm2']) {
      const bodies = [
        (await call(who, 'GET', `/prereleases/${pr.slug}`)).raw,
        (await call(who, 'GET', '/prereleases')).raw,
        (await call(who, 'GET', `/projects-prereleases/${KA}`)).raw,
      ];
      for (const b of bodies) assert.ok(!b.includes(key), `${who || 'anonymous'} was handed the key`);
    }
  });

  test('withdrawing takes the access with it', async () => {
    assert.equal((await call('m3', 'DELETE', `/prereleases/${pr.slug}/signup`)).status, 200);
    assert.equal((await call('m3', 'GET', `/prereleases/${pr.slug}/download`)).status, 403);
    assert.equal((await call('m3', 'GET', `/prereleases/${pr.slug}`)).body.me, null);
  });

  test('an external file: the selected member is redirected to it, and only they learn it', async () => {
    const ext = await open({ mode: 'all', downloadUrl: 'https://files.example.com/early/secret-build.zip' });
    assert.ok(!(await call(null, 'GET', `/prereleases/${ext.slug}`)).raw.includes('secret-build'));
    await signup('m4', ext.slug);
    const r = await call('m4', 'GET', `/prereleases/${ext.slug}/download`);
    assert.equal(r.status, 302); assert.equal(r.headers.location, 'https://files.example.com/early/secret-build.zip');
    assert.equal((await call('m5', 'GET', `/prereleases/${ext.slug}/download`)).status, 403);
  });

  test('closing ends the downloads', async () => {
    assert.equal((await call('editorA', 'POST', `/prerelease-manage/${pr.id}/close`)).status, 200);
    const r = await call('m1', 'GET', `/prereleases/${pr.slug}/download`);
    assert.equal(r.status, 403); assert.equal(r.body.error, 'not_available');
    assert.ok(!(await call(null, 'GET', '/prereleases')).body.prereleases.some((x) => x.slug === pr.slug), 'a closed one is still listed');
  });
});

describe('pre-release: listings respect the project page', { skip }, () => {
  test('a whitelisted project: not listed, and its page refuses a stranger', async () => {
    const r = await call('ADMIN', 'POST', `/projects-prereleases/${encodeURIComponent(F.refW)}`, { title: 'Hidden early', published: true });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.ok(!(await call(null, 'GET', '/prereleases')).body.prereleases.some((x) => x.slug === r.body.prerelease.slug));
    assert.equal((await call('m1', 'GET', `/prereleases/${r.body.prerelease.slug}`)).status, 404);
    assert.equal((await signup('m1', r.body.prerelease.slug)).status, 404);
  });

  test('filters: by project and by phase', async () => {
    const all = (await call(null, 'GET', `/prereleases?project=${KA}`)).body.prereleases;
    assert.ok(all.length > 0 && all.every((x) => x.project.ref === KA));
    const openOnes = (await call(null, 'GET', '/prereleases?status=open')).body.prereleases;
    assert.ok(openOnes.every((x) => x.phase === 'open'));
    assert.deepEqual((await call(null, 'GET', `/prereleases?project=${KB}`)).body.prereleases, []);
  });
});

describe('pre-release: closing an account', { skip }, () => {
  test('deletes its sign-ups (and so its access)', async () => {
    const pr = await open({ mode: 'all' });
    assert.equal((await signup('leaver', pr.slug)).status, 201);
    const { anonymiseAccount } = await import('../src/routes/closure.mjs');
    await anonymiseAccount(p, await p.user.findUnique({ where: { id: A.leaver.user.id } }), { removeObject: async () => {} });
    assert.equal(await p.preReleaseSignup.count({ where: { userId: A.leaver.user.id } }), 0, 'a closed account kept its sign-up');
  });
});

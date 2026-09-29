// The moderation engine against a real database: decisions, cases, the queue's actions, the
// optional AI layer, and the two routes wired first (contact and report) over HTTP.
//
// What each part pins:
//   · report and legal end in REVIEW whatever the text or the stored policy says, never copy
//     the text into a case, and the AI cannot change that;
//   · AI absent (null) = the rules' answer, unchanged; AI present can raise a case to REVIEW
//     and never to QUARANTINE / BLOCK; the kill switch stops it being asked at all;
//   · analysis mode acts on nothing and logs what it would have done;
//   · a HELD contact message is not in the inbox until a moderator releases it, and the
//     sender is told the same thing either way;
//   · a false positive teaches the rules (the same text no longer scores);
//   · retention purges the text of closed cases and keeps the decision.
//
// Fixtures are tagged and removed; the moderation settings and `ai.killed` are snapshotted
// and put back. Staff notices are switched off in the policies used here, so no other test's
// staff account receives one.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { lockRow, unlockRow } from './row-lock.mjs';
import { MODERATION_SETTINGS_LOCK } from './helpers/moderation-lock.mjs';

const RUN = !!process.env.DATABASE_URL;
const skip = RUN ? false : 'set DATABASE_URL to a throwaway Postgres to run the moderation engine tests';
process.env.JWT_SECRET ||= 'moderation-engine-test-secret';
process.env.POW_BITS = '1'; // read at import: a real proof, just a cheap one

const TAG = `modeng-${Date.now().toString(36)}-`;
const MAIL = '@moderation-engine.test';
const PHISH = 'Claim your prize now: https://dіscord.com/gift/abc and javascript:alert(1) before it expires';
let p, app, eng, cfgMod, cases, admin, member, adminCookie, memberCookie;
const saved = {};
const KEYS_TO_SAVE = ['moderation.settings', 'moderation.policies', 'moderation.rules', 'ai.killed'];

/** Every surface quiet (no staff notices, no flood or duplicate counting), then `over`. */
function policies(over = {}) {
  const base = { flood: { max: 0, windowSec: 60 }, dup: { windowSec: 0, crossAuthors: 3 }, notify: false, ai: false };
  const out = {};
  for (const s of ['contact', 'report', 'legal', 'crash', 'bug', 'suggestion', 'member_message', 'team_message', 'community', 'discord_automod', 'phishing']) out[s] = { ...base, mode: 'flag', ...(over[s] || {}) };
  return out;
}
// The moderation settings (`moderation.settings|policies|rules`) and `ai.killed` are singleton
// AdminSetting rows that moderation-engine, moderation-followups and ai-provider all write, and
// node --test runs the three files in parallel. Each takes the same row lock (./row-lock.mjs)
// for as long as it owns them: from before its snapshot to after its restore.
const setPolicies = (over) => cfgMod.saveSetting(p, 'moderation.policies', policies(over));

before(async () => {
  if (!RUN) return;
  const lib = await import('../src/lib/lib.mjs');
  p = await lib.db();
  eng = await import('../src/lib/moderation/engine.mjs');
  cfgMod = await import('../src/lib/moderation/config.mjs');
  cases = await import('../src/lib/moderation/cases.mjs');
  await lockRow(p, MODERATION_SETTINGS_LOCK);
  for (const k of KEYS_TO_SAVE) saved[k] = await p.adminSetting.findUnique({ where: { key: k } });
  await p.adminSetting.deleteMany({ where: { key: { in: KEYS_TO_SAVE } } });
  cfgMod.invalidateConfig();
  const old = new Date(Date.now() - 400 * 864e5);
  admin = await p.user.create({ data: { email: `${TAG}admin${MAIL}`, displayName: `${TAG}admin`.slice(0, 40), role: 'SUPERADMIN', totpEnabled: true, emailVerified: true, createdAt: old } });
  member = await p.user.create({ data: { email: `${TAG}member${MAIL}`, displayName: `${TAG}member`.slice(0, 40), emailVerified: true, createdAt: old } });
  const cookieOf = async (u) => {
    const s = await p.session.create({ data: { userId: u.id }, select: { id: true } });
    return `bcw_session=${jwt.sign({ uid: u.id, role: u.role, sid: s.id }, process.env.JWT_SECRET)}`;
  };
  adminCookie = await cookieOf(admin);
  memberCookie = await cookieOf(member);
  const Fastify = (await import('fastify')).default;
  app = Fastify();
  await app.register((await import('@fastify/cookie')).default);
  await app.register((await import('../src/routes/auth.mjs')).default);
  await app.register((await import('../src/routes/misc.mjs')).default);
  await app.register((await import('../src/routes/reports.mjs')).default);
  await app.register((await import('../src/routes/moderation.mjs')).default);
  await app.ready();
});

after(async () => {
  if (!RUN) return;
  try {
    const ids = [admin?.id, member?.id].filter(Boolean);
    await p.moderationCase.deleteMany({ where: { OR: [{ authorId: { in: ids } }, { authorKey: { startsWith: `test:${TAG}` } }, { excerpt: { contains: TAG } }] } });
    await p.contactMessage.deleteMany({ where: { email: { endsWith: MAIL } } });
    const reps = await p.report.findMany({ where: { reporterId: { in: ids } }, select: { id: true } });
    if (reps.length) await p.notification.deleteMany({ where: { href: { in: reps.map((r) => `/admin?s=reports&r=${r.id}`) } } });
    await p.report.deleteMany({ where: { reporterId: { in: ids } } });
    await p.notification.deleteMany({ where: { userId: { in: ids } } });
    await p.auditLogEntry.deleteMany({ where: { actorId: { in: ids } } });
    await p.session.deleteMany({ where: { userId: { in: ids } } });
    await p.user.deleteMany({ where: { id: { in: ids } } });
    for (const k of KEYS_TO_SAVE) {
      if (saved[k]) await p.adminSetting.upsert({ where: { key: k }, create: saved[k], update: { value: saved[k].value } });
      else await p.adminSetting.deleteMany({ where: { key: k } });
    }
  } finally {
    await unlockRow(p, MODERATION_SETTINGS_LOCK);
    eng?._setAiModule?.(null);
    await app?.close();
  }
});

async function pow() {
  const { challenge, difficulty } = (await app.inject({ method: 'GET', url: '/auth/pow' })).json();
  for (let nonce = 0; ; nonce += 1) {
    const h = crypto.createHash('sha256').update(`${challenge}:${nonce}`).digest();
    let bits = 0; for (const b of h) { if (b === 0) { bits += 8; continue; } bits += Math.clz32(b) - 24; break; }
    if (bits >= difficulty) return { challenge, nonce };
  }
}
const as = (cookie) => ({ get: (url) => app.inject({ method: 'GET', url, headers: { cookie } }), post: (url, payload) => app.inject({ method: 'POST', url, headers: { cookie }, payload: payload || {} }), put: (url, payload) => app.inject({ method: 'PUT', url, headers: { cookie }, payload }) });
const waitFor = async (fn, ms = 3000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v || Date.now() > end) return v; await new Promise((r) => setTimeout(r, 50)); } };
let seq = 0;
const key = () => `test:${TAG}${seq++}`;

describe('decisions (db)', { skip }, () => {
  test('auto mode: a phishing message is held, with its payload, in an open case', async () => {
    eng._setAiModule(null);
    await setPolicies({ contact: { mode: 'auto' } });
    const r = await eng.moderate('contact', { text: `${TAG} ${PHISH}`, authorKey: key() }, { p, canHold: true, payload: { name: 'x', email: `held${MAIL}`, body: 'b', kind: 'other' }, holdType: 'contact_held' });
    assert.equal(r.decision, 'BLOCK', JSON.stringify(r.reasons));
    assert.equal(r.action, 'hold');
    const c = await p.moderationCase.findUnique({ where: { id: r.caseId } });
    assert.equal(c.status, 'open');
    assert.equal(c.held, true);
    assert.equal(c.subjectType, 'contact_held');
    assert.equal(c.payload.email, `held${MAIL}`);
    assert.ok(r.reasons.some((x) => x.rule === 'link.scheme_script'));
  });

  test('a dry run ("test this text") stores and counts nothing', async () => {
    // Counted for THIS author only: the suites run in parallel on one database, and a count of
    // every case moved whenever another suite's contact or report route opened one.
    const author = key();
    const mine = () => p.moderationCase.count({ where: { OR: [{ authorKey: author }, { excerpt: { contains: `${TAG} Claim` } }] } });
    const before = await mine();
    const r = await eng.moderate('contact', { text: `${TAG} ${PHISH}`, authorKey: author }, { p, dryRun: true, canHold: true });
    assert.equal(r.caseId, null);
    assert.equal(r.decision, 'BLOCK');
    assert.equal(await mine(), before);
  });

  test('report and legal: REVIEW, never held or refused, and the text is never copied', async () => {
    await setPolicies({ report: { mode: 'auto' }, legal: { mode: 'auto' } });
    for (const s of ['report', 'legal']) {
      const bad = await eng.moderate(s, { text: `${TAG} ${PHISH}`, authorKey: key() }, { p, canHold: true, canRefuse: true, subject: { type: 'report', id: 'r1' } });
      assert.equal(bad.decision, 'REVIEW');
      assert.equal(bad.action, 'allow');
      const c = await p.moderationCase.findUnique({ where: { id: bad.caseId } });
      assert.equal(c.status, 'open');
      assert.equal(c.held, false);
      assert.equal(c.excerpt, null, 'a sensitive case points at the source, it does not copy it');
      const clean = await eng.moderate(s, { text: 'The item at /c/abc uses my artwork without permission.', authorKey: key() }, { p });
      assert.equal(clean.decision, 'REVIEW');
      assert.equal(clean.caseId, null, 'a clean report opens no case: its own queue is the review');
    }
  });

  test('analysis mode acts on nothing and logs what it would have done', async () => {
    await setPolicies({ crash: { mode: 'analyze' } });
    const r = await eng.moderate('crash', { text: `${TAG} ${PHISH}`, authorKey: key() }, { p, canHold: true, canRefuse: true });
    assert.equal(r.decision, 'ALLOW');
    assert.equal(r.action, 'allow');
    assert.equal(r.raw, 'BLOCK');
    const c = await p.moderationCase.findUnique({ where: { id: r.caseId } });
    assert.equal(c.status, 'logged');
  });

  test('flag mode: never holds, opens a FLAG case', async () => {
    await setPolicies({ bug: { mode: 'flag' } });
    const r = await eng.moderate('bug', { text: `${TAG} ${PHISH}`, authorKey: key() }, { p, canHold: true, canRefuse: true });
    assert.equal(r.decision, 'FLAG');
    assert.equal(r.action, 'allow');
  });

  test('the engine off lets everything through', async () => {
    await cfgMod.saveSetting(p, 'moderation.settings', { enabled: false, retentionDays: 90 });
    const r = await eng.moderate('contact', { text: PHISH, authorKey: key() }, { p, canHold: true });
    assert.equal(r.decision, 'ALLOW');
    assert.equal(r.engine, 'off');
    await cfgMod.saveSetting(p, 'moderation.settings', { enabled: true, retentionDays: 90 });
  });
});

describe('the optional AI layer (db)', { skip }, () => {
  const grey = `${TAG} have a look at https://bit.ly/3xyzabc for the new build`; // a shortener: 20, the grey zone
  let calls = 0;
  const stub = (labels, delay = 0) => ({
    aiEnabledFor: () => true,
    aiAnalyze: async () => { calls++; if (delay) await new Promise((r) => setTimeout(r, delay)); return { provider: 'stub', model: 't', latencyMs: 1, labels }; },
  });

  test('AI missing (null module) = the rules alone', async () => {
    eng._setAiModule(null);
    await setPolicies({ member_message: { mode: 'auto', ai: true, aiBlocking: true } });
    const r = await eng.moderate('member_message', { text: grey, authorKey: key() }, { p, canHold: true, canRefuse: true });
    assert.equal(r.ai, null);
    assert.equal(r.decision, 'ALLOW');
    assert.equal(r.score, 20);
  });

  test('AI can raise a grey-zone message to REVIEW, never further', async () => {
    calls = 0;
    eng._setAiModule(stub({ spam: 0.99, phishing: 0.99, toxic: 0.99, troll: 0.99 }));
    const r = await eng.moderate('member_message', { text: grey, authorKey: key() }, { p, canHold: true, canRefuse: true });
    assert.equal(calls, 1);
    assert.equal(r.ai.provider, 'stub');
    assert.equal(r.decision, 'REVIEW', 'four labels at 0.99 would score past BLOCK; the AI ceiling is REVIEW');
    assert.equal(r.action, 'allow');
  });

  test('a surface the policy keeps away from AI is never sent to it', async () => {
    calls = 0;
    await setPolicies({ member_message: { mode: 'auto', ai: false, aiBlocking: true } });
    await eng.moderate('member_message', { text: grey, authorKey: key() }, { p });
    assert.equal(calls, 0);
  });

  test('the kill switch stops the AI being asked at all', async () => {
    calls = 0;
    await setPolicies({ member_message: { mode: 'auto', ai: true, aiBlocking: true } });
    await cfgMod.saveSetting(p, 'ai.killed', true);
    const r = await eng.moderate('member_message', { text: grey, authorKey: key() }, { p });
    assert.equal(calls, 0);
    assert.equal(r.ai, null);
    await cfgMod.saveSetting(p, 'ai.killed', false);
  });

  test('a slow AI is abandoned at the timeout and the rules answer', async () => {
    calls = 0;
    eng._setAiModule(stub({ spam: 0.99 }, 3000));
    await setPolicies({ member_message: { mode: 'auto', ai: true, aiBlocking: true, aiTimeoutMs: 200 } });
    const t0 = Date.now();
    const r = await eng.moderate('member_message', { text: grey, authorKey: key() }, { p });
    assert.ok(Date.now() - t0 < 1500, 'the request did not wait for the model');
    assert.equal(r.ai, null);
    assert.equal(r.decision, 'ALLOW');
  });

  test('on a sensitive surface the AI changes nothing about the outcome', async () => {
    eng._setAiModule(stub({ spam: 0.99, phishing: 0.99 }));
    await setPolicies({ report: { ai: true, aiBlocking: true } });
    const r = await eng.moderate('report', { text: grey, authorKey: key() }, { p });
    assert.equal(r.decision, 'REVIEW');
    assert.equal(r.action, 'allow');
    eng._setAiModule(null);
  });

  test('without aiBlocking the answer comes first and the AI opens a case afterwards', async () => {
    eng._setAiModule(stub({ spam: 0.99, phishing: 0.99, toxic: 0.99 }));
    await setPolicies({ community: { mode: 'auto', ai: true, aiBlocking: false } });
    const ak = key();
    const r = await eng.moderate('community', { text: grey, authorKey: ak }, { p, canRefuse: true });
    assert.equal(r.decision, 'ALLOW');
    assert.equal(r.caseId, null);
    const c = await waitFor(() => p.moderationCase.findFirst({ where: { authorKey: ak } }));
    assert.ok(c, 'the late AI answer opened a case');
    assert.equal(c.decision, 'REVIEW');
    assert.equal(c.held, false);
    eng._setAiModule(null);
  });
});

describe('the queue (db)', { skip }, () => {
  test('releasing a held contact message files it in the inbox, dated when it was sent', async () => {
    await setPolicies({ contact: { mode: 'auto' } });
    const email = `release-${seq}${MAIL}`;
    const r = await eng.moderate('contact', { text: `${TAG} ${PHISH}`, authorKey: key() }, { p, canHold: true, holdType: 'contact_held', payload: { name: 'N', email, body: `${TAG} body`, kind: 'other', ip: '' } });
    assert.equal(r.action, 'hold');
    assert.equal(await p.contactMessage.count({ where: { email } }), 0);
    const out = await cases.actOnCase(p, r.caseId, 'release', { uid: admin.id, role: 'SUPERADMIN', perms: [] });
    assert.equal(out.ok, true);
    assert.equal(out.case.status, 'resolved');
    assert.equal(out.case.subjectType, 'contact_message');
    const msg = await p.contactMessage.findUnique({ where: { id: out.case.subjectId } });
    assert.equal(msg.email, email);
    // Acting twice is refused.
    assert.equal((await cases.actOnCase(p, r.caseId, 'dismiss', { uid: admin.id, role: 'SUPERADMIN', perms: [] })).status, 409);
    // …and the action is in the audit chain.
    assert.ok(await p.auditLogEntry.findFirst({ where: { actorId: admin.id, action: 'moderation.release' } }));
  });

  test('a false positive teaches the rules: the same text stops scoring', async () => {
    await setPolicies({ contact: { mode: 'auto' } });
    const text = `${TAG} my totally fine message with https://bit.ly/abc123 and https://1.2.3.4/login for the log`;
    const first = await eng.moderate('contact', { text, authorKey: key() }, { p, canHold: true, holdType: 'contact_held', payload: { name: 'N', email: `fp${MAIL}`, body: 'b', kind: 'other' } });
    assert.ok(first.score > 0);
    assert.ok(first.caseId);
    const out = await cases.actOnCase(p, first.caseId, 'false_positive', { uid: admin.id, role: 'SUPERADMIN', perms: [] }, { allowDomains: ['bit.ly'] });
    assert.equal(out.ok, true);
    const again = await eng.moderate('contact', { text, authorKey: key() }, { p, canHold: true });
    assert.equal(again.score, 0);
    assert.equal(again.decision, 'ALLOW');
    assert.ok(again.reasons.some((x) => x.rule === 'fp.known'));
    const rules = (await p.adminSetting.findUnique({ where: { key: 'moderation.rules' } })).value;
    assert.ok(rules.allowDomains.includes('bit.ly'));
  });

  test('sanctioning an author needs manage_users as well as the queue', async () => {
    await setPolicies({ member_message: { mode: 'flag' } });
    const r = await eng.moderate('member_message', { text: `${TAG} ${PHISH}`, authorId: member.id }, { p });
    const denied = await cases.actOnCase(p, r.caseId, 'sanction', { uid: 'x', role: 'USER', perms: ['manage_moderation'] }, { reason: 'phishing' });
    assert.equal(denied.status, 403);
  });

  test('retention purges the text of closed cases and keeps the decision', async () => {
    const old = new Date(Date.now() - 400 * 864e5);
    const c = await p.moderationCase.create({ data: { surface: 'contact', decision: 'FLAG', status: 'resolved', resolution: 'approved', resolvedAt: old, excerpt: `${TAG} old text`, authorKey: key(), reasons: [{ rule: 'x', weight: 1 }] } });
    const open = await p.moderationCase.create({ data: { surface: 'contact', decision: 'FLAG', status: 'open', excerpt: `${TAG} still open`, authorKey: key(), createdAt: old } });
    await cases.purgeCaseText(p);
    const after = await p.moderationCase.findUnique({ where: { id: c.id } });
    assert.equal(after.excerpt, null);
    assert.ok(after.purgedAt);
    assert.equal(after.decision, 'FLAG');
    assert.equal((await p.moderationCase.findUnique({ where: { id: open.id } })).excerpt, `${TAG} still open`, 'an open case keeps its text');
    await p.moderationCase.deleteMany({ where: { id: { in: [c.id, open.id] } } });
  });
});

describe('routes (db)', { skip }, () => {
  test('POST /contact: a held message never reaches the inbox, the sender sees 201 either way', async () => {
    eng._setAiModule(null);
    await setPolicies({ contact: { mode: 'auto' } });
    const m = as(memberCookie);
    const email = `route-held${MAIL}`;
    let r = await m.post('/contact', { name: 'Member', email, body: `${TAG} ${PHISH}`, pow: await pow() });
    assert.equal(r.statusCode, 201, r.body);
    assert.equal(await p.contactMessage.count({ where: { email } }), 0, 'held, not filed');
    const held = await p.moderationCase.findFirst({ where: { authorId: member.id, subjectType: 'contact_held', status: 'open' }, orderBy: { createdAt: 'desc' } });
    assert.ok(held);
    // A clean message files as before, with no case.
    const clean = `route-clean${MAIL}`;
    r = await m.post('/contact', { name: 'Member', email: clean, body: 'The download button on the catalog page stays grey.', pow: await pow() });
    assert.equal(r.statusCode, 201, r.body);
    assert.equal(await p.contactMessage.count({ where: { email: clean } }), 1);
    // The moderator releases the held one from the queue.
    const a = as(adminCookie);
    const list = (await a.get('/admin/moderation/cases?held=true')).json();
    assert.ok(list.cases.some((c) => c.id === held.id));
    assert.ok(list.cases.find((c) => c.id === held.id).actions.includes('release'));
    assert.equal(list.cases.find((c) => c.id === held.id).payload, undefined, 'the held payload (an e-mail address) is never sent to the browser');
    r = await a.post(`/admin/moderation/cases/${held.id}/action`, { action: 'release' });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(await p.contactMessage.count({ where: { email } }), 1, 'released into the inbox');
  });

  test('POST /reports: always filed; a phishing report gets a REVIEW case beside it, with no text', async () => {
    await setPolicies({ report: { mode: 'auto' } });
    const m = as(memberCookie);
    const r = await m.post('/reports', { targetType: 'general', body: `${TAG} ${PHISH}`, pow: await pow() });
    assert.equal(r.statusCode, 201, r.body);
    const reportId = r.json().report.id;
    const c = await waitFor(() => p.moderationCase.findFirst({ where: { subjectType: 'report', subjectId: reportId } }));
    // POST /reports tells EVERY staff account in the database, including the fixtures of test
    // files running beside this one, whose cleanup then trips on the foreign key. Take our
    // report's notices back at once rather than at the end.
    await p.notification.deleteMany({ where: { href: `/admin?s=reports&r=${reportId}` } });
    assert.ok(c, 'a case points at the report');
    assert.equal(c.decision, 'REVIEW');
    assert.equal(c.excerpt, null);
    assert.equal(c.held, false);
    const d = (await as(adminCookie).get(`/admin/moderation/cases/${c.id}`)).json().case;
    assert.equal(d.source.href, `/admin?s=reports&r=${reportId}`);
    assert.ok(!d.actions.includes('remove'), 'nothing in the queue can remove a report');
  });

  test('the admin surface: test box, policies, rules compile check, stats, guards', async () => {
    const a = as(adminCookie);
    let r = await a.post('/admin/moderation/test', { surface: 'phishing', text: 'https://steamcommunlty.com/tradeoffer/new?partner=1' });
    assert.equal(r.statusCode, 200, r.body);
    assert.ok(r.json().result.reasons.some((x) => x.rule === 'link.lookalike'));
    r = await a.put('/admin/moderation/policies', { policies: { report: { mode: 'auto' }, contact: { mode: 'review', thresholds: { flag: 40 } } } });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().policies.report.mode, 'review', 'report cannot be saved as auto');
    assert.equal(r.json().policies.contact.thresholds.flag, 40);
    r = await a.put('/admin/moderation/rules', { rules: { patterns: [{ pattern: '(a+)+$' }] } });
    assert.equal(r.statusCode, 400);
    assert.equal(r.json().errors[0].error, 'nested_quantifier');
    r = await a.put('/admin/moderation/rules', { rules: { keywords: [{ term: `${TAG}forbidden`, weight: 35 }], patterns: [{ pattern: 'fr[e3]{2}\\s*nitro', label: 'free nitro', weight: 40 }] } });
    assert.equal(r.statusCode, 200, r.body);
    r = await a.post('/admin/moderation/test', { surface: 'contact', text: `say ${TAG}forbidden and FR33 nitro` });
    const fired = r.json().result.reasons.map((x) => x.rule);
    assert.ok(fired.includes('text.keyword') && fired.includes('text.pattern'), fired.join());
    r = await a.get('/admin/moderation/stats?days=7');
    assert.equal(r.statusCode, 200);
    assert.ok(typeof r.json().open === 'number');
    r = await a.get('/admin/moderation/ai');
    assert.equal(r.statusCode, 200);
    assert.equal(typeof r.json().killSwitch.killed, 'boolean');
    // Guards: a member is refused, nobody signed in is refused.
    assert.equal((await as(memberCookie).get('/admin/moderation/cases')).statusCode, 403);
    assert.equal((await app.inject({ method: 'GET', url: '/admin/moderation/cases' })).statusCode, 401);
  });
});

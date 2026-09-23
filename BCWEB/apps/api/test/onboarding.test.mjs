// The first-run flow's rules: shown once, resumable, never to an account that predates it.
// Pure functions from lib/onboarding.mjs, plus the create-only marker against a fake store —
// the "never twice" promise rests on that one call refusing to overwrite.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CONFIG, STEP_IDS, normalizeConfig, initialProgress, resolveSteps, currentStep, shouldShow,
  applyAction, markNewAccount, progressKey, ONBOARDING_CONFIG_SCHEMA,
} from '../src/lib/onboarding.mjs';

// Set before anything imports lib.mjs, which reads it once at load.
process.env.JWT_SECRET ||= 'onboarding-test-secret';
const RUN = !!process.env.DATABASE_URL;

const CTX = { emailEnabled: true, emailVerified: false, totpEnabled: false, oauthAvailable: true };
const steps = (ctx = CTX, cfg = DEFAULT_CONFIG) => resolveSteps(cfg, ctx);

/** Walk the flow to the end by pressing `action` on every current step. */
function walk(progress, st, action = 'done') {
  let p = progress; let out;
  for (let i = 0; i < 20; i++) {
    const cur = currentStep(p, st);
    if (!cur) break;
    out = applyAction(p, { action, step: cur }, st, DEFAULT_CONFIG);
    assert.ok(!out.error, `${cur}: ${out.error}`);
    p = out.progress;
    if (out.finished) break;
  }
  return p;
}

describe('who sees it', () => {
  test('a new account sees it, starting at the first step', () => {
    const p = initialProgress();
    assert.equal(shouldShow(p, DEFAULT_CONFIG, steps()), true);
    assert.equal(currentStep(p, steps()), STEP_IDS[0]);
  });

  test('an account that predates the flow (no row) never sees it', () => {
    assert.equal(shouldShow(null, DEFAULT_CONFIG, steps()), false);
    assert.equal(shouldShow(undefined, DEFAULT_CONFIG, steps()), false);
    assert.equal(currentStep(null, steps()), null);
  });

  test('switched off by the admin: nobody sees it, and nobody loses their place', () => {
    const p = initialProgress();
    assert.equal(shouldShow(p, { ...DEFAULT_CONFIG, enabled: false }, steps()), false);
    assert.equal(shouldShow(p, DEFAULT_CONFIG, steps()), true);
  });
});

describe('shown once', () => {
  test('finishing leaves a tombstone that never shows again', () => {
    const end = walk(initialProgress(), steps());
    assert.equal(end.state, 'done');
    assert.equal(end.how, 'completed');
    assert.equal(shouldShow(end, DEFAULT_CONFIG, steps()), false);
    // The tombstone keeps nothing else: no step lists, no interests.
    assert.deepEqual(Object.keys(end).sort(), ['finishedAt', 'how', 'state', 'v']);
  });

  test('skipping every step is still finishing', () => {
    const end = walk(initialProgress(), steps(), 'skip');
    assert.equal(end.state, 'done');
    assert.equal(end.how, 'skipped');
  });

  test('dismiss ends it at once', () => {
    const out = applyAction(initialProgress(), { action: 'dismiss' }, steps(), DEFAULT_CONFIG);
    assert.equal(out.finished, true);
    assert.equal(out.progress.how, 'dismissed');
    assert.equal(shouldShow(out.progress, DEFAULT_CONFIG, steps()), false);
  });

  test('nothing moves a finished flow', () => {
    const end = walk(initialProgress(), steps());
    assert.equal(applyAction(end, { action: 'resume' }, steps(), DEFAULT_CONFIG).error, 'not_onboarding');
  });

  test('the marker is create-only: a second sign-in cannot re-arm it', async () => {
    const store = new Map();
    const fake = { adminSetting: { create: async ({ data }) => {
      if (store.has(data.key)) { const e = new Error('Unique constraint'); e.code = 'P2002'; throw e; }
      store.set(data.key, data.value);
    } } };
    assert.equal(await markNewAccount(fake, 'u1'), true);
    // The account finishes the flow…
    store.set(progressKey('u1'), walk(store.get(progressKey('u1')), steps()));
    // …and a second OAuth sign-in (or anything else) calls this again.
    assert.equal(await markNewAccount(fake, 'u1'), false);
    assert.equal(store.get(progressKey('u1')).state, 'done');
  });
});

describe('resumable', () => {
  test('progress survives: a reload lands on the next unfinished step', () => {
    const st = steps();
    let p = initialProgress();
    p = applyAction(p, { action: 'done', step: st[0].id }, st, DEFAULT_CONFIG).progress;
    p = applyAction(p, { action: 'skip', step: st[1].id }, st, DEFAULT_CONFIG).progress;
    // A round-trip through JSON is what the database does to it.
    const reloaded = JSON.parse(JSON.stringify(p));
    assert.equal(currentStep(reloaded, st), st[2].id);
  });

  test('snooze keeps the place and resume clears it', () => {
    const st = steps();
    let p = applyAction(initialProgress(), { action: 'done', step: st[0].id }, st, DEFAULT_CONFIG).progress;
    p = applyAction(p, { action: 'snooze' }, st, DEFAULT_CONFIG).progress;
    assert.ok(p.snoozedAt);
    assert.equal(shouldShow(p, DEFAULT_CONFIG, st), true);
    assert.equal(currentStep(p, st), st[1].id);
    p = applyAction(p, { action: 'resume' }, st, DEFAULT_CONFIG).progress;
    assert.equal(p.snoozedAt, undefined);
  });

  test('a stale tab cannot tick off a step it is not on', () => {
    const st = steps();
    const out = applyAction(initialProgress(), { action: 'done', step: st[2].id }, st, DEFAULT_CONFIG);
    assert.equal(out.error, 'not_current_step');
    assert.equal(out.current, st[0].id);
  });
});

describe('which steps apply', () => {
  test('an OAuth sign-up (address already proven) never lands on "confirm your e-mail"', () => {
    const st = steps({ ...CTX, emailVerified: true });
    assert.notEqual(currentStep(initialProgress(), st), 'verify');
    assert.ok(st.find((s) => s.id === 'verify').auto);
  });

  test('no e-mail backend: there is nothing to confirm', () => {
    assert.ok(!steps({ ...CTX, emailEnabled: false }).some((s) => s.id === 'verify'));
  });

  test('no OAuth provider configured: no linking step', () => {
    assert.ok(!steps({ ...CTX, oauthAvailable: false }).some((s) => s.id === 'connections'));
  });

  test('2FA already on: the security step is done by itself', () => {
    const st = steps({ ...CTX, totpEnabled: true });
    assert.ok(st.find((s) => s.id === 'security').auto);
  });

  test('confirming mid-flow completes the verify step without a click', () => {
    const p = initialProgress();
    assert.equal(currentStep(p, steps()), 'verify');
    assert.notEqual(currentStep(p, steps({ ...CTX, emailVerified: true })), 'verify');
  });

  test('the admin order and switches are what the account walks', () => {
    const cfg = { ...DEFAULT_CONFIG, steps: [
      { id: 'next', enabled: true }, { id: 'profile', enabled: true }, { id: 'privacy', enabled: false },
    ] };
    const st = resolveSteps(cfg, CTX);
    // The two listed-and-on come first in the given order; the rest are appended OFF.
    assert.deepEqual(st.map((s) => s.id), ['next', 'profile']);
  });

  test('interests keep only what the admin offers', () => {
    const cfg = normalizeConfig(DEFAULT_CONFIG);
    const st = [{ id: 'interests', enabled: true, auto: false }, { id: 'next', enabled: true, auto: false }];
    const out = applyAction(initialProgress(), { action: 'done', step: 'interests', interests: ['mods', 'nope', 'hosting'] }, st, cfg);
    assert.deepEqual(out.progress.interests, ['mods', 'hosting']);
  });
});

describe('the admin config', () => {
  test('the default validates against the schema the PUT uses', () => {
    assert.equal(ONBOARDING_CONFIG_SCHEMA.safeParse(DEFAULT_CONFIG).success, true);
  });

  test('a javascript: link is refused', () => {
    const bad = { ...DEFAULT_CONFIG, links: [{ id: 'x', label: { en: 'x' }, to: 'javascript:alert(1)' }] };
    assert.equal(ONBOARDING_CONFIG_SCHEMA.safeParse(bad).success, false);
  });

  test('a step listed twice is refused', () => {
    const bad = { ...DEFAULT_CONFIG, steps: [{ id: 'profile', enabled: true }, { id: 'profile', enabled: false }] };
    assert.equal(ONBOARDING_CONFIG_SCHEMA.safeParse(bad).success, false);
  });

  test('garbage in storage falls back to the default rather than breaking sign-up', () => {
    assert.deepEqual(normalizeConfig({ nonsense: true }).steps.map((s) => s.id), STEP_IDS);
  });
});

// ── Through the routes, against the database ──────────────────────────────────────
// Skipped without DATABASE_URL (CI has one). Every row it makes is removed in after(), and the
// onboarding config the dev database had is put back.
describe('the routes', { skip: !RUN && 'no DATABASE_URL' }, () => {
  const MAIL = '@onboarding.test';
  let p, app, jwt, savedConfig;
  const made = [];
  const mk = async (role = 'USER', over = {}) => {
    const u = await p.user.create({ data: { email: `u${Date.now()}-${made.length}${MAIL}`, displayName: 'onboarding-test', role, emailVerified: true, ...over } });
    made.push(u.id);
    const s = await p.session.create({ data: { userId: u.id } });
    return { id: u.id, cookie: `bcw_session=${jwt.sign({ uid: u.id, role: u.role, sid: s.id }, process.env.JWT_SECRET, { expiresIn: '1h' })}` };
  };
  const call = (who, method, url, payload) => app.inject({ method, url, payload, headers: { cookie: who.cookie } });

  before(async () => {
    p = await (await import('../src/lib/lib.mjs')).db();
    jwt = (await import('jsonwebtoken')).default;
    savedConfig = await p.adminSetting.findUnique({ where: { key: 'onboarding.config' } });
    await p.adminSetting.deleteMany({ where: { key: 'onboarding.config' } });
    const Fastify = (await import('fastify')).default;
    app = Fastify();
    await app.register((await import('@fastify/cookie')).default);
    await app.register((await import('../src/routes/onboarding.mjs')).default);
    await app.ready();
  });
  after(async () => {
    if (!p) return;
    await p.adminSetting.deleteMany({ where: { key: { in: made.map((id) => progressKey(id)) } } });
    await p.adminSetting.deleteMany({ where: { key: 'onboarding.config' } });
    if (savedConfig) await p.adminSetting.create({ data: { key: savedConfig.key, value: savedConfig.value } });
    await p.session.deleteMany({ where: { userId: { in: made } } });
    await p.user.deleteMany({ where: { id: { in: made } } }).catch(() => {});
    await app?.close();
  });

  test('a new account is walked through, resumes where it left, and never sees it again', async () => {
    const u = await mk();
    await markNewAccount(p, u.id);
    let v = (await call(u, 'GET', '/me/onboarding')).json();
    assert.equal(v.show, true);
    const first = v.current;
    v = (await call(u, 'POST', '/me/onboarding', { action: 'done', step: first })).json();
    assert.notEqual(v.current, first);
    // Another device: same place.
    const again = (await call(u, 'GET', '/me/onboarding')).json();
    assert.equal(again.current, v.current);
    // Snoozed: still there, marked as such.
    assert.equal((await call(u, 'POST', '/me/onboarding', { action: 'snooze' })).json().snoozed, true);
    // A stale "done" for a step it is not on is refused.
    assert.equal((await call(u, 'POST', '/me/onboarding', { action: 'done', step: first })).statusCode, 409);
    // Stop it: gone, for good, and a second marker cannot bring it back.
    assert.equal((await call(u, 'POST', '/me/onboarding', { action: 'dismiss' })).json().show, false);
    assert.equal(await markNewAccount(p, u.id), false);
    assert.equal((await call(u, 'GET', '/me/onboarding')).json().show, false);
    assert.equal((await call(u, 'POST', '/me/onboarding', { action: 'resume' })).statusCode, 409);
  });

  test('an account that existed before (no marker) never sees it and cannot start it', async () => {
    const u = await mk();
    assert.equal((await call(u, 'GET', '/me/onboarding')).json().show, false);
    assert.equal((await call(u, 'POST', '/me/onboarding', { action: 'resume' })).statusCode, 409);
    assert.equal(await p.adminSetting.findUnique({ where: { key: progressKey(u.id) } }), null);
  });

  test('the admin config is checked with the same schema, and switching it off hides the flow', async () => {
    const admin = await mk('ADMIN', { totpEnabled: true });
    const bad = await call(admin, 'PUT', '/admin/onboarding', { config: { enabled: true, steps: [{ id: 'profile', enabled: true }], links: [{ id: 'x', label: { en: 'x' }, to: 'javascript:alert(1)' }] } });
    assert.equal(bad.statusCode, 400);
    // A successful save writes an audit entry, and audit entries are a hash chain this test
    // must not leave behind or delete (see helpers/fixtures.mjs). So the refusal goes through
    // the route and the "off" state is written directly, as the route would store it.
    await p.adminSetting.upsert({ where: { key: 'onboarding.config' }, create: { key: 'onboarding.config', value: { enabled: false, steps: [{ id: 'profile', enabled: true }] } }, update: { value: { enabled: false, steps: [{ id: 'profile', enabled: true }] } } });
    const u = await mk();
    await markNewAccount(p, u.id);
    assert.equal((await call(u, 'GET', '/me/onboarding')).json().show, false);
    const plain = await mk();
    assert.equal((await call(plain, 'GET', '/admin/onboarding')).statusCode, 403);
  });
});

// D5: presentation options. Each one is enforced by applyAction, not only by the page hiding a
// button: a request built by hand must meet the same rule.
describe('D5 options: skippable steps, snooze and dismiss switches', () => {
  test('a config without `ui` keeps every behaviour it had', () => {
    const cfg = normalizeConfig({ enabled: true, steps: [{ id: 'profile', enabled: true }] });
    assert.deepEqual(
      { s: cfg.ui.allowSnooze, d: cfg.ui.allowDismiss, p: cfg.ui.showProgress },
      { s: true, d: true, p: true },
    );
    assert.equal(cfg.steps[0].skippable, true);
    assert.equal(cfg.steps[0].icon, '');
  });

  test('a step that cannot be skipped refuses `skip` but accepts `done`', () => {
    const cfg = normalizeConfig({ enabled: true, steps: [{ id: 'profile', enabled: true, skippable: false }, { id: 'next', enabled: true }] });
    const st = resolveSteps(cfg, CTX);
    const p0 = initialProgress();
    assert.equal(applyAction(p0, { action: 'skip', step: 'profile' }, st, cfg).error, 'not_skippable');
    assert.ok(!applyAction(p0, { action: 'done', step: 'profile' }, st, cfg).error);
  });

  test('snooze and dismiss switched off are refused', () => {
    const cfg = normalizeConfig({ enabled: true, steps: [{ id: 'profile', enabled: true }], ui: { allowSnooze: false, allowDismiss: false } });
    const st = resolveSteps(cfg, CTX);
    const p0 = initialProgress();
    assert.equal(applyAction(p0, { action: 'snooze' }, st, cfg).error, 'not_allowed');
    assert.equal(applyAction(p0, { action: 'dismiss' }, st, cfg).error, 'not_allowed');
  });

  test('labels are bounded and an icon name is a bare identifier', () => {
    const long = 'x'.repeat(41);
    assert.equal(ONBOARDING_CONFIG_SCHEMA.safeParse({ enabled: true, steps: [{ id: 'profile', enabled: true }], ui: { finishLabel: { en: long } } }).success, false);
    assert.equal(ONBOARDING_CONFIG_SCHEMA.safeParse({ enabled: true, steps: [{ id: 'profile', enabled: true, icon: '<svg onload=x>' }] }).success, false);
    assert.equal(ONBOARDING_CONFIG_SCHEMA.safeParse({ enabled: true, steps: [{ id: 'profile', enabled: true, icon: 'Rocket' }], ui: { finishLabel: { en: 'Let us go', fr: 'C’est parti' } } }).success, true);
  });
});

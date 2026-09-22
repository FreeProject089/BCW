// Progressive warnings for the "on each message" rules, and the restrictive role actions.
// "The first hit does not count, the Nth does" — per rule, per member, within a window — and
// what counts lands on the shared warn ladder (one api.warn), never a second counter.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAutomod, createState, evaluateMessage, strongest, warnPolicy, automodDmText, ACTIONS } from '../src/features/automod.mjs';
import { makeT, LANGS } from '../src/i18n.mjs';

const T0 = 1_700_000_000_000;
const MIN = 60_000;
let seq = 0;
const msg = (o = {}) => ({
  id: `m${++seq}`, guildId: 'g1', channelId: 'c1', authorId: o.authorId || 'u1', bot: false,
  content: o.content ?? 'hello', createdAt: o.at ?? T0, mentions: { users: 0, roles: 0, everyone: false },
  attachments: [], memberRoles: [], isModerator: false, inviteGuilds: {},
});
// Only the caps rule on, so a shouted message is exactly one hit.
const capsCfg = (rule = {}) => normalizeAutomod({ rules: {
  spam: { enabled: false }, mentions: { enabled: false }, invites: { enabled: false }, zalgo: { enabled: false }, attachments: { enabled: false }, selfbot: { enabled: false },
  caps: { enabled: true, minLetters: 4, ratio: 0.5, ...rule },
} });
const SHOUT = 'STOP SHOUTING';
/** Feed n shouted messages; return, per hit, whether it recorded a warning. */
function run(c, times, { authorId = 'u1', state = createState() } = {}) {
  return times.map((at) => {
    const hits = evaluateMessage(msg({ content: SHOUT, at, authorId }), state, c);
    return !!warnPolicy(hits, state, authorId, at).warn;
  });
}

describe('progressive warnings', () => {
  test('warnEvery 3: the 1st and 2nd hits cost only the action, the 3rd is a warning, the 6th another', () => {
    const c = capsCfg({ action: 'delete', countsAsWarn: true, warnEvery: 3, warnWindowMin: 60 });
    assert.deepEqual(run(c, [0, 1, 2, 3, 4, 5].map((k) => T0 + k * MIN)), [false, false, true, false, false, true]);
  });

  test('action "warn" with warnEvery 2 — the first hit no longer records a warning (the old rule did, every time)', () => {
    const c = capsCfg({ action: 'warn', warnEvery: 2 });
    assert.deepEqual(run(c, [T0, T0 + MIN, T0 + 2 * MIN]), [false, true, false]);
  });

  test('warnEvery 1 (the default) keeps the old behaviour: every "warn" hit is a warning', () => {
    const c = capsCfg({ action: 'warn' });
    assert.deepEqual(run(c, [T0, T0 + MIN, T0 + 2 * MIN]), [true, true, true]);
  });

  test('hits older than the window are forgotten', () => {
    const c = capsCfg({ action: 'delete', countsAsWarn: true, warnEvery: 2, warnWindowMin: 10 });
    assert.deepEqual(run(c, [T0, T0 + 11 * MIN, T0 + 12 * MIN]), [false, false, true]);
  });

  test('per member: two members each need their own N hits', () => {
    const c = capsCfg({ action: 'delete', countsAsWarn: true, warnEvery: 2 });
    const state = createState();
    assert.deepEqual(run(c, [T0], { authorId: 'a', state }), [false]);
    assert.deepEqual(run(c, [T0 + 1], { authorId: 'b', state }), [false]);
    assert.deepEqual(run(c, [T0 + 2], { authorId: 'a', state }), [true]);
  });

  test('a rule that does not count never warns; watch-only never counts either', () => {
    assert.deepEqual(run(capsCfg({ action: 'timeout' }), [T0, T0 + 1, T0 + 2]), [false, false, false]);
    assert.deepEqual(run(capsCfg({ action: 'warn', logOnly: true }), [T0, T0 + 1]), [false, false]);
  });

  test('two rules firing on one message record ONE warning, and each keeps its own count', () => {
    const c = normalizeAutomod({ rules: {
      spam: { enabled: false }, mentions: { enabled: false }, invites: { enabled: false }, zalgo: { enabled: false }, attachments: { enabled: false }, selfbot: { enabled: false },
      caps: { enabled: true, minLetters: 4, ratio: 0.5, action: 'delete', countsAsWarn: true, warnEvery: 1 },
      links: { enabled: true, action: 'delete', countsAsWarn: true, warnEvery: 2 },
    } });
    const state = createState();
    const hits = evaluateMessage(msg({ content: 'LOOK AT THIS NOW HTTPS://X.EXAMPLE', at: T0 }), state, c);
    const p = warnPolicy(hits, state, 'u1', T0);
    assert.deepEqual(hits.map((h) => h.rule).sort(), ['caps', 'links']);
    assert.equal(p.warn.rule, 'caps');
    const byRule = Object.fromEntries(p.strikes.map((x) => [x.rule, [x.hit, x.every]]));
    assert.deepEqual(byRule, { caps: [1, 1], links: [1, 2] });
    // The next such message: links reaches its 2nd hit — still ONE warning for the message.
    const hits2 = evaluateMessage(msg({ content: 'LOOK AT THIS NOW HTTPS://X.EXAMPLE', at: T0 + MIN }), state, c);
    assert.ok(warnPolicy(hits2, state, 'u1', T0 + MIN).warn);
  });
});

describe('restrictive actions', () => {
  test('addRole / removeRole are rule actions; a role id is required and validated', () => {
    assert.ok(ACTIONS.includes('addRole') && ACTIONS.includes('removeRole'));
    const ok = capsCfg({ action: 'addRole', roleId: '123456789012345678', roleMin: 30 }).rules.caps;
    assert.equal(ok.action, 'addRole'); assert.equal(ok.roleId, '123456789012345678'); assert.equal(ok.roleMin, 30);
    const bad = capsCfg({ action: 'addRole', roleId: 'not-a-role' }).rules.caps;
    assert.equal(bad.roleId, '');
    assert.equal(bad.action, 'delete', 'a role action with no role falls back to deleting, not to nothing');
  });
  test('the action carries its role; a timeout still beats a mute role on the same message', () => {
    const [a] = evaluateMessage(msg({ content: SHOUT }), createState(), capsCfg({ action: 'addRole', roleId: '123456789012345678', roleMin: 15 }));
    assert.equal(a.roleId, '123456789012345678'); assert.equal(a.roleMin, 15);
    assert.equal(strongest([{ action: 'addRole' }, { action: 'timeout' }, { action: 'removeRole' }]).action, 'timeout');
    assert.equal(strongest([{ action: 'removeRole' }, { action: 'warn' }]).action, 'removeRole');
  });
  test('warnEvery is clamped to 1..50', () => {
    assert.equal(capsCfg({ warnEvery: 0 }).rules.caps.warnEvery, 1);
    assert.equal(capsCfg({ warnEvery: 500 }).rules.caps.warnEvery, 50);
  });
});

describe('the DM says whether it counted', () => {
  const best = { rule: 'caps', action: 'warn', timeoutMin: null };
  test('a strike that has not counted yet says how far along it is; the one that counts says so', () => {
    const t = makeT('en');
    const strike = automodDmText(t, { server: 'S', reason: 'caps', best, policy: { warn: null, strikes: [{ rule: 'caps', hit: 1, every: 3 }] } });
    assert.match(strike, /Strike 1 of 3/);
    assert.match(strike, /Your message was removed\./);
    assert.doesNotMatch(strike, /warning was added/);
    const warned = automodDmText(t, { server: 'S', reason: 'caps', best, policy: { warn: { rule: 'caps', hit: 3, every: 3 }, strikes: [{ rule: 'caps', hit: 3, every: 3 }] } });
    assert.match(warned, /A warning was added/);
  });
  test('every language has every line, variables filled', () => {
    for (const lang of LANGS) {
      const t = makeT(lang);
      const txt = automodDmText(t, { server: 'S', reason: 'r', best: { rule: 'caps', action: 'addRole', roleMin: 10 }, policy: { warn: null, strikes: [{ rule: 'caps', hit: 2, every: 4 }] } });
      assert.doesNotMatch(txt, /am\.dm\.|\{(min|n|of|server|reason)\}/, lang);
    }
  });
});

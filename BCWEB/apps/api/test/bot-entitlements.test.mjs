// Discord bot plans (M21): the pure rules in lib/bot-entitlements.mjs.
//
//   computation   free tier ∪ every counting subscription that names the guild; a lapsed,
//                 cancelled or other-guild subscription grants nothing; limits take the max
//                 and never pass the hard caps; the platform's own guilds are never gated.
//   write gate    turning a feature ON without it, or going past a limit, is refused with the
//                 feature's name; turning it OFF is always allowed.
//   read filter   what the bot is served is cut to the same rules, whatever was saved.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  BOT_FEATURES, BOT_LIMITS, entitlementsFor, normalizePlanBot, normalizeSetting,
  gateGuildPatch, restrictGuildConfig, applyEntitlementsToConfig, limitPerGuild, subCounts,
} from '../src/lib/bot-entitlements.mjs';

const G = '111111111111111111';
const OTHER = '222222222222222222';
const NOW = new Date('2026-09-23T12:00:00Z');
const FUTURE = new Date('2026-10-23T12:00:00Z');
const PAST = new Date('2026-09-01T12:00:00Z');
// A strict free tier: the plain features stay free, the rest is what plans sell.
const STRICT = { free: { features: ['welcome', 'gating'], limits: { gatingRules: 2, joinToCreateLobbies: 0, rolePanels: 0, blogRoutes: 0, automodWords: 10 } } };
const PRO = { guilds: 2, features: ['joinToCreate', 'rolePanels', 'automod', 'welcomeBanner'], limits: { joinToCreateLobbies: 5, rolePanels: 3, automodWords: 200, gatingRules: 1 } };
const sub = (over = {}) => ({ status: 'active', currentPeriodEnd: FUTURE, botGuildIds: [G], plan: { name: 'Bot Pro', bot: PRO }, ...over });

describe('entitlement computation', () => {
  test('no setting at all = everything, at the hard caps (shipping this gates nothing)', () => {
    const e = entitlementsFor(G, { setting: null, subs: [] }, NOW);
    assert.deepEqual(e.features, BOT_FEATURES);
    assert.deepEqual(e.limits, BOT_LIMITS);
    assert.deepEqual(e.planFeatures, []);
  });

  test('a strict free tier is exactly what a guild without a plan gets', () => {
    const e = entitlementsFor(G, { setting: STRICT, subs: [] }, NOW);
    assert.deepEqual(e.features, ['welcome', 'gating']);
    assert.equal(e.limits.gatingRules, 2);
    assert.equal(e.limits.rolePanels, 0);
  });

  test('a plan adds its features and raises limits to the larger of the two, never lowers', () => {
    const e = entitlementsFor(G, { setting: STRICT, subs: [sub()] }, NOW);
    for (const f of ['welcome', 'gating', 'joinToCreate', 'rolePanels', 'automod', 'welcomeBanner']) assert.ok(e.features.includes(f), f);
    assert.equal(e.limits.rolePanels, 3);
    assert.equal(e.limits.gatingRules, 2, 'the plan says 1, the free tier 2: the larger wins');
    assert.equal(e.limits.automodWords, 200);
    assert.deepEqual(e.planFeatures, ['welcomeBanner', 'joinToCreate', 'rolePanels', 'automod']);
    assert.deepEqual(e.plans, ['Bot Pro']);
  });

  test('a subscription grants nothing to a guild it does not name, or once it stops counting', () => {
    const base = entitlementsFor(G, { setting: STRICT, subs: [] }, NOW);
    for (const s of [
      sub({ botGuildIds: [OTHER] }),
      sub({ status: 'canceled' }),
      sub({ status: 'expired' }),
      sub({ currentPeriodEnd: PAST }),
      sub({ plan: { name: 'Hosting only', bot: null } }),
    ]) assert.deepEqual(entitlementsFor(G, { setting: STRICT, subs: [s] }, NOW), base);
    assert.equal(subCounts(sub({ currentPeriodEnd: null }), NOW), true, 'no end date = counts');
  });

  test('a plan cannot promise more than the config can hold', () => {
    const pb = normalizePlanBot({ guilds: 999, features: ['rolePanels', 'teleport'], limits: { rolePanels: 10_000 } });
    assert.equal(pb.guilds, 25);
    assert.deepEqual(pb.features, ['rolePanels']);
    assert.equal(pb.limits.rolePanels, BOT_LIMITS.rolePanels);
    assert.equal(normalizePlanBot({ features: [], limits: {} }), null, 'grants nothing = not a bot plan');
  });

  test('the platform guilds are never gated', () => {
    const e = entitlementsFor(G, { setting: { ...STRICT, unlimitedGuildIds: [G] }, subs: [] }, NOW);
    assert.equal(e.unlimited, true);
    assert.deepEqual(e.features, BOT_FEATURES);
    assert.deepEqual(normalizeSetting({ unlimitedGuildIds: ['abc', G] }).unlimitedGuildIds, [G], 'junk ids dropped');
  });
});

describe('write gate', () => {
  const free = entitlementsFor(G, { setting: STRICT, subs: [] }, NOW);
  const pro = entitlementsFor(G, { setting: STRICT, subs: [sub()] }, NOW);

  test('turning on a feature the guild does not have is refused with its name', () => {
    assert.deepEqual(gateGuildPatch({ joinToCreate: { enabled: true } }, {}, free), { error: 'plan_required', feature: 'joinToCreate' });
    assert.deepEqual(gateGuildPatch({ moderation: { automod: { enabled: true } } }, {}, free), { error: 'plan_required', feature: 'automod' });
    assert.deepEqual(gateGuildPatch({ rolePanels: [{ channelId: '1' }] }, {}, free), { error: 'plan_required', feature: 'rolePanels' });
    assert.deepEqual(gateGuildPatch({ logs: { forumId: '9' } }, {}, free), { error: 'plan_required', feature: 'logRouting' });
    assert.deepEqual(gateGuildPatch({ blog: { routes: [{ channelId: '5' }] } }, {}, free), { error: 'plan_required', feature: 'blog' });
    assert.deepEqual(gateGuildPatch({ welcome: { bgImage: '/api/media/a.png' } }, {}, free), { error: 'plan_required', feature: 'welcomeBanner' });
  });

  test('a partial patch is judged on the result: enabled already saved still counts', () => {
    assert.deepEqual(gateGuildPatch({ joinToCreate: { lobbies: [] } }, { joinToCreate: { enabled: true } }, free), { error: 'plan_required', feature: 'joinToCreate' });
  });

  test('going past a limit is refused with the limit and its maximum', () => {
    const rules = [{ roleId: '1' }, { roleId: '2' }, { roleId: '3' }];
    assert.deepEqual(gateGuildPatch({ gating: { enabled: true, rules } }, {}, free), { error: 'plan_limit', limit: 'gatingRules', max: 2 });
    const panels = Array.from({ length: 4 }, (_, i) => ({ channelId: String(i + 1) }));
    assert.deepEqual(gateGuildPatch({ rolePanels: panels }, {}, pro), { error: 'plan_limit', limit: 'rolePanels', max: 3 });
  });

  test('with the plan the same writes pass', () => {
    assert.equal(gateGuildPatch({ joinToCreate: { enabled: true, lobbies: [{}, {}] } }, {}, pro), null);
    assert.equal(gateGuildPatch({ rolePanels: [{ channelId: '1' }, { channelId: '2' }] }, {}, pro), null);
    assert.equal(gateGuildPatch({ welcome: { enabled: true, bgImage: '/api/media/a.png' } }, {}, pro), null);
  });

  test('turning something OFF is always allowed, and an unchanged banner is not a new use', () => {
    assert.equal(gateGuildPatch({ joinToCreate: { enabled: false, lobbies: [{}, {}, {}] } }, { joinToCreate: { enabled: true } }, free), null);
    assert.equal(gateGuildPatch({ moderation: { automod: { enabled: false } } }, {}, free), null);
    assert.equal(gateGuildPatch({ rolePanels: [] }, {}, free), null);
    assert.equal(gateGuildPatch({ logs: { forumId: '', routes: {} } }, {}, free), null);
    assert.equal(gateGuildPatch({ welcome: { bgImage: '/api/media/a.png' } }, {}, free, { oldBgImage: '/api/media/a.png' }), null);
  });
});

describe('read filter (what the bot is served)', () => {
  const free = entitlementsFor(G, { setting: STRICT, subs: [] }, NOW);
  const pro = entitlementsFor(G, { setting: STRICT, subs: [sub()] }, NOW);

  test('a feature saved before the plan lapsed is served switched off, lists cut to the limit', () => {
    const cut = restrictGuildConfig({
      joinToCreate: { enabled: true, lobbies: [{}, {}] },
      gating: { enabled: true, rules: [1, 2, 3, 4] },
      moderation: { enabled: true, automod: { enabled: true, rules: { words: { patterns: Array(50).fill('x') } } } },
      logs: { enabled: true, channelId: '7', forumId: '9', routes: { voice: '8' } },
      welcome: { enabled: true, bgImage: '/api/media/a.png' },
    }, free);
    assert.equal(cut.joinToCreate.enabled, false);
    assert.equal(cut.gating.enabled, true, 'gating is free here');
    assert.equal(cut.gating.rules.length, 2);
    assert.equal(cut.moderation.automod.enabled, false);
    assert.equal(cut.moderation.enabled, true, 'the rest of moderation is untouched');
    assert.equal(cut.logs.forumId, '');
    assert.deepEqual(cut.logs.routes, {});
    assert.equal(cut.logs.channelId, '7', 'the plain log channel stays');
    assert.equal(cut.welcome.bgImage, '');
    assert.equal(cut.welcome.enabled, true);
  });

  test('nothing changes for a guild that has what it uses', () => {
    assert.deepEqual(restrictGuildConfig({ joinToCreate: { enabled: true, lobbies: [{}] }, welcome: { enabled: true } }, pro), {});
  });

  test('the whole config: a guild with no override is restricted from the top-level default', () => {
    const cfg = { joinToCreate: { enabled: true, lobbies: [{}] }, welcome: { enabled: true }, guilds: {}, blog: { routes: [{ channelId: '1', guildId: G }, { channelId: '2' }] } };
    const out = applyEntitlementsToConfig(cfg, [G], () => free);
    assert.equal(out.guilds[G].joinToCreate.enabled, false);
    assert.equal(out.joinToCreate.enabled, true, 'the top-level default itself is not touched');
    assert.deepEqual(out.blog.routes, [{ channelId: '2' }], 'this guild\'s blog route goes; the admin\'s own stays');
    assert.equal(cfg.guilds[G], undefined, 'the input is not mutated');
  });

  test('role panels and blog routes: per guild, in saved order, up to the limit', () => {
    const list = [1, 2, 3, 4, 5].map((n) => ({ id: n, guildId: G })).concat([{ id: 9, guildId: OTHER }]);
    const kept = limitPerGuild(list, 'rolePanels', 'rolePanels', (gid) => (gid === G ? pro : free));
    assert.deepEqual(kept.map((x) => x.id), [1, 2, 3]);
  });
});

// agent-bcw-bot: the bot half of plans / credits / the voice panel redesign.
//
//   throttle   the bucket refills over time and refuses with a wait; the work queue runs at
//              most N at once, refuses past its buffer ('busy') and times a waiter out
//   paywall    every refusal the API can send becomes a card with two LINK buttons to the
//              pricing page (feature + server in the URL) and to the feature / credits page
//   voice      the redesigned panel stays under Discord's 40-component cap, pre-selects the
//              room's real state in every dropdown, and offers only the bitrates the server's
//              boost tier allows
//   /ask       the cheap gates refuse before the API; a 402 from the API is the paywall card
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ButtonStyle, ComponentType } from 'discord.js';
import * as ui from '../src/ui.mjs';
import { makeT, BASE, LANGS } from '../src/i18n.mjs';
import { Bucket, Queue } from '../src/throttle.mjs';
import { links, paywallCard, isPaywall, guildPlan, allows, _clearPlanCacheForTests, FEATURE_KEYS } from '../src/paywall.mjs';
import { panelCard, bitrateChoices, QUICK_LIMITS, PRO_ACTIONS } from '../src/features/panel.mjs';

describe('throttle', () => {
  test('a bucket gives its capacity, then refuses with a wait, then refills', () => {
    let now = 0;
    const b = new Bucket({ capacity: 2, perMinute: 2, now: () => now });
    assert.equal(b.take('g').ok, true);
    assert.equal(b.take('g').ok, true);
    const no = b.take('g');
    assert.equal(no.ok, false);
    assert.ok(no.retryMs > 0 && no.retryMs <= 30_000, String(no.retryMs));
    assert.equal(b.take('other').ok, true, 'keys are independent');
    now += 30_000; // one token back at 2 / minute
    assert.equal(b.take('g').ok, true);
    assert.equal(b.take('g').ok, false);
  });

  test('a bucket forgets its oldest key past maxKeys', () => {
    const b = new Bucket({ capacity: 1, perMinute: 1, maxKeys: 2 });
    b.take('a'); b.take('b'); b.take('c');
    assert.equal(b.keys.size, 2);
    assert.equal(b.keys.has('a'), false);
  });

  test('the queue runs N at once, buffers, refuses past the buffer, times out', async () => {
    const q = new Queue({ concurrency: 1, maxQueued: 1, maxWaitMs: 50 });
    let release;
    const first = q.run(() => new Promise((r) => { release = r; }));
    const second = q.run(async () => 'second');
    await assert.rejects(q.run(async () => 'third'), /busy/);
    assert.equal(q.running, 1);
    assert.equal(q.size, 1);
    release('first');
    assert.equal(await first, 'first');
    assert.equal(await second, 'second');
    // A waiter that waits too long is told so instead of hanging.
    const q2 = new Queue({ concurrency: 1, maxQueued: 5, maxWaitMs: 20 });
    const hold = q2.run(() => new Promise((r) => setTimeout(r, 80)));
    await assert.rejects(q2.run(async () => 1), /timeout/);
    await hold;
  });
});

describe('paywall', () => {
  const t = makeT('en');
  test('links carry the feature and the server', () => {
    const L = links({ feature: 'jtcPro', guildId: '123456789012' }, 'https://bc.example/');
    assert.equal(L.pricing, 'https://bc.example/bot/pricing?feature=jtcPro&guild=123456789012');
    assert.equal(L.features, 'https://bc.example/bot/features#jtcPro');
    assert.equal(L.credits, 'https://bc.example/dashboard?s=discord&guild=123456789012&view=billing');
  });

  test('a paid feature → "Unlock with Pro" + what it does, both links', () => {
    const c = ui.card(paywallCard(t, { error: 'plan_required', feature: 'jtcPro' }, '42'));
    const json = JSON.stringify(c.components[0].toJSON());
    assert.match(json, /Voice room pro controls/);
    const btns = c.components[0].toJSON().components.filter((x) => x.type === ComponentType.ActionRow).flatMap((r) => r.components);
    assert.equal(btns.length, 2);
    for (const b of btns) assert.equal(b.style, ButtonStyle.Link);
    assert.match(btns[0].url, /\/bot\/pricing\?feature=jtcPro&guild=42$/);
    assert.equal(btns[0].label, 'Unlock with Pro');
    assert.match(btns[1].url, /\/bot\/features#jtcPro$/);
  });

  test('a spent AI budget → the credits page instead of the feature page', () => {
    const c = ui.card(paywallCard(t, { error: 'ai_quota' }, '42'));
    const btns = c.components[0].toJSON().components.filter((x) => x.type === ComponentType.ActionRow).flatMap((r) => r.components);
    assert.match(btns[1].url, /view=billing/);
    assert.match(JSON.stringify(c.components[0].toJSON()), /AI calls for the month/);
  });

  test('a limit names it, in words', () => {
    const c = ui.card(paywallCard(t, { error: 'plan_limit', limit: 'gatingRules', max: 3 }, '42'));
    assert.match(JSON.stringify(c.components[0].toJSON()), /role rules \(3\)/);
  });

  test('isPaywall knows the refusals, and only them', () => {
    for (const e of ['plan_required', 'plan_limit', 'ai_quota', 'ai_credits', 'ai_cap', 'no_key']) assert.equal(isPaywall({ error: e }), true, e);
    assert.equal(isPaywall({ error: 'not_allowed' }), false);
    assert.equal(isPaywall(null), false);
  });

  test('every feature has a name in every language', () => {
    for (const lang of LANGS) for (const f of FEATURE_KEYS) assert.ok(BASE[lang][`pw.f.${f}`], `${lang}:${f}`);
  });

  test('the plan is cached, and an unknown plan (API down) does not block', async () => {
    _clearPlanCacheForTests();
    let calls = 0;
    const fetcher = async () => { calls += 1; return { tier: 'free', features: ['aiAsk'], limits: {} }; };
    assert.equal(await allows('1', 'jtcPro', { fetcher }), false);
    assert.equal(await allows('1', 'aiAsk', { fetcher }), true);
    assert.equal(calls, 1, 'one fetch for both');
    _clearPlanCacheForTests();
    assert.equal(await allows('2', 'jtcPro', { fetcher: async () => { throw new Error('down'); } }), true);
    assert.equal(await guildPlan('', { fetcher }), null);
  });
});

describe('the voice panel', () => {
  const room = ({ locked = false, priv = false, limit = 0, members = 1, tier = 0, ownerHere = true } = {}) => {
    const channel = {
      name: 'Alex’s room', userLimit: limit, rtcRegion: null, bitrate: 64000,
      members: { size: members, has: (id) => ownerHere && id === 'owner' },
      guild: { premiumTier: tier, members: { cache: new Map() } },
    };
    const state = { ownerId: 'owner', locked, private: priv, bans: new Set(), kicks: new Set() };
    return { channel, state };
  };
  const selects = (card) => card.components[0].toJSON().components
    .filter((x) => x.type === ComponentType.ActionRow)
    .flatMap((r) => r.components)
    .filter((c) => c.type === ComponentType.StringSelect);

  test('fits Discord’s caps and shows the four dropdowns', () => {
    ui.setAutoIcons({}); ui.setIcons({});
    const { channel, state } = room();
    const card = ui.card(panelCard(channel, state));
    assert.ok(ui.countComponents(card) <= ui.MAX_COMPONENTS, String(ui.countComponents(card)));
    assert.deepEqual(selects(card).map((s) => s.custom_id), ['vp:privacy', 'vp:qlimit', 'vp:settings', 'vp:members']);
    for (const s of selects(card)) assert.ok(s.options.length <= 25, s.custom_id);
  });

  test('every dropdown pre-selects the room’s real state', () => {
    const { channel, state } = room({ locked: true, limit: 5 });
    const s = selects(ui.card(panelCard(channel, state)));
    assert.deepEqual(s[0].options.filter((o) => o.default).map((o) => o.value), ['locked']);
    assert.deepEqual(s[1].options.filter((o) => o.default).map((o) => o.value), ['5']);
    const odd = room({ priv: true, limit: 7 });
    const s2 = selects(ui.card(panelCard(odd.channel, odd.state)));
    assert.deepEqual(s2[0].options.filter((o) => o.default).map((o) => o.value), ['private']);
    assert.deepEqual(s2[1].options.filter((o) => o.default).map((o) => o.value), ['7'], 'a custom limit is listed and selected');
    assert.ok(!QUICK_LIMITS.includes(7));
  });

  test('Claim appears only while the owner is away', () => {
    const btnIds = (c) => c.components[0].toJSON().components.filter((x) => x.type === ComponentType.ActionRow).flatMap((r) => r.components).map((b) => b.custom_id);
    const here = room();
    assert.equal(btnIds(ui.card(panelCard(here.channel, here.state))).includes('vp:claim'), false);
    const away = room({ ownerHere: false });
    assert.equal(btnIds(ui.card(panelCard(away.channel, away.state))).includes('vp:claim'), true);
  });

  test('bitrates follow the boost tier', () => {
    assert.deepEqual(bitrateChoices(0), [64000, 96000]);
    assert.deepEqual(bitrateChoices(1), [64000, 96000, 128000]);
    assert.deepEqual(bitrateChoices(3), [64000, 96000, 128000, 256000, 384000]);
    assert.deepEqual(bitrateChoices(9), bitrateChoices(3));
  });

  test('the pro choices are the paid ones and are labelled so', () => {
    assert.deepEqual(PRO_ACTIONS, ['bitrate', 'transfer']);
    const { channel, state } = room();
    const s = selects(ui.card(panelCard(channel, state)));
    const all = [...s[2].options, ...s[3].options];
    for (const v of PRO_ACTIONS) assert.match(all.find((o) => o.value === v).label, /\(Pro\)/);
  });
});

describe('/ask', () => {
  const fakeI = () => {
    const out = {};
    return {
      out, guildId: '777', user: { id: '888' }, locale: 'en', guild: { name: 'G' },
      options: { getString: () => 'What is this server about?' },
      deferReply: async () => { out.deferred = true; },
      editReply: async (m) => { out.edit = m; return m; },
      reply: async (m) => { out.reply = m; return m; },
    };
  };
  test('a 402 from the API becomes the paywall card', async () => {
    const { cmdAsk } = await import('../src/features/plancmd.mjs');
    const i = fakeI();
    await cmdAsk(i, { askApi: async () => ({ ok: false, error: 'ai_quota' }), queue: { run: (fn) => fn() } });
    assert.equal(i.out.deferred, true);
    assert.match(JSON.stringify(i.out.edit.components[0].toJSON()), /view=billing/);
  });
  // Security (born red 2026-10-01): the answer is model output, and the quoted question is a
  // member's text. Neither may ping anybody: text sanitising misses <@&role> and <@user>, so the
  // message itself must allow no mention at all.
  test('the answer pings nobody: allowedMentions parses nothing, on every /ask reply', async () => {
    const { cmdAsk } = await import('../src/features/plancmd.mjs');
    const none = { parse: [] };
    let i = fakeI(); i.guildId = '779';
    i.options = { getString: () => 'hey <@&123456789012345678> @everyone' };
    await cmdAsk(i, { askApi: async () => ({ ok: true, text: 'Sure <@&123456789012345678> <@42> @here' }), queue: { run: (fn) => fn() }, planOf: async () => null });
    assert.deepEqual(i.out.edit.allowedMentions, none, 'the answer');
    i = fakeI(); i.guildId = '780';
    await cmdAsk(i, { askApi: async () => ({ ok: false, error: 'ai_quota' }), queue: { run: (fn) => fn() } });
    assert.deepEqual(i.out.edit.allowedMentions, none, 'the paywall card');
    i = fakeI(); i.guildId = '781';
    await cmdAsk(i, { askApi: async () => ({ ok: false, reason: 'unavailable' }), queue: { run: (fn) => fn() } });
    assert.deepEqual(i.out.edit.allowedMentions, none, 'the failure line');
  });
  test('a busy queue says so, without a paywall', async () => {
    const { cmdAsk } = await import('../src/features/plancmd.mjs');
    const i = fakeI(); i.guildId = '778';
    await cmdAsk(i, { askApi: async () => ({ ok: true, text: 'x' }), queue: { run: () => Promise.reject(new Error('busy')) } });
    assert.match(JSON.stringify(i.out.edit.components[0].toJSON()), /Too many questions/);
  });
});

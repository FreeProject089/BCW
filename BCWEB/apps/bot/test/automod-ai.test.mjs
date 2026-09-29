// laya (agent-laya-bcweb): the AI-assisted automod check (features/automod.mjs, `automod.ai`).
//
// Rules first: the deterministic phishing check decides plain cases on its own, with the
// full action list; only the grey zone is sent to the API, with a deadline, and any failure
// leaves the rules' answer (nothing) standing. An AI verdict costs at most a warning. And the
// dashboard's copy of the shape (web lib/discord-config.js normAiAutomod) must save what the
// bot reads, or the automod page would wipe the setting on every save.
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  phishingSignals, lookalikeBrand, aiChecksFor, aiVerdict, aiFollowUp, normalizeAi, normalizeAutomod,
  evaluateMessage, createState, AI_ACTIONS, _resetAiBackoff,
} from '../src/features/automod.mjs';
import { normAiAutomod, normAutomod, AI_ACTIONS as WEB_AI_ACTIONS } from '../../web/src/lib/discord-config.js';

const G = '111111111111111111';
const msg = (content, over = {}) => ({ id: 'm1', guildId: G, channelId: 'c1', authorId: 'u1', bot: false, content, createdAt: Date.now(), mentions: {}, attachments: [], memberRoles: [], isModerator: false, ...over });
const cfgWith = (ai) => normalizeAutomod({ rules: { spam: { enabled: false }, invites: { enabled: false }, selfbot: { enabled: false }, zalgo: { enabled: false } }, ai });

describe('look-alike hosts', () => {
  test('spelling tricks and brand-plus-lure names are strong; the real domains are never flagged', () => {
    for (const h of ['dlscord.com', 'disocrd.gg', 'd1scord-app.com', 'st3am.xyz', 'steamcommunlty.com', 'discord-nitro.gift', 'steamgift.ru', 'paypa1.com', 'discorcl.com']) {
      const r = lookalikeBrand(h);
      assert.ok(r && r.strong, `${h} should be a strong look-alike, got ${JSON.stringify(r)}`);
    }
    for (const h of ['discord.com', 'cdn.discordapp.com', 'discord.gg', 'store.steampowered.com', 'steamcommunity.com', 'github.com', 'raw.githubusercontent.com', 'paypal.com']) {
      assert.equal(lookalikeBrand(h), null, h);
    }
  });

  test('fan sites that merely contain a brand are weak, and near-words are not brands', () => {
    for (const h of ['steamdb.info', 'discordbotlist.com']) assert.equal(lookalikeBrand(h)?.strong, false, h);
    for (const h of ['streamable.com', 'stream.twitch.tv', 'example.com', 'youtube.com']) assert.equal(lookalikeBrand(h), null, h);
  });
});

describe('phishingSignals (deterministic)', () => {
  test('plain phishing scores ≥ 0.7; ordinary links do not', () => {
    for (const t of [
      'free nitro here https://dlscord.gift/claim',
      'https://discord-nitro.gift/abc',
      'login https://user@steamcommunity.com.evil.ru/x',
      'check https://xn--dscord-wva.com/',
      'steam gift for you https://bit.ly/abc https://st3am.xyz',
    ]) assert.ok(phishingSignals(t).score >= 0.7, `${t} → ${JSON.stringify(phishingSignals(t))}`);
    for (const t of [
      'see https://github.com/foo/bar',
      'my clip https://streamable.com/xyz',
      'stats on https://steamdb.info/app/1',
      'no link at all, just free nitro talk',
      'join us at https://discord.gg/abc',
    ]) assert.ok(phishingSignals(t).score < 0.7, `${t} → ${JSON.stringify(phishingSignals(t))}`);
  });
});

describe('the rules half runs inside evaluateMessage', () => {
  test('plain phishing fires rule "ai" with rulesAction; off when the check is off', () => {
    const on = cfgWith({ enabled: true, phishing: true, rulesAction: 'timeout', timeoutMin: 15 });
    const out = evaluateMessage(msg('free nitro https://dlscord.gift/x'), createState(), on);
    const hit = out.find((a) => a.rule === 'ai');
    assert.ok(hit, JSON.stringify(out));
    assert.equal(hit.action, 'timeout');
    assert.equal(hit.timeoutMin, 15);
    assert.equal(hit.meta.kind, 'rules');
    const off = cfgWith({ enabled: false, phishing: true });
    assert.equal(evaluateMessage(msg('free nitro https://dlscord.gift/x'), createState(), off).filter((a) => a.rule === 'ai').length, 0);
    const watch = cfgWith({ enabled: true, phishing: true, rulesAction: 'ban', logOnly: true });
    assert.equal(evaluateMessage(msg('https://dlscord.gift/x'), createState(), watch).find((a) => a.rule === 'ai').action, 'log');
  });
});

describe('grey zone → API', () => {
  beforeEach(() => _resetAiBackoff());

  test('prefilter: phishing needs a link, troll needs some length', () => {
    const ai = normalizeAi({ enabled: true, phishing: true, troll: true, minChars: 10 });
    assert.deepEqual(aiChecksFor(msg('hi'), ai), []);
    assert.deepEqual(aiChecksFor(msg('look https://example.com'), ai), ['phishing', 'troll']);
    assert.deepEqual(aiChecksFor(msg('you are all so bad at this'), ai), ['troll']);
    assert.deepEqual(aiChecksFor(msg('https://x.y'), normalizeAi({ enabled: false })), []);
  });

  test('an AI verdict costs at most its capped action, never a timeout / kick / ban', () => {
    assert.deepEqual(AI_ACTIONS, ['log', 'delete', 'warn']);
    const ai = normalizeAi({ enabled: true, action: 'ban', phishingThreshold: 0.8 });
    assert.equal(ai.action, 'log', 'ban is not an AI action: back to the default');
    const w = normalizeAi({ enabled: true, action: 'warn', phishingThreshold: 0.8 });
    const [a] = aiVerdict({ phishing: 0.85 }, w, ['phishing']);
    assert.equal(a.action, 'warn');
    assert.equal(a.rule, 'ai');
    assert.deepEqual(aiVerdict({ phishing: 0.5 }, w, ['phishing']), [], 'under the threshold');
    assert.equal(aiVerdict({ toxic: 0.99 }, normalizeAi({ enabled: true, troll: true, trollThreshold: 0.9 }), ['troll'])[0].meta.label, 'toxic');
  });

  test('aiFollowUp: the API\'s labels become the verdict', async () => {
    const cfg = cfgWith({ enabled: true, phishing: true, action: 'delete', phishingThreshold: 0.8 });
    let sent = null;
    const out = await aiFollowUp(msg('hey look https://weird.example/login'), cfg, async (body) => { sent = body; return { ok: true, labels: { phishing: 0.9, spam: 0.2 } }; });
    assert.equal(sent.guildId, G);
    assert.deepEqual(sent.checks, ['phishing']);
    assert.equal(out.length, 1);
    assert.equal(out[0].action, 'delete');
  });

  test('never waits past the failure: timeout, throw, junk, 402 → nothing, and a 402 backs off', async () => {
    const cfg = cfgWith({ enabled: true, phishing: true });
    const m = msg('https://weird.example/x');
    assert.deepEqual(await aiFollowUp(m, cfg, async () => { throw new Error('network'); }), []);
    assert.deepEqual(await aiFollowUp(m, cfg, async () => ({ ok: false, reason: 'unavailable' })), []);
    assert.deepEqual(await aiFollowUp(m, cfg, async () => 'junk'), []);
    let calls = 0;
    const plan = async () => { calls++; return { ok: false, error: 'plan_required' }; };
    assert.deepEqual(await aiFollowUp(m, cfg, plan), []);
    assert.deepEqual(await aiFollowUp(m, cfg, plan), []);
    assert.equal(calls, 1, 'a server without the plan is not asked again for ten minutes');
  });

  test('exemptions hold: a moderator, an exempt channel', async () => {
    const cfg = normalizeAutomod({ ai: { enabled: true, phishing: true, exempt: { channels: ['c9'] } } });
    let calls = 0;
    const api = async () => { calls++; return { ok: true, labels: { phishing: 1 } }; };
    assert.deepEqual(await aiFollowUp(msg('https://x.example', { isModerator: true }), cfg, api), []);
    assert.deepEqual(await aiFollowUp(msg('https://x.example', { channelId: 'c9' }), cfg, api), []);
    assert.equal(calls, 0);
  });
});

describe('dashboard shape = bot shape (automod.ai)', () => {
  test('same actions, same defaults, and a saved value reads back unchanged', () => {
    assert.deepEqual(WEB_AI_ACTIONS, AI_ACTIONS);
    const web = normAiAutomod(null);
    const bot = normalizeAi(null);
    for (const k of Object.keys(bot)) assert.deepEqual(web[k], bot[k], k);
    const sent = normAutomod({ ai: { enabled: true, action: 'warn', troll: true, phishingThreshold: 0.85, trollThreshold: 0.95, minChars: 20, rulesAction: 'kick', dm: true } }).ai;
    const read = normalizeAutomod(JSON.parse(JSON.stringify({ ai: sent }))).ai;
    for (const k of ['enabled', 'action', 'troll', 'phishing', 'phishingThreshold', 'trollThreshold', 'minChars', 'rulesAction', 'dm', 'logOnly']) assert.deepEqual(read[k], sent[k], k);
  });
});

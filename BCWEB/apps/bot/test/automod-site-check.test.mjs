// The bot's second opinion from the site (POST /bot/moderation/check) and the one brand list.
//
// siteCheckFollowUp is fail-open: a deadline, any failure is "nothing", a failing site is left
// alone for a minute, and only a BLOCK acts (with the deterministic action, rulesAction).
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { siteCheckFollowUp, _resetSiteBackoff, normalizeAutomod, lookalikeBrand } from '../src/features/automod.mjs';
import { BRANDS } from '../src/features/brands.generated.mjs';

const G = '111111111111111111';
const U = '222222222222222222';
const msg = (content, over = {}) => ({ id: '333333333333333333', guildId: G, channelId: '444444444444444444', authorId: U, bot: false, content, createdAt: Date.now(), mentions: {}, attachments: [], memberRoles: [], isModerator: false, ...over });
const cfgWith = (ai) => normalizeAutomod({ rules: { spam: { enabled: false } }, ai });
const ON = cfgWith({ enabled: true, phishing: true, rulesAction: 'delete' });

describe('siteCheckFollowUp', () => {
  beforeEach(() => _resetSiteBackoff());

  test('a BLOCK from the site acts with rulesAction; the call carries the links and the ids', async () => {
    let seen = null;
    const out = await siteCheckFollowUp(msg('look https://evil.example/login'), ON, async (body, ms) => {
      seen = { body, ms };
      return { ok: true, decision: 'BLOCK', action: 'refuse', score: 80, caseId: 'c1', reasons: [{ rule: 'links.blocklist', weight: 80, detail: 'evil.example is blocked' }] };
    });
    assert.equal(seen.ms, 1500);
    assert.deepEqual(seen.body.links, ['https://evil.example/login']);
    assert.equal(seen.body.discordId, U);
    assert.equal(seen.body.guildId, G);
    assert.equal(out.length, 1);
    assert.equal(out[0].action, 'delete');
    assert.match(out[0].reason, /evil\.example is blocked/);
    assert.equal(out[0].meta.kind, 'site');
  });

  test('anything milder than BLOCK does nothing here', async () => {
    for (const decision of ['ALLOW', 'FLAG', 'REVIEW', 'QUARANTINE']) {
      const out = await siteCheckFollowUp(msg('https://a.example'), ON, async () => ({ ok: true, decision }));
      assert.deepEqual(out, [], decision);
    }
  });

  test('no call without a link, with the check off, or for an exempt moderator', async () => {
    let calls = 0;
    const api = async () => { calls += 1; return { ok: true, decision: 'BLOCK' }; };
    await siteCheckFollowUp(msg('no link here'), ON, api);
    await siteCheckFollowUp(msg('https://a.example'), cfgWith({ enabled: false, phishing: true }), api);
    await siteCheckFollowUp(msg('https://a.example'), cfgWith({ enabled: true, phishing: false }), api);
    await siteCheckFollowUp(msg('https://a.example', { bot: true }), ON, api);
    await siteCheckFollowUp(msg('https://a.example', { isModerator: true }), ON, api);
    assert.equal(calls, 0);
  });

  test('fail-open: a throw, a timeout answer or a 5xx is nothing, and backs off for a minute', async () => {
    const now = 1_000_000;
    assert.deepEqual(await siteCheckFollowUp(msg('https://a.example'), ON, async () => { throw new Error('boom'); }, { now }), []);
    _resetSiteBackoff();
    assert.deepEqual(await siteCheckFollowUp(msg('https://a.example'), ON, async () => ({ ok: false, reason: 'unavailable' }), { now }), []);
    let calls = 0;
    await siteCheckFollowUp(msg('https://a.example'), ON, async () => { calls += 1; return { ok: true, decision: 'BLOCK' }; }, { now: now + 30_000 });
    assert.equal(calls, 0, 'still backing off');
    const out = await siteCheckFollowUp(msg('https://a.example'), ON, async () => { calls += 1; return { ok: true, decision: 'BLOCK' }; }, { now: now + 61_000 });
    assert.equal(calls, 1);
    assert.equal(out.length, 1);
  });
});

describe('one brand list', () => {
  test('the generated copy is what the look-alike check reads', () => {
    assert.ok(BRANDS.discord.includes('dis.gd'));
    assert.ok(BRANDS.roblox.includes('roblox.com'));
    assert.ok(BRANDS.bettercommunity.includes('bettercommunity.ch'));
    // Brands the bot did not know before the lists were merged are now recognised.
    assert.equal(lookalikeBrand('bettercommunity.ch'), null);
    assert.ok(lookalikeBrand('bettercommunlty.com')?.strong);
    assert.equal(lookalikeBrand('www.youtube.com'), null);
  });
});

// Season announcements: the card text and the general-channel fallback — no Discord.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { seasonCard, generalChannelFor } from '../src/features/season.mjs';
import { makeT, LANGS } from '../src/i18n.mjs';

describe('season card', () => {
  test('names the season that ended, the retired members/points, the next reset — in every language', () => {
    for (const lang of LANGS) {
      const c = seasonCard(makeT(lang), { seasonNo: 4, affected: 1234, points: 56789, next: '2026-10-01T04:00:00Z', cur: 'coins' });
      assert.match(c.title, /3/, lang);
      const body = c.body.join('\n');
      assert.match(body, /1,234/); assert.match(body, /56,789/); assert.match(body, /coins/);
      assert.match(body, /<t:1790827200:R>/);
      assert.ok(!/\{\w+\}/.test(body), `unfilled placeholder in ${lang}: ${body}`);
    }
    assert.ok(!/<t:/.test(seasonCard(makeT('en'), { seasonNo: 2, next: null }).body.join('\n')));
  });
});

describe('general channel fallback', () => {
  const guild = { channels: { cache: new Map([['blog1', {}], ['kofi1', {}], ['gen1', {}]]) } };
  test('blog route, then Ko-fi, then the alerts general channel — only ones in THIS guild', () => {
    assert.equal(generalChannelFor({ blog: { routes: [{ channelId: 'elsewhere' }, { channelId: 'blog1' }] }, kofi: { channelId: 'kofi1' } }, guild), 'blog1');
    assert.equal(generalChannelFor({ blog: { channelId: 'elsewhere' }, kofi: { channelId: 'kofi1' } }, guild), 'kofi1');
    assert.equal(generalChannelFor({ alerts: { generalChannelId: 'gen1' } }, guild), 'gen1');
    assert.equal(generalChannelFor({ alerts: { generalChannelId: 'nope' } }, guild), null);
  });
});

// A giveaway is announced once, by whoever took the draw — and a prize paid in points / XP
// says where it went.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { drawOutcome, winnerDm } from '../src/features/giveaways.mjs';
import { makeT } from '../src/i18n.mjs';

describe('who announces', () => {
  test('only the process that took the draw announces', () => {
    assert.equal(drawOutcome({ ok: true, delivered: [], rewarded: [] }), 'announce');
    assert.equal(drawOutcome({ ok: true, already: true, winnerIds: ['1'] }), 'already');
  });
  test('a failed report is a retry, never an announcement (the old empty-success bug)', () => {
    // What api.giveawayDrawn used to return on a network failure — it announced winners the
    // site had not recorded, then drew and announced again on the next poll.
    assert.equal(drawOutcome({ gifts: {} }), 'retry');
    assert.equal(drawOutcome(null), 'retry');
  });
});

describe('the winner DM', () => {
  const t = makeT('en');
  const base = { tpl: '', did: '42', username: 'ana', server: 'S', prize: '500 coins', siteUrl: 'https://x.test', t };
  test('an economy prize says it is in the balance, with the currency', () => {
    const dm = winnerDm({ ...base, reward: '500 coins + 200 XP' });
    assert.match(dm, /Congrats <@42> — you won 500 coins!/);
    assert.match(dm, /Added to your balance: \*\*500 coins \+ 200 XP\*\*/);
  });
  test('an unlinked winner is told it waits for them, and where to link', () => {
    assert.match(winnerDm({ ...base, reward: '500 coins', shadow: true }), /Waiting for you: \*\*500 coins\*\*\. Link your account at https:\/\/x\.test\/profile/);
  });
  test('the other prize kinds are unchanged', () => {
    assert.match(winnerDm({ ...base, code: 'ABC' }), /Your gift code: `ABC`/);
    assert.match(winnerDm({ ...base, delivered: true }), /inventory/);
    assert.equal(winnerDm({ ...base, tpl: 'Hi {username} {code}!' }), 'Hi ana!');
  });
});

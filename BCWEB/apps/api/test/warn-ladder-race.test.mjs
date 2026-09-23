// The warning ladder, under two warnings that arrive together.
//
// Pentest 2026-09-23, card 5. `issueWarn` counted the warnings still standing and then wrote
// one, in two statements. Automod runs one handler per message, so a member sending several
// messages in the same instant produces several concurrent `POST /bot/warns`: each read the
// same total, each wrote, and the number in between was never anybody's count. `actionFor`
// matches the count EXACTLY — on purpose, so a step fires once — so a step whose number is
// skipped never fires at all. The member who spams fastest is the one the ladder misses.
//
// Against a real database, because the defect is in the gap between two statements and no
// amount of reading the source shows whether the gap is closed.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/lib/lib.mjs';
import { issueWarn, actionFor } from '../src/lib/warns.mjs';

const skip = process.env.DATABASE_URL ? false : 'no DATABASE_URL';
const TARGET = `9${Date.now()}`.slice(0, 18);

describe('the warn ladder under concurrent warnings', { skip }, () => {
  let p;
  before(async () => { p = await db(); });
  after(async () => { await p.botWarn.deleteMany({ where: { discordId: TARGET } }).catch(() => {});
    await p.botAction.deleteMany({ where: { discordId: TARGET } }).catch(() => {}); });

  test('every warning gets its own number, so no step of the ladder is stepped over', async () => {
    const issue = () => issueWarn(p, { discordId: TARGET, reason: 'spam', issuedByLabel: 'test' });
    // Four at once — the shape automod produces for a burst of messages.
    const first = await Promise.all([issue(), issue(), issue(), issue()]);
    // …and four more, to cross a second step.
    const second = await Promise.all([issue(), issue(), issue(), issue()]);
    const counts = [...first, ...second].map((r) => r.count).sort((a, b) => a - b);
    assert.deepEqual(counts, [1, 2, 3, 4, 5, 6, 7, 8], 'two warnings claimed the same count');

    // The default ladder is 3 → timeout, 5 → kick, 7 → ban. Each fired exactly once.
    const fired = [...first, ...second].filter((r) => r.triggered).map((r) => r.triggered.kind).sort();
    assert.deepEqual(fired, ['ban', 'kick', 'timeout'], 'a ladder step was skipped or fired twice');
    assert.equal(await p.botWarn.count({ where: { discordId: TARGET, revokedAt: null } }), 8);
  });

  test('the rule itself still only fires on the exact count', () => {
    assert.equal(actionFor(2), null);
    assert.equal(actionFor(3).kind, 'timeout');
    assert.equal(actionFor(4), null);
    assert.equal(actionFor(5).kind, 'kick');
  });
});

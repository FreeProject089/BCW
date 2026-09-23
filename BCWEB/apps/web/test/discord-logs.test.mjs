// Where a log row says an event lands — and the ladder the same screen writes.
//
// The log screen's whole claim is that each row names its REAL destination instead of the
// word "default". That claim is only as good as resolveLogRoute(), which is a second copy of
// resolveRoute() in apps/bot/src/features/logs.mjs. A copy that drifts does not crash and does
// not look wrong: it prints a confident sentence about a channel the bot will never use.
//
// So this file pins the ORDER: the category's own route, then its group's, then the log
// forum, then the log channel, then the /config moderation channel. The side-by-side check
// against the bot's own resolveRoute lives in apps/bot/test/log-routing-parity.test.mjs,
// which is the side that has discord.js installed.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { resolveLogRoute, normLogs, logsForSave, normLadder, ladderForSave, LOG_CATEGORY_KEYS } from '../src/lib/discord-config.js';

const FORUM = '900', CHAN = '100', OTHER = '200', MODLOG = '300';

describe('where a row says an event lands', () => {
  test('the fallback chain, one rung at a time', () => {
    const at = (logs, legacy = '') => resolveLogRoute(logs, 'members.ban', { legacyChannelId: legacy });
    assert.deepEqual(at({}, MODLOG), { kind: 'channel', id: MODLOG, ids: [MODLOG], tags: [], from: 'modlog' });
    assert.equal(at({ channelId: CHAN }, MODLOG).id, CHAN, 'the log channel beats the /config one');
    assert.equal(at({ channelId: CHAN, forumId: FORUM }, MODLOG).id, FORUM, 'the forum beats the channel');
    assert.equal(at({ forumId: FORUM, routes: { members: { kind: 'channel', id: OTHER } } }, MODLOG).id, OTHER, 'its group beats the default');
    assert.equal(at({ forumId: FORUM, routes: { members: { kind: 'channel', id: OTHER }, 'members.ban': { kind: 'channel', id: CHAN } } }, MODLOG).id, CHAN, 'its own route beats its group');
    assert.equal(at({ forumId: FORUM }, '').kind, 'forum');
    assert.deepEqual(at({}, ''), { kind: 'off', id: '', ids: [], tags: [], from: 'nothing' }, 'nothing configured is nowhere, not a crash');
  });

  test('routed off stops at that rung, it does not fall through to the default', () => {
    // The bug this forbids: "off" read as "nothing set here" and the event landing in the
    // forum anyway, which is the opposite of what the row says.
    const logs = { forumId: FORUM, routes: { 'members.ban': 'off' } };
    assert.equal(resolveLogRoute(logs, 'members.ban', { legacyChannelId: MODLOG }).kind, 'off');
    assert.equal(resolveLogRoute({ forumId: FORUM, routes: { members: 'off' } }, 'members.ban').kind, 'off');
    // A sibling in the same group is untouched.
    assert.equal(resolveLogRoute(logs, 'members.kick').kind, 'forum');
  });

  test('a forum route with no tags wears its group name, as the bot posts it', () => {
    const r = resolveLogRoute({ routes: { 'server.roles': { kind: 'forum', id: FORUM } } }, 'server.roles');
    assert.deepEqual(r.tags, ['Server']);
    assert.deepEqual(resolveLogRoute({ routes: { 'server.roles': { kind: 'forum', id: FORUM, tags: ['Audit'] } } }, 'server.roles').tags, ['Audit']);
    assert.deepEqual(resolveLogRoute({ routes: { 'server.roles': { kind: 'channel', id: CHAN } } }, 'server.roles').tags, [], 'a text channel has no tags');
  });

  test('logs off sends everything nowhere, whatever is routed', () => {
    for (const k of LOG_CATEGORY_KEYS) {
      assert.equal(resolveLogRoute({ enabled: false, forumId: FORUM, routes: { [k]: { kind: 'channel', id: CHAN } } }, k, { legacyChannelId: MODLOG }).kind, 'off', k);
    }
  });

  test('a route naming no channel routes nowhere of its own, and is dropped on save', () => {
    // Half-filled rows are the normal state of a form. They must not shadow the default.
    const logs = { forumId: FORUM, routes: { 'members.ban': { kind: 'channel', id: '' } } };
    assert.equal(resolveLogRoute(logs, 'members.ban').id, FORUM);
    assert.equal(logsForSave(logs).routes['members.ban'], undefined);
    assert.equal(logsForSave({ routes: { 'members.ban': 'off' } }).routes['members.ban'], 'off', 'off is a decision and is kept');
  });

  test('normLogs drops keys that are not a category or a group', () => {
    const n = normLogs({ routes: { 'members.ban': CHAN, 'not.a.category': CHAN, members: 'off' } });
    assert.deepEqual(Object.keys(n.routes).sort(), ['members', 'members.ban']);
    assert.deepEqual(n.routes['members.ban'], { kind: 'channel', id: CHAN, ids: [CHAN], tags: [] }, 'a bare id is a text channel');
  });

  test('a channel row may name several channels, and the old single id migrates', () => {
    // M15: several destinations per log type. What was saved as one id reads as a list of one.
    assert.deepEqual(normLogs({ routes: { voice: { kind: 'channel', id: CHAN } } }).routes.voice.ids, [CHAN]);
    const n = normLogs({ routes: { voice: { kind: 'channel', ids: [CHAN, OTHER, CHAN] } } });
    assert.deepEqual(n.routes.voice, { kind: 'channel', id: CHAN, ids: [CHAN, OTHER], tags: [] }, 'de-duplicated, first is `id`');
    const r = resolveLogRoute(n, 'voice');
    assert.deepEqual([r.kind, r.id, r.ids], ['channel', CHAN, [CHAN, OTHER]]);
    // What is sent keeps `id` beside `ids`, so a bot that predates the list still logs somewhere.
    assert.deepEqual(logsForSave(n).routes.voice, { kind: 'channel', id: CHAN, ids: [CHAN, OTHER] });
    // An emptied list routes nowhere of its own and is not sent.
    assert.equal(logsForSave({ routes: { voice: { kind: 'channel', ids: [] } } }).routes.voice, undefined);
    assert.equal(normLogs({ routes: { voice: { kind: 'channel', ids: ['1', '2', '3', '4', '5', '6', '7'] } } }).routes.voice.ids.length, 5);
  });
});

describe('the warn ladder the screen writes', () => {
  test('nothing saved shows the ladder the bot actually uses', () => {
    // An empty list here would be a screen saying "no step" while the bot runs 3/5/7.
    assert.deepEqual(normLadder([]).map((t) => [t.count, t.action]), [[3, 'timeout'], [5, 'kick'], [7, 'ban']]);
    assert.deepEqual(normLadder(undefined), normLadder([]));
  });

  test('rows come back in reading order, lowest count first', () => {
    const r = normLadder([{ count: 9, action: 'ban' }, { count: 2, action: 'kick' }]);
    assert.deepEqual(r.map((t) => t.count), [2, 9]);
  });

  test('one step per count: a second row on the same number is dropped', () => {
    assert.deepEqual(normLadder([{ count: 3, action: 'kick' }, { count: 3, action: 'ban' }]).map((t) => t.action), ['kick']);
  });

  test('minutes ride only on the actions that take one', () => {
    const sent = ladderForSave([{ count: 2, action: 'kick', minutes: 60 }, { count: 4, action: 'timeout', minutes: 15 }, { count: 6, action: 'quarantine', minutes: 30 }]);
    assert.deepEqual(sent, [
      { count: 2, action: 'kick' },
      { count: 4, action: 'timeout', minutes: 15 },
      { count: 6, action: 'quarantine', minutes: 30 },
    ], 'the API refuses the whole save over one field it did not ask for');
  });

  test('a count out of bounds is clamped into the screen, not dropped under it', () => {
    // The bot DROPS a step with a count below one. If the screen did the same, a row would
    // vanish while somebody was still typing its number. It clamps to the nearest count the
    // API accepts instead, which is also what gets saved — so the two never disagree.
    assert.deepEqual(normLadder([{ count: 0, action: 'ban' }]).map((t) => t.count), [1]);
    assert.deepEqual(normLadder([{ count: 5000, action: 'ban' }, { count: 2, action: 'kick' }]).map((t) => t.count), [2, 1000]);
    assert.equal(normLadder([{ count: 3, action: 'nonsense' }])[0].action, 'timeout', 'an unknown action becomes the safe one rather than vanishing mid-edit');
  });
});

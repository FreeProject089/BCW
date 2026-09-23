// Several destinations for one log type (M15).
//
// A channel route used to be ONE text channel: `{ kind: 'channel', id }`. It may now name up
// to five (`ids`), and every one of them gets every entry. Two things have to hold:
//   · a config saved before this existed (`id` only, or the '<channelId>' shorthand) reads as
//     that one channel: the migration is done at read time, no stored config is rewritten;
//   · logEvent really sends to each: this is a harness around the real logEvent + queue, with
//     a fake Discord client and the config the API would serve, not a re-statement of the rule.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { ChannelType } from 'discord.js';
import { api } from '../src/api.mjs';
import { normalizeLogs, resolveRoute, routeChannelIds, MAX_ROUTE_CHANNELS, initLogs, logEvent, destinationsFor, _queue, _resetLogs } from '../src/features/logs.mjs';

describe('a channel route with several channels', () => {
  test('the single value of an older config migrates to a one-item list', () => {
    const L = normalizeLogs({ routes: { messages: '100', members: { kind: 'channel', id: '200' } } });
    assert.deepEqual(L.routes.messages.ids, ['100']);
    assert.equal(L.routes.messages.id, '100');
    assert.deepEqual(L.routes.members.ids, ['200']);
  });

  test('id and ids merge, de-duplicate, keep their order and stop at the cap', () => {
    assert.deepEqual(routeChannelIds({ id: '1', ids: ['2', '1', ' 3 ', ''] }), ['1', '2', '3']);
    assert.deepEqual(routeChannelIds({ ids: ['9', '8'] }), ['9', '8']);
    const many = Array.from({ length: 9 }, (_, i) => String(i + 1));
    assert.equal(routeChannelIds({ ids: many }).length, MAX_ROUTE_CHANNELS);
    assert.deepEqual(routeChannelIds({ kind: 'channel' }), []);
  });

  test('a channel route with no channel at all routes nowhere of its own', () => {
    const L = normalizeLogs({ routes: { messages: { kind: 'channel', ids: [] } } });
    assert.equal(L.routes.messages, undefined);
  });

  test('resolveRoute hands every destination over, the first as `id`', () => {
    const r = resolveRoute({ routes: { messages: { kind: 'channel', ids: ['10', '11'] } } }, 'messages.delete');
    assert.equal(r.kind, 'channel');
    assert.equal(r.id, '10');
    assert.deepEqual(r.ids, ['10', '11']);
    // Everything that is not a channel route is one destination, still listed as `ids`.
    assert.deepEqual(resolveRoute({ forumId: '900' }, 'voice').ids, ['900']);
    assert.deepEqual(resolveRoute({ channelId: '500' }, 'voice').ids, ['500']);
    assert.deepEqual(resolveRoute({}, 'voice').ids, []);
  });
});

describe('logEvent sends to each destination (harness)', () => {
  const sent = [];
  const chan = (id) => ({ id, type: ChannelType.GuildText, isThread: () => false, send: async (payload) => { sent.push({ id, payload }); } });
  const channels = new Map(['10', '11', '12', '20', '30'].map((id) => [id, chan(id)]));
  const client = { channels: { cache: channels, fetch: async () => null } };
  let realGetConfig;

  before(() => {
    realGetConfig = api.getConfig;
    api.getConfig = async () => ({
      enabled: true,
      guildLogChannels: {},
      logs: {
        enabled: true,
        routes: {
          messages: { kind: 'channel', ids: ['10', '11', '12'] },
          // A channel id that does not exist beside one that does: the good one still gets it.
          voice: { kind: 'channel', ids: ['404', '20'] },
          members: { kind: 'channel', id: '30' },
        },
      },
    });
    initLogs(client);
    _resetLogs();
  });
  after(() => { api.getConfig = realGetConfig; _resetLogs(); initLogs(null); });

  const drain = async () => { _queue.flush(); await new Promise((r) => setTimeout(r, 20)); };

  test('three channels, three copies of the one entry', async () => {
    sent.length = 0;
    const ok = await logEvent('g1', 'messages.delete', { user: { id: '1', tag: 'someone' }, channelId: '5', content: 'bye' });
    assert.equal(ok, true);
    await drain();
    assert.deepEqual(sent.map((s) => s.id).sort(), ['10', '11', '12']);
    for (const s of sent) assert.equal(s.payload.embeds?.[0]?.title, 'Message deleted');
  });

  test('a missing channel does not stop the others', async () => {
    sent.length = 0;
    const ds = await destinationsFor('g1', 'voice');
    assert.equal(ds.length, 2);
    assert.equal(ds.find((d) => d.route.id === '404').error, 'channel not found');
    assert.equal(await logEvent('g1', 'voice', { user: { id: '1' }, kind: 'join', to: '5' }), true);
    await drain();
    assert.deepEqual(sent.map((s) => s.id), ['20']);
  });

  test('an older single-channel route still sends to that channel, once', async () => {
    sent.length = 0;
    assert.equal(await logEvent('g1', 'members.join', { user: { id: '1' } }), true);
    await drain();
    assert.deepEqual(sent.map((s) => s.id), ['30']);
  });
});

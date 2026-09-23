// The dashboard's copy of resolveRoute, checked against this one.
//
// apps/web/src/lib/discord-config.js holds a second copy of the routing rule, because every
// row of the log screen states the destination it resolves to right now instead of the word
// "default". A copy that drifts from features/logs.mjs does not crash and does not look
// wrong: it prints a confident sentence naming a channel the bot will never use.
//
// The check lives HERE rather than in apps/web because this is the side that has discord.js
// installed. The web module imports nothing at all, so it loads cleanly from either.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRoute, CATEGORIES, GROUPS } from '../src/features/logs.mjs';
import { resolveLogRoute, LOG_CATEGORY_KEYS, LOG_CATEGORIES, LOG_GROUP_TAG, LADDER_ACTIONS as WEB_LADDER_ACTIONS } from '../../web/src/lib/discord-config.js';
import { LADDER_ACTIONS } from '../src/features/automod.mjs';

const FORUM = '900', CHAN = '100', OTHER = '200', MODLOG = '300';

describe('the dashboard resolves what the bot resolves', () => {
  test('the categories, their groups and the tag names are one vocabulary', () => {
    assert.deepEqual(LOG_CATEGORY_KEYS, Object.keys(CATEGORIES));
    for (const k of LOG_CATEGORY_KEYS) assert.equal(LOG_CATEGORIES[k], CATEGORIES[k].group, k);
    assert.deepEqual(LOG_GROUP_TAG, GROUPS, 'the tag a forum post wears is the group name');
  });

  test('the ladder vocabulary is one list too', () => {
    assert.deepEqual([...WEB_LADDER_ACTIONS].sort(), [...LADDER_ACTIONS].sort());
  });

  test('every category, against a config that exercises every branch', () => {
    const logs = {
      enabled: true, forumId: FORUM, channelId: CHAN, forumMode: 'category', routes: {
        messages: { kind: 'channel', id: OTHER },                    // a whole group elsewhere
        'messages.edit': 'off',                                      // one category silenced
        'members.ban': { kind: 'forum', id: FORUM, tags: ['Bans'] },  // its own tag
        voice: 'off',                                                // a one-category group off
        economy: { kind: 'channel', id: OTHER },
        server: { kind: 'channel', ids: [OTHER, CHAN, OTHER] },       // several channels (M15)
        'members.kick': { kind: 'channel', id: CHAN, ids: [MODLOG] }, // an old id beside new ids
      },
    };
    for (const k of LOG_CATEGORY_KEYS) {
      const web = resolveLogRoute(logs, k, { legacyChannelId: MODLOG });
      const bot = resolveRoute(logs, k, { legacyChannelId: MODLOG });
      assert.deepEqual([web.kind, web.id, web.ids, web.tags], [bot.kind, bot.id, bot.ids, bot.tags], k);
    }
  });

  test('and against the configs where nothing much is set', () => {
    const cases = [{}, { enabled: false }, { channelId: CHAN }, { forumId: FORUM }, { forumId: FORUM, channelId: CHAN }];
    for (const logs of cases) {
      for (const legacy of ['', MODLOG]) {
        for (const k of LOG_CATEGORY_KEYS) {
          const web = resolveLogRoute(logs, k, { legacyChannelId: legacy });
          const bot = resolveRoute(logs, k, { legacyChannelId: legacy });
          assert.deepEqual([web.kind, web.id, web.ids], [bot.kind, bot.id, bot.ids], `${k} · ${JSON.stringify(logs)} · legacy=${legacy || 'none'}`);
        }
      }
    }
  });
});

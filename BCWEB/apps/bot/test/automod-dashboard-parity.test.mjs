// The dashboard writes the automod config (apps/web/src/lib/discord-config.js, normAutomod),
// the bot reads it (features/automod.mjs, normalizeAutomod). Two copies of one vocabulary: if
// the dashboard offers an action the bot does not know, or drops a field the bot reads, the
// save succeeds and the rule quietly does something else. This pins the two against each other
// from the side that has discord.js installed; the web module imports nothing.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ACTIONS, MESSAGE_RULES, normalizeAutomod } from '../src/features/automod.mjs';
import { AUTOMOD_ACTIONS, JOIN_RULES, AUTOMOD_RULES, normAutomod } from '../../web/src/lib/discord-config.js';

const ROLE = '123456789012345678';

describe('dashboard automod shape = bot automod shape', () => {
  test('the same message-rule actions, in the same spelling', () => {
    assert.deepEqual([...AUTOMOD_ACTIONS].sort(), [...ACTIONS].sort());
    assert.deepEqual(AUTOMOD_RULES.filter((r) => !JOIN_RULES.includes(r)).sort(), [...MESSAGE_RULES].sort());
  });

  test('what the dashboard saves, the bot reads back unchanged', () => {
    const sent = normAutomod({ rules: {
      spam: { action: 'addRole', roleId: ROLE, roleMin: 45, countsAsWarn: true, warnEvery: 3, warnWindowMin: 90 },
      caps: { enabled: true, action: 'removeRole', roleId: ROLE, warnEvery: 2, warnWindowMin: 0 },
      invites: { action: 'warn', warnEvery: 4 },
    } });
    const bot = normalizeAutomod(JSON.parse(JSON.stringify(sent)));
    for (const name of ['spam', 'caps', 'invites']) {
      for (const k of ['action', 'roleId', 'roleMin', 'countsAsWarn', 'warnEvery', 'warnWindowMin']) {
        assert.deepEqual(bot.rules[name][k], sent.rules[name][k], `${name}.${k}`);
      }
    }
  });

  test('the defaults agree, so an untouched rule means the same thing on both sides', () => {
    const web = normAutomod(null);
    const bot = normalizeAutomod(null);
    for (const name of MESSAGE_RULES) {
      for (const k of ['countsAsWarn', 'warnEvery', 'warnWindowMin', 'roleId', 'roleMin']) {
        assert.deepEqual(web.rules[name][k], bot.rules[name][k], `${name}.${k}`);
      }
    }
  });
});

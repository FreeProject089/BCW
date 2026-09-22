// The automod shape the dashboard SENDS. normAutomod() is both the reader and the writer: the
// user dashboard (discord-servers.jsx) stores its output in the draft and PUTs it as is, and the
// admin screen stores it in bot.config the same way. So a field normAutomod does not copy is a
// field every save deletes, with a 200 and no error anywhere. The progressive-warning fields
// (countsAsWarn / warnEvery / warnWindowMin) and the role actions (roleId / roleMin) are the
// ones added after the function was written, which is exactly when that happens.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { normAutomod, AUTOMOD_ACTIONS, ROLE_ACTIONS, JOIN_RULES, AUTOMOD_RULES, actionsFor } from '../src/lib/discord-config.js';

const ROLE = '123456789012345678';

describe('normAutomod keeps what the owner set', () => {
  test('progressive warnings and the role action survive a save and a reload', () => {
    const saved = normAutomod({
      rules: {
        spam: { action: 'addRole', roleId: ROLE, roleMin: 30, countsAsWarn: true, warnEvery: 3, warnWindowMin: 120 },
        links: { enabled: true, action: 'removeRole', roleId: ROLE, countsAsWarn: false, warnEvery: 5, warnWindowMin: 0 },
      },
    });
    // What goes over the wire, back through JSON, and normalised again on the next load.
    const again = normAutomod(JSON.parse(JSON.stringify(saved)));
    for (const n of [saved, again]) {
      assert.equal(n.rules.spam.action, 'addRole');
      assert.equal(n.rules.spam.roleId, ROLE);
      assert.equal(n.rules.spam.roleMin, 30);
      assert.equal(n.rules.spam.countsAsWarn, true);
      assert.equal(n.rules.spam.warnEvery, 3);
      assert.equal(n.rules.spam.warnWindowMin, 120);
      assert.equal(n.rules.links.action, 'removeRole');
      assert.equal(n.rules.links.warnEvery, 5);
      assert.equal(n.rules.links.warnWindowMin, 0, '0 = until the bot restarts, a real value and not "unset"');
    }
    assert.deepEqual(again, saved, 'normalising twice changes nothing');
  });

  test('a rule saved before these fields existed gets the bot defaults', () => {
    const n = normAutomod({ rules: { spam: { enabled: true, action: 'timeout' } } });
    assert.deepEqual(
      { c: n.rules.spam.countsAsWarn, e: n.rules.spam.warnEvery, w: n.rules.spam.warnWindowMin, r: n.rules.spam.roleId, m: n.rules.spam.roleMin },
      { c: false, e: 1, w: 60, r: '', m: 0 },
    );
  });

  test('bounds are the API schema bounds, so a save is never refused over one field', () => {
    const n = normAutomod({ rules: { spam: { warnEvery: 999, warnWindowMin: 99999999, roleMin: -4 } } });
    assert.equal(n.rules.spam.warnEvery, 50);
    assert.equal(n.rules.spam.warnWindowMin, 43200);
    assert.equal(n.rules.spam.roleMin, 0);
    assert.equal(normAutomod({ rules: { spam: { warnEvery: 0 } } }).rules.spam.warnEvery, 1);
  });

  test('a role id that is not a snowflake is dropped, not sent', () => {
    assert.equal(normAutomod({ rules: { spam: { roleId: '<@&123>' } } }).rules.spam.roleId, '');
    assert.equal(normAutomod({ rules: { spam: { roleId: ` ${ROLE} ` } } }).rules.spam.roleId, ROLE);
  });

  test('join rules carry none of the message-only parameters', () => {
    for (const name of JOIN_RULES) {
      const r = normAutomod({ rules: { [name]: { countsAsWarn: true, warnEvery: 3, roleId: ROLE } } }).rules[name];
      for (const k of ['countsAsWarn', 'warnEvery', 'warnWindowMin', 'roleId', 'roleMin']) assert.equal(k in r, false, `${name}.${k}`);
    }
  });

  test('the role actions are offered to message rules only', () => {
    for (const a of ROLE_ACTIONS) assert.ok(AUTOMOD_ACTIONS.includes(a), a);
    for (const name of AUTOMOD_RULES) {
      const has = ROLE_ACTIONS.every((a) => actionsFor(name).includes(a));
      assert.equal(has, !JOIN_RULES.includes(name), name);
    }
    // A join rule saved with a role action falls back to its default rather than keeping an
    // action the bot would refuse.
    assert.equal(normAutomod({ rules: { raid: { action: 'addRole' } } }).rules.raid.action, 'timeout');
  });
});

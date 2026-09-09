// May this Discord user change this server's bot settings, from inside Discord?
//
// Until now the answer was "not from Discord at all": every per-guild setting lived on the
// site, behind a login, and the bot could only read them. So the person who actually runs
// the server — who is in Discord, looking at the bot — had to leave, find the dashboard,
// and come back.
//
// Opening that up is a permission decision, and the expensive way to be wrong is obvious:
// a stranger in a server reconfiguring the bot, or somebody whose Discord id was never
// tied to an account being taken at their word about who they are.
//
// Two conditions, both required, and the tests below keep them from collapsing into one.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { canConfigureGuild, patchFromDiscord, ALLOWED } from '../src/lib/bot-guild-access.mjs';

const guild = (o = {}) => ({
  guildId: o.guildId || 'g1',
  // `in`, not ??: `null ?? 'owner1'` is 'owner1', so a fixture written with ?? cannot
  // express "this guild has no owner" — which is exactly the case being tested.
  ownerDiscordId: 'ownerDiscordId' in o ? o.ownerDiscordId : 'owner1',
  managerDiscordIds: o.managerDiscordIds || ['mgr1'],
  memberMode: o.memberMode || 'none',
  logChannelId: o.logChannelId ?? null,
  storeLogs: !!o.storeLogs,
});

describe('canConfigureGuild', () => {
  test('the owner may', () => {
    assert.equal(canConfigureGuild(guild(), 'owner1', true), true);
  });

  test('a listed manager may', () => {
    assert.equal(canConfigureGuild(guild(), 'mgr1', true), true);
  });

  test('anybody else may not, however many Discord permissions they hold', () => {
    // The Discord-side permission check is a PRE-filter the bot does before it calls; it
    // is not the authority. Discord's Manage Server can be handed out by anyone with it,
    // and this decides who touches a record on our side.
    assert.equal(canConfigureGuild(guild(), 'random', true), false);
  });

  test('an UNLINKED account may not, even if it is the owner', () => {
    // The second condition, and the one that is easy to drop because it feels redundant:
    // the bot already knows the Discord id, so why require an account? Because a Discord
    // id is not a person we have any record of — no terms accepted, no audit trail, and
    // nobody to hold to anything. It is also the reason the refusal has to say
    // "link an account" rather than "you are not allowed".
    assert.equal(canConfigureGuild(guild(), 'owner1', false), false);
  });

  test('a guild we have never seen refuses everybody', () => {
    // A guild row is created by the heartbeat. No row means the bot has not reported this
    // server yet, and defaulting to "the caller is probably the owner" would let the first
    // person to run the command in an unseen server configure it.
    assert.equal(canConfigureGuild(null, 'owner1', true), false);
    assert.equal(canConfigureGuild(guild({ ownerDiscordId: null, managerDiscordIds: [] }), 'owner1', true), false);
  });

  test('an empty actor is nobody', () => {
    assert.equal(canConfigureGuild(guild({ ownerDiscordId: null }), null, true), false);
    assert.equal(canConfigureGuild(guild({ ownerDiscordId: '' }), '', true), false);
  });
});

describe('patchFromDiscord', () => {
  test('the settings that make sense in Discord are kept', () => {
    assert.deepEqual(patchFromDiscord({ language: 'fr', logChannelId: '123', storeLogs: true }, guild()).data,
      { language: 'fr', logChannelId: '123', storeLogs: true });
  });

  test('auto clears the language rather than storing the word', () => {
    assert.equal(patchFromDiscord({ language: 'auto' }, guild()).data.language, null);
  });

  test('the settings that spend money or capacity are NOT', () => {
    // hostingGroupId and storageQuotaBytes decide which pool a guild eats and how much of
    // it. Both are the account holder's decisions, made where the bill is, and neither is
    // something a server manager in Discord has the context to choose.
    const r = patchFromDiscord({ hostingGroupId: 'pool1', storageQuotaBytes: 999, memberMode: 'pool' }, guild());
    assert.deepEqual(r.data, {});
    assert.deepEqual(r.rejected.sort(), ['hostingGroupId', 'memberMode', 'storageQuotaBytes']);
  });

  test('moderation without a log channel is refused, as it is on the site', () => {
    // The same rule the admin route enforces: `moderation` runs bans and kicks and must
    // log somewhere. Two places enforcing one rule is how they diverge, so this returns
    // the same error code the route already uses.
    assert.equal(patchFromDiscord({ memberMode: 'moderation' }, guild()).error, 'log_channel_required');
    assert.equal(patchFromDiscord({ memberMode: 'moderation', logChannelId: '9' }, guild()).error, undefined);
    // Already has one stored: allowed without repeating it.
    assert.equal(patchFromDiscord({ memberMode: 'moderation' }, guild({ logChannelId: '7' })).error, undefined);
  });

  test('clearing the log channel while moderation is on is refused', () => {
    // The same rule read from the other end, and the one a check written only at
    // "setting moderation" would miss entirely.
    assert.equal(patchFromDiscord({ logChannelId: null }, guild({ memberMode: 'moderation', logChannelId: '7' })).error,
      'log_channel_required');
  });

  test('junk is dropped, not coerced', () => {
    const r = patchFromDiscord({ language: 'klingon', storeLogs: 'yes', logChannelId: 12 }, guild());
    assert.deepEqual(r.data, {});
    assert.deepEqual(r.rejected.sort(), ['language', 'logChannelId', 'storeLogs']);
  });

  test('an empty patch is not an error', () => {
    assert.deepEqual(patchFromDiscord({}, guild()), { data: {}, rejected: [] });
    assert.deepEqual(patchFromDiscord(null, guild()), { data: {}, rejected: [] });
  });
});

// ── What a pentest asked of this file, kept as tests ────────────────────────────────────
//
// Card D of the Sept-9 plan. Three of its four questions are answered here; the fourth (the
// audit line written against link.userId when the link is deleted mid-request) is answered
// by the route rather than this module — `link` is read once and canConfigureGuild already
// required link.userId to be truthy, so there is no second read to go stale.
describe('patchFromDiscord — hostile input', () => {
  const cur = { language: null, logChannelId: '1', storeLogs: false, memberMode: 'none' };

  test('prototype keys are dropped, not merged', () => {
    // JSON.parse puts __proto__ on the object as an OWN enumerable property, so it does
    // reach Object.entries here. It has to leave through `rejected` like any other unknown
    // key — `data` is what goes to Prisma as `update({ data })`.
    const { data, rejected } = patchFromDiscord(
      JSON.parse('{"__proto__":{"admin":true},"constructor":{"x":1},"prototype":{}}'), cur);
    assert.deepEqual(Object.keys(data), []);
    assert.ok(rejected.includes('__proto__'), 'must be named, not silently swallowed');
    assert.equal({}.admin, undefined, 'Object.prototype must be untouched');
  });

  test('ONLY memberMode can set memberMode — the guard is for the next key added', () => {
    // Honest about what this catches. The memberMode branch was the last one standing and
    // was reached by elimination rather than by naming its key; today every other allowed
    // key `continue`s before reaching it, so nothing was actually broken. It would break the
    // moment a fifth key joined ALLOWED without a branch of its own — `{ newKey:
    // 'moderation' }` would then turn on the mode that runs bans and kicks, from a key about
    // something else entirely.
    //
    // So the test is the invariant rather than a reproduction: feed EVERY allowed key the
    // value that turns moderation on, and only its own key may do it. Green today, red the
    // day somebody adds a key and forgets its branch.
    for (const k of ALLOWED.filter((x) => x !== 'memberMode')) {
      const { data } = patchFromDiscord({ [k]: 'moderation' }, cur);
      assert.equal(data.memberMode, undefined, `${k} must not be able to set memberMode`);
    }
    assert.equal(patchFromDiscord({ memberMode: 'moderation' }, cur).data.memberMode, 'moderation');
  });

  test("'pool' stays site-only — it spends somebody else's storage", () => {
    const { data, rejected } = patchFromDiscord({ memberMode: 'pool' }, cur);
    assert.equal(data.memberMode, undefined);
    assert.deepEqual(rejected, ['memberMode']);
  });

  test('the paying fields cannot be set from Discord at all', () => {
    const { data, rejected } = patchFromDiscord(
      { hostingGroupId: 'someone-elses-pool', storageQuotaBytes: 999e9 }, cur);
    assert.deepEqual(Object.keys(data), []);
    assert.deepEqual(rejected.sort(), ['hostingGroupId', 'storageQuotaBytes']);
  });

  test('moderation without a log channel is refused from BOTH directions', () => {
    // Turning it on with no channel…
    assert.equal(patchFromDiscord({ memberMode: 'moderation' },
      { ...cur, logChannelId: null }).error, 'log_channel_required');
    // …and clearing the channel while it is already on, which a check written only at the
    // first would miss entirely.
    assert.equal(patchFromDiscord({ logChannelId: null },
      { ...cur, memberMode: 'moderation' }).error, 'log_channel_required');
  });

  test('a log channel id is a snowflake and nothing else', () => {
    for (const bad of ['12a', '<#123>', ' 123', '123 ', '-1', '1'.repeat(33), 0, true, {}]) {
      assert.equal(patchFromDiscord({ logChannelId: bad }, cur).data.logChannelId, undefined,
        `${JSON.stringify(bad)} must be rejected`);
    }
    assert.equal(patchFromDiscord({ logChannelId: '123456789012345678' }, cur).data.logChannelId,
      '123456789012345678');
    // NOT checked here, and it cannot be: whether that channel belongs to THIS guild. The
    // API is never told a guild's channels — the heartbeat reports name, member count,
    // owner and managers, and nothing else. Today no code sends anything to this channel,
    // so nothing can be redirected out of the guild by setting it; the value is stored and
    // displayed. Whatever eventually posts here must resolve the id THROUGH the guild
    // rather than through the client, or this becomes a cross-guild redirect.
    assert.equal(patchFromDiscord({ logChannelId: '999999999999999999' }, cur).data.logChannelId,
      '999999999999999999');
  });
});

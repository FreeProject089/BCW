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
import { canConfigureGuild, patchFromDiscord } from '../src/lib/bot-guild-access.mjs';

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

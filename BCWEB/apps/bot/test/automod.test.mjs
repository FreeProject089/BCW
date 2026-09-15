// The automod engine, without Discord: every rule, the ladder, exemptions, the selfbot
// heuristics, raid detection. Plain messages in, actions out.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeAutomod, normalizeLadder, escalationFor, createState, evaluateMessage, evaluateJoin, strongest, isExempt,
  extractInvites, extractLinks, domainAllowed, compilePattern, matchWords, capsRatio, zalgoScore, contentHash, recordWarn, warnCount,
  lockdownActive, DEFAULT_AUTOMOD, RULES, ACTIONS,
} from '../src/features/automod.mjs';

const T0 = 1_700_000_000_000;
const cfg = (over = {}) => normalizeAutomod({ rules: over.rules || {}, exempt: over.exempt, enabled: over.enabled, warnDecayHours: over.warnDecayHours });
let seq = 0;
const msg = (o = {}) => ({
  id: `m${++seq}`, guildId: 'g1', channelId: o.channelId || 'c1', authorId: o.authorId || 'u1', bot: false,
  content: o.content ?? 'hello there', createdAt: o.at ?? T0, mentions: { users: 0, roles: 0, everyone: false, ...(o.mentions || {}) },
  attachments: o.attachments || [], memberRoles: o.memberRoles || [], isModerator: !!o.isModerator, inviteGuilds: o.inviteGuilds || {},
});
const rulesOf = (actions) => actions.map((a) => a.rule);

describe('normalisation', () => {
  test('nothing saved → the documented defaults, every rule present', () => {
    const c = normalizeAutomod(undefined);
    assert.deepEqual(Object.keys(c.rules), RULES);
    assert.equal(c.rules.spam.maxMessages, DEFAULT_AUTOMOD.rules.spam.maxMessages);
    assert.equal(c.exempt.moderators, true);
    assert.equal(c.enabled, true);
  });
  test('a saved override wins; a bad action, a negative number and a non-array list fall back', () => {
    const c = normalizeAutomod({ rules: { spam: { action: 'ban', maxMessages: 3, windowSec: -1 }, links: { enabled: true, action: 'nuke', allowDomains: 'not-a-list' }, accountAge: { action: 'quarantine' }, raid: { action: 'delete' } }, exempt: { roles: ['r1', 7], moderators: false } });
    assert.equal(c.rules.spam.action, 'ban');
    assert.equal(c.rules.spam.maxMessages, 3);
    assert.equal(c.rules.spam.windowSec, DEFAULT_AUTOMOD.rules.spam.windowSec);
    assert.equal(c.rules.links.action, 'delete');
    assert.deepEqual(c.rules.links.allowDomains, []);
    assert.equal(c.rules.accountAge.action, 'quarantine');
    assert.equal(c.rules.raid.action, 'timeout', 'delete is meaningless for a join rule');
    assert.deepEqual(c.exempt.roles, ['r1', '7']);
    assert.equal(c.exempt.moderators, false);
  });
  test('the ladder is sorted highest first and drops what cannot be honoured', () => {
    const L = normalizeLadder([{ count: 0, action: 'ban' }, { count: 5, action: 'kick' }, { count: 3, action: 'timeout', minutes: 0 }, { count: 2, action: 'nuke' }]);
    assert.deepEqual(L.map((t) => t.count), [5, 3]);
    assert.equal(L[1].minutes, 1);
  });
});

describe('escalation', () => {
  test('exact count fires, the counts between do not, later counts do not re-fire', () => {
    assert.equal(escalationFor(1), null);
    assert.equal(escalationFor(2), null);
    assert.deepEqual(escalationFor(3), { kind: 'timeout', minutes: 60, at: 3 });
    assert.equal(escalationFor(4), null);
    assert.equal(escalationFor(5).kind, 'kick');
    assert.equal(escalationFor(6), null);
    assert.equal(escalationFor(7).kind, 'ban');
    assert.equal(escalationFor(8), null);
  });
  test('a configured ladder replaces the default; a "warn" step is a written-down no-op', () => {
    const L = [{ count: 2, action: 'timeout', minutes: 5 }, { count: 3, action: 'warn' }, { count: 4, action: 'ban' }];
    assert.deepEqual(escalationFor(2, L), { kind: 'timeout', minutes: 5, at: 2 });
    assert.equal(escalationFor(3, L), null);
    assert.equal(escalationFor(4, L).kind, 'ban');
    assert.equal(escalationFor(0, L), null);
    assert.equal(escalationFor('x', L), null);
  });
  test('local warn memory counts and decays', () => {
    const s = createState();
    const c = cfg({ warnDecayHours: 1 });
    assert.equal(recordWarn(s, 'u', c, T0), 1);
    assert.equal(recordWarn(s, 'u', c, T0 + 1000), 2);
    assert.equal(warnCount(s, 'u', c, T0 + 2000), 2);
    assert.equal(warnCount(s, 'u', c, T0 + 2 * 3_600_000), 0, 'both decayed');
    assert.equal(recordWarn(s, 'u', c, T0 + 2 * 3_600_000), 1);
    assert.equal(warnCount(s, 'u', cfg({ warnDecayHours: 0 }), T0 + 10 * 3_600_000), 1, '0 = never decays');
  });
});

describe('exemptions', () => {
  test('roles, channels, users, moderators — each alone is enough', () => {
    const ex = { roles: ['r9'], channels: ['c9'], users: ['u9'], moderators: true };
    assert.equal(isExempt(ex, { authorId: 'u1', channelId: 'c1', memberRoles: ['r1'] }), false);
    assert.equal(isExempt(ex, { authorId: 'u9' }), true);
    assert.equal(isExempt(ex, { channelId: 'c9' }), true);
    assert.equal(isExempt(ex, { memberRoles: ['r1', 'r9'] }), true);
    assert.equal(isExempt(ex, { isModerator: true }), true);
    assert.equal(isExempt({ ...ex, moderators: false }, { isModerator: true }), false);
  });
  test('an exempt author trips no rule, even a blatant one', () => {
    const c = cfg({ rules: { mentions: { enabled: true, maxUsers: 1 } }, exempt: { users: ['vip'] } });
    assert.deepEqual(evaluateMessage(msg({ authorId: 'vip', mentions: { users: 50 } }), createState(), c), []);
    assert.equal(evaluateMessage(msg({ authorId: 'u1', mentions: { users: 50 } }), createState(), c).length, 1);
  });
  test('a disabled automod, or a bot author, is silence', () => {
    assert.deepEqual(evaluateMessage(msg({ mentions: { users: 50 } }), createState(), cfg({ enabled: false })), []);
    assert.deepEqual(evaluateMessage({ ...msg({ mentions: { users: 50 } }), bot: true }, createState(), cfg()), []);
  });
});

describe('spam', () => {
  test('rate: the message that exceeds maxMessages in the window fires, earlier ones do not', () => {
    const c = cfg({ rules: { spam: { enabled: true, maxMessages: 3, windowSec: 5 }, selfbot: { enabled: false } } });
    const s = createState();
    for (let k = 0; k < 3; k++) assert.deepEqual(evaluateMessage(msg({ content: `m${k}`, at: T0 + k * 100 }), s, c), []);
    const hits = evaluateMessage(msg({ content: 'm4', at: T0 + 400 }), s, c);
    assert.equal(hits.length, 1); assert.equal(hits[0].rule, 'spam'); assert.equal(hits[0].meta.kind, 'rate'); assert.equal(hits[0].action, 'timeout'); assert.equal(hits[0].deleteMessage, true);
    // Outside the window: nothing.
    assert.deepEqual(evaluateMessage(msg({ content: 'later', at: T0 + 60_000 }), s, c), []);
  });
  test('repeats: the same text (case / spacing ignored) maxRepeats times', () => {
    const c = cfg({ rules: { spam: { enabled: true, maxRepeats: 3, repeatWindowSec: 30 }, selfbot: { enabled: false } } });
    const s = createState();
    assert.deepEqual(evaluateMessage(msg({ content: 'Buy now', at: T0 }), s, c), []);
    assert.deepEqual(evaluateMessage(msg({ content: 'buy  NOW ', at: T0 + 5000 }), s, c), []);
    const hits = evaluateMessage(msg({ content: 'BUY now', at: T0 + 10_000 }), s, c);
    assert.equal(hits[0]?.meta.kind, 'repeat');
    assert.equal(contentHash('Buy now'), contentHash('buy  NOW '));
    assert.notEqual(contentHash('buy now'), contentHash('buy now!'));
  });
  test('the log action deletes nothing', () => {
    const c = cfg({ rules: { spam: { enabled: true, action: 'log', maxRepeats: 2 }, selfbot: { enabled: false } } });
    const s = createState();
    evaluateMessage(msg({ content: 'x', at: T0 }), s, c);
    const [h] = evaluateMessage(msg({ content: 'x', at: T0 + 1 }), s, c);
    assert.equal(h.action, 'log'); assert.equal(h.deleteMessage, false);
  });
});

describe('mentions', () => {
  const c = cfg({ rules: { mentions: { enabled: true, maxUsers: 3, maxRoles: 1, everyone: false, action: 'warn' } } });
  test('users over the cap, roles over the cap, @everyone — one hit each, at the cap nothing', () => {
    assert.deepEqual(evaluateMessage(msg({ mentions: { users: 3 } }), createState(), c), []);
    assert.equal(evaluateMessage(msg({ mentions: { users: 4 } }), createState(), c)[0].rule, 'mentions');
    assert.equal(evaluateMessage(msg({ mentions: { roles: 2 } }), createState(), c)[0].meta.roles, 2);
    assert.equal(evaluateMessage(msg({ mentions: { everyone: true } }), createState(), c)[0].meta.everyone, true);
    assert.deepEqual(evaluateMessage(msg({ mentions: { everyone: true } }), createState(), cfg({ rules: { mentions: { everyone: true } } })), []);
  });
});

describe('invites', () => {
  test('extracts codes from every invite form, once each', () => {
    assert.deepEqual(extractInvites('join https://discord.gg/abc123 or discord.com/invite/abc123 or https://discordapp.com/invite/Zz-9'), ['abc123', 'Zz-9']);
    assert.deepEqual(extractInvites('no invites here https://example.com/x'), []);
  });
  test('an invite to THIS server or an allowed guild/code passes; anything else is deleted', () => {
    const c = cfg({ rules: { invites: { enabled: true, allowGuilds: ['g-friend'], allowCodes: ['OKCODE'] } } });
    assert.deepEqual(evaluateMessage(msg({ content: 'discord.gg/mine', inviteGuilds: { mine: 'g1' } }), createState(), c), []);
    assert.deepEqual(evaluateMessage(msg({ content: 'discord.gg/friend', inviteGuilds: { friend: 'g-friend' } }), createState(), c), []);
    assert.deepEqual(evaluateMessage(msg({ content: 'discord.gg/okcode' }), createState(), c), []);
    const [h] = evaluateMessage(msg({ content: 'discord.gg/spam', inviteGuilds: { spam: 'g-other' } }), createState(), c);
    assert.equal(h.rule, 'invites'); assert.deepEqual(h.meta.codes, ['spam']);
    // Unresolved (the bot could not fetch it) = not allowed.
    assert.equal(evaluateMessage(msg({ content: 'discord.gg/unknown' }), createState(), c).length, 1);
  });
});

describe('links', () => {
  test('hosts are extracted and matched against the allow-list by suffix', () => {
    assert.deepEqual(extractLinks('see https://Docs.Example.com/a?b=1 and http://www.other.io.').map((l) => l.host), ['docs.example.com', 'other.io']);
    assert.equal(domainAllowed('docs.example.com', ['example.com']), true);
    assert.equal(domainAllowed('example.com', ['*.example.com']), true);
    assert.equal(domainAllowed('notexample.com', ['example.com']), false);
    assert.equal(extractLinks('https://discord.gg/abc').length, 0, 'invites are the invite rule\'s business');
  });
  test('empty allow-list blocks every link; an allowed host passes', () => {
    const all = cfg({ rules: { links: { enabled: true } } });
    assert.equal(evaluateMessage(msg({ content: 'https://a.com' }), createState(), all)[0].rule, 'links');
    const some = cfg({ rules: { links: { enabled: true, allowDomains: ['A.com'] } } });
    assert.deepEqual(evaluateMessage(msg({ content: 'https://sub.a.com/x' }), createState(), some), []);
    assert.deepEqual(evaluateMessage(msg({ content: 'https://b.com/x' }), createState(), some)[0].meta.hosts, ['b.com']);
  });
});

describe('words', () => {
  test('whole word, prefix / suffix / contains wildcards, raw regex, a broken regex matches nothing', () => {
    assert.ok(compilePattern('bad').test('that is bad!'));
    assert.ok(!compilePattern('bad').test('badger'));
    assert.ok(compilePattern('bad*').test('badger'));
    assert.ok(!compilePattern('bad*').test('nobad'));
    assert.ok(compilePattern('*bad*').test('anybadword'));
    assert.ok(compilePattern('/b[a4]d/').test('B4D'));
    assert.equal(compilePattern('/(unclosed/'), null);
    assert.equal(compilePattern(''), null);
    assert.ok(compilePattern('café').test('un CAFÉ noir'), 'unicode letters are word characters');
  });
  test('the hit names the patterns that matched', () => {
    const c = cfg({ rules: { words: { enabled: true, patterns: ['spam*', 'scam', '/free\\s+nitro/'] } } });
    const [h] = evaluateMessage(msg({ content: 'Free   NITRO spammers!' }), createState(), c);
    assert.equal(h.rule, 'words'); assert.deepEqual(h.meta.patterns, ['spam*', '/free\\s+nitro/']);
    assert.deepEqual(evaluateMessage(msg({ content: 'scammer' }), createState(), c), [], 'scam is a whole word');
    assert.deepEqual(matchWords('nothing here', ['spam*']), []);
  });
});

describe('caps', () => {
  test('ratio counts letters only and needs minLetters', () => {
    assert.deepEqual(capsRatio('HELLO'), { ratio: 1, letters: 5 });
    assert.equal(capsRatio('123 !!!').letters, 0);
    const c = cfg({ rules: { caps: { enabled: true, ratio: 0.7, minLetters: 6 } } });
    assert.deepEqual(evaluateMessage(msg({ content: 'OK!!' }), createState(), c), [], 'too short');
    assert.equal(evaluateMessage(msg({ content: 'STOP SHOUTING NOW please' }), createState(), c)[0]?.rule, 'caps');
    assert.deepEqual(evaluateMessage(msg({ content: 'Stop Shouting Please' }), createState(), c), []);
  });
});

describe('zalgo', () => {
  test('combining marks are counted; plain accented text is not zalgo', () => {
    const z = 'ḩ̶́è̴̖ḻ̵l̶̄ó̷';
    assert.ok(zalgoScore(z).combining >= 10);
    assert.equal(zalgoScore('café — naïve élève').combining, 0, 'precomposed accents are not combining marks');
    const c = cfg({ rules: { zalgo: { enabled: true, maxCombining: 6, maxRatio: 0.3 } } });
    assert.equal(evaluateMessage(msg({ content: z }), createState(), c)[0].rule, 'zalgo');
  });
  test('ratio catches a short heavily-marked text under the absolute cap', () => {
    const c = cfg({ rules: { zalgo: { enabled: true, maxCombining: 50, maxRatio: 0.3 } } });
    assert.equal(evaluateMessage(msg({ content: 'à́b̂̃' }), createState(), c)[0]?.rule, 'zalgo');
    assert.deepEqual(evaluateMessage(msg({ content: 'a long sentence with one é' }), createState(), c), []);
  });
});

describe('attachments', () => {
  test('block-list by extension, or allow-list when one is set', () => {
    const c = cfg({ rules: { attachments: { enabled: true } } });
    assert.equal(evaluateMessage(msg({ attachments: [{ name: 'setup.EXE' }] }), createState(), c)[0].meta.types[0], 'exe');
    assert.deepEqual(evaluateMessage(msg({ attachments: [{ name: 'cat.png' }] }), createState(), c), []);
    const only = cfg({ rules: { attachments: { enabled: true, allowTypes: ['png', 'jpg'] } } });
    assert.deepEqual(evaluateMessage(msg({ attachments: [{ name: 'cat.png' }] }), createState(), only), []);
    assert.deepEqual(evaluateMessage(msg({ attachments: [{ name: 'doc.pdf' }, { name: 'x' }] }), createState(), only)[0].meta.types, ['pdf', '']);
  });
});

describe('anti-selfbot', () => {
  const c = cfg({ rules: { selfbot: { enabled: true, channelsPerWindow: 3, windowSec: 5, identicalAcrossSec: 10, maxPerMinute: 10 }, spam: { enabled: false } } });
  test('the same user in 3 channels within 5 s', () => {
    const s = createState();
    evaluateMessage(msg({ channelId: 'a', content: 'one', at: T0 }), s, c);
    assert.deepEqual(evaluateMessage(msg({ channelId: 'b', content: 'two', at: T0 + 1000 }), s, c), []);
    const [h] = evaluateMessage(msg({ channelId: 'c', content: 'three', at: T0 + 2000 }), s, c);
    assert.equal(h.rule, 'selfbot'); assert.equal(h.meta.kind, 'multichannel'); assert.equal(h.action, 'kick'); assert.equal(h.deleteMessage, true);
  });
  test('the identical message in two channels within 10 s (but not spread over a minute)', () => {
    const s = createState();
    evaluateMessage(msg({ channelId: 'a', content: 'check my profile', at: T0 }), s, c);
    const [h] = evaluateMessage(msg({ channelId: 'b', content: 'check my profile', at: T0 + 8000 }), s, c);
    assert.equal(h?.meta.kind, 'crosspost');
    const s2 = createState();
    evaluateMessage(msg({ channelId: 'a', content: 'check my profile', at: T0 }), s2, c);
    assert.deepEqual(evaluateMessage(msg({ channelId: 'b', content: 'check my profile', at: T0 + 30_000 }), s2, c), []);
  });
  test('beyond-human rate over a minute; a normal chatter is untouched', () => {
    const s = createState();
    let hit = null;
    for (let k = 0; k <= 10; k++) { const r = evaluateMessage(msg({ content: `msg ${k}`, at: T0 + k * 5000 }), s, c); if (r.length) hit = r[0]; }
    assert.equal(hit?.meta.kind, 'rate');
    const s2 = createState();
    for (let k = 0; k < 8; k++) assert.deepEqual(evaluateMessage(msg({ content: `chat ${k}`, at: T0 + k * 7000 }), s2, c), []);
  });
});

describe('several rules at once', () => {
  test('every hit is reported, the strongest is what gets carried out, never stacked', () => {
    const c = cfg({ rules: { mentions: { enabled: true, maxUsers: 1, action: 'warn' }, links: { enabled: true, action: 'ban' }, caps: { enabled: true, minLetters: 4, ratio: 0.5, action: 'delete' } } });
    const hits = evaluateMessage(msg({ content: 'LOOK HERE NOW https://x.com', mentions: { users: 5 } }), createState(), c);
    assert.deepEqual(rulesOf(hits).sort(), ['caps', 'links', 'mentions']);
    assert.equal(strongest(hits).action, 'ban');
    assert.equal(strongest([]), null);
    assert.equal(strongest([{ action: 'lockdown' }]), null, 'lockdown is not a member action');
    assert.ok(ACTIONS.includes('ban'));
  });
});

describe('joins: account age', () => {
  test('younger than minDays → the configured action; quarantine means timeout', () => {
    const c = cfg({ rules: { accountAge: { enabled: true, minDays: 7, action: 'kick' }, raid: { enabled: false } } });
    const fresh = { id: 'n', guildId: 'g1', accountCreatedAt: T0 - 2 * 86_400_000, joinedAt: T0 };
    const old = { id: 'o', guildId: 'g1', accountCreatedAt: T0 - 30 * 86_400_000, joinedAt: T0 };
    assert.equal(evaluateJoin(fresh, createState(), c)[0].action, 'kick');
    assert.deepEqual(evaluateJoin(old, createState(), c), []);
    const q = cfg({ rules: { accountAge: { enabled: true, minDays: 7, action: 'quarantine', timeoutMin: 30 }, raid: { enabled: false } } });
    const [h] = evaluateJoin(fresh, createState(), q);
    assert.equal(h.action, 'timeout'); assert.equal(h.timeoutMin, 30);
    assert.deepEqual(evaluateJoin({ ...fresh, bot: true }, createState(), c), []);
  });
});

describe('raid detection', () => {
  const c = cfg({ rules: { raid: { enabled: true, joins: 3, windowSec: 10, lockdownMin: 5, action: 'timeout', timeoutMin: 20 }, accountAge: { enabled: false } } });
  const join = (n, at) => ({ id: `j${n}`, guildId: 'g1', accountCreatedAt: T0 - 365 * 86_400_000, joinedAt: at });
  test('N joins in M seconds starts the lockdown once; joiners during it get the action', () => {
    const s = createState();
    assert.deepEqual(evaluateJoin(join(1, T0), s, c), []);
    assert.deepEqual(evaluateJoin(join(2, T0 + 1000), s, c), []);
    const third = evaluateJoin(join(3, T0 + 2000), s, c);
    assert.deepEqual(third.map((a) => a.action), ['lockdown', 'timeout']);
    assert.equal(third[0].meta.joins, 3);
    assert.equal(third[0].meta.until, T0 + 2000 + 5 * 60_000);
    assert.equal(third[1].timeoutMin, 20);
    assert.ok(lockdownActive(s, T0 + 3000));
    // The fourth: still in lockdown, no second 'lockdown' action.
    assert.deepEqual(evaluateJoin(join(4, T0 + 3000), s, c).map((a) => a.action), ['timeout']);
  });
  test('the lockdown ends by itself; slow joins never trigger it', () => {
    const s = createState();
    for (let k = 0; k < 3; k++) evaluateJoin(join(k, T0 + k * 100), s, c);
    assert.ok(lockdownActive(s, T0 + 1000));
    assert.equal(lockdownActive(s, T0 + 6 * 60_000), false);
    assert.equal(s.lockdownUntil, 0);
    const s2 = createState();
    for (let k = 0; k < 6; k++) assert.deepEqual(evaluateJoin(join(k, T0 + k * 15_000), s2, c), []);
  });
  test('raid action "log" alerts but touches nobody', () => {
    const s = createState();
    const c2 = cfg({ rules: { raid: { enabled: true, joins: 2, windowSec: 10, action: 'log' }, accountAge: { enabled: false } } });
    evaluateJoin(join(1, T0), s, c2);
    assert.deepEqual(evaluateJoin(join(2, T0 + 10), s, c2).map((a) => a.action), ['lockdown']);
    assert.deepEqual(evaluateJoin(join(3, T0 + 20), s, c2), []);
  });
});

describe('determinism', () => {
  test('the same stream against two fresh states yields the same actions', () => {
    const c = cfg();
    const run = () => { const s = createState(); const out = []; for (let k = 0; k < 12; k++) out.push(...evaluateMessage(msg({ channelId: `c${k % 4}`, content: 'same', at: T0 + k * 300 }), s, c)); return out.map((a) => `${a.rule}:${a.action}:${a.reason}`); };
    assert.deepEqual(run(), run());
    assert.ok(run().length > 0);
  });
});

// The log routing, tag selection, post naming, embed shape and the batching queue — pure.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as ui from '../src/ui.mjs';
import {
  CATEGORIES, CATEGORY_KEYS, GROUPS, ALERT_KINDS, normalizeLogs, resolveRoute, pickTags, wantedForumTags, postNameFor, postSummary,
  embedFor, mergeEvents, LogQueue,
} from '../src/features/logs.mjs';

describe('routing', () => {
  test('every category has a group with a tag name', () => {
    for (const k of CATEGORY_KEYS) assert.ok(GROUPS[CATEGORIES[k].group], k);
    assert.ok(Object.keys(ALERT_KINDS).length >= 6);
  });
  test('nothing configured → off, naming why', () => {
    const r = resolveRoute({}, 'messages.delete');
    assert.equal(r.kind, 'off'); assert.match(r.from, /nothing configured/);
    assert.equal(resolveRoute({ forumId: 'f' }, 'no.such').kind, 'off');
    assert.equal(resolveRoute({ forumId: 'f', enabled: false }, 'automod').from, 'logs disabled');
  });
  test('a forum is the default for every category, tagged with its group', () => {
    const r = resolveRoute({ forumId: 'f1' }, 'members.ban');
    assert.deepEqual(r, { kind: 'forum', id: 'f1', ids: ['f1'], tags: ['Members'], from: 'the log forum' });
  });
  test('the legacy channel: logs.channelId, else the /config channel', () => {
    assert.deepEqual(resolveRoute({ channelId: 'c1' }, 'voice'), { kind: 'channel', id: 'c1', ids: ['c1'], tags: [], from: 'the log channel' });
    assert.equal(resolveRoute({}, 'voice', { legacyChannelId: 'c-legacy' }).id, 'c-legacy');
    assert.equal(resolveRoute({ forumId: 'f1' }, 'voice', { legacyChannelId: 'c-legacy' }).kind, 'forum', 'a forum beats the legacy channel');
  });
  test('routes: exact category > group > defaults; every accepted spelling', () => {
    const cfg = { forumId: 'f1', routes: { messages: 'c-msg', 'messages.edit': { kind: 'off' }, automod: { kind: 'forum', id: 'f2', tags: ['Custom', 'Automod'] }, voice: 'off', bogus: 'c9' } };
    assert.deepEqual(resolveRoute(cfg, 'messages.delete'), { kind: 'channel', id: 'c-msg', ids: ['c-msg'], tags: [], from: 'route for messages' });
    assert.equal(resolveRoute(cfg, 'messages.edit').kind, 'off');
    assert.deepEqual(resolveRoute(cfg, 'automod').tags, ['Custom', 'Automod']);
    assert.equal(resolveRoute(cfg, 'voice').from, 'voice routed off');
    assert.equal(resolveRoute(cfg, 'members.join').from, 'the log forum');
    assert.equal(normalizeLogs(cfg).routes.bogus, undefined, 'an unknown key is dropped');
    assert.equal(normalizeLogs({ routes: { automod: { kind: 'forum' } } }).routes.automod, undefined, 'a route without an id is dropped');
  });
  test('normalisation fills the defaults and bounds the tags', () => {
    const L = normalizeLogs({ forumMode: 'weird', routes: { automod: { kind: 'forum', id: 'f', tags: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] } } });
    assert.equal(L.forumMode, 'category'); assert.equal(L.reaction, ''); assert.equal(L.pinSummary, true); assert.equal(L.enabled, true);
    assert.equal(L.routes.automod.tags.length, 5);
  });
});

describe('forum posts + tags', () => {
  const tags = [{ id: '1', name: 'Messages' }, { id: '2', name: 'members' }, { id: '3', name: 'Automod' }];
  test('tags by name, case-insensitive, unknown skipped, five at most', () => {
    assert.deepEqual(pickTags(tags, ['Members', 'automod', 'Nope']), ['2', '3']);
    assert.deepEqual(pickTags(tags, ['Messages', 'Messages']), ['1']);
    assert.deepEqual(pickTags(undefined, ['x']), []);
    assert.equal(pickTags([1, 2, 3, 4, 5, 6, 7].map((n) => ({ id: String(n), name: `t${n}` })), [1, 2, 3, 4, 5, 6, 7].map((n) => `t${n}`)).length, 5);
  });
  test('the forum wants one tag per group, minus what it already has', () => {
    assert.deepEqual(wantedForumTags(tags).map((t) => t.name), ['Voice', 'Moderation', 'Server', 'Bot', 'Economy']);
    assert.equal(wantedForumTags([]).length, Object.keys(GROUPS).length);
  });
  test('post names: per category, or per day', () => {
    assert.equal(postNameFor('members.ban'), 'Members · Member banned');
    assert.equal(postNameFor('members.ban', 'day', Date.UTC(2026, 8, 15, 12)), 'Logs · 2026-09-15');
    assert.match(postSummary('automod'), /Automod action/);
    assert.match(postSummary('automod', 'day'), /Every log category/);
  });
});

describe('embeds', () => {
  const user = { id: '42', tag: 'alice#0', avatar: 'https://cdn/x.png' };
  test('a deleted message: author, content, ids in the footer, attachments listed', () => {
    const e = embedFor('messages.delete', { user, channelId: 'c1', messageId: 'm1', content: 'bye', attachments: [{ name: 'a.png' }] });
    assert.equal(e.title, 'Message deleted'); assert.equal(e.color, CATEGORIES['messages.delete'].color);
    assert.deepEqual(e.author, { name: 'alice#0', icon_url: 'https://cdn/x.png' });
    assert.match(e.description, /<@42>/); assert.match(e.description, /<#c1>/);
    assert.equal(e.fields.find((f) => f.name === 'Content').value, 'bye');
    assert.equal(e.fields.find((f) => f.name === 'Attachments').value, 'a.png');
    assert.match(e.footer.text, /User 42 · Channel c1 · Message m1/);
    assert.ok(e.timestamp);
  });
  test('an edit carries before/after and a jump link', () => {
    const e = embedFor('messages.edit', { user, guildId: 'g', channelId: 'c', messageId: 'm', before: 'helo', after: 'hello' });
    assert.match(e.fields[0].value, /\*\*Before:\*\* helo\n\*\*After:\*\* hello/);
    assert.match(e.description, /https:\/\/discord\.com\/channels\/g\/c\/m/);
  });
  test('a bulk delete is one embed listing the messages', () => {
    const e = embedFor('messages.bulk', { channelId: 'c', count: 3, messages: [{ user, content: 'a' }, { user, content: 'b' }, { user: null, content: null }] });
    assert.equal(e.title, '3 messages bulk-deleted');
    assert.match(e.fields[0].value, /alice#0: a\nalice#0: b\n\?: \*\(no text\)\*/);
  });
  test('members: kick with actor + reason, roles diff, timeout until, nick diff', () => {
    const k = embedFor('members.kick', { user, actor: { id: '7', tag: 'mod' }, reason: 'spam', memberCount: 99 });
    assert.equal(k.fields.find((f) => f.name === 'Reason').value, 'spam');
    assert.match(k.fields.find((f) => f.name === 'By').value, /<@7>/);
    assert.match(k.footer.text, /99 members · User 42 · By 7/);
    const r = embedFor('members.roles', { user, added: ['r1'], removed: ['r2', 'r3'] });
    assert.equal(r.fields.find((f) => f.name === 'Added').value, '<@&r1>');
    assert.equal(r.fields.find((f) => f.name === 'Removed').value, '<@&r2> <@&r3>');
    const t = embedFor('members.timeout', { user, until: 1_700_000_000_000 });
    assert.equal(t.fields[0].value, '<t:1700000000:f>');
    assert.equal(embedFor('members.timeout', { user, until: null }).fields[0].value, 'lifted');
    assert.match(embedFor('members.nick', { user, before: null, after: 'Al' }).fields[0].value, /\*\(empty\)\*[\s\S]*Al/);
  });
  test('automod: rule, action, why, result — and the raid shape', () => {
    const e = embedFor('automod', { user, rule: 'spam+links', action: 'timeout', reason: 'x', content: 'y', outcome: { timeoutMin: 10 }, deleted: true });
    assert.equal(e.title, 'Automod · spam+links → timeout');
    assert.equal(e.fields.find((f) => f.name === 'Result').value, 'timed out 10 min');
    assert.equal(embedFor('automod', { user, outcome: { warned: 3, triggered: { kind: 'kick' }, recorded: false } }).fields.find((f) => f.name === 'Result').value, 'warning #3 → kick (local — site unreachable)');
    assert.equal(embedFor('automod', { user, outcome: { failed: 'Missing Permissions' } }).fields.find((f) => f.name === 'Result').value, 'Failed: Missing Permissions');
    assert.equal(embedFor('automod', { user, deleted: true, outcome: {} }).fields.find((f) => f.name === 'Result').value, 'message deleted');
    const raid = embedFor('automod', { raid: true, action: 'lockdown', reason: '12 joins in 30s', until: 1_700_000_000_000 });
    // No icon mapped → the plain title; with the icon set loaded, the lock glyph leads.
    assert.equal(raid.title, 'Raid lockdown'); assert.match(raid.description, /12 joins[\s\S]*<t:1700000000:f>/);
    ui.setAutoIcons({ lock: '<:bc_lock_deadbeef:123456789012345678>' });
    assert.equal(embedFor('automod', { raid: true, action: 'lockdown', reason: 'x' }).title, '<:bc_lock_deadbeef:123456789012345678> Raid lockdown');
    ui.setAutoIcons({});
  });
  test('server changes list every diff; voice says join/leave/move; unknown categories degrade', () => {
    const s = embedFor('server.roles', { kind: 'updated', name: 'Mods', targetId: 'r1', changes: [{ key: 'name', before: 'Mod', after: 'Mods' }, { key: 'permissions', before: '', after: '+BanMembers' }], actor: { id: '7', tag: 'admin' } });
    assert.equal(s.title, 'Role changed · updated'); assert.equal(s.fields.length, 3);
    assert.equal(embedFor('voice', { user, kind: 'move', from: 'a', to: 'b' }).title, 'Moved voice channel');
    const u = embedFor('bot.errors', { title: 'Handler error', message: 'boom', context: { command: '/x' } });
    assert.equal(u.title, 'Handler error'); assert.equal(u.description, 'boom');
    assert.equal(u.author, undefined);
    assert.equal(embedFor('economy.shop', { user, kind: 'purchase', detail: 'bought X', delta: -10, balance: 5 }).fields[0].value, '-10 → 5');
  });
  test('text is clipped to Discord limits', () => {
    const e = embedFor('messages.delete', { user, content: 'x'.repeat(5000) });
    assert.equal(e.fields[0].value.length, 1000);
  });
});

describe('merging', () => {
  test('ten or fewer → one embed each; more → nine + a summary of the rest', () => {
    const ev = (n) => Array.from({ length: n }, (_, k) => ({ user: { id: String(k), tag: `u${k}` }, content: `m${k}` }));
    assert.equal(mergeEvents('messages.delete', ev(10)).length, 10);
    const m = mergeEvents('messages.delete', ev(25));
    assert.equal(m.length, 10);
    assert.match(m[9].title, /16 more message deleted events/);
    assert.match(m[9].description, /u9 m9/);
  });
});

describe('queue', () => {
  const harness = () => {
    let now = 1_000_000;
    const sent = [], timers = [];
    const q = new LogQueue({ send: (dest, payload) => { sent.push({ dest, payload, at: now }); }, now: () => now, schedule: (fn, ms) => { const t = { fn, at: now + ms }; timers.push(t); return t; } });
    const advance = (ms) => { now += ms; for (const t of timers.splice(0).sort((a, b) => a.at - b.at)) { if (t.at <= now) t.fn(); else timers.push(t); } };
    return { q, sent, timers, advance, now: () => now };
  };
  test('one event sends at once (nothing sent before on that destination)', () => {
    const { q, sent, timers, advance } = harness();
    q.push('c:1', { category: 'automod', ev: { user: { id: '1', tag: 'a' } } });
    assert.equal(sent.length, 0); assert.equal(timers.length, 1); assert.equal(timers[0].at, 1_000_000, 'first send is immediate');
    advance(0);
    assert.equal(sent.length, 1); assert.equal(sent[0].payload.embeds.length, 1);
  });
  test('at most one message per second per destination; a burst above five is merged', () => {
    const { q, sent, advance } = harness();
    for (let k = 0; k < 3; k++) q.push('c:1', { category: 'messages.delete', ev: { content: `a${k}` } });
    advance(0);
    assert.equal(sent.length, 3, 'three separate messages — under the merge threshold');
    // Eight more arrive within the same second: one merged message, one second later.
    for (let k = 0; k < 8; k++) q.push('c:1', { category: 'messages.delete', ev: { content: `b${k}` } });
    advance(500);
    assert.equal(sent.length, 3, 'nothing yet — the second has not passed');
    advance(500);
    assert.equal(sent.length, 4);
    assert.equal(sent[3].payload.embeds.length, 8);
    assert.equal(sent[3].at - sent[2].at, 1000);
  });
  test('destinations are independent; categories stay separate messages when merged', () => {
    const { q, sent, advance } = harness();
    for (let k = 0; k < 4; k++) q.push('c:1', { category: 'members.join', ev: { user: { id: String(k) } } });
    for (let k = 0; k < 3; k++) q.push('c:1', { category: 'members.leave', ev: { user: { id: String(k) } } });
    q.push('t:9', { category: 'voice', ev: { user: { id: 'v' }, kind: 'join' } });
    advance(0);
    const c1 = sent.filter((s) => s.dest === 'c:1'), t9 = sent.filter((s) => s.dest === 't:9');
    assert.equal(c1.length, 2, 'seven pending > five → merged per category');
    assert.deepEqual(c1.map((s) => s.payload.embeds.length).sort(), [3, 4]);
    assert.equal(t9.length, 1);
  });
  test('a raw payload (an admin alert card) passes through untouched', () => {
    const { q, sent, advance } = harness();
    const card = { components: [], flags: 1 << 15 };
    q.push('t:1', { payload: card });
    advance(0);
    assert.equal(sent[0].payload, card);
  });
  test('a flood is bounded and a failing sender does not stop the queue', () => {
    let now = 5000; let calls = 0;
    const q = new LogQueue({ send: () => { calls++; throw new Error('nope'); }, now: () => now, schedule: () => null });
    for (let k = 0; k < 300; k++) q.push('c:1', { category: 'voice', ev: {} });
    assert.equal(q.pending('c:1'), 200); assert.equal(q.dropped, 100);
    q.flush('c:1');
    assert.equal(calls, 1); assert.equal(q.pending('c:1'), 0);
    q.push('c:1', { category: 'voice', ev: {} });
    now = 5999; assert.deepEqual(q.flush('c:1'), [], 'too soon');
    now = 6000; assert.equal(q.flush('c:1').length, 1);
  });
});

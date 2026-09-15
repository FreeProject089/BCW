// The live-table registry, without Discord: codes, visibility, mirrors, expiry.
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  CODE_ALPHABET, CODE_LENGTH, createLobby, findByCode, normalizeCode, newCode, canJoin, listVisible,
  addMirror, mirrorOf, setState, setVisibility, sweep, count, removeLobby, MAX_MIRRORS, _reset,
} from '../src/features/casino-lobbies.mjs';

beforeEach(() => _reset());

describe('codes', () => {
  test('six characters from an alphabet with no look-alikes', () => {
    assert.equal(CODE_LENGTH, 6);
    for (const bad of ['0', 'O', '1', 'I']) assert.ok(!CODE_ALPHABET.includes(bad), `alphabet has ${bad}`);
    for (let i = 0; i < 200; i++) { const c = newCode(); assert.equal(c.length, 6); assert.ok([...c].every((ch) => CODE_ALPHABET.includes(ch)), c); }
  });
  test('unique among open tables, and a table is found by its code however it was typed', () => {
    const seen = new Set();
    for (let i = 0; i < 300; i++) { const L = createLobby({ game: 'pot', hostId: 'h', hostName: 'H', guildId: 'g1', channelId: `c${i}` }); assert.ok(!seen.has(L.code)); seen.add(L.code); }
    assert.equal(count(), 300);
    const L = createLobby({ game: 'crash', hostId: 'h', hostName: 'H', guildId: 'g1', channelId: 'c' });
    assert.equal(findByCode(L.code), L);
    assert.equal(findByCode(L.code.toLowerCase()), L);
    assert.equal(findByCode(` ${L.code.slice(0, 3)}-${L.code.slice(3)} `), L);
    assert.equal(findByCode('ZZZZZZ'), null);
    assert.equal(normalizeCode('ab c-d1'), 'ABCD1');
  });
  test('a colliding draw is retried, never reused', () => {
    // A random source that always returns the same code first: the second table must differ.
    let calls = 0;
    const fixed = () => { calls++; return calls <= CODE_LENGTH * 2 ? 0 : Math.random(); };
    const a = createLobby({ game: 'pot', hostId: 'h', hostName: 'H', guildId: 'g', channelId: 'c' }, { random: fixed });
    const b = createLobby({ game: 'pot', hostId: 'h', hostName: 'H', guildId: 'g', channelId: 'c' }, { random: fixed });
    assert.equal(a.code, 'AAAAAA');
    assert.notEqual(b.code, a.code);
  });
  test('a removed table frees its code', () => {
    const L = createLobby({ game: 'pot', hostId: 'h', hostName: 'H', guildId: 'g', channelId: 'c' });
    assert.ok(removeLobby(L.id));
    assert.equal(findByCode(L.code), null);
  });
});

describe('visibility', () => {
  const mk = (visibility, guildId = 'g1') => createLobby({ game: 'race', hostId: 'h', hostName: 'H', guildId, channelId: 'c', visibility });
  test('public: joinable from anywhere, listed everywhere', () => {
    const L = mk('public');
    assert.deepEqual(canJoin(L, { guildId: 'g1' }), { ok: true });
    assert.deepEqual(canJoin(L, { guildId: 'g2' }), { ok: true });
    assert.deepEqual(canJoin(L, { guildId: null }), { ok: true });
    assert.deepEqual(listVisible({ guildId: 'g2' }).map((x) => x.id), [L.id]);
    assert.deepEqual(listVisible({ guildId: null }).map((x) => x.id), [L.id]);
  });
  test('server: only its own server may join, and only there is it listed', () => {
    const L = mk('server');
    assert.deepEqual(canJoin(L, { guildId: 'g1' }), { ok: true });
    assert.equal(canJoin(L, { guildId: 'g2' }).why, 'serverOnly');
    assert.equal(canJoin(L, { guildId: null }).why, 'serverOnly');
    assert.equal(listVisible({ guildId: 'g1' }).length, 1);
    assert.equal(listVisible({ guildId: 'g2' }).length, 0);
    assert.equal(listVisible({ guildId: null }).length, 0);
  });
  test('private: code only, listed nowhere', () => {
    const L = mk('private');
    assert.deepEqual(canJoin(L, { guildId: 'g2' }), { ok: true });
    assert.equal(listVisible({ guildId: 'g1' }).length, 0);
    assert.equal(findByCode(L.code), L);
  });
  test('the default is server; junk is server; a DM table cannot be "server"', () => {
    assert.equal(mk(undefined).visibility, 'server');
    assert.equal(mk('everyone').visibility, 'server');
    assert.equal(mk('server', null).visibility, 'private');
    const L = mk('public', null); assert.equal(setVisibility(L, 'server'), 'private');
    assert.equal(setVisibility(mk('public'), 'private'), 'private');
  });
  test('a table that is not open refuses everybody, listed or not', () => {
    const L = mk('public');
    setState(L, 'running');
    assert.equal(canJoin(L, { guildId: 'g1' }).why, 'notOpen');
    assert.equal(listVisible({ guildId: 'g1' }).length, 0);
    assert.equal(canJoin(null, {}).why, 'gone');
  });
});

describe('mirrors', () => {
  test('the home channel is the first mirror; foreign channels are added once each', () => {
    const L = createLobby({ game: 'pot', hostId: 'h', hostName: 'H', guildId: 'g1', channelId: 'home' });
    assert.equal(L.mirrors.length, 1); assert.ok(L.mirrors[0].home);
    const m = addMirror(L, { channelId: 'far', guildId: 'g2' });
    assert.equal(addMirror(L, { channelId: 'far', guildId: 'g2' }), m);
    assert.equal(L.mirrors.length, 2);
    assert.equal(mirrorOf(L, 'far'), m); assert.equal(mirrorOf(L, 'nope'), null);
  });
  test('capped', () => {
    const L = createLobby({ game: 'pot', hostId: 'h', hostName: 'H', guildId: 'g1', channelId: 'home' });
    for (let i = 0; i < MAX_MIRRORS + 3; i++) addMirror(L, { channelId: `c${i}` });
    assert.equal(L.mirrors.length, MAX_MIRRORS);
    assert.equal(addMirror(L, { channelId: 'one-more' }), null);
  });
});

describe('expiry', () => {
  test('idle open and finished tables are swept; a running one never', () => {
    const t0 = 1_000_000;
    const idle = createLobby({ game: 'pot', hostId: 'h', hostName: 'H', guildId: 'g', channelId: 'a' }, { now: t0 });
    const fresh = createLobby({ game: 'pot', hostId: 'h', hostName: 'H', guildId: 'g', channelId: 'b' }, { now: t0 + 9 * 60_000 });
    const running = createLobby({ game: 'pot', hostId: 'h', hostName: 'H', guildId: 'g', channelId: 'c' }, { now: t0 });
    setState(running, 'running', t0);
    const done = createLobby({ game: 'pot', hostId: 'h', hostName: 'H', guildId: 'g', channelId: 'd' }, { now: t0 });
    setState(done, 'done', t0);
    const gone = sweep(t0 + 10 * 60_000 + 1);
    assert.deepEqual(gone.map((x) => x.id).sort(), [idle.id, done.id].sort());
    assert.equal(count(), 2);
    assert.equal(findByCode(idle.code), null);
    assert.equal(findByCode(fresh.code), fresh);
    assert.equal(findByCode(running.code), running);
  });
});

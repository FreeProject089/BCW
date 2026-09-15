// casino-lobbies.mjs — the registry of live tables: codes, visibility, mirrors, expiry.
//
// No Discord in here, on purpose: this is the part of the live casino a plain node test can
// exercise. casino-live.mjs owns the rounds and the cards and calls in for everything that is
// "which tables exist and who may sit at them".
//
//   · every table gets a 6-character CODE from an alphabet with no look-alikes (no 0/O, 1/I),
//     unique among the open tables; `/casino join <code>` finds it from ANY server or DM;
//   · VISIBILITY, chosen at creation:
//       public   listed in `/casino lobbies` everywhere, joinable by code from anywhere;
//       server   only members of the creating server may join; listed only there;
//       private  code only, unlisted (a link you hand to friends);
//   · MIRRORS: the table's card exists once per channel that is watching it — the home
//     channel and one per foreign channel a player joined from. The registry only keeps the
//     channel/message ids; the caller edits them;
//   · EXPIRY: an open table nobody touched for IDLE_MS, or a finished one, is swept away.
//     A RUNNING table is never swept — a round half-played cannot be settled honestly.

export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 6;
export const VISIBILITIES = ['public', 'server', 'private'];
export const IDLE_MS = 10 * 60_000;
export const MAX_MIRRORS = 12;

const lobbies = new Map();   // id → lobby
const byCode = new Map();    // code → id

const rnd = () => Math.random();

/** A fresh code — six characters, unambiguous, unused by any open table. */
export function newCode(random = rnd) {
  for (let tries = 0; tries < 1000; tries++) {
    let c = '';
    for (let i = 0; i < CODE_LENGTH; i++) c += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length) % CODE_ALPHABET.length];
    if (!byCode.has(c)) return c;
  }
  throw new Error('no free code');
}

/** What a user typed, made comparable: upper-case, separators dropped, six characters. The
 *  alphabet has no 0/O/1/I, so a look-alike typed by mistake simply matches nothing. */
export function normalizeCode(input) {
  return String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH);
}

/**
 * Register a table. `fields` is whatever the caller keeps on it (game, host, players…);
 * the registry adds id, code, visibility, guildId, mirrors, state and the touch time.
 */
export function createLobby({ game, hostId, hostName, guildId = null, channelId, visibility = 'server', ...fields }, { now = Date.now(), random = rnd } = {}) {
  const vis = VISIBILITIES.includes(visibility) ? visibility : 'server';
  // A DM has no server: "server" visibility there means "private" (nobody else can be a member).
  const code = newCode(random);
  const id = code.toLowerCase();
  const L = {
    id, code, game, hostId, hostName, guildId: guildId || null, channelId,
    visibility: !guildId && vis === 'server' ? 'private' : vis,
    mirrors: [{ channelId, guildId: guildId || null, messageId: null, home: true }],
    state: 'open', touched: now, createdAt: now,
    ...fields,
  };
  lobbies.set(id, L); byCode.set(code, id);
  return L;
}

export const getLobby = (id) => lobbies.get(String(id || '').toLowerCase()) || null;
export function findByCode(input) {
  const code = normalizeCode(input);
  const id = byCode.get(code);
  return id ? lobbies.get(id) || null : null;
}
export function touch(L, now = Date.now()) { L.touched = now; }
export function setState(L, state, now = Date.now()) { L.state = state; L.touched = now; }
export function setVisibility(L, visibility) { if (VISIBILITIES.includes(visibility)) L.visibility = !L.guildId && visibility === 'server' ? 'private' : visibility; return L.visibility; }

/**
 * May somebody in `guildId` (null for a DM) join table L? Returns { ok } or { ok:false, why }
 * with `why` one of: gone · notOpen · serverOnly.
 */
export function canJoin(L, { guildId = null } = {}) {
  if (!L) return { ok: false, why: 'gone' };
  if (L.state !== 'open') return { ok: false, why: 'notOpen' };
  if (L.visibility === 'server' && (!guildId || guildId !== L.guildId)) return { ok: false, why: 'serverOnly' };
  return { ok: true };
}

/** The open tables somebody in `guildId` should see listed: public ones everywhere, server ones there. */
export function listVisible({ guildId = null } = {}, now = Date.now()) {
  return [...lobbies.values()]
    .filter((L) => L.state === 'open' && (L.visibility === 'public' || (L.visibility === 'server' && guildId && L.guildId === guildId)))
    .sort((a, b) => b.touched - a.touched);
}

/** Add a channel as a mirror of L (idempotent). Returns the mirror, or null when full. */
export function addMirror(L, { channelId, guildId = null }) {
  const have = L.mirrors.find((m) => m.channelId === channelId);
  if (have) return have;
  if (L.mirrors.length >= MAX_MIRRORS) return null;
  const m = { channelId, guildId: guildId || null, messageId: null, home: false };
  L.mirrors.push(m);
  return m;
}
export const mirrorOf = (L, channelId) => L.mirrors.find((m) => m.channelId === channelId) || null;

/** Forget one table. */
export function removeLobby(id) {
  const L = lobbies.get(id);
  if (!L) return false;
  lobbies.delete(id); byCode.delete(L.code);
  return true;
}

/**
 * Sweep: drop open/finished tables idle for longer than `idleMs`; never a running one.
 * Returns the tables dropped so the caller can close their cards.
 */
export function sweep(now = Date.now(), idleMs = IDLE_MS) {
  const gone = [];
  for (const [id, L] of lobbies) {
    if (L.state === 'running') continue;
    if (now - L.touched > idleMs) { removeLobby(id); gone.push(L); }
  }
  return gone;
}

export const count = () => lobbies.size;
/** Tests only: start from nothing. */
export function _reset() { lobbies.clear(); byCode.clear(); }

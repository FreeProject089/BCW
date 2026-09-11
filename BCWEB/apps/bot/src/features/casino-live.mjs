// casino-live.mjs — tables several members sit at, in the channel, in real time.
//
// The single-player casino is a private exchange: you bet, the bot rolls, the ledger settles,
// a card appears. These are the OTHER kind: a public message everybody can join, a round that
// plays out in edits to that message while the players watch, and one settlement for the
// whole table. Three games only exist this way, and the classic four can be played this way
// too:
//
//   crash  a multiplier climbs from 1.00×; every player has a Cash out button; whoever pressed
//          it before the break keeps the multiplier they left at, the rest lose the stake. A
//          target set on joining cashes out for you. One player is enough.
//   race   six cars, each player picks one, the winner pays 6×. One player is enough.
//   pot    everyone stakes what they like; ONE winner takes it all, drawn in proportion to
//          stake — the more you put in, the likelier it is you. Two players minimum, no
//          maximum. This is the "custom" game that was asked for.
//   multi  the classic games — coin, dice, roulette, wheel — on ONE shared roll, each player
//          settled against the house on their own pick.
//
// Everything a table needs is in memory here (a Map of lobbies keyed by a short id) and in the
// custom ids on its buttons; a bot restart forgets open tables, which is the right failure — a
// round half-played across a restart cannot be settled honestly, and nothing was debited
// before the settlement, so nobody loses anything.
//
// RANDOMNESS is drawn here, on the bot, like the single-player games; the API is the ledger.
// The two new distributions (crash point, pot winner) are the pure functions the API's own
// tests pin — duplicated here as the same four lines rather than imported, because the bot is
// a separate package with no path to the API's source. Keep them in step with
// apps/api/src/lib/casino-rules.mjs.
import { ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from 'discord.js';
import * as ui from '../ui.mjs';
import { api } from '../api.mjs';
import { config } from '../config.mjs';
import { tr, makeT } from '../i18n.mjs';

export const LIVE_GAMES = ['crash', 'race', 'pot'];
export const MULTI_GAMES = ['coinflip', 'dice', 'roulette', 'wheel'];

const JOIN_MS = 45_000;          // the join window before an auto-start (when enough players)
const IDLE_MS = 10 * 60_000;     // a finished or abandoned table is forgotten after this
const MAX_PLAYERS = 25;          // Discord's own ceiling on what fits in one card comfortably
const CARS = ['🔴', '🔵', '🟢', '🟡', '🟣', '🟠'];
const TRACK = 12;

const n = (x) => Number(x || 0).toLocaleString('en-US');
const curLabel = (c) => c?.emoji || c?.name || 'points';
const rnd = () => Math.random();

// ── the arithmetic, mirrored from casino-rules.mjs ───────────────────────────────────
function limits(casino = {}) {
  const min = Math.max(1, Math.floor(Number(casino.minBet) || 1));
  const raw = Number(casino.maxBet);
  const max = Number.isFinite(raw) && raw > 0 ? Math.max(min, Math.floor(raw)) : Infinity;
  return { min, max };
}
function edgePct(casino = {}, game) {
  const per = casino.edgeByGame && casino.edgeByGame[game];
  const v = per !== '' && per != null && Number.isFinite(Number(per)) ? Number(per) : Number(casino.houseEdgePct);
  return Math.min(100, Math.max(0, Number.isFinite(v) ? v : 0));
}
function crashPoint(u, pct, instant = 0.01) {
  const e = Math.min(0.99, Math.max(0, pct / 100));
  const x = Math.min(0.999999, Math.max(0, u));
  if (x < instant) return 1;
  return Math.max(1, Math.floor(((1 - e) / (1 - x)) * 100) / 100);
}
function potWinner(stakes, u) {
  const total = stakes.reduce((a, b) => a + b, 0);
  if (!total) return -1;
  let r = Math.min(0.999999, Math.max(0, u)) * total;
  for (let i = 0; i < stakes.length; i++) { if (r < stakes[i]) return i; r -= stakes[i]; }
  return stakes.length - 1;
}

// ── lobbies ──────────────────────────────────────────────────────────────────────────
const lobbies = new Map();
const newId = () => `${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 5)}`;

function sweep() {
  const now = Date.now();
  for (const [id, L] of lobbies) if (now - L.touched > IDLE_MS && L.state !== 'running') { clearTimeout(L.timer); lobbies.delete(id); }
}
setInterval(sweep, 60_000).unref?.();

async function liveConfig() {
  const cfg = await config();
  const casino = cfg.economy?.casino || {};
  const live = { multi: true, crash: true, race: true, pot: true, ...(casino.live || {}) };
  return { cfg, casino, live, enabled: casino.enabled !== false, currency: cfg.economy?.currency };
}

const minPlayers = (game) => (game === 'pot' ? 2 : 1);
const isMulti = (game) => MULTI_GAMES.includes(game);
const gameKey = (game) => (isMulti(game) ? 'multi' : game);

/** What the card calls a player. */
const nameOf = (i) => (i.member?.displayName || i.user.globalName || i.user.username || 'player').slice(0, 24);

/** The pick, as words, for a card line. */
function pickLabel(t, game, pick) {
  if (pick == null || pick === '') return '';
  if (game === 'race') return `${CARS[pick] || ''} ${t(`live.race.car.${pick}`)}`;
  if (game === 'coinflip') return pick === 'tails' ? t('live.pick.tails') : t('live.pick.heads');
  if (game === 'roulette') return t(`live.pick.${pick}`);
  if (game === 'wheel') return `${pick}×`;
  return '';
}

/** The pick buttons a game offers, or none. */
function pickButtons(t, L) {
  const S = (pick) => `cl:pick:${L.id}:${pick}`;
  if (L.game === 'race') return CARS.map((c, i) => ui.btn(S(i), `${c} ${t(`live.race.car.${i}`)}`, ButtonStyle.Secondary));
  if (L.game === 'coinflip') return [ui.btn(S('heads'), t('live.pick.heads'), ButtonStyle.Secondary), ui.btn(S('tails'), t('live.pick.tails'), ButtonStyle.Secondary)];
  if (L.game === 'roulette') return [ui.btn(S('red'), t('live.pick.red'), ButtonStyle.Secondary), ui.btn(S('black'), t('live.pick.black'), ButtonStyle.Secondary), ui.btn(S('green'), t('live.pick.green'), ButtonStyle.Secondary)];
  if (L.game === 'wheel') return [2, 3, 5, 10, 20, 50].map((m) => ui.btn(S(m), `${m}×`, ButtonStyle.Secondary));
  return [];
}
const needsPick = (game) => ['race', 'coinflip', 'roulette', 'wheel'].includes(game);

// ── cards ────────────────────────────────────────────────────────────────────────────
function playersBlock(t, L, cur) {
  const rows = [...L.players.values()].map((p) => {
    const pk = pickLabel(t, L.game, p.pick);
    const extra = L.game === 'crash' && p.target ? ` · ${t('live.crash.target', { m: p.target.toFixed(2) })}` : '';
    return `• **${p.name}** — ${n(p.bet)} ${cur}${pk ? ` · ${pk}` : ''}${extra}`;
  });
  return rows.length ? rows.join('\n') : t('live.nobody');
}

function lobbyCard(t, L, cur) {
  const need = minPlayers(L.game);
  const have = L.players.size;
  const secs = Math.max(0, Math.round((L.startAt - Date.now()) / 1000));
  const status = have >= need ? t('live.startsIn', { s: secs, n: need }) : t('live.waiting', { n: need - have });
  const buttons = [
    ui.btn(`cl:join:${L.id}`, t('live.join'), ButtonStyle.Primary, { emoji: 'casino' }),
    ...pickButtons(t, L),
    ui.btn(`cl:start:${L.id}`, t('live.start'), ButtonStyle.Success, { disabled: have < need }),
    ui.btn(`cl:leave:${L.id}`, t('live.leave'), ButtonStyle.Secondary),
    ui.btn(`cl:cancel:${L.id}`, t('live.cancel'), ButtonStyle.Danger),
  ];
  return {
    title: `${ui.ic(L.game) || '🎮'} ${t(`live.title.${gameKey(L.game)}`, { g: t(`game.${L.game}`) })}`,
    color: ui.BRAND,
    body: [t(`live.rules.${gameKey(L.game)}`), ...(L.game !== 'crash' ? [t('live.rules.pot2')] : []), '', `### ${t('live.players', { n: have })}`, playersBlock(t, L, cur), '', status],
    footer: t('live.footer', { u: L.hostName }),
    buttons,
  };
}

function runningCard(t, L, cur, lines, { cash = false } = {}) {
  return {
    title: `${ui.ic(L.game) || '🎮'} ${t(`live.title.${gameKey(L.game)}`, { g: t(`game.${L.game}`) })}`,
    color: 0x6b7280,
    body: lines,
    buttons: cash ? [ui.btn(`cl:cash:${L.id}`, t('live.cash'), ButtonStyle.Success, { emoji: 'wallet' })] : [],
  };
}

function resultCard(t, L, cur, lines, results, gif) {
  const files = gif ? [ui.attach(gif, 'table.gif')] : [];
  const res = results.map((r) => {
    const p = L.players.get(r.discordId);
    const name = p?.name || r.discordId;
    if (!r.ok) return t('live.res.skip', { u: name });
    return r.delta > 0 ? t('live.res.win', { u: name, n: n(r.delta) }) : r.delta === 0 ? t('live.res.push', { u: name }) : t('live.res.lose', { u: name, n: n(-r.delta) });
  });
  return {
    title: `${ui.ic(L.game) || '🎮'} ${t(`live.title.${gameKey(L.game)}`, { g: t(`game.${L.game}`) })}`,
    color: 0x6b7280,
    body: [...lines, '', `### ${t('live.res.title')}`, ...res],
    image: gif ? 'attachment://table.gif' : null, files,
    buttons: [ui.btn(`cl:new:${L.game}`, t('live.again'), ButtonStyle.Primary, { emoji: 'again' }), ui.btn('eco:level', t('btn.balance'), ButtonStyle.Secondary, { emoji: 'level' })],
  };
}

async function redraw(L, opts) {
  try { await L.msg.edit(ui.card(opts)); } catch (e) { console.warn('[casino-live] edit failed:', e.message); }
}

// ── opening a table ──────────────────────────────────────────────────────────────────
/**
 * Open a table in the channel. `bet`/`pick`/`target` seat the host straight away when given
 * (a /casino with a bet); otherwise they join like anybody else.
 */
export async function openLive(i, game, { bet = 0, pick = null, target = null } = {}) {
  const { t, lang } = await tr(i);
  const { casino, live, enabled, currency } = await liveConfig();
  const cur = curLabel(currency);
  if (!enabled) return ui.line(i, t('cas.off'), { title: `${ui.ic('casino')} ${t('cas.title')}` });
  if (live[gameKey(game)] === false) return ui.line(i, t('live.off'), { title: `${ui.ic('casino')} ${t('cas.title')}` });
  if (!i.channel) return ui.line(i, t('live.channelOnly'));

  const L = {
    id: newId(), game, hostId: i.user.id, hostName: nameOf(i), channelId: i.channelId,
    players: new Map(), state: 'open', touched: Date.now(), startAt: Date.now() + JOIN_MS,
    lang, t: makeT(lang, (await config()).i18n), cur, timer: null, msg: null,
  };
  lobbies.set(L.id, L);
  // The host's own seat, when the command carried a bet. Refusals are ephemeral and the table
  // still opens: a host who typed a bet over the cap should not lose the table for it.
  let seatNote = '';
  if (bet > 0) {
    const r = await seat(L, i, { bet, pick, target });
    if (!r.ok) seatNote = r.why;
  }
  const opts = lobbyCard(L.t, L, cur);
  const sent = await i.reply({ ...ui.card(opts), fetchReply: true }).catch(() => null);
  if (!sent) { lobbies.delete(L.id); return; }
  L.msg = sent;
  if (seatNote) await i.followUp({ content: seatNote, ephemeral: true }).catch(() => {});
  scheduleStart(L);
}

/** Seat a player: limits, link, balance, pick. Returns { ok } or { ok:false, why }. */
async function seat(L, i, { bet, pick = null, target = null }) {
  const { t } = await tr(i);
  const { casino } = await liveConfig();
  const { min, max } = limits(casino);
  const b = Math.floor(Number(bet) || 0);
  if (L.state !== 'open') return { ok: false, why: t('live.notOpen') };
  if (L.players.size >= MAX_PLAYERS && !L.players.has(i.user.id)) return { ok: false, why: t('live.full') };
  if (b < min || b > max) return { ok: false, why: t('live.betRange', { a: n(min), b: Number.isFinite(max) ? n(max) : t('live.noCap') }) };
  const e = await api.economyUser(i.user.id);
  if (!e.linked) return { ok: false, why: t('cas.linkFirst') };
  if ((Number(e.points) || 0) < b) return { ok: false, why: t('cas.onlyHave', { n: n(e.points || 0), cur: L.cur }) };
  const prev = L.players.get(i.user.id);
  L.players.set(i.user.id, { name: nameOf(i), bet: b, pick: pick ?? prev?.pick ?? null, target: target || prev?.target || null, cashed: null });
  L.touched = Date.now();
  return { ok: true };
}

function scheduleStart(L) {
  clearTimeout(L.timer);
  L.timer = setTimeout(() => {
    if (L.state !== 'open') return;
    if (L.players.size >= minPlayers(L.game) && [...L.players.values()].every((p) => !needsPick(L.game) || p.pick != null)) { void start(L); return; }
    // Not enough people, or somebody has not picked: one more window, then close.
    if (Date.now() - L.touched > JOIN_MS * 2) { void closeIdle(L); return; }
    L.startAt = Date.now() + JOIN_MS;
    void redraw(L, lobbyCard(L.t, L, L.cur));
    scheduleStart(L);
  }, Math.max(1000, L.startAt - Date.now()));
}

async function closeIdle(L) {
  L.state = 'done';
  await redraw(L, { title: `${ui.ic(L.game) || '🎮'} ${L.t(`live.title.${gameKey(L.game)}`, { g: L.t(`game.${L.game}`) })}`, color: 0x6b7280, body: L.t('live.expired'), buttons: [ui.btn(`cl:new:${L.game}`, L.t('live.again'), ButtonStyle.Primary, { emoji: 'again' })] });
}

// ── the rounds ───────────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function start(L) {
  if (L.state !== 'open') return;
  clearTimeout(L.timer);
  L.state = 'running'; L.touched = Date.now();
  try {
    if (L.game === 'crash') await runCrash(L);
    else if (L.game === 'race') await runRace(L);
    else if (L.game === 'pot') await runPot(L);
    else await runMulti(L);
  } catch (e) {
    console.warn('[casino-live] round failed:', e);
    L.state = 'done';
    await redraw(L, { title: L.t('cas.title'), color: ui.BAD, body: L.t('live.failed') });
  }
}

/** Settle every seat with the API and draw the result card. */
async function finish(L, plays, lines, gifPath) {
  L.state = 'done'; L.touched = Date.now();
  // Two or more seats and it is a POT: the losers' stakes go to the winners, split by stake
  // (times the game's multiplier where it has one), every winner keeping their own stake, the
  // house taking its edge on the winners' share only. Alone at the table you play the house,
  // as before. Crash is the exception either way: everybody cashes out on their own clock, so
  // there is no roll the seats share.
  const pot = L.players.size >= 2 && L.game !== 'crash';
  const r = await api.economySettle(L.game, plays, pot);
  const results = r?.ok ? r.results : plays.map((p) => ({ discordId: p.discordId, ok: false }));
  const potLine = pot && r?.ok ? [L.t('live.potline', { n: n(r.pot || 0), cur: L.cur })] : [];
  const gif = gifPath ? await api.siteImage(gifPath) : null;
  await redraw(L, resultCard(L.t, L, L.cur, [...lines, ...potLine], results, gif));
}

async function runCrash(L) {
  const { casino } = await liveConfig();
  const crashAt = crashPoint(rnd(), edgePct(casino, 'crash'));
  const t = L.t;
  let k = 0, m = 1;
  const stateLines = () => {
    const rows = [...L.players.values()].map((p) => `• **${p.name}** — ${n(p.bet)} ${L.cur} · ${p.cashed ? t('live.crash.out', { m: p.cashed.toFixed(2) }) : t('live.crash.in')}`);
    return rows;
  };
  await redraw(L, runningCard(t, L, L.cur, [t('live.crash.go'), '', ...stateLines()], { cash: true }));
  // Climb: m(k) = e^(0.0935·k) per 1.1 s tick — 2× around 8 s, 5× around 19 s, 10× at 27 s.
  while (true) {
    await sleep(1100);
    k++;
    m = Math.floor(100 * Math.exp(0.0935 * k)) / 100;
    if (m >= crashAt) break;
    // What a Cash out press is worth: the number on screen at that moment.
    L.shown = m;
    // Targets cash out for their owner as the curve passes them.
    for (const p of L.players.values()) if (!p.cashed && p.target && m >= p.target) p.cashed = p.target;
    const everyoneOut = [...L.players.values()].every((p) => p.cashed);
    await redraw(L, runningCard(t, L, L.cur, [t('live.crash.now', { m: m.toFixed(2) }), '', ...stateLines()], { cash: !everyoneOut }));
    if (everyoneOut) { await sleep(900); }
  }
  m = crashAt;
  const plays = [...L.players.entries()].map(([id, p]) => ({ discordId: id, bet: p.bet, multiplier: p.cashed || 0, note: p.cashed ? `out@${p.cashed.toFixed(2)}` : `crash@${crashAt.toFixed(2)}` }));
  const cashes = [...L.players.values()].filter((p) => p.cashed).map((p) => p.cashed.toFixed(2)).slice(0, 8).join(',');
  const won = plays.some((p) => p.multiplier > 1);
  const total = plays.reduce((a, p) => a + (p.multiplier ? Math.round(p.bet * p.multiplier - p.bet) : -p.bet), 0);
  const gifPath = `/og/casino/crash/${won ? 'win' : 'lose'}.gif?d=${encodeURIComponent(`${crashAt}|${cashes}`)}&a=${encodeURIComponent(n(Math.abs(total)))}&s=${Math.floor(rnd() * 4294967295)}`;
  await finish(L, plays, [t('live.crash.crashed', { m: crashAt.toFixed(2) }), '', ...stateLines()], gifPath);
}

async function runRace(L) {
  const t = L.t;
  const winner = Math.min(5, Math.floor(rnd() * 6));
  const pos = Array(6).fill(0);
  const track = () => CARS.map((c, i) => `${c} ${'▬'.repeat(pos[i])}🏎️${'▬'.repeat(Math.max(0, TRACK - pos[i]))}🏁`).join('\n');
  await redraw(L, runningCard(t, L, L.cur, [t('live.race.go'), '', track()]));
  const TICKS = 8;
  for (let k = 1; k <= TICKS; k++) {
    await sleep(900);
    for (let c = 0; c < 6; c++) pos[c] = Math.min(TRACK - 1, pos[c] + 1 + Math.floor(rnd() * 2));
    if (k === TICKS) { pos[winner] = TRACK; for (let c = 0; c < 6; c++) if (c !== winner) pos[c] = Math.min(pos[c], TRACK - 1); }
    await redraw(L, runningCard(t, L, L.cur, [k === TICKS ? t('live.race.won', { c: `${CARS[winner]} ${t(`live.race.car.${winner}`)}` }) : t('live.race.lap', { k, n: TICKS }), '', track()]));
  }
  const plays = [...L.players.entries()].map(([id, p]) => ({ discordId: id, bet: p.bet, multiplier: Number(p.pick) === winner ? 6 : 0, note: `car${Number(p.pick) + 1}` }));
  const won = plays.some((p) => p.multiplier > 0);
  const host = L.players.get(L.hostId);
  const gifPath = `/og/casino/race/${won ? 'win' : 'lose'}.gif?d=${encodeURIComponent(`${winner}|${host?.pick ?? ''}`)}&a=${encodeURIComponent(n(plays.reduce((a, p) => a + (p.multiplier ? p.bet * 5 : -p.bet), 0)))}&s=${Math.floor(rnd() * 4294967295)}`;
  await finish(L, plays, [t('live.race.won', { c: `${CARS[winner]} ${t(`live.race.car.${winner}`)}` }), '', track()], gifPath);
}

async function runPot(L) {
  const t = L.t;
  const ids = [...L.players.keys()];
  const stakes = ids.map((id) => L.players.get(id).bet);
  const total = stakes.reduce((a, b) => a + b, 0);
  const winnerIdx = potWinner(stakes, rnd());
  const names = ids.map((id) => L.players.get(id).name);
  const list = (hi) => ids.map((id, i) => `${i === hi ? '👉' : '•'} **${names[i]}** — ${n(stakes[i])} ${L.cur} (${Math.round((stakes[i] / total) * 100)} %)`).join('\n');
  await redraw(L, runningCard(t, L, L.cur, [t('live.pot.total', { n: n(total), cur: L.cur }), t('live.pot.drawing'), '', list(-1)]));
  for (let k = 0; k < 7; k++) { await sleep(700); await redraw(L, runningCard(t, L, L.cur, [t('live.pot.total', { n: n(total), cur: L.cur }), t('live.pot.drawing'), '', list(k < 6 ? Math.floor(rnd() * ids.length) : winnerIdx)])); }
  // Weight 1: the settlement's pot split hands the winner every other stake plus their own.
  const plays = ids.map((id, i) => ({ discordId: id, bet: stakes[i], multiplier: i === winnerIdx ? 1 : 0, note: i === winnerIdx ? 'pot' : '' }));
  const labels = names.map((s) => s.replace(/[^\w]/g, '').slice(0, 6) || 'P').slice(0, 8).join(',');
  const gifPath = `/og/casino/pot/win.gif?d=${encodeURIComponent(`${winnerIdx}|${stakes.slice(0, 8).join(',')}|${labels}`)}&a=${encodeURIComponent(n(total))}&s=${Math.floor(rnd() * 4294967295)}`;
  await finish(L, plays, [t('live.pot.won', { u: names[winnerIdx], n: n(total), cur: L.cur }), '', list(winnerIdx)], gifPath);
}

/** The classic games on one shared roll. */
async function runMulti(L) {
  const t = L.t;
  let outcome, line, detail;
  if (L.game === 'coinflip') { const heads = rnd() < 0.5; outcome = heads ? 'heads' : 'tails'; line = heads ? t('live.multi.heads') : t('live.multi.tails'); detail = heads ? '🪙' : '🌑'; }
  else if (L.game === 'dice') { const roll = 1 + Math.floor(rnd() * 6); outcome = roll; line = t('live.multi.dice', { n: roll }); detail = String(roll); }
  else if (L.game === 'roulette') {
    const pocket = Math.floor(rnd() * 37); const reds = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
    outcome = pocket === 0 ? 'green' : reds.has(pocket) ? 'red' : 'black'; line = t('live.multi.roulette', { n: pocket, c: t(`live.pick.${outcome}`) }); detail = String(pocket);
  } else {
    const SLICES = [[2, 45], [3, 24], [5, 16], [10, 9], [20, 4], [50, 2]]; let roll = rnd() * 100, landed = 2;
    for (const [m, w] of SLICES) { if (roll < w) { landed = m; break; } roll -= w; }
    outcome = landed; line = t('live.multi.wheel', { m: landed }); detail = `${landed}|${landed}`;
  }
  const mult = (p) => {
    if (L.game === 'coinflip') return p.pick === outcome ? 2 : 0;
    if (L.game === 'dice') return outcome >= 4 ? 2 : 0;
    if (L.game === 'roulette') return p.pick === outcome ? (outcome === 'green' ? 14 : 2) : 0;
    return Number(p.pick) === outcome ? outcome : 0;
  };
  await redraw(L, runningCard(t, L, L.cur, [t('live.multi.rolling')]));
  await sleep(1500);
  const plays = [...L.players.entries()].map(([id, p]) => ({ discordId: id, bet: p.bet, multiplier: mult(p), note: String(p.pick ?? '') }));
  const won = plays.some((p) => p.multiplier > 0);
  const gifPath = `/og/casino/${L.game}/${won ? 'win' : 'lose'}.gif?d=${encodeURIComponent(detail)}&a=${encodeURIComponent(n(plays.reduce((a, p) => a + (p.multiplier ? p.bet * (p.multiplier - 1) : -p.bet), 0)))}&s=${Math.floor(rnd() * 4294967295)}`;
  await finish(L, plays, [line], gifPath);
}

// ── the buttons and the modal ────────────────────────────────────────────────────────
function joinModal(t, L, { min, max }) {
  const modal = new ModalBuilder().setCustomId(`clm:join:${L.id}`).setTitle(t('live.modal.title').slice(0, 45));
  modal.addComponents(new ActionRowBuilder().addComponents(
    new TextInputBuilder().setCustomId('bet').setLabel(t('live.modal.bet', { a: n(min), b: Number.isFinite(max) ? n(max) : '∞' }).slice(0, 45)).setStyle(TextInputStyle.Short).setPlaceholder('50').setMaxLength(9).setRequired(true),
  ));
  if (L.game === 'crash') {
    modal.addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('target').setLabel(t('live.modal.target').slice(0, 45)).setStyle(TextInputStyle.Short).setPlaceholder('2.5').setMaxLength(7).setRequired(false),
    ));
  }
  return modal;
}

export async function liveComponent(i) {
  const [, verb, id, arg] = i.customId.split(':');
  const { t } = await tr(i);
  if (verb === 'new') return openLive(i, id, {});
  const L = lobbies.get(id);
  if (!L) return ui.line(i, t('live.gone'), { title: `${ui.ic('casino')} ${t('cas.title')}` });
  const { casino } = await liveConfig();
  const lim = limits(casino);
  if (verb === 'join') {
    if (L.state !== 'open') return ui.line(i, t('live.notOpen'));
    return i.showModal(joinModal(t, L, lim));
  }
  if (verb === 'pick') {
    const p = L.players.get(i.user.id);
    if (L.state !== 'open') return ui.line(i, t('live.notOpen'));
    if (!p) return ui.line(i, t('live.joinFirst'));
    p.pick = L.game === 'race' || L.game === 'wheel' ? Number(arg) : arg;
    L.touched = Date.now();
    await i.deferUpdate().catch(() => {});
    return redraw(L, lobbyCard(L.t, L, L.cur));
  }
  if (verb === 'leave') {
    if (L.state !== 'open') return ui.line(i, t('live.notOpen'));
    if (!L.players.delete(i.user.id)) return ui.line(i, t('live.notIn'));
    await i.deferUpdate().catch(() => {});
    return redraw(L, lobbyCard(L.t, L, L.cur));
  }
  if (verb === 'start') {
    if (i.user.id !== L.hostId) return ui.line(i, t('live.hostOnly'));
    if (L.state !== 'open') return ui.line(i, t('live.notOpen'));
    if (L.players.size < minPlayers(L.game)) return ui.line(i, t('live.tooFew', { n: minPlayers(L.game) }));
    const unpicked = [...L.players.values()].filter((p) => needsPick(L.game) && p.pick == null);
    if (unpicked.length) return ui.line(i, t('live.unpicked', { u: unpicked.map((p) => p.name).join(', ') }));
    await i.deferUpdate().catch(() => {});
    return start(L);
  }
  if (verb === 'cancel') {
    if (i.user.id !== L.hostId) return ui.line(i, t('live.hostOnly'));
    if (L.state !== 'open') return ui.line(i, t('live.notOpen'));
    clearTimeout(L.timer); L.state = 'done';
    await i.deferUpdate().catch(() => {});
    return redraw(L, { title: `${ui.ic(L.game) || '🎮'} ${L.t(`live.title.${gameKey(L.game)}`, { g: L.t(`game.${L.game}`) })}`, color: 0x6b7280, body: L.t('live.cancelled'), buttons: [ui.btn(`cl:new:${L.game}`, L.t('live.again'), ButtonStyle.Primary, { emoji: 'again' })] });
  }
  if (verb === 'cash') {
    const p = L.players.get(i.user.id);
    if (!p) return ui.line(i, t('live.notIn'));
    if (L.state !== 'running' || L.game !== 'crash') return ui.line(i, t('live.notOpen'));
    if (p.cashed) return ui.line(i, t('live.crash.already', { m: p.cashed.toFixed(2) }));
    // The multiplier on screen when they pressed — the last one the loop drew.
    p.cashed = L.shown || 1;
    await i.deferUpdate().catch(() => {});
    return;
  }
  return i.deferUpdate().catch(() => {});
}

export async function liveModal(i) {
  const [, , id] = i.customId.split(':');
  const { t } = await tr(i);
  const L = lobbies.get(id);
  if (!L) return ui.line(i, t('live.gone'));
  const bet = Number((i.fields.getTextInputValue('bet') || '').replace(/[^0-9]/g, ''));
  let target = null;
  if (L.game === 'crash') { const raw = Number(String(i.fields.getTextInputValue('target') || '').replace(',', '.')); if (Number.isFinite(raw) && raw >= 1.01) target = Math.min(1000, Math.round(raw * 100) / 100); }
  const r = await seat(L, i, { bet, target });
  if (!r.ok) return ui.line(i, r.why);
  await ui.line(i, t('live.joined', { n: n(bet), cur: L.cur, p: needsPick(L.game) && L.players.get(i.user.id)?.pick == null ? ` ${t('live.pickNow')}` : '' }));
  return redraw(L, lobbyCard(L.t, L, L.cur));
}

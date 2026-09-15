// casino-live.mjs — tables several members sit at, in real time, from any server.
//
// The single-player casino is a private exchange: you bet, the bot rolls, the ledger settles,
// a card appears. These are the OTHER kind: a public card everybody can join, a round that
// plays out in edits to that card while the players watch, and one settlement for the whole
// table. Three games only exist this way, and the classic four can be played this way too:
//
//   crash  a multiplier climbs from 1.00×; every player has a Cash out button; whoever pressed
//          it before the break keeps the multiplier they left at, the rest lose the stake. A
//          target set on joining cashes out for you. One player is enough. Crash is played
//          against the house (the edge is in the curve), never as a pot.
//   race   six cars, each player picks one, the drawn winner is uniform. Alone: 6× against
//          the house. Two or more: the table rule below.
//   pot    everyone stakes what they like; ONE winner takes it all, drawn in proportion to
//          stake. Two players minimum.
//   multi  the classic games — coin, dice, roulette, wheel — on ONE shared roll.
//
// THE TABLE RULE (zero-loss): with two or more seats (crash excepted) the winners pocket the
// whole sum staked, split by stake — each winner keeps their own stake and takes a share of
// the losers'. The house takes NOTHING from a table. Nobody wins → every stake comes back.
// The arithmetic is casino-rules.mjs's `settleTable` on the API; the bot only reports plays.
//
// LOBBIES: every table has a 6-character code and a visibility (public / server / private) —
// see casino-lobbies.mjs. `/casino join <code>` (or the Join-by-code button) seats a player
// from ANY server or DM; their channel gets a MIRROR card of the table that follows every
// state the home card shows, results included.
//
// LOADING: one convention, everywhere — a refusal is an ephemeral line, a change is an
// immediate `deferUpdate` followed by the card's redraw, a command answers with its card.
// Nothing is deferred without being finished, so no button ever shows a dangling "thinking".
//
// RANDOMNESS is drawn here, on the bot; the API is the ledger. The crash-point and pot-winner
// functions are the pure ones the API's own tests pin — duplicated here as the same lines
// rather than imported, because the bot is a separate package with no path to the API's
// source. Keep them in step with apps/api/src/lib/casino-rules.mjs.
import { ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from 'discord.js';
import * as ui from '../ui.mjs';
import { api } from '../api.mjs';
import { config } from '../config.mjs';
import { tr, makeT } from '../i18n.mjs';
import * as reg from './casino-lobbies.mjs';

export const LIVE_GAMES = ['crash', 'race', 'pot'];
export const MULTI_GAMES = ['coinflip', 'dice', 'roulette', 'wheel'];
export const VISIBILITIES = reg.VISIBILITIES;

const JOIN_MS = 45_000;          // the join window before an auto-start (when enough players)
const MAX_PLAYERS = 25;          // Discord's own ceiling on what fits in one card comfortably
const TICK_MS = 1100;            // one crash tick = one edit per mirror; Discord allows ~1/s
const CARS = ['🔴', '🔵', '🟢', '🟡', '🟣', '🟠'];
const TAGS = ['RED', 'BLU', 'GRN', 'YEL', 'PUR', 'ORA'];

const n = (x) => Number(x || 0).toLocaleString('en-US');
const curLabel = (c) => c?.emoji || c?.name || 'points';
const rnd = () => Math.random();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const plain = (s) => String(s || '').replace(/[*_`~|>]/g, '').replace(/<a?:\w+:\d+>/g, '').trim();

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

// ── config, names, picks ─────────────────────────────────────────────────────────────
async function liveConfig() {
  const cfg = await config();
  const casino = cfg.economy?.casino || {};
  const live = { multi: true, crash: true, race: true, pot: true, ...(casino.live || {}) };
  return { cfg, casino, live, enabled: casino.enabled !== false, currency: cfg.economy?.currency };
}
const minPlayers = (game) => (game === 'pot' ? 2 : 1);
const isMulti = (game) => MULTI_GAMES.includes(game);
const gameKey = (game) => (isMulti(game) ? 'multi' : game);
const needsPick = (game) => ['race', 'coinflip', 'roulette', 'wheel'].includes(game);
const isPot = (L) => L.players.size >= 2 && L.game !== 'crash';
/** What the card calls a player. */
const nameOf = (i) => (i.member?.displayName || i.user.globalName || i.user.username || 'player').slice(0, 24);
const title = (L) => `${ui.ic(L.game) || '🎮'} ${L.t(`live.title.${gameKey(L.game)}`, { g: L.t(`game.${L.game}`) })}`;
const visLabel = (t, v) => t(`live.vis.${v}`);

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

// ── cards ────────────────────────────────────────────────────────────────────────────
function playersBlock(t, L) {
  const rows = [...L.players.values()].map((p) => {
    const pk = pickLabel(t, L.game, p.pick);
    const extra = L.game === 'crash' && p.target ? ` · ${t('live.crash.target', { m: p.target.toFixed(2) })}` : '';
    return `• **${p.name}** — ${n(p.bet)} ${L.cur}${pk ? ` · ${pk}` : ''}${extra}`;
  });
  return rows.length ? rows.join('\n') : t('live.nobody');
}
const tableLine = (t, L) => t('live.tableLine', { c: L.code, v: visLabel(t, L.visibility), u: L.hostName, n: n(L.players.size), s: n([...L.players.values()].reduce((a, p) => a + p.bet, 0)), cur: L.cur });

function lobbyCard(L) {
  const t = L.t;
  const need = minPlayers(L.game);
  const have = L.players.size;
  const status = have >= need ? t('live.startsAt', { t: `<t:${Math.floor(L.startAt / 1000)}:R>` }) : t('live.waiting', { n: need - have });
  const buttons = [
    ui.btn(`cl:join:${L.id}`, t('live.join'), ButtonStyle.Primary, { emoji: 'casino' }),
    ...pickButtons(t, L),
    ui.btn(`cl:start:${L.id}`, t('live.start'), ButtonStyle.Success, { disabled: have < need }),
    ui.btn(`cl:leave:${L.id}`, t('live.leave'), ButtonStyle.Secondary),
    ui.btn(`cl:vis:${L.id}`, t('live.vis.btn', { v: visLabel(t, L.visibility) }), ButtonStyle.Secondary),
    ui.btn(`cl:cancel:${L.id}`, t('live.cancel'), ButtonStyle.Danger),
  ];
  return {
    title: title(L),
    color: ui.BRAND,
    body: [t(`live.rules.${gameKey(L.game)}`), ...(L.game !== 'crash' ? [t('live.rules.pot2')] : []), '', `### ${t('live.players', { n: have })}`, playersBlock(t, L), '', tableLine(t, L), status],
    footer: t('live.footer', { c: L.code }),
    buttons,
  };
}

function runningCard(L, lines, { cash = false } = {}) {
  return { title: title(L), color: 0x6b7280, body: lines, footer: L.t('live.footer', { c: L.code }), buttons: cash ? [ui.btn(`cl:cash:${L.id}`, L.t('live.cash'), ButtonStyle.Success, { emoji: 'wallet' })] : [] };
}

function closedCard(L, text) {
  return { title: title(L), color: 0x6b7280, body: text, buttons: [ui.btn(`cl:new:${L.game}`, L.t('live.again'), ButtonStyle.Primary, { emoji: 'again' })] };
}

/**
 * Edit every mirror of the table into `opts` — in parallel, once, and only when the card
 * actually changed (a tick that draws the same text is not sent). One build per redraw.
 */
async function redraw(L, opts) {
  const sig = JSON.stringify([opts.title, opts.body, opts.footer, opts.image, (opts.buttons || []).map((b) => b.toJSON?.() || null)]);
  if (sig === L.lastSig && !opts.files?.length) return;
  L.lastSig = sig;
  const payload = ui.card(opts);
  await Promise.allSettled(L.mirrors.filter((m) => m.msg).map((m) => m.msg.edit(payload).catch((e) => console.warn('[casino-live] edit failed:', e.message))));
}

// ── opening a table ──────────────────────────────────────────────────────────────────
/**
 * Open a table where the command was run — a server channel or a DM. `bet`/`pick`/`target`
 * seat the host straight away when given; otherwise they join like anybody else.
 */
export async function openLive(i, game, { bet = 0, pick = null, target = null, visibility = 'server' } = {}) {
  const { t, lang } = await tr(i);
  const { cfg, live, enabled, currency } = await liveConfig();
  const cur = curLabel(currency);
  if (!enabled) return ui.line(i, t('cas.off'), { title: `${ui.ic('casino')} ${t('cas.title')}` });
  if (live[gameKey(game)] === false) return ui.line(i, t('live.off'), { title: `${ui.ic('casino')} ${t('cas.title')}` });
  const L = reg.createLobby({
    game, hostId: i.user.id, hostName: nameOf(i), guildId: i.guildId || null, channelId: i.channelId, visibility,
    // `curPlain` is for text drawn INTO the GIF: the renderer has no colour-emoji font.
    players: new Map(), startAt: Date.now() + JOIN_MS, lang, t: makeT(lang, cfg.i18n), cur, curPlain: currency?.name || 'points', timer: null, shown: 1, lastSig: '',
  });
  // The host's own seat, when the command carried a bet. Refusals are ephemeral and the table
  // still opens: a host who typed a bet over the cap should not lose the table for it.
  let seatNote = '';
  if (bet > 0) { const r = await seat(L, i, { bet, pick, target }); if (!r.ok) seatNote = r.why; }
  const sent = await i.reply({ ...ui.card(lobbyCard(L)), fetchReply: true }).catch(() => null);
  if (!sent) { reg.removeLobby(L.id); return; }
  L.mirrors[0].msg = sent; L.mirrors[0].messageId = sent.id;
  if (seatNote) await i.followUp({ content: seatNote, ephemeral: true }).catch(() => {});
  scheduleStart(L);
}

/** Seat a player: limits, link, balance, pick. Returns { ok } or { ok:false, why }. */
async function seat(L, i, { bet, pick = null, target = null }) {
  const { t } = await tr(i);
  const { casino } = await liveConfig();
  const { min, max } = limits(casino);
  const b = Math.floor(Number(bet) || 0);
  const may = reg.canJoin(L, { guildId: i.guildId || null });
  if (!may.ok) return { ok: false, why: t(may.why === 'serverOnly' ? 'live.code.serverOnly' : 'live.notOpen') };
  if (L.players.size >= MAX_PLAYERS && !L.players.has(i.user.id)) return { ok: false, why: t('live.full') };
  if (b < min || b > max) return { ok: false, why: t('live.betRange', { a: n(min), b: Number.isFinite(max) ? n(max) : t('live.noCap') }) };
  const e = await api.economyUser(i.user.id);
  if (!e.linked) return { ok: false, why: t('cas.linkFirst') };
  if ((Number(e.points) || 0) < b) return { ok: false, why: t('cas.onlyHave', { n: n(e.points || 0), cur: L.cur }) };
  const prev = L.players.get(i.user.id);
  L.players.set(i.user.id, { name: nameOf(i), bet: b, pick: pick ?? prev?.pick ?? null, target: target || prev?.target || null, cashed: null, cashedAt: 0 });
  reg.touch(L);
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
    void redraw(L, lobbyCard(L));
    scheduleStart(L);
  }, Math.max(1000, L.startAt - Date.now()));
  L.timer.unref?.();
}

async function closeIdle(L) {
  reg.setState(L, 'done');
  await redraw(L, closedCard(L, L.t('live.expired')));
}

// Idle tables are forgotten; their cards say so. A running table is never swept.
setInterval(() => { for (const L of reg.sweep()) { clearTimeout(L.timer); if (L.state === 'open') void redraw(L, closedCard(L, L.t('live.expired'))); } }, 60_000).unref?.();

// ── the rounds ───────────────────────────────────────────────────────────────────────
async function start(L) {
  if (L.state !== 'open') return;
  clearTimeout(L.timer);
  reg.setState(L, 'running');
  try {
    await countdown(L);
    if (L.game === 'crash') await runCrash(L);
    else if (L.game === 'race') await runRace(L);
    else if (L.game === 'pot') await runPot(L);
    else await runMulti(L);
  } catch (e) {
    console.warn('[casino-live] round failed:', e);
    reg.setState(L, 'done');
    await redraw(L, { title: L.t('cas.title'), color: ui.BAD, body: L.t('live.failed') });
  }
}

/** 3 · 2 · 1 — the same visible "starting" phase for every game, one edit per second. */
async function countdown(L) {
  for (let s = 3; s >= 1; s--) {
    await redraw(L, runningCard(L, [L.t('live.countdown', { s }), '', playersBlock(L.t, L)]));
    await sleep(1000);
  }
}

/** The GIF path for a result: outcome + winners drawn into the frames, in the table's words. */
function gifPath(L, { won, detail, amount, outcome, winners }) {
  const q = new URLSearchParams({ d: detail, a: amount, s: String(Math.floor(rnd() * 4294967295)), t: `${plain(L.t(`live.title.${gameKey(L.game)}`, { g: L.t(`game.${L.game}`) }))} · ${L.code}`.toUpperCase(), o: plain(outcome), w: plain(winners) });
  return `/og/casino/${L.game}/${won ? 'win' : 'lose'}.gif?${q}`;
}

/**
 * Settle every seat with the API and post ONE result: the GIF (title, outcome and winners
 * drawn in) with a short line under it — never "you win" to a whole table.
 */
async function finish(L, plays, { outcome, gifOutcome, detail, amount }) {
  reg.setState(L, 'done');
  const t = L.t;
  const pot = isPot(L);
  const r = await api.economySettle(L.game, plays, pot);
  const results = r?.ok ? r.results : plays.map((p) => ({ discordId: p.discordId, ok: false }));
  const nameFor = (id) => L.players.get(id)?.name || id;
  const skipped = results.filter((x) => !x.ok).map((x) => t('live.res.skip', { u: nameFor(x.discordId) }));
  let line, gifLine;
  if (!r?.ok) { line = t('live.failed'); gifLine = ''; }
  else if (pot) {
    // The table rule's three outcomes: one winner takes the whole sum, several share it by
    // stake, nobody → every stake comes back.
    const winners = results.filter((x) => x.ok && !x.refund && plays.find((p) => p.discordId === x.discordId)?.multiplier > 0);
    const paid = (x) => n(x.payout);
    if (r.refund || !winners.length) { line = t('live.out.none'); gifLine = t('live.gif.none'); }
    else if (winners.length === 1) { const w = winners[0]; line = t('live.out.one', { u: nameFor(w.discordId), n: paid(w), cur: L.cur }); gifLine = t('live.gif.one', { u: nameFor(w.discordId), n: paid(w), cur: L.curPlain }); }
    else {
      const list = winners.map((w) => `${nameFor(w.discordId)} ${paid(w)}`);
      line = t('live.out.many', { k: winners.length, list: winners.map((w) => `**${nameFor(w.discordId)}** ${paid(w)}`).join(' · '), cur: L.cur });
      gifLine = t('live.gif.many', { k: winners.length, list: list.join(' · '), cur: L.curPlain });
    }
  } else {
    // Against the house — a lone seat, or crash: each seat's own line, by name.
    const rows = results.filter((x) => x.ok).map((x) => (x.delta > 0 ? t('live.res.win', { u: nameFor(x.discordId), n: n(x.delta) }) : x.delta === 0 ? t('live.res.push', { u: nameFor(x.discordId) }) : t('live.res.lose', { u: nameFor(x.discordId), n: n(-x.delta) })));
    line = rows.join(' · ');
    gifLine = results.filter((x) => x.ok).map((x) => `${nameFor(x.discordId)} ${x.delta > 0 ? '+' : x.delta < 0 ? '−' : '±'}${n(Math.abs(x.delta))}`).join(' · ');
  }
  const won = results.some((x) => x.ok && x.delta > 0);
  const gif = r?.ok ? await api.siteImage(gifPath(L, { won, detail, amount, outcome: gifOutcome, winners: gifLine })) : null;
  const files = gif ? [ui.attach(gif, 'table.gif')] : [];
  await redraw(L, {
    title: title(L), color: 0x6b7280,
    body: [gif ? null : outcome, line, ...skipped].filter(Boolean),
    image: gif ? 'attachment://table.gif' : null, files,
    footer: t('live.footer', { c: L.code }),
    buttons: [ui.btn(`cl:new:${L.game}`, t('live.again'), ButtonStyle.Primary, { emoji: 'again' }), ui.btn('eco:level', t('btn.balance'), ButtonStyle.Secondary, { emoji: 'level' })],
  });
}

// A log-scale bar from 1× to 10× and a sparkline of the climb: a reader sees the rise.
const SPARK = '▁▂▃▄▅▆▇█';
function crashLines(L, m, { crashed = false } = {}) {
  const t = L.t;
  const frac = Math.min(1, Math.log(Math.max(1, m)) / Math.log(10));
  const on = Math.round(frac * 16);
  const bar = `${'▰'.repeat(on)}${'▱'.repeat(16 - on)}`;
  const hist = L.history.slice(-24);
  const top = Math.max(1.01, ...hist);
  const spark = hist.map((v) => SPARK[Math.min(7, Math.floor(((v - 1) / (top - 1 || 1)) * 7.99))]).join('');
  const head = crashed ? t('live.crash.crashed', { m: m.toFixed(2) }) : t('live.crash.live', { m: m.toFixed(2) });
  const targets = [...L.players.values()].filter((p) => p.target && !p.cashed).map((p) => p.target);
  const next = !crashed && targets.length ? t('live.crash.nextTarget', { m: Math.min(...targets).toFixed(2) }) : '';
  const rows = [...L.players.values()].map((p) => `• **${p.name}** — ${n(p.bet)} ${L.cur} · ${p.cashed ? t('live.crash.out', { m: p.cashed.toFixed(2) }) : crashed ? t('live.crash.lost') : t('live.crash.in')}${!p.cashed && p.target && !crashed ? ` · ${t('live.crash.target', { m: p.target.toFixed(2) })}` : ''}`);
  const log = L.log.slice(-6).map((e) => t('live.crash.log', { u: e.name, m: e.m.toFixed(2) }));
  return [head, `\`${bar}\` ${spark}`, next, '', ...rows, ...(log.length ? ['', ...log] : [])];
}

async function runCrash(L) {
  const { casino } = await liveConfig();
  const crashAt = crashPoint(rnd(), edgePct(casino, 'crash'));
  const t = L.t;
  L.history = [1]; L.log = [];
  let k = 0, m = 1;
  L.shown = 1;
  await redraw(L, runningCard(L, crashLines(L, 1), { cash: true }));
  // Climb: m(k) = e^(0.0935·k) per 1.1 s tick — 2× around 8 s, 5× around 19 s, 10× at 27 s.
  // One edit per tick per mirror; the cash-outs pressed between ticks are shown on the next.
  while (true) {
    await sleep(TICK_MS);
    k++;
    m = Math.floor(100 * Math.exp(0.0935 * k)) / 100;
    if (m >= crashAt) break;
    L.shown = m; L.history.push(m);
    // Targets cash out for their owner as the curve passes them.
    for (const [id, p] of L.players) if (!p.cashed && p.target && m >= p.target) cashOut(L, id, p.target);
    const everyoneOut = [...L.players.values()].every((p) => p.cashed);
    await redraw(L, runningCard(L, crashLines(L, m), { cash: !everyoneOut }));
    if (everyoneOut) { await sleep(900); }
  }
  m = crashAt; L.history.push(m);
  await redraw(L, runningCard(L, crashLines(L, m, { crashed: true })));
  await sleep(1200);
  const plays = [...L.players.entries()].map(([id, p]) => ({ discordId: id, bet: p.bet, multiplier: p.cashed || 0, note: p.cashed ? `out@${p.cashed.toFixed(2)}` : `crash@${crashAt.toFixed(2)}` }));
  const cashes = [...L.players.values()].filter((p) => p.cashed).sort((a, b) => a.cashed - b.cashed).slice(0, 8).map((p) => `${p.name.replace(/[^\w-]/g, '').slice(0, 10) || 'P'}@${p.cashed.toFixed(2)}`).join(',');
  const total = plays.reduce((a, p) => a + (p.multiplier ? Math.round(p.bet * p.multiplier - p.bet) : -p.bet), 0);
  await finish(L, plays, { outcome: t('live.crash.crashed', { m: crashAt.toFixed(2) }), gifOutcome: t('live.gif.crash', { m: crashAt.toFixed(2) }), detail: `${crashAt}|${cashes}`, amount: n(Math.abs(total)) });
}
/** A cash-out, whoever triggered it: the seat keeps `m`, and the card's log gets a line. */
function cashOut(L, id, m) {
  const p = L.players.get(id);
  if (!p || p.cashed) return false;
  p.cashed = m; p.cashedAt = Date.now();
  L.log.push({ name: p.name, m });
  return true;
}

async function runRace(L) {
  const t = L.t;
  // The winner is drawn uniformly HERE; the GIF's simulation is told and ends on it.
  const winner = Math.min(5, Math.floor(rnd() * 6));
  await redraw(L, runningCard(L, [t('live.race.go'), '', playersBlock(t, L)]));
  await sleep(1500);
  const plays = [...L.players.entries()].map(([id, p]) => ({ discordId: id, bet: p.bet, multiplier: Number(p.pick) === winner ? 6 : 0, note: `car${Number(p.pick) + 1}` }));
  const host = L.players.get(L.hostId);
  const car = `${CARS[winner]} ${t(`live.race.car.${winner}`)}`;
  await finish(L, plays, { outcome: t('live.race.won', { c: car }), gifOutcome: t('live.gif.race', { c: `${TAGS[winner]} · ${t(`live.race.car.${winner}`)}` }), detail: `${winner}|${L.players.size === 1 && host ? host.pick ?? '' : ''}`, amount: n(plays.reduce((a, p) => a + (p.multiplier ? p.bet * 5 : -p.bet), 0)) });
}

async function runPot(L) {
  const t = L.t;
  const ids = [...L.players.keys()];
  const stakes = ids.map((id) => L.players.get(id).bet);
  const total = stakes.reduce((a, b) => a + b, 0);
  const winnerIdx = potWinner(stakes, rnd());
  const names = ids.map((id) => L.players.get(id).name);
  const list = ids.map((id, i) => `• **${names[i]}** — ${n(stakes[i])} ${L.cur} (${Math.round((stakes[i] / total) * 100)} %)`).join('\n');
  await redraw(L, runningCard(L, [t('live.pot.total', { n: n(total), cur: L.cur }), t('live.pot.drawing'), '', list]));
  await sleep(1500);
  // Weight 1: the settlement's table rule hands the winner every other stake plus their own.
  const plays = ids.map((id, i) => ({ discordId: id, bet: stakes[i], multiplier: i === winnerIdx ? 1 : 0, note: i === winnerIdx ? 'pot' : '' }));
  const labels = names.map((s) => s.replace(/[^\w]/g, '').slice(0, 6) || 'P').slice(0, 8).join(',');
  await finish(L, plays, { outcome: t('live.pot.won', { u: names[winnerIdx], n: n(total), cur: L.cur }), gifOutcome: t('live.gif.pot', { u: names[winnerIdx] }), detail: `${winnerIdx}|${stakes.slice(0, 8).join(',')}|${labels}`, amount: n(total) });
}

/** The classic games on one shared roll. */
async function runMulti(L) {
  const t = L.t;
  let outcome, line, detail;
  if (L.game === 'coinflip') { const heads = rnd() < 0.5; outcome = heads ? 'heads' : 'tails'; line = heads ? t('live.multi.heads') : t('live.multi.tails'); detail = heads ? 'H' : 'T'; }
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
  await redraw(L, runningCard(L, [t('live.multi.rolling'), '', playersBlock(t, L)]));
  await sleep(1500);
  const plays = [...L.players.entries()].map(([id, p]) => ({ discordId: id, bet: p.bet, multiplier: mult(p), note: String(p.pick ?? '') }));
  await finish(L, plays, { outcome: line, gifOutcome: plain(line), detail, amount: n(plays.reduce((a, p) => a + (p.multiplier ? p.bet * (p.multiplier - 1) : -p.bet), 0)) });
}

// ── the buttons and the modals ───────────────────────────────────────────────────────
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
/** Join by code: the code, the bet and (crash only) the target in ONE modal — a modal cannot open another. */
function codeModal(t, { min, max }, code = '') {
  const modal = new ModalBuilder().setCustomId('clm:code').setTitle(t('live.modal.code.title').slice(0, 45));
  modal.addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('code').setLabel(t('live.modal.code').slice(0, 45)).setStyle(TextInputStyle.Short).setPlaceholder('K7P2QX').setMinLength(6).setMaxLength(8).setRequired(true).setValue(code)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('bet').setLabel(t('live.modal.bet', { a: n(min), b: Number.isFinite(max) ? n(max) : '∞' }).slice(0, 45)).setStyle(TextInputStyle.Short).setPlaceholder('50').setMaxLength(9).setRequired(true)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('target').setLabel(t('live.modal.targetCrash').slice(0, 45)).setStyle(TextInputStyle.Short).setPlaceholder('2.5').setMaxLength(7).setRequired(false)),
  );
  return modal;
}
const parseTarget = (raw) => { const v = Number(String(raw || '').replace(',', '.')); return Number.isFinite(v) && v >= 1.01 ? Math.min(1000, Math.round(v * 100) / 100) : null; };

/** `/casino join <code>` — the code's table, then the join modal (bet + target). */
export async function joinByCode(i, code) {
  const { t } = await tr(i);
  const { casino } = await liveConfig();
  const L = reg.findByCode(code);
  if (!L) return ui.line(i, t('live.code.unknown'), { title: `${ui.ic('casino')} ${t('cas.title')}` });
  const may = reg.canJoin(L, { guildId: i.guildId || null });
  if (!may.ok) return ui.line(i, t(may.why === 'serverOnly' ? 'live.code.serverOnly' : 'live.notOpen'));
  return i.showModal(joinModal(t, L, limits(casino)));
}

/** `/casino lobbies` — the open tables this reader may see, each with a Join button. */
export async function listLobbies(i) {
  const { t } = await tr(i);
  const rows = reg.listVisible({ guildId: i.guildId || null }).slice(0, 12);
  const body = rows.length ? t('live.lobbies.intro') : t('live.lobbies.none');
  return ui.reply(i, {
    title: `${ui.ic('casino')} ${t('live.lobbies.title')}`,
    body,
    sections: rows.map((L) => ({ text: t('live.lobbies.row', { g: `${ui.ic(L.game) || ''} ${t(`game.${L.game}`)}`, c: L.code, n: L.players.size, u: L.hostName, v: visLabel(t, L.visibility) }), button: ui.btn(`cl:join:${L.id}`, t('live.join'), ButtonStyle.Primary) })),
    buttons: [ui.btn('cl:code', t('live.joinCode'), ButtonStyle.Secondary, { emoji: 'link' })],
  });
}

export async function liveComponent(i) {
  const [, verb, id, arg] = i.customId.split(':');
  const { t } = await tr(i);
  const { casino } = await liveConfig();
  const lim = limits(casino);
  if (verb === 'new') return openLive(i, id, {});
  if (verb === 'code') return i.showModal(codeModal(t, lim));
  if (verb === 'lobbies') return listLobbies(i);
  const L = reg.getLobby(id);
  if (!L) return ui.line(i, t('live.gone'), { title: `${ui.ic('casino')} ${t('cas.title')}` });
  if (verb === 'join') {
    const may = reg.canJoin(L, { guildId: i.guildId || null });
    if (!may.ok) return ui.line(i, t(may.why === 'serverOnly' ? 'live.code.serverOnly' : 'live.notOpen'));
    return i.showModal(joinModal(t, L, lim));
  }
  if (verb === 'pick') {
    const p = L.players.get(i.user.id);
    if (L.state !== 'open') return ui.line(i, t('live.notOpen'));
    if (!p) return ui.line(i, t('live.joinFirst'));
    p.pick = L.game === 'race' || L.game === 'wheel' ? Number(arg) : arg;
    reg.touch(L);
    await i.deferUpdate().catch(() => {});
    return redraw(L, lobbyCard(L));
  }
  if (verb === 'leave') {
    if (L.state !== 'open') return ui.line(i, t('live.notOpen'));
    if (!L.players.delete(i.user.id)) return ui.line(i, t('live.notIn'));
    await i.deferUpdate().catch(() => {});
    return redraw(L, lobbyCard(L));
  }
  if (verb === 'vis') {
    if (i.user.id !== L.hostId) return ui.line(i, t('live.hostOnly'));
    if (L.state !== 'open') return ui.line(i, t('live.notOpen'));
    const order = reg.VISIBILITIES; reg.setVisibility(L, order[(order.indexOf(L.visibility) + 1) % order.length]);
    reg.touch(L);
    await i.deferUpdate().catch(() => {});
    return redraw(L, lobbyCard(L));
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
    clearTimeout(L.timer); reg.setState(L, 'done');
    await i.deferUpdate().catch(() => {});
    return redraw(L, closedCard(L, L.t('live.cancelled')));
  }
  if (verb === 'cash') {
    const p = L.players.get(i.user.id);
    if (!p) return ui.line(i, t('live.notIn'));
    if (L.state !== 'running' || L.game !== 'crash') return ui.line(i, t('live.notOpen'));
    if (p.cashed) return ui.line(i, t('live.crash.already', { m: p.cashed.toFixed(2) }));
    // The multiplier on screen when they pressed — the last one the loop drew. The card
    // shows the cash-out on the next tick (≤ 1.1 s); the press itself is acknowledged now.
    cashOut(L, i.user.id, L.shown || 1);
    await i.deferUpdate().catch(() => {});
    return;
  }
  return i.deferUpdate().catch(() => {});
}

export async function liveModal(i) {
  const [, kind, id] = i.customId.split(':');
  const { t } = await tr(i);
  let L, bet, target = null;
  if (kind === 'code') {
    L = reg.findByCode(i.fields.getTextInputValue('code'));
    if (!L) return ui.line(i, t('live.code.unknown'), { title: `${ui.ic('casino')} ${t('cas.title')}` });
    bet = Number((i.fields.getTextInputValue('bet') || '').replace(/[^0-9]/g, ''));
    if (L.game === 'crash') target = parseTarget(i.fields.getTextInputValue('target'));
  } else {
    L = reg.getLobby(id);
    if (!L) return ui.line(i, t('live.gone'));
    bet = Number((i.fields.getTextInputValue('bet') || '').replace(/[^0-9]/g, ''));
    if (L.game === 'crash') target = parseTarget(i.fields.getTextInputValue('target'));
  }
  const r = await seat(L, i, { bet, target });
  if (!r.ok) return ui.line(i, r.why);
  const pickNote = needsPick(L.game) && L.players.get(i.user.id)?.pick == null ? ` ${t('live.pickNow')}` : '';
  // A player from another channel (or server, or a DM) gets a MIRROR card there: the same
  // table, the same buttons, updated with the same state — results included.
  if (!reg.mirrorOf(L, i.channelId)) {
    const m = reg.addMirror(L, { channelId: i.channelId, guildId: i.guildId || null });
    if (m) {
      const sent = await i.reply({ ...ui.card(lobbyCard(L)), fetchReply: true }).catch(() => null);
      if (sent) { m.msg = sent; m.messageId = sent.id; }
      await i.followUp({ content: t('live.joined', { n: n(bet), cur: L.cur, p: pickNote }), ephemeral: true }).catch(() => {});
      L.lastSig = ''; // the new mirror needs the next redraw even when nothing else changed
      return redraw(L, lobbyCard(L));
    }
  }
  await ui.line(i, t('live.joined', { n: n(bet), cur: L.cur, p: pickNote }));
  return redraw(L, lobbyCard(L));
}

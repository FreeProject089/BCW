// casino-live.mjs — tables several members sit at, in real time, from any server.
//
// The single-player casino is a private exchange: you bet, the bot rolls, the ledger settles,
// a card appears. These are the OTHER kind: a public card everybody can join, a round that
// plays out in edits to that card while the players watch, and one settlement for the whole
// table. Two games only exist this way, and the classic four can be played this way too:
//
//   race   six cars, each player picks one, the drawn winner is uniform. Alone: 6× against
//          the house. Two or more: the table rule below.
//   pot    everyone stakes what they like; ONE winner takes it all, drawn in proportion to
//          stake. Two players minimum.
//   multi  the classic games — coin, dice, roulette, wheel — on ONE shared roll.
//
// THE TABLE RULE (zero-loss): with two or more seats the winners pocket the
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
// RANDOMNESS is drawn here, on the bot; the API is the ledger. The pot-winner
// functions are the pure ones the API's own tests pin — duplicated here as the same lines
// rather than imported, because the bot is a separate package with no path to the API's
// source. Keep them in step with apps/api/src/lib/casino-rules.mjs.
import { ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } from 'discord.js';
import * as ui from '../ui.mjs';
import { api } from '../api.mjs';
import { config } from '../config.mjs';
import { tr, makeT } from '../i18n.mjs';
import { backButtons } from '../nav.mjs';
import { learnButton } from '../help.mjs';
import * as reg from './casino-lobbies.mjs';

export const LIVE_GAMES = ['race', 'pot'];
export const MULTI_GAMES = ['coinflip', 'dice', 'roulette', 'wheel'];
export const VISIBILITIES = reg.VISIBILITIES;

const JOIN_MS = 45_000;          // the join window before an auto-start (when enough players)
const MAX_PLAYERS = 25;          // Discord's own ceiling on what fits in one card comfortably
// The six cars, as icon keys (the site draws them; never a unicode emoji here).
const CARS = ['car_red', 'car_blue', 'car_green', 'car_yellow', 'car_purple', 'car_orange'];
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
  const live = { multi: true, race: true, pot: true, ...(casino.live || {}) };
  return { cfg, casino, live, enabled: casino.enabled !== false, currency: cfg.economy?.currency };
}
const minPlayers = (game) => (game === 'pot' ? 2 : 1);
const isMulti = (game) => MULTI_GAMES.includes(game);
const gameKey = (game) => (isMulti(game) ? 'multi' : game);
const needsPick = (game) => ['race', 'coinflip', 'roulette', 'wheel'].includes(game);
const isPot = (L) => L.players.size >= 2;
/** What the card calls a player. */
const nameOf = (i) => (i.member?.displayName || i.user.globalName || i.user.username || 'player').slice(0, 24);
const title = (L) => `${ui.icx(L.game)}${L.t(`live.title.${gameKey(L.game)}`, { g: L.t(`game.${L.game}`) })}`;
const visLabel = (t, v) => t(`live.vis.${v}`);

/** The pick, as words, for a card line. */
function pickLabel(t, game, pick) {
  if (pick == null || pick === '') return '';
  if (game === 'race') return `${ui.icx(CARS[pick])}${t(`live.race.car.${pick}`)}`;
  if (game === 'coinflip') return pick === 'tails' ? t('live.pick.tails') : t('live.pick.heads');
  if (game === 'roulette') return t(`live.pick.${pick}`);
  if (game === 'wheel') return `${pick}×`;
  return '';
}
/** A select-menu option with the icon set's emoji when one is mapped. */
function pickOpt(value, label, icon = null) {
  const o = new StringSelectMenuOptionBuilder().setValue(String(value)).setLabel(String(label).slice(0, 100));
  if (icon && ui.ic(icon)) { try { o.setEmoji(ui.ic(icon)); } catch { /* label only */ } }
  return o;
}
/**
 * The pick controls a game offers, or none. Six cars or six multipliers are a DROPDOWN (one
 * component, one row); two or three choices stay buttons. A `cl:pick:<id>` select carries the
 * pick in its value, a `cl:pick:<id>:<pick>` button in its custom id.
 */
function pickButtons(t, L) {
  const S = (pick) => `cl:pick:${L.id}:${pick}`;
  if (L.game === 'race') return [new StringSelectMenuBuilder().setCustomId(`cl:pick:${L.id}`).setPlaceholder(t('live.race.pickCar')).addOptions(CARS.map((k, i) => pickOpt(i, t(`live.race.car.${i}`), k)))];
  if (L.game === 'coinflip') return [ui.btn(S('heads'), t('live.pick.heads'), ButtonStyle.Secondary, { emoji: 'heads' }), ui.btn(S('tails'), t('live.pick.tails'), ButtonStyle.Secondary, { emoji: 'tails' })];
  if (L.game === 'roulette') return [ui.btn(S('red'), t('live.pick.red'), ButtonStyle.Secondary, { emoji: 'red' }), ui.btn(S('black'), t('live.pick.black'), ButtonStyle.Secondary, { emoji: 'black' }), ui.btn(S('green'), t('live.pick.green'), ButtonStyle.Secondary, { emoji: 'green' })];
  if (L.game === 'wheel') return [new StringSelectMenuBuilder().setCustomId(`cl:pick:${L.id}`).setPlaceholder(t('live.wheel.pickMult')).addOptions([2, 3, 5, 10, 20, 50].map((m) => pickOpt(m, `${m}×`, 'wheel')))];
  return [];
}

// ── cards ────────────────────────────────────────────────────────────────────────────
function playersBlock(t, L) {
  const rows = [...L.players.values()].map((p) => {
    const pk = pickLabel(t, L.game, p.pick);
    return `• **${p.name}** — ${n(p.bet)} ${L.cur}${pk ? ` · ${pk}` : ''}`;
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
    learnButton(t, 'live'),
  ];
  return {
    title: title(L),
    color: ui.BRAND,
    body: [t(`live.rules.${gameKey(L.game)}`), t('live.rules.pot2'), '', `### ${t('live.players', { n: have })}`, playersBlock(t, L), '', tableLine(t, L), status],
    footer: t('live.footer', { c: L.code }),
    buttons,
  };
}

function runningCard(L, lines) {
  return { title: title(L), color: 0x6b7280, body: lines, footer: L.t('live.footer', { c: L.code }), buttons: [] };
}

function closedCard(L, text) {
  return { title: title(L), color: 0x6b7280, body: text, buttons: [ui.btn(`cl:new:${L.game}`, L.t('live.again'), ButtonStyle.Primary, { emoji: 'again' }), learnButton(L.t, 'live')] };
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
export async function openLive(i, game, { bet = 0, pick = null, visibility = 'server' } = {}) {
  const { t, lang } = await tr(i);
  const { cfg, live, enabled, currency } = await liveConfig();
  const cur = curLabel(currency);
  if (!enabled) return ui.line(i, t('cas.off'), { title: `${ui.icx('casino')}${t('cas.title')}` });
  if (live[gameKey(game)] === false) return ui.line(i, t('live.off'), { title: `${ui.icx('casino')}${t('cas.title')}` });
  const L = reg.createLobby({
    game, hostId: i.user.id, hostName: nameOf(i), guildId: i.guildId || null, channelId: i.channelId, visibility,
    // `curPlain` is for text drawn INTO the GIF: the renderer has no colour-emoji font.
    players: new Map(), startAt: Date.now() + JOIN_MS, lang, t: makeT(lang, cfg.i18n), cur, curPlain: currency?.name || 'points', timer: null, shown: 1, lastSig: '',
  });
  // The host's own seat, when the command carried a bet. Refusals are ephemeral and the table
  // still opens: a host who typed a bet over the cap should not lose the table for it.
  let seatNote = '';
  if (bet > 0) { const r = await seat(L, i, { bet, pick }); if (!r.ok) seatNote = r.why; }
  // `withResponse` (not the deprecated `fetchReply`): the sent message rides in `resource`.
  const sent = await i.reply({ ...ui.card(lobbyCard(L)), withResponse: true }).then((r) => r?.resource?.message || null).catch(() => null);
  if (!sent) { reg.removeLobby(L.id); return; }
  L.mirrors[0].msg = sent; L.mirrors[0].messageId = sent.id;
  if (seatNote) await i.followUp({ content: seatNote, ephemeral: true }).catch(() => {});
  scheduleStart(L);
}

/** Seat a player: limits, link, balance, pick. Returns { ok } or { ok:false, why }. */
async function seat(L, i, { bet, pick = null }) {
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
  // `target` used to be read from a variable that does not exist here, which threw a
  // ReferenceError on EVERY seat: the join modal, and the host's own seat when `/casino`
  // carried a bet. A returning player's target is the only one there is.
  L.players.set(i.user.id, { name: nameOf(i), bet: b, pick: pick ?? prev?.pick ?? null, target: prev?.target ?? null, cashed: null, cashedAt: 0 });
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
    if (L.game === 'race') await runRace(L);
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
async function finish(L, plays, { outcome, gifOutcome, detail, amount, links = [] }) {
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
    // Against the house — a lone seat: its own line, by name.
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
    buttons: [ui.btn(`cl:new:${L.game}`, t('live.again'), ButtonStyle.Primary, { emoji: 'again' }), ui.btn('eco:level', t('btn.balance'), ButtonStyle.Secondary, { emoji: 'level' }), learnButton(t, 'live'), ...links],
  });
}

// The race film is a Paddock-Manager simulation, run fast: the result card says so and links it.
const PADDOCK_URL = 'https://github.com/coco-1er/Paddock-Manager';

async function runRace(L) {
  const t = L.t;
  const { casino } = await liveConfig();
  const laps = Math.min(12, Math.max(1, Math.floor(Number(casino.race?.laps)) || 3));
  // The winner is drawn uniformly HERE; the GIF's simulation is told and ends on it.
  const winner = Math.min(5, Math.floor(rnd() * 6));
  await redraw(L, runningCard(L, [t('live.race.go'), t('live.race.laps', { n: laps }), '', playersBlock(t, L)]));
  await sleep(1500);
  const plays = [...L.players.entries()].map(([id, p]) => ({ discordId: id, bet: p.bet, multiplier: Number(p.pick) === winner ? 6 : 0, note: `car${Number(p.pick) + 1}` }));
  const host = L.players.get(L.hostId);
  const car = `${ui.icx(CARS[winner])}${t(`live.race.car.${winner}`)}`;
  await finish(L, plays, { outcome: `${t('live.race.won', { c: car })}\n-# ${t('live.race.sim')}`, gifOutcome: t('live.gif.race', { c: `${TAGS[winner]} · ${t(`live.race.car.${winner}`)}` }), detail: `${winner}|${L.players.size === 1 && host ? host.pick ?? '' : ''}`, amount: n(plays.reduce((a, p) => a + (p.multiplier ? p.bet * 5 : -p.bet), 0)), links: [ui.btn(PADDOCK_URL, 'Paddock-Manager', ButtonStyle.Link, { emoji: 'race' })] });
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
  return modal;
}
/** Join by code: the code and the bet in ONE modal — a modal cannot open another. */
function codeModal(t, { min, max }, code = '') {
  const modal = new ModalBuilder().setCustomId('clm:code').setTitle(t('live.modal.code.title').slice(0, 45));
  modal.addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('code').setLabel(t('live.modal.code').slice(0, 45)).setStyle(TextInputStyle.Short).setPlaceholder('K7P2QX').setMinLength(6).setMaxLength(8).setRequired(true).setValue(code)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('bet').setLabel(t('live.modal.bet', { a: n(min), b: Number.isFinite(max) ? n(max) : '∞' }).slice(0, 45)).setStyle(TextInputStyle.Short).setPlaceholder('50').setMaxLength(9).setRequired(true)),
  );
  return modal;
}

/** `/casino join <code>` — the code's table, then the join modal (the bet). */
export async function joinByCode(i, code) {
  const { t } = await tr(i);
  const { casino } = await liveConfig();
  const L = reg.findByCode(code);
  if (!L) return ui.line(i, t('live.code.unknown'), { title: `${ui.icx('casino')}${t('cas.title')}` });
  const may = reg.canJoin(L, { guildId: i.guildId || null });
  if (!may.ok) return ui.line(i, t(may.why === 'serverOnly' ? 'live.code.serverOnly' : 'live.notOpen'));
  return i.showModal(joinModal(t, L, limits(casino)));
}

/**
 * `/casino lobbies` — the open tables this reader may see, each with a Join button.
 * `from` is the nav origin of whatever opened it (the casino table's own page, usually), so
 * this screen is no longer somewhere you arrive and can only leave by typing a command.
 */
export async function listLobbies(i, from = '') {
  const { t } = await tr(i);
  const rows = reg.listVisible({ guildId: i.guildId || null }).slice(0, 12);
  const body = rows.length ? t('live.lobbies.intro') : t('live.lobbies.none');
  return ui.reply(i, {
    title: `${ui.icx('casino')}${t('live.lobbies.title')}`,
    body,
    sections: rows.map((L) => ({ text: t('live.lobbies.row', { g: `${ui.ic(L.game) || ''} ${t(`game.${L.game}`)}`, c: L.code, n: L.players.size, u: L.hostName, v: visLabel(t, L.visibility) }), button: ui.btn(`cl:join:${L.id}`, t('live.join'), ButtonStyle.Primary) })),
    buttons: [ui.btn('cl:code', t('live.joinCode'), ButtonStyle.Secondary, { emoji: 'link' }), learnButton(t, 'live'), ...backButtons(t, from)],
  });
}

export async function liveComponent(i) {
  const [, verb, id, arg] = i.customId.split(':');
  const { t } = await tr(i);
  const { casino } = await liveConfig();
  const lim = limits(casino);
  if (verb === 'new') return openLive(i, id, {});
  if (verb === 'code') return i.showModal(codeModal(t, lim));
  // `cl:lobbies[:<origin>]` — the third field is where the presser was standing, not a lobby id.
  if (verb === 'lobbies') return listLobbies(i, id || '');
  const L = reg.getLobby(id);
  if (!L) return ui.line(i, t('live.gone'), { title: `${ui.icx('casino')}${t('cas.title')}` });
  if (verb === 'join') {
    const may = reg.canJoin(L, { guildId: i.guildId || null });
    if (!may.ok) return ui.line(i, t(may.why === 'serverOnly' ? 'live.code.serverOnly' : 'live.notOpen'));
    return i.showModal(joinModal(t, L, lim));
  }
  if (verb === 'pick') {
    const p = L.players.get(i.user.id);
    if (L.state !== 'open') return ui.line(i, t('live.notOpen'));
    if (!p) return ui.line(i, t('live.joinFirst'));
    // A button carries the pick in its custom id, a select in its value.
    const raw = arg ?? i.values?.[0];
    p.pick = L.game === 'race' || L.game === 'wheel' ? Number(raw) : raw;
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
  return i.deferUpdate().catch(() => {});
}

export async function liveModal(i) {
  const [, kind, id] = i.customId.split(':');
  const { t } = await tr(i);
  let L, bet;
  if (kind === 'code') {
    L = reg.findByCode(i.fields.getTextInputValue('code'));
    if (!L) return ui.line(i, t('live.code.unknown'), { title: `${ui.icx('casino')}${t('cas.title')}` });
    bet = Number((i.fields.getTextInputValue('bet') || '').replace(/[^0-9]/g, ''));
  } else {
    L = reg.getLobby(id);
    if (!L) return ui.line(i, t('live.gone'));
    bet = Number((i.fields.getTextInputValue('bet') || '').replace(/[^0-9]/g, ''));
  }
  const r = await seat(L, i, { bet });
  if (!r.ok) return ui.line(i, r.why);
  const pickNote = needsPick(L.game) && L.players.get(i.user.id)?.pick == null ? ` ${t('live.pickNow')}` : '';
  // A player from another channel (or server, or a DM) gets a MIRROR card there: the same
  // table, the same buttons, updated with the same state — results included.
  if (!reg.mirrorOf(L, i.channelId)) {
    const m = reg.addMirror(L, { channelId: i.channelId, guildId: i.guildId || null });
    if (m) {
      const sent = await i.reply({ ...ui.card(lobbyCard(L)), withResponse: true }).then((r) => r?.resource?.message || null).catch(() => null);
      if (sent) { m.msg = sent; m.messageId = sent.id; }
      await i.followUp({ content: t('live.joined', { n: n(bet), cur: L.cur, p: pickNote }), ephemeral: true }).catch(() => {});
      L.lastSig = ''; // the new mirror needs the next redraw even when nothing else changed
      return redraw(L, lobbyCard(L));
    }
  }
  await ui.line(i, t('live.joined', { n: n(bet), cur: L.cur, p: pickNote }));
  return redraw(L, lobbyCard(L));
}

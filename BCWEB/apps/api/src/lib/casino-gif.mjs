// Casino result animations — procedural 2.5D renders, encoded as animated GIF.
//
// One function per game draws frame N of a play that ENDS on the real outcome the bot
// rolled; the in-between motion is seeded per play so two identical outcomes still animate
// differently. Everything is vector canvas — no emoji, no assets: the server has no colour
// emoji font, so symbols are drawn by hand. 480×270, 34 frames, one 256-colour palette per
// clip, gifenc-encoded, cached by (game, outcome, detail, amount, seed) for five minutes.

// 60 frames at 33 ms ≈ 2 s of motion at 30 fps (was 34 × 42 ms, visibly steppy); the palette
// is still built once per clip, so encode time grows linearly and stays well under a second.
import { simulateRace, layoutTrack, drawTrack, drawRaceFrame, TRACK_COUNT } from './casino-race.mjs';

const W = 480, H = 270, FRAMES = 60, DELAY = 33;
const BANNER_H = 46, PLAY_BOTTOM = H - BANNER_H - 8; // nothing draws below this line
// The race is the long one: a 3-lap film with pit stops and a safety car needs the frames.
const CLIP = { race: { frames: 96, delay: 45 } };
const clipOf = (game) => CLIP[game] || { frames: FRAMES, delay: DELAY };

function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; };
}
const clamp01 = (t) => Math.min(1, Math.max(0, t));
const easeOut = (t) => 1 - Math.pow(1 - clamp01(t), 4); // quartic: a long, satisfying settle
const easeOutBack = (t) => { const c = 1.4; const u = clamp01(t) - 1; return 1 + (c + 1) * u * u * u + c * u * u; };

function felt(x, _win) {
  // ONE neutral table, win or lose: a green/red background from the first frame told you the
  // outcome before the spin finished, which is the whole thing the animation is for.
  const bg = x.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#14212c'); bg.addColorStop(1, '#0a0f1e');
  x.fillStyle = bg; x.fillRect(0, 0, W, H);
  const vg = x.createRadialGradient(W / 2, H / 2, 40, W / 2, H / 2, 330);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.55)');
  x.fillStyle = vg; x.fillRect(0, 0, W, H);
  x.font = 'bold 13px sans-serif'; x.textAlign = 'right'; x.fillStyle = 'rgba(255,255,255,0.35)';
  x.fillText('BetterCommunity', W - 14, 22);
}
// Drawn LAST, over the game: slides up at the end. Two shapes:
//   · single seat  — "YOU WIN +X" / "YOU LOSE −X" (the classic);
//   · a table      — the OUTCOME line ("BLU wins", "Crashed at 2.31×") over the WINNERS line
//                    ("Alice wins 300", "2 players win — Alice 120 · Bob 80", "Nobody wins —
//                    stakes returned"): the GIF carries the result, the card adds one line.
function banner(x, win, amount, t, text) {
  if (t <= 0.8) return;
  const tall = !!(text && (text.outcome || text.winners));
  const bh = (tall ? 62 : BANNER_H) * easeOut((t - 0.8) / 0.2);
  x.fillStyle = tall ? 'rgba(17,24,39,0.96)' : 'rgba(107,114,128,0.96)'; x.fillRect(0, H - bh, W, bh);
  if (t <= 0.86) return;
  x.textAlign = 'center'; x.fillStyle = '#ffffff';
  if (!tall) { x.font = 'bold 22px sans-serif'; x.fillText(win ? `YOU WIN  +${amount}` : `YOU LOSE  −${amount}`, W / 2, H - 15); return; }
  if (text.outcome) { x.font = 'bold 19px sans-serif'; x.fillStyle = '#fbbf24'; x.fillText(fit(x, text.outcome, W - 40), W / 2, H - 36); }
  if (text.winners) { x.font = 'bold 14px sans-serif'; x.fillStyle = '#fff'; x.fillText(fit(x, text.winners, W - 40), W / 2, H - 13); }
}
// The table's title, top-left, from the first frame (the table's name and its code).
function titleBar(x, text) {
  if (!text?.title) return;
  x.font = 'bold 13px sans-serif'; x.textAlign = 'left'; x.fillStyle = 'rgba(255,255,255,0.55)';
  x.fillText(fit(x, text.title, 220), 14, 22);
}
function fit(x, s, maxW) { let str = String(s); while (str.length > 3 && x.measureText(str).width > maxW) str = str.slice(0, -2).trimEnd() + '…'; return str; }
function label(x, text, cx, cy, size = 22) {
  x.font = `bold ${size}px sans-serif`; x.textAlign = 'center'; x.lineWidth = 4; x.strokeStyle = 'rgba(0,0,0,0.6)';
  x.strokeText(text, cx, cy); x.fillStyle = '#fff'; x.fillText(text, cx, cy);
}

// ── Slot symbols, as vectors ─────────────────────────────────────────────────
const SLOT_SYMS = ['cherry', 'lemon', 'bell', 'star', 'diamond'];
const SYM_ALIAS = { '🍒': 'cherry', '🍋': 'lemon', '🔔': 'bell', '⭐': 'star', '💎': 'diamond' };
function drawSymbol(x, name, cx, cy, s) {
  x.save(); x.translate(cx, cy);
  if (name === 'cherry') {
    x.strokeStyle = '#2e7d32'; x.lineWidth = s * 0.08; x.beginPath(); x.moveTo(-s * 0.15, s * 0.1); x.quadraticCurveTo(0, -s * 0.5, s * 0.22, -s * 0.45); x.stroke();
    x.beginPath(); x.moveTo(s * 0.18, s * 0.05); x.quadraticCurveTo(s * 0.1, -s * 0.4, s * 0.22, -s * 0.45); x.stroke();
    for (const [dx, dy] of [[-s * 0.16, s * 0.22], [s * 0.2, s * 0.2]]) {
      const g = x.createRadialGradient(dx - s * 0.06, dy - s * 0.08, s * 0.02, dx, dy, s * 0.2); g.addColorStop(0, '#ff6b6b'); g.addColorStop(1, '#b71c1c');
      x.fillStyle = g; x.beginPath(); x.arc(dx, dy, s * 0.2, 0, Math.PI * 2); x.fill();
    }
  } else if (name === 'lemon') {
    const g = x.createRadialGradient(-s * 0.1, -s * 0.12, s * 0.05, 0, 0, s * 0.4); g.addColorStop(0, '#fff59d'); g.addColorStop(1, '#f9a825');
    x.fillStyle = g; x.beginPath(); x.ellipse(0, 0, s * 0.38, s * 0.27, -0.5, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#7cb342'; x.beginPath(); x.ellipse(s * 0.3, -s * 0.25, s * 0.1, s * 0.05, -0.6, 0, Math.PI * 2); x.fill();
  } else if (name === 'bell') {
    const g = x.createLinearGradient(-s * 0.3, 0, s * 0.3, 0); g.addColorStop(0, '#ffe082'); g.addColorStop(1, '#f9a825');
    x.fillStyle = g; x.beginPath(); x.moveTo(-s * 0.32, s * 0.22); x.quadraticCurveTo(-s * 0.3, -s * 0.3, 0, -s * 0.36); x.quadraticCurveTo(s * 0.3, -s * 0.3, s * 0.32, s * 0.22); x.closePath(); x.fill();
    x.fillStyle = '#e65100'; x.fillRect(-s * 0.36, s * 0.2, s * 0.72, s * 0.07);
    x.fillStyle = '#ffb300'; x.beginPath(); x.arc(0, s * 0.32, s * 0.07, 0, Math.PI * 2); x.fill();
  } else if (name === 'star') {
    x.fillStyle = '#ffd54f'; x.beginPath();
    for (let i = 0; i < 10; i++) { const r = i % 2 ? s * 0.17 : s * 0.4; const a = -Math.PI / 2 + (i * Math.PI) / 5; x.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
    x.closePath(); x.fill(); x.strokeStyle = '#f57f17'; x.lineWidth = s * 0.03; x.stroke();
  } else { // diamond
    x.fillStyle = '#4fc3f7'; x.beginPath(); x.moveTo(-s * 0.36, -s * 0.12); x.lineTo(-s * 0.18, -s * 0.34); x.lineTo(s * 0.18, -s * 0.34); x.lineTo(s * 0.36, -s * 0.12); x.lineTo(0, s * 0.38); x.closePath(); x.fill();
    x.fillStyle = 'rgba(255,255,255,0.45)'; x.beginPath(); x.moveTo(-s * 0.18, -s * 0.34); x.lineTo(0, -s * 0.12); x.lineTo(-s * 0.36, -s * 0.12); x.closePath(); x.fill();
    x.strokeStyle = '#0277bd'; x.lineWidth = s * 0.03; x.beginPath(); x.moveTo(-s * 0.36, -s * 0.12); x.lineTo(s * 0.36, -s * 0.12); x.moveTo(-s * 0.18, -s * 0.34); x.lineTo(0, -s * 0.12); x.lineTo(s * 0.18, -s * 0.34); x.stroke();
  }
  x.restore();
}
function drawSlots(x, f, { reels, r }) {
  const bw = 118, bh = 150, gap = 16, x0 = W / 2 - (bw * 3 + gap * 2) / 2, y0 = 36, cell = 84;
  const stopAt = [0.42, 0.58, 0.74];
  const t = f / (FRAMES - 1);
  // cabinet
  x.fillStyle = 'rgba(255,255,255,0.04)'; x.beginPath(); x.roundRect(x0 - 16, y0 - 14, bw * 3 + gap * 2 + 32, bh + 28, 20); x.fill();
  reels.forEach((sym, i) => {
    const rx = x0 + i * (bw + gap);
    const g = x.createLinearGradient(0, y0, 0, y0 + bh); g.addColorStop(0, '#111827'); g.addColorStop(0.5, '#1f2937'); g.addColorStop(1, '#111827');
    x.fillStyle = g; x.strokeStyle = 'rgba(255,255,255,0.2)'; x.lineWidth = 2;
    x.beginPath(); x.roundRect(rx, y0, bw, bh, 14); x.fill(); x.stroke();
    x.save(); x.beginPath(); x.rect(rx, y0, bw, bh); x.clip();
    const u = t < stopAt[i] ? 0 : clamp01((t - stopAt[i]) / 0.14); // 0 spinning → 1 stopped
    const spinning = u < 1;
    const speed = (1 - easeOut(u)) * 58;
    const finalIdx = SLOT_SYMS.indexOf(sym);
    const scroll = (f * speed + r.k[i] * 400);
    // a small settle-bounce when the reel stops
    const bounce = u >= 1 ? 0 : (u > 0.85 ? Math.sin((u - 0.85) / 0.15 * Math.PI) * 6 : 0);
    for (let j = -2; j <= 2; j++) {
      const idx = spinning ? ((Math.floor(scroll / cell) + j + 40) % SLOT_SYMS.length) : ((finalIdx + j + 10) % SLOT_SYMS.length);
      const y = y0 + bh / 2 + j * cell - (spinning ? scroll % cell : 0) + bounce;
      if (spinning && speed > 20) { x.globalAlpha = 0.35; drawSymbol(x, SLOT_SYMS[idx], rx + bw / 2, y - 10, 62); drawSymbol(x, SLOT_SYMS[idx], rx + bw / 2, y + 10, 62); x.globalAlpha = 1; }
      else drawSymbol(x, SLOT_SYMS[idx], rx + bw / 2, y, 62);
    }
    x.restore();
    // glass highlight
    const hl = x.createLinearGradient(0, y0, 0, y0 + bh); hl.addColorStop(0, 'rgba(255,255,255,0.12)'); hl.addColorStop(0.5, 'rgba(255,255,255,0)'); hl.addColorStop(1, 'rgba(0,0,0,0.35)');
    x.fillStyle = hl; x.beginPath(); x.roundRect(rx, y0, bw, bh, 14); x.fill();
  });
  x.strokeStyle = 'rgba(255,215,0,0.7)'; x.lineWidth = 2; x.beginPath(); x.moveTo(x0 - 10, y0 + bh / 2); x.lineTo(x0 + bw * 3 + gap * 2 + 10, y0 + bh / 2); x.stroke();
}

// ── Coin ────────────────────────────────────────────────────────────────────
function drawCoin(x, f, { heads, r }) {
  const t = f / (FRAMES - 1); const spins = 5 + Math.floor(r.k[0] * 3);
  const ang = easeOut(t) * (spins * 2 * Math.PI + (heads ? 0 : Math.PI));
  const squash = Math.abs(Math.cos(ang)); const front = Math.cos(ang) >= 0 ? heads : !heads;
  const cx = W / 2, cy = H / 2 - 20 - Math.sin(Math.PI * clamp01(t * 1.15)) * 60 * (1 - t); const R = 72;
  x.fillStyle = 'rgba(0,0,0,0.35)'; x.beginPath(); x.ellipse(cx, PLAY_BOTTOM - 6, R * 0.9 * Math.max(0.3, squash), 10, 0, 0, Math.PI * 2); x.fill();
  x.save(); x.translate(cx, cy); x.scale(Math.max(0.06, squash), 1);
  const g = x.createRadialGradient(-20, -20, 10, 0, 0, R); g.addColorStop(0, '#ffe9a3'); g.addColorStop(1, '#b8860b');
  x.fillStyle = g; x.beginPath(); x.arc(0, 0, R, 0, Math.PI * 2); x.fill(); x.lineWidth = 6; x.strokeStyle = '#8a6508'; x.stroke();
  x.fillStyle = '#7a5a06'; x.font = 'bold 60px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(front ? 'H' : 'T', 0, 4); x.textBaseline = 'alphabetic';
  x.restore();
}

// ── Dice ────────────────────────────────────────────────────────────────────
const PIPS = { 1: [[0, 0]], 2: [[-1, -1], [1, 1]], 3: [[-1, -1], [0, 0], [1, 1]], 4: [[-1, -1], [1, -1], [-1, 1], [1, 1]], 5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]], 6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]] };
function face(x, cx, cy, s, n, rot) {
  x.save(); x.translate(cx, cy); x.rotate(rot);
  x.fillStyle = '#f4f1ea'; x.strokeStyle = '#c9c4b8'; x.lineWidth = 3; x.beginPath(); x.roundRect(-s / 2, -s / 2, s, s, s * 0.16); x.fill(); x.stroke();
  x.fillStyle = '#1b1f2a'; for (const [px, py] of PIPS[n]) { x.beginPath(); x.arc(px * s * 0.28, py * s * 0.28, s * 0.075, 0, Math.PI * 2); x.fill(); }
  x.restore();
}
function drawDice(x, f, { roll, r }) {
  const t = f / (FRAMES - 1); const e = easeOut(t);
  const rot = (1 - e) * (3 + Math.floor(r.k[0] * 2)) * Math.PI * 2;
  const cx = W / 2 + (1 - e) * (r.k[1] - 0.5) * 240;
  const cy = H / 2 - 15 - Math.abs(Math.sin(t * Math.PI * 3)) * 40 * (1 - e);
  const shown = e < 0.92 ? 1 + Math.floor(r.k[2 + (f % 6)] * 6) : roll;
  x.fillStyle = 'rgba(0,0,0,0.35)'; x.beginPath(); x.ellipse(W / 2, PLAY_BOTTOM - 4, 70, 10, 0, 0, Math.PI * 2); x.fill();
  face(x, cx, cy, 110, shown, rot);
}

// ── Roulette — a proper wheel: outer rim, number ring, cone, ball track with a bounce ──
const REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const WHEEL = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
const colourOf = (v) => (v === 0 ? 'green' : REDS.has(v) ? 'red' : 'black');
function drawRoulette(x, f, { pocket, r }) {
  const t = f / (FRAMES - 1); const e = easeOut(t);
  const cx = W / 2, cy = (PLAY_BOTTOM + 30) / 2, R = 96; const n = WHEEL.length; const slot = (Math.PI * 2) / n;
  const idx = WHEEL.indexOf(pocket);
  const wheelRot = (1 - e) * (2 + r.k[0]) * Math.PI * 2;
  // wooden rim + ball track
  const rim = x.createRadialGradient(cx, cy, R, cx, cy, R + 22); rim.addColorStop(0, '#5d4037'); rim.addColorStop(1, '#3e2723');
  x.fillStyle = rim; x.beginPath(); x.arc(cx, cy, R + 22, 0, Math.PI * 2); x.fill();
  x.strokeStyle = '#d4af37'; x.lineWidth = 2; x.beginPath(); x.arc(cx, cy, R + 12, 0, Math.PI * 2); x.stroke();
  x.save(); x.translate(cx, cy); x.rotate(wheelRot);
  for (let i = 0; i < n; i++) {
    const v = WHEEL[i];
    x.beginPath(); x.moveTo(0, 0); x.arc(0, 0, R, i * slot - Math.PI / 2, (i + 1) * slot - Math.PI / 2); x.closePath();
    x.fillStyle = v === 0 ? '#1e8449' : REDS.has(v) ? '#c0392b' : '#1b1f2a'; x.fill();
    x.strokeStyle = '#d4af37'; x.lineWidth = 1; x.stroke();
    x.save(); x.rotate((i + 0.5) * slot - Math.PI / 2); x.fillStyle = '#fff'; x.font = 'bold 9px sans-serif'; x.textAlign = 'center'; x.fillText(String(v), R - 13, 3); x.restore();
  }
  // cone + hub
  const cone = x.createRadialGradient(0, 0, 10, 0, 0, R * 0.62); cone.addColorStop(0, '#2b2f3a'); cone.addColorStop(1, '#0a0f1e');
  x.beginPath(); x.arc(0, 0, R * 0.62, 0, Math.PI * 2); x.fillStyle = cone; x.fill(); x.lineWidth = 3; x.strokeStyle = '#d4af37'; x.stroke();
  for (let k = 0; k < 4; k++) { x.save(); x.rotate((k * Math.PI) / 2); x.fillStyle = '#d4af37'; x.beginPath(); x.roundRect(-3, -R * 0.55, 6, R * 0.3, 3); x.fill(); x.restore(); }
  x.restore();
  // ball: fast on the outer track, then spirals down into the pocket with a tiny bounce
  const pocketAng = wheelRot + (idx + 0.5) * slot - Math.PI / 2;
  const orbit = -(1 - e) * (4 + r.k[1] * 2) * Math.PI * 2 + pocketAng;
  const drop = clamp01((t - 0.55) / 0.35);
  const rad = (R + 8) - (R + 8 - (R - 14)) * easeOutBack(drop) * 0.92;
  const bx = cx + Math.cos(orbit) * rad, by = cy + Math.sin(orbit) * rad;
  x.fillStyle = 'rgba(0,0,0,0.4)'; x.beginPath(); x.arc(bx + 2, by + 3, 6, 0, Math.PI * 2); x.fill();
  const bg = x.createRadialGradient(bx - 2, by - 2, 1, bx, by, 6); bg.addColorStop(0, '#ffffff'); bg.addColorStop(1, '#cfd8dc');
  x.fillStyle = bg; x.beginPath(); x.arc(bx, by, 6, 0, Math.PI * 2); x.fill();
  if (t > 0.9) label(x, `${pocket} ${colourOf(pocket)}`, cx, cy + 7, 18);
}

// ── Wheel of multipliers — bigger multiplier = thinner slice ───────────────────
// Slices (weights out of 100): 2× ×45, 3× ×24, 5× ×16, 10× ×9, 20× ×4, 50× ×2.
export const WHEEL_SLICES = [[2, 45], [3, 24], [5, 16], [10, 9], [20, 4], [50, 2]];
const WHEEL_COLORS = { 2: '#546e7a', 3: '#1e88e5', 5: '#43a047', 10: '#fb8c00', 20: '#8e24aa', 50: '#e53935' };
// The physical wheel is 100 thin segments in an interleaved order, so a 50× slice is a sliver
// between common ones — what the player sees is what the odds are.
function wheelSegments() {
  const segs = []; const pool = WHEEL_SLICES.map(([m, w]) => ({ m, left: w }));
  for (let i = 0; i < 100; i++) { const cand = pool.filter((p) => p.left > 0); const p = cand[i % cand.length]; p.left--; segs.push(p.m); }
  // shuffle deterministically so rare slices are spread out
  let s = 7; for (let i = segs.length - 1; i > 0; i--) { s = (s * 9301 + 49297) % 233280; const j = s % (i + 1); [segs[i], segs[j]] = [segs[j], segs[i]]; }
  return segs;
}
const SEGS = wheelSegments();
function drawWheel(x, f, { mult, target, r }) {
  const t = f / (FRAMES - 1); const e = easeOut(t);
  const cx = W / 2, cy = (PLAY_BOTTOM + 30) / 2 + 4, R = 100; const n = SEGS.length; const slot = (Math.PI * 2) / n;
  // pick a segment with the landed multiplier (seeded), aim it at the pointer (top)
  const idxs = SEGS.map((m, i) => (m === mult ? i : -1)).filter((i) => i >= 0); const idx = idxs[Math.floor(r.k[0] * idxs.length)];
  const finalRot = -((idx + 0.5) * slot) - Math.PI / 2 + Math.PI / 2; // segment centre under the pointer at -π/2
  const rot = finalRot - (1 - e) * (3 + r.k[1] * 2) * Math.PI * 2;
  x.save(); x.translate(cx, cy); x.rotate(rot);
  for (let i = 0; i < n; i++) {
    x.beginPath(); x.moveTo(0, 0); x.arc(0, 0, R, i * slot - Math.PI / 2, (i + 1) * slot - Math.PI / 2); x.closePath();
    x.fillStyle = WHEEL_COLORS[SEGS[i]]; x.fill();
  }
  x.strokeStyle = '#fff'; x.lineWidth = 3; x.beginPath(); x.arc(0, 0, R, 0, Math.PI * 2); x.stroke();
  x.beginPath(); x.arc(0, 0, 26, 0, Math.PI * 2); x.fillStyle = '#0a0f1e'; x.fill(); x.stroke();
  x.restore();
  // pointer
  x.fillStyle = '#fff'; x.beginPath(); x.moveTo(cx - 12, cy - R - 14); x.lineTo(cx + 12, cy - R - 14); x.lineTo(cx, cy - R + 8); x.closePath(); x.fill();
  // legend
  x.font = 'bold 11px sans-serif'; x.textAlign = 'left';
  WHEEL_SLICES.forEach(([m, w], i) => { const ly = 40 + i * 20; x.fillStyle = WHEEL_COLORS[m]; x.fillRect(16, ly - 9, 12, 12); x.fillStyle = m === target ? '#fff' : 'rgba(255,255,255,0.6)'; x.fillText(`${m}×  ${w}%${m === target ? '  ◀ your target' : ''}`, 34, ly + 1); });
  if (t > 0.9) label(x, `${mult}×`, cx, cy + 8, 24);
}

// ── Plinko — a ball bounces down a peg triangle into a multiplier bucket ─────
// Bucket multipliers per risk (11 buckets, symmetric). Edges pay big, centre pays little.
export const PLINKO_ROWS = 10;
export const PLINKO_BUCKETS = {
  low:    [5, 3, 1.5, 1.2, 1, 0.5, 1, 1.2, 1.5, 3, 5],
  medium: [13, 4, 2, 1.2, 0.6, 0.3, 0.6, 1.2, 2, 4, 13],
  high:   [50, 10, 3, 1, 0.3, 0.2, 0.3, 1, 3, 10, 50],
};
function drawPlinko(x, f, { path, risk, bucket, r }) {
  const t = f / (FRAMES - 1);
  const rows = PLINKO_ROWS, top = 34, bottom = PLAY_BOTTOM - 26, dy = (bottom - top) / rows, dx = 30;
  const cx = W / 2;
  // pegs
  x.fillStyle = 'rgba(255,255,255,0.75)';
  for (let row = 0; row < rows; row++) for (let i = 0; i <= row; i++) { const px = cx + (i - row / 2) * dx, py = top + row * dy; x.beginPath(); x.arc(px, py, 3, 0, Math.PI * 2); x.fill(); }
  // buckets
  const mults = PLINKO_BUCKETS[risk] || PLINKO_BUCKETS.medium; const bw = dx, by = bottom + 4;
  mults.forEach((m, i) => { const bx = cx + (i - 5) * bw; const hot = m >= 5 ? '#e53935' : m >= 2 ? '#fb8c00' : m >= 1 ? '#43a047' : '#546e7a';
    x.fillStyle = i === bucket && t > 0.92 ? '#fff' : hot; x.beginPath(); x.roundRect(bx - bw / 2 + 2, by, bw - 4, 18, 4); x.fill();
    x.fillStyle = i === bucket && t > 0.92 ? '#0a0f1e' : '#fff'; x.font = 'bold 9px sans-serif'; x.textAlign = 'center'; x.fillText(`${m}×`, bx, by + 13); });
  // ball along its path: row index advances with time; between pegs it arcs
  const prog = clamp01(t / 0.9) * rows; const row = Math.min(rows - 1, Math.floor(prog)); const u = prog - row;
  let pos = 0; for (let i = 0; i < row; i++) pos += path[i]; // net rightward steps so far
  const fromX = cx + (pos - row / 2) * dx, toX = cx + ((pos + path[row]) - (row + 1) / 2) * dx;
  const bxp = fromX + (toX - fromX) * u, byp = top + row * dy + dy * u - Math.sin(u * Math.PI) * 10;
  const ballY = t >= 0.9 ? by - 8 : byp - 8, ballX = t >= 0.9 ? cx + (bucket - 5) * bw : bxp;
  x.fillStyle = 'rgba(0,0,0,0.4)'; x.beginPath(); x.arc(ballX + 2, ballY + 3, 7, 0, Math.PI * 2); x.fill();
  const g = x.createRadialGradient(ballX - 2, ballY - 2, 1, ballX, ballY, 7); g.addColorStop(0, '#fff'); g.addColorStop(1, '#ffca28');
  x.fillStyle = g; x.beginPath(); x.arc(ballX, ballY, 7, 0, Math.PI * 2); x.fill();
  x.font = 'bold 11px sans-serif'; x.textAlign = 'left'; x.fillStyle = 'rgba(255,255,255,0.6)'; x.fillText(`risk: ${risk}`, 16, 30);
}

const cache = new Map(); const TTL = 5 * 60 * 1000;

// ── Crash — a multiplier climbs along a curve and breaks ─────────────────────────────
// The curve is drawn in a chart box: time along the bottom, multiplier up the side. It climbs
// to `crashAt` over the first 85 % of the clip, then the line snaps red and the label reads
// the crash point. Cash-out markers (each player who got out, or the single player's own)
// are pinned on the curve as they are passed — so a win is visibly "got out here" and a loss
// is visibly "the curve went past you and broke".
function drawCrash(x, f, { crashAt, cashes, r }) {
  const t = f / (FRAMES - 1);
  x.textBaseline = 'alphabetic';
  const L = 44, T = 26, Rr = W - 22, B = PLAY_BOTTOM - 22;
  // Chart box
  x.fillStyle = 'rgba(255,255,255,0.05)'; x.beginPath(); x.roundRect(L - 8, T - 8, Rr - L + 16, B - T + 16, 10); x.fill();
  x.strokeStyle = 'rgba(255,255,255,0.14)'; x.lineWidth = 1;
  const top = Math.max(2, crashAt * 1.15);
  const yOf = (m) => B - ((m - 1) / (top - 1)) * (B - T);
  for (const g of [1.5, 2, 3, 5, 10, 20, 50]) {
    if (g >= top) break;
    const y = yOf(g); x.beginPath(); x.moveTo(L, y); x.lineTo(Rr, y); x.stroke();
    x.font = '11px sans-serif'; x.textAlign = 'left'; x.fillStyle = 'rgba(255,255,255,0.4)'; x.fillText(`${g}×`, L + 4, y - 3);
  }
  // Progress along the curve: 85 % of the frames climbing, then the break.
  const climb = clamp01(t / 0.85);
  const broke = t >= 0.85;
  // m(s) = 1 + (crashAt − 1)·s^1.6 — slow start, steep end, like the real thing.
  const mAt = (s) => 1 + (crashAt - 1) * Math.pow(s, 1.6);
  x.lineWidth = 4; x.strokeStyle = broke ? '#ef4444' : '#22c55e'; x.lineJoin = 'round';
  x.beginPath();
  const N = 60;
  for (let i = 0; i <= N; i++) {
    const s = (i / N) * climb; const px = L + s * (Rr - L); const py = yOf(mAt(s));
    if (i === 0) x.moveTo(px, py); else x.lineTo(px, py);
  }
  x.stroke();
  // Fill under the curve
  x.lineTo(L + climb * (Rr - L), B); x.lineTo(L, B); x.closePath();
  x.fillStyle = broke ? 'rgba(239,68,68,0.12)' : 'rgba(34,197,94,0.12)'; x.fill();
  // Markers for every cash-out already passed
  const curM = mAt(climb);
  // Each cash-out is a pin with the player's name: "who got out where" is the story.
  let lastY = -99;
  for (const { m: c, name } of cashes) {
    if (c > curM || c > crashAt) continue;
    const s = Math.pow((c - 1) / Math.max(1e-6, crashAt - 1), 1 / 1.6);
    const px = L + s * (Rr - L), py = yOf(c);
    x.fillStyle = '#fbbf24'; x.beginPath(); x.arc(px, py, 6, 0, Math.PI * 2); x.fill();
    x.lineWidth = 2; x.strokeStyle = '#0a0f1e'; x.stroke();
    const ly = Math.abs(py - lastY) < 14 ? lastY - 14 : py - 10; lastY = ly;
    x.font = 'bold 12px sans-serif'; x.textAlign = 'center'; x.lineWidth = 3; x.strokeStyle = 'rgba(0,0,0,0.7)';
    const txt = name ? `${name} · ${c.toFixed(2)}×` : `${c.toFixed(2)}×`;
    x.strokeText(txt, px, ly); x.fillStyle = '#fbbf24'; x.fillText(txt, px, ly);
  }
  // The big number
  const shown = broke ? crashAt : curM;
  label(x, `${shown.toFixed(2)}×`, W / 2, T + 44, broke ? 34 : 30);
  if (broke) {
    // A little burst at the break point
    const bx = L + (Rr - L), by = yOf(crashAt); const k = clamp01((t - 0.85) / 0.15);
    x.strokeStyle = 'rgba(239,68,68,0.9)'; x.lineWidth = 3;
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 + r.k[0]; x.beginPath(); x.moveTo(bx, by); x.lineTo(bx + Math.cos(a) * 14 * k, by + Math.sin(a) * 14 * k); x.stroke(); }
    label(x, 'CRASH', W / 2, T + 78, 22);
  }
}

// ── Race — a track map, see casino-race.mjs ────────────────────────────────────────────
// The track is picked by the seed and drawn once per frame (cheap: one polyline); the
// simulation runs once per clip. The finish is the drawn winner's.
function raceSetup(p, frames) {
  const box = { x: 40, y: 30, w: W - 60, h: PLAY_BOTTOM - 36 };
  p.track = layoutTrack(Math.floor(p.r.k[2] * TRACK_COUNT), box);
  p.sim = simulateRace({ winner: p.winner, seed: p.seed, frames, pitIn: p.track.pitIn, pitSpan: p.track.pitSpan });
}
function drawRace(x, f, p) {
  drawTrack(x, p.track);
  drawRaceFrame(x, p.track, p.sim, f, { pick: p.pick, frames: p.frames, W });
  x.font = 'bold 9px sans-serif'; x.textAlign = 'right'; x.fillStyle = 'rgba(255,255,255,0.35)'; x.fillText(p.track.name.toUpperCase(), W - 14, PLAY_BOTTOM + 4);
  // The winner is the banner's line (or "YOU WIN" alone at the table): no second label.
}

// ── Pot — one slice per player, sized by stake, a pointer that settles on the winner ──
const POT_COLOURS = ['#ef4444', '#3b82f6', '#22c55e', '#facc15', '#a855f7', '#f97316', '#14b8a6', '#ec4899'];
function drawPot(x, f, { winner, stakes, labels, r }) {
  const t = f / (FRAMES - 1);
  const total = stakes.reduce((a, b) => a + b, 0) || 1;
  const cx = W / 2, cy = (PLAY_BOTTOM + 8) / 2, R = Math.min(96, (PLAY_BOTTOM - 20) / 2);
  // Where the winner's slice sits, so the pointer (fixed at the top) ends inside it.
  let acc = 0; const arcs = stakes.map((s) => { const a0 = acc / total; acc += s; return [a0, acc / total]; });
  const [w0, w1] = arcs[winner] || [0, 1];
  const target = -((w0 + w1) / 2) * Math.PI * 2 - Math.PI / 2; // slice centre under the top pointer
  const spins = 4 + Math.floor(r.k[0] * 3);
  const rot = easeOut(t) * (spins * Math.PI * 2) + target * easeOut(t) + (1 - easeOut(t)) * r.k[1] * Math.PI * 2;
  x.save(); x.translate(cx, cy); x.rotate(rot);
  arcs.forEach(([a0, a1], i) => {
    x.beginPath(); x.moveTo(0, 0); x.arc(0, 0, R, a0 * Math.PI * 2, a1 * Math.PI * 2); x.closePath();
    x.fillStyle = POT_COLOURS[i % POT_COLOURS.length]; x.fill(); x.strokeStyle = '#0a0f1e'; x.lineWidth = 2; x.stroke();
    const mid = ((a0 + a1) / 2) * Math.PI * 2;
    if (a1 - a0 > 0.06) {
      x.save(); x.rotate(mid); x.translate(R * 0.62, 0); x.rotate(-mid - rot);
      x.font = 'bold 12px sans-serif'; x.textAlign = 'center'; x.fillStyle = '#fff'; x.fillText(String(labels[i] || i + 1).slice(0, 8), 0, 4);
      x.restore();
    }
  });
  x.restore();
  // Hub + pointer
  x.fillStyle = '#0a0f1e'; x.beginPath(); x.arc(cx, cy, 14, 0, Math.PI * 2); x.fill();
  x.fillStyle = '#fbbf24'; x.beginPath(); x.moveTo(cx - 10, cy - R - 12); x.lineTo(cx + 10, cy - R - 12); x.lineTo(cx, cy - R + 8); x.closePath(); x.fill();
  // The winner's name is the banner's line — see `banner`.
}

/** Render one play as an animated GIF. `detail` is the same short string the PNG route takes:
 *  slots "cherry lemon bell" (emoji accepted) · coinflip "H"/"T" · dice "1".."6" ·
 *  roulette "17" · wheel "10|2" (landed|target) · plinko "medium|LRLRLLRRLR|bucketIdx". */
/** The per-clip setup shared by the GIF and the frame-PNG debug/test helper below. */
async function setup({ game, win, detail, amount, seed, text = null }) {
  const { createCanvas } = await import('@napi-rs/canvas');
  const r = { k: Array.from({ length: 12 }, rng(seed)) };
  const { frames: NF, delay } = clipOf(game);
  const p = { r, seed, frames: NF };
  if (game === 'slots') p.reels = (detail || 'cherry lemon bell').split(/\s+/).slice(0, 3).map((s) => SYM_ALIAS[s] || (SLOT_SYMS.includes(s) ? s : 'cherry'));
  else if (game === 'coinflip') p.heads = /H|🪙|heads/i.test(detail || 'H');
  else if (game === 'dice') p.roll = Math.min(6, Math.max(1, parseInt(detail, 10) || 1));
  else if (game === 'roulette') p.pocket = Math.min(36, Math.max(0, parseInt(detail, 10) || 0));
  else if (game === 'wheel') { const [m, tg] = String(detail || '2|2').split('|'); p.mult = Number(m) || 2; p.target = Number(tg) || 2; }
  else if (game === 'plinko') { const [risk, path, b] = String(detail || 'medium||5').split('|'); p.risk = PLINKO_BUCKETS[risk] ? risk : 'medium'; p.path = Array.from({ length: PLINKO_ROWS }, (_, i) => (path[i] === 'R' ? 1 : 0)); p.bucket = Math.min(10, Math.max(0, parseInt(b, 10) || 5)); }
  else if (game === 'crash') {
    // "crashAt|name@m,name@m" — or bare multipliers, which draw without a name.
    const [c, list] = String(detail || '2|').split('|'); p.crashAt = Math.max(1, Math.min(10000, Number(c) || 1));
    p.cashes = String(list || '').split(',').filter(Boolean).map((s0) => { const [a, b] = s0.includes('@') ? s0.split('@') : ['', s0]; return { name: a.replace(/[^\w\-]/g, '').slice(0, 10), m: Number(b) }; }).filter((v) => Number.isFinite(v.m) && v.m >= 1).slice(0, 8);
  }
  else if (game === 'race') { const [wnr, pk] = String(detail || '0|0').split('|'); p.winner = Math.min(5, Math.max(0, parseInt(wnr, 10) || 0)); p.pick = pk === '' || pk == null ? -1 : Math.min(5, Math.max(-1, parseInt(pk, 10))); }
  else if (game === 'pot') { const [wnr, st, lb] = String(detail || '0|1,1|A,B').split('|'); p.stakes = String(st || '1').split(',').map((v) => Math.max(0, Number(v) || 0)).slice(0, 8); if (!p.stakes.length) p.stakes = [1]; p.winner = Math.min(p.stakes.length - 1, Math.max(0, parseInt(wnr, 10) || 0)); p.labels = String(lb || '').split(',').slice(0, 8); }
  const draw = { slots: drawSlots, coinflip: drawCoin, dice: drawDice, roulette: drawRoulette, wheel: drawWheel, plinko: drawPlinko, crash: drawCrash, race: drawRace, pot: drawPot }[game];
  if (!draw) throw new Error('unknown game');
  if (game === 'race') raceSetup(p, NF);
  const c = createCanvas(W, H); const x = c.getContext('2d');
  const frame = (fi) => { const t = fi / (NF - 1); felt(x, win); draw(x, fi, p); titleBar(x, text); banner(x, win, amount, t, text); };
  return { canvas: c, ctx: x, frame, NF, delay, p };
}

/** Render one play as an animated GIF. `detail` is the same short string the PNG route takes:
 *  slots "cherry lemon bell" (emoji accepted) · coinflip "H"/"T" · dice "1".."6" ·
 *  roulette "17" · wheel "10|2" (landed|target) · plinko "medium|LRLRLLRRLR|bucketIdx" ·
 *  crash "2.31|Alice@1.8,Bob@2.1" · race "winnerIdx|pickIdx" · pot "winnerIdx|stakes|labels".
 *  `text` ({ title, outcome, winners }) is drawn INTO the frames — the GIF carries the result. */
export async function renderCasinoGif({ game, win, detail, amount, seed, text = null }) {
  const key = `${game}|${win}|${detail}|${amount}|${seed}|${text ? [text.title, text.outcome, text.winners].join('|') : ''}`;
  const hit = cache.get(key); if (hit && hit.t > Date.now() - TTL) return hit.buf;
  const gifencMod = await import('gifenc');
  const { GIFEncoder, quantize, applyPalette } = gifencMod.default || gifencMod;
  const { ctx: x, frame, NF: FRAMES, delay } = await setup({ game, win, detail, amount, seed, text });
  const grab = (fi) => { frame(fi); return x.getImageData(0, 0, W, H).data; };
  const first = grab(0), last = grab(FRAMES - 1);
  const comp = new Uint8ClampedArray(first.length);
  for (let i = 0; i < comp.length; i += 8) { comp.set(first.subarray(i, i + 4), i); comp.set(last.subarray(i + 4, i + 8), i + 4); }
  const palette = quantize(comp, 256);
  const gif = GIFEncoder();
  for (let fi = 0; fi < FRAMES; fi++) {
    const rgba = fi === 0 ? first : fi === FRAMES - 1 ? last : grab(fi);
    gif.writeFrame(applyPalette(rgba, palette), W, H, { palette, delay: fi === FRAMES - 1 ? 2500 : delay, repeat: 0 });
  }
  gif.finish();
  const buf = Buffer.from(gif.bytes());
  cache.set(key, { buf, t: Date.now() }); if (cache.size > 200) cache.delete(cache.keys().next().value);
  return buf;
}

/** Single frames as PNG (tests and eyeballing): `indices` are frame numbers, or fractions
 *  of the clip when < 1. Returns [{ index, png }] plus the clip's frame count and, for the
 *  race, the simulation (so a test can check the film ends on the drawn winner). */
export async function renderCasinoFrames(opts, indices = [0, 0.5, 1]) {
  const { canvas, frame, NF, p } = await setup(opts);
  const out = [];
  for (const i of indices) {
    const fi = Math.min(NF - 1, Math.max(0, i < 1 && i > 0 ? Math.round(i * (NF - 1)) : i === 1 ? NF - 1 : i));
    frame(fi); out.push({ index: fi, png: await canvas.encode('png') });
  }
  return { frames: out, count: NF, sim: p.sim || null };
}

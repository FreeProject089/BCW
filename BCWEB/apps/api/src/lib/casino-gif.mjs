// Casino result animations — procedural 2.5D renders, encoded as animated GIF.
//
// One function per game draws frame N of a spin that ENDS on the real outcome the bot
// rolled (reels, coin side, die face, roulette pocket); the in-between motion is seeded per
// play so two identical outcomes still animate differently. No assets on disk: every frame
// is canvas. Performance: 480×270, 30 frames, one 256-colour palette shared across frames
// (quantised from a composite of the first and last frame) — tens of ms to encode — and the
// result is cached by (game, outcome, detail, amount, seed) for five minutes.

const W = 480, H = 270, FRAMES = 30, DELAY = 45;

// Small deterministic PRNG so a seed reproduces the exact spin (cache-safe).
function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; };
}
const ease = (t) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

function felt(x, win, t) {
  const bg = x.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, win ? '#0b2a1c' : '#25101a'); bg.addColorStop(1, '#0a0f1e');
  x.fillStyle = bg; x.fillRect(0, 0, W, H);
  const vg = x.createRadialGradient(W / 2, H / 2, 40, W / 2, H / 2, 330);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.55)');
  x.fillStyle = vg; x.fillRect(0, 0, W, H);
  x.font = 'bold 13px sans-serif'; x.textAlign = 'right'; x.fillStyle = 'rgba(255,255,255,0.35)';
  x.fillText('BetterCommunity', W - 14, 22);
}
// Outcome banner: slides up over the last frames, drawn AFTER the game so nothing sits on it.
function banner(x, win, amount, t) {
  if (t <= 0.8) return;
  const k = ease((t - 0.8) / 0.2); const bh = 46 * k;
  x.fillStyle = win ? 'rgba(46,204,113,0.96)' : 'rgba(231,76,60,0.96)'; x.fillRect(0, H - bh, W, bh);
  if (t <= 0.86) return;
  x.font = 'bold 22px sans-serif'; x.textAlign = 'center'; x.fillStyle = '#0a0f1e';
  x.fillText(win ? `YOU WIN  +${amount}` : `YOU LOSE  −${amount}`, W / 2, H - 15);
}

const SLOT_SYMS = ['🍒', '🍋', '🔔', '⭐', '💎'];
function drawSlots(x, f, { reels, r }) {
  const bw = 120, bh = 150, gap = 18, x0 = W / 2 - (bw * 3 + gap * 2) / 2, y0 = 45;
  const stopAt = [0.45, 0.6, 0.75]; // each reel stops later than the last
  const t = f / (FRAMES - 1);
  reels.forEach((sym, i) => {
    const rx = x0 + i * (bw + gap);
    x.fillStyle = 'rgba(255,255,255,0.07)'; x.strokeStyle = 'rgba(255,255,255,0.22)'; x.lineWidth = 3;
    x.beginPath(); x.roundRect(rx, y0, bw, bh, 16); x.fill(); x.stroke();
    x.save(); x.beginPath(); x.rect(rx, y0, bw, bh); x.clip();
    const spin = t < stopAt[i] ? 1 : Math.max(0, 1 - (t - stopAt[i]) / 0.12); // decelerate to a stop
    const speed = 62 * spin;
    const finalIdx = SLOT_SYMS.indexOf(sym);
    const offset = (f * speed + r.k[i] * 500) % (SLOT_SYMS.length * 100);
    // A vertical strip of symbols scrolling; once stopped, the final symbol sits on the pay line.
    for (let j = -2; j <= 2; j++) {
      const idx = spin > 0
        ? ((Math.floor(offset / 100) + j + SLOT_SYMS.length * 4) % SLOT_SYMS.length)
        : ((finalIdx + j + SLOT_SYMS.length) % SLOT_SYMS.length);
      const y = y0 + bh / 2 + j * 100 - (spin > 0 ? (offset % 100) : 0) + 30;
      x.globalAlpha = spin > 0.3 ? 0.55 : 1;
      x.font = '70px sans-serif'; x.textAlign = 'center'; x.fillStyle = '#fff';
      x.fillText(SLOT_SYMS[idx], rx + bw / 2, y);
    }
    x.globalAlpha = 1; x.restore();
    x.strokeStyle = 'rgba(255,215,0,0.55)'; x.lineWidth = 2;
    x.beginPath(); x.moveTo(rx - 6, y0 + bh / 2); x.lineTo(rx + bw + 6, y0 + bh / 2); x.stroke();
  });
}

function drawCoin(x, f, { heads, r }) {
  const t = f / (FRAMES - 1); const spins = 5 + Math.floor(r.k[0] * 3);
  // The angle runs fast, then eases onto the final side (heads = 0, tails = π).
  const target = heads ? 0 : Math.PI;
  const ang = ease(t) * (spins * 2 * Math.PI + target);
  const squash = Math.abs(Math.cos(ang));
  const front = Math.cos(ang) >= 0 ? heads : !heads;
  const cx = W / 2, cy = H / 2 - 10 - Math.sin(Math.PI * Math.min(1, t * 1.15)) * 60 * (1 - t); const R = 78;
  x.fillStyle = 'rgba(0,0,0,0.35)';
  x.beginPath(); x.ellipse(cx, H / 2 + 80, R * 0.9 * Math.max(0.3, squash), 12, 0, 0, Math.PI * 2); x.fill();
  x.save(); x.translate(cx, cy); x.scale(Math.max(0.06, squash), 1);
  const g = x.createRadialGradient(-20, -20, 10, 0, 0, R); g.addColorStop(0, '#ffe9a3'); g.addColorStop(1, '#b8860b');
  x.fillStyle = g; x.beginPath(); x.arc(0, 0, R, 0, Math.PI * 2); x.fill();
  x.lineWidth = 6; x.strokeStyle = '#8a6508'; x.stroke();
  x.fillStyle = '#7a5a06'; x.font = 'bold 64px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(front ? 'H' : 'T', 0, 4); x.textBaseline = 'alphabetic';
  x.restore();
}

const PIPS = {
  1: [[0, 0]], 2: [[-1, -1], [1, 1]], 3: [[-1, -1], [0, 0], [1, 1]],
  4: [[-1, -1], [1, -1], [-1, 1], [1, 1]], 5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
  6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]],
};
function face(x, cx, cy, s, n, rot) {
  x.save(); x.translate(cx, cy); x.rotate(rot);
  x.fillStyle = '#f4f1ea'; x.strokeStyle = '#c9c4b8'; x.lineWidth = 3;
  x.beginPath(); x.roundRect(-s / 2, -s / 2, s, s, s * 0.16); x.fill(); x.stroke();
  x.fillStyle = '#1b1f2a';
  for (const [px, py] of PIPS[n]) { x.beginPath(); x.arc(px * s * 0.28, py * s * 0.28, s * 0.075, 0, Math.PI * 2); x.fill(); }
  x.restore();
}
function drawDice(x, f, { roll, r }) {
  const t = f / (FRAMES - 1); const e = ease(t);
  const tumbles = 3 + Math.floor(r.k[0] * 2);
  const rot = (1 - e) * tumbles * Math.PI * 2;
  const cx = W / 2 + (1 - e) * (r.k[1] - 0.5) * 240;
  const cy = H / 2 - 5 - Math.abs(Math.sin(t * Math.PI * 3)) * 40 * (1 - e);
  const s = 120;
  // While tumbling, a different random face every few frames; settled, the real roll.
  const shown = e < 0.92 ? 1 + Math.floor(r.k[2 + (f % 6)] * 6) : roll;
  x.fillStyle = 'rgba(0,0,0,0.35)';
  x.beginPath(); x.ellipse(W / 2, H / 2 + 78, 70, 12, 0, 0, Math.PI * 2); x.fill();
  face(x, cx, cy, s, shown, rot);
}

const REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const WHEEL = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
function drawRoulette(x, f, { pocket, r }) {
  const t = f / (FRAMES - 1); const e = ease(t);
  const cx = W / 2, cy = H / 2 - 12, R = 94; const n = WHEEL.length; const slot = (Math.PI * 2) / n;
  const idx = WHEEL.indexOf(pocket);
  // The wheel spins and slows; the ball counter-rotates, spirals in and drops into the pocket.
  const wheelRot = (1 - e) * (2 + r.k[0]) * Math.PI * 2;
  x.save(); x.translate(cx, cy); x.rotate(wheelRot);
  for (let i = 0; i < n; i++) {
    const v = WHEEL[i];
    x.beginPath(); x.moveTo(0, 0); x.arc(0, 0, R, i * slot - Math.PI / 2, (i + 1) * slot - Math.PI / 2); x.closePath();
    x.fillStyle = v === 0 ? '#1e8449' : REDS.has(v) ? '#c0392b' : '#1b1f2a'; x.fill();
    x.save(); x.rotate((i + 0.5) * slot - Math.PI / 2);
    x.fillStyle = '#fff'; x.font = 'bold 9px sans-serif'; x.textAlign = 'center'; x.fillText(String(v), R - 13, 3);
    x.restore();
  }
  x.beginPath(); x.arc(0, 0, R, 0, Math.PI * 2); x.lineWidth = 6; x.strokeStyle = '#d4af37'; x.stroke();
  x.beginPath(); x.arc(0, 0, R * 0.55, 0, Math.PI * 2); x.fillStyle = '#0a0f1e'; x.fill(); x.lineWidth = 3; x.stroke();
  x.restore();
  const pocketAng = wheelRot + (idx + 0.5) * slot - Math.PI / 2;
  const orbit = -(1 - e) * (4 + r.k[1] * 2) * Math.PI * 2 + pocketAng;
  const rad = R * (0.97 - 0.25 * e);
  const bx = cx + Math.cos(orbit) * rad, by = cy + Math.sin(orbit) * rad;
  x.fillStyle = '#f5f5f5'; x.beginPath(); x.arc(bx, by, 7, 0, Math.PI * 2); x.fill();
  x.strokeStyle = 'rgba(0,0,0,0.5)'; x.lineWidth = 1.5; x.stroke();
  if (t > 0.9) {
    x.font = 'bold 22px sans-serif'; x.textAlign = 'center'; x.fillStyle = '#fff';
    x.fillText(`${pocket} ${pocket === 0 ? 'green' : REDS.has(pocket) ? 'red' : 'black'}`, cx, cy + 8);
  }
}

const cache = new Map(); const TTL = 5 * 60 * 1000;

/** Render one play as an animated GIF buffer. `detail` is the same short string the PNG
 *  route takes (reels / H|T / die face / pocket number); `seed` picks the spin. */
export async function renderCasinoGif({ game, win, detail, amount, seed }) {
  const key = `${game}|${win}|${detail}|${amount}|${seed}`;
  const hit = cache.get(key); if (hit && hit.t > Date.now() - TTL) return hit.buf;
  const [{ createCanvas }, gifencMod] = await Promise.all([import('@napi-rs/canvas'), import('gifenc')]);
  const { GIFEncoder, quantize, applyPalette } = gifencMod.default || gifencMod;
  const r = { k: Array.from({ length: 12 }, rng(seed)) };
  const p = { r };
  if (game === 'slots') p.reels = (detail || '🍒 🍋 🔔').split(/\s+/).slice(0, 3).map((s) => (SLOT_SYMS.includes(s) ? s : SLOT_SYMS[0]));
  else if (game === 'coinflip') p.heads = /H|🪙|heads/i.test(detail || 'H');
  else if (game === 'dice') p.roll = Math.min(6, Math.max(1, parseInt(detail, 10) || 1));
  else if (game === 'roulette') p.pocket = Math.min(36, Math.max(0, parseInt(detail, 10) || 0));
  const draw = { slots: drawSlots, coinflip: drawCoin, dice: drawDice, roulette: drawRoulette }[game];
  if (!draw) throw new Error('unknown game');
  const c = createCanvas(W, H); const x = c.getContext('2d');
  const frame = (f) => { const t = f / (FRAMES - 1); felt(x, win, t); draw(x, f, p); banner(x, win, amount, t); return x.getImageData(0, 0, W, H).data; };
  // One palette for the whole clip, quantised from a composite of the first and last frame.
  const first = frame(0), last = frame(FRAMES - 1);
  const comp = new Uint8ClampedArray(first.length);
  for (let i = 0; i < comp.length; i += 8) { comp.set(first.subarray(i, i + 4), i); comp.set(last.subarray(i + 4, i + 8), i + 4); }
  const palette = quantize(comp, 256);
  const gif = GIFEncoder();
  for (let f = 0; f < FRAMES; f++) {
    const rgba = f === 0 ? first : f === FRAMES - 1 ? last : frame(f);
    const index = applyPalette(rgba, palette);
    gif.writeFrame(index, W, H, { palette, delay: f === FRAMES - 1 ? 2500 : DELAY, repeat: 0 });
  }
  gif.finish();
  const buf = Buffer.from(gif.bytes());
  cache.set(key, { buf, t: Date.now() });
  if (cache.size > 200) cache.delete(cache.keys().next().value);
  return buf;
}

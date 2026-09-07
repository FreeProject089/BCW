// The leaderboard, as one picture.
//
// It lives in its own module so it can be rendered without a request, a database or a running
// server — which is how it gets LOOKED at while it is being changed, instead of being adjusted
// by reasoning about numbers.
//
// Design brief, in one line: say the ranking and nothing else. The previous card wore a 36px
// "Leaderboard" title and a "<server> · by level" subtitle above the rows — a heading for a
// thing that is already obviously a leaderboard, sitting inside a Discord message that has just
// said so. Both are gone. What is left is the wordmark, the rows, and air.
import { loadAvatarImage } from './avatar-image.mjs';

const BRAND = '#f59e0b';
const MEDALS = ['#f5c542', '#c9d0da', '#cd7f32'];

// Deterministic pleasant colour for the initial-fallback avatar (same id → same hue).
const hueOf = (s) => { let h = 0; for (let k = 0; k < s.length; k++) h = (h * 31 + s.charCodeAt(k)) % 360; return h; };
const rr = (x, a, b, w, h, r) => { if (x.roundRect) { x.beginPath(); x.roundRect(a, b, w, h, r); } else { x.beginPath(); x.rect(a, b, w, h); } };

/**
 * @param {Array}  rows            userEconomy rows with { user: {id, displayName, avatar}, level, xp, points }
 * @param {string} meId            highlight this user's row
 * @param {string} currencyName    what a point is called
 * @returns {Promise<Buffer>} PNG
 */
export async function renderLeaderboardCard({ rows = [], meId = '', currencyName = 'points' } = {}) {
  const { createCanvas } = await import('@napi-rs/canvas');

  // Geometry. One PAD everywhere so nothing is optically 4px off from its neighbour, and rows
  // that breathe: the card is read at a glance in a Discord message, not studied.
  const W = 880;
  const PAD = 28;
  const HEAD = 46;                       // just the wordmark's band
  const ROW = 62;
  const GAP = 8;
  const n = Math.max(1, rows.length);
  const H = HEAD + n * ROW + (n - 1) * GAP + PAD;

  const c = createCanvas(W, H);
  const x = c.getContext('2d');

  // Ground: one quiet vertical wash, not a three-stop diagonal that made the corners different
  // colours from each other.
  const bg = x.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#12151d');
  bg.addColorStop(1, '#0d1016');
  x.fillStyle = bg;
  x.fillRect(0, 0, W, H);
  // A 3px brand rule, the only chrome.
  x.fillStyle = BRAND;
  x.fillRect(0, 0, W, 3);

  // The wordmark, top-right, and nothing on the left.
  x.textAlign = 'right';
  x.textBaseline = 'alphabetic';
  x.font = '600 14px sans-serif';
  x.fillStyle = 'rgba(255,255,255,0.38)';
  x.fillText('BetterCommunity', W - PAD, HEAD - 14);

  if (!rows.length) {
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.font = '500 18px sans-serif';
    x.fillStyle = 'rgba(255,255,255,0.45)';
    x.fillText('Nobody has a level yet.', W / 2, HEAD + ROW / 2);
    return c.encode('png');
  }

  const topXp = Math.max(1, rows[0]?.xp || 1);

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const y = HEAD + i * (ROW + GAP);
    const cy = y + ROW / 2;
    const mine = meId && r.user.id === meId;

    // Row plate. Flat, one radius, and only the viewer's own row is tinted — the old card
    // striped every other row, which reads as a table and fights the medals for attention.
    x.fillStyle = mine ? 'rgba(245,158,11,0.12)' : 'rgba(255,255,255,0.035)';
    rr(x, PAD, y, W - PAD * 2, ROW, 14);
    x.fill();
    if (mine) { x.strokeStyle = 'rgba(245,158,11,0.45)'; x.lineWidth = 1.5; x.stroke(); }

    // Rank. The podium takes the medal colour; everyone else is quiet.
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillStyle = i < 3 ? MEDALS[i] : 'rgba(255,255,255,0.42)';
    x.font = i < 3 ? 'bold 21px sans-serif' : '600 17px sans-serif';
    x.fillText(String(i + 1), PAD + 28, cy);

    // Avatar, with a ring only on the podium.
    const ax = PAD + 74;
    const ar = 20;
    if (i < 3) { x.beginPath(); x.arc(ax, cy, ar + 2, 0, Math.PI * 2); x.fillStyle = MEDALS[i]; x.fill(); }
    let drew = false;
    try {
      const av = await loadAvatarImage(r.user, ar * 4);
      if (av) {
        x.save(); x.beginPath(); x.arc(ax, cy, ar, 0, Math.PI * 2); x.clip();
        const s = Math.max((ar * 2) / av.width, (ar * 2) / av.height);
        x.drawImage(av, ax - (av.width * s) / 2, cy - (av.height * s) / 2, av.width * s, av.height * s);
        x.restore();
        drew = true;
      }
    } catch { /* fallback below */ }
    if (!drew) {
      x.save(); x.beginPath(); x.arc(ax, cy, ar, 0, Math.PI * 2);
      x.fillStyle = `hsl(${hueOf(String(r.user.id || r.user.displayName || 'x'))} 52% 40%)`; x.fill();
      x.fillStyle = '#fff'; x.font = 'bold 18px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText((String(r.user.displayName || 'M').trim()[0] || 'M').toUpperCase(), ax, cy + 1);
      x.restore();
    }

    // Name, then the XP bar directly under it — the two things that ARE the ranking.
    const nx = ax + ar + 18;
    const rightCol = 150;                       // reserved for level + points
    const nameW = W - PAD - rightCol - nx - 16;
    x.textAlign = 'left';
    x.textBaseline = 'alphabetic';
    x.fillStyle = mine ? '#fff' : 'rgba(255,255,255,0.92)';
    x.font = `${mine ? 'bold' : '600'} 17px sans-serif`;
    let name = String(r.user.displayName || 'Member');
    while (name.length > 3 && x.measureText(name).width > nameW) name = name.slice(0, -1);
    if (name !== String(r.user.displayName || 'Member')) name = `${name.slice(0, -1)}…`;
    x.fillText(name, nx, cy - 4);

    // Deliberately NOT the full name column. At full width the leader's bar is a gold rule
    // across the whole card and reads as the loudest thing in the picture, which the ranking
    // is not: the order of the rows already says who is ahead. It is a hint, so it is short
    // and quiet — 4px, capped at 230.
    const barW = Math.min(230, nameW);
    x.fillStyle = 'rgba(255,255,255,0.06)'; rr(x, nx, cy + 9, barW, 4, 2); x.fill();
    x.fillStyle = i < 3 ? 'rgba(245,158,11,0.75)' : 'rgba(255,255,255,0.20)';
    rr(x, nx, cy + 9, Math.max(4, Math.round(barW * (r.xp / topXp))), 4, 2); x.fill();

    // Level and points, right-aligned in one column so every row's numbers line up.
    x.textAlign = 'right';
    x.fillStyle = 'rgba(255,255,255,0.92)';
    x.font = 'bold 17px sans-serif';
    x.fillText(String(r.points.toLocaleString('en-US')), W - PAD - 18, cy - 3);
    x.font = '500 11px sans-serif';
    x.fillStyle = 'rgba(255,255,255,0.35)';
    x.fillText(currencyName, W - PAD - 18, cy + 13);

    x.font = '600 13px sans-serif';
    x.fillStyle = BRAND;
    x.fillText(`Lv ${r.level}`, W - PAD - 110, cy + 4);
  }

  return c.encode('png');
}

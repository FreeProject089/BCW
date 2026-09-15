// The bot's button icons, as a set of PNGs an admin uploads to the application's emoji page
// (Discord Developer Portal → the app → Emojis), then names in the dashboard as <:name:id>.
//
// Each icon is a coloured tile with a glyph from the SAME icon families the rest of the site
// draws from — lucide by default, any Phosphor icon (`ph:rocket`, `ph-fill:heart`), or an
// uploaded image — so the pack matches the site instead of a hand-drawn approximation of it.
// The admin can change, per button, the glyph and the tile colour, and for the whole set the
// tile shape and the glyph colour (`economy.iconStyle` in the bot config). The hand-drawn
// vectors below stay as the offline fallback (`icon: "draw"`, or a glyph that fails to load).
//
// One key per button the bot draws. `fallback` is the unicode emoji used until an admin maps
// a custom one; `label` is what the dashboard shows; `icon` the default glyph; `color` the
// default tile.
export const ICONS = Object.freeze({
  level: { fallback: '⭐', label: 'My level', color: '#f59e0b', icon: 'star' },
  shop: { fallback: '🛒', label: 'Shop', color: '#3b82f6', icon: 'shopping-cart' },
  inventory: { fallback: '🎒', label: 'Inventory', color: '#8b5cf6', icon: 'backpack' },
  leaderboard: { fallback: '🏆', label: 'Leaderboard', color: '#eab308', icon: 'trophy' },
  casino: { fallback: '🎰', label: 'Casino', color: '#ef4444', icon: 'dices' },
  again: { fallback: '🔁', label: 'Play again', color: '#10b981', icon: 'repeat' },
  refresh: { fallback: '🔄', label: 'Refresh', color: '#64748b', icon: 'refresh-cw' },
  link: { fallback: '🔗', label: 'Link account', color: '#5865f2', icon: 'link' },
  buy: { fallback: '🛍️', label: 'Buy', color: '#22c55e', icon: 'shopping-bag' },
  gift: { fallback: '🎁', label: 'Gift', color: '#ec4899', icon: 'gift' },
  coin: { fallback: '🪙', label: 'Points / balance', color: '#f59e0b', icon: 'coins' },
  reveal: { fallback: '✉️', label: 'Reveal a code', color: '#0ea5e9', icon: 'mail-open' },
  history: { fallback: '📜', label: 'History', color: '#a16207', icon: 'scroll-text' },
  enter: { fallback: '🎉', label: 'Enter (giveaway)', color: '#f43f5e', icon: 'party-popper' },
  site: { fallback: '🌐', label: 'Open on the site', color: '#0ea5e9', icon: 'globe' },
  voice: { fallback: '🎙️', label: 'Voice controls', color: '#5865f2', icon: 'mic' },
  rename: { fallback: '✏️', label: 'Rename', color: '#64748b', icon: 'pencil' },
  limit: { fallback: '👥', label: 'User limit', color: '#64748b', icon: 'users' },
  region: { fallback: '🌍', label: 'Region', color: '#0ea5e9', icon: 'earth' },
  lock: { fallback: '🔒', label: 'Lock', color: '#ef4444', icon: 'lock' },
  unlock: { fallback: '🔓', label: 'Unlock', color: '#22c55e', icon: 'lock-open' },
  private: { fallback: '🙈', label: 'Private', color: '#8b5cf6', icon: 'eye-off' },
  public: { fallback: '👁️', label: 'Public', color: '#8b5cf6', icon: 'eye' },
  claim: { fallback: '🙋', label: 'Claim room', color: '#22c55e', icon: 'hand' },
  export: { fallback: '📤', label: 'Export preset', color: '#64748b', icon: 'upload' },
  import: { fallback: '📥', label: 'Import preset', color: '#64748b', icon: 'download' },
  // The casino games (the list, each game's page, the result cards).
  coinflip: { fallback: '🪙', label: 'Coin flip', color: '#f59e0b', icon: 'coins' },
  dice: { fallback: '🎲', label: 'Dice', color: '#ef4444', icon: 'dice-5' },
  slots: { fallback: '🎰', label: 'Slots', color: '#a855f7', icon: 'cherry' },
  roulette: { fallback: '🎡', label: 'Roulette', color: '#22c55e', icon: 'circle-dot' },
  wheel: { fallback: '🎯', label: 'Wheel', color: '#3b82f6', icon: 'target' },
  plinko: { fallback: '🟡', label: 'Plinko', color: '#eab308', icon: 'circle' },
  // The history's kinds and the odd title.
  levelup: { fallback: '⬆️', label: 'Level-up', color: '#22c55e', icon: 'arrow-up' },
  staff: { fallback: '🛡️', label: 'Staff grant', color: '#0ea5e9', icon: 'shield' },
  purchase: { fallback: '🧾', label: 'Purchase', color: '#64748b', icon: 'receipt' },
  games: { fallback: '🎮', label: 'Games', color: '#8b5cf6', icon: 'gamepad-2' },
  profile: { fallback: '👤', label: 'Profile', color: '#64748b', icon: 'user' },
  done: { fallback: '✅', label: 'Done', color: '#22c55e', icon: 'check' },
  // Body glyphs. These are drawn inside message text (the level card's stat lines, the
  // leaderboard's places, the shop's kind tags, a casino result) rather than on a button.
  // They lived only in the bot's own DEFAULT_ICONS, so `ic()` resolved them but this registry
  // never listed them — which meant the dashboard could not map them and they stayed unicode
  // (🏅 💬 ✨ …) no matter what an admin uploaded. Listing them here is what makes them
  // configurable: the dashboard, the pack zip and the PNG renderer all read this object.
  medal: { fallback: '🏅', label: 'Medal (rank)', color: '#eab308', icon: 'medal' },
  messages: { fallback: '💬', label: 'Messages (stat)', color: '#3b82f6', icon: 'message-circle' },
  reactions: { fallback: '✨', label: 'Reactions (stat)', color: '#a855f7', icon: 'sparkles' },
  streak: { fallback: '🔥', label: 'Streak', color: '#f97316', icon: 'flame' },
  gold: { fallback: '🥇', label: 'First place', color: '#eab308', icon: 'medal' },
  silver: { fallback: '🥈', label: 'Second place', color: '#94a3b8', icon: 'medal' },
  bronze: { fallback: '🥉', label: 'Third place', color: '#b45309', icon: 'medal' },
  badge: { fallback: '🏅', label: 'Badge (shop kind)', color: '#eab308', icon: 'award' },
  role: { fallback: '🎭', label: 'Role (shop kind)', color: '#8b5cf6', icon: 'venetian-mask' },
  pool: { fallback: '💾', label: 'Storage pool (shop kind)', color: '#0ea5e9', icon: 'hard-drive' },
  boost: { fallback: '🚀', label: 'Boost (shop kind)', color: '#ec4899', icon: 'rocket' },
  hosting: { fallback: '🖥️', label: 'Hosting (shop kind)', color: '#64748b', icon: 'monitor' },
  promo: { fallback: '🎟️', label: 'Promo code (shop kind)', color: '#f43f5e', icon: 'ticket' },
  exclusive: { fallback: '💎', label: 'Exclusive (tag)', color: '#06b6d4', icon: 'gem' },
  limited: { fallback: '🔥', label: 'Limited (tag)', color: '#f97316', icon: 'flame' },
  timed: { fallback: '⏳', label: 'Timed (tag)', color: '#a16207', icon: 'hourglass' },
  win: { fallback: '🎉', label: 'Casino win', color: '#22c55e', icon: 'party-popper' },
  push: { fallback: '↩️', label: 'Casino push', color: '#64748b', icon: 'undo-2' },
  wallet: { fallback: '💰', label: 'Points waiting', color: '#f59e0b', icon: 'wallet' },
  // The live tables (casino-live.mjs): the games, the lobby controls, the race's cars, the
  // countdown and the results. Every glyph the bot draws is a key here — the bot uploads the
  // whole set as application emojis at boot, so no unicode emoji is ever needed.
  race: { fallback: '🏎️', label: 'Race', color: '#ef4444', icon: 'car-front' },
  pot: { fallback: '🎁', label: 'Pot', color: '#f59e0b', icon: 'hand-coins' },
  multi: { fallback: '👥', label: 'Multiplayer table', color: '#5865f2', icon: 'users' },
  code: { fallback: '🔑', label: 'Join code', color: '#64748b', icon: 'key-round' },
  lobbies: { fallback: '📋', label: 'Open tables', color: '#64748b', icon: 'list' },
  prev: { fallback: '◀', label: 'Previous', color: '#64748b', icon: 'chevron-left' },
  next: { fallback: '▶', label: 'Next', color: '#64748b', icon: 'chevron-right' },
  start: { fallback: '🚦', label: 'Start', color: '#22c55e', icon: 'play' },
  timer: { fallback: '⏱️', label: 'Countdown', color: '#f97316', icon: 'timer' },
  flag: { fallback: '🏁', label: 'Finish', color: '#0f172a', icon: 'flag' },
  lose: { fallback: '💀', label: 'Casino loss', color: '#64748b', icon: 'skull' },
  refund: { fallback: '↩️', label: 'Stake returned', color: '#0ea5e9', icon: 'rotate-ccw' },
  cash: { fallback: '💵', label: 'Cash out', color: '#22c55e', icon: 'banknote' },
  warn: { fallback: '⚠', label: 'Warning', color: '#f59e0b', icon: 'triangle-alert' },
  off: { fallback: '⛔', label: 'Off', color: '#ef4444', icon: 'ban' },
  number: { fallback: '🔢', label: 'Number', color: '#64748b', icon: 'hash' },
  vis_public: { fallback: '🌐', label: 'Public table', color: '#0ea5e9', icon: 'globe' },
  vis_server: { fallback: '🏠', label: 'This server', color: '#64748b', icon: 'house' },
  vis_private: { fallback: '🔒', label: 'Private table', color: '#8b5cf6', icon: 'lock' },
  heads: { fallback: '🪙', label: 'Heads', color: '#f59e0b', icon: 'circle' },
  tails: { fallback: '🌑', label: 'Tails', color: '#64748b', icon: 'circle-dashed' },
  red: { fallback: '🔴', label: 'Red', color: '#ef4444', icon: 'circle' },
  black: { fallback: '⚫', label: 'Black', color: '#111827', icon: 'circle' },
  green: { fallback: '🟢', label: 'Green', color: '#22c55e', icon: 'circle' },
  car_red: { fallback: '🔴', label: 'Car — red', color: '#ef4444', icon: 'car' },
  car_blue: { fallback: '🔵', label: 'Car — blue', color: '#3b82f6', icon: 'car' },
  car_green: { fallback: '🟢', label: 'Car — green', color: '#22c55e', icon: 'car' },
  car_yellow: { fallback: '🟡', label: 'Car — yellow', color: '#eab308', icon: 'car' },
  car_purple: { fallback: '🟣', label: 'Car — purple', color: '#a855f7', icon: 'car' },
  car_orange: { fallback: '🟠', label: 'Car — orange', color: '#f97316', icon: 'car' },
  pit: { fallback: '🔧', label: 'Pit stop', color: '#64748b', icon: 'wrench' },
  safetycar: { fallback: '🚨', label: 'Safety car', color: '#eab308', icon: 'siren' },
  cherry: { fallback: '🍒', label: 'Slots — cherry', color: '#ef4444', icon: 'cherry' },
  lemon: { fallback: '🍋', label: 'Slots — lemon', color: '#eab308', icon: 'citrus' },
  bell: { fallback: '🔔', label: 'Slots — bell', color: '#f59e0b', icon: 'bell' },
  star: { fallback: '⭐', label: 'Slots — star', color: '#f59e0b', icon: 'star' },
  diamond: { fallback: '💎', label: 'Slots — diamond', color: '#06b6d4', icon: 'gem' },
  clear: { fallback: '🧹', label: 'Clear (purge)', color: '#64748b', icon: 'brush-cleaning' },
  news: { fallback: '📰', label: 'Blog post', color: '#3b82f6', icon: 'newspaper' },
  kofi: { fallback: '☕', label: 'Ko-fi tip', color: '#ff5e5b', icon: 'coffee' },
  wave: { fallback: '👋', label: 'Welcome', color: '#f59e0b', icon: 'hand' },
  luck: { fallback: '🍀', label: 'Good luck', color: '#22c55e', icon: 'clover' },
  drawing: { fallback: '🎲', label: 'Drawing…', color: '#8b5cf6', icon: 'dices' },
  key: { fallback: '🔑', label: 'Key', color: '#64748b', icon: 'key' },
});

/** The set-wide style, and what one key may override. */
export const ICON_STYLE_DEFAULTS = Object.freeze({ shape: 'rounded', fg: '#ffffff', scale: 0.58 });
const SHAPES = new Set(['rounded', 'circle', 'square', 'none']);
const HEX = /^#[0-9a-f]{6}$/i;

/** Normalise one key's effective style from the config's `economy.iconStyle`. */
export function iconStyleFor(key, iconStyle = {}, override = {}) {
  const def = ICONS[key];
  if (!def) return null;
  const set = iconStyle && typeof iconStyle === 'object' ? iconStyle : {};
  const mine = { ...(set[key] && typeof set[key] === 'object' ? set[key] : {}), ...override };
  const shape = SHAPES.has(mine.shape) ? mine.shape : SHAPES.has(set.shape) ? set.shape : ICON_STYLE_DEFAULTS.shape;
  const fg = HEX.test(mine.fg || '') ? mine.fg : HEX.test(set.fg || '') ? set.fg : ICON_STYLE_DEFAULTS.fg;
  const color = HEX.test(mine.color || '') ? mine.color : def.color;
  const icon = typeof mine.icon === 'string' && mine.icon.trim() && mine.icon.length < 200 ? mine.icon.trim() : def.icon;
  const scale = Math.min(0.9, Math.max(0.3, Number(mine.scale) || Number(set.scale) || ICON_STYLE_DEFAULTS.scale));
  return { key, icon, color, fg, shape, scale };
}

function rounded(x, X, Y, w, h, r) { x.beginPath(); x.moveTo(X + r, Y); x.arcTo(X + w, Y, X + w, Y + h, r); x.arcTo(X + w, Y + h, X, Y + h, r); x.arcTo(X, Y + h, X, Y, r); x.arcTo(X, Y, X + w, Y, r); x.closePath(); }
function star(x, cx, cy, R, r, n = 5) { x.beginPath(); for (let i = 0; i < n * 2; i++) { const a = -Math.PI / 2 + (i * Math.PI) / n; const rr = i % 2 ? r : R; x.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); } x.closePath(); }

// Each glyph is drawn white in a 128×128 frame whose centre is (64, 64).
const GLYPH = {
  level: (x) => { star(x, 64, 66, 40, 18); x.fill(); },
  shop: (x) => { rounded(x, 30, 50, 68, 46, 8); x.fill(); x.lineWidth = 8; x.beginPath(); x.arc(64, 50, 18, Math.PI, 0); x.stroke(); },
  inventory: (x) => { rounded(x, 34, 40, 60, 60, 12); x.fill(); x.lineWidth = 8; x.beginPath(); x.moveTo(48, 40); x.quadraticCurveTo(64, 14, 80, 40); x.stroke(); x.fillStyle = 'rgba(0,0,0,0.25)'; rounded(x, 46, 66, 36, 20, 5); x.fill(); },
  leaderboard: (x) => { x.beginPath(); x.moveTo(36, 30); x.lineTo(92, 30); x.lineTo(84, 74); x.quadraticCurveTo(64, 92, 44, 74); x.closePath(); x.fill(); x.fillRect(56, 84, 16, 14); x.fillRect(42, 96, 44, 10); x.lineWidth = 7; x.beginPath(); x.arc(30, 44, 10, Math.PI * 1.5, Math.PI * 0.5, true); x.arc(98, 44, 10, Math.PI * 0.5, Math.PI * 1.5, true); x.stroke(); },
  casino: (x) => { rounded(x, 28, 36, 72, 56, 10); x.fill(); x.fillStyle = 'rgba(0,0,0,0.3)'; for (let i = 0; i < 3; i++) rounded(x, 36 + i * 20, 46, 14, 36, 3); x.fill(); x.fillStyle = '#fff'; x.beginPath(); x.arc(108, 40, 7, 0, Math.PI * 2); x.fill(); x.fillRect(105, 40, 6, 24); },
  again: (x) => { x.lineWidth = 10; x.beginPath(); x.arc(64, 64, 32, -Math.PI * 0.2, Math.PI * 1.35); x.stroke(); x.beginPath(); x.moveTo(84, 26); x.lineTo(100, 44); x.lineTo(78, 50); x.closePath(); x.fill(); },
  refresh: (x) => { x.lineWidth = 10; x.beginPath(); x.arc(64, 64, 30, Math.PI * 1.1, Math.PI * 1.9); x.stroke(); x.beginPath(); x.arc(64, 64, 30, Math.PI * 0.1, Math.PI * 0.9); x.stroke(); x.beginPath(); x.moveTo(98, 30); x.lineTo(98, 54); x.lineTo(74, 54); x.closePath(); x.fill(); x.beginPath(); x.moveTo(30, 98); x.lineTo(30, 74); x.lineTo(54, 74); x.closePath(); x.fill(); },
  link: (x) => { x.lineWidth = 11; x.lineCap = 'round'; x.beginPath(); x.moveTo(52, 76); x.lineTo(76, 52); x.stroke(); x.beginPath(); x.arc(46, 82, 18, Math.PI * 0.25, Math.PI * 1.25); x.stroke(); x.beginPath(); x.arc(82, 46, 18, Math.PI * 1.25, Math.PI * 2.25); x.stroke(); },
  buy: (x) => { rounded(x, 32, 48, 64, 50, 8); x.fill(); x.lineWidth = 8; x.beginPath(); x.arc(64, 48, 16, Math.PI, 0); x.stroke(); x.strokeStyle = 'rgba(0,0,0,0.35)'; x.lineWidth = 7; x.beginPath(); x.moveTo(50, 74); x.lineTo(60, 84); x.lineTo(80, 64); x.stroke(); },
  gift: (x) => { rounded(x, 30, 56, 68, 44, 6); x.fill(); rounded(x, 26, 42, 76, 18, 5); x.fill(); x.fillStyle = 'rgba(0,0,0,0.3)'; x.fillRect(59, 42, 10, 58); x.fillStyle = '#fff'; x.lineWidth = 7; x.beginPath(); x.arc(52, 32, 10, 0, Math.PI * 2); x.arc(76, 32, 10, 0, Math.PI * 2); x.stroke(); },
  coin: (x) => { x.beginPath(); x.arc(64, 64, 38, 0, Math.PI * 2); x.fill(); x.fillStyle = 'rgba(0,0,0,0.3)'; x.beginPath(); x.arc(64, 64, 26, 0, Math.PI * 2); x.fill(); x.fillStyle = '#fff'; x.font = 'bold 34px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('$', 64, 66); },
  reveal: (x) => { rounded(x, 24, 40, 80, 52, 8); x.fill(); x.strokeStyle = 'rgba(0,0,0,0.35)'; x.lineWidth = 7; x.beginPath(); x.moveTo(28, 44); x.lineTo(64, 70); x.lineTo(100, 44); x.stroke(); },
  history: (x) => { rounded(x, 34, 26, 60, 76, 6); x.fill(); x.fillStyle = 'rgba(0,0,0,0.3)'; for (let i = 0; i < 4; i++) x.fillRect(44, 40 + i * 14, i === 3 ? 24 : 40, 6); },
  enter: (x) => { x.beginPath(); x.moveTo(40, 100); x.lineTo(28, 40); x.lineTo(76, 68); x.closePath(); x.fill(); for (const [px, py, r] of [[84, 30, 6], [100, 52, 5], [92, 82, 5], [64, 24, 4]]) { x.beginPath(); x.arc(px, py, r, 0, Math.PI * 2); x.fill(); } },
  site: (x) => { x.lineWidth = 8; x.beginPath(); x.arc(64, 64, 36, 0, Math.PI * 2); x.stroke(); x.beginPath(); x.ellipse(64, 64, 16, 36, 0, 0, Math.PI * 2); x.stroke(); x.beginPath(); x.moveTo(28, 64); x.lineTo(100, 64); x.stroke(); },
  voice: (x) => { rounded(x, 50, 24, 28, 50, 14); x.fill(); x.lineWidth = 8; x.beginPath(); x.arc(64, 64, 26, 0, Math.PI); x.stroke(); x.fillRect(60, 90, 8, 12); x.fillRect(46, 100, 36, 7); },
  rename: (x) => { x.save(); x.translate(64, 64); x.rotate(-Math.PI / 4); rounded(x, -10, -40, 20, 64, 4); x.fill(); x.beginPath(); x.moveTo(-10, 28); x.lineTo(10, 28); x.lineTo(0, 44); x.closePath(); x.fill(); x.restore(); },
  limit: (x) => { for (const [cx, s] of [[50, 1], [80, 0.85]]) { x.beginPath(); x.arc(cx, 48, 14 * s, 0, Math.PI * 2); x.fill(); x.beginPath(); x.arc(cx, 96, 26 * s, Math.PI, 0); x.fill(); } },
  region: (x) => { x.lineWidth = 8; x.beginPath(); x.arc(64, 64, 36, 0, Math.PI * 2); x.stroke(); x.beginPath(); x.moveTo(44, 40); x.quadraticCurveTo(64, 52, 56, 72); x.quadraticCurveTo(80, 70, 84, 92); x.stroke(); },
  lock: (x) => { rounded(x, 34, 58, 60, 46, 8); x.fill(); x.lineWidth = 9; x.beginPath(); x.arc(64, 54, 20, Math.PI, 0); x.stroke(); x.fillStyle = 'rgba(0,0,0,0.3)'; x.beginPath(); x.arc(64, 78, 7, 0, Math.PI * 2); x.fill(); },
  unlock: (x) => { rounded(x, 34, 58, 60, 46, 8); x.fill(); x.lineWidth = 9; x.beginPath(); x.arc(64, 44, 20, Math.PI, Math.PI * 1.75); x.stroke(); x.fillStyle = 'rgba(0,0,0,0.3)'; x.beginPath(); x.arc(64, 78, 7, 0, Math.PI * 2); x.fill(); },
  private: (x) => { x.lineWidth = 8; x.beginPath(); x.moveTo(24, 64); x.quadraticCurveTo(64, 96, 104, 64); x.stroke(); x.beginPath(); x.moveTo(36, 44); x.lineTo(92, 84); x.stroke(); },
  public: (x) => { x.lineWidth = 8; x.beginPath(); x.moveTo(24, 64); x.quadraticCurveTo(64, 24, 104, 64); x.quadraticCurveTo(64, 104, 24, 64); x.stroke(); x.beginPath(); x.arc(64, 64, 12, 0, Math.PI * 2); x.fill(); },
  claim: (x) => { x.beginPath(); x.arc(58, 40, 14, 0, Math.PI * 2); x.fill(); x.beginPath(); x.arc(58, 96, 26, Math.PI, 0); x.fill(); x.lineWidth = 9; x.lineCap = 'round'; x.beginPath(); x.moveTo(78, 66); x.lineTo(96, 40); x.lineTo(104, 46); x.stroke(); },
  export: (x) => { rounded(x, 30, 70, 68, 30, 6); x.fill(); x.lineWidth = 10; x.lineCap = 'round'; x.beginPath(); x.moveTo(64, 74); x.lineTo(64, 30); x.stroke(); x.beginPath(); x.moveTo(46, 46); x.lineTo(64, 28); x.lineTo(82, 46); x.stroke(); },
  import: (x) => { rounded(x, 30, 70, 68, 30, 6); x.fill(); x.lineWidth = 10; x.lineCap = 'round'; x.beginPath(); x.moveTo(64, 26); x.lineTo(64, 70); x.stroke(); x.beginPath(); x.moveTo(46, 54); x.lineTo(64, 72); x.lineTo(82, 54); x.stroke(); },
};

/** One icon as a 128×128 PNG buffer. */
export async function renderEmoji(key, iconStyle = {}, override = {}) {
  const st = iconStyleFor(key, iconStyle, override);
  if (!st) return null;
  const { createCanvas } = await import('@napi-rs/canvas');
  const c = createCanvas(128, 128); const x = c.getContext('2d');
  // The tile: rounded (Discord-like), a circle, a square, or none (the glyph alone, in the
  // tile colour — for servers whose buttons already carry colour).
  const tile = () => {
    if (st.shape === 'circle') { x.beginPath(); x.arc(64, 64, 60, 0, Math.PI * 2); }
    else if (st.shape === 'square') rounded(x, 4, 4, 120, 120, 8);
    else rounded(x, 4, 4, 120, 120, 28);
  };
  if (st.shape !== 'none') {
    tile(); x.fillStyle = st.color; x.fill();
    const g = x.createLinearGradient(0, 0, 0, 128); g.addColorStop(0, 'rgba(255,255,255,0.22)'); g.addColorStop(1, 'rgba(0,0,0,0.16)');
    tile(); x.fillStyle = g; x.fill();
  }
  const fg = st.shape === 'none' ? st.color : st.fg;
  // The glyph, from the icon families the site uses; the hand-drawn vector when asked for
  // (`draw`) or when the named icon cannot be loaded (offline, a typo) — never an empty tile.
  let drawn = false;
  if (st.icon !== 'draw') {
    try {
      const { loadNamedIcon } = await import('./avatar-image.mjs');
      const size = Math.round(128 * st.scale);
      const img = await loadNamedIcon(st.icon, fg, size);
      if (img) {
        const w = img.width && img.height ? size * Math.min(1, img.width / img.height) : size;
        const h = img.width && img.height ? size * Math.min(1, img.height / img.width) : size;
        x.drawImage(img, 64 - w / 2, 64 - h / 2, w, h);
        drawn = true;
      }
    } catch { drawn = false; }
  }
  if (!drawn) {
    x.fillStyle = fg; x.strokeStyle = fg; x.lineJoin = 'round';
    try { GLYPH[key](x); } catch { /* a glyph that fails leaves the coloured tile */ }
  }
  return c.encode('png');
}

/** Every icon, as a zip: <key>.png ×N + a README naming each. */
export async function renderEmojiPack(iconStyle = {}) {
  const { default: archiver } = await import('archiver');
  const chunks = [];
  const zip = archiver('zip', { zlib: { level: 6 } });
  const done = new Promise((res, rej) => { zip.on('data', (d) => chunks.push(d)); zip.on('end', res); zip.on('error', rej); });
  for (const key of Object.keys(ICONS)) {
    const png = await renderEmoji(key, iconStyle);
    if (png) zip.append(png, { name: `bc_${key}.png` });
  }
  zip.append(`BetterCommunity bot icons\n\nUpload every PNG on your application's Emojis page (Discord Developer Portal → your app → Emojis), keeping the file names (bc_<key>). Then, in the admin dashboard → Discord bot → Levels & economy → Button icons, paste each emoji as <:bc_key:ID> (right-click the emoji in Discord → Copy Text, or read the id from the Emojis page).\n\n${Object.entries(ICONS).map(([k, v]) => `bc_${k}.png — ${v.label} (fallback ${v.fallback})`).join('\n')}\n`, { name: 'README.txt' });
  zip.finalize();
  await done;
  return Buffer.concat(chunks);
}

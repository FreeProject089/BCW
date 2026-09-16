// nav.mjs — where a screen was opened FROM, and the one Back button that goes there.
//
// WHY THIS EXISTS
//
// A component interaction hands the bot nothing but a custom id: no session, no memory of
// which message opened the one being clicked. So every screen that is reached from another
// screen was a dead end — `/casino` listed the games, a game opened, and the only way back
// to the list was to run `/casino` again. The same was true of the shop from the level card,
// the open tables from the casino, the leaderboard from anywhere.
//
// Rather than a Back button hand-wired into each screen (which is how a "back" ends up
// pointing at the wrong place six screens later), the origin travels in the custom id of the
// button that opens the next screen: `eco:shop:lvl` means "open the shop, you came from the
// level card". The destination reads that last field and draws ONE consistent Back button,
// `nav:<origin>`, which re-opens it.
//
// THE 100-CHARACTER LIMIT is why an origin is a token and not a payload: a token is a screen
// code and its arguments joined with `~` (`shop~2`, `casg~roulette~500~number~17`). Tildes,
// because every custom id in this bot is split on `:` and an origin has to survive that split
// as ONE field. TOKEN_MAX keeps `nav:<token>` well inside the limit even when the screen it
// names is the casino's full table state.
//
// ONE HOP, deliberately. A breadcrumb stack would not fit in 100 characters, and what was
// asked for is "get me back to the menu I came from", not a browser history.
//
// Back re-opens as a FRESH ephemeral card rather than editing the message in place, because
// the message a Back button sits on may be a public table card several people are watching —
// and because that is already what every cross-link in this bot does (pressing Shop on the
// level card has always sent a new ephemeral card, not replaced it).
import { ButtonStyle } from 'discord.js';
import * as ui from './ui.mjs';

/** `nav:` + a token must stay under Discord's 100-character custom_id ceiling. */
export const TOKEN_MAX = 80;

const screens = new Map();

/**
 * Teach nav how to re-open a screen. `open(i, args, token)` gets the token's arguments as
 * strings. Registered from the modules that own the screens (commands.mjs), so nav itself
 * imports nothing of theirs and cannot close an import cycle.
 */
export function register(code, open) { screens.set(code, open); }

/** The origin token for the screen being drawn: `origin('shop', 2)` → `shop~2`. */
export function origin(code, ...args) {
  const parts = [code, ...args.map((a) => (a === null || a === undefined ? '' : String(a)))];
  // Trailing empties carry no information and only eat the budget.
  while (parts.length > 1 && parts[parts.length - 1] === '') parts.pop();
  return parts.join('~').replace(/[^A-Za-z0-9~_.-]/g, '').slice(0, TOKEN_MAX);
}

/** A custom id that carries where the clicker is standing. `from` empty → the id unchanged. */
export const withOrigin = (id, from) => (from ? `${id}:${from}` : id);

/** The Back button for `from`, or null when there is nowhere to go back to. */
export function backButton(t, from) {
  if (!from || !screens.has(String(from).split('~')[0])) return null;
  return ui.btn(`nav:${from}`, t('btn.back'), ButtonStyle.Secondary, { emoji: 'prev' });
}

/** `[backButton]` or `[]` — for spreading into a card's `buttons` without a conditional. */
export const backButtons = (t, from) => { const b = backButton(t, from); return b ? [b] : []; };

/** A `nav:<token>` press. Unknown tokens say so instead of leaving a dead spinner. */
export async function openOrigin(i, token, t) {
  const [code, ...args] = String(token || '').split('~');
  const open = screens.get(code);
  if (!open) return ui.line(i, t('nav.gone'), { color: ui.INFO });
  return open(i, args, token);
}

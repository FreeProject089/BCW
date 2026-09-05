// B14 Community Charity — the pure math, kept out of the route so it is unit-testable and so
// there is exactly ONE place the org-share is computed (the spec's whole promise hangs on it).
//
// Eligible revenue is NET recurring — recurring income minus the recurring cost the business
// carries every month — which is the spec's "dépend des revenus récurrents ET des coûts
// récurrents". Both inputs come from figures the admin screens already compute; this module
// never sums money a second way, it only combines the two numbers.

// The hard ceiling from the spec (§5): the percentage can never exceed 50%.
export const CHARITY_MAX_PCT = 50;

/** Clamp an admin-entered percent into [0, CHARITY_MAX_PCT]. Non-finite → 0. */
export function clampCharityPct(pct) {
  const n = Number(pct);
  if (!Number.isFinite(n)) return 0;
  return Math.min(CHARITY_MAX_PCT, Math.max(0, n));
}

/**
 * BetterCommunity's own contribution for a month, in cents.
 *
 *   eligible = max(0, mrr − monthlyBurn)        // never negative: a loss-making month gives 0
 *   share    = round(eligible × min(pct, 50) / 100)
 *
 * Returns the breakdown, not just the number, so the admin preview and the frozen pot value
 * are the same computation seen from two places.
 */
export function computeOrgShare({ mrrCents = 0, monthlyBurnCents = 0, percent = 0 } = {}) {
  const mrr = Math.max(0, Math.round(Number(mrrCents) || 0));
  const burn = Math.max(0, Math.round(Number(monthlyBurnCents) || 0));
  const pct = clampCharityPct(percent);
  const eligibleCents = Math.max(0, mrr - burn);
  const orgShareCents = Math.round((eligibleCents * pct) / 100);
  return { mrrCents: mrr, monthlyBurnCents: burn, percent: pct, eligibleCents, orgShareCents };
}

// The admin-editable config, stored as one AdminSetting row (key `charity.config`). Defaults
// chosen from the design doc's recommended answers: CHF, disabled until an admin turns it on,
// 10% starting share (well under the 50% cap), no association picked yet.
export const CHARITY_CONFIG_KEY = 'charity.config';
export const CHARITY_DEFAULTS = {
  enabled: false,
  percent: 10,
  currency: 'chf',
  association: '',
  design: null, // filled by normalizeCharityDesign (null here so the defaults object stays flat)
};

// The landing widget's LOOK. `default` is the plain card; `custom` lets an admin replace it
// with artwork they made at a known size: a backdrop that fills the frame, an "overflow" layer
// that spills past the frame by `bleed` px on every side (a mascot leaning out, a ribbon), and
// a sticker pinned to one corner. Sizes are fixed HERE so the admin UI can print exactly what
// canvas to draw on — no scaling surprises. Nothing here is a colour preset: the design is the
// images; the code only decides where they sit and which ink the text uses over them.
export const CHARITY_DESIGN_DEFAULTS = {
  mode: 'default',        // default | custom
  width: 'xl',            // xl (576 px) | 2xl (672 px) | 3xl (768 px) — the frame's CSS width
  height: 360,            // min height of the frame, px (content can still make it taller)
  frame: true,            // keep the card's own border + background under the artwork
  ink: 'auto',            // auto (theme text) | light (white text + shadow) | dark
  align: 'center',        // center | left | right — where the pot + buttons sit
  backdrop: '',           // image URL, drawn to cover the frame (recommended 2× frame size)
  backdropFit: 'cover',   // cover | contain
  overflow: '',           // transparent image spilling `bleed` px past the frame on every side
  bleed: 64,              // px, 0–200
  sticker: '',            // small image pinned to a corner, half outside the frame
  stickerSize: 160,       // px, 48–320
  stickerCorner: 'tr',    // tl | tr | bl | br
  stickerOffset: 24,      // px the sticker sticks OUT of the frame (0 = flush inside)
  alt: '',                // alt text for the artwork (accessibility)
};
export const CHARITY_WIDTHS = { xl: 576, '2xl': 672, '3xl': 768 };
const clampInt = (v, lo, hi, d) => { const x = Math.round(Number(v)); return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d; };
// Only images the site serves itself or an absolute http(s) URL — never a data: blob (unbounded
// size in an AdminSetting row) and never a javascript: string.
const imgUrl = (s) => (typeof s === 'string' && s.trim().length <= 600 && /^(\/api\/media\/|\/media\/|https?:\/\/)/i.test(s.trim())) ? s.trim() : '';
const oneOf = (v, list, d) => (list.includes(v) ? v : d);

export function normalizeCharityDesign(v) {
  const o = v && typeof v === 'object' ? v : {};
  const D = CHARITY_DESIGN_DEFAULTS;
  return {
    mode: oneOf(o.mode, ['default', 'custom'], D.mode),
    width: oneOf(o.width, Object.keys(CHARITY_WIDTHS), D.width),
    height: clampInt(o.height, 200, 720, D.height),
    frame: o.frame !== false,
    ink: oneOf(o.ink, ['auto', 'light', 'dark'], D.ink),
    align: oneOf(o.align, ['center', 'left', 'right'], D.align),
    backdrop: imgUrl(o.backdrop),
    backdropFit: oneOf(o.backdropFit, ['cover', 'contain'], D.backdropFit),
    overflow: imgUrl(o.overflow),
    bleed: clampInt(o.bleed, 0, 200, D.bleed),
    sticker: imgUrl(o.sticker),
    stickerSize: clampInt(o.stickerSize, 48, 320, D.stickerSize),
    stickerCorner: oneOf(o.stickerCorner, ['tl', 'tr', 'bl', 'br'], D.stickerCorner),
    stickerOffset: clampInt(o.stickerOffset, 0, 160, D.stickerOffset),
    alt: typeof o.alt === 'string' ? o.alt.slice(0, 200) : '',
  };
}

/** Normalise a stored/incoming config blob to the current shape, clamping the percent. */
export function normalizeCharityConfig(v) {
  const o = v && typeof v === 'object' ? v : {};
  return {
    enabled: o.enabled === true,
    percent: clampCharityPct(o.percent ?? CHARITY_DEFAULTS.percent),
    currency: (typeof o.currency === 'string' && o.currency.trim()) ? o.currency.trim().toLowerCase() : CHARITY_DEFAULTS.currency,
    association: typeof o.association === 'string' ? o.association : '',
    design: normalizeCharityDesign(o.design),
  };
}

/** The current month key, "YYYY-MM", in UTC. Passed a Date so callers control the clock. */
export function monthKey(now) {
  return now.toISOString().slice(0, 7);
}

// "Augmenter la cagnotte" preset amounts from the spec (§24), in cents: 5 / 10 / 25 / 50.
export const CONTRIBUTION_PRESETS_CENTS = [500, 1000, 2500, 5000];
// A gift must be at least 1 unit and is capped to keep a typo (or an abuse) from a runaway
// charge; well above any preset. Both in cents.
export const CONTRIBUTION_MIN_CENTS = 100;
export const CONTRIBUTION_MAX_CENTS = 1000000; // 10,000

/**
 * Validate a contribution amount (cents). Returns { ok, amountCents } or { ok:false, error }.
 * Integer cents only — a fractional cent is a client bug, not a smaller gift.
 */
export function validateContribution(amountCents) {
  const n = Number(amountCents);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return { ok: false, error: 'bad_amount' };
  if (n < CONTRIBUTION_MIN_CENTS) return { ok: false, error: 'too_small' };
  if (n > CONTRIBUTION_MAX_CENTS) return { ok: false, error: 'too_large' };
  return { ok: true, amountCents: n };
}

/**
 * Is a linked poll live right now? A minimal open-check for the charity widget — NOT the tally
 * or results-visibility rule (that stays in the poll module, where it is tested). Passed `now`
 * so the caller controls the clock.
 */
export function pollOpen(poll, now) {
  if (!poll || poll.status !== 'open') return false;
  const t = now.getTime();
  if (poll.opensAt && new Date(poll.opensAt).getTime() > t) return false;
  if (poll.closesAt && new Date(poll.closesAt).getTime() <= t) return false;
  return true;
}

/** Sum a pot's total = BetterCommunity's frozen share + every community gift. Pure. */
export function potTotalCents(pot) {
  const org = Math.max(0, Math.round(pot?.orgContribCents || 0));
  const gifts = (pot?.contributions || []).reduce((n, c) => n + Math.max(0, Math.round(c.amountCents || 0)), 0);
  return { orgContribCents: org, communityCents: gifts, totalCents: org + gifts };
}

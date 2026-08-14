// Reading any BMM file without running it.
//
// The moderation queue had one button, for `.bmmpa`. Everything else a person can submit or
// attach — a mod list, a session replay, a navbar config — arrived as an opaque blob that a
// moderator could only judge by its filename. That is not a decision, it is a guess.
//
// This is a router, not a second inspector: it works out WHICH format a document is and
// hands it to the reader for that format. `.bmmpa` still goes to inspectBmmpa, unchanged.
//
// Every reader here obeys the same rule as that one: nothing is executed, fetched or
// written. Looking at a thing must not be the thing happening.

import { inspectBmmpa } from './bmmpa.mjs';

/** Formats that are ZIP archives, not JSON. Named so the panel can say what to paste
 *  instead of failing with "not a BMM file", which is true and useless. */
export const ZIP_FORMATS = {
  bmmplug: 'a plugin — a ZIP containing plugin.json',
  bmmtheme: 'a theme — a ZIP containing theme.json',
};

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const arr = (v) => (Array.isArray(v) ? v : []);

/**
 * Which format a parsed document is.
 *
 * Ordered most-specific first. A `.bmmpa` also has a top-level array, and a replay also has
 * a `meta`; guessing from one shared field would route files to the wrong reader and report
 * confident nonsense, which is worse than "unknown".
 */
export function detectFormat(doc) {
  if (!isObj(doc) && !Array.isArray(doc)) return null;
  if (Array.isArray(doc)) return doc.some((x) => isObj(x) && Array.isArray(x.steps)) ? 'bmmpa' : null;
  if (doc.magic === 'BMMPA' || arr(doc.tasks).some((x) => isObj(x) && Array.isArray(x.steps))) return 'bmmpa';
  if (doc.format === 'bmmnav') return 'bmmnav';
  if (Array.isArray(doc.events) && ('console' in doc || 'rustLog' in doc)) return 'bmmreplay';
  if (typeof doc.format_version === 'string' && Array.isArray(doc.mods)) return 'mm';
  return null;
}

/** A row in the summary. `tone` is advisory: 'warn' marks something a reviewer should read
 *  before approving, never something the reader disapproves of on its own. */
const row = (label, value, tone) => ({ label, value: String(value), ...(tone ? { tone } : {}) });

/**
 * A shared mod list.
 *
 * The interesting part is where the mods come FROM. A list is a set of download links
 * somebody else will follow, so the hosts are the thing to look at — a list whose entries
 * all point at one unknown domain is a different object from one pointing at Nexus.
 */
function inspectModList(doc) {
  const mods = arr(doc.mods);
  const urls = [];
  for (const m of mods.slice(0, 500)) {
    for (const l of arr(m?.links)) if (typeof l?.url === 'string') urls.push(l.url);
    if (typeof m?.url === 'string') urls.push(m.url);
  }
  const hosts = new Map();
  for (const u of urls) {
    try { const h = new URL(u).host; hosts.set(h, (hosts.get(h) || 0) + 1); } catch { /* not a URL */ }
  }
  const top = [...hosts].sort((a, b) => b[1] - a[1]).slice(0, 8);
  return {
    title: String(doc.name || '(unnamed list)').slice(0, 200),
    summary: [
      row('Mods', mods.length),
      row('Game', String(doc.game_name || '—')),
      row('Author', String(doc.author || '—')),
      row('Created', String(doc.created_at || '—')),
      row('Download hosts', top.length ? top.map(([h, n]) => `${h} (${n})`).join(', ') : '—'),
      // A path hint is a string from someone else's machine. Harmless, but it is the field
      // most likely to carry a person's name, and a moderator should see that it is there.
      ...(doc.game_path_hint ? [row('Path hint', String(doc.game_path_hint), 'warn')] : []),
    ],
    detail: mods.slice(0, 200).map((m) => ({
      name: String(m?.name || '(unnamed)').slice(0, 200),
      note: arr(m?.links).map((l) => String(l?.url || '')).filter(Boolean).join(' · ').slice(0, 300),
    })),
  };
}

/**
 * A session replay.
 *
 * The privacy note is the point. A replay is a recording of somebody's screen: it carries
 * DOM text, and the file paths BMM displays include a Windows user name more often than
 * not. A moderator handling one should know that before they open it, not after.
 */
function inspectReplay(doc) {
  const events = arr(doc.events);
  const console_ = arr(doc.console);
  const first = events[0]?.timestamp;
  const last = events[events.length - 1]?.timestamp;
  const mins = (typeof first === 'number' && typeof last === 'number' && last > first)
    ? Math.round((last - first) / 60000 * 10) / 10 : null;
  const errors = console_.filter((c) => String(c?.level || '').toLowerCase() === 'error').length;
  return {
    title: 'Session replay',
    summary: [
      row('Events', events.length),
      row('Length', mins === null ? '—' : `${mins} min`),
      row('Console lines', console_.length),
      row('Console errors', errors, errors ? 'warn' : undefined),
      row('Rust log', 'rustLog' in doc ? 'included' : 'absent'),
      row('Privacy', 'Contains recorded screen content and file paths — treat as personal data.', 'warn'),
    ],
    // The first console errors, which is what a replay attached to a bug report is FOR.
    detail: console_.filter((c) => String(c?.level || '').toLowerCase() === 'error').slice(0, 40)
      .map((c) => ({ name: String(c?.level || 'error'), note: String(c?.text ?? c?.message ?? '').slice(0, 300) })),
  };
}

/**
 * A navbar configuration.
 *
 * Worth inspecting because it can carry custom pages, and a custom page is a `bmmpage://`
 * sandbox with its own permissions — the one part of a navbar file that does something
 * rather than just naming a place.
 */
function inspectNav(doc) {
  const items = arr(doc.items ?? doc.nav ?? doc.entries);
  const pages = items.filter((i) => typeof i?.url === 'string' && i.url.startsWith('bmmpage://'));
  const external = items.filter((i) => typeof i?.url === 'string' && /^https?:/i.test(i.url));
  return {
    title: 'Navbar configuration',
    summary: [
      row('Entries', items.length),
      row('Custom pages', pages.length, pages.length ? 'warn' : undefined),
      row('External links', external.length, external.length ? 'warn' : undefined),
    ],
    detail: items.slice(0, 100).map((i) => ({
      name: String(i?.label ?? i?.name ?? i?.id ?? '(unnamed)').slice(0, 120),
      note: String(i?.url ?? i?.value ?? '').slice(0, 300),
    })),
  };
}

/**
 * Inspect any BMM document.
 *
 * Returns `{ ok:false, error }` with the reason a person can act on. "Unknown format" names
 * the top-level keys it actually saw, because the next question is always "then what IS
 * this", and a reader that refuses without saying what it found makes somebody open the
 * file in a text editor to answer it.
 */
export function inspectAny(doc) {
  const format = detectFormat(doc);
  if (!format) {
    const keys = isObj(doc) ? Object.keys(doc).slice(0, 12) : [];
    return {
      ok: false,
      error: Array.isArray(doc)
        ? 'A JSON array that is not a task list.'
        : keys.length
          ? `Not a recognised BMM format. Top-level keys: ${keys.join(', ')}`
          : 'Not a BMM document.',
      hint: 'Plugins (.bmmplug) and themes (.bmmtheme) are ZIP archives — paste the plugin.json or theme.json from inside instead.',
    };
  }
  if (format === 'bmmpa') return { ok: true, format, bmmpa: inspectBmmpa(doc) };
  const readers = { mm: inspectModList, bmmreplay: inspectReplay, bmmnav: inspectNav };
  return { ok: true, format, ...readers[format](doc) };
}

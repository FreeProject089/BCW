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
import { verifyDocument } from './bmm-signature.mjs';

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
/**
 * Does this array look like rrweb's own event stream?
 *
 * rrweb events are `{ type: <number>, timestamp: <number>, data }`. Checking the first few
 * rather than all of them: a long recording is tens of thousands of entries and the shape does
 * not change halfway through. Two is the floor because a single event is not a recording —
 * every replay opens with a Meta and a FullSnapshot.
 */
function looksLikeRrweb(events) {
  if (!Array.isArray(events) || events.length < 2) return false;
  return events.slice(0, 5).every((e) => isObj(e) && typeof e.type === 'number' && typeof e.timestamp === 'number');
}

export function detectFormat(doc) {
  if (!isObj(doc) && !Array.isArray(doc)) return null;
  if (Array.isArray(doc)) {
    if (doc.some((x) => isObj(x) && Array.isArray(x.steps))) return 'bmmpa';
    // A BARE rrweb export: no wrapper, no console, just the events. rrweb's own recorder
    // produces exactly this, and refusing it meant a moderator with a plain recording was told
    // "not a recognised BMM format" about a file the player can open perfectly.
    return looksLikeRrweb(doc) ? 'bmmreplay' : null;
  }
  if (doc.magic === 'BMMPA' || arr(doc.tasks).some((x) => isObj(x) && Array.isArray(x.steps))) return 'bmmpa';
  if (doc.format === 'bmmnav') return 'bmmnav';
  // A launch pack (.bmmlaunch): a name and a list of programs to start. `kind` is the marker
  // the writer puts there deliberately; the shape alone still decides, so a file trimmed by
  // hand or written by an older BMM is not rejected over a missing field.
  if (doc.kind === 'bmm-launchpack' || (Array.isArray(doc.exe_paths) && typeof doc.name === 'string')) {
    return 'bmmlaunch';
  }
  // `console`/`rustLog` identify BMM's own export. They are not required any more: a recording
  // taken without the console attached has neither, and it is still a replay.
  if (Array.isArray(doc.events) && ('console' in doc || 'rustLog' in doc || looksLikeRrweb(doc.events))) return 'bmmreplay';
  // A LOCKED mod list. Its contents are encrypted, so it has no `mods` and no
  // `format_version` — and without this it fell through every branch and came back as "not a
  // recognised BMM format", which tells a moderator the file is junk when it is a perfectly
  // ordinary list they simply cannot read. Recognised by its own claim; the header beside it
  // is what the format keeps readable ON PURPOSE, so there is something to check.
  // A PLUGIN's manifest.
  //
  // The unknown-format hint has told moderators to "paste the plugin.json from inside"
  // since it was written, and until now doing that returned "not a recognised BMM format".
  // The advice was right and the reader was missing.
  //
  // Identified by a field only a plugin has — not by `id` + `name`, which a theme.json also
  // carries, and misreading a theme as a plugin would report permissions and scripts for a
  // document that has neither.
  if (typeof doc.id === 'string' && typeof doc.name === 'string'
      && (typeof doc.apply_mode === 'string' || Array.isArray(doc.permissions)
          || isObj(doc.modlist) || Array.isArray(doc.assets) || Array.isArray(doc.scripts))) {
    return 'bmmplug';
  }
  if (doc.bmm_locked === true && isObj(doc.sealed)) return 'mm-locked';
  // A SERVER REPO manifest. Before the extras work a repo.json fell through every branch
  // and came back as "not a recognised BMM format" — which is the file a moderator opening
  // a hosted repo is most likely to be holding, and the one that now carries plugins.
  //
  // Recognised by `profiles` being an array of objects with `mods`. Not by `name` + `version`,
  // which half the documents in this file also have.
  if (Array.isArray(doc.profiles) && doc.profiles.some((p) => isObj(p) && Array.isArray(p.mods))) return 'repo';
  if (typeof doc.format_version === 'string' && Array.isArray(doc.mods)) return 'mm';
  // A .bmp modpack DOCUMENT: mods carrying per-file manifests with hashes. Distinguished
  // from a mod LIST ('mm') by shape, not by claim — a modpack's entries have mod_id and
  // file_manifest, a list's have links/url.
  if (Array.isArray(doc.mods) && doc.mods.some((m) => isObj(m) && typeof m.mod_id === 'string' && Array.isArray(m.file_manifest))) return 'bmp';
  // A .cbmp modpack CATALOGUE's catalog.json: named packs, each pointing at a packs/*.bmp
  // entry inside the same archive.
  if (Array.isArray(doc.modpacks) && doc.modpacks.some((m) => isObj(m) && typeof m.file === 'string')) return 'cbmp';
  // Any other BMM catalogue's catalog.json — automations, plugins, themes, apps, tutorials.
  // LAST on purpose: `modpacks` is also one of these arrays, and a .cbmp has a reader that
  // knows more about it than this one does, so it must win the tie.
  //
  // The shape, not a claim: one of the known arrays, holding objects. A document that says
  // `version: '1.0'` and nothing else is not a catalogue, and neither is `{ presets: 3 }`.
  if (CATALOG_ARRAYS.some((k) => Array.isArray(doc[k]) && doc[k].some(isObj))) return 'bmmcat';
  return null;
}

/** The arrays a BMM catalogue can list its entries under. Kept beside the frontend's copy
 *  in core/catalog-bundle.ts — BMM publishes the vocabulary, this reads it. */
const CATALOG_ARRAYS = ['presets', 'plugins', 'themes', 'apps', 'modpacks', 'tutorials', 'lists', 'catalogs', 'items'];

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
/**
 * A locked mod list: what it claims to be, and the fact that nothing else can be checked.
 *
 * Said plainly rather than dressed up. A moderator holding one of these can verify the name,
 * the author and the size of the claim — and nothing about its contents, because the contents
 * are not in the file in any readable form. Pretending otherwise, or reporting it as damaged,
 * both send somebody looking for a problem that is not there.
 */
function inspectLockedModList(doc) {
  const n = Number(doc.mods_count) || 0;
  return {
    title: String(doc.name || '(unnamed list)').slice(0, 200),
    summary: [
      // Flagged, because it is the fact that governs every other line: none of what follows
      // could be checked against the actual contents.
      row('Encrypted', 'yes — the contents cannot be inspected without the passphrase', 'warn'),
      row('Mods', n ? `${n} (claimed)` : '—'),
      row('Game', String(doc.game_name || '—')),
      row('Author', String(doc.author || '—')),
      row('Created', String(doc.created_at || '—')),
    ],
    detail: [],
  };
}

function inspectModList(doc) {
  const mods = arr(doc.mods);
  const hostsOf = (urls) => {
    const hosts = new Map();
    for (const u of urls) {
      try { const h = new URL(u).host; hosts.set(h, (hosts.get(h) || 0) + 1); } catch { /* not a URL */ }
    }
    return [...hosts].sort((a, b) => b[1] - a[1]).slice(0, 8);
  };

  // `download_links`, which is what the format actually calls it.
  //
  // This read `m.links` and `m.url`. Neither field has ever existed in a .mm — the entry
  // carries `download_links: [{url, link_type, label}]` — so "Download hosts" said "—" and
  // every entry's note was empty, for every list ever inspected. Nothing failed; a moderator
  // was simply told the list pointed nowhere.
  const dl = [];
  for (const m of mods.slice(0, 500)) {
    for (const l of arr(m?.download_links)) if (typeof l?.url === 'string') dl.push(l.url);
  }

  // Where the mods will UPDATE from, which is a different question and the one that matters
  // for moderation: installing a shared list wires each mod to these, so a list can hand
  // somebody an update source they never chose.
  const upd = [];
  for (const m of mods.slice(0, 500)) {
    if (typeof m?.source_repo === 'string') upd.push(m.source_repo);
    if (typeof m?.update_url === 'string') upd.push(m.update_url);
    for (const u of arr(m?.update_sources)) if (typeof u?.url === 'string') upd.push(u.url);
  }
  const updHosts = hostsOf(upd);
  const dlHosts = hostsOf(dl);
  const notes = mods.slice(0, 500).filter((m) => String(m?.install_notes || '').trim()).length;

  return {
    title: String(doc.name || '(unnamed list)').slice(0, 200),
    summary: [
      row('Mods', mods.length),
      row('Game', String(doc.game_name || '—')),
      row('Author', String(doc.author || '—')),
      row('Created', String(doc.created_at || '—')),
      row('Download hosts', dlHosts.length ? dlHosts.map(([h, n]) => `${h} (${n})`).join(', ') : '—'),
      // Flagged, not merely listed. Every one of these becomes an update source on the
      // machine that installs the list.
      ...(updHosts.length
        ? [row('Update hosts', updHosts.map(([h, n]) => `${h} (${n})`).join(', '), 'warn')]
        : []),
      ...(arr(doc.tag_defs).length ? [row('Tag definitions', arr(doc.tag_defs).length)] : []),
      ...(arr(doc.modpacks).length ? [row('Modpacks carried', arr(doc.modpacks).length)] : []),
      ...(notes ? [row('Entries with install notes', notes)] : []),
      // A path hint is a string from someone else's machine. Harmless, but it is the field
      // most likely to carry a person's name, and a moderator should see that it is there.
      ...(doc.game_path_hint ? [row('Path hint', String(doc.game_path_hint), 'warn')] : []),
    ],
    detail: mods.slice(0, 200).map((m) => ({
      name: String(m?.name || '(unnamed)').slice(0, 200),
      note: [
        ...arr(m?.download_links).map((l) => String(l?.url || '')),
        ...(m?.source_repo ? [`updates: ${m.source_repo}`] : []),
        ...(m?.update_url ? [`updates: ${m.update_url}`] : []),
      ].filter(Boolean).join(' · ').slice(0, 300),
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
function inspectReplay(input) {
  // A bare array IS the event stream. Normalising here rather than at every read below is what
  // keeps "we detected a replay" and "we can describe it" from disagreeing.
  const doc = Array.isArray(input) ? { events: input } : input;
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
      row('Shape', Array.isArray(input) ? 'bare rrweb event array' : 'BMM replay document'),
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
/**
 * A launch pack: which programs it would start on the machine that imports it.
 *
 * The only reason to inspect one. A pack is a list of executables somebody else chose, and
 * a moderator or a recipient deciding whether to trust it is deciding about that list —
 * not about a name and an icon.
 */
function inspectLaunchPack(doc) {
  const exes = arr(doc.exe_paths).filter((x) => typeof x === 'string');
  // BMM's own launcher runs these through `powershell -ExecutionPolicy Bypass` or `cmd /c`,
  // rather than starting them as programs. Worth a warn row: a `.exe` announces what it is,
  // a `.ps1` in a shared pack is somebody else's code about to run with the policy off.
  const scripted = exes.filter((p) => /\.(ps1|bat|cmd|vbs)$/i.test(p.trim()));
  // Relative means "resolved against whatever folder is current when it fires", which a file
  // that travels between machines cannot promise anything about.
  const relative = exes.filter((p) => {
    const t = p.trim();
    return t && !/^\\\\/.test(t) && !/^[a-z]:[\\/]/i.test(t) && !t.startsWith('/');
  });
  return {
    title: 'Launch pack',
    summary: [
      row('Name', String(doc.name ?? '(unnamed)').slice(0, 120), String(doc.name ?? '').trim() ? undefined : 'warn'),
      row('Programs', exes.length, exes.length ? undefined : 'warn'),
      row('Run through a shell', scripted.length, scripted.length ? 'warn' : undefined),
      row('Relative paths', relative.length, relative.length ? 'warn' : undefined),
    ],
    detail: exes.slice(0, 100).map((p) => ({
      name: (p.trim().split(/[\\/]/).filter(Boolean).pop() || p).slice(0, 120),
      // Printed exactly as written, never resolved and never opened.
      note: String(p).slice(0, 300),
    })),
  };
}

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
  // Whether the document is still what its author wrote. Reported for every format,
  // including the ones BMM does not sign yet — "unsigned" is an answer, and it is the one a
  // reviewer needs to see rather than a blank space where a verdict would go.
  const signature = verifyDocument(doc, format);
  if (format === 'bmmpa') return { ok: true, format, signature, bmmpa: inspectBmmpa(doc) };
  const readers = { bmmlaunch: inspectLaunchPack, mm: inspectModList, 'mm-locked': inspectLockedModList, bmmreplay: inspectReplay, bmmnav: inspectNav, bmp: inspectModpack, cbmp: inspectModpackCatalog, bmmcat: inspectCatalog, repo: inspectRepo, bmmplug: inspectPlugin };
  return { ok: true, format, signature, ...readers[format](doc) };
}

/**
 * A plugin's manifest (`plugin.json`).
 *
 * A plugin is the one thing in this system that is CODE running inside somebody's BMM, so
 * the summary is ordered by what a moderator has to decide: what it may reach (permissions),
 * whether it runs anything (scripts), what it changes (its mod list), and what it ships
 * alongside (assets).
 *
 * The asset list is a DECLARATION written from disk when the plugin was packed. It can
 * still be edited by hand afterwards, so it is reported as what the manifest says — the
 * archive is the only thing that settles it, and nobody reading a pasted manifest has one.
 */
function inspectPlugin(doc) {
  const perms = arr(doc.permissions).filter((p) => typeof p === 'string');
  const scripts = arr(doc.scripts).filter((p) => typeof p === 'string');
  const assets = arr(doc.assets).filter(isObj);
  const scriptAssets = assets.filter((a) => String(a.kind) === 'script');
  const required = arr(doc.modlist?.required_mods);

  const summary = [
    row('Id', doc.id || '—'),
    row('Version', doc.version || '—'),
    row('Author', doc.author || '—'),
  ];
  if (doc.game) summary.push(row('Game', String(doc.game)));

  // Permissions first: it is the row that says what this code may reach, and every other
  // row is less important than that one.
  summary.push(perms.length
    ? row('Permissions', perms.join(', '), 'warn')
    : row('Permissions', 'none'));

  // Whether it RUNS anything, from either signal. `has_scripts` is the author's checkbox and
  // `scripts` is the list; a plugin with the box ticked and an empty list still runs
  // something, and one with a list and the box unticked certainly does.
  if (doc.has_scripts || scripts.length) {
    summary.push(row(
      'Runs scripts',
      scripts.length ? scripts.join(', ') : 'yes — not listed by name',
      'warn',
    ));
  }
  if (typeof doc.apply_mode === 'string' && doc.apply_mode !== 'modlist') {
    summary.push(row('On apply', doc.apply_mode, doc.apply_mode === 'modlist' ? undefined : 'warn'));
  }
  if (required.length) {
    summary.push(row('Requires mods', String(required.length)));
    if (doc.modlist?.strict) {
      // Strict means it turns OTHER mods off. That is a bigger action than "installs these".
      summary.push(row('Strict list', 'yes — turns everything else off', 'warn'));
    }
  }
  if (arr(doc.folders).length) summary.push(row('Bundled folders', String(arr(doc.folders).length)));

  if (assets.length) {
    const byKind = new Map();
    for (const a of assets) {
      const k = String(a.kind || 'other');
      byKind.set(k, (byKind.get(k) || 0) + 1);
    }
    summary.push(row(
      'Ships files',
      [...byKind].map(([k, n]) => `${n} ${k}${n > 1 ? 's' : ''}`).join(', '),
      scriptAssets.length ? 'warn' : undefined,
    ));
    if (scriptAssets.length) {
      // Named. A shipped script is not the same as a declared one — nothing runs it
      // automatically — but it is a program in the archive, and a moderator should be told
      // its name rather than a count.
      summary.push(row('Shipped scripts', scriptAssets.map((a) => String(a.path)).join(', '), 'warn'));
    }
  }
  if (doc.website) summary.push(row('Website', String(doc.website)));

  return {
    title: String(doc.name || '(unnamed plugin)').slice(0, 200),
    summary,
    detail: assets.slice(0, 100).map((a) => ({
      name: String(a.path || '?').slice(0, 200),
      note: [String(a.kind || 'other'), a.size ? `${Math.max(1, Math.round(Number(a.size) / 1024))} KB` : '']
        .filter(Boolean).join(' · '),
    })),
  };
}

/**
 * The kinds a repo can carry besides mods, and which of them are CODE.
 *
 * `plugin` runs inside BMM; `task` is an automation that can run commands on the machine.
 * They are the two a moderator has to look at, so they are named here rather than left for
 * a reader to infer from a `kind` string. BMM ticks neither by default and installs both
 * disabled — this is the third place that fact is enforced, and the only one a moderator
 * ever sees.
 */
const EXTRA_CODE_KINDS = new Set(['plugin', 'task']);

/** How each kind reads in a summary. An unknown kind keeps its own name. */
const EXTRA_LABEL = {
  plugin: 'plugin', task: 'automation', theme: 'theme', modlist: 'mod list',
  bundle: 'catalogue bundle', catalog: 'catalogue', app: 'app source',
};

/**
 * A Server-Repo manifest (`repo.json`).
 *
 * Three questions, in the order a moderator asks them: how big is it, where do its files
 * come from, and — since a repo stopped being only mods — what ELSE is in it.
 *
 * The last one is flagged whenever it contains code. A repo that hands somebody a plugin is
 * not doing anything wrong, and it is also not the same object as a repo of mods; the
 * difference has to be visible before approval, not after.
 */
function inspectRepo(doc) {
  const profiles = arr(doc.profiles);
  const mods = profiles.flatMap((p) => arr(p?.mods));
  const hosts = new Map();
  for (const m of mods.slice(0, 1000)) {
    for (const l of arr(m?.download_links)) {
      if (typeof l?.url !== 'string') continue;
      try { const h = new URL(l.url).host; hosts.set(h, (hosts.get(h) || 0) + 1); } catch { /* not a URL */ }
    }
  }
  const top = [...hosts].sort((a, b) => b[1] - a[1]).slice(0, 8);

  const extras = arr(doc.extras).filter(isObj);
  const byKind = new Map();
  for (const e of extras) {
    const k = String(e.kind || '?');
    byKind.set(k, (byKind.get(k) || 0) + 1);
  }
  const code = extras.filter((e) => EXTRA_CODE_KINDS.has(String(e.kind)));

  const summary = [
    row('Author', doc.author || '—'),
    row('Version', doc.version || '—'),
    row('Profiles', profiles.length),
    row('Mods', mods.length),
  ];
  // Where the FILES live, when that is not next to the manifest. A manifest published on
  // one host whose mods come from another is a normal arrangement and an important fact.
  if (doc.files_base_url) summary.push(row('Files served from', String(doc.files_base_url), 'warn'));
  if (top.length) {
    summary.push(row('Download hosts', top.map(([h, n]) => `${h} (${n})`).join(', ')));
  }
  if (doc.require_login) summary.push(row('Requires a BetterCommunity login', 'yes'));
  if (extras.length) {
    summary.push(row(
      'Also carries',
      [...byKind].map(([k, n]) => `${n} ${EXTRA_LABEL[k] || k}${n > 1 ? 's' : ''}`).join(', '),
      code.length ? 'warn' : undefined,
    ));
  }
  if (code.length) {
    // Named, not counted. "1 plugin" is a number; "dcs-helper" is something a moderator can
    // go and look at.
    summary.push(row('Code in this repo', code.map((e) => String(e.name || e.id)).join(', '), 'warn'));
  }

  return {
    title: String(doc.name || '(unnamed repo)').slice(0, 200),
    summary,
    // One line per extra rather than per mod: a repo has hundreds of mods and the list of
    // them is not what anybody is reading this screen for.
    detail: extras.slice(0, 100).map((e) => ({
      name: String(e.name || e.id || '?').slice(0, 200),
      note: [
        EXTRA_LABEL[String(e.kind)] || String(e.kind || '?'),
        e.author ? `by ${e.author}` : '',
        e.url ? `→ ${e.url}` : '',
        e.locked ? 'locked' : '',
        e.file && !e.file.sha256_hash ? 'NO HASH' : '',
      ].filter(Boolean).join(' · '),
    })),
  };
}

/**
 * A .bmp modpack document.
 *
 * What a reviewer needs before approving: how many mods, how many carry a DOWNLOAD LINK a
 * stranger's BMM will follow, and which hosts those links point at — the same question the
 * mod-list reader answers, because it is the same risk in a different wrapper.
 */
function inspectModpack(doc) {
  const mods = arr(doc.mods);
  const hosts = new Map();
  let linked = 0;
  for (const m of mods.slice(0, 500)) {
    if (typeof m?.download_link === 'string' && m.download_link) {
      linked += 1;
      try { const h = new URL(m.download_link).host; hosts.set(h, (hosts.get(h) || 0) + 1); } catch { /* not a URL */ }
    }
  }
  const top = [...hosts].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const files = mods.reduce((a, m) => a + arr(m?.file_manifest).length, 0);
  return {
    title: String(doc.name || '(unnamed modpack)').slice(0, 200),
    summary: [
      row('Mods', mods.length),
      row('Files with hashes', files),
      row('Direct download links', linked, linked ? 'warn' : undefined),
      ...(top.length ? [row('Download hosts', top.map(([h, n]) => `${h} (${n})`).join(', '), 'warn')] : []),
    ],
  };
}

/**
 * A .cbmp modpack catalogue's catalog.json.
 *
 * The entries point at packs/*.bmp INSIDE the same archive; a `file` outside packs/ (or
 * trying to climb) is the thing to flag, because a reader extracting it is what path
 * traversal needs. BMM's own reader refuses those; a reviewer should see them anyway.
 */
function inspectModpackCatalog(doc) {
  const packs = arr(doc.modpacks);
  const badPaths = packs
    .map((m) => String(m?.file || ''))
    .filter((f) => f && (!f.startsWith('packs/') || f.includes('..')));
  return {
    title: String(doc.name || '(unnamed modpack catalogue)').slice(0, 200),
    summary: [
      row('Version', String(doc.version || '1.0')),
      row('Modpacks', packs.length),
      ...(badPaths.length ? [row('Suspicious entry paths', badPaths.slice(0, 5).join(', '), 'warn')] : []),
      row('Packs', packs.slice(0, 10).map((m) => m?.name || m?.id || '?').join(', ')),
    ],
  };
}

/**
 * Any other BMM catalogue's catalog.json — the document at the root of a bundle.
 *
 * The question a reviewer is holding is not "what does this list", it is **where does each
 * entry come from**. A catalogue is a set of addresses somebody else will follow, and the
 * three kinds do not carry the same risk:
 *
 *   · a name INSIDE the archive — packed with it, and reviewable right here;
 *   · an http(s) URL — a host to look at, and content that can change after review;
 *   · anything else — a scheme, an absolute path, a `..`. BMM's readers refuse those, and a
 *     reviewer should see that somebody tried.
 *
 * The counts are the summary. A catalogue that is entirely packed is a self-contained thing
 * that will do tomorrow what it does now; one that is entirely remote is a list of links,
 * and reviewing it means reviewing the hosts.
 */
function inspectCatalog(doc) {
  const rows = [];
  for (const key of CATALOG_ARRAYS) {
    for (const e of arr(doc[key])) {
      if (!isObj(e)) continue;
      const v = e.download_url ?? e.url ?? e.file ?? e.path;
      rows.push({ key, name: String(e.name || e.id || '?').slice(0, 80), addr: typeof v === 'string' ? v.trim() : '' });
    }
  }
  const remote = rows.filter((r) => /^https?:\/\//i.test(r.addr));
  const refused = rows.filter((r) => r.addr && !/^https?:\/\//i.test(r.addr)
    && (/^[a-z][a-z0-9+.-]*:/i.test(r.addr) || r.addr.startsWith('/') || r.addr.startsWith('\\')
        || /^[a-z]:/i.test(r.addr) || r.addr.split(/[/\\]/).some((seg) => seg === '..')));
  const packed = rows.filter((r) => r.addr && !remote.includes(r) && !refused.includes(r));
  const noAddress = rows.filter((r) => !r.addr);

  const hosts = [...new Set(remote.map((r) => { try { return new URL(r.addr).host; } catch { return '?'; } }))];
  const kinds = [...new Set(rows.map((r) => r.key))];

  return {
    title: String(doc.name || '(unnamed catalogue)').slice(0, 200),
    summary: [
      row('Version', String(doc.version || '1.0')),
      row('Lists', kinds.join(', ') || '—'),
      row('Entries', rows.length),
      row('Packed with the catalogue', packed.length),
      row('Fetched from elsewhere', remote.length, remote.length ? 'warn' : undefined),
      ...(hosts.length ? [row('Hosts', hosts.slice(0, 6).join(', '), 'warn')] : []),
      // Both of these are the reviewer's business and neither stops BMM working: it drops
      // the entry. Somebody publishing a catalogue full of them is the finding.
      ...(refused.length ? [row('Addresses BMM will refuse', refused.slice(0, 5).map((r) => `${r.name}: ${r.addr}`).join(', '), 'warn')] : []),
      ...(noAddress.length ? [row('Entries with no address', noAddress.length, 'warn')] : []),
      row('Entries', rows.slice(0, 10).map((r) => r.name).join(', ')),
    ],
    // The names the archive is expected to hold, so the caller can say whether it does.
    // Reported rather than judged: this reader is given ONE document and has never seen
    // the archive around it.
    packedNames: packed.map((r) => r.addr).slice(0, 500),
  };
}

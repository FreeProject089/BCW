// THE shape a project page reads, in one place.
//
// `project.<key>` is stored as a free-form `z.record(z.any())` — the route checks that it is
// an object and nothing more. So when project.jsx was rewritten to read `overview`,
// `community`, `stack` and `legal[]`, everything written under the older flat shape kept
// validating, kept saving, and stopped rendering. Blank pages, nothing logged.
//
// The seed had drifted the same way, which is worse: a brand-new install came up with empty
// project pages BY CONSTRUCTION, and there was nothing to notice because a fresh site looking
// bare is what a fresh site looks like.
//
// Both the seed and the repair now pass their config through `toCurrentShape`, so "what the
// page reads" is written once. A future rewrite of the page changes this file, and the seed
// follows without being remembered.

/** A legal card, as ShowcaseLegal renders them. */
const card = (icon, title, url) => ({ icon, title, url });

const LEGAL_TITLES = {
  tos: 'Terms of service',
  privacy: 'Privacy',
  license: 'License',
  readme: 'Readme',
  eula: 'EULA',
};
const LEGAL_ICONS = { tos: 'ShieldCheck', privacy: 'ShieldCheck', license: 'Scale', readme: 'FileText', eula: 'Scale' };

const FR_KEYS = new Set(['tosFr', 'privacyFr', 'readmeFr', 'eulaFr']);
const isUrl = (v) => typeof v === 'string' && /^https?:\/\//i.test(v.trim());

// Repair a legal ARRAY produced by an EARLIER, buggy migration. That version enumerated
// every legacy key, so its array holds a "License" card whose url is the license NAME
// ("GPL-3.0", not a link), a separate `licenseUrl` card carrying the real link, and
// `tosFr`/`privacyFr`/… French-twin cards. Detect that signature and consolidate: fold the
// license name + link into one card and drop the French twins. Returns null for an array
// that shows none of the signature — a clean, editor-authored array is left untouched, so
// this is idempotent and safe to run over every row.
function repairLegalCards(cards) {
  const junk = cards.some((c) => c && (
    c.title === 'licenseUrl' || FR_KEYS.has(c.title)
    || (c.title === 'License' && typeof c.url === 'string' && c.url.trim() && !isUrl(c.url))
  ));
  if (!junk) return null;

  let licenseName = '';
  let licenseUrl = '';
  const rest = [];
  for (const c of cards) {
    if (!c || !c.title) continue;
    if (FR_KEYS.has(c.title)) continue;                       // French twin → drop
    if (c.title === 'licenseUrl') { if (isUrl(c.url)) licenseUrl = c.url.trim(); continue; }
    if (c.title === 'License') {                              // the name-as-url junk, or a real license card
      if (isUrl(c.url)) licenseUrl ||= c.url.trim();
      else if (typeof c.url === 'string' && c.url.trim()) licenseName = c.url.trim();
      continue;
    }
    if (isUrl(c.url)) rest.push({ icon: c.icon || 'ShieldCheck', title: LEGAL_TITLES[c.title] || c.title, url: c.url.trim() });
  }
  const out = [];
  if (licenseUrl) out.push(card('Scale', licenseName || 'License', licenseUrl));
  out.push(...rest);
  return out;
}

function toCurrentShape(cfg) {
  const out = { ...cfg };
  const moved = [];

  // ── overview ─────────────────────────────────────────────────────────────
  if (!out.overview || typeof out.overview !== 'object') {
    const overview = {};
    if (out.replayUrl) { overview.replayUrl = out.replayUrl; moved.push('replayUrl'); }
    if (out.progress) { overview.progress = out.progress; moved.push('progress'); }
    if (Object.keys(overview).length) out.overview = overview;
  }
  delete out.replayUrl;
  delete out.progress;

  // ── community ────────────────────────────────────────────────────────────
  if (!out.community || typeof out.community !== 'object') {
    const community = {};
    if (Array.isArray(out.contributors) && out.contributors.length) { community.contributors = out.contributors; moved.push('contributors'); }
    if (Array.isArray(out.messages) && out.messages.length) { community.messages = out.messages; moved.push('messages'); }
    if (out.contributorsUrl) { community.contributorsUrl = out.contributorsUrl; moved.push('contributorsUrl'); }
    if (Object.keys(community).length) out.community = community;
  }
  delete out.contributors;
  delete out.messages;
  delete out.contributorsUrl;

  // ── legal: an object of links becomes an array of cards ─────────────────
  //
  // The legacy shape is a KNOWN set of paired keys, not a free-form map:
  //   • `license` is a NAME (e.g. "GPL-3.0"), and `licenseUrl` is its link;
  //   • `tos` / `privacy` / `readme` / `eula` are each a URL, each with an
  //     optional `*Fr` twin holding the French version of that same document.
  //
  // A blind Object.entries() over that turned every key into its own card: a
  // "License" card whose url was the literal string "GPL-3.0", plus junk cards
  // titled `licenseUrl`, `tosFr`, `privacyFr`. Map the known shape instead. A
  // canonical card carries ONE url (its title/text may be localized, its url is
  // not), so the French twin is folded away rather than shown as a second
  // document — the same single-link-per-document the editor produces.
  if (out.legal && !Array.isArray(out.legal) && typeof out.legal === 'object') {
    const L = out.legal;
    const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : '');
    const cards = [];
    // License: the link is `licenseUrl`; `license` is the human name → the title.
    if (str(L.licenseUrl)) cards.push(card('Scale', str(L.license) || 'License', str(L.licenseUrl)));
    // The remaining known documents: one URL each, the `*Fr` twin dropped.
    for (const k of ['tos', 'privacy', 'readme', 'eula']) {
      if (str(L[k])) cards.push(card(LEGAL_ICONS[k] || 'ShieldCheck', LEGAL_TITLES[k] || k, str(L[k])));
    }
    // Anything else with a string URL that is NOT one of the paired keys we just
    // consumed — keep it, titled by its key, so an unforeseen legacy field still
    // surfaces instead of vanishing.
    const consumed = new Set(['license', 'licenseUrl', 'tos', 'tosFr', 'privacy', 'privacyFr', 'readme', 'readmeFr', 'eula', 'eulaFr']);
    for (const [k, url] of Object.entries(L)) {
      if (consumed.has(k) || !str(url)) continue;
      cards.push(card('ShieldCheck', LEGAL_TITLES[k] || k, str(url)));
    }
    // The tab is opt-in, so turning the cards on without turning the tab on would hide them
    // exactly as effectively as leaving them in the wrong shape.
    out.legal = cards;
    if (cards.length) {
      out.tabs = { ...(out.tabs || {}), legal: true };
      moved.push(`legal (${cards.length} card${cards.length > 1 ? 's' : ''})`);
    }
  } else if (Array.isArray(out.legal) && out.legal.length) {
    // Already an array — but possibly one an earlier, buggy migration filled with junk.
    const repaired = repairLegalCards(out.legal);
    if (repaired) {
      out.legal = repaired;
      moved.push(`legal (repaired to ${repaired.length} card${repaired.length > 1 ? 's' : ''})`);
    }
  }

  return { out, moved };
}

export { toCurrentShape };

// ── The default "How it runs" graphs ─────────────────────────────────────────
//
// Used by BOTH the seed (fresh install) and fix-project-config --write (existing install
// whose rows predate the stack tab). One copy on purpose: two would drift, and the day they
// differ a fresh site and a repaired site describe two different architectures.
//
// Each entry is spread into a project config: { tabs: {stack:true}, stack: {...} }.
export const DEFAULT_STACKS = {
  community: {
  tabs: { stack: true },
  stack: {
    title: 'How it runs',
    nodes: [
      { id: 'edge', label: 'Caddy edge', kind: 'infra', tech: 'Caddy', note: 'TLS, anti-bot guards and routing in front of everything.' },
      { id: 'web', label: 'Web app', kind: 'app', tech: 'React + Vite', note: 'The site itself — catalogs, blogs, dashboards.' },
      { id: 'api', label: 'API', kind: 'service', tech: 'Node + Fastify', note: 'Accounts, catalogs, hosting, payments — every route the web app calls.' },
      { id: 'db', label: 'Database', kind: 'db', tech: 'PostgreSQL + Prisma', note: 'The one source of truth.' },
      { id: 'bot', label: 'Discord bot', kind: 'service', tech: 'discord.js', note: 'Community bridge: roles, announcements, Ko-fi tips.' },
      { id: 'store', label: 'File storage', kind: 'infra', tech: 'S3-compatible', note: 'Hosted repos and catalog payloads.' },
    ],
    edges: [
      { from: 'edge', to: 'web' }, { from: 'api', to: 'web', label: 'JSON' },
      { from: 'db', to: 'api', label: 'SQL' }, { from: 'api', to: 'bot' }, { from: 'store', to: 'api' },
    ],
  },
  },
  bmm: {
  tabs: { stack: true },
  stack: {
    // The code map is a SECOND view of this project, built from the repository rather
    // than from the hand-drawn nodes below. Off for `community`, whose repo is private:
    // publishing a map of a closed source tree is publishing the source tree's shape.
    showCodeMap: true,
    codeMapNote: 'Every file BMM is built from, and how they reach each other. Generated from the repository, not drawn by hand.',
    title: 'How it runs',
    nodes: [
      { id: 'ui', label: 'Frontend', kind: 'app', tech: 'TypeScript', note: 'The whole interface — library, profiles, repo tools, themes.' },
      { id: 'core', label: 'Rust core', kind: 'service', tech: 'Tauri v2 + Rust', note: 'File operations, hashing, signing, SSH/SFTP — everything that touches the disk.' },
      { id: 'api', label: 'Plugin API', kind: 'service', tech: 'HTTP (localhost)', note: 'Local API that plugins, scripts and deeplinks talk to.' },
      { id: 'mcp', label: 'MCP server / CLI', kind: 'service', tech: 'Rust (rmcp)', note: 'The same features for AI agents and the terminal.' },
      { id: 'sched', label: 'Scheduler', kind: 'service', note: 'Automations: triggers, conditions and 70+ action types.' },
    ],
    edges: [
      { from: 'core', to: 'ui' }, { from: 'core', to: 'api' },
      { from: 'api', to: 'mcp', label: 'bridge' }, { from: 'core', to: 'sched' },
    ],
  },
  },
  bsm: {
  tabs: { stack: true },
  stack: {
    // The code map is a SECOND view of this project, built from the repository rather
    // than from the hand-drawn nodes below. Off for `community`, whose repo is private:
    // publishing a map of a closed source tree is publishing the source tree's shape.
    showCodeMap: true,
    codeMapNote: 'The shape of Better Sound Maker, read straight from its repository.',
    title: 'How it runs',
    nodes: [
      { id: 'app', label: 'BSM app', kind: 'app', note: 'Builds and applies sound presets.' },
      { id: 'catalog', label: 'Preset catalog', kind: 'service', tech: 'BetterCommunity', note: 'Where community presets are published and fetched from.' },
    ],
    edges: [{ from: 'catalog', to: 'app', label: 'presets' }],
  },
  },
  // Keyed by the PROJECT KEY as the seed and the database use it ('installer', not
  // 'betterinstaller'): fix-project-config looks these up by the row name, so a key that
  // merely reads right matches nothing and repairs nothing, without an error.
  installer: {
  tabs: { stack: true },
  stack: {
    // The code map is a SECOND view of this project, built from the repository rather
    // than from the hand-drawn nodes below. Off for `community`, whose repo is private:
    // publishing a map of a closed source tree is publishing the source tree's shape.
    showCodeMap: true,
    codeMapNote: 'What BetterInstaller is made of — one crate at a time.',
    title: 'How it runs',
    nodes: [
      { id: 'ui', label: 'Installer UI', kind: 'app', tech: 'Slint + Rust', note: 'The installer window itself.' },
      { id: 'assets', label: 'Platform assets', kind: 'service', tech: 'BetterCommunity', note: 'Where installers and update feeds are hosted.' },
      { id: 'handoff', label: 'App handoff', kind: 'infra', note: 'Hands the installed app its first-run configuration.' },
    ],
    edges: [{ from: 'assets', to: 'ui', label: 'downloads' }, { from: 'ui', to: 'handoff' }],
  },
  },
};

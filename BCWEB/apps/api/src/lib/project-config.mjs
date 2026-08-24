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
  if (out.legal && !Array.isArray(out.legal) && typeof out.legal === 'object') {
    const cards = Object.entries(out.legal)
      .filter(([, url]) => typeof url === 'string' && url.trim())
      .map(([k, url]) => card(LEGAL_ICONS[k] || 'ShieldCheck', LEGAL_TITLES[k] || k, url.trim()));
    // The tab is opt-in, so turning the cards on without turning the tab on would hide them
    // exactly as effectively as leaving them in the wrong shape.
    out.legal = cards;
    if (cards.length) {
      out.tabs = { ...(out.tabs || {}), legal: true };
      moved.push(`legal (${cards.length} card${cards.length > 1 ? 's' : ''})`);
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

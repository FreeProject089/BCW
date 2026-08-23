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

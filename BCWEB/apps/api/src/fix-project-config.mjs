// Bring stored project configs up to the shape the project page actually reads.
//
// The page and the stored config had drifted. `project.<key>` in AdminSetting is a free-form
// `z.record(z.any())` — the route validates that it is an object and nothing more — so when
// project.jsx was rewritten to read `overview`, `community`, `stack` and `legal[]`, the rows
// written under the old flat shape kept validating, kept saving, and stopped rendering. The
// pages went blank with nothing logged anywhere, which reads as "the data is gone".
//
// It is not gone. This moves it:
//
//   replayUrl                        → overview.replayUrl
//   progress                         → overview.progress
//   contributors / messages /
//   contributorsUrl                  → community.*
//   legal { tos, license, readme, … }→ legal[] cards, one per non-empty link
//
// `stack` has no old equivalent, so nothing is invented for it — the "How it runs" tab simply
// stays off until somebody describes one, which is the truthful state.
//
// Idempotent: a row already carrying the new shape is left alone, so running this twice is a
// no-op rather than a second migration on top of the first.
//
//   node src/fix-project-config.mjs          # report only
//   node src/fix-project-config.mjs --write  # apply

import { db } from './lib/lib.mjs';

const WRITE = process.argv.includes('--write');

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

function migrate(cfg) {
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

const p = await db();
const rows = await p.adminSetting.findMany({ where: { key: { startsWith: 'project.' } } });
if (!rows.length) {
  console.log('Aucune configuration de projet en base.');
  process.exit(0);
}

let changed = 0;
for (const row of rows) {
  const cfg = row.value && typeof row.value === 'object' ? row.value : {};
  const { out, moved } = migrate(cfg);
  if (!moved.length) {
    console.log(`${row.key.padEnd(20)} déjà à jour`);
    continue;
  }
  changed += 1;
  console.log(`${row.key.padEnd(20)} ${moved.join(', ')}`);
  if (WRITE) await p.adminSetting.update({ where: { key: row.key }, data: { value: out } });
}

console.log('');
if (!changed) console.log('Rien à faire.');
else if (WRITE) console.log(`${changed} configuration(s) migrée(s). Rechargez la page projet.`);
else console.log(`${changed} configuration(s) à migrer. Relancez avec --write pour appliquer.`);
process.exit(0);

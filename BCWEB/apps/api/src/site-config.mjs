// Carry a site's LOOK and STRUCTURE from one install to another.
//
// Why this exists rather than a bigger seed: the topbar and the footer already have working
// defaults in the code — `<Footer/>` renders its built-in columns when no config is enabled,
// and App.jsx ships a default nav. Nothing is broken on a fresh install. What is missing on a
// new database is the CUSTOMISATION somebody built, and that lives in AdminSetting rows.
//
// A seed cannot give that back. It would write MY version of a topbar over yours, which is a
// worse outcome than the empty one: you would then have to tell the difference between what
// you configured and what a script guessed. So this moves the real thing instead.
//
//   node src/site-config.mjs export site.json    # on the install that HAS the config
//   node src/site-config.mjs import site.json    # on the one that needs it
//   node src/site-config.mjs import site.json --force   # overwrite rows that already exist
//
// SECRETS ARE NEVER EXPORTED. AdminSetting also holds `bot.token`, `kofi.token` and the
// analytics watermarks; a dump that swept the table would put a live Discord token in a file
// people mail to each other. The allowlist below is what travels, and anything not named in
// it is skipped — including keys added later, which fail closed rather than leaking by
// default.

import { readFileSync, writeFileSync } from 'node:fs';
import { db } from './lib/lib.mjs';
import { SECRET_SETTING_KEYS } from './lib/secret-guard.mjs';

/** Exact keys that describe how the site LOOKS. */
const KEYS = ['nav.config', 'footer.config', 'reports.config'];
/** Prefixes: every fixed project's page config. */
const PREFIXES = ['project.'];
/** Theme, whose key is defined next to the route that serves it. */
const THEME_KEY = 'site.theme';

/** Never, under any circumstance. Checked as a belt on top of the allowlist. */
const NEVER = [/token/i, /secret/i, /password/i, /\.status$/, /rollupAt$/, /Announced$/, /^bot\./, /^migr\./];

const exportable = (key) => {
  if (SECRET_SETTING_KEYS.has(key) || NEVER.some((re) => re.test(key))) return false;
  return KEYS.includes(key) || key === THEME_KEY || PREFIXES.some((p) => key.startsWith(p));
};

async function doExport(file) {
  const p = await db();
  const rows = await p.adminSetting.findMany();
  const kept = rows.filter((r) => exportable(r.key));
  const skipped = rows.length - kept.length;

  // FAQ travels too: it is site copy, not configuration, but it is exactly the kind of thing
  // that was written once and would otherwise be retyped on the new install.
  // `order`, the column FaqItem has. It said `sort`, which Prisma refuses, and the catch
  // turned that into an empty list: the FAQ never travelled.
  const faq = await p.faqItem.findMany({ orderBy: { order: 'asc' } }).catch(() => []);

  const dump = {
    kind: 'bcweb-site-config',
    version: 1,
    settings: kept.map((r) => ({ key: r.key, value: r.value })),
    faq: faq.map(({ id, createdAt, updatedAt, ...rest }) => rest),
  };
  writeFileSync(file, JSON.stringify(dump, null, 2));
  console.log(`${kept.length} réglage(s) et ${faq.length} entrée(s) FAQ écrits dans ${file}.`);
  for (const r of kept) console.log(`  ${r.key}`);
  if (skipped) console.log(`\n${skipped} clé(s) ignorée(s) : secrets, jetons et compteurs internes ne voyagent pas.`);
}

async function doImport(file, force) {
  const dump = JSON.parse(readFileSync(file, 'utf8'));
  if (dump.kind !== 'bcweb-site-config') {
    console.error(`${file} n'est pas un export de configuration BCWEB.`);
    process.exit(1);
  }
  const p = await db();
  let wrote = 0, kept = 0;
  for (const s of dump.settings || []) {
    // Re-checked on the way IN as well. A hand-edited dump is a file like any other, and
    // trusting it to contain only what the exporter would have written is trusting the wrong
    // side of the boundary.
    if (!exportable(s.key)) { console.log(`  ${s.key} — ignoré (hors périmètre)`); continue; }
    const existing = await p.adminSetting.findUnique({ where: { key: s.key } });
    if (existing && !force) { console.log(`  ${s.key} — déjà présent, laissé tel quel`); kept += 1; continue; }
    await p.adminSetting.upsert({ where: { key: s.key }, create: { key: s.key, value: s.value }, update: { value: s.value } });
    console.log(`  ${s.key} — écrit`);
    wrote += 1;
  }

  let faqWrote = 0;
  for (const f of dump.faq || []) {
    // Keyed by question, because that is what a duplicate would look like to a reader. An
    // id would be meaningless on the other install.
    const existing = await p.faqItem.findFirst({ where: { question: f.question } });
    if (existing && !force) continue;
    if (existing) await p.faqItem.update({ where: { id: existing.id }, data: f });
    else await p.faqItem.create({ data: f });
    faqWrote += 1;
  }

  console.log('');
  console.log(`${wrote} réglage(s) écrit(s), ${kept} laissé(s) en place, ${faqWrote} entrée(s) FAQ.`);
  if (kept && !force) console.log('Relancez avec --force pour écraser ce qui existe déjà.');
}

const [, , cmd, file, ...rest] = process.argv;
if (!['export', 'import'].includes(cmd) || !file) {
  console.error('Usage : node src/site-config.mjs export|import <fichier.json> [--force]');
  process.exit(1);
}
if (cmd === 'export') await doExport(file);
else await doImport(file, rest.includes('--force'));
process.exit(0);

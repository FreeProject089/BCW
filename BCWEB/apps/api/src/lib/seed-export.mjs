// Custom seed generator (Prmtp123 §3): read the CURRENT content an admin selects and emit a
// self-contained, runnable, idempotent Node seed script that recreates it on another install.
//
// Kept as pure functions (the DB read is one small query per section, the script build is string
// assembly) so the script generation is unit-testable without a database. The route (misc.mjs)
// wires the preview + download on top.

// The sections an admin can pick, each mapping to how its rows are read and re-seeded. Only
// self-contained content is offered here: AdminSetting rows (projects, site settings, legal
// pages, nav, home, scene…) carry no cross-model foreign keys in their VALUE, and a HostingPlan
// is a flat row — both re-seed cleanly anywhere. Blog/docs/FAQ reference an author + project id
// and need those resolved first, so they are a later addition (noted in the UI).
export const SEED_SECTIONS = {
  projects: { label: 'Projects', kind: 'adminSetting', prefix: 'project.' },
  hostingPlans: { label: 'Hosting plans', kind: 'hostingPlan' },
  legal: { label: 'Legal pages', kind: 'legalPage' },
  siteSettings: { label: 'Site settings (home / scene / nav / footer)', kind: 'adminSetting', keys: ['site.home', 'site.scene', 'site.showcase', 'nav.config', 'footer.config', 'seo.config'] },
  hostingSettings: { label: 'Hosting settings', kind: 'adminSetting', prefixes: ['hosting.', 'pricing.', 'catalog.', 'telemetry.'] },
  // Self-contained content: these carry no cross-model foreign key (a doc/badge is keyed by its
  // own slug, a FAQ by its question), so they re-seed cleanly on any install. Blog posts are the
  // exception still missing — they reference an author + a project, which the generated script
  // would have to resolve first.
  docs: { label: 'Documentation pages', kind: 'docPage' },
  faq: { label: 'FAQ entries', kind: 'faqItem' },
  badges: { label: 'Badges', kind: 'badge' },
};

/** JSON literal safe to paste into a JS source file — no `</script>` breakout, valid JS. */
export function jsLiteral(value) {
  return JSON.stringify(value, null, 2)
    .replace(/<\//g, '<\\/');
}

/**
 * Build a runnable ESM seed script from the rows read for each selected section.
 * @param sections  ordered list of section keys included
 * @param data      { adminSettings: [{key,value}], hostingPlans: [...], legalPages: [...] }
 * @param meta      { generatedAtIso, by } — stamped in the header (passed in; no Date.now here)
 */
export function generateSeedScript(sections, data, meta = {}) {
  const lines = [];
  const p = (s) => lines.push(s);
  p('// BetterCommunity — custom seed script (generated).');
  p(`// Sections: ${sections.join(', ') || '(none)'}`);
  if (meta.generatedAtIso) p(`// Generated: ${meta.generatedAtIso}${meta.by ? ` by ${meta.by}` : ''}`);
  p('//');
  p('// Idempotent: every write is an upsert / find-or-create, so running it twice changes');
  p('// nothing the second time. Run with the api\'s env (DATABASE_URL set):  node this-file.mjs');
  p("import { PrismaClient } from '@prisma/client';");
  p('const p = new PrismaClient();');
  p('let created = 0, updated = 0;');
  p('async function main() {');

  const settings = data.adminSettings || [];
  if (settings.length) {
    p('  // ── AdminSetting rows (projects / site / hosting settings / legal-as-settings) ──');
    p(`  const settings = ${jsLiteral(settings)};`);
    p('  for (const s of settings) {');
    p('    const before = await p.adminSetting.findUnique({ where: { key: s.key } });');
    p('    await p.adminSetting.upsert({ where: { key: s.key }, create: s, update: { value: s.value } });');
    p('    before ? updated++ : created++;');
    p('  }');
  }

  const plans = data.hostingPlans || [];
  if (plans.length) {
    p('  // ── Hosting plans (matched by name; name is not unique so we find-or-create) ──');
    p(`  const plans = ${jsLiteral(plans)};`);
    p('  for (const pl of plans) {');
    p('    const found = await p.hostingPlan.findFirst({ where: { name: pl.name } });');
    p('    if (found) { await p.hostingPlan.update({ where: { id: found.id }, data: pl }); updated++; }');
    p('    else { await p.hostingPlan.create({ data: pl }); created++; }');
    p('  }');
  }

  const legal = data.legalPages || [];
  if (legal.length) {
    p('  // ── Legal pages (matched by slug) ──');
    p(`  const legal = ${jsLiteral(legal)};`);
    p('  for (const l of legal) {');
    p('    const before = await p.legalPage.findUnique({ where: { slug: l.slug } }).catch(() => null);');
    p('    await p.legalPage.upsert({ where: { slug: l.slug }, create: l, update: l });');
    p('    before ? updated++ : created++;');
    p('  }');
  }

  const docs = data.docPages || [];
  if (docs.length) {
    p('  // ── Documentation pages (matched by slug) ──');
    p(`  const docs = ${jsLiteral(docs)};`);
    p('  for (const d of docs) {');
    p('    const before = await p.docPage.findUnique({ where: { slug: d.slug } }).catch(() => null);');
    p('    await p.docPage.upsert({ where: { slug: d.slug }, create: d, update: d });');
    p('    before ? updated++ : created++;');
    p('  }');
  }

  const faq = data.faqItems || [];
  if (faq.length) {
    p('  // ── FAQ entries (matched by question — no unique column, so find-or-create) ──');
    p(`  const faq = ${jsLiteral(faq)};`);
    p('  for (const f of faq) {');
    p('    const found = await p.faqItem.findFirst({ where: { question: f.question } });');
    p('    if (found) { await p.faqItem.update({ where: { id: found.id }, data: f }); updated++; }');
    p('    else { await p.faqItem.create({ data: f }); created++; }');
    p('  }');
  }

  const badges = data.badges || [];
  if (badges.length) {
    p('  // ── Badges (matched by slug) ──');
    p(`  const badges = ${jsLiteral(badges)};`);
    p('  for (const b of badges) {');
    p('    const before = await p.badge.findUnique({ where: { slug: b.slug } }).catch(() => null);');
    p('    await p.badge.upsert({ where: { slug: b.slug }, create: b, update: b });');
    p('    before ? updated++ : created++;');
    p('  }');
  }

  p('}');
  p('main()');
  p('  .then(() => console.log(`[seed] done — ${created} created, ${updated} updated.`))');
  p('  .catch((e) => { console.error(e); process.exitCode = 1; })');
  p('  .finally(() => p.$disconnect());');
  return `${lines.join('\n')}\n`;
}

/**
 * Read the current content for the selected sections + a summary of what will be included.
 * Returns { data, summary } — data feeds generateSeedScript, summary feeds the preview.
 */
export async function readSeedContent(p, selected) {
  const data = { adminSettings: [], hostingPlans: [], legalPages: [], docPages: [], faqItems: [], badges: [] };
  const summary = {};
  const wantSettingKeys = new Set();
  const wantSettingPrefixes = [];

  for (const key of selected) {
    const sec = SEED_SECTIONS[key];
    if (!sec) continue;
    if (sec.kind === 'adminSetting') {
      if (sec.prefix) wantSettingPrefixes.push(sec.prefix);
      (sec.prefixes || []).forEach((pre) => wantSettingPrefixes.push(pre));
      (sec.keys || []).forEach((k) => wantSettingKeys.add(k));
    }
  }

  if (wantSettingKeys.size || wantSettingPrefixes.length) {
    const rows = await p.adminSetting.findMany({ select: { key: true, value: true } });
    data.adminSettings = rows.filter((r) => wantSettingKeys.has(r.key) || wantSettingPrefixes.some((pre) => r.key.startsWith(pre)));
  }
  if (selected.includes('hostingPlans')) {
    data.hostingPlans = (await p.hostingPlan.findMany()).map(({ id, createdAt, updatedAt, ...rest }) => ({ ...rest, storageGB: rest.storageGB }));
    summary.hostingPlans = data.hostingPlans.length;
  }
  if (selected.includes('legal') && p.legalPage) {
    data.legalPages = (await p.legalPage.findMany().catch(() => [])).map(({ id, createdAt, updatedAt, ...rest }) => rest);
    summary.legal = data.legalPages.length;
  }
  if (selected.includes('docs') && p.docPage) {
    // Content fields only — strip the row id, timestamps, the optimistic-concurrency `version`
    // and the "was this helpful" tallies (all runtime state, not authored content).
    data.docPages = (await p.docPage.findMany().catch(() => []))
      .map(({ slug, title, titleFr, category, categoryFr, icon, body, bodyFr, order, published }) =>
        ({ slug, title, titleFr, category, categoryFr, icon, body, bodyFr, order, published }));
    summary.docs = data.docPages.length;
  }
  if (selected.includes('faq') && p.faqItem) {
    data.faqItems = (await p.faqItem.findMany().catch(() => []))
      .map(({ question, questionFr, answer, answerFr, category, categoryFr, order, published }) =>
        ({ question, questionFr, answer, answerFr, category, categoryFr, order, published }));
    summary.faq = data.faqItems.length;
  }
  if (selected.includes('badges') && p.badge) {
    data.badges = (await p.badge.findMany().catch(() => []))
      .map(({ slug, name, description, iconType, icon, color, grant, trigger, rule, earnMessage, priority, active }) =>
        ({ slug, name, description, iconType, icon, color, grant, trigger, rule, earnMessage, priority, active }));
    summary.badges = data.badges.length;
  }
  // Per-section AdminSetting counts for the preview.
  for (const key of selected) {
    const sec = SEED_SECTIONS[key];
    if (!sec || sec.kind !== 'adminSetting') continue;
    const keys = new Set(sec.keys || []);
    const pres = [sec.prefix, ...(sec.prefixes || [])].filter(Boolean);
    summary[key] = data.adminSettings.filter((r) => keys.has(r.key) || pres.some((pre) => r.key.startsWith(pre))).length;
  }
  return { data, summary };
}

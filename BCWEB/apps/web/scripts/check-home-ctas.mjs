// The landing pages must not offer a signed-in visitor an account.
//
// The closing call to action said "Get started" and pointed at /auth — to everybody,
// including the member reading it while signed in. That is an invitation to create the
// account they are currently using, and it is invisible to every other check here: the page
// renders, the link resolves, the string is translated. Only a person who is signed in ever
// sees it, and they are not the person testing the landing page.
//
// Two questions, because there are three landing-page variants and the rule has to hold for
// all of them:
//
//   1. lib/home-ctas.js really does answer differently for the two visitors, and never sends
//      a signed-in one to /auth.
//   2. no landing page hard-codes a link to /auth. That is how the rule gets bypassed — not
//      by changing the module, but by adding a button beside it.
//
// Runs from `npm run lint`, which is what CI runs. (`npm run build` has its own checks in
// front of vite, but CI calls `npx vite build` directly, so anything hung there does not run.)
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MODULE = join(ROOT, 'src/lib/home-ctas.js');
const PAGES = ['src/pages/home.jsx', 'src/pages/home-variants.jsx'];

const problems = [];
for (const f of [MODULE, ...PAGES.map((p) => join(ROOT, p))]) {
  if (!existsSync(f)) {
    console.error(`✗ ${f} is missing — refusing to report success`);
    process.exit(2);
  }
}

// `t` as identity-with-fallback, which is what the real one does for a key with no override.
const t = (k, fallback) => fallback || k;
const { heroCtas, heroNote, closingCta } = await import(pathToFileURL(MODULE).href);

const MEMBER = { id: 'u1', email: 'someone@example.com' };
const out = {
  guest: { hero: heroCtas(null, t), note: heroNote(null, t), closing: closingCta(null, t) },
  member: { hero: heroCtas(MEMBER, t), note: heroNote(MEMBER, t), closing: closingCta(MEMBER, t) },
};

// The failure the whole file is about.
const memberTargets = [...out.member.hero.map((c) => c.to), out.member.closing.action.to];
if (memberTargets.includes('/auth')) {
  problems.push(`a signed-in visitor is offered /auth: ${memberTargets.join(', ')}`);
}
// And the opposite, so this cannot be "fixed" by making both branches identical: a rule that
// answers the same thing twice is not a rule, and the page would be back where it started.
if (JSON.stringify(out.guest) === JSON.stringify(out.member)) {
  problems.push('the two visitors are offered exactly the same thing — the branch does nothing');
}
// A guest has to be able to get an account from somewhere on the page.
if (out.guest.closing.action.to !== '/auth') {
  problems.push(`the signed-out closing action points at ${out.guest.closing.action.to}, not /auth`);
}
// Every descriptor has to be usable: a missing label renders an empty button.
for (const [who, v] of Object.entries(out)) {
  for (const c of [...v.hero, v.closing.action]) {
    if (!c.to || !c.label) problems.push(`${who}: a call to action has no ${c.to ? 'label' : 'target'}`);
  }
  if (!v.hero.some((c) => c.primary)) problems.push(`${who}: no primary button in the hero`);
}

// Hard-coded /auth links on the landing pages, which is how the module gets routed around.
for (const rel of PAGES) {
  const src = readFileSync(join(ROOT, rel), 'utf8');
  // `to="/auth"` written literally. A conditional expression that happens to produce it is
  // fine — that is the module's own output, or a deliberate guest-only branch.
  for (const m of src.matchAll(/to=["']\/auth["']/g)) {
    const line = src.slice(0, m.index).split('\n').length;
    // The one legitimate literal: step 1 of "how it works", which already picks its target
    // from `user`. Recognised by the ternary on the same line rather than by line number.
    const text = src.split('\n')[line - 1];
    if (/user\s*\?/.test(text)) continue;
    problems.push(`${rel}:${line} links to /auth unconditionally — route it through home-ctas.js`);
  }
}

if (problems.length) {
  console.error('✗ home calls to action:');
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}

const show = (v) => `${v.hero.map((c) => `${c.label} → ${c.to}`).join(' | ')} · closing: ${v.closing.action.label} → ${v.closing.action.to}`;
console.log('✓ home CTAs differ by sign-in state');
console.log(`  signed out: ${show(out.guest)}`);
console.log(`  signed in:  ${show(out.member)}`);

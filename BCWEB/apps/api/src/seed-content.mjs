// Re-seed every piece of SITE CONTENT in one command: `npm run seed:content`.
//
// The pieces already existed as separate scripts; what was missing was a single way to put
// the site's documentation, FAQ, blog and guide back after a wipe, in the right order and
// without remembering four commands.
//
// Each step is a CHILD PROCESS rather than a dynamic import, and that is not incidental.
// Every seed calls `run()` at module top level without awaiting it, so `await import(...)`
// resolves the moment the module body finishes — before the writes complete. Importing
// them in sequence would overlap the seeds and leave the later ones racing the earlier
// ones' transactions. A child process finishes when the work does, and its exit code is
// the honest answer to "did it work".
//
// Order matters: seed.mjs creates the admin account, the projects and the blog those
// later steps attach to, so it runs first and a failure stops the chain rather than
// seeding documentation onto a database with no project to hang it from.
//
// Everything here is idempotent — the base seed guards its two creates with existence
// checks and the rest upsert — so running it on a populated database updates rather than
// duplicates. That is what makes it safe to use as a repair tool and not just a bootstrap.

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const STEPS = [
  { file: 'seed.mjs', what: 'base: admin, projects, hosting plans, blog posts' },
  { file: 'seed-docs.mjs', what: 'documentation pages (EN + FR)' },
  { file: 'seed-faq.mjs', what: 'FAQ entries' },
  { file: 'seed-site-guide.mjs', what: 'site guide' },
];

const run = (file) => new Promise((resolve, reject) => {
  // stdio inherited so each seed's own summary line reaches the terminal unchanged —
  // capturing it would hide exactly the counts you run this to read.
  const child = spawn(process.execPath, [path.join(HERE, file)], { stdio: 'inherit' });
  child.on('error', reject);
  child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${file} exited ${code}`))));
});

(async () => {
  console.log(`[seed:content] ${STEPS.length} steps\n`);
  for (const [i, step] of STEPS.entries()) {
    console.log(`── ${i + 1}/${STEPS.length}  ${step.file} — ${step.what}`);
    try {
      await run(step.file);
    } catch (e) {
      // Named loudly: a half-seeded site is worse than an unseeded one, because it looks
      // finished. Say which step stopped it and leave the rest unrun.
      console.error(`\n[seed:content] STOPPED at ${step.file}: ${e.message}`);
      console.error('[seed:content] the steps after it did not run. Fix this one and re-run —');
      console.error('[seed:content] every step is idempotent, so repeating the earlier ones is safe.');
      process.exit(1);
    }
    console.log('');
  }
  console.log('[seed:content] done — docs, FAQ, blog and guide are in place.');
})();

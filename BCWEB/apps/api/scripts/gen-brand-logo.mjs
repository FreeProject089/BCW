#!/usr/bin/env node
// Rebuild the base64 logo that every transactional e-mail carries, from the real logo file.
//
// The logo is embedded rather than linked because a mail client that blocks remote images
// would otherwise show a broken box where the brand should be, and because the container the
// API runs in has no idea where the web app's public/ folder went.
//
// The cost of embedding is a generated copy, and a generated copy drifts. This one did: the
// file said "regenerate if the logo changes", the logo changed, and for however long after
// that every confirmation, reset and receipt went out wearing a 29 KB logo that matched no
// file in the repository. An instruction in a comment is not a check —
// apps/api/test/brand-logo.test.mjs is.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const LOGO_SRC = join(HERE, '../../web/public/logo.png');
export const LOGO_OUT = join(HERE, '../src/lib/brand-logo-data.mjs');

/** The exact file contents for a given logo — shared with the test, so the two cannot disagree. */
export function renderModule(pngBytes) {
  return `// Auto-generated: BetterCommunity logo (apps/web/public/logo.png) as a base64 data URI,
// embedded so transactional emails always show the real icon regardless of container
// file layout.
//
// Regenerate whenever the logo changes:
//   node apps/api/scripts/gen-brand-logo.mjs
//
// It DID drift once — every transactional mail was going out with a logo that matched no file
// in the repository, because "regenerate if the logo changes" is an instruction and not a
// check. apps/api/test/brand-logo.test.mjs compares this against the source on every run.
export const BRAND_LOGO_DATA_URI = 'data:image/png;base64,${pngBytes.toString('base64')}';
`;
}

// Only writes when run directly; importing it (the test does) must not touch the file.
if (process.argv[1] && process.argv[1].endsWith('gen-brand-logo.mjs')) {
  const out = renderModule(readFileSync(LOGO_SRC));
  writeFileSync(LOGO_OUT, out, 'utf8');
  console.log(`✓ brand-logo-data.mjs regenerated from public/logo.png (${out.length} bytes)`);
}

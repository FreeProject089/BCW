#!/usr/bin/env node
// Lint the B.MD package (packages/bmd) with THIS app's ESLint config.
//
// ESLint's flat config only looks at files under the config's base path, and that path is
// the directory of the config file — packages/bmd sits two levels up, so `eslint ../../…`
// from here reports every file as ignored and exits 2. With `--config` the base path becomes
// the working directory instead, so the run happens from the BCWEB root.
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const web = process.cwd();
const root = resolve(web, '../..');
const r = spawnSync(process.execPath, [
  resolve(web, 'node_modules/eslint/bin/eslint.js'),
  '--config', resolve(web, 'eslint.config.js'),
  'packages/bmd/src',
], { cwd: root, stdio: 'inherit' });
if (r.status !== 0) process.exit(r.status ?? 1);
console.log('✓ B.MD package lint OK (packages/bmd/src)');

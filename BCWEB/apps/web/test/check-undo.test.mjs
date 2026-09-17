// What check-undo.mjs must and must not flag.
//
// A gate is only worth having if it is wrong in a predictable direction, so the cases below
// are mostly the ones it has to stay QUIET about: the shapes that exist all over this app and
// that a slightly greedier rule would light up. The one positive case is the shape the gate
// was born red against.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'check-undo.mjs');

// The script walks `src` relative to the process cwd, so each case gets its own tree.
function run(files) {
  const dir = mkdtempSync(join(tmpdir(), 'undo-'));
  try {
    mkdirSync(join(dir, 'src'), { recursive: true });
    for (const [name, body] of Object.entries(files)) {
      const p = join(dir, 'src', name);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, body, 'utf8');
    }
    try {
      const out = execFileSync(process.execPath, [SCRIPT], { cwd: dir, encoding: 'utf8' });
      return { code: 0, out };
    } catch (x) {
      return { code: x.status, out: `${x.stdout || ''}${x.stderr || ''}` };
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('flags a delete whose success path is a bare toast.success', () => {
  const r = run({
    'a.jsx': `
export function P() {
  const remove = async (x) => {
    try { await api.del(\`/things/\${x.id}\`); toast.success(t('k', 'Deleted.')); reload(); }
    catch { toast.error(t('common.failed', 'Failed.')); }
  };
  return remove;
}
`,
  });
  assert.equal(r.code, 1);
  assert.match(r.out, /a\.jsx:4/);
});

test('stays quiet when the same function already offers an undo window', () => {
  const r = run({
    'a.jsx': `
export function P() {
  const remove = async (x) => {
    toast.action({
      onCommit: async () => { await api.del('/things/' + x.id); toast.success('Deleted.'); },
      onCancel: () => {},
    });
  };
  return remove;
}
`,
  });
  assert.equal(r.code, 0, r.out);
});

test('stays quiet for a delete with no success toast at all', () => {
  const r = run({
    'a.jsx': `
export function P() {
  const remove = async (x) => {
    try { await api.del('/things/' + x.id); reload(); }
    catch { toast.error('Failed.'); }
  };
  return remove;
}
`,
  });
  assert.equal(r.code, 0, r.out);
});

test('stays quiet for the useUndoableDelete shape, where api.del is the deferred run', () => {
  const r = run({
    'a.jsx': `
export function P() {
  const { del } = useUndoableDelete(reload);
  const remove = (x) => del(x.id, () => api.del('/things/' + x.id), t('k', 'Deleted.'));
  return remove;
}
`,
  });
  assert.equal(r.code, 0, r.out);
});

test('POST and PUT are out of scope, however destructive they read', () => {
  const r = run({
    'a.jsx': `
export function P() {
  const wipe = async (x) => {
    try { await api.post('/things/' + x.id + '/purge'); toast.success('Purged.'); }
    catch { toast.error('Failed.'); }
  };
  return wipe;
}
`,
  });
  assert.equal(r.code, 0, r.out);
});

test('a stated reason at the site exempts it, and is counted', () => {
  const r = run({
    'a.jsx': `
export function P() {
  const remove = async (x) => {
    // undo: revoking a leaked credential has to happen now, not in six seconds.
    try { await api.del('/keys/' + x.id); toast.success('Deleted.'); }
    catch { toast.error('Failed.'); }
  };
  return remove;
}
`,
  });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /1 exempt with a stated reason/);
});

test('a brace inside a regex or a string does not move the reported function', () => {
  // The blanking pass exists for this: an unbalanced-looking `{6}` or "}" used to close a
  // block that was never open, and the checker then reported a line in a different function.
  const r = run({
    'a.jsx': `
const hex = /^#[0-9a-fA-F]{6}$/;
const brace = "a } b";
export function P() {
  const remove = async (x) => {
    try { await api.del('/things/' + x.id); toast.success('Deleted.'); }
    catch { toast.error('Failed.'); }
  };
  return remove;
}
`,
  });
  assert.equal(r.code, 1);
  assert.match(r.out, /a\.jsx:6/);
});

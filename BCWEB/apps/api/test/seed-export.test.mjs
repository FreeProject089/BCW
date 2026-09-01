// S1 — the custom seed generator emits a runnable, idempotent seed script from selected content.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateSeedScript, jsLiteral } from '../src/lib/seed-export.mjs';

const SAMPLE = {
  adminSettings: [
    { key: 'project.bmm', value: { name: 'BMM', legal: [{ title: 'License', url: 'https://x/L' }] } },
    { key: 'site.scene', value: { enabled: true, shape: 'orb' } },
  ],
  hostingPlans: [{ name: 'Repo 5GB', storageGB: 5, uploadLimitKbps: 2048, cpuShare: 0.25, priceMonthlyCents: 300, active: true }],
  legalPages: [{ slug: 'tos', title: 'Terms', bodyEn: '…', bodyFr: '…' }],
};

test('jsLiteral round-trips to the original value and is XSS-safe', () => {
  const v = { a: 1, s: '</script><b>', u: 'x y' };
  assert.deepEqual(JSON.parse(jsLiteral(v)), v);
  assert.ok(!jsLiteral(v).includes('</script>')); // broken up so it can't close a tag
});

test('the script names each section and its writes', () => {
  const s = generateSeedScript(['projects', 'hostingPlans', 'legal'], SAMPLE, { generatedAtIso: '2026-09-01T00:00:00Z', by: 'admin' });
  assert.match(s, /adminSetting\.upsert/);
  assert.match(s, /hostingPlan\.findFirst/);
  assert.match(s, /legalPage\.upsert/);
  assert.match(s, /Repo 5GB/);
  assert.match(s, /Generated: 2026-09-01/);
  assert.match(s, /Idempotent/);
});

test('an empty selection still produces a valid (no-op) script', () => {
  const s = generateSeedScript([], { adminSettings: [], hostingPlans: [], legalPages: [] });
  assert.match(s, /async function main/);
});

test('the generated script is syntactically valid JS (node --check)', () => {
  const s = generateSeedScript(['projects', 'hostingPlans', 'legal'], SAMPLE, { generatedAtIso: '2026-09-01T00:00:00Z' });
  const dir = mkdtempSync(join(tmpdir(), 'seedgen-'));
  const file = join(dir, 'seed.mjs');
  writeFileSync(file, s);
  // Throws if the emitted script has a syntax error — the whole point of a "runnable" script.
  execFileSync(process.execPath, ['--check', file]);
  assert.ok(true);
});

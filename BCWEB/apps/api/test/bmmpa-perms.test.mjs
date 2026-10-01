// What a .bmmpa task grants itself, as the moderation inspector reports it — read the way
// BMM reads it (askedPermissions() in BMM's frontend/src/features/settings/bmmpa-inspect.ts).
//
// Two drifts from BMM, both on the reporting side:
//   · any truthy value counted as granted (`"command": "yes"`), where BMM grants on `=== true`;
//   · the legacy `allowCustomCommands` flag was ignored as soon as a `perms` object existed,
//     although BMM honours it either way — so `perms: {}` beside `allowCustomCommands: true`
//     was reported as asking for nothing while the task could run programs.
// And one on the display side: the web inspector had no words for `resources` or `tasks`,
// so the raw code was shown.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectBmmpa, RISK_KEYS } from '../src/lib/bmmpa.mjs';

const perms = (task) => inspectBmmpa({ format: 'bmm-automation', tasks: [{ name: 't', steps: [], ...task }] }).tasks[0]?.perms;

describe('askedPermissions, as BMM reads it', () => {
  test('granted only by === true', () => {
    assert.deepEqual(perms({ perms: { command: 'yes', script: 1, deeplink: {}, delete: true } }), ['delete']);
  });
  test('the legacy flag counts even beside a perms object', () => {
    assert.deepEqual(perms({ perms: {}, allowCustomCommands: true }), ['command', 'deeplink']);
    assert.deepEqual(perms({ perms: { tasks: true, command: true }, allowCustomCommands: true }), ['command', 'tasks', 'deeplink']);
  });
  test('the legacy flag alone, and only when it is really true', () => {
    assert.deepEqual(perms({ allowCustomCommands: true }), ['command', 'deeplink']);
    assert.deepEqual(perms({ allowCustomCommands: 'true' }), []);
  });
  test('resources and tasks are read like the others', () => {
    assert.deepEqual(perms({ perms: { resources: true, tasks: true } }), ['resources', 'tasks']);
  });
  // BMM added `ai` (Laya in scheduled tasks, Oct 2026): a task granted it must not be
  // reported to a moderator as asking for nothing.
  test('ai (Laya in a task) is a permission like the others', () => {
    assert.ok(RISK_KEYS.includes('ai'), 'RISK_KEYS must carry `ai`, as BMM does');
    assert.deepEqual(perms({ perms: { ai: true } }), ['ai']);
  });
});

describe('the web inspector has words for every permission code', () => {
  const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/src');
  const inspector = fs.readFileSync(path.join(WEB, 'ui/bmm-inspector.jsx'), 'utf8');
  const block = /const PERM = \{([\s\S]*?)\n\s*\};/.exec(inspector)?.[1] || '';
  test('a PERM entry per RISK_KEYS code', () => {
    assert.ok(block, 'the PERM map was not found in bmm-inspector.jsx');
    const labelled = new Set([...block.matchAll(/^\s*([a-zA-Z]+):\s*t\(/gm)].map((m) => m[1]));
    for (const k of RISK_KEYS) assert.ok(labelled.has(k), `no label for the "${k}" permission: the moderator sees the raw code`);
  });
  test('and each label has its French', () => {
    const fr = fs.readFileSync(path.join(WEB, 'i18n-fr.js'), 'utf8');
    for (const m of block.matchAll(/t\('(bmi\.p\.[a-zA-Z]+)'/g)) assert.ok(fr.includes(`'${m[1]}'`), `${m[1]} has no French entry`);
  });
});

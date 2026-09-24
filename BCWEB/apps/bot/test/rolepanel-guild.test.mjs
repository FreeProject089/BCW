// Pentest round 2 (Sept 24 2026): a server owner's role panel stays in the owner's server.
//
// The API stamps each owner panel with its guildId, but the channel id is typed by the owner
// and the bot resolves channels across every server it is in. `panelBelongs` is the check;
// both the poster and the click handler must ask it (asserted on the code, comments stripped).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { panelBelongs } from '../src/features/rolepanel.mjs';

test('an owner panel belongs only to its own server; an admin panel anywhere', () => {
  assert.equal(panelBelongs({ guildId: '111' }, '111'), true);
  assert.equal(panelBelongs({ guildId: '111' }, '222'), false);
  assert.equal(panelBelongs({ guildId: '111' }, null), false, 'a DM or unknown server is not the panel\'s server');
  assert.equal(panelBelongs({}, '222'), true, 'the admin\'s own panels have no guildId (control)');
});

test('the poster and the click handler both ask it', () => {
  const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/features/rolepanel.mjs'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const poll = src.slice(src.indexOf('export async function pollRolePanels'), src.indexOf('export async function handleRolePanelInteraction'));
  const click = src.slice(src.indexOf('export async function handleRolePanelInteraction'));
  assert.match(poll, /panelBelongs\(panel,\s*ch\.guildId\)/);
  assert.match(click, /panelBelongs\(panel,\s*i\.guildId\)/);
});

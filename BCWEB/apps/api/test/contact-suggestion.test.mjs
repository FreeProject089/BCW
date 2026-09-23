// Suggestions through the contact triage (M24, Sept 23 2026).
//
// An idea used to be "Something else", filed between two bug reports and counted in the
// support badge. It is now its own kind with its own destination, its own admin tab and its
// own badge. What is checked:
//
//   · the destination: `about` is a closed list, `project` is required only for a project,
//     unknown keys are dropped, and the kind comes from the destination (never the sender);
//   · the web copy asks for the same required fields as the server (two tables, one truth);
//   · the inbox scope: a tab lists exactly what its counts count, and the Messages badge
//     does not count suggestions while the Suggestions badge counts only them.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CONTACT_KINDS, DESTINATIONS, validateContactFields } from '../src/lib/contact-triage.mjs';
import * as web from '../../web/src/pages/contact-triage.js';

const misc = readFileSync(new URL('../src/routes/misc.mjs', import.meta.url), 'utf8');

describe('the suggestion destination', () => {
  test('is a kind the queue knows, filed by the destination', () => {
    assert.ok(CONTACT_KINDS.includes('suggestion'));
    assert.equal(DESTINATIONS.suggestion.kind, 'suggestion');
  });

  test('`about` is required and closed', () => {
    assert.deepEqual(validateContactFields('suggestion', {}), { ok: false, error: 'field_required', field: 'about' });
    assert.deepEqual(validateContactFields('suggestion', { about: 'everything' }), { ok: false, error: 'field_invalid', field: 'about' });
    const ok = validateContactFields('suggestion', { about: 'bot', who: '  server owners  ', extra: 'dropped' });
    assert.equal(ok.ok, true);
    assert.equal(ok.kind, 'suggestion');
    assert.deepEqual(ok.fields, { about: 'bot', who: 'server owners' });
  });

  test('a project is required for "another project", and dropped otherwise', () => {
    assert.deepEqual(validateContactFields('suggestion', { about: 'project' }), { ok: false, error: 'field_required', field: 'project' });
    assert.deepEqual(validateContactFields('suggestion', { about: 'project', project: 'bmm' }).fields, { about: 'project', project: 'bmm' });
    assert.deepEqual(validateContactFields('suggestion', { about: 'site', project: 'bmm' }).fields, { about: 'site' });
  });

  test('"who it would help" is capped', () => {
    assert.equal(validateContactFields('suggestion', { about: 'site', who: 'x'.repeat(301) }).error, 'field_too_long');
  });

  test('the web form asks for the same required fields and offers the same choices', () => {
    assert.deepEqual(web.requiredFields('suggestion'), ['about']);
    const server = DESTINATIONS.suggestion.fields.find((f) => f.name === 'about').options;
    const client = web.DESTINATIONS.suggestion.fields.find((f) => f.name === 'about').options.map((o) => o.value);
    assert.deepEqual(client, server);
    assert.ok(web.Q1.some((q) => q.dest === 'suggestion'), 'the first question offers it');
    assert.equal(web.TOPICS.suggestion?.dest, 'suggestion', '?topic=suggestion opens it');
  });
});

describe('the inbox and the badges keep suggestions apart', () => {
  const at = misc.indexOf("app.get('/admin/contact/inbox'");
  const inbox = misc.slice(at, misc.indexOf('app.get(', at + 10));

  test('one scope feeds both the list and its state counts', () => {
    assert.match(inbox, /const scope = kind \? \{ kind \} : exclude \? \{ kind: \{ not: exclude \} \} : \{\};/);
    assert.match(inbox, /\.\.\.scope,/);
    assert.match(inbox, /count\(\{ where: \{ \.\.\.stateWhere\(s\), \.\.\.scope \} \}\)/);
  });

  test('the Messages badge leaves suggestions out, the Suggestions badge counts only them', () => {
    const contact = misc.slice(misc.indexOf("key: 'contact'"), misc.indexOf("key: 'suggestions'"));
    assert.match(contact, /count\(\{ where: \{ status: 'new', kind: \{ not: 'suggestion' \} \} \}\)/);
    const sugg = misc.slice(misc.indexOf("key: 'suggestions'"), misc.indexOf("key: 'suggestions'") + 600);
    assert.match(sugg, /count\(\{ where: \{ status: 'new', kind: 'suggestion' \} \}\)/);
    assert.match(sugg, /to: '\/admin\?s=suggestions'/);
  });
});

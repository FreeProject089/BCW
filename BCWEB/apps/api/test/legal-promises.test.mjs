// What the legal pages promise, held against what was decided and what the runbook does
// (SECURITY_SUMMARY §9 #17 and #13, and §7 "where the legal pages say more than the code").
//
//   #17  The Terms and the Payments page promised notice "in advance" if the service stops,
//        with no number. The decision is 60 days, by e-mail and in the account.
//   #13  The privacy policy promises erasures are re-applied after a restore "before the site
//        serves anyone again"; the restore procedure never ran the replay, and restarted the
//        API first. The runbook now replays with `web` stopped, in both languages.
//   §7   "A Content-Security-Policy constrains what can run" and "We take a daily backup" said
//        more than was true; both are worded for what the code and the operator actually do.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const legal = fs.readFileSync(path.join(ROOT, 'apps/web/src/pages/legal.jsx'), 'utf8');
/** The text of one `['Title', 'body…']` section, found by its title. */
const section = (title) => {
  const i = legal.indexOf(`['${title}', `);
  assert.ok(i >= 0, `section "${title}" not found in legal.jsx`);
  return legal.slice(i, legal.indexOf("'],", i));
};

describe('the shutdown notice is a number (#17)', () => {
  test('Terms, EN and FR', () => {
    assert.match(section('Prepaid terms: what we commit to'), /at least 60 days in advance, by e-mail and in your account/);
    assert.match(section('Termes prépayés : ce à quoi nous nous engageons'), /au moins 60 jours à l’avance, par e-mail et dans votre compte/);
  });
  test('Payments, EN and FR', () => {
    assert.match(section('Prepaid terms'), /at least 60 days in advance, by e-mail and in your account/);
    assert.match(section('Termes prépayés'), /au moins 60 jours à l’avance, par e-mail et dans votre compte/);
  });
});

describe('the privacy page says only what is true (§7)', () => {
  test('no bare "daily backup", no CSP that "constrains what can run"', () => {
    assert.ok(!legal.includes('We take a daily backup and can restore the service from it.'));
    assert.ok(!legal.includes('Nous prenons une sauvegarde quotidienne et pouvons restaurer le service à partir d’elle.'));
    assert.ok(!legal.includes('a Content-Security-Policy constrains what can run in your browser'));
    assert.match(legal, /taken every day by a job scheduled on the server/);
    assert.match(legal, /prise chaque jour par une tâche planifiée sur le serveur/);
  });
});

describe('the restore runbook replays the erasures before the site serves anyone (#13)', () => {
  for (const f of ['BACKUP_EN.md', 'BACKUP_FR.md']) {
    test(f, () => {
      const g = fs.readFileSync(path.join(ROOT, 'guides/run', f), 'utf8');
      const restore = g.slice(g.search(/^## (Restore|Restauration)$/m));
      const stopWeb = restore.indexOf('docker compose stop web');
      const pg = restore.indexOf('psql -U bcweb bcweb');
      const replay = restore.indexOf('docker compose exec api node src/replay-erasures.mjs --write');
      const startWeb = restore.indexOf('docker compose start web');
      assert.ok(stopWeb >= 0 && stopWeb < pg, '`web` is stopped before the database is restored');
      assert.ok(replay > pg, 'the replay runs after the database restore');
      assert.ok(startWeb > replay, '`web` starts only after the replay');
      // And no step in between brings `web` back early.
      // (Commands only: a comment saying "NOT web" is not a step.)
      const early = restore.slice(stopWeb, replay).split('\n').map((l) => l.replace(/#.*$/, ''))
        .filter((l) => /docker compose (start|restart|up)\b/.test(l) && /\bweb\b/.test(l));
      assert.deepEqual(early, [], 'a step starts web before the replay');
    });
  }
});

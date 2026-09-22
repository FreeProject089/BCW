// One Discord message per incident: grouping, what the card says open and resolved, the link.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { groupFresh, incidentSpec, eventsSpec, resolvedNotice, durationLabel, MAX_EVENTS_PER_MESSAGE } from '../src/features/alerts-plan.mjs';
import { makeT, LANGS } from '../src/i18n.mjs';

const t = makeT('en');
const T0 = Date.UTC(2026, 8, 22, 10, 0, 0);
const at = (min) => new Date(T0 + min * 60_000).toISOString();
const URL = 'https://site.test/admin?s=serverperf&alert=';

describe('grouping fresh alerts into messages', () => {
  test('each incident is its own message; events of one kind share one', () => {
    const fresh = [
      { id: 'e1', kind: 'errors', key: null, message: 'New server error: a', createdAt: at(2) },
      { id: 'c1', kind: 'cpu', key: 'cpu', message: 'CPU usage at 91%', createdAt: at(0) },
      { id: 'e2', kind: 'errors', key: null, message: 'New server error: b', createdAt: at(3) },
      { id: 'd1', kind: 'service_down', key: 'service_down:db', message: 'Database is unreachable.', createdAt: at(1) },
    ];
    const g = groupFresh(fresh);
    assert.deepEqual(g.map((x) => [x.incident, x.alerts.map((a) => a.id)]), [[true, ['c1']], [true, ['d1']], [false, ['e1', 'e2']]]);
  });
  test('the bug, as a number: forty new-error events are four messages, not forty', () => {
    const fresh = Array.from({ length: 40 }, (_, i) => ({ id: `e${i}`, kind: 'errors', key: null, message: `New server error: ${i}`, createdAt: at(i) }));
    const g = groupFresh(fresh);
    assert.equal(g.length, 40 / MAX_EVENTS_PER_MESSAGE);
    assert.ok(g.every((x) => x.alerts.length <= MAX_EVENTS_PER_MESSAGE));
  });
});

describe('what the incident card says', () => {
  const open = { id: 'c1', kind: 'cpu', key: 'cpu', severity: 'warning', message: 'CPU usage at 93% (>90%).', createdAt: at(0), resolvedAt: null, url: `${URL}c1` };
  test('open: severity and kind in the title, the live figure, since when, and the link', () => {
    const s = incidentSpec(t, open);
    assert.equal(s.title, 'Warning · CPU');
    assert.equal(s.body[0], 'CPU usage at 93% (>90%).');
    assert.match(s.body[1], /^Ongoing since <t:\d+:R>$/);
    assert.equal(s.url, `${URL}c1`);
    assert.equal(s.color, 0xf59e0b);
    assert.equal(s.resolved, false);
  });
  test('resolved: green, struck through, and how long it lasted', () => {
    const s = incidentSpec(t, { ...open, resolvedAt: at(42) });
    assert.equal(s.color, 0x16a34a);
    assert.equal(s.body[0], '~~CPU usage at 93% (>90%).~~');
    assert.equal(s.body[1], 'Resolved after 42 min');
    assert.match(s.footer, /→ <t:\d+:f>$/);
    assert.equal(resolvedNotice(t, { ...open, resolvedAt: at(42) }), 'Resolved: CPU — CPU usage at 93% (>90%). (after 42 min)');
  });
  test('an events message links to the list, not to one of its rows', () => {
    const s = eventsSpec(t, { kind: 'errors', alerts: [{ id: 'e1', kind: 'errors', severity: 'info', message: 'x', createdAt: at(0), url: `${URL}e1` }] });
    assert.equal(s.url, 'https://site.test/admin?s=serverperf');
    assert.match(s.title, /^Errors · 1 event\(s\) since <t:\d+:t>$/);
  });
  test('every language names every kind and severity', () => {
    for (const lang of LANGS) {
      const tl = makeT(lang);
      for (const kind of ['cpu', 'mem', 'disk', 'web_vitals', 'storage', 'service_down', 'errors', 'capacity', 'capacity_oversold', 'telemetry_storage']) {
        for (const severity of ['critical', 'warning', 'info']) {
          assert.doesNotMatch(incidentSpec(tl, { ...open, kind, severity }).title, /al\.(sev|kind)\./, `${lang} ${kind} ${severity}`);
        }
      }
    }
  });
  test('an unknown kind is shown by its name rather than a key', () => {
    assert.equal(incidentSpec(t, { ...open, kind: 'brand_new' }).title, 'Warning · brand_new');
  });
});

test('durations read the way people say them', () => {
  assert.equal(durationLabel(45_000), '45 s');
  assert.equal(durationLabel(12 * 60_000), '12 min');
  assert.equal(durationLabel(185 * 60_000), '3 h 5 min');
  assert.equal(durationLabel(52 * 3600_000), '2 d 4 h');
  assert.equal(durationLabel(-5), '0 s');
});

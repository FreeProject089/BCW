// The bot's status line over time (E3): several lines shown in turn, what an incident does to
// that rotation ('replace' = the incident lines take over, 'alternate' = they are mixed in),
// and the placeholder rule, which must never fill anything but its fixed set.
//
// rotationLine is the pure core: given the lines, the incident lines, the incident state and a
// tick, which text. presenceFor is the whole decision on top of it (dot, fill, cut).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { rotationLine, presenceFor, fill, PLACEHOLDERS, INCIDENT_MODES } from '../src/features/presence.mjs';
import { presencePreview, rotationLine as webRotationLine, fill as webFill, PRESENCE_PLACEHOLDERS, PRESENCE_INCIDENT_MODES, PRESENCE_DEFAULTS, normPresence } from '../../web/src/lib/bot-presence.js';

const t = (k) => k;
const lineOf = (r) => (r?.activities?.[0] ? (r.activities[0].state ?? r.activities[0].name) : '');
const OK = { state: 'operational', services: [], stripe: null };
const MAJOR = { state: 'major', services: [{ label: 'API', state: 'down' }, { label: 'Web', state: 'down' }], stripe: null };
const PARTIAL = { state: 'partial', services: [{ label: 'CDN', state: 'down' }], stripe: null };
const at = (lines, inc, o, n = 6) => Array.from({ length: n }, (_, tick) => rotationLine(lines, inc, { ...o, tick }).text);

describe('rotationLine (pure): list, incident state, tick -> text', () => {
  test('no incident: the lines in turn, blank ones dropped, wrapping; no line at all is empty', () => {
    assert.deepEqual(at(['a', ' ', 'b', 'c'], ['I'], { incident: false }), ['a', 'b', 'c', 'a', 'b', 'c']);
    assert.deepEqual(at([], ['I'], { incident: false }, 2), ['', '']);
    assert.equal(rotationLine(['a', 'b'], [], { tick: -3 }).text, 'b', 'a negative tick is folded, never an index error');
    assert.equal(rotationLine(['a', 'b'], [], { tick: 'x' }).text, 'a');
  });
  test("incident, 'replace': only the incident lines, in turn", () => {
    assert.deepEqual(at(['a', 'b'], ['I1', 'I2'], { incident: true, mode: 'replace' }, 4), ['I1', 'I2', 'I1', 'I2']);
    assert.ok([0, 1, 2].every((tick) => rotationLine(['a'], ['I'], { incident: true, tick }).incident), 'replace is the default mode');
  });
  test("incident, 'alternate': incident line first, then a normal one, both lists walking", () => {
    assert.deepEqual(at(['a', 'b', 'c'], ['I1', 'I2'], { incident: true, mode: 'alternate' }, 8), ['I1', 'a', 'I2', 'b', 'I1', 'c', 'I2', 'a']);
    assert.deepEqual([0, 1].map((tick) => rotationLine(['a'], ['I'], { incident: true, mode: 'alternate', tick }).incident), [true, false]);
    assert.deepEqual(at([], ['I1', 'I2'], { incident: true, mode: 'alternate' }, 3), ['I1', 'I2', 'I1'], 'no normal line: incident lines only');
  });
  test('an incident with every incident line blank still says so', () => {
    assert.equal(rotationLine(['a'], ['', '  '], { incident: true, tick: 0 }).text, 'Incident: {services}');
  });
  test('the dashboard preview picks the same line at every tick, in every mode', () => {
    for (const incident of [false, true]) for (const mode of ['replace', 'alternate', 'nonsense']) for (let tick = 0; tick < 12; tick += 1) {
      assert.deepEqual(webRotationLine(['a', 'b', 'c'], ['I1', 'I2'], { incident, mode, tick }), rotationLine(['a', 'b', 'c'], ['I1', 'I2'], { incident, mode, tick }), `${incident} ${mode} ${tick}`);
    }
    assert.deepEqual(PRESENCE_PLACEHOLDERS, PLACEHOLDERS);
    assert.deepEqual(PRESENCE_INCIDENT_MODES, [...INCIDENT_MODES]);
  });
});

describe('presenceFor over time', () => {
  const base = { ...PRESENCE_DEFAULTS, enabled: true, text: '{guilds} servers', rotate: ['{members} members', 'Status: {status}'], healthText: 'Down: {services}', incidentLines: ['We are on it ({services})'] };
  test('rotation with the dot as configured', () => {
    const seen = [0, 1, 2, 3].map((tick) => presenceFor(base, { guilds: 3, members: 40, site: OK, tick, t }));
    assert.deepEqual(seen.map(lineOf), ['3 servers', '40 members', 'Status: pr.status.operational', '3 servers']);
    assert.ok(seen.every((r) => r.status === 'online'));
  });
  test("an incident, 'replace': the two incident lines in turn and a dnd dot", () => {
    const seen = [0, 1, 2].map((tick) => presenceFor(base, { guilds: 3, site: MAJOR, tick, t }));
    assert.deepEqual(seen.map(lineOf), ['Down: API, Web', 'We are on it (API, Web)', 'Down: API, Web']);
    assert.ok(seen.every((r) => r.status === 'dnd'));
  });
  test("an incident, 'alternate': mixed into the rotation; the dot stays idle the whole time", () => {
    const p = { ...base, incidentMode: 'alternate' };
    const seen = [0, 1, 2, 3].map((tick) => presenceFor(p, { guilds: 3, members: 40, site: PARTIAL, tick, t }));
    assert.deepEqual(seen.map(lineOf), ['Down: CDN', '3 servers', 'We are on it (CDN)', '40 members']);
    assert.ok(seen.every((r) => r.status === 'idle'), 'the dot says there is an incident even on a normal line');
  });
  test('health off: an incident changes nothing', () => {
    assert.equal(lineOf(presenceFor({ ...base, health: false }, { guilds: 3, site: MAJOR, tick: 0, t })), '3 servers');
  });
  test('the dashboard preview says the same, tick by tick, in both modes', () => {
    for (const mode of ['replace', 'alternate']) for (const site of [OK, PARTIAL, MAJOR]) for (let tick = 0; tick < 7; tick += 1) {
      const p = { ...base, incidentMode: mode };
      const bot = presenceFor(p, { guilds: 3, members: 40, site, tick, t });
      const web = presencePreview(p, { guilds: 3, members: 40, site, tick, statusLabel: (s) => `pr.status.${s}` });
      assert.equal(web.text, lineOf(bot), `${mode} ${site.state} ${tick}`);
      assert.equal(web.status, bot.status);
    }
  });
});

describe('placeholders: a fixed set, one pass, nothing else', () => {
  test('only the five names are filled; anything else stays literal, prototype names included', () => {
    const vars = { guilds: 3, members: 40, status: 'ok', stripe: 'fine', services: 'API' };
    assert.equal(fill('{guilds}/{members}/{status}/{stripe}/{services}', vars), '3/40/ok/fine/API');
    for (const k of ['constructor', '__proto__', 'toString', 'valueOf', 'hasOwnProperty', 'token', 'env', 'GUILDS', 'guilds.x']) {
      assert.equal(fill(`a {${k}} b`, vars), `a {${k}} b`, k);
      assert.equal(webFill(`a {${k}} b`, vars), `a {${k}} b`, `web ${k}`);
    }
  });
  test('a VALUE is never expanded again (Stripe\'s words, a service label)', () => {
    const r = presenceFor({ enabled: true, text: 'x', healthText: 'Down: {services}' }, { guilds: 7, members: 9, site: { state: 'major', services: [{ label: '{guilds} {members} {constructor}', state: 'down' }] }, t });
    assert.equal(lineOf(r), 'Down: {guilds} {members} {constructor}');
    const s = presenceFor({ enabled: true, text: 'x', stripeText: 'Stripe: {stripe}' }, { guilds: 7, site: { state: 'operational', services: [], stripe: { state: 'minor', description: '{guilds}' } }, t });
    assert.equal(lineOf(s), 'Stripe: {guilds}');
  });
  test('a value cannot break the line: control characters become spaces, the whole is cut at 128', () => {
    const r = presenceFor({ enabled: true, text: 'x', healthText: '{services}' }, { site: { state: 'major', services: [{ label: `A\nB\r\u2028C\u0000D${'z'.repeat(200)}`, state: 'down' }] }, t });
    const line = lineOf(r);
    assert.ok(!/[\u0000-\u001f\u2028]/.test(line));
    assert.ok(line.startsWith('A B C D'));
    assert.equal(line.length, 128);
    const web = presencePreview({ enabled: true, text: 'x', healthText: '{services}' }, { site: { state: 'major', services: [{ label: `A\nB\r\u2028C\u0000D${'z'.repeat(200)}`, state: 'down' }] } });
    assert.equal(web.text, line);
  });
});

describe('the dashboard shape', () => {
  test('incident lines and mode are normalised, bounded, and the minimum interval holds', () => {
    const n = normPresence({ incidentLines: ['a', 7, null, 'x'.repeat(300), 'b', 'c', 'd'], incidentMode: 'evil', rotateSec: 5 });
    assert.equal(n.incidentLines.length, 5);
    assert.equal(n.incidentLines[3].length, 128);
    assert.equal(n.incidentMode, 'replace');
    assert.equal(n.rotateSec, 30);
    assert.equal(normPresence({ incidentMode: 'alternate' }).incidentMode, 'alternate');
  });
});

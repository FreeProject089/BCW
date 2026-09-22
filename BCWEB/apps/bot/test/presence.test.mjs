// The bot's Discord status: configurable, honest about incidents, and Stripe's own words.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ActivityType } from 'discord.js';
import { presenceFor } from '../src/features/presence.mjs';
import { makeT, LANGS } from '../src/i18n.mjs';

const t = makeT('en');
const green = { state: 'operational', services: [{ key: 'db', label: 'Database', state: 'operational' }], stripe: { state: 'operational', description: 'All Systems Operational' } };
const P = (o = {}) => ({ enabled: true, status: 'online', type: 'watching', text: '{guilds} servers', rotate: [], health: true, stripe: true, ...o });

describe('configured', () => {
  test('off → null (the plain dot, untouched)', () => {
    assert.equal(presenceFor({ enabled: false }), null);
    assert.equal(presenceFor(undefined), null);
  });
  test('the dot, the type and the line, with variables', () => {
    const r = presenceFor(P({ status: 'dnd', type: 'playing', text: 'with {members} members' }), { guilds: 3, members: 120, site: green, t });
    assert.equal(r.status, 'dnd');
    assert.deepEqual(r.activities, [{ name: 'with 120 members', type: ActivityType.Playing }]);
  });
  test('a custom status is the text alone', () => {
    const r = presenceFor(P({ type: 'custom', text: 'Site: {status}' }), { site: green, t });
    assert.deepEqual(r.activities, [{ name: 'Custom Status', type: ActivityType.Custom, state: 'Site: all systems operational' }]);
  });
  test('rotation walks the lines; junk values fall back to defaults', () => {
    const p = P({ text: 'a', rotate: ['b', '', 'c'] });
    assert.deepEqual([0, 1, 2, 3].map((tick) => presenceFor(p, { tick, t }).activities[0].name), ['a', 'b', 'c', 'a']);
    const junk = presenceFor({ enabled: true, status: 'sparkly', type: 'dancing', text: 'x' }, { t });
    assert.equal(junk.status, 'online');
    assert.equal(junk.activities[0].type, ActivityType.Watching);
  });
  test('the line is capped at Discord\'s 128 characters; an empty line clears the activity', () => {
    assert.equal(presenceFor(P({ text: 'x'.repeat(300) }), { t }).activities[0].name.length, 128);
    assert.deepEqual(presenceFor(P({ text: '' }), { t }).activities, []);
  });
});

describe('health and Stripe', () => {
  test('an incident takes over the line and the dot', () => {
    const site = { state: 'partial', services: [{ label: 'Database', state: 'down' }, { label: 'Website', state: 'operational' }], stripe: null };
    const r = presenceFor(P(), { site, t });
    assert.equal(r.status, 'idle');
    assert.equal(r.activities[0].name, 'Incident: Database');
    assert.equal(presenceFor(P(), { site: { ...site, state: 'major' }, t }).status, 'dnd');
    assert.equal(presenceFor(P({ health: false }), { site, t, guilds: 2 }).activities[0].name, '2 servers', 'health off → the configured line');
  });
  test('Stripe degraded → Stripe\'s own words; operational or unknown → nothing about Stripe', () => {
    const deg = { ...green, stripe: { state: 'degraded', description: 'Partially Degraded Service' } };
    const r = presenceFor(P(), { site: deg, t });
    assert.equal(r.activities[0].name, 'Stripe: Partially Degraded Service');
    assert.equal(r.status, 'idle');
    assert.equal(presenceFor(P(), { site: green, t, guilds: 4 }).activities[0].name, '4 servers');
    assert.equal(presenceFor(P(), { site: { ...green, stripe: { state: 'unknown' } }, t, guilds: 4 }).activities[0].name, '4 servers');
    assert.equal(presenceFor(P({ stripe: false }), { site: deg, t, guilds: 4 }).activities[0].name, '4 servers');
  });
  test('no status answer at all (the API is down) is not an incident', () => {
    assert.equal(presenceFor(P(), { site: null, t, guilds: 1 }).status, 'online');
  });
  test('{status} is translated in every language', () => {
    for (const lang of LANGS) assert.doesNotMatch(presenceFor(P({ text: '{status}' }), { site: green, t: makeT(lang) }).activities[0].name, /pr\.status\./, lang);
  });
});

// The dashboard's status preview (apps/web/src/lib/bot-presence.js, presencePreview) against
// the bot's own decision (features/presence.mjs, presenceFor), on the same inputs. The preview
// is only worth having if it prints the line Discord will show.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { presenceFor, STATUSES, TYPES } from '../src/features/presence.mjs';
import { presencePreview, PRESENCE_STATUSES, PRESENCE_TYPES, PRESENCE_DEFAULTS } from '../../web/src/lib/bot-presence.js';

const t = (k) => `T(${k})`;
const label = (s) => t(`pr.status.${s}`);
const OK = { state: 'operational', services: [], stripe: { state: 'operational', description: 'All Systems Operational' } };
const PARTIAL = { state: 'partial', services: [{ label: 'API', state: 'down' }, { label: 'CDN', state: 'up' }], stripe: null };
const MAJOR = { state: 'major', services: [{ label: 'API', state: 'down' }, { label: 'Web', state: 'down' }], stripe: null };
const STRIPE = { state: 'operational', services: [], stripe: { state: 'minor', description: 'Partially Degraded Service' } };

function same(p, ctx, why) {
  const bot = presenceFor(p, { ...ctx, t });
  const web = presencePreview(p, { ...ctx, statusLabel: label });
  if (!bot) return assert.equal(web, null, why);
  assert.equal(web.status, bot.status, `${why}: status`);
  const a = bot.activities[0];
  const botText = a ? (a.type === TYPES.custom ? a.state : a.name) : '';
  assert.equal(web.text, botText, `${why}: text`);
  if (a) assert.equal(TYPES[web.type], a.type, `${why}: type`);
}

describe('status preview = what the bot sets', () => {
  test('same vocabulary', () => {
    assert.deepEqual(PRESENCE_STATUSES, STATUSES);
    assert.deepEqual([...PRESENCE_TYPES].sort(), Object.keys(TYPES).sort());
  });

  test('off, default, rotation, variables, each takeover', () => {
    const base = { ...PRESENCE_DEFAULTS, enabled: true, text: '{guilds} servers, {members} members', rotate: ['Status: {status}', '', 'Stripe says {stripe}'] };
    const ctx = { guilds: 12, members: 3456 };
    same({ ...PRESENCE_DEFAULTS }, ctx, 'off by default');
    for (const tick of [0, 1, 2, 3, 7]) same(base, { ...ctx, site: OK, tick }, `rotation tick ${tick}`);
    same(base, { ...ctx, site: PARTIAL }, 'partial incident');
    same(base, { ...ctx, site: MAJOR }, 'major incident');
    same(base, { ...ctx, site: STRIPE }, 'stripe degraded');
    same({ ...base, health: false }, { ...ctx, site: MAJOR }, 'health off');
    same({ ...base, stripe: false }, { ...ctx, site: STRIPE }, 'stripe off');
    same({ ...base, status: 'dnd' }, { ...ctx, site: STRIPE }, 'stripe never lightens a dnd dot');
    same({ ...base, type: 'custom' }, { ...ctx, site: OK }, 'custom status');
    same({ ...base, type: 'nonsense', status: 'nonsense' }, { ...ctx, site: null }, 'unknown values fall back');
    same({ ...base, text: 'x'.repeat(300), rotate: [] }, ctx, 'cut at 128');
    same({ ...base, text: '', rotate: [] }, ctx, 'no line at all');
  });
});

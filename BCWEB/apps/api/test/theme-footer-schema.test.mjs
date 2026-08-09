// The footer and site-theme configs are free-form JSON blobs validated by zod on the way
// in. zod STRIPS unknown keys by default, so a field the schema does not declare saves,
// returns 200, and changes nothing — the admin sees a success toast and the site does not
// move. That failure leaves no trace anywhere, which is why it belongs in a test instead
// of a careful read.
//
// Every case below is a round-trip: parse what the editor sends, then assert the value is
// still there afterwards.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { footerSchema, pageColours } from '../src/lib/config-schemas.mjs';

const baseFooter = { enabled: true, columns: [] };

test('footer: the brand block survives a round-trip', () => {
  const r = footerSchema.safeParse({
    ...baseFooter,
    brand: { name: 'Acme', logo: '/brand.png', tagline: 'Hi', taglineFr: 'Salut' },
  });
  assert.ok(r.success, JSON.stringify(r.error?.issues));
  assert.equal(r.data.brand.name, 'Acme');
  assert.equal(r.data.brand.logo, '/brand.png');
  assert.equal(r.data.brand.taglineFr, 'Salut');
});

test('footer: socials accept all three stored shapes', () => {
  // An array — the new shape.
  const arr = footerSchema.safeParse({
    ...baseFooter,
    brand: { socials: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/x' }] },
  });
  assert.ok(arr.success, JSON.stringify(arr.error?.issues));
  assert.equal(arr.data.brand.socials.length, 1);
  assert.equal(arr.data.brand.socials[0].icon, 'github');

  // The booleans older configs still hold. Rejecting these would empty the social row of
  // every footer already saved, which is the whole reason the union exists.
  for (const v of [true, false]) {
    const b = footerSchema.safeParse({ ...baseFooter, brand: { socials: v } });
    assert.ok(b.success, `boolean socials (${v}) must stay valid`);
    assert.equal(b.data.brand.socials, v);
  }
});

test('footer: a social link cannot be a javascript: URL', () => {
  const r = footerSchema.safeParse({
    ...baseFooter,
    brand: { socials: [{ icon: 'link', label: 'x', href: 'javascript:alert(1)' }] },
  });
  assert.ok(!r.success, 'javascript: must be refused');
});

test('footer: newsletter accepts both the boolean and the copy object', () => {
  const o = footerSchema.safeParse({
    ...baseFooter,
    brand: { newsletter: { on: true, title: 'Join', titleFr: 'Rejoins', button: 'Go' } },
  });
  assert.ok(o.success, JSON.stringify(o.error?.issues));
  assert.equal(o.data.brand.newsletter.title, 'Join');
  assert.equal(o.data.brand.newsletter.titleFr, 'Rejoins');

  const b = footerSchema.safeParse({ ...baseFooter, brand: { newsletter: false } });
  assert.ok(b.success);
  assert.equal(b.data.brand.newsletter, false);
});

test('footer: the bottom bar and phone layout survive', () => {
  const r = footerSchema.safeParse({
    ...baseFooter,
    bottom: { copyright: true, text: '© {year} Acme', textFr: '© {year} Acme', lang: false, egg: false },
    mobile: { layout: 'grid', brand: false },
  });
  assert.ok(r.success, JSON.stringify(r.error?.issues));
  assert.equal(r.data.bottom.text, '© {year} Acme');
  assert.equal(r.data.bottom.lang, false);
  assert.equal(r.data.bottom.egg, false);
  assert.equal(r.data.mobile.layout, 'grid');
  assert.equal(r.data.mobile.brand, false);
});

test('theme: a glow list survives, and an empty one is not confused with absent', () => {
  const r = pageColours.safeParse({
    bg: '#0a0907',
    text: '#f3efe9',
    glows: [{ color: 'rgba(249,115,22,.16)', w: 60, h: 52, x: 82, y: -14, fade: 56 }],
  });
  assert.ok(r.success, JSON.stringify(r.error?.issues));
  assert.equal(r.data.glows.length, 1);
  assert.equal(r.data.glows[0].x, 82);

  // An explicit [] means "flat background" and must come back as [], not as undefined —
  // the renderer tells those two apart and only one of them turns the glows off.
  const flat = pageColours.safeParse({ glows: [] });
  assert.ok(flat.success);
  assert.deepEqual(flat.data.glows, []);

  const absent = pageColours.safeParse({ bg: '#0a0907' });
  assert.ok(absent.success);
  assert.equal(absent.data.glows, undefined);
});

test('theme: --glow-c is an accepted token, and an invented one is not', () => {
  const ok = pageColours.safeParse({ '--glow-c': 'rgba(245,158,11,.07)' });
  assert.ok(ok.success, '--glow-c must be in the API allowlist as well as the client one');
  assert.equal(ok.data['--glow-c'], 'rgba(245,158,11,.07)');

  const bad = pageColours.safeParse({ '--not-a-token': '#fff' });
  assert.ok(!bad.success, 'an unknown token must be refused');
});

test('theme: a glow colour cannot break out of the CSS declaration', () => {
  for (const color of ['red;}body{display:none', 'url(javascript:alert(1))', 'rgba(0,0,0,.1);color:red']) {
    const r = pageColours.safeParse({ glows: [{ color }] });
    assert.ok(!r.success, `must refuse: ${color}`);
  }
});

test('theme: glow geometry is clamped to a sane range', () => {
  const r = pageColours.safeParse({ glows: [{ color: '#fff', w: 9999 }] });
  assert.ok(!r.success, 'an out-of-range size must be refused, not silently stored');
});

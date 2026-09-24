// avatar.image may only point at an image the site produced (web audit W4 card, Sept 24 2026):
// an upload at /api/media/<key>, or a GitHub / Discord sign-in picture. Anything else made
// /api/avatar/<id> an open redirect on the site's own domain.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeAvatarImage } from '../src/lib/avatar-url.mjs';

test('the three kinds the site produces are kept', () => {
  assert.equal(safeAvatarImage('/api/media/BLOG/2026/abc.png'), '/api/media/BLOG/2026/abc.png');
  assert.equal(safeAvatarImage('https://avatars.githubusercontent.com/u/1?v=4'), 'https://avatars.githubusercontent.com/u/1?v=4');
  assert.equal(safeAvatarImage('https://cdn.discordapp.com/avatars/1/a.png?size=256'), 'https://cdn.discordapp.com/avatars/1/a.png?size=256');
});

test('anything else is refused', () => {
  for (const bad of ['https://evil.example/x.png', 'http://avatars.githubusercontent.com/u/1', '//evil.example/x', '/\evil.example',
    'javascript:alert(1)', 'data:image/png;base64,AAAA', '/api/media/../../admin', '/somewhere/else.png',
    'https://user:pw@cdn.discordapp.com/x.png', 'https://cdn.discordapp.com.evil.example/x.png', '', null, 42]) {
    assert.equal(safeAvatarImage(bad), null, String(bad));
  }
});

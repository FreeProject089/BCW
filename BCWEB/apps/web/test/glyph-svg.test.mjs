// M17: a project icon picked from the icon picker is stored as an SVG made from the glyph.
// What that SVG may carry, and which file each picker name draws from.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { glyphSource, colourSvg, glyphFileName } from '../src/lib/glyph-svg.js';

const cfg = {
  cdn: { lucide: (n) => `L/${n}.svg`, phosphor: (p) => `P/${p}.svg`, brand: (s) => `B/${s}` },
  appIcons: { bmm: '/icons/bmm.png' },
};

describe('which file a picker name draws from', () => {
  test('each family goes to its own CDN, an app mark is reused as is', () => {
    assert.deepEqual(glyphSource('rocket', cfg), { kind: 'svg', url: 'L/rocket.svg' });
    assert.deepEqual(glyphSource('Music2', cfg, (n) => n.replace(/([a-z])([A-Z0-9])/g, '$1-$2').toLowerCase()), { kind: 'svg', url: 'L/music-2.svg' });
    assert.deepEqual(glyphSource('ph:rocket', cfg), { kind: 'svg', url: 'P/regular/rocket.svg' });
    assert.deepEqual(glyphSource('ph-bold:rocket', cfg), { kind: 'svg', url: 'P/bold/rocket-bold.svg' });
    assert.deepEqual(glyphSource('simple:github', cfg), { kind: 'svg', url: 'B/github', brand: true });
    assert.deepEqual(glyphSource('app:bmm', cfg), { kind: 'url', url: '/icons/bmm.png' });
  });
  test('an unknown app key, a switched-off CDN or a URL is not a glyph', () => {
    assert.equal(glyphSource('app:nope', cfg), null);
    assert.equal(glyphSource('rocket', { cdn: { lucide: null } }), null);
    assert.equal(glyphSource('https://x.test/a.svg', cfg), null);
    assert.equal(glyphSource('', cfg), null);
  });
});

describe('the SVG that is uploaded', () => {
  const lucide = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M1 1h2"/></svg>';
  test('coloured, at a fixed size, viewBox kept', () => {
    const s = colourSvg(lucide, '#123abc');
    assert.match(s, /stroke="#123abc"/);
    assert.doesNotMatch(s, /currentColor/);
    assert.match(s, /width="512" height="512"/);
    assert.doesNotMatch(s, /width="24"/);
    assert.match(s, /viewBox="0 0 24 24"/);
  });
  test('a drawing with no currentColor gets the colour as its fill; a brand keeps its own', () => {
    const plain = '<svg viewBox="0 0 24 24"><path d="M0 0"/></svg>';
    assert.match(colourSvg(plain, '#ff0000'), /<svg fill="#ff0000"/);
    assert.doesNotMatch(colourSvg(plain, '#ff0000', { brand: true }), /fill="#ff0000"/);
    assert.doesNotMatch(colourSvg(plain, 'red; x'), /fill=/, 'only a #rrggbb colour is written');
  });
  test('nothing active survives: script, handlers, foreign content, outside references', () => {
    const bad = '<svg viewBox="0 0 1 1" onload="alert(1)"><script>alert(2)</script><foreignObject><div/></foreignObject>'
      + '<a href="javascript:alert(3)"><path d="M0 0" onclick=\'x()\'/></a><use xlink:href="https://evil.test/x.svg#a"/><use href="#local"/></svg>';
    const s = colourSvg(bad, '#000000');
    assert.doesNotMatch(s, /script|onload|onclick|foreignObject|javascript:|evil\.test/i);
    assert.match(s, /href="#local"/, 'an in-file reference is kept');
  });
  test('anything that is not an SVG is refused', () => {
    assert.throws(() => colourSvg('<html><svg/></html>', '#000000'), /not_svg/);
    assert.throws(() => colourSvg('', '#000000'), /not_svg/);
    assert.doesNotThrow(() => colourSvg('<?xml version="1.0"?>\n<!-- c --><svg viewBox="0 0 1 1"/>', '#000000'));
  });
  test('a file name from the picker name', () => {
    assert.equal(glyphFileName('ph-bold:rocket'), 'ph-bold-rocket.svg');
    assert.equal(glyphFileName(':::'), 'icon.svg');
  });
});

// B.MD `:action[Label]{href= method= body= confirm=}` is a button somebody ELSE wrote, pressed
// by the reader. Pentest round 2, card R2 (Sept 24 2026).
//
// It is rendered wherever B.MD is: a studio text block on a public page, a blog post, a comment,
// and the admin contact inbox, where the body was typed by an ANONYMOUS sender. It used to call
// `fetch(href, init)` with no `credentials`, i.e. the default `same-origin`: a same-site href
// carried the reader's session cookie, and the confirm dialog showed the AUTHOR's text instead
// of the method and the target. So a contact message holding
//   :action[Open the attachment]{href=/api/admin/users/<me> method=PATCH body='{"role":"ADMIN"}' confirm="Open the attachment?"}
// made the admin who pressed it and said yes promote the sender, with the admin's own session
// (CWE-352 / CWE-441, the confused deputy the studio's own `api` button was removed for, S2).
//
// Measured on the COMPONENT, not on the source text: DocAction is bundled for node with esbuild
// and run against a stub React whose hooks hold their initial value, the button it returns is
// pressed, and the `fetch` and `confirm` it reaches are recorded.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..');
const entry = join(WEB, 'node_modules', '.bmd-action-entry.jsx');
const bundle = join(WEB, 'node_modules', '.bmd-action-bundle.mjs');

// A React that renders nothing and keeps every hook at its initial value: enough to call a
// function component once and read the element tree it returns.
const REACT_STUB = `
const el = (type, props, key) => ({ type, props: props || {}, key });
export const jsx = el, jsxs = el, jsxDEV = el;
export const Fragment = 'Fragment';
export const createElement = (type, props, ...children) => ({ type, props: { ...(props || {}), children } });
export const createContext = (v) => ({ _v: v, Provider: 'Provider', Consumer: 'Consumer' });
export const useContext = (c) => c._v;
export const useState = (v) => [typeof v === 'function' ? v() : v, () => {}];
export const useEffect = () => {}, useLayoutEffect = () => {};
export const useMemo = (f) => f(), useCallback = (f) => f;
export const useRef = (v) => ({ current: v });
export const useId = () => 'id';
export const forwardRef = (f) => f, memo = (f) => f;
export const Children = { toArray: (c) => [].concat(c ?? []), map: (c, f) => [].concat(c ?? []).map(f), count: (c) => [].concat(c ?? []).length };
const R = { createElement, createContext, useContext, useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef, useId, forwardRef, memo, Children, Fragment };
export default R;
`;

let DocAction = null;
let safeUrl = null;
before(async () => {
  const esbuild = await import('esbuild');
  writeFileSync(entry, [
    "export { DocAction } from '../../../packages/bmd/src/blocks.jsx';",
    "export { safeUrl } from '../../../packages/bmd/src/url.js';",
  ].join('\n'));
  await esbuild.build({
    entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: bundle,
    jsx: 'automatic', logLevel: 'silent', nodePaths: [join(WEB, 'node_modules')],
    plugins: [{
      name: 'react-stub',
      setup(b) {
        b.onResolve({ filter: /^react(\/jsx-runtime|\/jsx-dev-runtime)?$/ }, () => ({ path: 'react-stub', namespace: 'stub' }));
        b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: REACT_STUB, loader: 'js' }));
      },
    }],
  });
  ({ DocAction, safeUrl } = await import(pathToFileURL(bundle).href));
});
after(() => { for (const f of [entry, bundle]) rmSync(f, { force: true }); });

/** The first element of `type` in a tree the stub produced. */
function find(node, type) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) { for (const n of node) { const r = find(n, type); if (r) return r; } return null; }
  if (node.type === type) return node;
  return find(node.props?.children, type);
}

/** Render `:action` with these properties, press it, and report what it asked and fetched. */
async function press(props, { answer = true } = {}) {
  const calls = []; const asked = [];
  const g = globalThis;
  const saved = { fetch: g.fetch, window: g.window };
  g.fetch = async (url, init) => { calls.push({ url: String(url), init: init || {} }); return { ok: true, text: async () => '{}' }; };
  g.window = { confirm: (m) => { asked.push(String(m)); return answer; }, dispatchEvent: () => true };
  g.CustomEvent ??= class { constructor(t, o) { this.type = t; this.detail = o?.detail; } };
  try {
    const tree = DocAction({ node: { properties: props } });
    const btn = find(tree, 'button');
    assert.ok(btn, 'DocAction renders a <button>');
    if (!btn.props.disabled) await btn.props.onClick();
    return { calls, asked, disabled: !!btn.props.disabled };
  } finally { g.fetch = saved.fetch; g.window = saved.window; }
}

describe('B.MD :action never spends the reader\'s session (R2)', () => {
  test('a same-site mutating call goes out WITHOUT the reader\'s cookies', async () => {
    const r = await press({ dataHref: '/api/admin/users/u1', dataMethod: 'PATCH', dataBody: '{"role":"ADMIN"}', dataConfirm: 'Open the attachment?' });
    assert.equal(r.calls.length, 1, 'the button still does what it says (control)');
    assert.equal(r.calls[0].init.credentials, 'omit', 'fetch must be credentials: omit, or the cookie rides along');
  });

  test('the confirm names the method and the target even when the author wrote their own text', async () => {
    const r = await press({ dataHref: '/api/admin/users/u1', dataMethod: 'PATCH', dataConfirm: 'Open the attachment?' });
    assert.equal(r.asked.length, 1);
    assert.match(r.asked[0], /PATCH/, 'the method is shown');
    assert.match(r.asked[0], /\/api\/admin\/users\/u1/, 'the target is shown');
  });

  test('a GET is also sent without cookies', async () => {
    const r = await press({ dataHref: '/api/me', dataMethod: 'GET' });
    assert.equal(r.calls.length, 1);
    assert.equal(r.calls[0].init.credentials, 'omit');
  });

  test('saying no sends nothing (control)', async () => {
    const r = await press({ dataHref: 'https://api.example/vote', dataMethod: 'POST' }, { answer: false });
    assert.equal(r.calls.length, 0);
  });

  test('an external https target still works, cookieless (control)', async () => {
    const r = await press({ dataHref: 'https://api.example/vote', dataMethod: 'POST', dataBody: '{"id":1}' });
    assert.equal(r.calls.length, 1);
    assert.equal(r.calls[0].url, 'https://api.example/vote');
    assert.equal(r.calls[0].init.credentials, 'omit');
  });

  test('javascript: and a protocol-relative target are refused: the button is disabled', async () => {
    for (const href of ['javascript:alert(1)', '//evil.example/x', '/\\evil.example/x', '/\t\\evil.example/x']) {
      const r = await press({ dataHref: href, dataMethod: 'POST' });
      assert.equal(r.calls.length, 0, `${JSON.stringify(href)} was fetched`);
      assert.equal(r.disabled, true, `${JSON.stringify(href)} left the button live`);
    }
  });
});

describe('B.MD: no block fetches with the reader\'s cookies', () => {
  // Round 1 (F6-5) fixed `:::roadmap` and checked "the four fetch sites" by hand; `:action`, the
  // fifth and the only one that WRITES, was not among them. Counted from the source instead, so
  // a sixth is covered the day it is written.
  test('every fetch( in blocks.jsx is matched by a credentials: \'omit\'', () => {
    const src = readFileSync(join(WEB, '../../packages/bmd/src/blocks.jsx'), 'utf8').replace(/\/\/.*$/gm, '');
    const fetches = (src.match(/\bfetch\(/g) || []).length;
    const omits = (src.match(/credentials:\s*'omit'/g) || []).length;
    assert.ok(fetches >= 5, `found ${fetches} fetch sites: too few for this check to mean anything`);
    assert.equal(omits, fetches, `${fetches} fetch( calls but ${omits} credentials: 'omit'`);
  });
});

describe('B.MD safeUrl: a backslash path is another host', () => {
  // `/\evil.example` has no colon, starts with `/`, and was classed as a same-origin path. A
  // browser reads `\` as `/` in an http(s) URL, so it is `//evil.example`: a link that reads as
  // internal, gets no rel/target, skips `allowHosts`, and leaves the site (CWE-601).
  test('/\\host and its whitespace spellings are refused like //host', () => {
    for (const raw of ['/\\evil.example', '/\\/evil.example', '\\\\evil.example', '/\t\\evil.example', ' /\\evil.example']) {
      assert.equal(safeUrl(raw, { kind: 'link' }).ok, false, JSON.stringify(raw));
    }
  });
  test('ordinary paths still pass (control)', () => {
    for (const raw of ['/docs', '/docs/a\\b', '/', '#x', '?q=1', 'guide.md', 'https://example.com/a']) {
      assert.equal(safeUrl(raw, { kind: 'link' }).ok, true, JSON.stringify(raw));
    }
  });
});

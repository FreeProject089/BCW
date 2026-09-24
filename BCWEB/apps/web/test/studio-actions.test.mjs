// Studio block actions (PLAN-STUDIO-2026 2.5, tests 3.3.2, phase 5).
//
// Every step type with values that must work and values that must not; the composition rules;
// the submit registry; the link policy; the legacy fields (a block `link`, a button's
// `props.action`, the removed `api` action) read into steps. The SAME function decides for the
// API (validateDoc, at save: refused with the field path) and for the renderer (planAction:
// inert, never an href or a request), so each hostile value is asserted on both.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  validateDoc, normalizeDoc, serializeDoc, planAction, internalPath, externalUrl, normalizeLinkPolicy,
  linkPolicyProblems, hostAllowed, submitRequest, SUBMIT_REGISTRY, SUBMIT_KEYS, ACTION_TYPES, RESERVED_ACTIONS,
  MAX_STEPS, COPY_MAX, migrateDocActions, legacyAction, ID_SHAPE, downloadPath, mailAddress, frameBlocks,
} from '../src/lib/canvas.js';

const BS = String.fromCharCode(92);
const doc = (action, extra = {}) => ({
  id: 'p1', title: 't',
  blocks: [
    { id: 'hero', kind: 'box', x: 0, y: 0, w: 200, h: 100, action },
    { id: 'faq', kind: 'text', x: 0, y: 200, w: 200, h: 100, props: { md: 'x' }, hidden: true },
  ],
  ...extra,
});
const problems = (action, opts) => validateDoc(doc(action), '', opts).map((p) => `${p.path}:${p.reason}`);
const ids = new Set(['hero', 'faq']);
const plan = (action, links) => planAction(action, { links, blockIds: ids });

/** Refused at save with its path, AND inert (no href, nothing run) when rendered anyway. */
function refused(action, path, reason, opts) {
  const got = problems(action, opts);
  assert.ok(got.includes(`${path}:${reason}`), `expected ${path}:${reason} for ${JSON.stringify(action)}, got ${JSON.stringify(got)}`);
  const pl = plan(action, opts?.links);
  assert.equal(pl.kind, 'inert', `rendered live: ${JSON.stringify(action)}`);
  assert.equal(pl.href, '');
  assert.deepEqual(pl.steps, []);
}
function accepted(action, opts) {
  assert.deepEqual(problems(action, opts), [], JSON.stringify(action));
  assert.notEqual(plan(action, opts?.links).kind, 'inert', JSON.stringify(action));
}

const SCRIPTS = ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:x', '\x01javascript:x', 'java\nscript:x',
  'java\tscript:x', 'vbscript:x', 'data:text/html,<script>x</script>', 'DATA:text/html,x'];
const OTHER_HOSTS = ['//evil.example', `/${BS}evil.example`, '/\t/evil.example', `${BS}${BS}evil.example`, ' //evil.example',
  '/%2F%2Fevil.example', '/%2f%2fevil.example', `/%5Cevil.example`, '/%252F%252Fevil.example', 'https://evil.example/x', 'evil.example'];

describe('navigate: an internal path, and nothing else', () => {
  test('paths of this site', () => {
    for (const to of ['/', '/docs', '/p/bmm?tab=c-x', '/blog/post#h2', '/a/../b', '/search?q=%2F%2F'])
      accepted([{ type: 'navigate', to }]);
  });
  test('every script, every other host, every encoded variant: refused with the path, inert', () => {
    for (const to of [...SCRIPTS, ...OTHER_HOSTS]) refused([{ type: 'navigate', to }], 'blocks[0].action[0].to', 'unsafe_url');
  });
  test('internalPath reads a path the way a browser would', () => {
    assert.equal(internalPath('/ok'), '/ok');
    assert.equal(internalPath('/%2F%2Fevil.example'), '');
    assert.equal(internalPath('/ ok'), '');
    assert.equal(internalPath(`/a${BS}b`), '');
    assert.equal(internalPath('/a\u0000b'), '');
  });
});

describe('external: https only, and the site link policy (decision D7)', () => {
  test('https to a real host name works by default (block mode, empty list)', () => {
    accepted([{ type: 'external', url: 'https://github.com/x' }]);
    assert.equal(plan([{ type: 'external', url: 'https://github.com/x' }]).external, true);
    assert.equal(plan([{ type: 'external', url: 'https://github.com/x' }]).host, 'github.com');
  });
  test('http, scripts, protocol-relative, credentials and IP literals are refused', () => {
    refused([{ type: 'external', url: 'http://github.com' }], 'blocks[0].action[0].url', 'https_only');
    for (const url of [...SCRIPTS, '//evil.example', 'ftp://evil.example', 'https://user:pw@evil.example', 'https://127.0.0.1/',
      'https://[::1]/', ' https://evil.example', 'https://evil.example/\u0000'])
      refused([{ type: 'external', url }], 'blocks[0].action[0].url', 'unsafe_url');
  });
  test('an off-allowlist host is refused at save and inert on the page', () => {
    const links = { mode: 'allow', hosts: ['github.com'] };
    accepted([{ type: 'external', url: 'https://github.com/a' }], { links });
    accepted([{ type: 'external', url: 'https://docs.github.com/a' }], { links });
    refused([{ type: 'external', url: 'https://evil.example/a' }], 'blocks[0].action[0].url', 'host_not_allowed', { links });
    refused([{ type: 'external', url: 'https://github.com.evil.example/a' }], 'blocks[0].action[0].url', 'host_not_allowed', { links });
  });
  test('a blocklisted host (and its subdomains) is refused; the rest pass', () => {
    const links = { mode: 'block', hosts: ['evil.example'] };
    refused([{ type: 'external', url: 'https://evil.example/' }], 'blocks[0].action[0].url', 'host_not_allowed', { links });
    refused([{ type: 'external', url: 'https://a.evil.example/' }], 'blocks[0].action[0].url', 'host_not_allowed', { links });
    accepted([{ type: 'external', url: 'https://notevil.example/' }], { links });
  });
  test('the policy is normalised and checked strictly on save', () => {
    assert.deepEqual(normalizeLinkPolicy({ mode: 'allow', hosts: ['GitHub.com.', '*.youtube.com', 'bad host', 'github.com'] }), { mode: 'allow', hosts: ['github.com', 'youtube.com'] });
    assert.deepEqual(normalizeLinkPolicy(null), { mode: 'block', hosts: [] });
    assert.deepEqual(linkPolicyProblems({ mode: 'allow', hosts: ['ok.example', 'not a host'] }), [{ path: 'hosts[1]', reason: 'bad_value' }]);
    assert.deepEqual(linkPolicyProblems({ mode: 'open', hosts: [], extra: 1 }).map((p) => p.path), ['extra', 'mode']);
    assert.equal(hostAllowed('x.example', { mode: 'allow', hosts: [] }), false, 'an empty allowlist lets nothing out');
    assert.equal(externalUrl('https://GitHub.com/A').href, 'https://github.com/A');
  });
});

describe('the other steps', () => {
  test('page: an id', () => {
    accepted([{ type: 'page', canvasId: 'pricing' }]);
    assert.equal(plan([{ type: 'page', canvasId: 'pricing' }]).href, '?tab=c-pricing');
    refused([{ type: 'page', canvasId: 'x"><script>' }], 'blocks[0].action[0].canvasId', 'bad_id');
  });
  test('mailto: an address and nothing else', () => {
    accepted([{ type: 'mailto', address: 'hi@example.org' }]);
    assert.equal(plan([{ type: 'mailto', address: 'hi@example.org' }]).href, 'mailto:hi@example.org');
    for (const address of ['hi@example.org?cc=x@y.z', 'javascript:x', 'a b@c.d', 'hi@example.org\nbcc:x@y.z', 'nobody'])
      refused([{ type: 'mailto', address }], 'blocks[0].action[0].address', 'bad_value');
    assert.equal(mailAddress('a@b.co'), 'a@b.co');
  });
  test('scroll: a block of this page or #top, never a selector', () => {
    accepted([{ type: 'scroll', target: '#top' }]);
    accepted([{ type: 'scroll', target: 'faq' }]);
    for (const target of ['#faq', 'body', '.x', '[data-x]', 'div > p', 'nothere', '#top, body'])
      refused([{ type: 'scroll', target }], 'blocks[0].action[0].target', 'bad_scroll_target');
  });
  test('reveal: a block of this page, a known mode', () => {
    accepted([{ type: 'reveal', target: 'faq', mode: 'show' }]);
    refused([{ type: 'reveal', target: 'nothere' }], 'blocks[0].action[0].target', 'bad_target');
    refused([{ type: 'reveal', target: 'faq', mode: 'explode' }], 'blocks[0].action[0].mode', 'bad_value');
  });
  test('copy: up to 2000 characters', () => {
    accepted([{ type: 'copy', text: 'x'.repeat(COPY_MAX) }]);
    refused([{ type: 'copy', text: 'x'.repeat(COPY_MAX + 1) }], 'blocks[0].action[0].text', 'too_long');
    refused([{ type: 'copy', text: '' }], 'blocks[0].action[0].text', 'bad_value');
  });
  test('download: a same-site upload or a platform asset key, never a URL from elsewhere', () => {
    accepted([{ type: 'download', file: '/uploads/a/b.zip' }]);
    accepted([{ type: 'download', file: '/api/media/abc.pdf' }]);
    accepted([{ type: 'download', asset: 'bmm-setup.exe' }]);
    assert.equal(plan([{ type: 'download', asset: 'bmm-setup.exe' }]).href, '/api/assets/bmm-setup.exe');
    assert.equal(plan([{ type: 'download', file: '/uploads/x.zip' }]).download, true);
    for (const file of ['https://evil.example/x.zip', '//evil.example/x.zip', '/uploads/../admin', '/uploads/%2e%2e/x', '/uploads//evil.example',
      '/docs/x.zip', ...SCRIPTS]) refused([{ type: 'download', file }], 'blocks[0].action[0].file', 'unsafe_url');
    refused([{ type: 'download', asset: '../x' }], 'blocks[0].action[0].asset', 'bad_value');
    assert.equal(downloadPath('/uploads/%2f%2fevil'), '');
  });
  test('theme: light, dark or toggle', () => {
    for (const mode of ['light', 'dark', 'toggle']) accepted([{ type: 'theme', mode }]);
    refused([{ type: 'theme', mode: 'neon' }], 'blocks[0].action[0].mode', 'bad_value');
  });
});

describe('composition', () => {
  test('up to five steps; a sixth is refused', () => {
    const five = [...Array(4)].map(() => ({ type: 'copy', text: 'x' })).concat([{ type: 'navigate', to: '/' }]);
    accepted(five);
    refused([...five.slice(0, 4), { type: 'copy', text: 'y' }, { type: 'navigate', to: '/' }], 'blocks[0].action', 'too_many');
    assert.equal(MAX_STEPS, 5);
  });
  test('a step that leaves the page or sends a form is the last, and alone', () => {
    refused([{ type: 'navigate', to: '/' }, { type: 'copy', text: 'x' }], 'blocks[0].action[0].type', 'terminal_not_last');
    refused([{ type: 'submit', endpoint: 'newsletter.subscribe' }, { type: 'navigate', to: '/' }], 'blocks[0].action[0].type', 'terminal_not_last');
    const p = plan([{ type: 'copy', text: 'code' }, { type: 'reveal', target: 'faq' }, { type: 'navigate', to: '/docs' }]);
    assert.equal(p.kind, 'link');
    assert.equal(p.href, '/docs');
    assert.deepEqual(p.steps.map((s) => s.type), ['copy', 'reveal'], 'the steps before the link run first');
    assert.equal(plan([{ type: 'copy', text: 'x' }, { type: 'theme', mode: 'dark' }]).kind, 'button');
  });
  test('unknown, reserved (phase 7) and removed types: refused and inert, each with its reason', () => {
    refused([{ type: 'eval', code: 'x' }], 'blocks[0].action[0].type', 'unknown_action');
    for (const type of RESERVED_ACTIONS) refused([{ type, target: 'faq' }], 'blocks[0].action[0].type', 'reserved_action');
    refused([{ type: 'api', path: '/admin/users', method: 'POST' }], 'blocks[0].action[0].type', 'api_removed');
    assert.equal(plan([{ type: 'api', path: '/admin/users' }]).reason, 'api_removed');
    assert.ok(!ACTION_TYPES.includes('modal') && !ACTION_TYPES.includes('tab') && !ACTION_TYPES.includes('api'));
  });
  test('an unknown field on a step is refused with its path', () => {
    refused([{ type: 'navigate', to: '/', onclick: 'x' }], 'blocks[0].action[0].onclick', 'unknown_field');
  });
  test('not a list: refused', () => {
    assert.ok(problems({ type: 'navigate', to: '/' }).includes('blocks[0].action:bad_type'));
  });
});

describe('submit: a key of the registry, nothing else', () => {
  test('the registry names only public routes: no admin route, no /me route, POST, under /api', () => {
    for (const [key, e] of Object.entries(SUBMIT_REGISTRY)) {
      assert.equal(e.method, 'POST', key);
      assert.ok(e.path.startsWith('/api/') && !/\/admin|\/me\//.test(e.path), `${key}: ${e.path}`);
      assert.ok(!e.pow || (e.pow.startsWith('/api/') && !/\/admin|\/me\//.test(e.pow)));
      assert.ok(e.rateLimit, `${key} has no rate limit written down`);
    }
    assert.deepEqual(SUBMIT_KEYS, ['newsletter.subscribe', 'poll.vote', 'project.contact']);
  });
  test('a key outside the registry is refused and inert', () => {
    for (const endpoint of ['admin.users', '/api/admin/users', 'newsletter.subscribe ', '__proto__', 'constructor', 'toString'])
      refused([{ type: 'submit', endpoint }], 'blocks[0].action[0].endpoint', 'unknown_endpoint');
    assert.deepEqual(submitRequest('__proto__', {}, {}), { ok: false, field: 'endpoint', reason: 'unknown_endpoint' });
  });
  test('the author fixes only the fields the entry lets them fix', () => {
    accepted([{ type: 'submit', endpoint: 'newsletter.subscribe' }]);
    refused([{ type: 'submit', endpoint: 'newsletter.subscribe', fields: { path: '/api/admin' } }], 'blocks[0].action[0].fields.path', 'unknown_field');
    accepted([{ type: 'submit', endpoint: 'poll.vote', fields: { pollId: 'cl123', optionIds: ['a1', 'b2'] } }]);
    refused([{ type: 'submit', endpoint: 'poll.vote', fields: { pollId: '../admin', optionIds: ['a'] } }], 'blocks[0].action[0].fields.pollId', 'bad_value');
    refused([{ type: 'submit', endpoint: 'poll.vote', fields: { pollId: 'p' } }], 'blocks[0].action[0].fields.optionIds', 'bad_value');
    accepted([{ type: 'submit', endpoint: 'project.contact', fields: { project: 'bmm', topic: 'question' } }]);
    refused([{ type: 'submit', endpoint: 'project.contact', fields: { project: 'BMM/../x', topic: 'q' } }], 'blocks[0].action[0].fields.project', 'bad_value');
  });
  test('every request a click can make is one submitRequest builds from the registry', () => {
    const nl = submitRequest('newsletter.subscribe', {}, { email: ' Me@Example.org ' }, { lang: 'fr' });
    assert.deepEqual(nl, { ok: true, method: 'POST', url: '/api/newsletter/subscribe', body: { email: 'me@example.org', locale: 'fr' }, pow: null });
    const vote = submitRequest('poll.vote', { pollId: 'cl1', optionIds: ['a', 'a', 'b'] }, {});
    assert.equal(vote.url, '/api/polls/cl1/vote');
    assert.deepEqual(vote.body, { optionIds: ['a', 'b'] });
    const pc = submitRequest('project.contact', { project: 'sc:mine', topic: 'bug' }, { subject: 'Hi there', body: 'A long enough message', email: 'a@b.co', extra: 'dropped' }, { pow: { n: 1 } });
    assert.equal(pc.url, '/api/threads');
    assert.deepEqual(Object.keys(pc.body).sort(), ['body', 'email', 'kind', 'pow', 'subject', 'targetId', 'topic']);
    assert.equal(pc.body.kind, 'project');
    assert.equal(pc.pow, '/api/auth/pow');
    assert.equal(submitRequest('newsletter.subscribe', {}, { email: 'nope' }).reason, 'bad_value');
    assert.equal(submitRequest('project.contact', { project: 'bmm', topic: 'q' }, { subject: 'x', body: 'long enough body' }).reason, 'too_short');
  });
});

describe('the fields before phase 5', () => {
  test('a block link and a button action are read into steps, and written back as steps only', () => {
    const d = { id: 'L', blocks: [
      { id: 'a', kind: 'box', link: '/docs' },
      { id: 'b', kind: 'image', link: 'http://example.org/x' },
      { id: 'c', kind: 'text', link: '#faq' },
      { id: 'd', kind: 'box', link: 'mailto:hi@example.org?subject=x' },
      { id: 'e', kind: 'button', props: { label: 'x', action: { type: 'download', href: '/api/assets/setup.exe' } } },
      { id: 'f', kind: 'button', props: { label: 'x', action: { type: 'scroll', target: '#top' } } },
      { id: 'g', kind: 'button', props: { label: 'x', action: { type: 'link', href: '' } } },
      { id: 'faq', kind: 'text', props: { md: 'x' } },
    ] };
    const n = normalizeDoc(d);
    assert.deepEqual(n.blocks.map((b) => b.action), [
      [{ type: 'navigate', to: '/docs' }],
      [{ type: 'external', url: 'https://example.org/x' }],
      [{ type: 'scroll', target: 'faq' }],
      [{ type: 'mailto', address: 'hi@example.org' }],
      [{ type: 'download', asset: 'setup.exe' }],
      [{ type: 'scroll', target: '#top' }],
      [],
      [],
    ]);
    const out = serializeDoc(n);
    assert.ok(out.blocks.every((b) => b.link === undefined && b.props?.action === undefined));
    assert.deepEqual(validateDoc(out), [], 'what the studio writes back is accepted');
  });
  test('the removed api action stays visible (red in the editor, D5) and inert', () => {
    const steps = legacyAction({ kind: 'button', props: { action: { type: 'api', path: '/admin/x' } } });
    assert.deepEqual(steps, [{ type: 'api' }]);
    assert.equal(planAction(steps).kind, 'inert');
  });
  test('migrateDocActions converts only the legacy fields', () => {
    const raw = { id: 'x', title: 'T', blocks: [{ id: 'a', kind: 'box', x: 1, link: '/a' }, { id: 'b', kind: 'box', x: 2 }] };
    const m = migrateDocActions(raw);
    assert.deepEqual(m.blocks[0], { id: 'a', kind: 'box', x: 1, action: [{ type: 'navigate', to: '/a' }] });
    assert.equal(m.blocks[1], raw.blocks[1]);
    assert.equal(raw.blocks[0].link, '/a', 'the input is not mutated');
  });
});

describe('rendering rules that are data', () => {
  test('a hidden block named by a reveal step is mounted (flagged hidden); any other hidden block is not', () => {
    const d = normalizeDoc({ id: 'r', frames: { desktop: { w: 1200, h: 600, fit: 'fixed' }, phone: { w: 390, fit: 'content', mode: 'stack' } }, v: 2, blocks: [
      { id: 'btn', kind: 'button', x: 0, y: 0, w: 100, h: 40, props: { label: 'More' }, action: [{ type: 'reveal', target: 'more' }] },
      { id: 'more', kind: 'text', x: 0, y: 60, w: 100, h: 40, hidden: true, props: { md: 'x' } },
      { id: 'gone', kind: 'text', x: 0, y: 120, w: 100, h: 40, hidden: true, props: { md: 'y' } },
    ] });
    for (const mode of ['scale', 'stack']) {
      const got = frameBlocks(d, mode).map((b) => `${b.id}:${b.hidden}`);
      assert.ok(got.includes('more:true'), `${mode}: ${got}`);
      assert.ok(!got.some((x) => x.startsWith('gone')), `${mode}: ${got}`);
    }
  });
  test('the package restates canvas.js ID_SHAPE exactly', () => {
    const src = readFileSync(new URL('../../../packages/studio/src/actions.js', import.meta.url), 'utf8');
    assert.ok(src.includes(`const ID = ${ID_SHAPE.toString()};`));
  });
  test('a text block’s own links win over the block action: the action is a cover UNDER them', () => {
    // The rule is CSS (index.css) plus the cover markup (ui/canvas-actions.jsx); check-studio
    // renders it. Here: the stacking the rule depends on is written down where it lives.
    const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
    const cover = /\.cv-act\s*\{([^}]*)\}/.exec(css)?.[1] || '';
    const inner = /\.cv-actionable \.bcw-canvas-text :is\(a\[href\][^)]*\)\s*\{([^}]*)\}/.exec(css)?.[1] || '';
    const z = (s) => Number((/z-index:\s*(\d+)/.exec(s) || [])[1]);
    assert.ok(z(cover) >= 1 && z(inner) > z(cover), `cover z ${z(cover)}, inner links z ${z(inner)}`);
    assert.match(inner, /position:\s*relative/);
  });
});

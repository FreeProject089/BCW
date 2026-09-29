import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Code2, Shield, KeyRound, BookOpen, Send, Copy, FlaskConical, ArrowRight, Puzzle, Webhook, Palette, Activity, ExternalLink } from 'lucide-react';
import { SnippetTabs } from '../ui/dev-snippet.jsx';
import { BmdNpmCompact } from '../ui/bmd-npm.jsx';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { useAsync } from './pages.jsx';
import { highlightCode } from '../ui/code-highlight.jsx'; // M18: moved out of pages.jsx with Prism
import { Card, Button, Input, Select, Textarea, Badge, Field, Spinner, useToast, copyText } from '../ui/ui.jsx';
import { NewsGrid } from './home-sections.jsx';
import { useAuth } from './auth.jsx';

// /dev — the front door for anybody building against BetterCommunity.
//
// A landing page rather than a control panel: what can be built, what each tool is FOR, and
// one link per tool. The things you configure live at /dev/config, and the things you read
// live in the docs; this page exists so that neither has to be discovered by accident.

// Every endpoint the console can call, so the field is a choice rather than a guess at a
// path. Kept in step with the API by hand — a dropdown listing a route that does not exist
// is worse than a free-text box, so each entry here was checked against the router.
// An endpoint's description, translated. The key is derived from method+path rather than
// stored beside each row: 21 hand-written keys is 21 chances to typo one, and a wrong key
// falls back to the English silently — which is the exact bug this is fixing.
export function epDesc(t, e) {
  const slug = e.p.replace(/^\/v1\//, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
  return t(`dev.ep.${e.m.toLowerCase()}-${slug}`, e.d);
}

const ENDPOINTS = [
  // Public
  { m: 'GET', p: '/v1/scopes', scope: null, g: 'Public', d: 'Every scope and what it unlocks, no key needed' },
  { m: 'GET', p: '/v1/webhook-events', scope: null, g: 'Public', d: 'Every event you can subscribe a webhook to' },
  { m: 'GET', p: '/v1/catalog', scope: 'catalog:read', g: 'Public', d: 'The published catalog feed' },
  { m: 'GET', p: '/v1/catalog/changes', scope: 'catalog:read', g: 'Public', d: 'What changed in the feed, for syncing' },
  { m: 'GET', p: '/v1/users', scope: 'users:read', g: 'Public', d: 'The public member directory' },
  { m: 'GET', p: '/v1/users/me', scope: 'users:read', g: 'Public', d: 'One public profile, swap `me` for any id' },

  // You
  { m: 'GET', p: '/v1/account', scope: 'account:read', g: 'Your account', d: 'Who the key belongs to' },
  { m: 'PATCH', p: '/v1/account', scope: 'account:write', g: 'Your account', d: 'Change your display name or bio', write: true, body: '{\n  "displayName": "New name"\n}' },
  { m: 'GET', p: '/v1/notifications', scope: 'notifications:read', g: 'Your account', d: 'Your notifications' },
  { m: 'POST', p: '/v1/notifications/read-all', scope: 'notifications:write', g: 'Your account', d: 'Mark everything read', write: true },
  { m: 'GET', p: '/v1/favorites', scope: 'favorites:read', g: 'Your account', d: 'Repos and catalogs you starred' },
  { m: 'GET', p: '/v1/payments', scope: 'payments:read', g: 'Your account', d: 'Your invoices, amounts and dates, never a card number' },
  { m: 'GET', p: '/v1/transfers', scope: 'transfers:read', g: 'Your account', d: 'Ownership transfers in either direction' },

  // Your content
  { m: 'GET', p: '/v1/repos', scope: 'repos:read', g: 'Your content', d: 'Your Server-Repos' },
  { m: 'GET', p: '/v1/repos/ID/files', scope: 'repos:read', g: 'Your content', d: 'One repo\u2019s file list, replace ID' },
  { m: 'GET', p: '/v1/repos/ID/changes', scope: 'repos:read', g: 'Your content', d: 'What changed in a repo, replace ID' },
  { m: 'GET', p: '/v1/catalogs', scope: 'catalogs:read', g: 'Your content', d: 'Catalogs you own, unpublished ones included' },
  { m: 'GET', p: '/v1/catalogs/ID/items', scope: 'catalogs:read', g: 'Your content', d: 'What is inside one, replace ID' },
  { m: 'GET', p: '/v1/pools', scope: 'pools:read', g: 'Your content', d: 'Storage pools and what draws from them' },

  // Polls
  { m: 'GET', p: '/v1/polls', scope: 'polls:read', g: 'Polls', d: 'Polls open to you, and how you answered' },
  { m: 'GET', p: '/v1/polls/ID', scope: 'polls:read', g: 'Polls', d: 'One poll, open or closed, with every option and question id, and its result once you may see it' },
  { m: 'POST', p: '/v1/polls/ID/vote', scope: 'polls:write', g: 'Polls', d: 'Answer one, replace ID', write: true, body: '{\n  "optionIds": ["…"]\n}' },

  // Community
  { m: 'GET', p: '/v1/charity', scope: 'charity:read', g: 'Community', d: 'The Community Charity pot this month: association, totals, the vote' },
  { m: 'GET', p: '/v1/economy', scope: 'economy:read', g: 'Community', d: 'Your Discord level, XP, points and activity' },
  { m: 'GET', p: '/v1/economy/purchases', scope: 'economy:read', g: 'Community', d: 'What you bought with points, with any code you were handed' },
  { m: 'GET', p: '/v1/badges', scope: 'badges:read', g: 'Community', d: 'The badges on your profile and when you earned them' },
];

// The same call, as code you can paste into a project.
//
// The gap this closes is the one where people give up: "it worked in the console" and "it
// works in my code" are separated by an hour of guessing at header names. The key is NEVER
// interpolated — the snippet reads it from the environment, because a snippet with a live
// credential in it is a snippet that ends up in a commit.
const LANGS = ['curl', 'fetch', 'python'];

function snippetFor(lang, { method, path, body, sandbox, write }) {
  // The origin of the page the reader is on. On localhost the snippet says localhost, which
  // is where their key actually works right now; deployed, it says the deployed domain. A
  // hardcoded domain was wrong in BOTH directions — and it was the wrong TLD besides.
  const url = `${typeof location !== 'undefined' ? location.origin : 'https://bettercommunity.ch'}/api${path}`;
  const hdr = [['Authorization', 'Bearer $BCW_KEY']];
  if (body) hdr.push(['Content-Type', 'application/json']);
  if (write && sandbox) hdr.push(['X-BCW-Sandbox', '1']);

  if (lang === 'curl') {
    return [
      `curl -X ${method} '${url}' \\`,
      ...hdr.map(([k, v]) => `  -H '${k}: ${v}' \\`),
      body ? `  -d '${body}'` : '  -i',
    ].join('\n');
  }
  if (lang === 'fetch') {
    return [
      `const res = await fetch('${url}', {`,
      `  method: '${method}',`,
      '  headers: {',
      ...hdr.map(([k, v]) => `    '${k}': ${v.includes('$BCW_KEY') ? '`Bearer ${process.env.BCW_KEY}`' : `'${v}'`},`),
      '  },',
      ...(body ? [`  body: JSON.stringify(${body}),`] : []),
      '});',
      'console.log(res.status, await res.json());',
    ].join('\n');
  }
  return [
    'import os, requests',
    '',
    `res = requests.${method.toLowerCase()}(`,
    `    "${url}",`,
    '    headers={',
    ...hdr.map(([k, v]) => `        "${k}": ${v.includes('$BCW_KEY') ? 'f"Bearer {os.environ[\'BCW_KEY\']}"' : `"${v}"`},`),
    '    },',
    ...(body ? [`    json=${body},`] : []),
    ')',
    'print(res.status_code, res.json())',
  ].join('\n');
}


// GET reads, POST/PATCH write, DELETE removes — three tones, because the difference
// between them is the whole reason to look before clicking Send. Never colour alone: the
// method is spelled out in the chip.
const METHOD_TONE = {
  GET: 'var(--primary-2)',
  POST: 'var(--warning)',
  PATCH: 'var(--warning)',
  DELETE: 'var(--error)',
};
function MethodChip({ m }) {
  return (
    <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0"
      style={{ color: METHOD_TONE[m] || 'var(--muted)', background: 'color-mix(in srgb, currentColor 14%, transparent)' }}>
      {m}
    </span>
  );
}

export function ApiConsole() {
  const { t } = useI18n(); const toast = useToast();
  const [key, setKey] = useState('');
  const [idx, setIdx] = useState(0);
  const [body, setBody] = useState('');
  const [sandbox, setSandbox] = useState(true);
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [lang, setLang] = useState('curl');
  const [q, setQ] = useState('');

  const ep = ENDPOINTS[idx];

  const pick = (i) => {
    const e = ENDPOINTS[i];
    setIdx(i); setBody(e.body || ''); setRes(null);
  };

  const send = async () => {
    if (ep.scope && !key.trim()) return toast.error(t('dev.console.needkey', 'Paste one of your API keys first.'));
    setBusy(true); setRes(null);
    const started = performance.now();
    try {
      // fetch directly rather than through lib/api: the point is to send YOUR key and show
      // exactly what came back, failures included. The api wrapper would attach the session
      // cookie and turn a 401 into a success.
      const r = await fetch(`/api${ep.p}`, {
        method: ep.m,
        headers: {
          ...(key.trim() ? { Authorization: `Bearer ${key.trim()}` } : {}),
          ...(ep.write && sandbox ? { 'X-BCW-Sandbox': '1' } : {}),
          ...(body.trim() ? { 'Content-Type': 'application/json' } : {}),
        },
        body: ep.m === 'GET' ? undefined : (body.trim() || undefined),
        credentials: 'omit',
      });
      const text = await r.text();
      let pretty = text;
      try { pretty = JSON.stringify(JSON.parse(text), null, 2); } catch { /* not JSON — show it raw */ }
      setRes({ status: r.status, ms: Math.round(performance.now() - started), body: pretty });
    } catch (e) {
      setRes({ status: 0, ms: Math.round(performance.now() - started), body: String(e?.message || e) });
    } finally { setBusy(false); }
  };

  const tone = (s) => (s === 0 || s >= 500 ? 'red' : s >= 400 ? 'amber' : 'green');

  return (
    <Card className="p-5">
      <div className="text-sm font-semibold mb-1 flex items-center gap-2">
        <Send size={15} className="text-[var(--accent-ink)]" /> {t('dev.console.title', 'Try a call')}
      </div>
      <p className="text-[12px] text-[var(--muted)] mb-3">
        {t('dev.console.sub2', 'A real request with your real key, and the real answer — refusals included, which are the half worth seeing. Your key stays in this browser and goes nowhere but the API.')}
      </p>

      <div className="space-y-2">
        <Field label={t('dev.console.pick', 'Endpoint')}>
          {/* A filter over 21 endpoints. A dropdown makes you read all of them to find one;
              typing "repo" is how anybody actually looks for a route. Matches the path, the
              description and the scope, because people search for all three. */}
          {/* autoComplete off, and a name the browser cannot mistake for a login field. A
              password manager filled this with an e-mail address, so the filter matched
              nothing and the console looked broken before anybody had typed a character. */}
          <Input className="mb-2" value={q} onChange={(e) => setQ(e.target.value)}
            name="endpoint-filter" autoComplete="off" spellCheck={false} type="search"
            placeholder={t('dev.console.filter', 'Filter, path, description or scope')} />
          <div className="rounded-lg border border-[var(--line)] max-h-64 overflow-auto divide-y divide-[var(--line)]">
            {(() => {
              const needle = q.trim().toLowerCase();
              const rows = ENDPOINTS
                .map((e, i) => ({ e, i }))
                .filter(({ e }) => !needle
                  || e.p.toLowerCase().includes(needle)
                  || String(e.scope || '').toLowerCase().includes(needle)
                  || epDesc(t, e).toLowerCase().includes(needle));
              if (!rows.length) {
                return <div className="p-3 text-[12px] text-[var(--muted)]">{t('dev.console.nomatch', 'Nothing matches that.')}</div>;
              }
              return rows.map(({ e, i }) => (
                <button key={e.m + e.p} type="button" onClick={() => pick(i)}
                  className={`w-full text-start px-2.5 py-2 flex items-start gap-2 hover:bg-[var(--surface-2)] ${i === idx ? 'bg-[var(--surface-2)]' : ''}`}>
                  <MethodChip m={e.m} />
                  <span className="min-w-0 flex-1">
                    <span className="font-mono text-[12px] break-all">{e.p}</span>
                    <span className="block text-[11px] text-[var(--muted)]">{epDesc(t, e)}</span>
                  </span>
                  {/* The scope sits ON the row rather than in a note below the picker: it is
                      a property of the endpoint, and reading it after choosing is reading it
                      too late. */}
                  <span className="text-[10px] text-[var(--faint)] font-mono shrink-0 mt-0.5">
                    {e.scope || t('dev.console.public', 'public')}
                  </span>
                </button>
              ));
            })()}
          </div>
        </Field>
        <div className="text-[11px] text-[var(--faint)]">
          <MethodChip m={ep.m} /> <span className="font-mono">{ep.p}</span>
          {' — '}
          {ep.scope
            ? t('dev.console.needs', 'Needs the {s} scope.').replace('{s}', ep.scope)
            : t('dev.console.noauth', 'Public, no key required.')}
        </div>

        <Field label={t('dev.console.key', 'Your API key')}>
          <Input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="bck_…" autoComplete="off" />
        </Field>

        {ep.write && (
          <>
            <Field label={t('dev.console.body', 'JSON body (optional)')}>
              <Textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} />
            </Field>
            {/* Sandbox is ON by default for anything that writes, and saying what it does is
                the point: it is not a pretend response, the key is authenticated and the
                scope is checked exactly as usual — only the write is skipped. */}
            <label className="flex items-start gap-2 text-[12px] rounded-lg border border-[var(--line)] panel p-2.5">
              <input type="checkbox" className="mt-0.5" checked={sandbox} onChange={(e) => setSandbox(e.target.checked)} />
              <span>
                <b className="flex items-center gap-1.5"><FlaskConical size={12} /> {t('dev.console.sandbox', 'Sandbox')}</b>
                <span className="text-[var(--muted)]">{t('dev.console.sandbox.h', 'Your key is authenticated and the scope is checked, then nothing is written. Untick to make this call for real, it will change your data.')}</span>
              </span>
            </label>
          </>
        )}

        <Button variant="primary" disabled={busy} onClick={send}>{busy ? <Spinner /> : t('dev.console.send', 'Send')}</Button>

        {/* The same call as code. "It worked in the console" and "it works in my code" are
            separated by an hour of guessing at header names, and that hour is where people
            give up. */}
        <div className="pt-3 mt-1 border-t border-[var(--line)]">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--faint)] flex items-center gap-1.5"><Code2 size={12} /> {t('dev.snip', 'The same call, in code')}</span>
            <div className="inline-flex rounded-[10px] bg-[var(--surface-2)] p-0.5 ms-auto">
              {LANGS.map((l) => (
                <button key={l} onClick={() => setLang(l)}
                  className={`px-2 py-0.5 rounded-[8px] text-[11px] ${lang === l ? 'bg-[var(--bg-solid)] font-medium' : 'text-[var(--muted)]'}`}>{l}</button>
              ))}
            </div>
            <Button size="sm" variant="ghost" onClick={() => { copyText(snippetFor(lang, { method: ep.m, path: ep.p, body: ep.write ? body : '', sandbox, write: ep.write })); toast.success(t('common.copied', 'Copied.')); }}><Copy size={12} /></Button>
          </div>
          {/* Highlighted with the same Prism setup the JSON editor uses, so a snippet reads
              like code rather than like a paragraph. */}
          <pre className="text-[11px] font-mono whitespace-pre-wrap break-all bg-[var(--surface-2)] rounded-lg p-3 max-h-52 overflow-auto"
            dangerouslySetInnerHTML={{ __html: highlightCode(snippetFor(lang, { method: ep.m, path: ep.p, body: ep.write ? body : '', sandbox, write: ep.write }), lang) }} />
          <p className="text-[11px] text-[var(--muted)] mt-1">{t('dev.snip.h', 'The key is read from BCW_KEY in your environment, a snippet with a live credential in it is a snippet that ends up in a commit.')}</p>
        </div>
      </div>

      {res && (
        <div className="mt-3">
          <div className="flex items-center gap-2 text-[12px] mb-1">
            <Badge tone={tone(res.status)}>{res.status || t('dev.console.nonet', 'no response')}</Badge>
            <span className="text-[var(--faint)]">{res.ms} ms</span>
            {ep.write && sandbox && <Badge>{t('dev.console.sandbox', 'Sandbox')}</Badge>}
            <Button size="sm" variant="ghost" className="ms-auto" onClick={() => { copyText(res.body); toast.success(t('common.copied', 'Copied.')); }}><Copy size={12} /></Button>
          </div>
          <pre className="text-[11px] font-mono whitespace-pre-wrap break-all bg-[var(--surface-2)] rounded-lg p-3 max-h-72 overflow-auto">{res.body}</pre>
          {res.status === 403 && (
            <p className="text-[11px] text-warning mt-1">
              {t('dev.console.403', 'The key authenticated but does not carry the scope this endpoint needs, add it to the key in your profile.')}
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

// The cards this page ships with. They are the DEFAULT, not the truth: an admin can add,
// remove and reorder them in Projects config → Developers, and what is saved there replaces
// this list wholesale. Kept here so a site that has never configured the page still has one,
// and so "reset to the built-in cards" has something to reset to.
export const DEFAULT_DEV_CARDS = [
  // Every built-in card carries its ENGLISH words beside its key. `t(key, fallback)` means
  // the fallback IS the English — these were written with keys alone, so the French dictionary
  // answered and English fell through to the empty string the code passed. The page had four
  // blank cards in English and looked perfect in French.
  {
    id: 'tools', icon: 'file-json', to: '/dev/tools', ctaKey: 'dev.hub.open',
    titleKey: 'dev.hub.tools', title: 'Tools',
    bodyKey: 'dev.hub.tools.s2',
    body: 'Try any call against the real API, check a catalog feed before you publish it, and see what your keys have been doing, refusals included.',
    // Named and linked, not summarised. Five tools live behind this card and the only way to
    // learn which was to open it — the same discoverability gap that hid a working Switch step
    // and a whole catalogue type elsewhere in this project.
    // Each one says what it DOES, because these are drawn as their own cards now — five
    // pills inside a paragraph made the five things a developer came for look like footnotes
    // to the card that contained them.
    chips: [
      { to: '/dev/tools#try', labelKey: 'dev.console.title', label: 'Try a call',
        icon: 'terminal', hintKey: 'dev.hub.tool.try', hint: 'Against the real API, with your key. Sandbox mode answers without writing.' },
      { to: '/dev/tools#validate', labelKey: 'dvt.val', label: 'Check a catalog feed',
        icon: 'check-circle-2', hintKey: 'dev.hub.tool.val', hint: 'Paste a URL, see what BMM makes of it.' },
      { to: '/dev/tools#deeplink', labelKey: 'dvt.dl.title', label: 'Build a bmm:// link',
        icon: 'link-2', hintKey: 'dev.hub.tool.dl', hint: 'Pick an action, get the link.' },
      { to: '/dev/tools#signature', labelKey: 'dvt.sig.title', label: 'Check a webhook signature',
        icon: 'fingerprint', hintKey: 'dev.hub.tool.sig', hint: 'Paste a payload and a header, find out which half is wrong.' },
      { to: '/dev/tools#calls', labelKey: 'dvt.calls', label: 'What your keys did',
        icon: 'activity', hintKey: 'dev.hub.tool.calls', hint: 'Every call your keys made, refusals included.' },
    ],
  },
  {
    id: 'config', icon: 'sliders', to: '/dev/config', ctaKey: 'dev.hub.open',
    titleKey: 'dev.hub.config', title: 'Credentials',
    bodyKey: 'dev.hub.config.s',
    body: 'Your API keys and the apps you have registered.',
  },
  {
    id: 'sso', icon: 'shield', to: '/docs/sso', ctaKey: 'dev.hub.ssodoc',
    titleKey: 'dev.hub.sso', title: 'Sign in with BetterCommunity',
    bodyKey: 'dev.hub.sso.s',
    body: 'Standard OpenID Connect. Point your library at the discovery document, no in-house SDK.',
  },
  {
    id: 'markdown', icon: 'puzzle', to: '/dev/markdown', ctaKey: 'dev.hub.open',
    titleKey: 'dev.hub.md', title: 'B.MD, the markdown kit',
    bodyKey: 'dev.hub.md.s3',
    body: 'The block system this site renders with — callouts, cards, tabs, steps, API cards, embeds, live values, diagrams — as the @bettercommunity/bmd package, with an editor package beside it.',
    chips: [
      { to: '/dev/markdown', labelKey: 'dev.hub.md.play', label: 'Playground', icon: 'puzzle', hintKey: 'dev.hub.md.play.h', hint: 'Type a block, see it, take the folder.' },
      { to: '/dev/bmd', labelKey: 'dev.hub.md.install', label: 'Install it', icon: 'package', hintKey: 'dev.hub.md.install.h', hint: 'Vite, Next.js, Remix, Astro, Node, the wiring for each.' },
      { to: '/dev/editor', labelKey: 'dev.hub.md.editor', label: 'The editor', icon: 'pen-line', hintKey: 'dev.hub.md.editor.h', hint: 'Block menu, live preview, link check, export.' },
      { to: '/dev/tools#openapi', labelKey: 'dvt.oa.title', label: 'OpenAPI → B.MD', icon: 'file-json', hintKey: 'dev.hub.md.oa.h', hint: 'Paste a spec, get endpoint cards to publish.' },
    ],
  },
  {
    id: 'docs', icon: 'book-open', to: '/docs', ctaKey: 'dev.hub.open',
    titleKey: 'dev.hub.docs', title: 'Docs',
    bodyKey: 'dev.hub.docs.s',
    body: 'API reference, plugin API, catalog and repository formats.',
  },
];

// A configured card carries its own words; a built-in one carries a key and is translated.
// Both end up as the same shape, so the renderer has one case rather than two.
export function devCards(cfg, t) {
  const custom = Array.isArray(cfg?.cards) ? cfg.cards.filter((c) => c && !c.hidden) : null;
  const list = custom && custom.length ? custom : DEFAULT_DEV_CARDS;
  return list.map((c, i) => ({
    key: c.id || `c${i}`,
    icon: c.icon || 'circle',
    title: c.titleKey ? t(c.titleKey, c.title || '') : (c.title || ''),
    body: c.bodyKey ? t(c.bodyKey, c.body || '') : (c.body || ''),
    to: c.to || '',
    cta: c.ctaKey ? t(c.ctaKey, c.cta || '') : (c.cta || t('dev.hub.open', 'Open')),
    chips: Array.isArray(c.chips) ? c.chips : null,
  }));
}

// The six things a developer can build against, and where each one's documentation lives.
// Every `to` is a route of this app or a seeded doc slug (apps/api/src/seed-docs.mjs), so a
// renamed page shows up in check-seed-links rather than as a dead card here.
const NPM_BMD = 'https://www.npmjs.com/package/@bettercommunity/bmd';
export const SURFACES = [
  { id: 'api', icon: Code2, to: '/docs/bcweb-api', titleKey: 'devp.s.api', title: 'REST API',
    bodyKey: 'devp.s.api.b', body: 'Read and change what a member owns, with a key they created and the scopes they chose. JSON over HTTPS, a sandbox for writes.',
    links: [
      { key: 'devp.l.ref', label: 'Reference', to: '/docs/bcweb-api' },
      { key: 'devp.l.try', label: 'Try a call', to: '/dev/tools#try' },
      { key: 'devp.l.sandbox', label: 'Sandbox', to: '/docs/sandbox' },
      { key: 'devp.l.keys', label: 'Your keys', to: '/dev/config' },
    ] },
  { id: 'oidc', icon: Shield, to: '/docs/sso', titleKey: 'devp.s.oidc', title: 'Sign in with BetterCommunity',
    bodyKey: 'devp.s.oidc.b', body: 'Standard OpenID Connect: point any OIDC library at the discovery document. Authorization code with PKCE, no in-house SDK.',
    links: [
      { key: 'devp.l.guide', label: 'Guide', to: '/docs/sso' },
      { key: 'devp.l.discovery', label: 'Discovery document', href: 'DISCOVERY' },
      { key: 'devp.l.app', label: 'Register an app', to: '/dev/config' },
    ] },
  { id: 'webhooks', icon: Webhook, to: '/docs/webhooks', titleKey: 'devp.s.wh', title: 'Webhooks',
    bodyKey: 'devp.s.wh.b', body: 'Get told when something changes instead of polling. Every delivery is signed (HMAC-SHA256 over timestamp and body).',
    links: [
      { key: 'devp.l.guide', label: 'Guide', to: '/docs/webhooks' },
      { key: 'devp.l.sig', label: 'Check a signature', to: '/dev/tools#signature' },
    ] },
  { id: 'bmd', icon: Puzzle, to: '/dev/bmd', titleKey: 'devp.s.bmd', title: 'B.MD, the markdown kit',
    bodyKey: 'devp.s.bmd.b', body: 'The block system this site is written in, as an npm package: callouts, cards, tabs, API cards, live values, diagrams. Works with npm, pnpm, yarn and bun.',
    // bmdpub (agent-bmd-published): published on npm since 3.1.0; the card shows both packages
    // (versions, npm links, install, provenance) through ui/bmd-npm.jsx.
    npm: true,
    links: [
      { key: 'devp.l.install', label: 'Install and directives', to: '/dev/bmd' },
      { key: 'devp.l.play', label: 'Playground', to: '/dev/markdown' },
      { key: 'devp.l.editor', label: 'Editor', to: '/dev/editor' },
      { key: 'devp.l.npm', label: 'npm', href: NPM_BMD },
    ] },
  { id: 'bmm', icon: Palette, to: '/docs/plugins', titleKey: 'devp.s.bmm', title: 'BMM plugins and themes',
    bodyKey: 'devp.s.bmm.b', body: 'Extend BetterModsManager with a plugin, restyle it with a theme, and publish either through a catalog feed.',
    links: [
      { key: 'devp.l.plugins', label: 'Plugins', to: '/docs/plugins' },
      { key: 'devp.l.pluginapi', label: 'Plugin API', to: '/docs/api-reference' },
      { key: 'devp.l.themes', label: 'Themes', to: '/docs/themes' },
      { key: 'devp.l.feed', label: 'Check a catalog feed', to: '/dev/tools#validate' },
      { key: 'devp.l.deeplink', label: 'bmm:// links', to: '/dev/tools#deeplink' },
    ] },
  { id: 'status', icon: Activity, to: '/status', titleKey: 'devp.s.status', title: 'Status',
    bodyKey: 'devp.s.status.b', body: 'Whether the API, the site and the repositories are up right now, and every incident with its timeline.',
    links: [
      { key: 'devp.l.status', label: 'Status page', to: '/status' },
      { key: 'devp.l.calls', label: 'What your keys did', to: '/dev/tools#calls' },
    ] },
];

/** The first call of each surface. Keys come from the environment, never from the page. */
function quickStart(base, t) {
  const origin = base || 'https://bettercommunity.ch';
  return [
    { id: 'api', label: t('devp.q.api', 'API key'), lang: 'bash',
      code: `# Create a key at ${origin}/dev/config, then:\nexport BCW_KEY=bck_...\ncurl -H "Authorization: Bearer $BCW_KEY" ${origin}/api/v1/account`,
      note: t('devp.q.api.n', 'Writes accept X-BCW-Sandbox: 1: the key and the scope are checked, nothing is written.') },
    { id: 'oidc', label: 'OpenID Connect', lang: 'bash',
      code: `# Everything an OIDC library needs: endpoints, scopes, signing keys\ncurl ${origin}/.well-known/openid-configuration`,
      note: t('devp.q.oidc.n', 'Register the app (client id, redirect URI) at /dev/config, then give your library the discovery URL.') },
    { id: 'webhooks', label: t('devp.q.wh', 'Webhook check'), lang: 'js',
      code: [
        "import crypto from 'node:crypto';",
        '',
        '// rawBody: the request body exactly as received, before JSON.parse',
        'export function verify(headers, rawBody, secret) {',
        "  const ts = headers['x-bcw-timestamp'];",
        "  const sig = String(headers['x-bcw-signature'] || '').replace(/^v1=/, '');",
        '  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false; // replay window',
        "  const mine = crypto.createHmac('sha256', secret).update(`${ts}.${rawBody}`).digest('hex');",
        '  return mine.length === sig.length && crypto.timingSafeEqual(Buffer.from(mine), Buffer.from(sig));',
        '}',
      ].join('\n') },
    { id: 'bmd', label: 'B.MD', lang: 'jsx',
      code: [
        '// npm i @bettercommunity/bmd   (or pnpm add / yarn add / bun add)',
        "import Markdown from '@bettercommunity/bmd';",
        "import '@bettercommunity/bmd/markdown.css';",
        '',
        'export const Post = ({ body }) => <Markdown lang="en">{body}</Markdown>;',
      ].join('\n') },
  ];
}

export default function DevHub() {
  const { t } = useI18n(); const toast = useToast();
  const { user } = useAuth();
  // What this visitor already has. Only asked for when signed in — a signed-out developer is
  // the one this page was written for, and should not pay for a request that can only answer
  // "none".
  const mine = useAsync(() => (user ? api.get('/me/api-keys') : Promise.resolve({ keys: [] })), [!!user]);
  const myKeys = (mine.data?.keys || []).filter((k) => !k.revokedAt);
  // The developer blog, as a reading feed on the landing itself — not a link you might not
  // follow. Filtered to the developers project; failure is silent so the page never depends
  // on there being posts (or on the endpoint answering).
  const devPosts = useAsync(() => api.get('/blog?project=developers').then((d) => d.posts || []).catch(() => []), []);
  const base = typeof location !== 'undefined' ? location.origin : '';
  // Only read by a `stat` block on a built page, and fetched unconditionally so the hook
  // order never depends on whether one exists.
  const { data: stats } = useAsync(() => api.get('/stats').catch(() => null), []);
  // What an admin saved for this page. Absent (or a 404 before it has ever been saved) leaves
  // every default in place, so the page never depends on the config existing.
  const [cfg, setCfg] = useState(null);
  useEffect(() => {
    let on = true;
    api.get('/projects/developers').then((d) => { if (on) setCfg(d.config || d || null); }).catch(() => {});
    return () => { on = false; };
  }, []);
  const hero = cfg?.hero || {};
  const show = cfg?.sections || {};

  return (
    <div className="max-w-5xl mx-auto py-8 sm:py-12">
      {/* The hero says what you can build, not what we have built. A developer landing that
          opens with a feature list is a brochure; the question people arrive with is "can I
          do the thing I came to do, and how long will it take". */}
      <div className="text-center max-w-2xl mx-auto mb-8 sm:mb-12">
        <span className="inline-grid place-items-center w-14 h-14 rounded-2xl bg-gradient-to-br from-brand to-brand-2 text-[var(--on-primary)] shadow-lg shadow-orange-500/25 mb-4"><Code2 size={26} /></span>
        <h1 className="text-3xl sm:text-4xl font-extrabold leading-tight">
          {hero.title || <>{t('dev.hub.h1a', 'Build on')} <span className="gradient-text">BetterCommunity</span></>}
        </h1>
        <p className="text-[var(--muted)] mt-3 text-base sm:text-lg">
          {hero.body || t('dev.hub.h1b', 'Sign people in, read their content with their permission, get told when it changes. REST API, OpenID Connect, webhooks, no SDK to install.')}
        </p>
        {/* The first button depends on whether you already have a key.
            A developer who has been using this API for months arrived to "Get a key — takes
            about a minute", which is a sales pitch aimed at somebody they stopped being. The
            page is still written for the newcomer; it just no longer talks over the person who
            already said yes. */}
        <div className="flex flex-wrap gap-2 justify-center mt-6">
          <Link to="/dev/config">
            <Button variant="primary">
              <KeyRound size={15} />
              {myKeys.length
                ? t('dev.hub.mine', 'My keys ({n})').replace('{n}', String(myKeys.length))
                : t('dev.hub.start', 'Get a key')}
            </Button>
          </Link>
          {/* Editable, because it is the one button on this page that can rot without
              anybody noticing: the docs page it points at is content, and content gets
              renamed. A dead "API reference" on the developer landing page is the worst
              possible dead link, and there was no way to change it without a deploy. */}
          <Link to={hero.refUrl || '/docs/bcweb-api'}>
            <Button><BookOpen size={15} /> {hero.refLabel || t('dev.hub.ref', 'API reference')}</Button>
          </Link>
        </div>
        {/* Said once, at the top, because it is the number that decides whether somebody
            starts today or bookmarks the page. Pointless once they have started. */}
        {!myKeys.length && (
          <p className="text-[12px] text-[var(--faint)] mt-4">
            {hero.note || t('dev.hub.time', 'A key takes a minute. No approval needed.')}
          </p>
        )}
      </div>

      {/* ONE fork, first: which of the two things are you building?
          Getting this wrong is the mistake that costs a day, and the names do not give it
          away. Each side is now a LINK to where that answer starts — they were dead-end
          cards decorated with pills, so the page named the decision and then left you to
          find the door yourself. */}
      {show.jobs !== false && (
        <div className="grid sm:grid-cols-2 gap-4 mb-10">
          <Link to="/dev/config" className="group rounded-xl border border-[var(--line)] p-5 transition hover:border-[var(--primary)]" style={{ background: 'var(--surface)' }}>
            <div className="flex items-center gap-2 mb-1">
              <KeyRound size={16} className="text-[var(--accent-ink)]" />
              <span className="font-semibold text-[15px] flex-1">{t('dev.hub.jobkey', 'Your program acts as YOU')}</span>
              <ArrowRight size={14} className="shrink-0 opacity-0 group-hover:opacity-100 transition text-[var(--accent-ink)]" />
            </div>
            <p className="text-[13px] text-[var(--muted)]">{t('dev.hub.jobkey.s', 'A script, a sync job, a bot you run. Use an API key.')}</p>
          </Link>
          <Link to="/docs/sso" className="group rounded-xl border border-[var(--line)] p-5 transition hover:border-[var(--primary)]" style={{ background: 'var(--surface)' }}>
            <div className="flex items-center gap-2 mb-1">
              <Shield size={16} className="text-[var(--accent-ink)]" />
              <span className="font-semibold text-[15px] flex-1">{t('dev.hub.jobsso', 'Your app acts for OTHER people')}</span>
              <ArrowRight size={14} className="shrink-0 opacity-0 group-hover:opacity-100 transition text-[var(--accent-ink)]" />
            </div>
            <p className="text-[13px] text-[var(--muted)]">{t('dev.hub.jobsso.s', 'Anything with its own users. They authorise it, you never touch their password.')}</p>
          </Link>
        </div>
      )}

      {/* What you can build on, one card per surface. Each card is a heading link plus its
          own row of links: the old three doors nested clickable pills INSIDE a link (a
          `role="link"` span in an `<a>`), which a screen reader announces as one link and a
          keyboard could only half reach. Siblings now, every one a real anchor. */}
      <h2 className="text-xl sm:text-2xl font-extrabold tracking-tight mb-4">{t('devp.surfaces', 'What you can build on')}</h2>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-12">
        {SURFACES.map((s) => (
          <div key={s.id} className="group rounded-xl border border-[var(--line)] p-5 min-w-0 flex flex-col transition hover:border-[var(--primary)]" style={{ background: 'var(--surface)' }}>
            <Link to={s.to} className="flex items-center gap-2 mb-1">
              <s.icon size={16} className="text-[var(--accent-ink)] shrink-0" />
              <span className="font-semibold text-[15px] flex-1 min-w-0">{t(s.titleKey, s.title)}</span>
              <ArrowRight size={14} className="shrink-0 opacity-60 group-hover:opacity-100 transition text-[var(--accent-ink)]" />
            </Link>
            <p className="text-[13px] text-[var(--muted)] flex-1">{t(s.bodyKey, s.body)}</p>
            {s.npm && <BmdNpmCompact />}
            <div className="flex flex-wrap gap-1.5 mt-3">
              {s.links.map((l) => {
                const cls = 'text-[11px] px-2 py-0.5 rounded-full border border-[var(--line)] text-[var(--muted)] hover:border-[var(--primary)] hover:text-[var(--text)] inline-flex items-center gap-1';
                const label = t(l.key, l.label);
                return l.href
                  ? <a key={l.key} href={l.href === 'DISCOVERY' ? `${base}/.well-known/openid-configuration` : l.href} target="_blank" rel="noopener noreferrer" className={cls}>{label} <ExternalLink size={10} /></a>
                  : <Link key={l.key} to={l.to} className={cls}>{label}</Link>;
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Quick start: the first call of each surface, copyable. The key is read from the
          environment in every snippet, never pasted in (see ApiConsole's note). */}
      {show.quickstart !== false && (
        <section className="mb-12">
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
            <h2 className="text-xl sm:text-2xl font-extrabold tracking-tight">{t('devp.qs', 'Quick start')}</h2>
            <Link to={hero.refUrl || '/docs/bcweb-api'} className="text-sm text-[var(--accent-ink)] inline-flex items-center gap-1 hover:gap-2 transition-all">{t('devp.qs.ref', 'Full API reference')} <ArrowRight size={13} /></Link>
          </div>
          <SnippetTabs tabs={quickStart(base, t)} />
        </section>
      )}

      {/* The living half of the page: the latest from the developer blog, read right here.
          Same NewsGrid the home landing uses, so the two front doors share one look. Absent
          when there are no developer posts — the page never shows an empty band. */}
      {devPosts.data?.length > 0 && (
        <div className="mb-10">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl font-extrabold tracking-tight">{t('dev.hub.newsh', 'From the developer blog')}</h2>
            <Link to="/blog?project=developers" className="text-sm text-[var(--accent-ink)] inline-flex items-center gap-1 hover:gap-2 transition-all">{t('dev.hub.newsall', 'All posts')} <ArrowRight size={13} /></Link>
          </div>
          <NewsGrid posts={devPosts.data} limit={3} heading={false} />
        </div>
      )}

      {/* The discovery URL, demoted to one quiet line — reference material, not a destination.
          copyText takes ONE argument and returns a boolean; it does not toast, so the toast
          is explicit here. */}
      {show.discovery !== false && (
        <div className="mt-8 rounded-xl border border-[var(--line)] p-4 flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="text-[11px] uppercase tracking-wider text-[var(--faint)]">{t('dev.hub.discovery', 'Discovery')}</span>
          <code className="text-[11px] font-mono break-all bg-[var(--surface-2)] rounded px-2 py-1 flex-1 min-w-[240px]">{base}/.well-known/openid-configuration</code>
          <Button size="sm" variant="ghost" title={t('common.copy', 'Copy')} aria-label={t('common.copy', 'Copy')}
            onClick={() => { copyText(`${base}/.well-known/openid-configuration`); toast.success(t('common.copied', 'Copied.')); }}><Copy size={13} /></Button>
        </div>
      )}

    </div>
  );
}

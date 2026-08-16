import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Code2, Shield, KeyRound, BookOpen, Send, Newspaper, Copy, Sliders, FlaskConical, ArrowRight, FileJson } from 'lucide-react';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { highlightCode } from './pages.jsx';
import { Card, Button, Input, Select, Textarea, Badge, Field, Spinner, useToast, copyText } from '../ui/ui.jsx';
import { useAuth } from './auth.jsx';
import { IconGlyph } from '../ui/md.jsx';

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
  { m: 'GET', p: '/v1/scopes', scope: null, g: 'Public', d: 'Every scope and what it unlocks — no key needed' },
  { m: 'GET', p: '/v1/webhook-events', scope: null, g: 'Public', d: 'Every event you can subscribe a webhook to' },
  { m: 'GET', p: '/v1/catalog', scope: 'catalog:read', g: 'Public', d: 'The published catalog feed' },
  { m: 'GET', p: '/v1/catalog/changes', scope: 'catalog:read', g: 'Public', d: 'What changed in the feed, for syncing' },
  { m: 'GET', p: '/v1/users', scope: 'users:read', g: 'Public', d: 'The public member directory' },
  { m: 'GET', p: '/v1/users/me', scope: 'users:read', g: 'Public', d: 'One public profile — swap `me` for any id' },

  // You
  { m: 'GET', p: '/v1/account', scope: 'account:read', g: 'Your account', d: 'Who the key belongs to' },
  { m: 'PATCH', p: '/v1/account', scope: 'account:write', g: 'Your account', d: 'Change your display name or bio', write: true, body: '{\n  "displayName": "New name"\n}' },
  { m: 'GET', p: '/v1/notifications', scope: 'notifications:read', g: 'Your account', d: 'Your notifications' },
  { m: 'POST', p: '/v1/notifications/read-all', scope: 'notifications:write', g: 'Your account', d: 'Mark everything read', write: true },
  { m: 'GET', p: '/v1/favorites', scope: 'favorites:read', g: 'Your account', d: 'Repos and catalogs you starred' },
  { m: 'GET', p: '/v1/payments', scope: 'payments:read', g: 'Your account', d: 'Your invoices — amounts and dates, never a card number' },
  { m: 'GET', p: '/v1/transfers', scope: 'transfers:read', g: 'Your account', d: 'Ownership transfers in either direction' },

  // Your content
  { m: 'GET', p: '/v1/repos', scope: 'repos:read', g: 'Your content', d: 'Your Server-Repos' },
  { m: 'GET', p: '/v1/repos/ID/files', scope: 'repos:read', g: 'Your content', d: 'One repo\u2019s file list — replace ID' },
  { m: 'GET', p: '/v1/repos/ID/changes', scope: 'repos:read', g: 'Your content', d: 'What changed in a repo — replace ID' },
  { m: 'GET', p: '/v1/catalogs', scope: 'catalogs:read', g: 'Your content', d: 'Catalogs you own, unpublished ones included' },
  { m: 'GET', p: '/v1/catalogs/ID/items', scope: 'catalogs:read', g: 'Your content', d: 'What is inside one — replace ID' },
  { m: 'GET', p: '/v1/pools', scope: 'pools:read', g: 'Your content', d: 'Storage pools and what draws from them' },

  // Polls
  { m: 'GET', p: '/v1/polls', scope: 'polls:read', g: 'Polls', d: 'Polls open to you, and how you answered' },
  { m: 'POST', p: '/v1/polls/ID/vote', scope: 'polls:write', g: 'Polls', d: 'Answer one — replace ID', write: true, body: '{\n  "optionId": "…"\n}' },
];

// The same call, as code you can paste into a project.
//
// The gap this closes is the one where people give up: "it worked in the console" and "it
// works in my code" are separated by an hour of guessing at header names. The key is NEVER
// interpolated — the snippet reads it from the environment, because a snippet with a live
// credential in it is a snippet that ends up in a commit.
const LANGS = ['curl', 'fetch', 'python'];

function snippetFor(lang, { method, path, body, sandbox, write }) {
  const url = `https://bettercommunity.app/api${path}`;
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
        <Send size={15} className="text-[var(--primary-2)]" /> {t('dev.console.title', 'Try a call')}
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
            placeholder={t('dev.console.filter', 'Filter — path, description or scope')} />
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
                  className={`w-full text-left px-2.5 py-2 flex items-start gap-2 hover:bg-[var(--surface-2)] ${i === idx ? 'bg-[var(--surface-2)]' : ''}`}>
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
            : t('dev.console.noauth', 'Public — no key required.')}
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
            <label className="flex items-start gap-2 text-[12px] rounded-lg border border-[var(--line)] bg-[var(--surface-2)]/40 p-2.5">
              <input type="checkbox" className="mt-0.5" checked={sandbox} onChange={(e) => setSandbox(e.target.checked)} />
              <span>
                <b className="flex items-center gap-1.5"><FlaskConical size={12} /> {t('dev.console.sandbox', 'Sandbox')}</b>
                <span className="text-[var(--muted)]">{t('dev.console.sandbox.h', 'Your key is authenticated and the scope is checked, then nothing is written. Untick to make this call for real — it will change your data.')}</span>
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
            <div className="inline-flex rounded-[10px] bg-[var(--surface-2)] p-0.5 ml-auto">
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
          <p className="text-[11px] text-[var(--muted)] mt-1">{t('dev.snip.h', 'The key is read from BCW_KEY in your environment — a snippet with a live credential in it is a snippet that ends up in a commit.')}</p>
        </div>
      </div>

      {res && (
        <div className="mt-3">
          <div className="flex items-center gap-2 text-[12px] mb-1">
            <Badge tone={tone(res.status)}>{res.status || t('dev.console.nonet', 'no response')}</Badge>
            <span className="text-[var(--faint)]">{res.ms} ms</span>
            {ep.write && sandbox && <Badge>{t('dev.console.sandbox', 'Sandbox')}</Badge>}
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => { copyText(res.body); toast.success(t('common.copied', 'Copied.')); }}><Copy size={12} /></Button>
          </div>
          <pre className="text-[11px] font-mono whitespace-pre-wrap break-all bg-[var(--surface-2)] rounded-lg p-3 max-h-72 overflow-auto">{res.body}</pre>
          {res.status === 403 && (
            <p className="text-[11px] text-warning mt-1">
              {t('dev.console.403', 'The key authenticated but does not carry the scope this endpoint needs — add it to the key in your profile.')}
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
    body: 'Try any call against the real API, check a catalog feed before you publish it, and see what your keys have been doing — refusals included.',
    // Named and linked, not summarised. Five tools live behind this card and the only way to
    // learn which was to open it — the same discoverability gap that hid a working Switch step
    // and a whole catalogue type elsewhere in this project.
    chips: [
      { to: '/dev/tools#try', labelKey: 'dev.console.title', label: 'Try a call' },
      { to: '/dev/tools#validate', labelKey: 'dvt.val', label: 'Check a catalog feed' },
      { to: '/dev/tools#deeplink', labelKey: 'dvt.dl.title', label: 'Build a bmm:// link' },
      { to: '/dev/tools#signature', labelKey: 'dvt.sig.title', label: 'Check a webhook signature' },
      { to: '/dev/tools#calls', labelKey: 'dvt.calls', label: 'What your keys did' },
    ],
  },
  {
    id: 'config', icon: 'sliders', to: '/dev/config', ctaKey: 'dev.hub.open',
    titleKey: 'dev.hub.config', title: 'Credentials',
    bodyKey: 'dev.hub.config.s',
    body: 'Your API keys and the apps you have registered, in one place. Creating or deleting a key asks for your 2FA code if you have one.',
  },
  {
    id: 'sso', icon: 'shield', to: '/docs/sso', ctaKey: 'dev.hub.ssodoc',
    titleKey: 'dev.hub.sso', title: 'Sign in with BetterCommunity',
    bodyKey: 'dev.hub.sso.s',
    body: 'Standard OpenID Connect. Register an app, point your library at the discovery document, and you are done — there is no in-house SDK to install.',
  },
  {
    id: 'docs', icon: 'book-open', to: '/docs', ctaKey: 'dev.hub.open',
    titleKey: 'dev.hub.docs', title: 'Docs',
    bodyKey: 'dev.hub.docs.s',
    body: 'The API reference, the plugin API, and the format of catalogs and repositories.',
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

function Tool({ icon: Icon, title, children, to, cta }) {
  return (
    <Card className="p-5 flex flex-col">
      <div className="text-sm font-semibold mb-1 flex items-center gap-2"><Icon size={15} className="text-[var(--primary-2)]" /> {title}</div>
      <p className="text-[12px] text-[var(--muted)] flex-1">{children}</p>
      {to && <Link to={to} className="mt-3"><Button size="sm" variant="primary">{cta} <ArrowRight size={13} /></Button></Link>}
    </Card>
  );
}

export default function DevHub() {
  const { t } = useI18n(); const toast = useToast();
  const { user } = useAuth();
  const [scopes, setScopes] = useState(null);
  const base = typeof location !== 'undefined' ? location.origin : '';
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
  const cards = devCards(cfg, t);

  const loadScopes = async () => {
    if (scopes) return setScopes(null);
    try { setScopes((await api.get('/v1/scopes')).scopes); }
    catch { toast.error(t('common.failed', 'Failed.')); }
  };

  return (
    <div className="max-w-5xl mx-auto py-8 sm:py-12">
      {/* The hero says what you can build, not what we have built. A developer landing that
          opens with a feature list is a brochure; the question people arrive with is "can I
          do the thing I came to do, and how long will it take". */}
      <div className="text-center max-w-2xl mx-auto mb-8 sm:mb-12">
        <span className="inline-grid place-items-center w-14 h-14 rounded-2xl bg-gradient-to-br from-brand to-brand-2 text-white shadow-lg shadow-orange-500/25 mb-4"><Code2 size={26} /></span>
        <h1 className="text-3xl sm:text-4xl font-extrabold leading-tight">
          {hero.title || <>{t('dev.hub.h1a', 'Build on')} <span className="gradient-text">BetterCommunity</span></>}
        </h1>
        <p className="text-[var(--muted)] mt-3 text-base sm:text-lg">
          {hero.body || t('dev.hub.h1b', 'Sign people in with their account, read their content with their permission, and get told when it changes. A REST API, OpenID Connect, and webhooks — no SDK to install.')}
        </p>
        <div className="flex flex-wrap gap-2 justify-center mt-6">
          <Link to="/dev/config"><Button variant="primary"><KeyRound size={15} /> {t('dev.hub.start', 'Get a key')}</Button></Link>
          <Link to="/docs/bcweb-api"><Button><BookOpen size={15} /> {t('dev.hub.ref', 'API reference')}</Button></Link>
        </div>
        {/* Said once, at the top, because it is the number that decides whether somebody
            starts today or bookmarks the page. */}
        <p className="text-[12px] text-[var(--faint)] mt-4">
          {hero.note || t('dev.hub.time', 'A key takes about a minute. Nothing here needs approval.')}
        </p>
      </div>

      {/* The two jobs, before the tools — picking the wrong one is the mistake that costs a
          day, and it is not obvious from the names. Removable from Projects config. */}
      {show.jobs !== false && <div className="grid sm:grid-cols-2 gap-4 mb-8">
        <Card className="p-5">
          <div className="flex items-center gap-2 mb-1"><KeyRound size={16} className="text-[var(--primary-2)]" />
            <span className="font-semibold text-[15px]">{t('dev.hub.jobkey', 'Your program acts as YOU')}</span></div>
          <p className="text-[13px] text-[var(--muted)]">{t('dev.hub.jobkey.s', 'A script, a sync job, a bot you run. Use an API key: scoped, personal, nobody else’s consent involved.')}</p>
          <div className="flex flex-wrap gap-1.5 mt-3">
            {['API keys', 'Test keys', 'Webhooks'].map((x) => <span key={x} className="text-[10px] px-1.5 py-0.5 rounded-md bg-[var(--surface-2)] border border-[var(--line)] text-[var(--muted)]">{x}</span>)}
          </div>
        </Card>
        <Card className="p-5">
          <div className="flex items-center gap-2 mb-1"><Shield size={16} className="text-[var(--primary-2)]" />
            <span className="font-semibold text-[15px]">{t('dev.hub.jobsso', 'Your app acts for OTHER people')}</span></div>
          <p className="text-[13px] text-[var(--muted)]">{t('dev.hub.jobsso.s', 'Anything with its own users. Use Sign in with BetterCommunity: they authorise it, and you never touch their password.')}</p>
          <div className="flex flex-wrap gap-1.5 mt-3">
            {['OpenID Connect', 'PKCE', 'URL generator'].map((x) => <span key={x} className="text-[10px] px-1.5 py-0.5 rounded-md bg-[var(--surface-2)] border border-[var(--line)] text-[var(--muted)]">{x}</span>)}
          </div>
        </Card>
      </div>}

      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--faint)] mb-2">{hero.toolsTitle || t('dev.hub.toolsh', 'Everything here')}</h2>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {cards.map((c) => (
          <Tool key={c.key} icon={(props) => <IconGlyph name={c.icon} {...props} />} title={c.title} to={c.to} cta={c.cta}>
            {c.body}
            {c.chips && (
              <span className="flex flex-wrap gap-1.5 mt-2">
                {c.chips.map((ch, i) => (
                  <Link key={i} to={ch.to || '#'}
                    className="text-[11px] px-2 py-0.5 rounded-full border border-[var(--line)] text-[var(--muted)] hover:text-[var(--text)] hover:border-[var(--primary)] transition">
                    {ch.labelKey ? t(ch.labelKey, ch.label || '') : (ch.label || '')}
                  </Link>
                ))}
              </span>
            )}
          </Tool>
        ))}
      </div>

      <Card className="p-4 mt-4">
        <div className="text-[11px] uppercase tracking-wider text-[var(--faint)] mb-1.5">{t('dev.hub.discovery', 'Discovery')}</div>
        <code className="block text-[11px] font-mono break-all bg-[var(--surface-2)] rounded p-2">{base}/.well-known/openid-configuration</code>
        <div className="flex flex-wrap gap-2 mt-3">
          <Button size="sm" variant="ghost" onClick={loadScopes}>{scopes ? t('common.close', 'Close') : t('dev.hub.scopes', 'What the scopes mean')}</Button>
          <Link to="/blog?project=developers"><Button size="sm" variant="ghost"><Newspaper size={13} /> {t('dev.hub.blog', 'Developer blog')}</Button></Link>
          <Link to="/dev/config"><Button size="sm" variant="ghost"><KeyRound size={13} /> {t('dev.hub.mykeys', 'My keys')}</Button></Link>
        </div>
        {scopes && (
          <div className="mt-3 space-y-1">
            {Object.entries(scopes).map(([k, v]) => (
              <div key={k} className="text-[11px]"><code className="font-mono text-[var(--primary-2)]">{k}</code> — <span className="text-[var(--muted)]">{v}</span></div>
            ))}
          </div>
        )}
      </Card>



      {!user && (
        <p className="text-[11px] text-[var(--muted)] mt-4">
          {t('dev.hub.signin', 'Registering an app or minting a key needs an account — everything else on this page works signed out.')}
        </p>
      )}
    </div>
  );
}

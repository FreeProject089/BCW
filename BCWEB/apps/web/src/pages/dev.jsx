import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Code2, Shield, KeyRound, BookOpen, Send, Newspaper, Copy, Sliders, FlaskConical, ArrowRight } from 'lucide-react';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { Card, Button, Input, Select, Textarea, Badge, Field, Spinner, useToast, copyText } from '../ui/ui.jsx';
import { useAuth } from './auth.jsx';

// /dev — the front door for anybody building against BetterCommunity.
//
// A landing page rather than a control panel: what can be built, what each tool is FOR, and
// one link per tool. The things you configure live at /dev/config, and the things you read
// live in the docs; this page exists so that neither has to be discovered by accident.

// Every endpoint the console can call, so the field is a choice rather than a guess at a
// path. Kept in step with the API by hand — a dropdown listing a route that does not exist
// is worse than a free-text box, so each entry here was checked against the router.
const ENDPOINTS = [
  { m: 'GET', p: '/v1/account', scope: 'account:read', d: 'Who the key belongs to' },
  { m: 'GET', p: '/v1/repos', scope: 'repos:read', d: 'Your Server-Repos' },
  { m: 'GET', p: '/v1/pools', scope: 'pools:read', d: 'Storage pools and what draws from them' },
  { m: 'GET', p: '/v1/catalogs', scope: 'catalogs:read', d: 'Catalogs you own, hidden ones included' },
  { m: 'GET', p: '/v1/catalog', scope: 'catalog:read', d: 'The published catalog feed' },
  { m: 'GET', p: '/v1/favorites', scope: 'favorites:read', d: 'Repos and catalogs you starred' },
  { m: 'GET', p: '/v1/payments', scope: 'payments:read', d: 'Your invoices' },
  { m: 'GET', p: '/v1/polls', scope: 'polls:read', d: 'Polls open to you' },
  { m: 'GET', p: '/v1/transfers', scope: 'transfers:read', d: 'Ownership transfers in either direction' },
  { m: 'GET', p: '/v1/notifications', scope: 'notifications:read', d: 'Your notifications' },
  { m: 'GET', p: '/v1/users', scope: 'users:read', d: 'The public user directory' },
  { m: 'GET', p: '/v1/scopes', scope: null, d: 'The scope catalogue (no key needed)' },
  { m: 'POST', p: '/v1/notifications/read-all', scope: 'notifications:write', d: 'Mark everything read', write: true },
  { m: 'PATCH', p: '/v1/account', scope: 'account:write', d: 'Change your display name or bio', write: true, body: '{\n  "displayName": "New name"\n}' },
];

function ApiConsole() {
  const { t } = useI18n(); const toast = useToast();
  const [key, setKey] = useState('');
  const [idx, setIdx] = useState(0);
  const [body, setBody] = useState('');
  const [sandbox, setSandbox] = useState(true);
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);

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
          <Select value={String(idx)} onChange={(e) => pick(Number(e.target.value))}>
            {ENDPOINTS.map((e, i) => (
              <option key={e.m + e.p} value={i}>{e.m} {e.p} — {e.d}</option>
            ))}
          </Select>
        </Field>
        <div className="text-[11px] text-[var(--faint)]">
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

  const loadScopes = async () => {
    if (scopes) return setScopes(null);
    try { setScopes((await api.get('/v1/scopes')).scopes); }
    catch { toast.error(t('common.failed', 'Failed.')); }
  };

  return (
    <div className="max-w-4xl mx-auto py-8">
      <div className="flex items-center gap-3 mb-2">
        <span className="grid place-items-center w-11 h-11 rounded-xl bg-gradient-to-br from-brand to-brand-2 text-white shadow-lg shadow-orange-500/20"><Code2 size={22} /></span>
        <div>
          <h1 className="text-2xl font-bold leading-tight">{t('dev.hub.title', 'Developers')}</h1>
          <p className="text-sm text-[var(--muted)]">{t('dev.hub.sub', 'Build against BetterCommunity: sign people in with their account, or read their data with their permission.')}</p>
        </div>
      </div>

      {/* The two jobs, stated before the tools — picking the wrong one is the mistake that
          costs a day, and it is not obvious from the names. */}
      <Card className="p-4 mb-5 bg-gradient-to-r from-[var(--primary)]/10 to-transparent">
        <div className="grid sm:grid-cols-2 gap-4 text-[12px]">
          <div>
            <div className="font-semibold text-[13px] mb-0.5">{t('dev.hub.jobkey', 'Your program acts as YOU')}</div>
            <span className="text-[var(--muted)]">{t('dev.hub.jobkey.s', 'A script, a sync job, a bot you run. Use an API key: scoped, personal, nobody else’s consent involved.')}</span>
          </div>
          <div>
            <div className="font-semibold text-[13px] mb-0.5">{t('dev.hub.jobsso', 'Your app acts for OTHER people')}</div>
            <span className="text-[var(--muted)]">{t('dev.hub.jobsso.s', 'Anything with its own users. Use Sign in with BetterCommunity: they authorise it, and you never touch their password.')}</span>
          </div>
        </div>
      </Card>

      <div className="grid sm:grid-cols-3 gap-4">
        <Tool icon={Sliders} title={t('dev.hub.config', 'Credentials')} to="/dev/config" cta={t('dev.hub.open', 'Open')}>
          {t('dev.hub.config.s', 'Your API keys and your registered apps, in one place. Creating or deleting a key asks for your 2FA code when you have it.')}
        </Tool>
        <Tool icon={Shield} title={t('dev.hub.sso', 'Sign in with BetterCommunity')} to="/docs/sso" cta={t('dev.hub.ssodoc', 'Read the guide')}>
          {t('dev.hub.sso.s', 'Standard OpenID Connect. Register an app, point your library at the discovery document, and you are done — there is no SDK of ours to install.')}
        </Tool>
        <Tool icon={BookOpen} title={t('dev.hub.docs', 'Docs')} to="/docs" cta={t('dev.hub.open', 'Open')}>
          {t('dev.hub.docs.s', 'The API reference, the plugin API, and how catalogs and repos are formatted.')}
        </Tool>
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

      <div className="mt-4"><ApiConsole /></div>

      {!user && (
        <p className="text-[11px] text-[var(--muted)] mt-4">
          {t('dev.hub.signin', 'Registering an app or minting a key needs an account — everything else on this page works signed out.')}
        </p>
      )}
    </div>
  );
}

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Code2, Shield, KeyRound, BookOpen, Send, Newspaper, Copy } from 'lucide-react';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { Card, Button, Input, Select, Textarea, Badge, Field, Spinner, useToast, copyText } from '../ui/ui.jsx';
import { useAuth } from './auth.jsx';

// /dev — the developer side of BetterCommunity.
//
// It exists because the pieces were already there and scattered: OAuth clients live in the
// profile next to your avatar, API keys next to those, the scope list only in a guide, and
// nothing anywhere lets you try a call. Somebody building against this site had to know
// four places to look.
//
// Deliberately a hub rather than a fifth place to configure things: what can be edited is
// still edited where it lives, and this page links there. What it ADDS is the thing that
// had no home — a console that makes a real call with your real key and shows you the real
// answer.

const SNIPPET = (base) => `# 1. mint a key in your profile, then:
curl -H "Authorization: Bearer $BCW_KEY" ${base}/api/v1/account

# OpenID Connect discovery — everything else follows from this document
curl ${base}/.well-known/openid-configuration`;

function ApiConsole() {
  const { t } = useI18n(); const toast = useToast();
  const [key, setKey] = useState('');
  const [method, setMethod] = useState('GET');
  const [path, setPath] = useState('/v1/account');
  const [body, setBody] = useState('');
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);

  const send = async () => {
    if (!key.trim()) return toast.error(t('dev.console.needkey', 'Paste one of your API keys first.'));
    if (!path.startsWith('/v1/')) return toast.error(t('dev.console.v1', 'Only /v1/ paths — this console speaks to the public API, not to the site’s own endpoints.'));
    setBusy(true); setRes(null);
    const started = performance.now();
    try {
      // fetch directly rather than through lib/api: the whole point is to send YOUR key and
      // show exactly what came back, including the failures. Going through the wrapper would
      // attach the session cookie and turn a 401 into a success.
      const r = await fetch(`/api${path}`, {
        method,
        headers: { Authorization: `Bearer ${key.trim()}`, ...(body.trim() ? { 'Content-Type': 'application/json' } : {}) },
        body: method === 'GET' ? undefined : (body.trim() || undefined),
        credentials: 'omit',
      });
      const text = await r.text();
      let pretty = text;
      try { pretty = JSON.stringify(JSON.parse(text), null, 2); } catch { /* not JSON — show it raw */ }
      setRes({ status: r.status, ms: Math.round(performance.now() - started), body: pretty, scopes: r.headers.get('x-required-scope') });
    } catch (e) {
      setRes({ status: 0, ms: Math.round(performance.now() - started), body: String(e?.message || e) });
    } finally { setBusy(false); }
  };

  const tone = (s) => (s === 0 ? 'red' : s >= 500 ? 'red' : s >= 400 ? 'amber' : 'green');

  return (
    <Card className="p-5">
      <div className="text-sm font-semibold mb-1 flex items-center gap-2">
        <Send size={15} className="text-[var(--primary-2)]" /> {t('dev.console.title', 'Try a call')}
      </div>
      <p className="text-[12px] text-[var(--muted)] mb-3">
        {t('dev.console.sub', 'Sends a real request with a real key and shows you exactly what comes back — including the refusals, which are the half worth seeing. Your key is used in the browser and never sent anywhere but the API itself.')}
      </p>
      <div className="space-y-2">
        <Field label={t('dev.console.key', 'Your API key')}>
          <Input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="bck_…" autoComplete="off" />
        </Field>
        <div className="flex gap-2">
          <Select className="!w-28" value={method} onChange={(e) => setMethod(e.target.value)}>
            {['GET', 'POST', 'PATCH', 'DELETE'].map((m) => <option key={m}>{m}</option>)}
          </Select>
          <Input className="flex-1" value={path} onChange={(e) => setPath(e.target.value)} placeholder="/v1/account" />
          <Button variant="primary" disabled={busy} onClick={send}>{busy ? <Spinner /> : t('dev.console.send', 'Send')}</Button>
        </div>
        {method !== 'GET' && (
          <Field label={t('dev.console.body', 'JSON body (optional)')}>
            <Textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder='{"optionIds":["…"]}' />
          </Field>
        )}
      </div>

      {res && (
        <div className="mt-3">
          <div className="flex items-center gap-2 text-[12px] mb-1">
            <Badge tone={tone(res.status)}>{res.status || t('dev.console.nonet', 'no response')}</Badge>
            <span className="text-[var(--faint)]">{res.ms} ms</span>
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
    <div className="max-w-3xl mx-auto py-8">
      <div className="flex items-center gap-3 mb-1">
        <span className="grid place-items-center w-10 h-10 rounded-xl bg-[var(--surface-2)] border border-[var(--line)]"><Code2 size={20} className="text-[var(--primary-2)]" /></span>
        <div>
          <h1 className="text-2xl font-bold">{t('dev.hub.title', 'Developers')}</h1>
          <p className="text-sm text-[var(--muted)]">{t('dev.hub.sub', 'Build against BetterCommunity: sign people in with their account, or read their data with their permission.')}</p>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-4 mt-6">
        <Card className="p-5">
          <div className="text-sm font-semibold mb-1 flex items-center gap-2"><Shield size={15} className="text-[var(--primary-2)]" /> {t('dev.hub.sso', 'Sign in with BetterCommunity')}</div>
          <p className="text-[12px] text-[var(--muted)] mb-3">
            {t('dev.hub.sso.s', 'Standard OpenID Connect. Register an app, point your library at the discovery document, and you are done — there is no SDK of ours to install.')}
          </p>
          <code className="block text-[10px] font-mono break-all bg-[var(--surface-2)] rounded p-2 mb-2">{base}/.well-known/openid-configuration</code>
          <div className="flex flex-wrap gap-2">
            {/* The apps themselves are still managed in the profile: this page links to
                where a thing lives rather than becoming a second place to edit it. */}
            <Link to="/profile"><Button size="sm" variant="primary">{t('dev.hub.myapps', 'My apps')}</Button></Link>
            <Link to="/docs/sso"><Button size="sm" variant="ghost"><BookOpen size={13} /> {t('dev.hub.ssodoc', 'Read the guide')}</Button></Link>
          </div>
        </Card>

        <Card className="p-5">
          <div className="text-sm font-semibold mb-1 flex items-center gap-2"><KeyRound size={15} className="text-[var(--primary-2)]" /> {t('dev.hub.api', 'The public API')}</div>
          <p className="text-[12px] text-[var(--muted)] mb-3">
            {t('dev.hub.api.s', 'A key is scoped: it can do exactly what you ticked and nothing else. Keys are yours alone — an app that acts for OTHER people wants SSO, not a key.')}
          </p>
          <div className="flex flex-wrap gap-2">
            <Link to="/profile"><Button size="sm" variant="primary">{t('dev.hub.mykeys', 'My keys')}</Button></Link>
            <Button size="sm" variant="ghost" onClick={loadScopes}>{scopes ? t('common.close', 'Close') : t('dev.hub.scopes', 'What the scopes mean')}</Button>
          </div>
          {scopes && (
            <div className="mt-3 space-y-1">
              {Object.entries(scopes).map(([k, v]) => (
                <div key={k} className="text-[11px]"><code className="font-mono text-[var(--primary-2)]">{k}</code> — <span className="text-[var(--muted)]">{v}</span></div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="mt-4"><ApiConsole /></div>

      <Card className="p-5 mt-4">
        <div className="text-sm font-semibold mb-2">{t('dev.hub.start', 'Start here')}</div>
        <pre className="text-[11px] font-mono whitespace-pre-wrap bg-[var(--surface-2)] rounded-lg p-3">{SNIPPET(base)}</pre>
        <div className="flex flex-wrap gap-2 mt-3">
          <Button size="sm" variant="ghost" onClick={() => { copyText(SNIPPET(base)); toast.success(t('common.copied', 'Copied.')); }}><Copy size={13} /> {t('common.copy', 'Copy')}</Button>
          <Link to="/blog?project=developers"><Button size="sm" variant="ghost"><Newspaper size={13} /> {t('dev.hub.blog', 'Developer blog')}</Button></Link>
          <Link to="/docs"><Button size="sm" variant="ghost"><BookOpen size={13} /> {t('dev.hub.docs', 'Docs')}</Button></Link>
        </div>
        {!user && (
          <p className="text-[11px] text-[var(--muted)] mt-3">
            {t('dev.hub.signin', 'Registering an app or minting a key needs an account — everything else on this page works signed out.')}
          </p>
        )}
      </Card>
    </div>
  );
}

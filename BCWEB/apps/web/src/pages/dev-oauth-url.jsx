import { useState, useMemo } from 'react';
import { Link2, Copy, ExternalLink, Check } from 'lucide-react';
import { useI18n } from '../i18n.jsx';
import { Card, Button, Input, Select, Field, useToast, copyText } from '../ui/ui.jsx';

// The OAuth2 URL generator.
//
// Building an authorize URL by hand is where every OIDC integration loses its first hour:
// six parameters, two of them derived, one of them (PKCE) requiring a SHA-256 you cannot do
// in your head. Getting it wrong produces a redirect with an error code in the query string,
// which is the least helpful place an error has ever been put.
//
// So: pick the app, tick the scopes, get the URL — and get the PKCE pair generated here, in
// the browser, with the verifier shown so it can be stored where the callback will need it.

const RESPONSE_TYPES = [
  ['code', 'Authorization code — what almost everything should use'],
  ['code id_token', 'Code + id_token (hybrid) — only if your library asks for it'],
];

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function pkcePair() {
  // 32 random bytes → verifier; SHA-256 → challenge. Generated in the page and never sent:
  // the verifier is the half that proves the callback belongs to whoever started the flow.
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const verifier = b64url(bytes.buffer);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: b64url(digest) };
}

export default function OAuthUrlBuilder({ clients = [], scopes = [] }) {
  const { t } = useI18n(); const toast = useToast();
  const [clientId, setClientId] = useState(clients[0]?.id || '');
  const [redirect, setRedirect] = useState(clients[0]?.redirectUris?.[0] || '');
  const [picked, setPicked] = useState(['openid', 'profile']);
  const [responseType, setResponseType] = useState('code');
  const [pkce, setPkce] = useState(null);
  const [state, setState] = useState('');

  const client = clients.find((c) => c.id === clientId);
  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  const url = useMemo(() => {
    if (!clientId || !redirect) return '';
    const q = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirect,
      response_type: responseType,
      scope: picked.join(' '),
    });
    if (state) q.set('state', state);
    if (pkce) { q.set('code_challenge', pkce.challenge); q.set('code_challenge_method', 'S256'); }
    return `${origin}/api/oauth2/authorize?${q.toString()}`;
  }, [clientId, redirect, responseType, picked, state, pkce, origin]);

  // A public client MUST use PKCE — the provider refuses it otherwise, and saying so here is
  // cheaper than letting somebody discover it from a redirect query string.
  const needsPkce = client && client.confidential === false;

  return (
    <Card className="p-5">
      <div className="text-sm font-semibold flex items-center gap-2"><Link2 size={15} className="text-[var(--primary-2)]" /> {t('ourl.title', 'OAuth2 URL generator')}</div>
      <p className="text-xs text-[var(--muted)] mt-0.5 mb-3">
        {t('ourl.sub', 'Build the authorize URL without guessing at parameter names. Getting one wrong sends the error to your redirect as a query string, which is the least useful place to find it.')}
      </p>

      {!clients.length ? (
        <p className="text-[13px] text-[var(--muted)]">{t('ourl.noapp', 'Register an app first — the generator needs its client id and a redirect URI.')}</p>
      ) : (<>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label={t('ourl.app', 'App')}>
            <Select value={clientId} onChange={(e) => { setClientId(e.target.value); const c = clients.find((x) => x.id === e.target.value); setRedirect(c?.redirectUris?.[0] || ''); }}>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label={t('ourl.redirect', 'Redirect URI')} hint={t('ourl.redirect.h', 'Must match one you registered, exactly.')}>
            {client?.redirectUris?.length > 1
              ? <Select value={redirect} onChange={(e) => setRedirect(e.target.value)}>{client.redirectUris.map((u) => <option key={u} value={u}>{u}</option>)}</Select>
              : <Input value={redirect} onChange={(e) => setRedirect(e.target.value)} />}
          </Field>
        </div>

        <Field label={t('ourl.scopes', 'What to ask them for')} hint={t('ourl.scopes.h', 'Every scope is a line on the consent screen. Ask for what you use — a long list is where people press cancel.')}>
          <div className="flex flex-wrap gap-1.5">
            {scopes.map((sc) => {
              const on = picked.includes(sc);
              // openid is what makes this OIDC rather than bare OAuth2, so it cannot be
              // unticked — a flow without it returns no id_token and no user.
              const locked = sc === 'openid';
              return (
                <button key={sc} type="button" disabled={locked}
                  onClick={() => setPicked((v) => (on ? v.filter((x) => x !== sc) : [...v, sc]))}
                  className={`text-[11px] font-mono px-2 py-1 rounded-lg border transition ${on ? 'bg-[var(--primary)]/15 border-[var(--primary)]/40 text-[var(--primary-2)]' : 'bg-[var(--surface-2)] border-[var(--line)] text-[var(--muted)] hover:border-[var(--ring)]'} ${locked ? 'opacity-70 cursor-default' : ''}`}>
                  {on && <Check size={10} className="inline mr-1" />}{sc}
                </button>
              );
            })}
          </div>
        </Field>

        <div className="grid sm:grid-cols-2 gap-3">
          <Field label={t('ourl.rt', 'Response type')}>
            <Select value={responseType} onChange={(e) => setResponseType(e.target.value)}>
              {RESPONSE_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          </Field>
          <Field label={t('ourl.state', 'state (optional)')} hint={t('ourl.state.h', 'Echoed back untouched. Use it to carry where the user was going.')}>
            <Input value={state} onChange={(e) => setState(e.target.value)} placeholder="abc123" />
          </Field>
        </div>

        <div className={`rounded-lg border p-3 mt-1 ${needsPkce && !pkce ? 'border-warning/50 bg-warning/10' : 'border-[var(--line)] bg-[var(--surface-2)]/40'}`}>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[12px] font-semibold">PKCE</span>
            {needsPkce && <span className="text-[11px] text-warning">{t('ourl.pkce.req', 'required — this app is a public client')}</span>}
            <Button size="sm" variant="ghost" className="ml-auto" onClick={async () => setPkce(await pkcePair())}>
              {pkce ? t('ourl.pkce.again', 'Generate another') : t('ourl.pkce.gen', 'Generate a pair')}
            </Button>
          </div>
          {pkce ? (
            <div className="mt-2 space-y-1 text-[11px] font-mono">
              <div className="break-all"><span className="text-[var(--faint)]">verifier </span>{pkce.verifier}</div>
              <div className="break-all"><span className="text-[var(--faint)]">challenge </span>{pkce.challenge}</div>
              <p className="font-sans text-[11px] text-[var(--muted)]">
                {t('ourl.pkce.h', 'Keep the verifier where your callback can read it — you send it at the token step, and it is the only thing proving the callback belongs to whoever started the flow. The challenge is what goes in the URL.')}
              </p>
            </div>
          ) : (
            <p className="text-[11px] text-[var(--muted)] mt-1">{t('ourl.pkce.s', 'Generated here, in your browser. Nothing is sent to us.')}</p>
          )}
        </div>

        <div className="mt-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--faint)]">{t('ourl.result', 'Your authorize URL')}</span>
            <Button size="sm" variant="ghost" className="ml-auto" disabled={!url} onClick={() => { copyText(url); toast.success(t('common.copied', 'Copied.')); }}><Copy size={12} /></Button>
            {/* Opening it really starts a flow against the real provider — which is the point,
                and also why it is a link the person chooses rather than a preview. */}
            <a href={url || '#'} target="_blank" rel="noreferrer" className={`text-[11px] text-[var(--primary-2)] hover:underline inline-flex items-center gap-1 ${url ? '' : 'pointer-events-none opacity-50'}`}>
              <ExternalLink size={11} /> {t('ourl.try', 'Try it')}
            </a>
          </div>
          <pre className="text-[11px] font-mono whitespace-pre-wrap break-all bg-[var(--surface-2)] rounded-lg p-3 max-h-40 overflow-auto">{url || t('ourl.pick', 'Pick an app and a redirect URI.')}</pre>
        </div>
      </>)}
    </Card>
  );
}

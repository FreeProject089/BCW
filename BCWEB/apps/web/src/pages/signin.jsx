import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ShieldCheck, Ban, Lock, Clock, MessageSquare, Eye, EyeOff } from 'lucide-react';
import { Button, Card, Field, Input, Spinner, useToast } from '../ui/ui.jsx';
import { useI18n } from '../i18n.jsx';
import { useAuth } from './auth.jsx';
import { api } from '../lib/api.js';
import { GoogleIcon, GithubIcon, DiscordIcon } from '../ui/brand.jsx';
import { TotpQuickFill } from './twofa-fill.jsx';

// Local async-fetch helper (same tiny hook duplicated across a few page modules).
function useAsync(fn, deps = []) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);
  const reload = () => { setLoading(true); fn().then((d) => { setData(d); setErr(null); }).catch(setErr).finally(() => setLoading(false)); };
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, deps);
  return { data, err, loading, reload };
}

/* ─────────────────────────  Auth  ───────────────────────── */
const OAUTH_ERRORS = {
  bad_state: 'That sign-in link expired — please try again.',
  no_code: 'Sign-in was cancelled.',
  no_email: "We couldn't get a verified email from that account. Try a different sign-in method.",
  token_exchange_failed: 'Sign-in failed — please try again.',
  not_configured: 'That sign-in method isn\'t available right now.',
  unexpected: 'Something went wrong — please try again.',
};

// Password field with a show/hide toggle.
function PwInput({ value, onChange, placeholder = '••••••••' }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input type={show ? 'text' : 'password'} value={value} onChange={onChange} placeholder={placeholder} className="!pr-10" />
      <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--faint)] hover:text-[var(--text)] p-1">
        {show ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}

// Shown on the sign-in page when a suspended/banned account tries to sign in: the
// reason the admin entered, a live countdown for a temporary lock, or a support-appeal
// link for a permanent one. Mirrors the account-moderation gate in the API.
function AccountLockedPanel({ data, onBack }) {
  const { t } = useI18n();
  const banned = data.status === 'banned';
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!data.until) return; const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, [data.until]);
  const remainMs = data.until ? new Date(data.until).getTime() - now : 0;
  const fmtRemain = (ms) => {
    if (ms <= 0) return t('lock.soon', 'any moment now');
    const s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    if (d) return `${d}d ${h}h ${m}m`;
    if (h) return `${h}h ${m}m ${sec}s`;
    if (m) return `${m}m ${sec}s`;
    return `${sec}s`;
  };
  const Ico = banned ? Ban : Lock;
  return (
    <div className="max-w-md mx-auto mt-16">
      <Card className="p-6 text-center" style={{ borderColor: 'var(--error-border)' }}>
        <span className="grid place-items-center w-14 h-14 rounded-2xl mx-auto" style={{ background: 'var(--error-bg)', border: '1px solid var(--error-border)' }}><Ico size={26} style={{ color: 'var(--error)' }} /></span>
        <h1 className="text-xl font-bold mt-4">{banned ? t('lock.banned.title', 'Account banned') : t('lock.susp.title', 'Account suspended')}</h1>
        <p className="text-sm text-[var(--muted)] mt-1.5">{banned ? t('lock.banned.sub', 'Your account has been banned and you can’t sign in.') : t('lock.susp.sub', 'Your account is temporarily suspended.')}</p>
        {data.reason && (
          <div className="mt-4 text-left rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--faint)] mb-1">{t('lock.reason', 'Reason')}</div>
            <div className="text-sm break-words">{data.reason}</div>
          </div>
        )}
        {data.permanent ? (
          <div className="mt-4">
            <div className="text-sm text-[var(--muted)]">{t('lock.perm', 'This is permanent. If you believe it’s a mistake, you can appeal.')}</div>
            <Link to="/contact?ref=appeal"><Button variant="primary" className="mt-3 w-full"><MessageSquare size={15} /> {t('lock.support', 'Contact support')}</Button></Link>
          </div>
        ) : (
          <div className="mt-4 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--faint)] mb-1 flex items-center justify-center gap-1"><Clock size={12} /> {t('lock.liftsin', 'Access returns in')}</div>
            <div className="text-2xl font-bold tabular-nums text-[var(--primary-2)]">{fmtRemain(remainMs)}</div>
            <div className="text-[11px] text-[var(--faint)] mt-1">{new Date(data.until).toLocaleString()}</div>
          </div>
        )}
        <button onClick={onBack} className="text-xs text-[var(--faint)] hover:text-[var(--primary-2)] mt-4">{t('lock.back', '← Back to sign in')}</button>
      </Card>
    </div>
  );
}

export function Auth() {
  const { user, loading: authLoading, login, loginWith2fa, register } = useAuth(); const nav = useNavigate(); const toast = useToast(); const { t, lang } = useI18n();
  const [params, setParams] = useSearchParams();
  const [mode, setMode] = useState('login'); // login | register | forgot | reset
  const [newsletter, setNewsletter] = useState(true); // opt-in pre-checked at sign-up
  const [f, setF] = useState({ email: '', password: '', confirm: '', displayName: '', token: '' });
  const [busy, setBusy] = useState(false); const [step, setStep] = useState('');
  const [twoFa, setTwoFa] = useState(null); // { tempToken } once password is verified and a TOTP code is needed
  const [code, setCode] = useState('');
  const [emailTaken, setEmailTaken] = useState(false); // inline field-level error (register)
  const [lock, setLock] = useState(null); // { status, reason, until, permanent } when the account is suspended/banned
  const nameTouched = useRef(false); // did the user edit the display name themselves?
  // Smart default: derive a friendly display name from the email local-part until the
  // user types their own — one less field to think about at the highest-friction moment.
  const suggestName = (email) => (email.split('@')[0] || '').replace(/[._-]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 40);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const { data: oauthProviders } = useAsync(() => api.get('/auth/oauth/providers').catch(() => ({})), []);

  // Arriving from a password-reset email link (/auth?reset=<token>) → jump straight to
  // the "set a new password" step with the token prefilled.
  useEffect(() => {
    const rtok = params.get('reset');
    if (rtok) { setF((s) => ({ ...s, token: rtok })); setMode('reset'); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Already signed in? There's nothing to do on the auth page — send them to
  // their profile (respecting a ?next= target if one was passed, e.g. from a
  // "sign in to continue" link).
  const justRegistered = useRef(false);
  useEffect(() => {
    if (!user) return;
    // A brand-new account is sent straight to the (optional) 2FA setup; an
    // already-logged-in visitor who just hit /auth goes to their profile / ?next.
    if (justRegistered.current) { nav('/profile?setup2fa=1', { replace: true }); return; }
    const next = params.get('next');
    // `/oauth2/*` is served by the API (OIDC authorize), not an SPA route — do a real
    // navigation so it hits the backend rather than the SPA's not-found.
    if (next && next.startsWith('/oauth2/')) { window.location.href = next; return; }
    nav(next && next.startsWith('/') ? next : '/profile', { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    const err = params.get('oauth_error');
    if (!err) return;
    toast.error(OAUTH_ERRORS[err] || 'Sign-in failed — please try again.');
    setParams((p) => { p.delete('oauth_error'); return p; }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const submitCode = async () => {
    setBusy(true);
    try { await loginWith2fa(twoFa.tempToken, code.trim()); toast.success(t('auth.welcome.toast')); nav('/dashboard'); }
    catch (x) { toast.error(x.data?.error === '2fa_invalid' ? (t('auth.2fa.bad') || 'Invalid code.') : t('auth.err.fail')); }
    finally { setBusy(false); }
  };

  const submit = async (e) => {
    e.preventDefault();
    if ((mode === 'register' || mode === 'reset') && f.password !== f.confirm) return toast.error(t('auth.err.match'));
    if ((mode === 'register' || mode === 'reset') && f.password.length < 8) return toast.error(t('auth.err.short'));
    setBusy(true);
    try {
      if (mode === 'login') {
        const res = await login(f.email, f.password);
        if (res?.twoFactorRequired) { setTwoFa({ tempToken: res.tempToken }); return; }
        toast.success(t('auth.welcome.toast')); nav('/dashboard');
      }
      else if (mode === 'register') {
        setStep('Solving proof-of-work…');
        const { solvePow } = await import('../lib/pow.js');
        const pow = await solvePow(() => api.get('/auth/pow'));
        setStep('Creating account…');
        justRegistered.current = true; // the auth-redirect effect routes new accounts to the 2FA setup
        await register(f.email, f.password, f.displayName, pow);
        // Newsletter opt-in (pre-checked). Fire-and-forget double opt-in — a confirm
        // email is sent; a failure here must never block a successful registration.
        if (newsletter) api.post('/newsletter/subscribe', { email: f.email.trim(), locale: lang === 'fr' ? 'fr' : 'en' }).catch(() => {});
        toast.success(t('auth.welcome.toast'));
        // no nav here — the [user] effect above handles it (→ /profile?setup2fa=1)
      } else if (mode === 'forgot') {
        const res = await api.post('/auth/reset/request', { email: f.email });
        if (res.devToken) { setF((s) => ({ ...s, token: res.devToken })); setMode('reset'); toast.info(t('auth.toast.devtoken', 'Reset token issued (dev). Set a new password.')); }
        else toast.success(t('auth.toast.sent'));
      } else if (mode === 'reset') {
        await api.post('/auth/reset/confirm', { token: f.token, password: f.password });
        toast.success(t('auth.toast.updated')); setMode('login'); setF((s) => ({ ...s, password: '', confirm: '', token: '' }));
      }
    } catch (x) {
      // "Email already exists" is best shown INLINE under the field (with a one-tap
      // path to login), not as a transient toast — the error is about that input.
      if (x.data?.error === 'email_taken') { setEmailTaken(true); }
      // Suspended / banned account → a dedicated panel with the reason + remaining time
      // (or a support link when permanent), instead of a generic error toast.
      else if (x.data?.error === 'account_suspended' || x.data?.error === 'account_banned') { setLock(x.data); }
      else toast.error(x.data?.error === 'invalid_credentials' ? t('auth.err.creds')
        : x.data?.error === 'oauth_only_account' ? t('auth.err.oauthOnly', 'This account was created with GitHub or Discord — use that to sign in, or set a password from your profile once signed in.')
        : x.data?.error === 'invalid_token' ? t('auth.err.token')
        : x.data?.error === 'pow_required' ? t('auth.err.pow') : t('auth.err.fail'));
    } finally { setBusy(false); setStep(''); }
  };

  const titles = { login: [t('auth.welcome'), t('auth.subin')], register: [t('auth.create'), t('auth.subup')], forgot: [t('auth.reset.title'), t('auth.reset.sub')], reset: [t('auth.newpw.title'), t('auth.newpw.sub')] };
  const cta = { login: t('nav.signin'), register: t('auth.create'), forgot: t('auth.sendreset'), reset: t('auth.updatepw') };
  const pw2 = mode === 'register' || mode === 'reset';
  // Live, as-you-type validation — show the problem the instant it's clear (a wrong
  // email format, a too-short password, a mismatch) instead of waiting for submit.
  // Guarded so an empty / barely-started field doesn't nag prematurely.
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const emailBad = mode !== 'reset' && f.email.length > 3 && !emailRe.test(f.email);
  const pwShort = pw2 && f.password.length > 0 && f.password.length < 8;
  const pwMismatch = pw2 && f.confirm.length > 0 && f.confirm !== f.password;

  // Don't flash the login form before we know the auth state. While the session
  // is still resolving (hard load / bookmark), show a neutral spinner; once we
  // know the visitor is signed in, the [user] effect above redirects them to
  // their profile / ?next target, so show a "redirecting" placeholder instead
  // of the full form for a frame.
  if (authLoading) {
    return <div className="max-w-sm mx-auto mt-20 flex justify-center text-[var(--muted)]"><Spinner /></div>;
  }
  if (user) {
    return (
      <div className="max-w-sm mx-auto mt-20 flex flex-col items-center gap-3 text-[var(--muted)]">
        <Spinner />
        <p className="text-sm">{t('auth.redirecting', 'Already signed in — taking you to your profile…')}</p>
      </div>
    );
  }
  if (lock) return <AccountLockedPanel data={lock} onBack={() => setLock(null)} />;

  if (twoFa) {
    return (
      <div className="max-w-sm mx-auto mt-8">
        <Card className="p-7">
          <div className="text-center mb-6"><ShieldCheck size={32} className="mx-auto text-[var(--primary-2)] mb-3" />
            <h1 className="text-xl font-bold">{t('auth.2fa.title') || 'Two-factor code'}</h1>
            <p className="text-sm text-[var(--muted)] mt-1">{t('auth.2fa.sub') || 'Enter the 6-digit code from your authenticator app.'}</p></div>
          <form onSubmit={(e) => { e.preventDefault(); submitCode(); }} className="space-y-3">
            <Field label={t('auth.2fa.code') || 'Code'}><Input value={code} onChange={(e) => setCode(e.target.value.replace(/[^0-9A-Za-z-]/g, '').slice(0, 9))} placeholder="123456" autoFocus /></Field>
            <div className="-mt-1"><TotpQuickFill onFill={(c) => setCode(c)} /></div>
            <Button variant="primary" className="w-full" disabled={busy || code.trim().length < 4}>{busy ? <Spinner /> : (t('auth.2fa.verify') || 'Verify')}</Button>
          </form>
          <div className="mt-4 text-center text-sm"><button className="text-[var(--muted)] hover:text-[var(--text)]" onClick={() => { setTwoFa(null); setCode(''); }}>{t('auth.2fa.back') || 'Back to login'}</button></div>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-sm mx-auto mt-8">
      <Card className="p-7">
        <div className="text-center mb-6"><img src="/logo.png" alt="BC" className="w-12 h-12 rounded-xl mb-3 mx-auto" />
          <h1 className="text-xl font-bold">{titles[mode][0]}</h1>
          <p className="text-sm text-[var(--muted)] mt-1">{titles[mode][1]}</p></div>
        <form onSubmit={submit} className="space-y-3">
          {mode === 'register' && <Field label={t('auth.name')}><Input value={f.displayName} onChange={(e) => { nameTouched.current = true; setF({ ...f, displayName: e.target.value }); }} placeholder={t('auth.name.ph', 'How should we call you?')} /></Field>}
          {mode !== 'reset' && <Field label={t('auth.email')}>
            <Input type="email" value={f.email} aria-invalid={(emailTaken || emailBad) || undefined}
              onChange={(e) => { if (emailTaken) setEmailTaken(false); const email = e.target.value; setF((s) => ({ ...s, email, displayName: (mode === 'register' && !nameTouched.current) ? suggestName(email) : s.displayName })); }} placeholder="you@example.com" />
            {emailTaken ? <div className="text-xs text-[var(--error)] mt-1.5 anim-fade">
                {t('auth.err.taken', 'This email already exists.')}{' '}
                <button type="button" onClick={() => { setEmailTaken(false); setMode('login'); }} className="underline underline-offset-2 font-semibold hover:opacity-80 press-sm">{t('auth.err.taken.login', 'Login instead?')}</button>
              </div>
             : emailBad ? <div className="text-xs text-[var(--error)] mt-1.5 anim-fade">{t('auth.err.emailformat', 'Enter a valid email address.')}</div>
             : null}
          </Field>}
          {mode === 'reset' && <Field label={t('auth.token')}><Input value={f.token} onChange={set('token')} placeholder={t('auth.token.ph')} /></Field>}
          {mode !== 'forgot' && <Field label={pw2 ? t('auth.newpw') : t('auth.password')}>
            <PwInput value={f.password} onChange={set('password')} />
            {pwShort && <div className="text-xs text-[var(--warning)] mt-1.5 anim-fade">{t('auth.err.short', 'Password must be at least 8 characters.')}</div>}
          </Field>}
          {pw2 && <Field label={t('auth.confirmpw')}>
            <PwInput value={f.confirm} onChange={set('confirm')} />
            {pwMismatch && <div className="text-xs text-[var(--error)] mt-1.5 anim-fade">{t('auth.err.match', "Passwords don't match.")}</div>}
          </Field>}
          {mode === 'register' && <label className="flex items-start gap-2.5 text-sm text-[var(--muted)] cursor-pointer select-none pt-1">
            <input type="checkbox" className="mt-0.5" checked={newsletter} onChange={(e) => setNewsletter(e.target.checked)} />
            <span>{t('auth.newsletter', 'Send me BetterCommunity news and blog updates by email.')} <span className="text-[var(--faint)]">{t('auth.newsletter.hint', 'Double opt-in — unsubscribe anytime.')}</span></span>
          </label>}
          <Button variant="primary" className="w-full" disabled={busy}>{busy ? <><Spinner /> {step || '…'}</> : cta[mode]}</Button>
        </form>
        {(mode === 'login' || mode === 'register') && (oauthProviders?.github || oauthProviders?.discord || oauthProviders?.google) && (
          <>
            <div className="flex items-center gap-3 my-4 text-xs text-[var(--faint)]"><div className="flex-1 h-px bg-[var(--line)]" /> {t('auth.or', 'or')} <div className="flex-1 h-px bg-[var(--line)]" /></div>
            <div className="flex flex-col gap-2">
              {oauthProviders.google && <a href="/api/auth/oauth/google/start"><Button className="w-full"><GoogleIcon size={16} /> {t('auth.oauth.google', 'Continue with Google')}</Button></a>}
              {oauthProviders.github && <a href="/api/auth/oauth/github/start"><Button className="w-full"><GithubIcon size={16} /> {t('auth.oauth.github', 'Continue with GitHub')}</Button></a>}
              {oauthProviders.discord && <a href="/api/auth/oauth/discord/start"><Button className="w-full"><DiscordIcon size={16} className="text-[#5865F2]" /> {t('auth.oauth.discord', 'Continue with Discord')}</Button></a>}
            </div>
          </>
        )}
        <div className="mt-4 flex flex-col items-center gap-1.5 text-sm">
          {mode === 'login' && <button className="text-[var(--muted)] hover:text-[var(--text)]" onClick={() => { setEmailTaken(false); setMode('forgot'); }}>{t('auth.forgot')}</button>}
          <button className="text-[var(--muted)] hover:text-[var(--text)]" onClick={() => { setEmailTaken(false); setMode(mode === 'login' ? 'register' : 'login'); }}>
            {mode === 'login' ? t('auth.toRegister') : t('auth.toLogin')}
          </button>
        </div>
      </Card>
    </div>
  );
}

import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BadgeCheck, Lock, Cookie, Palette, Shield, CheckCircle2, XCircle, Eye, Globe, Mail, Orbit, Package, Server, ShieldCheck, Sliders, Sparkles, Users, Undo2 } from 'lucide-react';
import { Button, Card, PageHeader, Select, Spinner, useToast } from '../ui/ui.jsx';
import { fxPref, setFxPref, prefersReducedMotion } from '../lib/fx-pref.js';
import { useI18n } from '../i18n.jsx';
import { useTheme } from '../ui/theme.jsx';
import { useAuth } from './auth.jsx';
import { api } from '../lib/api.js';
import { getGlassPrefs, setGlassPrefs, getOrbTransitionPref, setOrbTransitionPref, getUndoDisabled, setUndoDisabled } from '../lib/prefs.js';
import { getConsent, setConsent } from '../lib/analytics.js';
import { SKIP_KEY } from '../ui/IntroContext.jsx';

/* ─────────────────────────  Settings  ───────────────────────── */
// Device-local preferences (nothing account-bound): appearance, language, the
// intro animation, modal transparency, and the cookie/privacy choice. Everything
// here is a localStorage-backed client preference applied live.
export function Settings() {
  const { t } = useI18n();
  const { theme, toggle: toggleTheme } = useTheme();
  const { lang, setLang } = useI18n();
  const toast = useToast();
  const [skipIntro, setSkipIntro] = useState(() => { try { return localStorage.getItem(SKIP_KEY) === '1'; } catch { return false; } });
  const [consent, setConsentState] = useState(() => getConsent() || 'essential');
  const [glass, setGlass] = useState(() => getGlassPrefs());
  const [orbTransition, setOrbTransition] = useState(() => getOrbTransitionPref());
  const [fx, setFxState] = useState(() => fxPref());
  const [undoOff, setUndoOff] = useState(() => getUndoDisabled());

  const setFx = (v) => { setFxState(v); setFxPref(v); };
  const setIntro = (skip) => { setSkipIntro(skip); try { skip ? localStorage.setItem(SKIP_KEY, '1') : localStorage.removeItem(SKIP_KEY); } catch {} };
  const setOrbTr = (on) => { setOrbTransition(on); setOrbTransitionPref(on); };
  const setCookie = (v) => { setConsentState(v); setConsent(v); toast.success(t('set.saved', 'Saved.')); };
  const applyGlass = (next) => { setGlass(next); setGlassPrefs(next); };
  const setUndo = (off) => { setUndoOff(off); setUndoDisabled(off); };

  const Row = ({ icon: Icon, title, desc, children }) => (
    <div className="flex items-center gap-3 py-3.5 border-b border-[var(--line)] last:border-0">
      <span className="grid place-items-center w-9 h-9 rounded-xl bg-[var(--surface-2)] border border-[var(--line)] shrink-0"><Icon size={16} className="text-[var(--primary-2)]" /></span>
      <div className="flex-1 min-w-0"><div className="text-sm font-medium">{title}</div>{desc && <div className="text-xs text-[var(--muted)] mt-0.5">{desc}</div>}</div>
      <div className="shrink-0">{children}</div>
    </div>
  );
  const Switch = ({ on, onChange }) => (
    <button onClick={() => onChange(!on)} className={`relative w-10 h-6 rounded-full transition shrink-0 ${on ? 'bg-[var(--primary)]' : 'bg-[var(--surface-2)] border border-[var(--line)]'}`} role="switch" aria-checked={on}>
      <span className={`absolute left-0.5 top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-[16px]' : 'translate-x-0'}`} />
    </button>
  );

  return (
    <div className="max-w-2xl mx-auto">
      <PageHeader icon={Sliders} title={t('set.title', 'Settings')} subtitle={t('set.sub', 'Your device preferences — saved on this browser only.')} />

      <Card className="p-4 sm:p-5 mb-4">
        <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-1 flex items-center gap-1.5"><Palette size={13} /> {t('set.appearance', 'Appearance')}</div>
        <Row icon={theme === 'dark' ? Sparkles : Palette} title={t('set.theme', 'Theme')} desc={t('set.theme.d', 'Light or dark — applies instantly.')}>
          <Select value={theme} onChange={(e) => { if (e.target.value !== theme) toggleTheme(); }} className="!w-auto"><option value="light">{t('set.light', 'Light')}</option><option value="dark">{t('set.dark', 'Dark')}</option></Select>
        </Row>
        <Row icon={Globe} title={t('set.lang', 'Language')} desc={t('set.lang.d', 'Interface language.')}>
          <Select value={lang} onChange={(e) => setLang(e.target.value)} className="!w-auto"><option value="en">English</option><option value="fr">Français</option></Select>
        </Row>
        <Row icon={Sparkles} title={t('set.intro', 'Intro animation')} desc={t('set.intro.d', 'Play the orb intro on each page load.')}>
          <Switch on={!skipIntro} onChange={(v) => setIntro(!v)} />
        </Row>
        <Row icon={Orbit} title={t('set.orbtr', 'Orb page transitions')} desc={t('set.orbtr.d', 'On each navigation, the hero orb shatters and dives into a random shard, then rebuilds. Off by default.')}>
          <Switch on={orbTransition} onChange={setOrbTr} />
        </Row>
        {/* Three states, not a switch. A switch could only say on/off, and "off" was
            being reported for two very different reasons — you turned it off, or your
            system asks for reduced motion. The second one used to be unoverridable and
            still displayed as ON, so the setting lied. Now Automatic is the default and
            says out loud when the OS is the one holding it back. */}
        <Row icon={Sparkles} title={t('set.fx', 'Event fireworks')}
          desc={fx === 'auto' && prefersReducedMotion()
            ? t('set.fx.reduced', 'Your system asks for reduced motion, so Automatic keeps these off. Choose On if you want them anyway.')
            : t('set.fx.d', 'Full-screen fireworks during a live event (New Year, national days…). The announcement badge still shows.')}>
          <Select className="!w-auto" value={fx} onChange={(e) => setFx(e.target.value)}>
            <option value="auto">{t('set.fx.auto', 'Automatic')}</option>
            <option value="on">{t('set.fx.on', 'On')}</option>
            <option value="off">{t('set.fx.off', 'Off')}</option>
          </Select>
        </Row>
        <Row icon={Eye} title={t('set.glass', 'Translucent surfaces')} desc={t('set.glass.d', 'Frosted-glass cards & dialogs instead of solid ones.')}>
          <Switch on={glass.on} onChange={(v) => applyGlass({ ...glass, on: v })} />
        </Row>
        {glass.on && (
          <div className="flex items-center gap-3 py-3 pl-12">
            <span className="text-xs text-[var(--muted)] shrink-0">{t('set.glass.opacity', 'Opacity')}</span>
            <input type="range" min="40" max="100" step="5" value={glass.pct} onChange={(e) => applyGlass({ ...glass, pct: Number(e.target.value) })} className="flex-1 accent-[var(--primary)]" />
            <span className="text-xs font-medium tabular-nums w-10 text-right">{glass.pct}%</span>
          </div>
        )}
      </Card>

      <Card className="p-4 sm:p-5 mb-4">
        <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-1 flex items-center gap-1.5"><Undo2 size={13} /> {t('set.behaviour', 'Actions')}</div>
        <Row icon={Undo2} title={t('set.undo', 'Undo window')} desc={t('set.undo.d', 'Saving, publishing and deleting wait a few seconds behind an “Undo” toast, so a mistake costs nothing. Turn this off to apply every action immediately.')}>
          <Switch on={!undoOff} onChange={(v) => setUndo(!v)} />
        </Row>
      </Card>

      <Card className="p-4 sm:p-5">
        <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-1 flex items-center gap-1.5"><Cookie size={13} /> {t('set.privacy', 'Cookies & privacy')}</div>
        <Row icon={Cookie} title={t('set.cookies', 'Analytics cookies')} desc={t('set.cookies.d', 'Essential keeps you signed in; All also enables privacy-friendly, first-party page analytics.')}>
          <Select value={consent} onChange={(e) => setCookie(e.target.value)} className="!w-auto"><option value="essential">{t('set.essential', 'Essential only')}</option><option value="all">{t('set.all', 'Accept all')}</option></Select>
        </Row>
        <div className="pt-3 text-xs text-[var(--muted)]">
          {t('set.privacy.more', 'Read more in the')} <Link to="/legal/cookies" className="text-[var(--primary-2)] hover:underline">{t('nav.cookies', 'Cookie Policy')}</Link> {t('set.and', 'and')} <Link to="/legal/privacy" className="text-[var(--primary-2)] hover:underline">{t('nav.privacy', 'Privacy Policy')}</Link>.
        </div>
      </Card>
    </div>
  );
}

// Email-confirmation landing page (the link in the confirmation email → /verify-email?token=).
export function VerifyEmail() {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [state, setState] = useState('working'); // working | ok | error
  useEffect(() => {
    if (!token) { setState('error'); return; }
    api.post('/auth/verify-email', { token }).then(() => setState('ok')).catch(() => setState('error'));
  }, [token]);
  // One card shell for every state — a bare centered message would sit over the orb backdrop.
  return (
    <div className="max-w-md mx-auto py-12">
      <Card className="p-8 text-center">
        {state === 'working' && <div className="grid place-items-center text-[var(--muted)] py-2"><Spinner /><p className="mt-3">{t('verify.working', 'Confirming your email…')}</p></div>}
        {state === 'ok' && <>
          <span className="grid place-items-center w-12 h-12 rounded-2xl bg-[var(--success-bg)] border border-[var(--success-border)] mx-auto mb-4"><CheckCircle2 size={24} className="text-[var(--success)]" /></span>
          <h1 className="text-xl font-semibold mb-1">{t('verify.ok.title', 'Email confirmed')}</h1>
          <p className="text-[var(--muted)] mb-5">{t('verify.ok.sub', 'Your email address is verified — thanks!')}</p>
          <Link to="/dashboard"><Button variant="primary">{t('verify.ok.cta', 'Go to dashboard')}</Button></Link>
        </>}
        {state === 'error' && <>
          <span className="grid place-items-center w-12 h-12 rounded-2xl bg-[var(--error-bg)] border border-[var(--error-border)] mx-auto mb-4"><XCircle size={24} className="text-[var(--error)]" /></span>
          <h1 className="text-xl font-semibold mb-1">{t('verify.err.title', 'Link invalid or expired')}</h1>
          <p className="text-[var(--muted)] mb-5">{t('verify.err.sub', 'This confirmation link is no longer valid. You can request a new one from your profile.')}</p>
          <Link to="/profile"><Button>{t('nav.profile', 'Profile')}</Button></Link>
        </>}
      </Card>
    </div>
  );
}

// OAuth/OIDC consent screen (the /authorize SPA route). The API's /oauth2/authorize
// redirects here with a signed ?rt= token once the user is logged in; we show the
// client + scopes and POST the decision (full-page, so the browser follows the 302
// back to the requesting app).
export function Authorize() {
  const { t } = useI18n();
  const { user, loading: authLoading } = useAuth();
  const [params] = useSearchParams();
  const rt = params.get('rt') || '';
  const [info, setInfo] = useState(null);
  useEffect(() => {
    if (!rt) { setInfo({ error: 'no_request' }); return; }
    api.get(`/oauth2/consent-info?rt=${encodeURIComponent(rt)}`).then(setInfo).catch(() => setInfo({ error: 'invalid' }));
  }, [rt]);
  const SCOPE_META = {
    openid: [ShieldCheck, t('oauth.scope.openid', 'Confirm your identity'), t('oauth.scope.openid.s', 'Verify who you are')],
    profile: [Users, t('oauth.scope.profile', 'Your profile'), t('oauth.scope.profile.s', 'Display name & avatar')],
    email: [Mail, t('oauth.scope.email', 'Your email address'), t('oauth.scope.email.s', 'To identify & contact you')],
    items: [Package, t('oauth.scope.items', 'Your catalog items'), t('oauth.scope.items.s', 'Read your items & submissions')],
    repos: [Server, t('oauth.scope.repos', 'Your Server-Repos'), t('oauth.scope.repos.s', 'Read the hosted repos you own')],
  };
  // Loading / signed-out / error all use the same card shell as the consent screen —
  // a bare centered message would sit over the orb backdrop and lose legibility.
  if (authLoading || (user && !info)) return (
    <div className="max-w-md mx-auto py-12"><Card className="p-10"><div className="grid place-items-center text-[var(--muted)]"><Spinner /></div></Card></div>
  );
  if (!user) return (
    <div className="max-w-md mx-auto py-12">
      <Card className="p-7 text-center">
        <span className="grid place-items-center w-12 h-12 rounded-2xl bg-[var(--surface-2)] border border-[var(--line)] mx-auto mb-4"><Shield size={22} className="text-[var(--primary-2)]" /></span>
        <p className="text-[var(--muted)] mb-4">{t('oauth.needlogin', 'Please sign in to continue.')}</p>
        <Button variant="primary" onClick={() => { window.location.href = `/auth?next=${encodeURIComponent('/authorize?rt=' + rt)}`; }}>{t('nav.login', 'Sign in')}</Button>
      </Card>
    </div>
  );
  if (info?.error) return (
    <div className="max-w-md mx-auto py-12">
      <Card className="p-7 text-center">
        <span className="grid place-items-center w-12 h-12 rounded-2xl bg-[var(--error-bg)] border border-[var(--error-border)] mx-auto mb-4"><Shield size={22} className="text-[var(--error)]" /></span>
        <p className="text-sm text-[var(--muted)]">{t('oauth.err', 'This authorization request is invalid or expired — please start again from the app.')}</p>
      </Card>
    </div>
  );
  return (
    <div className="max-w-md mx-auto py-12">
      <Card className="p-7">
        <div className="flex items-center gap-3.5 mb-6">
          <span className="grid place-items-center w-12 h-12 rounded-2xl bg-gradient-to-br from-brand to-brand-2 text-white text-xl font-bold shrink-0 shadow-lg shadow-orange-500/25">{(info.clientName || '?').charAt(0).toUpperCase()}</span>
          <div className="min-w-0">
            <div className="font-bold text-[17px] leading-tight truncate flex items-center gap-1.5">
              {info.clientName}
              {info.verified && <BadgeCheck size={15} className="text-[var(--success)] shrink-0" title={t('oauth.verified', 'Reviewed by BetterCommunity')} />}
            </div>
            <div className="text-sm text-[var(--muted)]">{t('oauth.wants', 'wants to access your BetterCommunity account')}</div>
          </div>
        </div>

        {/* Who is asking. Anyone can register an app and type any name into the form, so the
            screen says where this one came from rather than letting the name speak for
            itself — that is the single question a consent screen exists to answer. */}
        {!info.firstParty && (
          <div className={`rounded-lg border p-3 mb-5 text-[12px] ${info.verified ? 'border-[var(--line)] bg-[var(--surface-2)]/50' : 'border-warning/50 bg-warning/10'}`}>
            {info.verified
              ? t('oauth.thirdparty.ok', 'A third-party app, reviewed by us. {who} registered it.').replace('{who}', info.ownerName || t('oauth.someone', 'A member'))
              : t('oauth.thirdparty.new', 'A third-party app registered by {who}, and NOT reviewed by us. Anyone can register an app under any name — only continue if you know what this is.').replace('{who}', info.ownerName || t('oauth.someone', 'A member'))}
            {info.description && <div className="mt-1 text-[var(--muted)]">{info.description}</div>}
            {info.homepageUrl && (
              // rel=noreferrer as well as noopener: the referrer would tell an unreviewed
              // third party which account was looking at its consent screen.
              <a href={info.homepageUrl} target="_blank" rel="noopener noreferrer nofollow"
                 className="mt-1 inline-block text-[var(--primary-2)] hover:underline break-all">{info.homepageUrl}</a>
            )}
          </div>
        )}
        <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--faint)] mb-2">{t('oauth.willaccess', 'It will be able to access')}</div>
        <ul className="rounded-xl border border-[var(--line)] divide-y divide-[var(--line)] mb-4 overflow-hidden">
          {(info.scopes || []).map((s) => { const [I, label, sub] = SCOPE_META[s] || [CheckCircle2, s, '']; return (
            <li key={s} className="flex items-center gap-3 px-3.5 py-2.5">
              <span className="grid place-items-center w-8 h-8 rounded-lg bg-[var(--surface-2)] text-[var(--primary-2)] shrink-0"><I size={16} /></span>
              <div className="min-w-0"><div className="text-sm font-medium leading-tight">{label}</div>{sub && <div className="text-xs text-[var(--muted)] truncate">{sub}</div>}</div>
              <CheckCircle2 size={16} className="text-success ml-auto shrink-0" />
            </li>
          ); })}
        </ul>
        <p className="text-xs text-[var(--muted)] mb-5 flex items-start gap-1.5"><Lock size={13} className="mt-0.5 shrink-0 text-[var(--faint)]" /> {t('oauth.readonly', "Read-only access — it can't change your password, spend money, or post as you.")}</p>
        <form method="post" action="/oauth2/authorize/decision" className="flex gap-3">
          <input type="hidden" name="request_token" value={rt} />
          <button type="submit" name="decision" value="deny" className="btn flex-1">{t('oauth.deny', 'Deny')}</button>
          <button type="submit" name="decision" value="approve" className="btn btn-primary flex-1">{t('oauth.allow', 'Allow')}</button>
        </form>
        <p className="text-[11px] text-[var(--faint)] mt-3.5 text-center">{t('oauth.signedin', 'Signed in as {name}').replace('{name}', user.displayName || user.email || '')}</p>
      </Card>
    </div>
  );
}

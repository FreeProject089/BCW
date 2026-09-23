import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BadgeCheck, Lock, Cookie, Palette, Shield, CheckCircle2, XCircle, Eye, Globe, Mail, Orbit, Package, Server, ShieldCheck, Users, Activity, Box, Clapperboard, Moon, Sun, Play, PartyPopper, SprayCan, MousePointerClick, Settings as SettingsIcon, Undo2, LogOut, AlertTriangle, FileText } from 'lucide-react';
import { Button, Card, Explain, PageHeader, Select, Spinner, useToast, useDialog } from '../ui/ui.jsx';
import { fxPref, setFxPref, prefersReducedMotion } from '../lib/fx-pref.js';
import { useI18n } from '../i18n.jsx';
import { useTheme } from '../ui/theme.jsx';
import { useAuth } from './auth.jsx';
import { api } from '../lib/api.js';
import { getGlassPrefs, setGlassPrefs, getOrbTransitionPref, setOrbTransitionPref, getUndoDisabled, setUndoDisabled, getLogoutConfirm, setLogoutConfirm, getForceConfirm, setForceConfirm, getHero3dDisabled, setHero3dDisabled, getTexturePref, setTexturePref, getDraftsDisabled, setDraftsDisabled } from '../lib/prefs.js';
import { clearAllDrafts } from '../ui/draft-store.js';
import { getConsent, setConsent } from '../lib/consent.js';
import { SKIP_KEY } from '../ui/IntroContext.jsx';
import { InstallAppCard } from '../ui/pwa-install.jsx';
import { ShortcutsCard } from '../ui/shortcuts.jsx';

/* ──────────────  BMM telemetry: my data (GDPR export / erasure)  ────────────── */
// Only for a signed-in account with at least one linked BMM install (creator id). The
// request is filed with the telemetry service on the account's behalf: the proof is the
// link itself, and the confirmation (with the export attached) goes to the account's
// e-mail, so nothing is typed here. Unlinked installs file from BMM (Settings > Privacy)
// with an address instead.
function TelemetryRequests({ Row }) {
  const { t } = useI18n();
  const toast = useToast();
  const dialog = useDialog();
  const { user } = useAuth();
  const [links, setLinks] = useState(null);
  const [busy, setBusy] = useState('');
  useEffect(() => {
    if (!user) { setLinks([]); return; }
    let on = true;
    api.get('/me/creator-links').then((r) => { if (on) setLinks(r?.links || []); }).catch(() => { if (on) setLinks([]); });
    return () => { on = false; };
  }, [user]);
  if (!user || !links || links.length === 0) return null;
  const file = async (creatorId, kind) => {
    const short = creatorId.slice(0, 12) + '…';
    if (kind === 'delete' && !await dialog.confirm({
      title: t('set.tele.del.t', 'Erase telemetry for this install?'),
      message: t('set.tele.del.m', 'Every telemetry row tied to {id} (and to any other install linked to your account) is deleted after the review delay. This cannot be undone. You will get an e-mail when it is done.').replace('{id}', short),
      okLabel: t('set.tele.del.ok', 'Request erasure'),
    })) return;
    setBusy(`${kind}:${creatorId}`);
    try {
      const r = await api.post('/me/telemetry/data-request', { creatorId, kind });
      if (r?.duplicate) toast.success(t('set.tele.dup', 'A request of this kind is already pending for this install.'));
      else toast.success(kind === 'delete'
        ? t('set.tele.del.sent', 'Erasure requested, you will be e-mailed once it is done.')
        : t('set.tele.exp.sent', 'Export requested, the package is e-mailed to your account address.'));
    } catch (e) {
      const code = e?.data?.error || e?.error;
      toast.error(code === 'telemetry_not_configured' || code === 'telemetry_unreachable'
        ? t('set.tele.off', 'The telemetry service is not reachable right now. Try again later.')
        : t('set.tele.fail', 'The request could not be filed.'));
    } finally { setBusy(''); }
  };
  return (
    <Row icon={Activity} title={t('set.tele', 'BMM telemetry, my data')} stack
      more={t('set.tele.d', 'Opt-in usage telemetry sent by Better Mods Manager, keyed by the creator id of each install you linked. Get a copy of everything held under it, or have it erased.')}>
      {/* One line per linked install, each one a name and two buttons. It is the widest
          control on the page, which is why it gets its own line: beside the title it left
          the explanation 25px of width on a phone. */}
      <div className="flex flex-col gap-1.5 items-stretch sm:items-end">
        {links.map((l) => (
          <div key={l.id} className="flex items-center gap-1.5 min-w-0">
            <span className="font-mono text-[11px] text-[var(--muted)] truncate min-w-0 flex-1 sm:flex-none" title={l.creatorId}>{l.displayName || l.creatorId.slice(0, 10) + '…'}</span>
            <Button size="sm" variant="ghost" loading={busy === `export:${l.creatorId}`} disabled={!!busy} onClick={() => file(l.creatorId, 'export')}>{t('set.tele.export', 'Export')}</Button>
            <Button size="sm" variant="danger" loading={busy === `delete:${l.creatorId}`} disabled={!!busy} onClick={() => file(l.creatorId, 'delete')}>{t('set.tele.erase', 'Erase')}</Button>
          </div>
        ))}
      </div>
    </Row>
  );
}

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
  const [texture, setTextureState] = useState(() => getTexturePref());
  const [orbTransition, setOrbTransition] = useState(() => getOrbTransitionPref());
  const [orbOff, setOrbOff] = useState(() => getHero3dDisabled());
  const [fx, setFxState] = useState(() => fxPref());
  const [undoOff, setUndoOff] = useState(() => getUndoDisabled());
  const [logoutConfirm, setLogoutConfirmState] = useState(() => getLogoutConfirm());
  const [forceConfirm, setForceConfirmState] = useState(() => getForceConfirm());
  const [draftsOff, setDraftsOff] = useState(() => getDraftsDisabled());

  const setFx = (v) => { setFxState(v); setFxPref(v); };
  const setIntro = (skip) => { setSkipIntro(skip); try { skip ? localStorage.setItem(SKIP_KEY, '1') : localStorage.removeItem(SKIP_KEY); } catch {} };
  const setOrbTr = (on) => { setOrbTransition(on); setOrbTransitionPref(on); };
  // A reload is required and is stated, rather than pretending the change is live: the
  // scene is mounted once at boot and tearing a WebGL context down mid-session is worse
  // than asking for a refresh.
  const setOrb = (off) => { setOrbOff(off); setHero3dDisabled(off); toast.success(t('set.reload', 'Saved, reload the page to apply.')); };
  const setCookie = (v) => { setConsentState(v); setConsent(v); toast.success(t('set.saved', 'Saved.')); };
  const applyGlass = (next) => { setGlass(next); setGlassPrefs(next); };
  const setUndo = (off) => { setUndoOff(off); setUndoDisabled(off); };
  // Turning drafts off empties the ones already kept, in the same click. Otherwise "off"
  // would mean "this browser still holds what you typed, it just will not offer it back",
  // which is not what anybody reading the switch understands by it.
  const setDrafts = (off) => {
    setDraftsOff(off); setDraftsDisabled(off);
    if (!off) return;
    let n = 0;
    try { n = clearAllDrafts(sessionStorage); } catch { /* storage refused, there was nothing to clear */ }
    if (n > 0) toast.success(t('set.drafts.cleared', '{n} draft(s) cleared.').replace('{n}', String(n)));
  };

  // One setting per line: the icon, the name and the control on the first line, and
  // everything that EXPLAINS it underneath, across the card's whole width.
  //
  // The control used to share that flex line with the description, so any row whose control
  // was wider than a 40px switch stole the text's width: measured on a 375px phone, the
  // <Select> rows left the description 104px and the telemetry row left it 25px, which wraps
  // one short word per line. Below the title it gets 283px on the same phone.
  //
  // `more` is the long half of an explanation, folded behind the house disclosure instead of
  // standing in the page: "Always ask, even with Shift held" was a 301-character paragraph
  // that made a single toggle 194px tall, on every visit, for everybody.
  //
  // `stack` gives the control its own line, for the one row whose control is not a switch but
  // a list of buttons per linked install.
  const Row = ({ icon: Icon, title, desc, more, stack = false, children }) => (
    <div className="py-3 border-b border-[var(--line)] last:border-0">
      <div className="flex items-center gap-3">
        <span className="grid place-items-center w-9 h-9 rounded-xl bg-[var(--surface-2)] border border-[var(--line)] shrink-0"><Icon size={16} className="text-[var(--accent-ink)]" /></span>
        <div className="flex-1 min-w-0 text-sm font-medium">{title}</div>
        {!stack && <div className="shrink-0">{children}</div>}
      </div>
      {(desc || more) && (
        <div className="ps-12 mt-0.5 space-y-0.5">
          {desc && <div className="text-xs text-[var(--muted)]">{desc}</div>}
          {more && <Explain className="text-xs">{more}</Explain>}
        </div>
      )}
      {stack && <div className="ps-12 mt-2">{children}</div>}
    </div>
  );
  const Switch = ({ on, onChange }) => (
    <button onClick={() => onChange(!on)} className={`tap-44 relative w-10 h-6 rounded-full transition shrink-0 ${on ? 'bg-[var(--primary)]' : 'bg-[var(--surface-2)] border border-[var(--line)]'}`} role="switch" aria-checked={on}>
      <span className={`absolute left-0.5 top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-[16px]' : 'translate-x-0'}`} />
    </button>
  );

  // A titled card — one settings group. Its icon chip gives the page a consistent rhythm
  // instead of four differently-weighted headers.
  const Group = ({ icon: Icon, title, children, className = '' }) => (
    <Card className={`p-4 sm:p-5 ${className}`}>
      <div className="flex items-center gap-2.5 mb-2 pb-2.5 border-b border-[var(--line)]">
        <span className="grid place-items-center w-7 h-7 rounded-lg tint-primary border b-primary shrink-0"><Icon size={14} className="text-[var(--accent-ink)]" /></span>
        <span className="text-sm font-semibold">{title}</span>
      </div>
      {children}
    </Card>
  );

  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader icon={SettingsIcon} title={t('set.title', 'Settings')} subtitle={t('set.sub', 'Your device preferences, saved on this browser only.')} />

      {/* Two columns on desktop so the page uses the width instead of a long narrow strip;
          stacks on mobile. items-start keeps each card its own height (no stretched gaps). */}
      <div className="grid gap-4 lg:grid-cols-2 items-start">
        <Group icon={Palette} title={t('set.appearance', 'Appearance')}>
          <Row icon={theme === 'dark' ? Moon : Sun} title={t('set.theme', 'Theme')} desc={t('set.theme.d', 'Light or dark, applies instantly.')}>
            <Select value={theme} onChange={(e) => { if (e.target.value !== theme) toggleTheme(); }} className="!w-auto"><option value="light">{t('set.light', 'Light')}</option><option value="dark">{t('set.dark', 'Dark')}</option></Select>
          </Row>
          <Row icon={Globe} title={t('set.lang', 'Language')} desc={t('set.lang.d', 'Interface language.')}>
            <Select value={lang} onChange={(e) => setLang(e.target.value)} className="!w-auto"><option value="en">English</option><option value="fr">Français</option></Select>
          </Row>
          <Row icon={Eye} title={t('set.glass', 'Translucent surfaces')} desc={t('set.glass.d', 'Frosted-glass cards & dialogs instead of solid ones.')}>
            <Switch on={glass.on} onChange={(v) => applyGlass({ ...glass, on: v })} />
          </Row>
          {glass.on && (
            <div className="flex items-center gap-3 py-3 ps-12">
              <span className="text-xs text-[var(--muted)] shrink-0">{t('set.glass.opacity', 'Opacity')}</span>
              <input type="range" min="40" max="100" step="5" value={glass.pct} onChange={(e) => applyGlass({ ...glass, pct: Number(e.target.value) })} className="flex-1 accent-[var(--primary)]" />
              <span className="text-xs font-medium tabular-nums w-10 text-end">{glass.pct}%</span>
            </div>
          )}
          <Row icon={SprayCan} title={t('set.texture', 'Page grain')} desc={t('set.texture.d3', 'A grain on the page backdrop, the footer and a few large cards. Never on text-heavy panels, tables or fields.')}>
            <Switch on={texture !== 'off'} onChange={(v) => { const next = v ? 'on' : 'off'; setTextureState(next); setTexturePref(next); }} />
          </Row>
        </Group>

        <Group icon={Clapperboard} title={t('set.motion', 'Motion & effects')}>
          <Row icon={Play} title={t('set.intro', 'Intro animation')} desc={t('set.intro.d', 'Play the orb intro on each page load.')}>
            <Switch on={!skipIntro} onChange={(v) => setIntro(!v)} />
          </Row>
          <Row icon={Box} title={t('set.orb3d', '3D scene')} more={t('set.orb3d.d', 'The WebGL shape behind the pages. Turning it off skips loading it entirely, lighter on an older machine, and on battery.')}>
            <Switch on={!orbOff} onChange={(v) => setOrb(!v)} />
          </Row>
          <Row icon={Orbit} title={t('set.orbtr', 'Orb page transitions')} more={t('set.orbtr.d', 'On each navigation, the hero orb shatters and dives into a random shard, then rebuilds. Off by default.')}>
            <Switch on={orbTransition} onChange={setOrbTr} />
          </Row>
          {/* Three states, not a switch — see the note that used to live here: "off" meant
              either you turned it off or your OS asks for reduced motion, so a switch lied.
              Automatic is the default and says when the OS is the one holding it back. */}
          {/* The reduced-motion case stays ON the page rather than folding: it is the reason
              the control looks switched off, and an answer you have to open is an answer
              nobody reads. The ordinary description folds like its neighbours. */}
          <Row icon={PartyPopper} title={t('set.fx', 'Event fireworks')}
            desc={fx === 'auto' && prefersReducedMotion()
              ? t('set.fx.reduced', 'Your system asks for reduced motion, so Automatic keeps these off. Choose On if you want them anyway.')
              : null}
            more={fx === 'auto' && prefersReducedMotion()
              ? null
              : t('set.fx.d', 'Full-screen fireworks during a live event (New Year, national days…). The announcement badge still shows.')}>
            <Select className="!w-auto" value={fx} onChange={(e) => setFx(e.target.value)}>
              <option value="auto">{t('set.fx.auto', 'Automatic')}</option>
              <option value="on">{t('set.fx.on', 'On')}</option>
              <option value="off">{t('set.fx.off', 'Off')}</option>
            </Select>
          </Row>
        </Group>

        <Group icon={MousePointerClick} title={t('set.behaviour', 'Actions')}>
          <Row icon={Undo2} title={t('set.undo', 'Undo window')} more={t('set.undo.d', 'Saving, publishing and deleting wait a few seconds behind an “Undo” toast, so a mistake costs nothing. Turn this off to apply every action immediately.')}>
            <Switch on={!undoOff} onChange={(v) => setUndo(!v)} />
          </Row>
          <Row icon={FileText} title={t('set.drafts', 'Keep drafts')}
            more={t('set.drafts.d', 'Long forms and editors keep what you write in this browser tab and offer it back the next time you open them, so a mis-click, a reload or a crash costs nothing. Nothing is sent, nothing leaves this tab, and a draft older than 24 hours is forgotten. Turn it off on a shared machine: nothing at all is written any more, and the drafts already kept are cleared straight away.')}>
            <Switch on={!draftsOff} onChange={(v) => setDrafts(!v)} />
          </Row>
          <Row icon={LogOut} title={t('set.logoutconfirm', 'Ask before signing out')} more={t('set.logoutconfirm.d', 'The sign-out button is an icon in the topbar, one mis-click from your profile, and with 2FA on, getting back in is not one click.')}>
            <Switch on={logoutConfirm} onChange={(v) => { setLogoutConfirmState(v); setLogoutConfirm(v); }} />
          </Row>
          <Row icon={AlertTriangle} title={t('set.forceconfirm', 'Always ask, even with Shift held')}
            more={t('set.forceconfirm.d', 'Holding Shift while clicking normally answers a confirmation without showing it — clearing a queue is one decision, not forty. Turn this on to make every confirmation unskippable, which is what you want on a shared or supervised machine. It never applies to the prompts that ask you to type something.')}>
            <Switch on={forceConfirm} onChange={(v) => { setForceConfirmState(v); setForceConfirm(v); }} />
          </Row>
        </Group>

        <Group icon={Lock} title={t('set.privacy', 'Cookies & privacy')}>
          <Row icon={Cookie} title={t('set.cookies', 'Analytics cookies')} desc={t('set.cookies.d', 'Essential keeps you signed in; All also enables privacy-friendly, first-party page analytics.')}>
            <Select value={consent} onChange={(e) => setCookie(e.target.value)} className="!w-auto"><option value="essential">{t('set.essential', 'Essential only')}</option><option value="all">{t('set.all', 'Accept all')}</option></Select>
          </Row>
          <TelemetryRequests Row={Row} />
          <div className="pt-3 text-xs text-[var(--muted)]">
            {t('set.privacy.more', 'Read more in the')} <Link to="/legal/cookies" className="text-[var(--accent-ink)] hover:underline">{t('nav.cookies', 'Cookie Policy')}</Link> {t('set.and', 'and')} <Link to="/legal/privacy" className="text-[var(--accent-ink)] hover:underline">{t('nav.privacy', 'Privacy Policy')}</Link>.
          </div>
        </Group>

        <InstallAppCard />
        <ShortcutsCard className="lg:col-span-2" />
      </div>
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
          <p className="text-[var(--muted)] mb-5">{t('verify.ok.sub', 'Your email address is verified, thanks!')}</p>
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
        <span className="grid place-items-center w-12 h-12 rounded-2xl bg-[var(--surface-2)] border border-[var(--line)] mx-auto mb-4"><Shield size={22} className="text-[var(--accent-ink)]" /></span>
        <p className="text-[var(--muted)] mb-4">{t('oauth.needlogin', 'Please sign in to continue.')}</p>
        <Button variant="primary" onClick={() => { window.location.href = `/auth?next=${encodeURIComponent('/authorize?rt=' + rt)}`; }}>{t('nav.login', 'Sign in')}</Button>
      </Card>
    </div>
  );
  if (info?.error) return (
    <div className="max-w-md mx-auto py-12">
      <Card className="p-7 text-center">
        <span className="grid place-items-center w-12 h-12 rounded-2xl bg-[var(--error-bg)] border border-[var(--error-border)] mx-auto mb-4"><Shield size={22} className="text-[var(--error)]" /></span>
        <p className="text-sm text-[var(--muted)]">{t('oauth.err', 'This authorization request is invalid or expired, please start again from the app.')}</p>
      </Card>
    </div>
  );
  return (
    <div className="max-w-md mx-auto py-12">
      <Card className="p-7">
        <div className="flex items-center gap-3.5 mb-6">
          <span className="grid place-items-center w-12 h-12 rounded-2xl bg-gradient-to-br from-brand to-brand-2 text-[var(--on-primary)] text-xl font-bold shrink-0 shadow-lg shadow-orange-500/25">{(info.clientName || '?').charAt(0).toUpperCase()}</span>
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
          <div className={`rounded-lg border p-3 mb-5 text-[12px] ${info.verified ? 'border-[var(--line)] panel' : 'b-warning tint-warning'}`}>
            {info.verified
              ? t('oauth.thirdparty.ok', 'A third-party app, reviewed by us. {who} registered it.').replace('{who}', info.ownerName || t('oauth.someone', 'A member'))
              : t('oauth.thirdparty.new', 'A third-party app registered by {who}, and NOT reviewed by us. Anyone can register an app under any name — only continue if you know what this is.').replace('{who}', info.ownerName || t('oauth.someone', 'A member'))}
            {info.description && <div className="mt-1 text-[var(--muted)]">{info.description}</div>}
            {info.homepageUrl && (
              // rel=noreferrer as well as noopener: the referrer would tell an unreviewed
              // third party which account was looking at its consent screen.
              <a href={info.homepageUrl} target="_blank" rel="noopener noreferrer nofollow"
                 className="mt-1 inline-block text-[var(--accent-ink)] hover:underline break-all">{info.homepageUrl}</a>
            )}
          </div>
        )}
        <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--faint)] mb-2">{t('oauth.willaccess', 'It will be able to access')}</div>
        <ul className="rounded-xl border border-[var(--line)] divide-y divide-[var(--line)] mb-4 overflow-hidden">
          {(info.scopes || []).map((s) => { const [I, label, sub] = SCOPE_META[s] || [CheckCircle2, s, '']; return (
            <li key={s} className="flex items-center gap-3 px-3.5 py-2.5">
              <span className="grid place-items-center w-8 h-8 rounded-lg bg-[var(--surface-2)] text-[var(--accent-ink)] shrink-0"><I size={16} /></span>
              <div className="min-w-0"><div className="text-sm font-medium leading-tight">{label}</div>{sub && <div className="text-xs text-[var(--muted)] truncate" title={sub}>{sub}</div>}</div>
              <CheckCircle2 size={16} className="text-success ms-auto shrink-0" />
            </li>
          ); })}
        </ul>
        <p className="text-xs text-[var(--muted)] mb-5 flex items-start gap-1.5"><Lock size={13} className="mt-0.5 shrink-0 text-[var(--faint)]" /> {t('oauth.readonly', "Read-only access, it can't change your password, spend money, or post as you.")}</p>
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

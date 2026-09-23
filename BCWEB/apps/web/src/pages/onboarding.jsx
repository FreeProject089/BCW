// The first-run flow a new account walks through once (routes/onboarding.mjs, lib/onboarding.mjs).
//
// It replaces the dashboard's old "Getting started" checklist, which was per-DEVICE (dismissed in
// localStorage) and shown to every account without 2FA or a repo, long-standing members included.
// What that checklist pointed at is still here: 2FA is the `security` step, the first item and
// the first Server-Repo are links in the `next` step.
//
// The server decides everything that matters (who sees it, which step is current, what a click
// changes); this file only draws it. One component serves three places:
//   · <OnboardingSlot/> at the top of the dashboard overview (the flow, or a "resume" card when
//     snoozed, or the given fallback when there is nothing to show);
//   · <WelcomePage/> at /welcome, the same flow on a page of its own;
//   · the admin editor's live preview (`preview`), which draws a draft config and writes nothing.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import {
  Rocket, MailCheck, UserRound, Link2, Sparkles, ShieldCheck, Bell, ArrowRight, Check, X, Clock,
  Package, Server, BookOpen, Bot, Code2, Upload, Star, Heart, Users, Globe, MessageSquare, Gamepad2, Wrench, LayoutDashboard,
} from 'lucide-react';
import { Button, Card, Input, Textarea, Badge, Spinner, useDialog, useToast } from '../ui/ui.jsx';
import { GithubIcon, DiscordIcon, GoogleIcon } from '../ui/brand.jsx';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { useAuth } from './auth.jsx';

/** The icons an admin can give an interest or a link (the editor offers exactly these). */
export const ONB_ICONS = { Package, Server, BookOpen, Bot, Code2, Upload, Rocket, Star, Heart, Users, Globe, MessageSquare, Gamepad2, Wrench, LayoutDashboard, Sparkles };
const iconOf = (name) => ONB_ICONS[name] || ArrowRight;

const STEP_ICON = { verify: MailCheck, profile: UserRound, connections: Link2, interests: Sparkles, privacy: Bell, security: ShieldCheck, next: Rocket };

/** The built-in wording of each step, used wherever the admin left a box empty. Literal t()
 *  calls, one per key, so the i18n checker sees every one of them. */
export function useStepDefaults() {
  const { t } = useI18n();
  return useMemo(() => ({
    verify: { title: t('onb.verify.t', 'Confirm your e-mail address'), body: t('onb.verify.b', 'Until it is confirmed your account can read everything but cannot publish anything.') },
    profile: { title: t('onb.profile.t', 'Tell people who you are'), body: t('onb.profile.b', 'A name and a line about you. Both can be changed later from your profile.') },
    connections: { title: t('onb.conn.t', 'Link your other accounts'), body: t('onb.conn.b', 'Sign in with them too, and let the Discord bot recognise you.') },
    interests: { title: t('onb.int.t', 'What brings you here?'), body: t('onb.int.b', 'Pick what you came for and the last step will point you there.') },
    privacy: { title: t('onb.priv.t', 'Privacy and notifications'), body: t('onb.priv.b', 'Who sees your profile, and what we tell you about.') },
    security: { title: t('onb.sec.t', 'Secure your account'), body: t('onb.sec.b', 'A second factor takes about a minute and keeps your repos and payments yours.') },
    next: { title: t('onb.next.t', 'You are all set'), body: t('onb.next.b', 'Where to go from here.') },
  }), [t]);
}

const pick = (loc, lang) => (loc ? (lang === 'fr' ? (loc.fr || loc.en) : (loc.en || loc.fr)) || '' : '');

/** What the admin preview draws: the draft's enabled steps, every step applicable. */
export function previewData(config) {
  const steps = (config?.steps || []).filter((s) => s.enabled).map((s) => ({ ...s, auto: false }));
  return {
    show: true, snoozed: false, current: steps[0]?.id || null, steps,
    progress: { done: [], skipped: [], interests: [] },
    interests: config?.interests || [], links: config?.links || [],
    ui: config?.ui || {},
    ctx: { emailEnabled: true, emailVerified: false, totpEnabled: false, oauthAvailable: true, providers: { github: true, discord: true, google: false }, linked: [], hasPassword: true },
  };
}

// ── Steps ─────────────────────────────────────────────────────────────────────

function VerifyStep({ data, preview }) {
  const { t } = useI18n(); const toast = useToast(); const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const resend = async () => {
    if (preview) return;
    setBusy(true);
    try {
      const r = await api.post('/auth/verify-email/resend', {});
      if (r?.already) toast.success(t('onb.verify.already', 'Your address is already confirmed.'));
      else toast.success(t('onb.verify.sent', 'Link sent. Check your inbox.'));
    } catch (e) {
      toast.error(e?.data?.retryAfterSec ? t('onb.verify.wait', 'Please wait a few minutes before asking again.') : t('onb.verify.fail', 'Could not send the link.'));
    } finally { setBusy(false); }
  };
  return (
    <div className="space-y-3">
      <div className="text-sm">{t('onb.verify.to', 'We sent a link to')} <b className="break-all">{preview ? 'you@example.com' : user?.email}</b></div>
      <Button size="sm" onClick={resend} loading={busy} disabled={preview || data.ctx?.emailVerified}><MailCheck size={14} /> {t('onb.verify.resend', 'Send the link again')}</Button>
    </div>
  );
}

function ProfileStep({ preview, form, setForm }) {
  const { t } = useI18n();
  return (
    <div className="grid gap-3">
      <label className="grid gap-1 text-sm">
        <span className="font-medium">{t('onb.profile.name', 'Display name')}</span>
        <Input value={form.displayName} maxLength={40} disabled={preview} onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))} />
      </label>
      <label className="grid gap-1 text-sm">
        <span className="font-medium">{t('onb.profile.bio', 'About you')} <span className="text-[var(--faint)] font-normal">{t('onb.optional', '(optional)')}</span></span>
        <Textarea rows={2} value={form.bio} maxLength={280} disabled={preview} onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))} />
      </label>
      <div className="grid gap-1 text-sm">
        <span className="font-medium">{t('onb.profile.lang', 'Language')}</span>
        <div className="flex gap-2">
          {[['en', 'English'], ['fr', 'Français']].map(([code, label]) => (
            <button key={code} type="button" disabled={preview} onClick={() => setForm((f) => ({ ...f, locale: code }))}
              className={`px-3 py-1.5 rounded-lg border text-sm transition ${form.locale === code ? 'border-[var(--primary)] text-[var(--accent-ink)] font-medium' : 'border-[var(--line-strong)]'}`}
              style={{ background: 'var(--bg-solid)' }} aria-pressed={form.locale === code}>{label}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

const PROVIDER = { github: { label: 'GitHub', Icon: GithubIcon }, discord: { label: 'Discord', Icon: DiscordIcon }, google: { label: 'Google', Icon: GoogleIcon } };
function ConnectionsStep({ data, preview }) {
  const { t } = useI18n();
  const providers = Object.entries(data.ctx?.providers || {}).filter(([, on]) => on).map(([k]) => k);
  // Back to the dashboard, where the flow picks up at this same step.
  const link = (k) => { if (!preview) window.location.href = `/api/auth/oauth/${k}/start?intent=link&next=${encodeURIComponent('/dashboard')}`; };
  return (
    <div className="flex flex-wrap gap-2">
      {providers.map((k) => {
        const P = PROVIDER[k]; const linked = (data.ctx?.linked || []).includes(k);
        return linked
          ? <Badge key={k} tone="green"><Check size={11} /> {P.label}</Badge>
          : <Button key={k} size="sm" onClick={() => link(k)} disabled={preview}><P.Icon size={14} /> {t('onb.conn.link', 'Link {p}').replace('{p}', P.label)}</Button>;
      })}
    </div>
  );
}

function InterestsStep({ data, preview, chosen, setChosen, lang }) {
  const toggle = (id) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  return (
    <div className="flex flex-wrap gap-2">
      {(data.interests || []).map((it) => {
        const I = iconOf(it.icon); const on = chosen.includes(it.id);
        return (
          <button key={it.id} type="button" onClick={() => !preview && toggle(it.id)} aria-pressed={on}
            className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-sm transition ${on ? 'border-[var(--primary)] text-[var(--accent-ink)] font-medium' : 'border-[var(--line-strong)] hover:border-[var(--primary)]'}`}
            style={{ background: 'var(--bg-solid)' }}>
            <I size={15} className="shrink-0" /> {pick(it.label, lang)} {on && <Check size={13} />}
          </button>
        );
      })}
    </div>
  );
}

function PrivacyStep({ data, preview, form, setForm }) {
  const { t, lang } = useI18n(); const { user } = useAuth(); const toast = useToast();
  const [cats, setCats] = useState(null);
  const [news, setNews] = useState('idle');
  useEffect(() => {
    if (preview) { setCats([{ key: 'repos', label: 'Repositories', enabled: true }, { key: 'security', label: 'Account and security', locked: true, enabled: true }]); return; }
    api.get('/me/notification-prefs').then((r) => setCats(r.categories || [])).catch(() => setCats([]));
  }, [preview]);
  const flip = async (c) => {
    if (preview || c.locked) return;
    setCats((l) => l.map((x) => (x.key === c.key ? { ...x, enabled: !x.enabled } : x)));
    try { await api.put('/me/notification-prefs', { category: c.key, enabled: !c.enabled }); }
    catch { setCats((l) => l.map((x) => (x.key === c.key ? { ...x, enabled: c.enabled } : x))); toast.error(t('onb.priv.fail', 'Could not save that.')); }
  };
  // The newsletter is double opt-in and mails the address, so it waits for a confirmed one.
  const canNews = !data.ctx?.emailEnabled || data.ctx?.emailVerified;
  const subscribe = async () => {
    if (preview) return;
    setNews('busy');
    try { await api.post('/newsletter/subscribe', { email: user?.email, locale: lang === 'fr' ? 'fr' : 'en' }); setNews('done'); }
    catch { setNews('idle'); toast.error(t('onb.priv.newsfail', 'Could not subscribe you.')); }
  };
  return (
    <div className="space-y-4">
      <label className="flex items-start gap-3 text-sm cursor-pointer">
        <input type="checkbox" className="mt-1" checked={!!form.profilePublic} disabled={preview} onChange={(e) => setForm((f) => ({ ...f, profilePublic: e.target.checked }))} />
        <span><span className="font-medium">{t('onb.priv.public', 'Public profile')}</span><br />
          <span className="text-[var(--muted)]">{t('onb.priv.publicD', 'Anyone can open your profile page. Off: only you and staff.')}</span></span>
      </label>
      <div>
        <div className="text-sm font-medium mb-1.5">{t('onb.priv.notifs', 'Notify me about')}</div>
        {!cats ? <Spinner /> : (
          <div className="flex flex-wrap gap-2">
            {cats.map((c) => (
              <button key={c.key} type="button" onClick={() => flip(c)} disabled={c.locked} aria-pressed={c.enabled}
                title={c.locked ? t('onb.priv.locked', 'Account and security notices cannot be switched off.') : undefined}
                className={`px-2.5 py-1 rounded-lg border text-xs transition ${c.enabled ? 'border-[var(--primary)] text-[var(--accent-ink)]' : 'border-[var(--line-strong)] text-[var(--muted)]'} ${c.locked ? 'opacity-70 cursor-default' : ''}`}
                style={{ background: 'var(--bg-solid)' }}>{c.enabled ? <Check size={11} className="inline me-1" /> : null}{c.label}</button>
            ))}
          </div>
        )}
      </div>
      {canNews && (
        <div className="flex items-center gap-2 text-sm">
          {news === 'done'
            ? <span className="text-[var(--success)] flex items-center gap-1"><Check size={14} /> {t('onb.priv.newsdone', 'Check your inbox to confirm the subscription.')}</span>
            : <Button size="sm" onClick={subscribe} loading={news === 'busy'} disabled={preview}><Bell size={14} /> {t('onb.priv.news', 'Get the newsletter')}</Button>}
        </div>
      )}
    </div>
  );
}

function SecurityStep({ data, preview }) {
  const { t } = useI18n();
  if (data.ctx?.totpEnabled) return <div className="text-sm text-[var(--success)] flex items-center gap-1"><Check size={14} /> {t('onb.sec.on', 'Two-factor authentication is on.')}</div>;
  return preview
    ? <Button size="sm" variant="primary" disabled><ShieldCheck size={14} /> {t('onb.sec.go', 'Set up 2FA')}</Button>
    : <Link to="/profile?setup2fa=1"><Button size="sm" variant="primary"><ShieldCheck size={14} /> {t('onb.sec.go', 'Set up 2FA')}</Button></Link>;
}

function NextStep({ data, chosen, lang, preview }) {
  // What the person said they came for first, then the admin's standing links.
  const fromInterests = (data.interests || []).filter((i) => chosen.includes(i.id) && i.to).map((i) => ({ id: `i-${i.id}`, label: i.label, to: i.to, icon: i.icon }));
  const all = [...fromInterests, ...(data.links || [])];
  const seen = new Set();
  const list = all.filter((l) => (seen.has(l.to) ? false : seen.add(l.to)));
  return (
    <div className="grid sm:grid-cols-2 gap-2">
      {list.map((l) => {
        const I = iconOf(l.icon);
        const inner = (
          <div className="flex items-center gap-3 rounded-xl border border-[var(--line)] px-3 py-2.5 hover:border-[var(--primary)] transition min-w-0" style={{ background: 'var(--bg-solid)' }}>
            <I size={16} className="text-[var(--accent-ink)] shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{pick(l.label, lang)}</div>
              {pick(l.desc, lang) && <div className="text-xs text-[var(--muted)]">{pick(l.desc, lang)}</div>}
            </div>
            <ArrowRight size={14} className="text-[var(--accent-ink)] shrink-0" />
          </div>
        );
        if (preview) return <div key={l.id}>{inner}</div>;
        return /^https:\/\//i.test(l.to)
          ? <a key={l.id} href={l.to} target="_blank" rel="noopener noreferrer">{inner}</a>
          : <Link key={l.id} to={l.to}>{inner}</Link>;
      })}
    </div>
  );
}

// ── The flow ───────────────────────────────────────────────────────────────────

/**
 * Draws the current step. `onAction(action, extra)` is the server round-trip; in `preview` it
 * is local. `stepOverride` lets the admin preview jump to any step.
 */
export function OnboardingFlow({ data, onAction, preview = false, stepOverride = null, previewLang = null, compact = false }) {
  const { t, lang: uiLang } = useI18n(); const { user, refresh } = useAuth(); const dialog = useDialog(); const toast = useToast();
  const lang = previewLang || uiLang;
  const defaults = useStepDefaults();
  const steps = data.steps || [];
  const current = stepOverride || data.current;
  const step = steps.find((s) => s.id === current);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(() => ({
    displayName: user?.displayName || '', bio: user?.bio || '',
    locale: user?.locale || uiLang || 'en', profilePublic: user?.profilePublic !== false,
  }));
  const [chosen, setChosen] = useState(() => data.progress?.interests || []);
  if (!step) return null;

  const idx = steps.findIndex((s) => s.id === step.id);
  const finishedCount = steps.filter((s) => s.auto || data.progress?.done.includes(s.id) || data.progress?.skipped.includes(s.id)).length;
  const pct = steps.length ? Math.round((finishedCount / steps.length) * 100) : 0;
  const title = pick(step.title, lang) || defaults[step.id]?.title;
  const body = pick(step.body, lang) || defaults[step.id]?.body;
  // D5: the admin's presentation options (all default to the behaviour before they existed).
  const ui = data.ui || {};
  const Icon = (step.icon && ONB_ICONS[step.icon]) || STEP_ICON[step.id] || Rocket;
  const continueLabel = pick(ui.continueLabel, lang) || t('onb.continue', 'Continue');
  const finishLabel = pick(ui.finishLabel, lang) || t('onb.finish', 'Finish');

  // What "Continue" saves before the step is marked done. Only the steps with a form save.
  const saveStep = async () => {
    if (preview) return true;
    try {
      if (step.id === 'profile') {
        const patch = { bio: form.bio.trim(), locale: form.locale };
        if (form.displayName.trim().length >= 2) patch.displayName = form.displayName.trim();
        await api.patch('/me', patch);
        await refresh?.();
      }
      if (step.id === 'privacy') { await api.patch('/me', { profilePublic: !!form.profilePublic }); await refresh?.(); }
      return true;
    } catch {
      toast.error(t('onb.savefail', 'Could not save this step.'));
      return false;
    }
  };
  const act = async (action) => {
    setBusy(true);
    try {
      if (action === 'done' && !(await saveStep())) return;
      await onAction(action, { step: step.id, interests: step.id === 'interests' ? chosen : undefined });
    } finally { setBusy(false); }
  };
  const dismiss = async () => {
    if (!preview && !(await dialog.confirm({ title: t('onb.dismiss.t', 'Stop the welcome tour?'), message: t('onb.dismiss.m', 'It will not come back. Everything it offers stays in your profile and settings.'), okLabel: t('onb.dismiss.ok', 'Stop it') }))) return;
    onAction('dismiss');
  };
  const last = idx === steps.length - 1;

  return (
    <Card className={compact ? 'p-4' : 'p-4 sm:p-6'} data-onboarding-step={step.id}>
      <div className="flex items-center gap-3 mb-3">
        <span className="grid place-items-center w-10 h-10 rounded-xl border border-[var(--line)] shrink-0" style={{ background: 'var(--bg-solid)' }}><Icon size={18} className="text-[var(--accent-ink)]" /></span>
        <div className="min-w-0 flex-1">
          {ui.showProgress !== false && <div className="text-[11px] uppercase tracking-wide text-[var(--faint)] font-semibold">{t('onb.stepof', 'Step {n} of {total}').replace('{n}', idx + 1).replace('{total}', steps.length)}</div>}
          <h2 className="font-semibold text-base sm:text-lg leading-tight">{title}</h2>
        </div>
        {ui.allowSnooze !== false && <button type="button" onClick={() => onAction('snooze')} className="text-[var(--faint)] hover:text-[var(--text)] p-1 shrink-0" title={t('onb.later', 'Finish later')} aria-label={t('onb.later', 'Finish later')}><X size={16} /></button>}
      </div>
      {ui.showProgress !== false && <div className="progress-track mb-4"><div className="progress-fill" style={{ width: `${pct}%` }} /></div>}
      {body && <div className="text-sm text-[var(--muted)] mb-4 whitespace-pre-line">{body}</div>}

      <div className="mb-5">
        {step.id === 'verify' && <VerifyStep data={data} preview={preview} />}
        {step.id === 'profile' && <ProfileStep preview={preview} form={form} setForm={setForm} />}
        {step.id === 'connections' && <ConnectionsStep data={data} preview={preview} />}
        {step.id === 'interests' && <InterestsStep data={data} preview={preview} chosen={chosen} setChosen={setChosen} lang={lang} />}
        {step.id === 'privacy' && <PrivacyStep data={data} preview={preview} form={form} setForm={setForm} />}
        {step.id === 'security' && <SecurityStep data={data} preview={preview} />}
        {step.id === 'next' && <NextStep data={data} chosen={chosen} lang={lang} preview={preview} />}
      </div>

      {/* D5: every group wraps. The inner group used to be a single non-wrapping row, so in
          French ("Terminer plus tard", "Ne plus afficher") at half width it ran out of the card
          instead of moving to its own line. Buttons keep their natural width (never squeezed or
          cut): a row that does not fit becomes two. */}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" className="max-w-full whitespace-normal text-start" onClick={() => act('done')} loading={busy}>
          {last ? <><Check size={14} className="shrink-0" /> {finishLabel}</> : <>{continueLabel} <ArrowRight size={14} className="shrink-0" /></>}
        </Button>
        {!last && step.skippable !== false && <Button variant="ghost" className="max-w-full whitespace-normal" onClick={() => act('skip')} disabled={busy}>{t('onb.skip', 'Skip this step')}</Button>}
        {(ui.allowSnooze !== false || ui.allowDismiss !== false) && (
          <div className="ms-auto flex flex-wrap items-center justify-end gap-1">
            {ui.allowSnooze !== false && <Button variant="ghost" size="sm" className="whitespace-normal" onClick={() => onAction('snooze')} disabled={busy}><Clock size={13} className="shrink-0" /> {t('onb.later', 'Finish later')}</Button>}
            {ui.allowDismiss !== false && <Button variant="ghost" size="sm" className="whitespace-normal" onClick={dismiss} disabled={busy}>{t('onb.dismiss', 'Do not show again')}</Button>}
          </div>
        )}
      </div>
    </Card>
  );
}

/** The server's view, and the one function that moves it. */
function useOnboarding() {
  const [data, setData] = useState(null);
  const load = useCallback(() => api.get('/me/onboarding').then(setData).catch(() => setData({ show: false })), []);
  useEffect(() => { load(); }, [load]);
  const onAction = useCallback(async (action, extra = {}) => {
    try { setData(await api.post('/me/onboarding', { action, ...extra })); }
    // 409 not_current_step: another tab (or the address being confirmed meanwhile) moved it on.
    catch { await load(); }
  }, [load]);
  return { data, onAction };
}

/** The dashboard's slot: the flow, a resume card when snoozed, or `fallback` otherwise. */
export function OnboardingSlot({ fallback = null }) {
  const { t } = useI18n();
  const { data, onAction } = useOnboarding();
  if (!data) return null;
  if (!data.show) return fallback;
  if (data.snoozed) {
    const total = data.steps.length;
    const done = data.steps.filter((s) => s.auto || data.progress.done.includes(s.id) || data.progress.skipped.includes(s.id)).length;
    return (
      <Card className="p-4 flex flex-wrap items-center gap-3">
        <Rocket size={16} className="text-[var(--accent-ink)] shrink-0" />
        <div className="text-sm font-medium flex-1 min-w-0">{t('onb.resume.t', 'Finish setting up your account')} <span className="text-[var(--muted)] tabular-nums font-normal">{done}/{total}</span></div>
        <Button size="sm" variant="primary" onClick={() => onAction('resume')}>{t('onb.resume', 'Resume')} <ArrowRight size={13} /></Button>
      </Card>
    );
  }
  return <OnboardingFlow data={data} onAction={onAction} />;
}

/** /welcome: the same flow on its own page. Nothing to show → the dashboard. */
export default function WelcomePage() {
  const { user, loading } = useAuth();
  const { data, onAction } = useOnboarding();
  // "Finish later" from this page means leaving it; the dashboard shows the resume card.
  const [left, setLeft] = useState(false);
  const act = (action, extra) => { if (action === 'snooze') setLeft(true); return onAction(action, extra); };
  if (!loading && !user) return <Navigate to="/auth" replace />;
  if (left) return <Navigate to="/dashboard" replace />;
  if (!data) return <div className="max-w-2xl mx-auto px-4 py-10"><Spinner /></div>;
  if (!data.show) return <Navigate to="/dashboard" replace />;
  return (
    <div className="max-w-2xl mx-auto px-4 py-8 sm:py-12">
      <OnboardingFlow data={data} onAction={act} />
    </div>
  );
}

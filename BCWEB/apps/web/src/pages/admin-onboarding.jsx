// Admin → Onboarding: the first-run flow new accounts walk through once (onboarding.jsx).
//
// Reads and writes /admin/onboarding (routes/onboarding.mjs, ADMIN). The admin decides which
// steps run, in what order, and what each says in English and French; the steps themselves
// (what a step DOES) are built in, so a step cannot be invented here, only arranged. A blank
// title or text means "the built-in wording", which is shown as the placeholder.
//
// The preview on the right is the real component with `preview`: it draws the draft, in the
// chosen language, and writes nothing.
import { useEffect, useMemo, useState } from 'react';
import { Rocket, ArrowUp, ArrowDown, RotateCcw, Plus, Trash2, Eye, ChevronDown, ChevronRight, Smartphone, Monitor } from 'lucide-react';
import { Card, Button, Input, Textarea, Badge, Dropdown, Spinner, Explain, useDialog, useToast } from '../ui/ui.jsx';
import { api } from '../lib/api.js';
import { useI18n, I18nLang } from '../i18n.jsx';
import { SaveBar } from '../ui/save-bar.jsx';
import { OnboardingFlow, previewData, useStepDefaults, ONB_ICONS } from './onboarding.jsx';

const clone = (v) => JSON.parse(JSON.stringify(v));
const ICON_OPTIONS = Object.keys(ONB_ICONS).map((k) => ({ value: k, label: k }));
const newId = (prefix) => `${prefix}-${Math.random().toString(36).slice(2, 7)}`;

function useStepNames() {
  const { t } = useI18n();
  return useMemo(() => ({
    verify: t('aonb.s.verify', 'Confirm the e-mail address'),
    profile: t('aonb.s.profile', 'Profile basics'),
    connections: t('aonb.s.connections', 'Link accounts'),
    interests: t('aonb.s.interests', 'Interests'),
    privacy: t('aonb.s.privacy', 'Privacy and notifications'),
    security: t('aonb.s.security', 'Two-factor authentication'),
    next: t('aonb.s.next', 'Where to go next'),
  }), [t]);
}

/** One EN/FR pair of boxes. */
function LocPair({ value, onChange, placeholder, multiline = false, max }) {
  const C = multiline ? Textarea : Input;
  return (
    <div className="grid sm:grid-cols-2 gap-2">
      {['en', 'fr'].map((l) => (
        <label key={l} className="grid gap-0.5 text-xs">
          <span className="text-[var(--faint)] uppercase font-semibold tracking-wide">{l}</span>
          <C rows={multiline ? 2 : undefined} maxLength={max} value={value?.[l] || ''} placeholder={placeholder?.[l] || ''}
            onChange={(e) => onChange({ ...(value || {}), [l]: e.target.value })} />
        </label>
      ))}
    </div>
  );
}

/** A list of {id, label, to, icon, desc?} rows — interests and next-step links share it. */
function LinkList({ items, onChange, max, withDesc, requireTo }) {
  const { t } = useI18n();
  const upd = (i, patch) => onChange(items.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <div className="space-y-2">
      {items.map((it, i) => (
        <div key={it.id} className="rounded-xl border border-[var(--line)] p-3 space-y-2" style={{ background: 'var(--bg-solid)' }}>
          <div className="flex flex-wrap items-center gap-2">
            <Dropdown size="sm" value={it.icon || ''} options={[{ value: '', label: t('aonb.noicon', 'No icon') }, ...ICON_OPTIONS]} onChange={(v) => upd(i, { icon: v })} />
            <Input className="flex-1 min-w-[9rem]" value={it.to || ''} placeholder={requireTo ? '/submit' : t('aonb.to.opt', '/path (optional)')} onChange={(e) => upd(i, { to: e.target.value })} />
            <button type="button" className="p-1.5 text-[var(--faint)] hover:text-error" onClick={() => onChange(items.filter((_, j) => j !== i))} title={t('aonb.remove', 'Remove')} aria-label={t('aonb.remove', 'Remove')}><Trash2 size={14} /></button>
          </div>
          <LocPair value={it.label} max={60} onChange={(label) => upd(i, { label })} placeholder={{ en: t('aonb.label', 'Label'), fr: t('aonb.label', 'Label') }} />
          {withDesc && <LocPair value={it.desc} max={160} onChange={(desc) => upd(i, { desc })} placeholder={{ en: t('aonb.desc', 'One line under it (optional)'), fr: t('aonb.desc', 'One line under it (optional)') }} />}
        </div>
      ))}
      {items.length < max && (
        <Button size="sm" onClick={() => onChange([...items, { id: newId(withDesc ? 'link' : 'int'), label: { en: '', fr: '' }, to: '', icon: '', ...(withDesc ? { desc: { en: '', fr: '' } } : {}) }])}>
          <Plus size={14} /> {t('aonb.add', 'Add')}
        </Button>
      )}
    </div>
  );
}

export function AdminOnboarding() {
  const { t } = useI18n(); const toast = useToast(); const dialog = useDialog();
  const names = useStepNames();
  const defaults = useStepDefaults();
  const [data, setData] = useState(null);
  const [cfg, setCfg] = useState(null);
  const [open, setOpen] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pvLang, setPvLang] = useState('en');
  const [pvStep, setPvStep] = useState(null);
  const [pvNarrow, setPvNarrow] = useState(false); // D5: judge the flow at phone width too

  const load = () => api.get('/admin/onboarding').then((r) => { setData(r); setCfg(clone(r.config)); }).catch(() => setData({ error: true }));
  useEffect(() => { load(); }, []);

  if (!data) return <Spinner />;
  if (data.error || !cfg) return <Card className="p-4 text-sm text-error">{t('aonb.loadfail', 'Could not load the onboarding settings.')}</Card>;

  const dirty = JSON.stringify(cfg) !== JSON.stringify(data.config);
  const setStep = (i, patch) => setCfg((c) => ({ ...c, steps: c.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));
  const move = (i, d) => setCfg((c) => {
    const steps = [...c.steps]; const j = i + d;
    if (j < 0 || j >= steps.length) return c;
    [steps[i], steps[j]] = [steps[j], steps[i]];
    return { ...c, steps };
  });
  // Rows the admin started and left blank would be refused by the server as a whole save.
  const cleaned = () => ({
    ...cfg,
    interests: cfg.interests.filter((x) => (x.label?.en || x.label?.fr || '').trim()).map((x) => ({ ...x, to: (x.to || '').trim() || undefined })),
    links: cfg.links.filter((x) => (x.label?.en || x.label?.fr || '').trim() && (x.to || '').trim()),
  });
  const ui = cfg.ui || {};
  const setUi = (patch) => setCfg((c) => ({ ...c, ui: { ...(c.ui || {}), ...patch } }));
  const save = async () => {
    setBusy(true);
    try {
      const r = await api.put('/admin/onboarding', { config: cleaned() });
      setData((d) => ({ ...d, config: r.config })); setCfg(clone(r.config));
      toast.success(t('aonb.saved', 'Onboarding saved.'));
    } catch (e) {
      toast.error(e?.data?.detail ? `${t('aonb.savefail', 'Not saved:')} ${e.data.detail}` : t('aonb.savefail', 'Not saved:'));
    } finally { setBusy(false); }
  };
  const reset = async () => {
    if (!(await dialog.confirm({ title: t('aonb.reset.t', 'Back to the built-in flow?'), message: t('aonb.reset.m', 'Every step comes back on, in the built-in order and wording. Nothing is saved until you press Save.'), okLabel: t('aonb.reset.ok', 'Reset the draft') }))) return;
    setCfg(clone(data.defaults));
  };

  const pv = previewData(cleaned());
  const pvCurrent = pvStep && pv.steps.some((s) => s.id === pvStep) ? pvStep : pv.current;
  const st = data.stats || {};

  return (
    <div className="space-y-4" data-admin-onboarding>
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <Rocket size={16} className="text-[var(--accent-ink)] shrink-0" />
          <div className="font-semibold flex-1 min-w-0">{t('aonb.title', 'Onboarding for new accounts')}</div>
          <Badge>{t('aonb.st.pending', '{n} in progress').replace('{n}', st.pending || 0)}</Badge>
          <Badge tone="green">{t('aonb.st.completed', '{n} completed').replace('{n}', st.completed || 0)}</Badge>
          <Badge>{t('aonb.st.skipped', '{n} skipped or stopped').replace('{n}', (st.skipped || 0) + (st.dismissed || 0))}</Badge>
        </div>
        <Explain className="text-xs mt-2" summary={t('aonb.explain.s', 'Shown once, right after an account is created.')}>
          {t('aonb.explain.d', 'Password and GitHub/Discord/Google sign-ups both get it; accounts that existed before it do not. Progress is kept on the server, so it resumes on any device. Steps that do not apply are left out on their own: no e-mail step when mail is off or the address is already confirmed, no linking step when no sign-in provider is configured.')}
        </Explain>
        <label className="flex items-center gap-2 text-sm mt-3 cursor-pointer">
          <input type="checkbox" checked={cfg.enabled} onChange={(e) => setCfg((c) => ({ ...c, enabled: e.target.checked }))} />
          {t('aonb.enabled', 'Show the onboarding to new accounts')}
        </label>
      </Card>

      <div className="grid lg:grid-cols-2 gap-4 items-start">
        <div className="space-y-4 min-w-0">
          <Card className="p-4">
            <div className="text-sm font-semibold mb-2">{t('aonb.steps', 'Steps')}</div>
            <div className="space-y-1.5">
              {cfg.steps.map((s, i) => (
                <div key={s.id} className="rounded-xl border border-[var(--line)]" style={{ background: 'var(--bg-solid)' }}>
                  <div className="flex items-center gap-2 px-2.5 py-2">
                    <input type="checkbox" checked={s.enabled} onChange={(e) => setStep(i, { enabled: e.target.checked })} aria-label={t('aonb.stepon', 'Step on')} />
                    <button type="button" className="flex items-center gap-1.5 flex-1 min-w-0 text-start text-sm" onClick={() => setOpen(open === s.id ? null : s.id)}>
                      {open === s.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      <span className={s.enabled ? 'font-medium' : 'text-[var(--faint)] line-through'}>{names[s.id]}</span>
                    </button>
                    <button type="button" className="p-1 text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)} title={t('aonb.up', 'Move up')} aria-label={t('aonb.up', 'Move up')}><ArrowUp size={14} /></button>
                    <button type="button" className="p-1 text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-30" disabled={i === cfg.steps.length - 1} onClick={() => move(i, 1)} title={t('aonb.down', 'Move down')} aria-label={t('aonb.down', 'Move down')}><ArrowDown size={14} /></button>
                    <button type="button" className="p-1 text-[var(--muted)] hover:text-[var(--text)]" onClick={() => setPvStep(s.id)} title={t('aonb.preview.this', 'Preview this step')} aria-label={t('aonb.preview.this', 'Preview this step')}><Eye size={14} /></button>
                  </div>
                  {open === s.id && (
                    <div className="px-3 pb-3 space-y-2">
                      {/* D5: the step's own icon, and whether it may be skipped. */}
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                        <label className="flex items-center gap-2 text-xs">
                          <span className="font-medium">{t('aonb.f.icon', 'Icon')}</span>
                          <Dropdown size="sm" value={s.icon || ''} options={[{ value: '', label: t('aonb.icon.builtin', 'Built-in') }, ...ICON_OPTIONS]} onChange={(v) => setStep(i, { icon: v })} />
                        </label>
                        <label className="flex items-center gap-2 text-xs cursor-pointer">
                          <input type="checkbox" checked={s.skippable !== false} onChange={(e) => setStep(i, { skippable: e.target.checked })} />
                          {t('aonb.f.skippable', 'Can be skipped')}
                        </label>
                      </div>
                      <div className="text-xs font-medium">{t('aonb.f.title', 'Title')}</div>
                      <LocPair value={s.title} max={80} onChange={(title) => setStep(i, { title })} placeholder={{ en: defaults[s.id]?.title, fr: defaults[s.id]?.title }} />
                      <div className="text-xs font-medium">{t('aonb.f.body', 'Text')}</div>
                      <LocPair multiline value={s.body} max={600} onChange={(body) => setStep(i, { body })} placeholder={{ en: defaults[s.id]?.body, fr: defaults[s.id]?.body }} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-4">
            <div className="text-sm font-semibold mb-1">{t('aonb.interests', 'Interests offered')}</div>
            <div className="text-xs text-[var(--muted)] mb-2">{t('aonb.interests.d', 'A choice with a path is suggested first in the last step.')}</div>
            <LinkList items={cfg.interests} max={12} onChange={(interests) => setCfg((c) => ({ ...c, interests }))} />
          </Card>

          <Card className="p-4">
            <div className="text-sm font-semibold mb-1">{t('aonb.links', 'Where to go next')}</div>
            <div className="text-xs text-[var(--muted)] mb-2">{t('aonb.links.d', 'An internal path (/submit) or an https:// address.')}</div>
            <LinkList items={cfg.links} max={8} withDesc requireTo onChange={(links) => setCfg((c) => ({ ...c, links }))} />
          </Card>

          {/* D5: how the flow presents itself, beyond its steps. */}
          <Card className="p-4 space-y-3">
            <div>
              <div className="text-sm font-semibold">{t('aonb.ui', 'Buttons and progress')}</div>
              <div className="text-xs text-[var(--muted)]">{t('aonb.ui.d', 'What a new member can do besides moving on. Switching an option off is enforced by the server, not only hidden.')}</div>
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {[
                ['showProgress', t('aonb.ui.progress', 'Show the progress bar and the step count')],
                ['allowSnooze', t('aonb.ui.snooze', 'Offer to finish later')],
                ['allowDismiss', t('aonb.ui.dismiss', 'Offer to stop it for good')],
              ].map(([k, label]) => (
                <label key={k} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={ui[k] !== false} onChange={(e) => setUi({ [k]: e.target.checked })} />
                  {label}
                </label>
              ))}
            </div>
            <div className="text-xs font-medium">{t('aonb.ui.continue', 'Label of the button that moves on')}</div>
            <LocPair value={ui.continueLabel} max={40} onChange={(continueLabel) => setUi({ continueLabel })} placeholder={{ en: 'Continue', fr: 'Continuer' }} />
            <div className="text-xs font-medium">{t('aonb.ui.finish', 'Label of the last button')}</div>
            <LocPair value={ui.finishLabel} max={40} onChange={(finishLabel) => setUi({ finishLabel })} placeholder={{ en: 'Finish', fr: 'Terminer' }} />
          </Card>

          {/* D1: the shared SaveBar; "Built-in flow" stays beside it as a secondary action. */}
          <SaveBar dirty={dirty} busy={busy} onSave={save} label={t('aonb.title', 'Onboarding for new accounts')}
            onDiscard={() => { const prev = cfg; setCfg(clone(data.config)); return () => setCfg(prev); }}
            extra={<Button size="sm" variant="ghost" onClick={reset} disabled={busy}><RotateCcw size={14} /> {t('aonb.reset', 'Built-in flow')}</Button>} />
        </div>

        <div className="space-y-2 min-w-0 lg:sticky lg:top-4">
          <div className="flex flex-wrap items-center gap-2">
            <Eye size={14} className="text-[var(--muted)]" />
            <span className="text-sm font-semibold flex-1">{t('aonb.preview', 'Preview')}</span>
            <Dropdown size="sm" value={pvCurrent || ''} options={pv.steps.map((s) => ({ value: s.id, label: names[s.id] }))} onChange={setPvStep} />
            <Dropdown size="sm" value={pvLang} options={[{ value: 'en', label: 'English' }, { value: 'fr', label: 'Français' }]} onChange={setPvLang} />
            <Button size="sm" variant="ghost" aria-pressed={pvNarrow} onClick={() => setPvNarrow((v) => !v)}>
              {pvNarrow ? <Monitor size={13} /> : <Smartphone size={13} />} {pvNarrow ? t('aonb.pv.wide', 'Full width') : t('aonb.pv.narrow', 'Phone width')}
            </Button>
          </div>
          {!cfg.enabled && <div className="text-xs text-warning">{t('aonb.off', 'Switched off: nobody sees it until it is back on and saved.')}</div>}
          {pv.steps.length
            // D5: the whole flow in the preview's language (I18nLang), buttons included, and
            // optionally at phone width, so "does it hold in French on a phone" is answered by
            // looking at it.
            ? (
              <div className={pvNarrow ? 'max-w-[360px] mx-auto' : ''}>
                <I18nLang lang={pvLang}>
                  <OnboardingFlow key={`${pvCurrent}-${pvLang}`} data={pv} preview stepOverride={pvCurrent} previewLang={pvLang} onAction={() => {}} compact />
                </I18nLang>
              </div>
            )
            : <Card className="p-4 text-sm text-[var(--muted)]">{t('aonb.nosteps', 'Every step is off.')}</Card>}
        </div>
      </div>
    </div>
  );
}

export default AdminOnboarding;

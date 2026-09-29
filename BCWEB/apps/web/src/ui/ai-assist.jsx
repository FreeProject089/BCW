// The AI helpers a member sees while writing something (aios, agent-bcw-ai-os): suggest tags,
// detect the language, draft a description, check before posting. The rules, quotas and
// providers are the API's (routes/ai-features.mjs); this only draws what GET /ai/me says is
// available and says, next to every button, WHERE the text would go.
//
// It degrades, it never breaks: a feature the site switched off is not drawn; tags and
// language fall back to plain word matching on our server when no AI is on; a generative
// feature with no key says how to get one (your own key in Settings, or a plan that has it).
// Nothing here is required to submit: the form works the same with every helper gone.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles, Tags, Languages, PenLine, ShieldCheck, ThumbsDown, Loader2 } from 'lucide-react';
import { Button, useToast } from './ui.jsx';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';

// One /ai/me per page load, shared by every helper on the page; refreshed after a use (the
// "used today" counter moves) by calling reloadAiMe().
let meProbe = null;
const listeners = new Set();
export function reloadAiMe() {
  meProbe = api.get('/ai/me').catch(() => null);
  meProbe.then((v) => { for (const l of listeners) l(v); });
  return meProbe;
}
export function useAiMe(enabled = true) {
  const [me, setMe] = useState(null);
  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    const on = (v) => { if (live) setMe(v); };
    listeners.add(on);
    (meProbe || reloadAiMe()).then(on);
    return () => { live = false; listeners.delete(on); };
  }, [enabled]);
  return me;
}

/** Where the text goes, in one sentence. `source` is what /ai/me or the answer said. */
export function useAiWhere() {
  const { t } = useI18n();
  return (source, host) => {
    switch (source) {
      case 'laya': return t('aia.where.laya', 'Checked by Laya, the AI that runs on our own server. Nothing leaves BetterCommunity.');
      case 'external': return t('aia.where.external', 'Sent to the AI provider this site uses (named in the privacy policy), then discarded. Not stored here.');
      case 'byok': return t('aia.where.byok', 'Sent to {h} with your own key. Their terms apply; we keep only a count.').replace('{h}', host || '?');
      case 'site': return t('aia.where.site', 'Sent to {h}, the AI provider this site pays for. We keep only a count.').replace('{h}', host || '?');
      case 'local': return t('aia.where.local', 'Worked out on our server by simple word matching. No AI is involved.');
      case 'rules': return t('aia.where.rules', 'Checked by the site\'s moderation rules. No AI is involved.');
      default: return '';
    }
  };
}

const REASON = (t) => ({
  feature_off: t('aia.r.off', 'This helper is switched off on this site.'),
  plan_required: t('aia.r.plan', 'This helper comes with a paid plan, or with your own AI key.'),
  staff_only: t('aia.r.staff', 'Staff only.'),
  no_key: t('aia.r.nokey', 'Add your own AI key in Settings to use this.'),
  key_unreadable: t('aia.r.unreadable', 'Your saved key can no longer be read. Enter it again in Settings.'),
  key_rejected: t('aia.r.rejected', 'Your AI provider refused the key. Check it in Settings.'),
  quota_reached: t('aia.r.quota', 'You reached today\'s limit for this helper. It resets at midnight (UTC).'),
  rate_limited: t('aia.r.rate', 'Too many requests. Wait a minute and try again.'),
  busy: t('aia.r.busy', 'The AI is busy. Try again in a moment.'),
  disabled: t('aia.r.disabled', 'The AI is off on this site right now.'),
  unavailable: t('aia.r.unavail', 'The AI did not answer. Nothing was changed; try again later.'),
});

async function post(url, body) {
  try { return await api.post(url, body); } catch (e) { return { ok: false, reason: e?.data?.error || e?.data?.reason || 'unavailable' }; }
}

/**
 * The helper bar under a text field.
 *   kind       what is being written ('plugin' | 'theme' | 'app' | 'preset' | 'catalog' | 'repo')
 *   name       its name (for the description draft)
 *   text       the current text (description)
 *   tagOptions the tags this form offers (the suggestions are always a subset)
 *   onTags(list) / onDescription(text) — applied only when the member presses the button
 */
export default function AiAssist({ kind = 'plugin', name = '', text = '', tagOptions = null, onTags, onDescription, className = '' }) {
  const { t } = useI18n();
  const toast = useToast();
  const me = useAiMe();
  const where = useAiWhere();
  const R = REASON(t);
  const [busy, setBusy] = useState(null);
  const [check, setCheck] = useState(null);   // { level, categories, source }
  const [lang, setLang] = useState(null);     // { lang, source }
  const [note, setNote] = useState(null);     // the last disclosure shown
  if (!me?.features) return null;
  const f = me.features;
  const can = (id) => f[id]?.available;
  const shown = ['suggest_tags', 'detect_language', 'describe', 'content_check'].filter((id) => f[id] && (f[id].available || f[id].reason === 'plan_required' || f[id].reason === 'no_key'));
  if (!shown.length) return null;
  const long = String(text || '').trim().length >= 12;
  const fail = (r) => toast.error(R[r] || R.unavailable);

  const run = async (id, fn) => { setBusy(id); try { await fn(); } finally { setBusy(null); reloadAiMe(); } };
  const tags = () => run('tags', async () => {
    const r = await post('/ai/suggest', { task: 'tags', text: `${name}\n${text}`.slice(0, 6000), options: (tagOptions || []).slice(0, 60) });
    if (!r?.ok) return fail(r?.error || r?.reason);
    const list = (r.result?.tags || []).map((x) => x.tag);
    setNote(where(r.source === 'ai' ? r.provider : 'local'));
    if (!list.length) return toast.info(t('aia.tags.none', 'No tag from the list fits this text clearly.'));
    onTags?.(list);
    toast.success(t('aia.tags.done', 'Suggested: {l}. Review them before you submit.').replace('{l}', list.join(', ')));
  });
  const detect = () => run('lang', async () => {
    const r = await post('/ai/suggest', { task: 'language', text: text.slice(0, 6000) });
    if (!r?.ok) return fail(r?.error || r?.reason);
    setLang({ lang: r.result?.lang || null, source: r.source === 'ai' ? r.provider : 'local' });
    setNote(where(r.source === 'ai' ? r.provider : 'local'));
  });
  const describe = () => run('describe', async () => {
    const r = await post('/ai/describe', { kind, name: name.trim() || t('aia.untitled', 'Untitled'), notes: text.slice(0, 4000), lang: document?.documentElement?.lang === 'fr' ? 'fr' : 'en' });
    if (!r?.ok) return fail(r?.error || r?.reason);
    setNote(where(r.provider, r.host));
    onDescription?.(r.text);
    toast.success(t('aia.desc.done', 'Draft written into the description. Edit it: you are the author.'));
  });
  const doCheck = () => run('check', async () => {
    const r = await post('/ai/check', { text: `${name}\n${text}`.slice(0, 8000) });
    if (!r?.ok) return fail(r?.error || r?.reason);
    setCheck({ level: r.level, categories: r.categories || [], source: r.ai ? (me.classifier || 'laya') : 'rules' });
    setNote(where(r.ai ? (me.classifier || 'laya') : 'rules'));
  });
  const wrong = async () => {
    await post('/ai/feedback', { feature: 'content_check', verdict: 'wrong' });
    setCheck(null);
    toast.success(t('aia.fb.thanks', 'Thanks. Staff see how often the check is wrong and tune it.'));
  };
  const CAT = {
    links: t('aia.cat.links', 'a link that looks risky'), tone: t('aia.cat.tone', 'a tone that may read as hostile'),
    spam: t('aia.cat.spam', 'something that looks like spam or a repeat'), shape: t('aia.cat.shape', 'unusual formatting (capitals, repeated or hidden characters)'),
    wording: t('aia.cat.wording', 'words the moderators watch for'), wellbeing: t('aia.cat.wellbeing', 'words about self-harm'),
    topic: t('aia.cat.topic', 'content that may be off topic'), legal: t('aia.cat.legal', 'a legal threat'),
  };
  const LANG = { en: 'English', fr: 'Français', de: 'Deutsch', es: 'Español', it: 'Italiano', pt: 'Português', nl: 'Nederlands', pl: 'Polski', ru: 'Русский', tr: 'Türkçe', zh: '中文', ja: '日本語', other: t('aia.lang.other', 'another language') };
  const btn = (id, key, icon, label, onClick, disabled) => {
    const Icon = icon;
    const locked = !can(id);
    return (
      <Button size="sm" variant="ghost" onClick={locked ? undefined : onClick} disabled={disabled || locked || !!busy}
        title={locked ? R[f[id]?.reason] : `${label}. ${f[id]?.used != null ? t('aia.used', '{u} of {a} today').replace('{u}', f[id].used).replace('{a}', f[id].allowance) : ''}`}>
        {busy === key ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Icon size={14} aria-hidden />} {label}
      </Button>
    );
  };
  return (
    <div className={`rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-2.5 text-xs ${className}`}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center gap-1 font-medium text-[var(--muted)] me-1"><Sparkles size={13} className="text-[var(--accent-ink)]" aria-hidden />{t('aia.title', 'Helpers')}</span>
        {f.suggest_tags && tagOptions?.length > 1 && btn('suggest_tags', 'tags', Tags, t('aia.tags', 'Suggest tags'), tags, !long)}
        {f.detect_language && btn('detect_language', 'lang', Languages, t('aia.lang', 'Detect language'), detect, !long)}
        {f.describe && onDescription && btn('describe', 'describe', PenLine, t('aia.desc', 'Draft a description'), describe, !name.trim())}
        {f.content_check && btn('content_check', 'check', ShieldCheck, t('aia.check', 'Check before posting'), doCheck, !long)}
      </div>
      {lang && (
        <p className="mt-2">{lang.lang ? t('aia.lang.is', 'This text looks like {l}.').replace('{l}', LANG[lang.lang] || lang.lang) : t('aia.lang.unsure', 'Too short to tell the language.')}</p>
      )}
      {check && (
        <div className={`mt-2 rounded-lg p-2 border ${check.level === 'ok' ? 'border-[var(--line)]' : 'border-[var(--line-strong)]'}`} role="status">
          {check.level === 'ok'
            ? <p>{t('aia.check.ok', 'Nothing here is likely to be held for review.')}</p>
            : <>
                <p className="font-medium">{check.level === 'likely' ? t('aia.check.likely', 'This is likely to be held for a moderator before it is shown.') : t('aia.check.maybe', 'This might be held for a moderator.')}</p>
                {check.categories.length > 0 && <p className="mt-0.5 text-[var(--muted)]">{t('aia.check.because', 'Because of: {c}.').replace('{c}', check.categories.map((c) => CAT[c] || c).join(', '))}</p>}
                <button type="button" onClick={wrong} className="mt-1 inline-flex items-center gap-1 text-[var(--muted)] hover:text-[var(--text)] underline-offset-2 hover:underline">
                  <ThumbsDown size={12} aria-hidden />{t('aia.check.wrong', 'This warning is wrong')}
                </button>
              </>}
        </div>
      )}
      {note && <p className="mt-2 text-[11px] text-[var(--faint)]">{note}</p>}
      {(f.describe?.reason === 'no_key' || f.describe?.reason === 'plan_required') && onDescription && (
        <p className="mt-1.5 text-[11px] text-[var(--faint)]">
          {R[f.describe.reason]} <Link to="/settings#ai" className="underline">{t('aia.settings', 'AI settings')}</Link>
        </p>
      )}
    </div>
  );
}

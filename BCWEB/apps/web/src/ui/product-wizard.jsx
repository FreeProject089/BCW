// The seller's "New product" / "Edit product" modal as a four-step wizard.
//
// Basics → Files & delivery → Pricing → Preview & publish. The old form was one long modal
// with every field for every delivery kind on it at once, and the two failure modes were the
// same one: the seller lost work. A mis-click outside the modal closed it and the form was
// gone; a validation error surfaced as a toast AFTER the save, naming one field, with no
// pointer to it. So:
//
//   - every keystroke lands in sessionStorage under the product's id (or "new"), and the
//     next open of the same product restores it — an accidental close costs nothing;
//   - each step validates on Next, inline, under the field that is wrong;
//   - the step indicator is clickable for steps already visited, so "go back and change the
//     price" is one click, and jumping ahead past an unvisited step is not possible;
//   - "Save draft" from any step keeps the draft and closes; nothing reaches the API until
//     the last step's Publish, and the payload it sends is the one the old form sent.
//
// The wizard owns navigation and validation. It does NOT own the draft: the parent keeps it
// in state, because the file-upload slot (which posts to the API and needs the product id)
// and the payload builder both live there, and moving the draft here would mean moving them.
import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Save, RotateCcw, FileText, Package, Coins, Eye, HelpCircle } from 'lucide-react';
import { Button, Field, Input, Textarea, Select, Modal } from './ui.jsx';
import { useI18n } from '../i18n.jsx';
import { DELIVERY_KINDS, DELIVERY_BY_V, BILLING_MODES, mkdKey } from '../lib/marketplace-delivery.js';

const STEPS = ['basics', 'delivery', 'pricing', 'review'];
const STEP_ICON = { basics: FileText, delivery: Package, pricing: Coins, review: Eye };

/** Where a draft is kept between opens. sessionStorage, not localStorage: a draft belongs to
 *  this tab's session, and a secret typed into "fixed key" must not outlive it. */
export const draftKey = (id) => `bcw.mk.draft.${id || 'new'}`;

export function readDraft(id) {
  try {
    const raw = sessionStorage.getItem(draftKey(id));
    const v = raw ? JSON.parse(raw) : null;
    return v && typeof v === 'object' && v.draft && typeof v.draft === 'object' ? v : null;
  } catch { return null; }
}
export function writeDraft(id, draft, step) {
  try { sessionStorage.setItem(draftKey(id), JSON.stringify({ savedAt: Date.now(), step, draft })); } catch { /* quota, private mode */ }
}
export function clearDraft(id) {
  try { sessionStorage.removeItem(draftKey(id)); } catch { /* nothing to clear */ }
}

const isUrl = (s) => { try { const u = new URL(String(s || '')); return u.protocol === 'http:' || u.protocol === 'https:'; } catch { return false; } };

/**
 * Per-step validation, returned as { field: message }. Pure, so a test can call it and so the
 * final Publish can run every step and jump to the first one that fails.
 * @param t the translator — messages are user-facing.
 */
export function validateStep(step, d, t) {
  const e = {};
  const has = (v) => String(v ?? '').trim().length > 0;
  if (step === 'basics') {
    if (!has(d.name)) e.name = t('mkw.err.name', 'Give the product a name.');
    if (!has(d.projectKey) && !has(d.showcaseProjectId)) e.target = t('mkw.err.target', 'Pick the page this product is sold on.');
  } else if (step === 'delivery') {
    switch (d.deliveryKind) {
      case 'content': if (!has(d.content)) e.content = t('mkw.err.content', 'Write what the buyer receives.'); break;
      case 'key_static': if (!has(d.staticKey)) e.staticKey = t('mkw.err.static', 'Enter the key every buyer gets.'); break;
      case 'role': if (!has(d.roleId)) e.roleId = t('mkw.err.role', 'Enter the Discord role id.'); break;
      case 'key_external':
        if (!isUrl(d.externalUrl)) e.externalUrl = t('mkw.err.exturl', 'Enter the generator URL (https://…).');
        if (!d.id && !has(d.externalSecret)) e.externalSecret = t('mkw.err.extsecret', 'A new external generator needs its shared secret.');
        break;
      case 'link': if (!isUrl(d.linkUrl)) e.linkUrl = t('mkw.err.link', 'Enter the link handed over (https://…).'); break;
      default: break;
    }
    if (has(d.redeemUrl) && !isUrl(d.redeemUrl)) e.redeemUrl = t('mkw.err.redeemurl', 'That link must start with http:// or https://.');
  } else if (step === 'pricing') {
    const price = Number(d.priceCents);
    if (!Number.isFinite(price) || price < 0) e.priceCents = t('mkw.err.price', 'The price cannot be negative.');
    if (price > 0 && price < 50) e.priceCents = t('mkw.err.pricemin', 'Stripe needs at least 0.50, or set 0 for a free product.');
    if (!/^[a-z]{3}$/i.test(String(d.currency || ''))) e.currency = t('mkw.err.currency', 'A three-letter currency code (usd, eur, chf…).');
    if (d.stock !== '' && d.stock != null && (!Number.isInteger(Number(d.stock)) || Number(d.stock) < 0)) e.stock = t('mkw.err.stock', 'Stock is a whole number, or blank for unlimited.');
    if (d.billing === 'subscription' && price <= 0) e.billing = t('mkw.err.subfree', 'A subscription needs a price, a free product cannot recur.');
    if (d.feePercentBp !== '' && d.feePercentBp != null && (Number(d.feePercentBp) < 0 || Number(d.feePercentBp) > 10000)) e.feePercentBp = t('mkw.err.fee', 'The margin is between 0 and 100%.');
  }
  return e;
}

/** Inline error under a field: the thing the old toast never did — say WHERE. */
function Err({ msg }) {
  if (!msg) return null;
  return <p className="text-xs text-error mt-1" role="alert">{msg}</p>;
}

/** The step rail: numbered, clickable once visited, never past the frontier. */
function StepRail({ step, visited, errors, onGo, t }) {
  const labels = { basics: t('mkw.s.basics', 'Basics'), delivery: t('mkw.s.delivery', 'Files & delivery'), pricing: t('mkw.s.pricing', 'Pricing'), review: t('mkw.s.review', 'Preview & publish') };
  const cur = STEPS.indexOf(step);
  return (
    <ol className="flex items-center gap-1 sm:gap-2 mb-4 overflow-x-auto" aria-label={t('mkw.steps', 'Steps')}>
      {STEPS.map((s, i) => {
        const Icon = STEP_ICON[s];
        const done = visited.has(s) && i < cur && !Object.keys(errors[s] || {}).length;
        const can = visited.has(s) || i === cur;
        const state = i === cur ? 'current' : done ? 'done' : can ? 'visited' : 'upcoming';
        return (
          <li key={s} className="flex items-center gap-1 sm:gap-2 shrink-0">
            <button type="button" disabled={!can} onClick={() => can && onGo(s)} aria-current={i === cur ? 'step' : undefined}
              title={can ? labels[s] : t('mkw.s.locked', 'Finish the steps before it first')}
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs border transition ${
                state === 'current' ? 'border-[var(--primary)] bg-[var(--primary)] text-[var(--on-primary)]'
                  : state === 'done' ? 'border-[var(--success)] text-[var(--success)] hover:bg-[var(--surface-2)]'
                    : state === 'visited' ? 'border-[var(--line)] text-[var(--text)] hover:bg-[var(--surface-2)]'
                      : 'border-[var(--line)] text-[var(--faint)] cursor-not-allowed'}`}>
              <span className={`inline-flex items-center justify-center w-4 h-4 rounded-full text-[10px] font-semibold ${state === 'current' ? 'bg-white/20' : state === 'done' ? 'bg-[var(--success)] text-white' : 'bg-[var(--surface-2)]'}`}>
                {state === 'done' ? <Check size={10} /> : i + 1}
              </span>
              <Icon size={12} className="hidden sm:inline" />
              <span>{labels[s]}</span>
            </button>
            {i < STEPS.length - 1 && <ChevronRight size={12} className="text-[var(--faint)]" />}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * @param draft            the product draft (parent state)
 * @param setDraft         its setter — the wizard calls it to restore a kept draft and on every field change
 * @param onClose          close without publishing (the draft is kept)
 * @param onPublish        the parent's save: builds the API payload from `draft` and posts it. Resolves true on success.
 * @param targets          [{ v, label, group }] pages a product can be sold on
 * @param targetOf/setTarget  the page picker's read/write helpers (parent-owned, they touch two fields)
 * @param isSuper          may edit the platform margin
 * @param defaultFeeBp     the site default, for the placeholder and the read-only line
 * @param fileSlot         the parent-rendered file upload control (needs its ref + the product id)
 * @param filePointer, feePointer   the parent's SettingsPointer nodes (they know the settings tabs)
 * @param renderExplainer  (v) => node — the per-kind explanation, rendered by the parent
 */
export function ProductWizard({ draft, setDraft, onClose, onPublish, targets, targetOf, setTarget, isSuper, defaultFeeBp, fileSlot, filePointer, feePointer, renderExplainer }) {
  const { t } = useI18n();
  const id = draft?.id || null;
  const [step, setStep] = useState('basics');
  const [visited, setVisited] = useState(() => new Set(['basics']));
  const [showErrors, setShowErrors] = useState({});   // step -> true once Next was pressed there
  const [restored, setRestored] = useState(false);     // a kept draft was put back — say so, offer to discard
  const [publishing, setPublishing] = useState(false);
  const [explain, setExplain] = useState(false);
  const [restoreChecked, setRestoreChecked] = useState(false);

  // Restore a kept draft on open. Only once, and only if it differs from what the parent gave
  // us (an edit re-opened from the list should not silently swap the server's row for a stale
  // local copy without the notice below).
  useEffect(() => {
    if (restoreChecked) return;
    setRestoreChecked(true);
    const kept = readDraft(id);
    if (!kept) return;
    const same = JSON.stringify({ ...kept.draft, id: undefined }) === JSON.stringify({ ...draft, id: undefined });
    if (same) return;
    setDraft((d) => ({ ...d, ...kept.draft, id: d?.id || kept.draft.id }));
    if (STEPS.includes(kept.step)) { setStep(kept.step); setVisited(new Set(STEPS.slice(0, STEPS.indexOf(kept.step) + 1))); }
    setRestored(true);
  }, [restoreChecked, id, draft, setDraft]);

  // Keep the draft after every change. Cheap (one small JSON), and the reason an accidental
  // close costs nothing.
  useEffect(() => { if (draft && restoreChecked) writeDraft(id, draft, step); }, [draft, step, id, restoreChecked]);

  const errors = useMemo(() => Object.fromEntries(STEPS.map((s) => [s, validateStep(s, draft || {}, t)])), [draft, t]);
  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }));
  const cur = STEPS.indexOf(step);
  const err = (k) => (showErrors[step] ? errors[step][k] : undefined);

  const go = (s) => { setStep(s); setVisited((v) => new Set([...v, s])); };
  const next = () => {
    if (Object.keys(errors[step]).length) { setShowErrors((x) => ({ ...x, [step]: true })); return; }
    if (cur < STEPS.length - 1) go(STEPS[cur + 1]);
  };
  const back = () => { if (cur > 0) go(STEPS[cur - 1]); };
  const saveDraft = () => { writeDraft(id, draft, step); onClose({ kept: true }); };
  const discardRestored = () => { clearDraft(id); setRestored(false); onClose({ discarded: true }); };
  const publish = async () => {
    // Every step, not just this one: a field changed on step 1 after step 3 was validated is
    // exactly the case a per-step check misses.
    const bad = STEPS.find((s) => Object.keys(errors[s]).length);
    if (bad) { setShowErrors(Object.fromEntries(STEPS.map((s) => [s, true]))); go(bad); return; }
    setPublishing(true);
    try {
      const ok = await onPublish();
      if (ok) clearDraft(id);
    } finally { setPublishing(false); }
  };

  const money = (c, cur) => `${(Number(c || 0) / 100).toFixed(2)} ${String(cur || 'usd').toUpperCase()}`;
  const kindLabel = t(mkdKey(draft.deliveryKind, 'l'), (DELIVERY_BY_V[draft.deliveryKind] || {}).label || draft.deliveryKind);
  const targetLabel = targets.find((x) => x.v === targetOf(draft))?.label || '';
  const feeShown = draft.feePercentBp === '' || draft.feePercentBp == null ? defaultFeeBp : Number(draft.feePercentBp);

  const footer = (
    <div className="flex items-center justify-between gap-2 w-full flex-wrap">
      <div className="flex items-center gap-2">
        <Button variant="ghost" onClick={() => onClose({ kept: true })}>{t('common.cancel', 'Cancel')}</Button>
        <Button variant="ghost" onClick={saveDraft} title={t('mkw.savedraft.h', 'Keeps everything typed so far in this browser tab; nothing is sent.')}><Save size={14} /> {t('mkw.savedraft', 'Save draft')}</Button>
      </div>
      <div className="flex items-center gap-2">
        {cur > 0 && <Button variant="ghost" onClick={back}><ChevronLeft size={14} /> {t('mkw.back', 'Back')}</Button>}
        {step !== 'review'
          ? <Button variant="primary" onClick={next}>{t('mkw.next', 'Next')} <ChevronRight size={14} /></Button>
          : <Button variant="primary" loading={publishing} onClick={publish}>{draft.id ? t('common.save', 'Save') : t('mkw.publish', 'Publish')}</Button>}
      </div>
    </div>
  );

  return (
    <Modal open onClose={() => onClose({ kept: true })} width="max-w-2xl" footer={footer}
      title={draft.id ? t('mkadm.edit', 'Edit product') : t('mkadm.new', 'New product')}>
      <StepRail step={step} visited={visited} errors={errors} onGo={go} t={t} />
      {restored && (
        <div className="mb-3 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 text-xs flex items-center gap-2 flex-wrap">
          <RotateCcw size={13} className="text-[var(--accent-ink)] shrink-0" />
          <span className="flex-1">{t('mkw.restored', 'Picked up where you left off, this is your unsaved draft, not what is published.')}</span>
          <Button size="sm" variant="ghost" onClick={discardRestored}>{t('mkw.restored.discard', 'Discard draft')}</Button>
        </div>
      )}
      <div className="text-[11px] text-[var(--faint)] mb-3">{t('mkw.stepn', 'Step {n} of {m}').replace('{n}', String(cur + 1)).replace('{m}', String(STEPS.length))}</div>

      {step === 'basics' && (
        <div className="space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label={t('mkadm.f.name', 'Name')}>
              <Input value={draft.name} onChange={(e) => set('name', e.target.value)} aria-invalid={!!err('name')} autoFocus />
              <Err msg={err('name')} />
            </Field>
            <Field label={t('mkadm.f.project2', 'Sold on which page')} hint={t('mkadm.f.project2.h', 'A product with no page is a product nobody can find.')}>
              <Select value={targetOf(draft)} onChange={(e) => setTarget(e.target.value)} aria-invalid={!!err('target')}>
                <option value="">{t('mkadm.f.pick', '— pick a page —')}</option>
                {targets.filter((x) => x.group === 'project').length > 0 && (
                  <optgroup label={t('mkadm.g.projects', 'Projects')}>
                    {targets.filter((x) => x.group === 'project').map((x) => <option key={x.v} value={x.v}>{x.label}</option>)}
                  </optgroup>
                )}
                {targets.filter((x) => x.group === 'showcase').length > 0 && (
                  <optgroup label={t('mkadm.g.showcase', 'Other projects')}>
                    {targets.filter((x) => x.group === 'showcase').map((x) => <option key={x.v} value={x.v}>{x.label}</option>)}
                  </optgroup>
                )}
              </Select>
              <Err msg={err('target')} />
            </Field>
          </div>
          <Field label={t('mkadm.f.desc', 'Description')}><Textarea rows={3} value={draft.description} onChange={(e) => set('description', e.target.value)} /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!draft.active} onChange={(e) => set('active', e.target.checked)} /> {t('mkadm.f.active', 'Active (visible in the storefront)')}</label>
        </div>
      )}

      {step === 'delivery' && (
        <div className="space-y-3">
          <Field label={t('mkadm.f.delivery', 'Delivery')} hint={t(mkdKey(draft.deliveryKind, 'd'), (DELIVERY_BY_V[draft.deliveryKind] || {}).desc || '')}>
            <Select value={draft.deliveryKind} onChange={(e) => set('deliveryKind', e.target.value)}>
              {DELIVERY_KINDS.map((o) => <option key={o.v} value={o.v}>{t(mkdKey(o.v, 'l'), o.label)}</option>)}
            </Select>
          </Field>
          <button type="button" onClick={() => setExplain((x) => !x)} className="text-[11px] text-[var(--accent-ink)] hover:underline inline-flex items-center gap-1">
            <HelpCircle size={12} /> {explain ? t('mkadm.exp.hide', 'Hide the explanation') : t('mkadm.exp.show', 'What do these mean?')}
          </button>
          {explain && renderExplainer && (
            <div className="space-y-2">
              {renderExplainer(draft.deliveryKind)}
              <details className="text-[11px]">
                <summary className="cursor-pointer text-[var(--muted)] hover:text-[var(--text)]">{t('mkadm.exp.all', 'Compare all eight')}</summary>
                <div className="mt-2 space-y-2">
                  {DELIVERY_KINDS.filter((d) => d.v !== draft.deliveryKind).map((d) => <div key={d.v}>{renderExplainer(d.v)}</div>)}
                </div>
              </details>
            </div>
          )}
          {draft.deliveryKind === 'content' && <Field label={t('mkadm.f.content', 'Content delivered')}><Textarea rows={3} value={draft.content} onChange={(e) => set('content', e.target.value)} aria-invalid={!!err('content')} /><Err msg={err('content')} /></Field>}
          {draft.deliveryKind === 'key_static' && <Field label={t('mkadm.f.static', 'Fixed key')}><Input value={draft.staticKey} onChange={(e) => set('staticKey', e.target.value)} aria-invalid={!!err('staticKey')} /><Err msg={err('staticKey')} /></Field>}
          {draft.deliveryKind === 'role' && <Field label={t('mkadm.f.role', 'Discord role id')}><Input value={draft.roleId} onChange={(e) => set('roleId', e.target.value)} aria-invalid={!!err('roleId')} /><Err msg={err('roleId')} /></Field>}
          {draft.deliveryKind === 'key_external' && (<>
            <Field label={t('mkadm.f.exturl', 'External generator URL')}><Input value={draft.externalUrl} onChange={(e) => set('externalUrl', e.target.value)} placeholder="https://…/generate" aria-invalid={!!err('externalUrl')} /><Err msg={err('externalUrl')} /></Field>
            <Field label={t('mkadm.f.extsecret', 'Shared secret (HMAC)')} hint={t('mkadm.f.extsecret.h', 'Sent as X-BC-Signature = HMAC-SHA256(body). Blank keeps the current one.')}><Input value={draft.externalSecret} onChange={(e) => set('externalSecret', e.target.value)} aria-invalid={!!err('externalSecret')} /><Err msg={err('externalSecret')} /></Field>
          </>)}
          {draft.deliveryKind === 'key_license' && <p className="text-xs text-[var(--muted)] rounded-lg border border-[var(--line)] p-2.5">{t('mkadm.f.license.h', 'Nothing to set: every buyer gets a key nobody else has, minted at purchase and recorded on it. Unlimited supply, unlike a pool, and traceable, unlike a fixed key.')}</p>}
          {draft.deliveryKind === 'key_pool' && <p className="text-xs text-[var(--muted)] rounded-lg border border-[var(--line)] p-2.5">{t('mkw.pool.h', 'Keys are added from the product list once it is saved — "Add keys" to paste your own, or "Generate" to have some minted here. Each buyer is handed one.')}</p>}
          {draft.deliveryKind === 'link' && <Field label={t('mkadm.f.link', 'Link handed over')} hint={t('mkadm.f.link.h', 'Shown as a button after the purchase. Use this for a page you control; for a file, the File delivery keeps the address from being forwardable.')}><Input value={draft.linkUrl} onChange={(e) => set('linkUrl', e.target.value)} placeholder="https://…" aria-invalid={!!err('linkUrl')} /><Err msg={err('linkUrl')} /></Field>}
          {draft.deliveryKind === 'file' && (
            draft.id
              ? <Field label={t('mkadm.f.file', 'File handed over')} hint={t('mkadm.f.file.h', 'Held in the platform’s own storage. Each download is a fresh link that expires in ten minutes, so it cannot be passed on to somebody who did not buy it.')}>
                {fileSlot}
                {filePointer}
              </Field>
              : <p className="text-xs text-warning rounded-lg border border-[var(--line)] p-2.5">{t('mkadm.f.file.first', 'Save the product first, then re-open it to attach the file.')}</p>
          )}
          <div className="rounded-lg border border-[var(--line)] p-3 space-y-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--faint)]">{t('mkadm.redeem.h', 'Where the buyer uses it')}</div>
            <Field label={t('mkadm.f.redeemurl', 'Link to your site or app')} hint={t('mkadm.f.redeemurl.h', 'The page that redeems the key, the app to open, the docs. Shown as a button on the product and on the purchase.')}>
              <Input value={draft.redeemUrl || ''} onChange={(e) => set('redeemUrl', e.target.value)} placeholder="https://…" aria-invalid={!!err('redeemUrl')} />
              <Err msg={err('redeemUrl')} />
            </Field>
            <Field label={t('mkadm.f.redeemnote', 'How to use it')} hint={t('mkadm.f.redeemnote.h', 'One or two sentences. Sign in, open Settings, paste the key, that kind of thing.')}>
              <Textarea rows={2} value={draft.redeemNote || ''} onChange={(e) => set('redeemNote', e.target.value)} />
            </Field>
          </div>
        </div>
      )}

      {step === 'pricing' && (
        <div className="space-y-3">
          <div className="grid sm:grid-cols-3 gap-3">
            <Field label={t('mkadm.f.price', 'Price (0 = free)')}>
              <Input type="number" min="0" step="0.01" value={Number(draft.priceCents || 0) / 100} onChange={(e) => set('priceCents', Math.round((Number(e.target.value) || 0) * 100))} aria-invalid={!!err('priceCents')} />
              <Err msg={err('priceCents')} />
            </Field>
            <Field label={t('mkadm.f.currency', 'Currency')}>
              <Input value={draft.currency} onChange={(e) => set('currency', e.target.value.toLowerCase())} aria-invalid={!!err('currency')} />
              <Err msg={err('currency')} />
            </Field>
            <Field label={t('mkadm.f.stock', 'Stock (blank = ∞)')}>
              <Input type="number" min="0" value={draft.stock} onChange={(e) => set('stock', e.target.value)} aria-invalid={!!err('stock')} />
              <Err msg={err('stock')} />
            </Field>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label={t('mkadm.f.billing', 'Billing')} hint={t(`mkadm.bill.d.${draft.billing || 'one_time'}`, (BILLING_MODES.find((m) => m.v === (draft.billing || 'one_time')) || {}).desc || '')}>
              <Select value={draft.billing || 'one_time'} onChange={(e) => set('billing', e.target.value)} aria-invalid={!!err('billing')}>
                {BILLING_MODES.map((m) => <option key={m.v} value={m.v}>{t(`mkadm.bill.l.${m.v}`, m.label)}</option>)}
              </Select>
              <Err msg={err('billing')} />
            </Field>
            {draft.billing === 'subscription' && (
              <Field label={t('mkadm.f.interval', 'Billed every')} hint={t('mkadm.f.interval.h', 'Changing this, the price or the currency mints a new Stripe price; people already subscribed keep the one they signed up on.')}>
                <Select value={String(draft.intervalMonths || 1)} onChange={(e) => set('intervalMonths', Number(e.target.value))}>
                  <option value="1">{t('mkadm.iv.1', 'month')}</option>
                  <option value="3">{t('mkadm.iv.3', '3 months')}</option>
                  <option value="6">{t('mkadm.iv.6', '6 months')}</option>
                  <option value="12">{t('mkadm.iv.12', 'year')}</option>
                </Select>
              </Field>
            )}
          </div>
          <div className="rounded-lg border border-[var(--line)] p-3 space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--faint)]">{t('mkadm.fee.h', 'Platform margin')}</div>
            {isSuper ? (
              <Field label={t('mkadm.f.fee', 'Our cut on this product (%)')}
                hint={t('mkadm.f.fee.h', 'Blank = the site default ({d}%). Set 0 on our own products so we do not charge ourselves. The split is written onto each sale as it was at that moment, so changing this never rewrites what was already paid.').replace('{d}', (defaultFeeBp / 100).toFixed(2).replace(/\.?0+$/, ''))}>
                <Input type="number" min="0" max="100" step="0.01"
                  value={draft.feePercentBp === '' || draft.feePercentBp == null ? '' : Number(draft.feePercentBp) / 100}
                  onChange={(e) => set('feePercentBp', e.target.value === '' ? '' : Math.round((Number(e.target.value) || 0) * 100))}
                  placeholder={(defaultFeeBp / 100).toString()} aria-invalid={!!err('feePercentBp')} />
                <Err msg={err('feePercentBp')} />
              </Field>
            ) : (
              <p className="text-[11px] text-[var(--muted)]">{t('mkadm.fee.ro', 'This product is charged {n}%. Only a super-admin can change it, here or anywhere else.').replace('{n}', (feeShown / 100).toString())}</p>
            )}
            {isSuper && feePointer}
          </div>
        </div>
      )}

      {step === 'review' && (
        <div className="space-y-3">
          <p className="text-sm text-[var(--muted)]">{t('mkw.review.h', 'This is what will be saved. Click a step above to change anything.')}</p>
          <dl className="rounded-lg border border-[var(--line)] divide-y divide-[var(--line)] text-sm">
            {[
              [t('mkadm.f.name', 'Name'), draft.name, 'basics'],
              [t('mkadm.f.project2', 'Sold on which page'), targetLabel, 'basics'],
              [t('mkadm.f.desc', 'Description'), draft.description || t('mkw.review.none', '—'), 'basics'],
              [t('mkadm.f.active', 'Active (visible in the storefront)'), draft.active ? t('common.yes', 'Yes') : t('common.no', 'No'), 'basics'],
              [t('mkadm.f.delivery', 'Delivery'), kindLabel, 'delivery'],
              ...(draft.deliveryKind === 'file' ? [[t('mkadm.f.file', 'File handed over'), draft.fileName || t('mkadm.f.file.none', 'No file attached yet.'), 'delivery']] : []),
              ...(draft.deliveryKind === 'link' ? [[t('mkadm.f.link', 'Link handed over'), draft.linkUrl, 'delivery']] : []),
              ...(draft.deliveryKind === 'key_external' ? [[t('mkadm.f.exturl', 'External generator URL'), draft.externalUrl, 'delivery']] : []),
              ...(draft.redeemUrl ? [[t('mkadm.f.redeemurl', 'Link to your site or app'), draft.redeemUrl, 'delivery']] : []),
              [t('mkadm.f.price', 'Price (0 = free)'), Number(draft.priceCents) > 0 ? money(draft.priceCents, draft.currency) : t('mk.free', 'Free'), 'pricing'],
              [t('mkadm.f.billing', 'Billing'), draft.billing === 'subscription' ? t('mkw.review.sub', 'Subscription, every {n} month(s)').replace('{n}', String(draft.intervalMonths || 1)) : t('mkadm.bill.l.one_time', BILLING_MODES[0].label), 'pricing'],
              [t('mkadm.f.stock', 'Stock (blank = ∞)'), draft.stock === '' || draft.stock == null ? t('mkw.review.unlimited', 'Unlimited') : String(draft.stock), 'pricing'],
              [t('mkadm.fee.h', 'Platform margin'), `${feeShown / 100}%`, 'pricing'],
            ].map(([k, v, s], i) => (
              <div key={i} className="flex items-start gap-3 px-3 py-2">
                <dt className="w-40 shrink-0 text-[var(--faint)] text-xs pt-0.5">{k}</dt>
                <dd className="flex-1 min-w-0 break-words">{v}</dd>
                <button type="button" onClick={() => go(s)} className="text-[11px] text-[var(--accent-ink)] hover:underline shrink-0">{t('mkw.review.change', 'Change')}</button>
              </div>
            ))}
          </dl>
          {draft.deliveryKind === 'file' && !draft.id && (
            <p className="text-xs text-warning">{t('mkw.review.file', 'The file is attached after this first save: publish, then re-open the product to upload it.')}</p>
          )}
          {!draft.active && <p className="text-xs text-[var(--muted)]">{t('mkw.review.inactive', 'Saved as inactive: nobody sees it in the storefront until you tick Active.')}</p>}
        </div>
      )}
    </Modal>
  );
}

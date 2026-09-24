// The studio inspector's "On click" section (PLAN-STUDIO-2026 phase 5), for every block.
//
// A block's `action` is a list of up to five steps from the closed vocabulary of the studio
// package (packages/studio/src/actions.js). This panel edits that list: add, remove, reorder,
// and the fields of each type. It never decides whether a value is acceptable: every message it
// shows comes from `stepProblems` / `actionProblems`, the functions the API saves under and the
// page renders under, so the editor's red is exactly the page's inert and the server's 400.
import { ArrowUp, ArrowDown, Trash2, Plus, MousePointerClick } from 'lucide-react';
import { Field, Input, Select, Textarea } from '../ui/ui.jsx';
import {
  ACTION_TYPES, MAX_STEPS, REVEAL_MODES, THEME_MODES, COPY_MAX, SUBMIT_REGISTRY, SUBMIT_KEYS,
  REMOVED_ACTIONS, RESERVED_ACTIONS, actionProblems,
} from '../lib/canvas.js';
import { useStudioLinks } from '../lib/studio-links.js';

/** Words for a step type. Literal keys, so i18n-check sees every one. */
export function stepTypeLabel(t, type) {
  switch (type) {
    case 'navigate': return t('cst.act.t.navigate', 'Go to a page of this site');
    case 'page': return t('cst.act.t.page', 'Open another studio page');
    case 'external': return t('cst.act.t.external', 'Open another site');
    case 'mailto': return t('cst.act.t.mailto', 'Write an e-mail');
    case 'scroll': return t('cst.act.t.scroll', 'Scroll to a block');
    case 'reveal': return t('cst.act.t.reveal', 'Show or hide a block');
    case 'copy': return t('cst.act.t.copy', 'Copy a text');
    case 'download': return t('cst.act.t.download', 'Download a file');
    case 'submit': return t('cst.act.t.submit', 'Send a form');
    case 'theme': return t('cst.act.t.theme', 'Change the theme');
    default: return type || '?';
  }
}

/** Words for a problem, from the shared validator's reason. */
export function actionReasonText(t, reason) {
  switch (reason) {
    case 'unsafe_url': return t('cst.act.r.unsafe_url', 'Refused: not an address this kind of step accepts.');
    case 'https_only': return t('cst.act.r.https_only', 'Only https:// addresses can be opened.');
    case 'host_not_allowed': return t('cst.act.r.host', 'This site does not allow links to that host (link policy, set by an administrator).');
    case 'bad_scroll_target': return t('cst.act.r.scroll', 'Pick a block of this page, or the top of the page.');
    case 'bad_target': return t('cst.act.r.target', 'Pick a block of this page.');
    case 'bad_id': return t('cst.act.r.id', 'Only letters, digits, - and _ here.');
    case 'unknown_endpoint': return t('cst.act.r.endpoint', 'Pick one of the forms in the list.');
    case 'terminal_not_last': return t('cst.act.r.last', 'A step that leaves the page or sends a form must be the last one, and there can be only one.');
    case 'too_many': return t('cst.act.r.many', 'Too many values here.');
    case 'too_long': return t('cst.act.r.long', 'Too long.');
    case 'api_removed': return t('cst.act.r.api', 'This button called the site API with the visitor’s own session. That action was removed for security: it does nothing for visitors. Pick another action.');
    case 'reserved_action': return t('cst.act.r.reserved', 'This kind of step is not available yet: it arrives with containers. It does nothing for visitors.');
    case 'unknown_action': return t('cst.act.r.unknown', 'Unknown step: it does nothing for visitors. Pick another one.');
    case 'unknown_field': return t('cst.act.r.field', 'A field this step does not have.');
    default: return t('cst.act.r.value', 'Fill this in with an accepted value.');
  }
}

/** A fresh step of a type, with the defaults the editor offers. */
function freshStep(type) {
  switch (type) {
    case 'navigate': return { type, to: '/' };
    case 'scroll': return { type, target: '#top' };
    case 'reveal': return { type, target: '', mode: 'toggle' };
    case 'theme': return { type, mode: 'toggle' };
    case 'submit': return { type, endpoint: 'newsletter.subscribe' };
    default: return { type, ...(type === 'download' ? { file: '' } : {}) };
  }
}

/**
 * @param {object} props
 * @param {Function} props.t
 * @param {object} props.sel      the selected (normalised) block
 * @param {object[]} props.blocks the page's blocks, for scroll and reveal targets
 * @param {(steps: object[]) => void} props.onChange   writes the block's `action`
 */
export default function ActionFields({ t, sel, blocks, onChange }) {
  const links = useStudioLinks();
  const steps = Array.isArray(sel.action) ? sel.action : [];
  const set = (i, patch) => onChange(steps.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const replace = (i, step) => onChange(steps.map((s, j) => (j === i ? step : s)));
  const move = (i, d) => {
    const j = i + d;
    if (j < 0 || j >= steps.length) return;
    const next = [...steps]; [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const remove = (i) => onChange(steps.filter((_s, j) => j !== i));
  // The shared, strict validator: the problems the API would answer with, by step.
  const problems = {};
  actionProblems(steps, { links, blockIds: new Set((blocks || []).map((b) => b.id)) }, (path, reason) => {
    const m = /^action\[(\d+)\](?:\.(.+))?$/.exec(path);
    const at = m ? Number(m[1]) : -1;
    (problems[at] ||= []).push({ field: m?.[2] || '', reason });
  });
  const others = (blocks || []).filter((b) => b.id !== sel.id);
  const blockName = (b) => `${b.name || b.kind} · ${b.id}`;
  const isDropdown = sel.kind === 'button' && String(sel.props?.variant || '').startsWith('dropdown');

  return (
    <div className="rounded-lg border border-[var(--line)] p-2 space-y-2" data-actions-panel>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--faint)] flex items-center gap-1.5">
        <MousePointerClick size={12} /> {t('cst.act', 'On click')}
      </div>
      {isDropdown ? (
        <p className="text-[11px] text-[var(--muted)]">{t('cst.act.dropdown', 'A dropdown opens its menu when pressed; its items are its links. Pick another look to give this button its own action.')}</p>
      ) : (<>
        {!steps.length && <p className="text-[11px] text-[var(--muted)]">{t('cst.act.none', 'Nothing happens when a visitor presses this block. Add a step to make it a button or a link.')}</p>}
        {problems[-1] && problems[-1].map((p, k) => <p key={k} className="text-[11px] text-error" role="alert">{actionReasonText(t, p.reason)}</p>)}
        {steps.map((s, i) => {
          const live = ACTION_TYPES.includes(s.type);
          const errs = problems[i] || [];
          const errFor = (f) => errs.filter((p) => p.field === f || p.field.startsWith(`${f}.`));
          const msg = (f) => errFor(f).slice(0, 1).map((p, k) => <p key={k} className="text-[11px] text-error mt-1" role="alert" data-step-error={p.reason}>{actionReasonText(t, p.reason)}</p>);
          return (
            <div key={i} className="rounded-md border border-[var(--line)] p-2 space-y-2" data-step={s.type}>
              <div className="flex items-center gap-1">
                <span className="text-[11px] font-semibold text-[var(--faint)] w-4">{i + 1}</span>
                <Select className="flex-1 min-w-0" aria-label={t('cst.act.type', 'Step')} value={live ? s.type : ''} onChange={(e) => replace(i, freshStep(e.target.value))}>
                  {!live && <option value="">{t('cst.act.pick', 'Choose a step')}</option>}
                  {ACTION_TYPES.map((ty) => <option key={ty} value={ty}>{stepTypeLabel(t, ty)}</option>)}
                </Select>
                <button type="button" className="p-1 rounded hover:bg-[var(--surface-2)] disabled:opacity-40" disabled={i === 0} onClick={() => move(i, -1)} title={t('cst.act.up', 'Earlier')} aria-label={t('cst.act.up', 'Earlier')}><ArrowUp size={13} /></button>
                <button type="button" className="p-1 rounded hover:bg-[var(--surface-2)] disabled:opacity-40" disabled={i === steps.length - 1} onClick={() => move(i, 1)} title={t('cst.act.down', 'Later')} aria-label={t('cst.act.down', 'Later')}><ArrowDown size={13} /></button>
                <button type="button" className="p-1 rounded hover:bg-[var(--surface-2)] text-error" onClick={() => remove(i)} title={t('cst.act.remove', 'Remove this step')} aria-label={t('cst.act.remove', 'Remove this step')}><Trash2 size={13} /></button>
              </div>
              {!live && (
                <div className="rounded-lg border border-[var(--error-border)] p-2 text-[11px] text-error" role="alert" data-legacy-action={s.type}>
                  {actionReasonText(t, REMOVED_ACTIONS[s.type] || (RESERVED_ACTIONS.includes(s.type) ? 'reserved_action' : 'unknown_action'))}
                </div>
              )}
              {s.type === 'navigate' && (<>
                <Field label={t('cst.act.f.to', 'Path on this site')}><Input value={s.to || ''} onChange={(e) => set(i, { to: e.target.value })} placeholder="/docs" /></Field>
                {msg('to')}
              </>)}
              {s.type === 'page' && (<>
                <Field label={t('cst.act.f.canvas', 'Studio page id')} hint={t('cst.act.f.canvas.h', 'The id of another studio page of this project; it opens as its tab.')}><Input value={s.canvasId || ''} onChange={(e) => set(i, { canvasId: e.target.value })} /></Field>
                {msg('canvasId')}
              </>)}
              {s.type === 'external' && (<>
                <Field label={t('cst.act.f.url', 'Address (https)')} hint={t('cst.act.f.url.h', 'Opens in a new tab, after a screen that tells the visitor they are leaving the site and names the host.')}><Input value={s.url || ''} onChange={(e) => set(i, { url: e.target.value })} placeholder="https://example.org" /></Field>
                {msg('url')}
              </>)}
              {s.type === 'mailto' && (<>
                <Field label={t('cst.act.f.address', 'E-mail address')}><Input type="email" value={s.address || ''} onChange={(e) => set(i, { address: e.target.value })} placeholder="hello@example.org" /></Field>
                {msg('address')}
              </>)}
              {(s.type === 'scroll' || s.type === 'reveal') && (<>
                <Field label={s.type === 'scroll' ? t('cst.act.f.scroll', 'Scroll to') : t('cst.act.f.reveal', 'Block')}>
                  <Select value={s.target || ''} onChange={(e) => set(i, { target: e.target.value })}>
                    {s.type === 'scroll' ? <option value="#top">{t('cst.act.f.top', 'The top of the page')}</option> : <option value="">{t('cst.act.f.pickblock', 'Choose a block')}</option>}
                    {others.map((b) => <option key={b.id} value={b.id}>{blockName(b)}</option>)}
                    {s.target && s.target !== '#top' && !others.some((b) => b.id === s.target) && <option value={s.target}>{s.target}</option>}
                  </Select>
                </Field>
                {msg('target')}
                {s.type === 'reveal' && (
                  <Field label={t('cst.act.f.mode', 'Do')} hint={t('cst.act.f.mode.h', 'A block marked hidden starts hidden and waits for this step to show it.')}>
                    <Select value={s.mode || 'toggle'} onChange={(e) => set(i, { mode: e.target.value })}>
                      {REVEAL_MODES.map((m) => <option key={m} value={m}>{m === 'show' ? t('cst.act.m.show', 'Show it') : m === 'hide' ? t('cst.act.m.hide', 'Hide it') : t('cst.act.m.toggle', 'Show or hide it, in turn')}</option>)}
                    </Select>
                  </Field>
                )}
              </>)}
              {s.type === 'copy' && (<>
                <Field label={`${t('cst.act.f.text', 'Text to copy')} · ${String(s.text || '').length}/${COPY_MAX}`}>
                  <Textarea rows={3} maxLength={COPY_MAX} value={s.text || ''} onChange={(e) => set(i, { text: e.target.value })} />
                </Field>
                {msg('text')}
              </>)}
              {s.type === 'download' && (<>
                <Field label={t('cst.act.f.source', 'File')}>
                  <Select value={s.asset != null ? 'asset' : 'file'} onChange={(e) => replace(i, e.target.value === 'asset' ? { type: 'download', asset: '' } : { type: 'download', file: '' })}>
                    <option value="file">{t('cst.act.f.upload', 'An upload of this site (/uploads/…)')}</option>
                    <option value="asset">{t('cst.act.f.asset', 'A platform asset (its key)')}</option>
                  </Select>
                </Field>
                {s.asset != null
                  ? <Input aria-label={t('cst.act.f.asset', 'A platform asset (its key)')} value={s.asset || ''} onChange={(e) => set(i, { asset: e.target.value })} placeholder="bmm-setup.exe" />
                  : <Input aria-label={t('cst.act.f.upload', 'An upload of this site (/uploads/…)')} value={s.file || ''} onChange={(e) => set(i, { file: e.target.value })} placeholder="/uploads/…" />}
                {msg(s.asset != null ? 'asset' : 'file')}
              </>)}
              {s.type === 'submit' && <SubmitFields t={t} s={s} set={(patch) => set(i, patch)} msg={msg} />}
              {s.type === 'theme' && (
                <Field label={t('cst.act.f.theme', 'Theme')}>
                  <Select value={s.mode || 'toggle'} onChange={(e) => set(i, { mode: e.target.value })}>
                    {THEME_MODES.map((m) => <option key={m} value={m}>{m === 'light' ? t('cst.act.m.light', 'Light') : m === 'dark' ? t('cst.act.m.dark', 'Dark') : t('cst.act.m.switch', 'Switch')}</option>)}
                  </Select>
                </Field>
              )}
              {errFor('type').filter((p) => p.reason === 'terminal_not_last').slice(0, 1).map((p, k) => <p key={k} className="text-[11px] text-error" role="alert" data-step-error={p.reason}>{actionReasonText(t, p.reason)}</p>)}
            </div>
          );
        })}
        {steps.length < MAX_STEPS ? (
          <Select value="" aria-label={t('cst.act.add', 'Add a step')} onChange={(e) => { if (e.target.value) onChange([...steps, freshStep(e.target.value)]); }}>
            <option value="">{t('cst.act.add', 'Add a step')}</option>
            {ACTION_TYPES.map((ty) => <option key={ty} value={ty}>{stepTypeLabel(t, ty)}</option>)}
          </Select>
        ) : <p className="text-[11px] text-[var(--muted)]"><Plus size={11} className="inline" /> {t('cst.act.max', 'Five steps at most.')}</p>}
      </>)}
    </div>
  );
}

/** The submit step: which registry form, and the fields the author may fix for it. */
function SubmitFields({ t, s, set, msg }) {
  const entry = SUBMIT_REGISTRY[s.endpoint] || null;
  const f = s.fields && typeof s.fields === 'object' ? s.fields : {};
  const setField = (k, v) => set({ fields: { ...f, [k]: v } });
  const formName = (k) => (k === 'newsletter.subscribe' ? t('cst.act.s.newsletter', 'Newsletter: subscribe')
    : k === 'poll.vote' ? t('cst.act.s.poll', 'Poll: vote for fixed options')
      : k === 'project.contact' ? t('cst.act.s.contact', 'Project: write to its contact inbox') : k);
  return (<>
    <Field label={t('cst.act.f.form', 'Form')}>
      <Select value={entry ? s.endpoint : ''} onChange={(e) => set({ endpoint: e.target.value, fields: undefined })}>
        {!entry && <option value="">{t('cst.act.f.pickform', 'Choose a form')}</option>}
        {SUBMIT_KEYS.map((k) => <option key={k} value={k}>{formName(k)}</option>)}
      </Select>
    </Field>
    {msg('endpoint')}
    {s.endpoint === 'poll.vote' && (<>
      <Field label={t('cst.act.f.poll', 'Poll id')}><Input value={f.pollId || ''} onChange={(e) => setField('pollId', e.target.value.trim())} /></Field>
      {msg('fields.pollId')}
      <Field label={t('cst.act.f.options', 'Option ids, separated by commas')}>
        <Input value={Array.isArray(f.optionIds) ? f.optionIds.join(', ') : ''} onChange={(e) => setField('optionIds', e.target.value.split(',').map((x) => x.trim()).filter(Boolean))} />
      </Field>
      {msg('fields.optionIds')}
    </>)}
    {s.endpoint === 'project.contact' && (<>
      <Field label={t('cst.act.f.project', 'Project (its key, or sc:<slug> for another project)')}><Input value={f.project || ''} onChange={(e) => setField('project', e.target.value.trim())} placeholder="bmm" /></Field>
      {msg('fields.project')}
      <Field label={t('cst.act.f.topic', 'Topic')} hint={t('cst.act.f.topic.h', 'One of the topics the project’s inbox offers: question, bug, translation, suggestion, other, or a custom one.')}><Input value={f.topic || ''} onChange={(e) => setField('topic', e.target.value.trim())} placeholder="question" /></Field>
      {msg('fields.topic')}
    </>)}
    {entry && Object.keys(entry.visitor).length > 0 && (
      <p className="text-[11px] text-[var(--muted)]">{t('cst.act.s.visitor', 'The visitor fills in: {list}. The site decides where it goes; nothing else is sent.').replace('{list}', Object.keys(entry.visitor).join(', '))}</p>
    )}
  </>);
}

// The studio's side of components (PLAN-STUDIO-2026 2.6, phase 7b).
//
// The model and every rule are the package's (packages/studio/src/components.js and
// validate.js): an instance is ONE block naming a component and holding only its overrides; the
// page keeps the definitions its instances use; an override names an exposed field and nothing
// else. This file draws the pieces the studio needs around them, so canvas-studio.jsx grows by
// its wiring only:
//
//   · SaveComponentDialog  "Save as component": a name and WHERE (this page's library, the
//                          site's, or the author's own personal list, which keeps linked copies
//                          the old way)
//   · InstanceInspector    the inspector of an instance: the fields its component exposes, each
//                          showing the component's value or this copy's own, reset per field or
//                          all at once, detach, edit the component, update the copies
//   · PageComponents       "On this page": every component the page uses, how many copies, how
//                          many diverge (override a field), whether the library holds a newer
//                          version, and "Update the copies"
//   · LibraryComponents    the components of the libraries this studio reads, to place a copy
//   · ExposedFields        component mode only: which fields of the selected block the copies
//                          may change, with the key and the label they are shown under
import { useState } from 'react';
import { Puzzle, RotateCcw, Unlink, RefreshCw, PencilRuler, Plus, Trash2, AlertTriangle } from 'lucide-react';
import { Button, Field, Input, Textarea, Modal } from '../ui/ui.jsx';
import {
  overridesOf, divergence, fieldValue, instancesOfComponent, snapshotDiffers, exposableFor, EXPOSED_KEY, MAX_EXPOSED,
} from '../lib/canvas.js';
import CanvasThumb from '../ui/canvas-thumb.jsx';
import ActionFields from './studio-actions.jsx';

/** Words for an exposable field. Literal keys, so the i18n checker sees every one. */
export function fieldLabel(t, field) {
  switch (field) {
    case 'props.md': return t('cst.cmp7.f.md', 'Text');
    case 'props.label': return t('cst.cmp7.f.label', 'Label');
    case 'props.desc': return t('cst.cmp7.f.desc', 'Description');
    case 'props.text': return t('cst.cmp7.f.text', 'Text in the shape');
    case 'props.title': return t('cst.cmp7.f.title', 'Title');
    case 'props.alt': return t('cst.cmp7.f.alt', 'Alt text');
    case 'props.src': return t('cst.cmp7.f.src', 'Picture or video');
    case 'props.poster': return t('cst.cmp7.f.poster', 'Poster image');
    case 'props.url': return t('cst.cmp7.f.url', 'Embed address');
    case 'props.bg': return t('cst.cmp7.f.bg', 'Background colour');
    case 'props.color': return t('cst.cmp7.f.color', 'Text colour');
    case 'props.border': return t('cst.cmp7.f.border', 'Border colour');
    case 'props.fill': return t('cst.cmp7.f.fill', 'Fill');
    case 'props.textColor': return t('cst.cmp7.f.textColor', 'Text colour in the shape');
    case 'action': return t('cst.cmp7.f.action', 'On click');
    default: return field;
  }
}

/** Where a component comes from, in words. */
export function scopeLabel(t, scope) {
  switch (scope) {
    case 'site': return t('cst.cmp7.scope.site', 'Site library');
    case 'user': return t('cst.cmp7.scope.user', 'My components');
    default: return t('cst.cmp7.scope.page', 'This page’s library');
  }
}

/** The name, and where the selection is kept. */
export function SaveComponentDialog({ t, count, destinations, onSave, onClose }) {
  const [name, setName] = useState('');
  const [dest, setDest] = useState(destinations[0]?.id || 'user');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try { await onSave(name.trim(), dest); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={t('cst.cmp.saveas', 'Save as component')} icon={Puzzle}
      footer={<><Button variant="ghost" onClick={onClose}>{t('common.cancel', 'Cancel')}</Button><Button variant="primary" loading={busy} disabled={!name.trim() || !count} onClick={go} data-cmp-save-ok>{t('common.save', 'Save')}</Button></>}>
      <div className="space-y-3">
        <Field label={t('cst.cmp.name', 'Name')}>
          <Input autoFocus value={name} maxLength={60} data-cmp-name onChange={(e) => setName(e.target.value)} placeholder={t('cst.cmp.name.ph', 'Pricing card, hero, footer…')} onKeyDown={(e) => { if (e.key === 'Enter') go(); }} />
        </Field>
        <fieldset className="space-y-1.5">
          <legend className="text-[12px] font-medium mb-1">{t('cst.cmp7.dest', 'Keep it in')}</legend>
          {destinations.map((d) => (
            <label key={d.id} className="flex items-start gap-2 text-xs cursor-pointer">
              <input type="radio" name="cmp-dest" value={d.id} checked={dest === d.id} onChange={() => setDest(d.id)} data-cmp-dest={d.id} className="mt-0.5" />
              <span><span className="font-medium">{d.label}</span><span className="block text-[11px] text-[var(--muted)]">{d.hint}</span></span>
            </label>
          ))}
        </fieldset>
        <p className="text-[11px] text-[var(--muted)]">{t('cst.cmp7.saveas.h', '{n} block(s), containers with what they hold. In a library, the selection becomes a linked copy: change the component and every copy follows, except the fields a copy changed.').replace('{n}', String(count))}</p>
      </div>
    </Modal>
  );
}

/** One exposed field of an instance: the value it shows, and whether it is the copy's own. */
function OverrideField({ t, e, def, sel, snap, onOverride, pageList }) {
  const ov = overridesOf(sel);
  const own = e.key in ov;
  const value = own ? ov[e.key] : fieldValue(def, e.field);
  const label = e.label || fieldLabel(t, e.field);
  const head = (
    <span className="flex items-center gap-1.5">
      <span className="flex-1 min-w-0 truncate" title={label}>{label}</span>
      {own && <span className="text-[10px] px-1.5 py-0.5 rounded tint-primary text-[var(--accent-ink)]" data-override-own={e.key}>{t('cst.cmp7.own', 'changed here')}</span>}
      {own && (
        <button type="button" className="p-0.5 rounded hover:bg-[var(--surface-2)]" data-override-reset={e.key} onClick={() => onOverride(e.key, undefined)}
          title={t('cst.cmp7.reset1', 'Back to the component’s value')} aria-label={t('cst.cmp7.reset1', 'Back to the component’s value')}><RotateCcw size={12} /></button>
      )}
    </span>
  );
  if (e.field === 'action') {
    return (
      <div data-override-field={e.key}>
        <div className="text-[12px] font-medium mb-1">{head}</div>
        <ActionFields t={t} sel={{ ...def, action: Array.isArray(value) ? value : [] }} blocks={snap.doc.blocks} pages={pageList}
          onChange={(steps) => onOverride(e.key, steps)} />
      </div>
    );
  }
  const str = typeof value === 'string' ? value : '';
  return (
    <div data-override-field={e.key}>
      <Field label={head}>
        {e.field === 'props.md'
          ? <Textarea rows={4} value={str} data-override-input={e.key} onChange={(ev) => onOverride(e.key, ev.target.value)} />
          : <Input value={str} data-override-input={e.key} onChange={(ev) => onOverride(e.key, ev.target.value)} />}
      </Field>
    </div>
  );
}

/**
 * The inspector of an instance. `snap` is the page's copy of its component (null: unknown), and
 * `stale` says the library holds another version of it.
 */
export function InstanceInspector({ t, sel, snap, stale, patch, onOverride, onResetAll, onDetach, onUpdate, onOpen, onDeselect, pageList = null }) {
  const numField = (label, key) => (
    <Field label={label}><Input type="number" value={sel[key]} onChange={(e) => patch(sel.id, { [key]: Number(e.target.value) || 0 })} /></Field>
  );
  const diverging = snap ? divergence(sel, snap) : [];
  const own = Object.keys(overridesOf(sel));
  return (
    <div className="mt-4 lg:mt-0 rounded-xl border border-[var(--line)] p-3 space-y-3" data-tour="props" data-instance-inspector={sel.id}>
      <div className="flex items-center gap-2">
        <Puzzle size={14} className="text-[var(--accent-ink)]" aria-hidden />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--faint)]">{t('cst.cmp7.instance', 'Component copy')}</span>
      </div>
      {snap ? (
        <div className="text-sm font-medium truncate" data-instance-of={sel.component?.id}>{snap.name || sel.component?.id}
          <span className="block text-[11px] font-normal text-[var(--muted)]">{scopeLabel(t, snap.scope)}</span>
        </div>
      ) : (
        <p className="text-[11px] text-warning flex items-start gap-1.5" role="status"><AlertTriangle size={12} className="mt-0.5 shrink-0" /> {t('cst.cmp7.missing', 'The component of this copy is not on the page any more: visitors see an empty box. Delete the copy, or place the component again.')}</p>
      )}
      <div className="grid grid-cols-2 gap-2">{numField('X', 'x')}{numField('Y', 'y')}</div>
      <p className="text-[11px] text-[var(--muted)]">{t('cst.cmp7.size', 'Its size is the component’s: {w} × {h}.').replace('{w}', String(sel.w)).replace('{h}', String(sel.h))}</p>
      {snap && (
        <div className="space-y-2">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--faint)]">{t('cst.cmp7.fields', 'What this copy can change')}</div>
          {!snap.exposed.length && <p className="text-[11px] text-[var(--muted)]">{t('cst.cmp7.fields.none', 'The component offers no field to change. Edit the component to choose some.')}</p>}
          {snap.exposed.map((e) => {
            const def = snap.doc.blocks.find((b) => b.id === e.block);
            return def ? <OverrideField key={e.key} t={t} e={e} def={def} sel={sel} snap={snap} onOverride={onOverride} pageList={pageList} /> : null;
          })}
          <p className="text-[11px] text-[var(--muted)]" data-instance-diverges={diverging.length}>{diverging.length
            ? t('cst.cmp7.diverges', 'This copy differs from the component in {n} field(s).').replace('{n}', String(diverging.length))
            : t('cst.cmp7.same', 'This copy shows the component as it is.')}</p>
        </div>
      )}
      <div className="flex flex-wrap gap-1.5">
        {own.length > 0 && <Button size="sm" variant="ghost" onClick={onResetAll} data-instance-resetall><RotateCcw size={13} /> {t('cst.cmp7.resetall', 'Reset every field')}</Button>}
        {snap && stale && <Button size="sm" variant="ghost" onClick={onUpdate} data-instance-update title={t('cst.cmp7.update.h', 'The library holds a newer version: put it on this page. Every copy keeps the fields it changed.')}><RefreshCw size={13} /> {t('cst.cmp7.update', 'Update the copies')}</Button>}
        {snap && onOpen && <Button size="sm" variant="ghost" onClick={onOpen} data-instance-open><PencilRuler size={13} /> {t('cst.cmp7.open', 'Edit the component')}</Button>}
        {snap && <Button size="sm" variant="ghost" onClick={onDetach} data-instance-detach title={t('cst.cmp7.detach.h', 'Turn this copy into ordinary blocks: the component no longer changes it')}><Unlink size={13} /> {t('cst.cmp.detach', 'Detach')}</Button>}
      </div>
      <button type="button" className="text-[11px] text-[var(--faint)] hover:text-[var(--text)]" onClick={onDeselect}>{t('cst.deselect', 'Deselect')}</button>
    </div>
  );
}

/**
 * "On this page": each component the page uses. `sourceOf(cid)` is the library's version (or
 * null when this studio cannot read it).
 */
export function PageComponents({ t, canvas, sourceOf, onUpdate, onSelect }) {
  const map = canvas.components || {};
  const used = Object.keys(map).filter((cid) => instancesOfComponent(canvas.blocks, cid).length);
  if (!used.length) return null;
  return (
    <div className="space-y-1.5" data-page-components>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--faint)]">{t('cst.cmp7.onpage', 'On this page')}</div>
      {used.map((cid) => {
        const snap = map[cid];
        const copies = instancesOfComponent(canvas.blocks, cid);
        const div = copies.filter((b) => divergence(b, snap).length > 0);
        const src = sourceOf(snap, cid);
        const stale = !!src && snapshotDiffers(snap, src);
        return (
          <div key={cid} className="rounded-lg border border-[var(--line)] p-2 space-y-1" data-page-component={cid}>
            <div className="flex items-center gap-1.5">
              <Puzzle size={12} className="text-[var(--accent-ink)] shrink-0" aria-hidden />
              <span className="flex-1 min-w-0 truncate text-xs font-medium" title={snap.name}>{snap.name || cid}</span>
              <span className="text-[10px] text-[var(--faint)] tabular-nums" data-copies={copies.length}>{t('cst.cmp7.copies', '{n} copy(ies)').replace('{n}', String(copies.length))}</span>
            </div>
            {div.length > 0 && (
              <div className="text-[11px] text-[var(--muted)]" data-diverging={div.length}>
                {t('cst.cmp7.diverging', '{n} differ from the component:').replace('{n}', String(div.length))}{' '}
                {div.map((b, i) => (
                  <button key={b.id} type="button" className="text-[var(--accent-ink)] hover:underline" onClick={() => onSelect(b.id)} data-diverging-copy={b.id}>
                    {b.name || `#${String(b.id).slice(-4)}`}{i < div.length - 1 ? ',' : ''}
                  </button>
                ))}
              </div>
            )}
            {stale && (
              <div className="flex items-center gap-1.5">
                <span className="flex-1 text-[11px] text-warning" data-stale>{t('cst.cmp7.stale', 'The library holds a newer version.')}</span>
                <Button size="sm" variant="ghost" onClick={() => onUpdate(cid)} data-cmp-update={cid}><RefreshCw size={12} /> {t('cst.cmp7.update', 'Update the copies')}</Button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** The components of the libraries this studio reads: place a copy, or edit the component. */
export function LibraryComponents({ t, entries, onInsert, onOpen }) {
  if (!entries.length) return null;
  return (
    <div className="space-y-1.5" data-library-components>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--faint)]">{t('cst.cmp7.lib', 'Linked components')}</div>
      {entries.map((e) => (
        <div key={`${e.scope}:${e.id}`} className="flex items-center gap-2 rounded-lg border border-[var(--line)] p-1.5" data-library-component={e.id}>
          <span className="w-12 h-10 shrink-0 rounded-md bg-[var(--surface-2)] overflow-hidden"><CanvasThumb doc={e.doc} width={48} maxHeight={600} /></span>
          <span className="flex-1 min-w-0">
            <span className="block text-xs font-medium truncate" title={e.name}>{e.name}</span>
            <span className="block text-[10px] text-[var(--faint)]">{scopeLabel(t, e.scope)}</span>
          </span>
          <Button size="sm" variant="ghost" className="!px-2" onClick={() => onInsert(e)} data-cmp-insert={e.id} title={t('cst.cmp7.insert', 'Place a linked copy')} aria-label={t('cst.cmp7.insert', 'Place a linked copy')}><Plus size={14} /></Button>
          {onOpen && <Button size="sm" variant="ghost" className="!px-2" onClick={() => onOpen(e)} data-cmp-open={e.id} title={t('cst.cmp7.open', 'Edit the component')} aria-label={t('cst.cmp7.open', 'Edit the component')}><PencilRuler size={14} /></Button>}
        </div>
      ))}
    </div>
  );
}

/** A key for a new exposed field of `block`, not in `taken`. */
function freshKey(block, field, taken) {
  const base = `${String(block.name || block.kind).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24) || block.kind}-${field.slice(field.indexOf('.') + 1)}`.slice(0, 36);
  let key = base; let n = 2;
  while (taken.has(key)) key = `${base}-${n++}`;
  return key;
}

/**
 * Component mode: which fields of the selected block its copies may change. Every field of
 * the block that CAN be exposed (canvas.js exposableFor) is listed; ticked = exposed.
 */
export function ExposedFields({ t, sel, exposed, onChange, blocks }) {
  const list = Array.isArray(exposed) ? exposed : [];
  const taken = new Set(list.map((e) => e.key));
  const here = sel ? exposableFor(sel.kind) : [];
  const toggle = (field, on) => {
    if (on) {
      if (list.length >= MAX_EXPOSED) return;
      onChange([...list, { key: freshKey(sel, field, taken), block: sel.id, field }]);
    } else onChange(list.filter((e) => !(e.block === sel.id && e.field === field)));
  };
  const rename = (key, patch) => onChange(list.map((e) => (e.key === key ? { ...e, ...patch } : e)));
  const nameOf = (id) => { const b = (blocks || []).find((x) => x.id === id); return b ? (b.name || `${b.kind} #${String(b.id).slice(-3)}`) : id; };
  return (
    <div className="rounded-xl border border-[var(--line)] p-3 space-y-2" data-exposed-panel>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--faint)] flex items-center gap-1.5"><Puzzle size={12} /> {t('cst.cmp7.exposed', 'What a copy can change')}</div>
      {sel ? (here.length ? (
        <div className="space-y-1">
          {here.map((f) => {
            const on = list.some((e) => e.block === sel.id && e.field === f);
            return (
              <label key={f} className="flex items-center gap-2 text-xs cursor-pointer">
                <input type="checkbox" checked={on} onChange={(ev) => toggle(f, ev.target.checked)} data-expose={f} disabled={!on && list.length >= MAX_EXPOSED} />
                {fieldLabel(t, f)}
              </label>
            );
          })}
        </div>
      ) : <p className="text-[11px] text-[var(--muted)]">{t('cst.cmp7.exposed.nofield', 'A copy cannot change anything of this block.')}</p>)
        : <p className="text-[11px] text-[var(--muted)]">{t('cst.cmp7.exposed.pick', 'Select a block to choose what its copies can change.')}</p>}
      {list.length > 0 && (
        <div className="space-y-1.5 pt-1 border-t border-[var(--line)]">
          {list.map((e) => (
            <div key={e.key} className="flex items-center gap-1.5" data-exposed-row={e.key}>
              <span className="text-[11px] text-[var(--muted)] w-24 shrink-0 truncate" title={`${nameOf(e.block)} · ${fieldLabel(t, e.field)}`}>{nameOf(e.block)} · {fieldLabel(t, e.field)}</span>
              <Input className="flex-1 min-w-0" value={e.label || ''} maxLength={60} placeholder={fieldLabel(t, e.field)} aria-label={t('cst.cmp7.exposed.label', 'Shown to the page author as')}
                onChange={(ev) => rename(e.key, { label: ev.target.value.slice(0, 60) || undefined })} />
              <button type="button" className="p-1 rounded hover:bg-[var(--surface-2)] text-[var(--error)]" onClick={() => onChange(list.filter((x) => x.key !== e.key))}
                title={t('cst.cmp7.exposed.remove', 'Copies can no longer change this')} aria-label={t('cst.cmp7.exposed.remove', 'Copies can no longer change this')}><Trash2 size={12} /></button>
            </div>
          ))}
        </div>
      )}
      <p className="text-[11px] text-[var(--muted)]">{t('cst.cmp7.exposed.h', 'A copy changes only these fields. When you change the component, every copy follows, except the fields it changed; a field you remove here goes back to the component’s value in every copy.')}</p>
      {list.some((e) => !EXPOSED_KEY.test(e.key)) && <p className="text-[11px] text-warning">{t('cst.cmp7.exposed.bad', 'A field has a name the server will refuse.')}</p>}
    </div>
  );
}

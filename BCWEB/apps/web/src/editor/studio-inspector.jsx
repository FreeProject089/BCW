// The studio's inspector: everything about the selected block, by kind.
// Moved out of editor/canvas-studio.jsx (studio phase 8).
import { useState } from 'react';
import {
  Puzzle, Unlink, RefreshCw, Save, Sparkles, Layers, Lock, EyeOff, Type, Upload,
} from 'lucide-react';
import { Button, Field, Input, Textarea, Select, useToast } from '../ui/ui.jsx';
import { uploadMedia } from '../lib/api.js';
import { PATTERNS } from '../lib/patterns.js';
import { svgRefusals } from '../lib/svg-safe.js';
import {
  BUTTON_VARIANTS, menuItemHref, ANIM_KINDS, ANIM_TRIGGERS, ANIM_EASINGS, SHAPES, TEXT_ALIGNS, SHADOWS, HOVER_EFFECTS,
} from '../lib/canvas.js';
import { InstanceInspector } from './studio-component-editor.jsx';
import ActionFields from './studio-actions.jsx';

/** Kinds whose own drawing ignores `props.bg` (ui/canvas-view.jsx): the field would do nothing. */
const NO_BG = new Set(['button', 'shape']);

/** A block kind as the reader's language names it. Literal keys, so i18n-check sees each one. */
function kindName(t, kind) {
  return ({
    text: t('cst.kind.text', 'Text'), image: t('cst.kind.image', 'Image'), box: t('cst.kind.box', 'Box'),
    video: t('cst.kind.video', 'Video'), embed: t('cst.kind.embed', 'Embed'), replay: t('cst.kind.replay', 'Replay'),
    button: t('cst.kind.button', 'Button'), shape: t('cst.kind.shape', 'Shape'), svg: t('cst.kind.svg', 'SVG'),
    group: t('cst.kind.group', 'Group'), tabs: t('cst.kind.tabs', 'Tab card'), modal: t('cst.kind.modal', 'Dialog'),
  })[kind] || kind;
}

export function Inspector({ t, sel, patch, canvas, emit, setSelId, hasDark = false, onOpenMd, pageList = null, containerFields = null, instanceTools = null }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (!sel) {
    return (
      <div className="mt-4 lg:mt-0 rounded-xl border border-[var(--line)] p-3 text-xs text-[var(--muted)]">
        {t('cst.none', 'Select a block to edit it. Arrow keys nudge, Shift+arrow moves further, Delete removes.')}
      </div>
    );
  }
  // A linked copy of a component (phase 7b): the fields its component exposes, nothing else.
  if (sel.kind === 'instance' && instanceTools) {
    return (
      <InstanceInspector t={t} sel={sel} snap={instanceTools.snapOf(sel)} stale={instanceTools.stale(sel)} patch={patch} pageList={pageList}
        onOverride={(key, value) => instanceTools.onOverride(sel.id, key, value)} onResetAll={() => instanceTools.onResetAll(sel.id)}
        onDetach={() => instanceTools.onDetach(sel.id)} onUpdate={() => instanceTools.onUpdate(sel)}
        onOpen={instanceTools.onOpen ? () => instanceTools.onOpen(sel) : null} onDeselect={() => setSelId(null)} />
    );
  }
  const p = sel.props || {};
  const setProp = (k, v) => patch(sel.id, { props: { ...p, [k]: v } });
  const numField = (label, key) => (
    <Field label={label}><Input type="number" value={sel[key]} onChange={(e) => patch(sel.id, { [key]: Number(e.target.value) || 0 })} /></Field>
  );
  return (
    <div className="mt-4 lg:mt-0 rounded-xl border border-[var(--line)] p-3 space-y-3 lg:sticky lg:top-4" data-tour="props" data-inspector-kind={sel.kind}>
      <div className="flex items-center gap-2">
        {/* The kind, in the reader's language (it printed the internal name, "text"). */}
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--faint)]">{kindName(t, sel.kind)}</span>
        {/* Whether THIS block says anything of its own on dark. Without it, an author on the
            dark theme cannot tell an overridden block from one that is simply inheriting —
            they look identical, which is the point of inheriting and the problem with it. */}
        {hasDark && <span className="text-[10px] px-1.5 py-0.5 rounded tint-primary text-[var(--accent-ink)]">{t('cst.theme.has', 'dark variant')}</span>}
        {/* Front, back, lock and hide are the tool bar's (phase 8): it shows them whenever a
            block is selected, for the whole selection. They were ALSO here, for one block, so
            the same command had two places and, on the dark board, two meanings. */}
        <div className="ms-auto flex gap-1">
          {hasDark && (
            <button title={t('cst.theme.reset', 'Drop the dark variant, this block follows the light layout again')}
              className="p-1 rounded hover:bg-[var(--surface-2)]"
              onClick={() => emit(canvas.blocks.map((b) => (b.id === sel.id ? { ...b, themes: { ...(b.themes || {}), dark: undefined } } : b)))}>
              <Layers size={14} />
            </button>
          )}
        </div>
      </div>
      <Input className="w-full" value={sel.name || ''} placeholder={t('cst.name.ph', 'Name this block…')} aria-label={t('cst.name', 'Name')} onChange={(e) => patch(sel.id, { name: e.target.value.slice(0, 60) }, `name-${sel.id}`)} />
      {(sel.locked || sel.hidden) && (
        <p className="text-[11px] text-[var(--muted)] flex items-center gap-1.5" data-inspector-flags>
          {sel.locked && <><Lock size={12} aria-hidden /> {t('cst.locked.h', 'Locked: the panel still edits it, the pointer cannot move, resize or delete it')}</>}
          {sel.hidden && <><EyeOff size={12} aria-hidden /> {t('cst.hidden.h', 'Hidden: kept on the board, not shown to readers')}</>}
        </p>
      )}
      <div className="grid grid-cols-2 gap-2">
        {numField('X', 'x')}{numField('Y', 'y')}{numField(t('cst.w', 'Width'), 'w')}{numField(t('cst.h', 'Height'), 'h')}
      </div>
      {containerFields}
      {sel.kind === 'text' && (
        <Field label={t('cst.md', 'Content (B.MD)')}>
          <Textarea rows={8} value={p.md || ''} onChange={(e) => setProp('md', e.target.value)} />
          <button type="button" className="mt-1 text-[11.5px] text-[var(--accent-ink)] hover:underline inline-flex items-center gap-1" onClick={() => onOpenMd?.(sel.id)}><Type size={12} /> {t('cst.md.open', 'Open in the B.MD editor')}</button>
        </Field>
      )}
      {sel.kind === 'text' && (
        <Field label={t('cst.text.align', 'Text alignment')}>
          <Select value={p.align || 'left'} onChange={(e) => setProp('align', e.target.value === 'left' ? undefined : e.target.value)}>
            {TEXT_ALIGNS.map((v) => <option key={v} value={v}>{t(`cst.text.align.${v}`, v)}</option>)}
          </Select>
        </Field>
      )}
      {sel.kind === 'image' && (<>
        <Field label={t('cst.src', 'Image URL')}><Input value={p.src || ''} onChange={(e) => setProp('src', e.target.value)} placeholder="/uploads/…" /></Field>
        {/* Pasting a URL means the picture has to already be somewhere, which for most people
            it is not. Same uploader the rest of the editor uses, so the file lands in the
            same place with the same limits. */}
        <label className="inline-flex items-center gap-1.5 text-xs cursor-pointer text-[var(--accent-ink)] hover:underline">
          <Upload size={13} /> {busy ? t('cst.uploading', 'Uploading…') : t('cst.upload', 'Upload an image')}
          <input type="file" accept="image/*" className="hidden" disabled={busy} onChange={async (e) => {
            const f = e.target.files?.[0]; e.target.value = '';
            if (!f) return;
            setBusy(true);
            try { setProp('src', await uploadMedia(f)); }
            catch { toast.error(t('common.failed', 'Failed.')); }
            finally { setBusy(false); }
          }} />
        </label>
        <Field label={t('cst.alt', 'Alt text')} hint={t('cst.alt.h', 'What the image says, for anyone who cannot see it.')}><Input value={p.alt || ''} onChange={(e) => setProp('alt', e.target.value)} /></Field>
      </>)}
      {sel.kind === 'video' && (<>
        <Field label={t('cst.video.src', 'Video URL (mp4/webm)')}><Input value={p.src || ''} onChange={(e) => setProp('src', e.target.value)} placeholder="/uploads/clip.mp4" /></Field>
        <Field label={t('cst.video.poster', 'Poster image (optional)')}><Input value={p.poster || ''} onChange={(e) => setProp('poster', e.target.value)} /></Field>
        <div className="flex flex-wrap gap-3 text-xs">
          {[['controls', t('cst.video.controls', 'Controls'), true], ['muted', t('cst.video.muted', 'Muted'), false],
            ['loop', t('cst.video.loop', 'Loop'), false], ['autoplay', t('cst.video.auto', 'Autoplay'), false]].map(([k, label, dflt]) => (
              <label key={k} className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={p[k] ?? dflt} onChange={(e) => setProp(k, e.target.checked)} />{label}
              </label>
          ))}
        </div>
        {/* Said rather than silently ignored. Every browser refuses to autoplay a video with
            sound, so the two boxes together are the only combination that does anything —
            a checkbox that does nothing is worse than no checkbox. */}
        {p.autoplay && !p.muted && (
          <p className="text-[11px] text-warning">{t('cst.video.automute', 'Autoplay only works on a muted video, every browser blocks the other kind. Tick Muted, or the video will simply wait to be played.')}</p>
        )}
      </>)}
      {sel.kind === 'embed' && (<>
        <Field label={t('cst.embed.url', 'Embed URL')}><Input value={p.url || ''} onChange={(e) => setProp('url', e.target.value)} placeholder="https://www.youtube.com/embed/…" /></Field>
        <Field label={t('cst.embed.title', 'Title (for screen readers)')}><Input value={p.title || ''} onChange={(e) => setProp('title', e.target.value)} /></Field>
        {/* The allow-list is B.MD's, shared with every embed in a blog post or a doc — not a
            second list. A refused URL still renders, as a link, so it is visible that it was
            refused rather than looking like a blank block. */}
        <p className="text-[11px] text-[var(--muted)]">{t('cst.embed.allow', 'Only YouTube and Spotify embed links can be framed, the same list the rest of the site uses. Anything else is shown as a link instead.')}</p>
      </>)}
      {sel.kind === 'replay' && (
        <Field label={t('cst.replay.src', '.bmmreplay URL')} hint={t('cst.replay.h', 'A recording of the app, played by the docs and blog player.')}>
          <Input value={p.src || ''} onChange={(e) => setProp('src', e.target.value)} placeholder="/uploads/demo.bmmreplay" />
        </Field>
      )}
      {sel.kind === 'button' && <ButtonFields t={t} p={p} setProp={setProp} />}
      {sel.kind === 'shape' && <ShapeFields t={t} p={p} setProp={setProp} />}
      {sel.kind === 'svg' && <SvgFields t={t} p={p} setProp={setProp} />}
      {(sel.kind === 'box' || sel.kind === 'shape' || sel.kind === 'text') && <PatternFields t={t} p={p} setProp={setProp} />}
      <CssFields t={t} p={p} setProp={setProp} />
      <AnimFields t={t} sel={sel} patch={patch} />
      {/* Opacity sits on the BLOCK, not in props: it applies to the wrapper, so it behaves the
          same for a picture, a video and a paragraph. Per-kind it would have been written five
          times and forgotten in two. */}
      <Field label={`${t('cst.opacity', 'Opacity')} · ${Math.round((sel.opacity ?? 1) * 100)}%`}>
        <input type="range" min="0" max="100" step="5" className="w-full"
          value={Math.round((sel.opacity ?? 1) * 100)}
          onChange={(e) => patch(sel.id, { opacity: Number(e.target.value) / 100 }, `op-${sel.id}`)} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label={t('cst.rotate', 'Rotation (°)')}><Input type="number" min={-180} max={180} value={sel.rotate || 0} onChange={(e) => patch(sel.id, { rotate: Math.max(-180, Math.min(180, Number(e.target.value) || 0)) }, `rot-${sel.id}`)} /></Field>
        <Field label={t('cst.shadow', 'Shadow')}>
          <Select value={sel.shadow || ''} onChange={(e) => patch(sel.id, { shadow: e.target.value })}>
            <option value="">{t('cst.shadow.none', 'None')}</option>
            {SHADOWS.map((v) => <option key={v} value={v}>{t(`cst.shadow.${v}`, v)}</option>)}
          </Select>
        </Field>
      </div>
      <Field label={t('cst.hover', 'On hover')}>
        <Select value={sel.hover || ''} onChange={(e) => patch(sel.id, { hover: e.target.value })}>
          <option value="">{t('cst.hover.none', 'Nothing')}</option>
          {HOVER_EFFECTS.map((v) => <option key={v} value={v}>{t(`cst.hover.${v}`, v)}</option>)}
        </Select>
      </Field>
      {/* What pressing the block does (phase 5), on every kind. Written to the BLOCK itself on
          any board: an action has one copy, like the content, never a theme or phone overlay. */}
      <ActionFields t={t} sel={sel} blocks={canvas.blocks} pages={pageList}
        onChange={(steps) => emit(canvas.blocks.map((b) => (b.id === sel.id ? { ...b, action: steps } : b)), {}, `act-${sel.id}`)} />
      {/* Only where it paints: a button takes its colour above, a shape its fill. */}
      {!NO_BG.has(sel.kind) && <Field label={t('cst.bg', 'Background')}><Input value={p.bg || ''} onChange={(e) => setProp('bg', e.target.value)} placeholder="rgba(99,102,241,0.1)" /></Field>}
      <Field label={t('cst.radius', 'Corner radius')}><Input type="number" value={p.radius ?? ''} onChange={(e) => setProp('radius', e.target.value === '' ? undefined : Number(e.target.value))} /></Field>
      <button className="text-[11px] text-[var(--faint)] hover:text-[var(--text)]" onClick={() => setSelId(null)}>{t('cst.deselect', 'Deselect')}</button>
    </div>
  );
}

/** In the inspector when the selection came from a component: detach, refresh, redefine. */
export function ComponentSection({ t, ids, components, onDetach, onRefresh, onRedefine }) {
  return (
    <div className="mt-3 rounded-xl border border-[var(--line)] p-3 space-y-2">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--faint)] flex items-center gap-1.5"><Puzzle size={12} /> {t('cst.cmp', 'Components')}</div>
      {ids.map((id) => {
        const c = components.find((x) => x.id === id);
        return (
          <div key={id} className="space-y-1.5">
            <div className="text-xs font-medium truncate">{c ? c.name : t('cst.cmp.gone', 'A component that was deleted')}</div>
            <div className="flex flex-wrap gap-1.5">
              <Button size="sm" variant="ghost" onClick={onDetach} title={t('cst.cmp.detach.h', 'Keep the blocks, forget the link, updates to the component no longer reach them')}><Unlink size={13} /> {t('cst.cmp.detach', 'Detach')}</Button>
              {c && <Button size="sm" variant="ghost" onClick={() => onRefresh(id)} title={t('cst.cmp.refresh.h', 'Rebuild every copy on this page from the saved component')}><RefreshCw size={13} /> {t('cst.cmp.refresh', 'Update all copies')}</Button>}
              {c && <Button size="sm" variant="ghost" onClick={() => onRedefine(id)} title={t('cst.cmp.redefine.h', 'Make the selection the new definition, and rebuild every copy from it')}><Save size={13} /> {t('cst.cmp.redefine', 'Redefine from selection')}</Button>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** The button block's own fields: its look. What it DOES is the "On click" section, which every
 *  block has (editor/studio-actions.jsx, phase 5). */
export function ButtonFields({ t, p, setProp }) {
  const items = Array.isArray(p.items) ? p.items : [];
  const itemsText = items.map((it) => `${it.label || ''} | ${it.href || ''}`).join('\n');
  const isDropdown = (p.variant || 'button').startsWith('dropdown');
  return (<>
    <Field label={t('cst.btn.label', 'Label')}><Input value={p.label || ''} onChange={(e) => setProp('label', e.target.value)} /></Field>
    <div className="grid grid-cols-2 gap-2">
      <Field label={t('cst.btn.variant', 'Look')}>
        <Select value={p.variant || 'button'} onChange={(e) => setProp('variant', e.target.value)}>
          {BUTTON_VARIANTS.map((v) => <option key={v} value={v}>{t(`cst.btn.v.${v}`, v)}</option>)}
        </Select>
      </Field>
      <Field label={t('cst.btn.size', 'Size')}>
        <Select value={p.size || 'md'} onChange={(e) => setProp('size', e.target.value)}>
          {['sm', 'md', 'lg'].map((v) => <option key={v} value={v}>{v}</option>)}
        </Select>
      </Field>
    </div>
    <div className="grid grid-cols-2 gap-2">
      <Field label={t('cst.btn.color', 'Colour')}><Input value={p.color || ''} onChange={(e) => setProp('color', e.target.value)} placeholder="#f97316" /></Field>
      <Field label={t('cst.btn.align', 'Align')}>
        <Select value={p.align || 'center'} onChange={(e) => setProp('align', e.target.value)}>
          {['left', 'center', 'right'].map((v) => <option key={v} value={v}>{t(`cst.btn.align.${v}`, v)}</option>)}
        </Select>
      </Field>
    </div>
    <label className="flex items-center gap-1.5 text-xs cursor-pointer"><input type="checkbox" checked={!!p.outline} onChange={(e) => setProp('outline', e.target.checked)} /> {t('cst.btn.outline', 'Outline')}</label>
    {p.variant === 'card' && <Field label={t('cst.btn.desc', 'Description (card)')}><Input value={p.desc || ''} onChange={(e) => setProp('desc', e.target.value)} /></Field>}
    {isDropdown ? (
      <Field label={t('cst.btn.items', 'Menu items, one per line: label | link')}>
        <Textarea rows={4} value={itemsText} onChange={(e) => setProp('items', e.target.value.split('\n').map((l) => { const [label, href] = l.split('|'); return { label: (label || '').trim(), href: (href || '').trim() }; }).filter((it) => it.label))} />
        {items.some((it) => it.href && !menuItemHref(it.href)) && (
          <p className="text-[11px] text-error mt-1" role="alert">
            {t('cst.btn.items.unsafe', 'Refused, these entries lead nowhere for visitors: {list}').replace('{list}', items.filter((it) => it.href && !menuItemHref(it.href)).map((it) => it.label).join(', '))}
          </p>
        )}
      </Field>
    ) : (
      <Field label={t('cst.btn.doneafter', 'Label after it ran (copied, sent)')}><Input value={p.doneLabel || ''} onChange={(e) => setProp('doneLabel', e.target.value)} placeholder="✓" /></Field>
    )}
  </>);
}

/** How a block arrives, and whether it keeps moving. On every kind. */
export function AnimFields({ t, sel, patch }) {
  const a = sel.anim || null;
  const set = (k, v) => patch(sel.id, { anim: { ...(a || { kind: 'fade' }), [k]: v } });
  return (
    <div className="rounded-lg border border-[var(--line)] p-2 space-y-2">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--faint)] flex items-center gap-1.5"><Sparkles size={12} /> {t('cst.anim', 'Animation')}</div>
      <Field label={t('cst.anim.kind', 'Kind')}>
        <Select value={a?.kind || ''} onChange={(e) => (e.target.value ? set('kind', e.target.value) : patch(sel.id, { anim: null }))}>
          <option value="">{t('cst.anim.none', 'None')}</option>
          {ANIM_KINDS.map((k) => <option key={k} value={k}>{t(`cst.anim.k.${k}`, k)}</option>)}
        </Select>
      </Field>
      {a && (<>
        <Field label={t('cst.anim.trigger', 'Starts')}>
          <Select value={a.trigger || 'show'} onChange={(e) => set('trigger', e.target.value)}>
            {ANIM_TRIGGERS.map((k) => <option key={k} value={k}>{t(`cst.anim.t.${k}`, k)}</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label={t('cst.anim.delay', 'Delay (ms)')}><Input type="number" min="0" step="50" value={a.delay ?? 0} onChange={(e) => set('delay', Number(e.target.value) || 0)} /></Field>
          <Field label={t('cst.anim.duration', 'Duration (ms)')}><Input type="number" min="50" step="50" value={a.duration ?? 700} onChange={(e) => set('duration', Number(e.target.value) || 700)} /></Field>
        </div>
        {/* The curve. A NAME, resolved to a bezier by lib/canvas.js at render time: the value
            reaches a style attribute on a public page, so the author picks from a list rather
            than typing CSS into it. */}
        <Field label={t('cst.anim.easing', 'Curve')} hint={t('cst.anim.easing.h', 'How it moves through its duration. Spring overshoots a little at the end.')}>
          <Select value={a.easing || 'smooth'} onChange={(e) => set('easing', e.target.value)}>
            {ANIM_EASINGS.map((k) => <option key={k} value={k}>{t(`cst.anim.e.${k}`, k)}</option>)}
          </Select>
        </Field>
        <label className="flex items-center gap-1.5 text-xs cursor-pointer"><input type="checkbox" checked={!!a.loop} onChange={(e) => set('loop', e.target.checked)} /> {t('cst.anim.loop', 'Loop')}</label>
        {a.kind === 'custom' && (
          <Field label={t('cst.anim.custom', 'Keyframes (the body of an @keyframes rule)')} hint={t('cst.anim.custom.h', 'e.g.  from { opacity: 0; transform: rotate(-6deg) }  to { opacity: 1; transform: none }')}>
            <Textarea rows={4} value={a.custom || ''} onChange={(e) => set('custom', e.target.value)} />
          </Field>
        )}
      </>)}
    </div>
  );
}

/** A shape block's own fields. */
export function ShapeFields({ t, p, setProp }) {
  return (<>
    <div className="grid grid-cols-2 gap-2">
      <Field label={t('cst.shape', 'Shape')}><Select value={p.shape || 'rect'} onChange={(e) => setProp('shape', e.target.value)}>{SHAPES.map((s) => <option key={s} value={s}>{t(`cst.shape.${s}`, s)}</option>)}</Select></Field>
      <Field label={t('cst.shape.fill', 'Fill')}><Input value={p.fill || ''} onChange={(e) => setProp('fill', e.target.value)} placeholder="var(--primary) · #f97316 · none" /></Field>
      <Field label={t('cst.shape.fill2', 'Gradient to (optional)')}><Input value={p.fill2 || ''} onChange={(e) => setProp('fill2', e.target.value || undefined)} placeholder="#ec4899" /></Field>
      <Field label={t('cst.shape.stroke', 'Stroke')}><Input value={p.stroke || ''} onChange={(e) => setProp('stroke', e.target.value)} placeholder="none · #000" /></Field>
      <Field label={t('cst.shape.sw', 'Stroke width')}><Input type="number" min={0} max={40} value={p.strokeWidth ?? 0} onChange={(e) => setProp('strokeWidth', Number(e.target.value) || 0)} /></Field>
      <Field label={t('cst.shape.dash', 'Dash (e.g. 6 4)')}><Input value={p.dash || ''} onChange={(e) => setProp('dash', e.target.value.replace(/[^\d\s,.]/g, ''))} /></Field>
      {(p.shape || 'rect') === 'rounded' && <Field label={t('cst.shape.corner', 'Corner (0–50)')}><Input type="number" min={0} max={50} value={p.corner ?? 12} onChange={(e) => setProp('corner', Number(e.target.value) || 0)} /></Field>}
      <Field label={t('cst.shape.opacity', 'Opacity')}><Input type="number" min={0} max={1} step={0.05} value={p.opacity ?? 1} onChange={(e) => setProp('opacity', Math.max(0, Math.min(1, Number(e.target.value))))} /></Field>
    </div>
    <label className="flex items-center gap-1.5 text-xs cursor-pointer"><input type="checkbox" checked={!!p.keepRatio} onChange={(e) => setProp('keepRatio', e.target.checked)} /> {t('cst.shape.ratio', 'Keep the shape\u2019s proportions')}</label>
    <div className="grid grid-cols-[1fr_auto_auto] gap-2">
      <Field label={t('cst.shape.text', 'Text inside')}><Input value={p.text || ''} maxLength={80} onChange={(e) => setProp('text', e.target.value)} /></Field>
      <Field label={t('cst.shape.textColor', 'Colour')}><Input value={p.textColor || ''} onChange={(e) => setProp('textColor', e.target.value)} placeholder="#fff" className="w-24" /></Field>
      <Field label={t('cst.shape.textSize', 'Size')}><Input type="number" min={4} max={60} value={p.textSize ?? 14} onChange={(e) => setProp('textSize', Number(e.target.value) || 14)} className="w-20" /></Field>
    </div>
  </>);
}

/** A tiling pattern on a box or a shape. */
export function PatternFields({ t, p, setProp }) {
  const pat = p.pattern || {};
  const set = (k, v) => setProp('pattern', { ...pat, [k]: v });
  return (
    <div className="rounded-lg border border-[var(--line)] p-2 space-y-2">
      <div className="text-[11px] uppercase tracking-wider text-[var(--faint)]">{t('cst.pattern', 'Pattern')}</div>
      <div className="grid grid-cols-2 gap-2">
        <Select value={pat.id || ''} onChange={(e) => (e.target.value ? set('id', e.target.value) : setProp('pattern', undefined))}>
          <option value="">{t('cst.pattern.none', 'None')}</option>
          {PATTERNS.map((x) => <option key={x.id} value={x.id}>{t(`cst.pattern.${x.id}`, x.name)}</option>)}
        </Select>
        {pat.id && <Input value={pat.color || '#000000'} onChange={(e) => set('color', e.target.value)} placeholder="#000000" />}
        {pat.id && <Field label={t('cst.pattern.size', 'Tile (px)')}><Input type="number" min={6} max={160} value={pat.size ?? 24} onChange={(e) => set('size', Number(e.target.value) || 24)} /></Field>}
        {pat.id && <Field label={t('cst.pattern.opacity', 'Opacity')}><Input type="number" min={0} max={1} step={0.05} value={pat.opacity ?? 0.35} onChange={(e) => set('opacity', Math.max(0, Math.min(1, Number(e.target.value))))} /></Field>}
      </div>
    </div>
  );
}

/** The raw-SVG block. What is stored is what is typed; what is drawn is what survives the sanitiser. */
export function SvgFields({ t, p, setProp }) {
  const dropped = svgRefusals(p.svg);
  return (
    <Field label={t('cst.svg', 'SVG markup')} hint={t('cst.svg.h', 'Paste an <svg>. Scripts, event handlers, external references, images, styles and animation are removed when it is drawn.')}>
      <Textarea rows={8} value={p.svg || ''} onChange={(e) => setProp('svg', e.target.value.slice(0, 200_000))} className="font-mono text-[11.5px]" spellCheck={false} />
      {dropped.length > 0 && <p className="text-[11.5px] text-warning mt-1">{t('cst.svg.dropped', 'Removed when drawn:')} {dropped.join(' · ')}</p>}
    </Field>
  );
}

/** Classes and inline style, for any block. */
export function CssFields({ t, p, setProp }) {
  return (
    <details className="rounded-lg border border-[var(--line)] p-2">
      <summary className="text-[11px] uppercase tracking-wider text-[var(--faint)] cursor-pointer">{t('cst.cssblock', 'Classes & style')}</summary>
      <div className="mt-2 space-y-2">
        <Field label={t('cst.cls', 'CSS classes')} hint={t('cst.cls.h', 'Your own classes from the page CSS, or utilities the site already ships (a class the build does not know does nothing).')}><Input value={p.cls || ''} onChange={(e) => setProp('cls', e.target.value)} placeholder="hero rounded-2xl backdrop-blur" /></Field>
        <Field label={t('cst.style', 'Inline style')} hint={t('cst.style.h', 'Declarations, semicolon-separated. External url() is refused.')}><Textarea rows={2} value={p.style || ''} onChange={(e) => setProp('style', e.target.value.slice(0, 4000))} className="font-mono text-[11.5px]" spellCheck={false} placeholder="letter-spacing: .04em; backdrop-filter: blur(6px)" /></Field>
      </div>
    </details>
  );
}

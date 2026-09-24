// The studio's side of containers (PLAN-STUDIO-2026, phase 7a): a group, a tab card, a dialog.
//
// The rules are the package's (packages/studio/src/tree.js): what may hold what, how deep, how
// a block's stored coordinates relate to its container, how a selection becomes a group. This
// file only draws the pieces the studio needs around them, so canvas-studio.jsx (already the
// largest file of the web) grows by its wiring and not by these:
//
//   · LayersTree   the Layers panel as a TREE (role="tree"): a container's blocks under it,
//                  indented, folded or not; a click selects a block where it lives
//   · ScopeBar     where the selection is: the page, or inside which container (double-click
//                  a container to go in, Escape to come out), with a way back up at each level
//   · ContainerFields  the inspector's section: the tabs of a tab card, a dialog's title, and
//                  "which container is this block in", the keyboard's way to move a block in
//                  or out (the pointer's way is dropping it there on the board)
import { useState } from 'react';
import {
  ChevronUp, ChevronDown, ChevronRight, Lock, LockOpen, Eye, EyeOff, LayoutList, Type, Plus, Trash2,
  Ungroup, CornerLeftUp, AppWindow,
} from 'lucide-react';
import { Button, Field, Input, Select } from '../ui/ui.jsx';
import {
  paintOrder, isContainer, tabLabels, treeIndex, descendantIds, subtreeHeight, reorderSiblings, removeTab,
  MAX_DEPTH, MAX_TABS, TAB_LABEL_MAX,
} from '../lib/canvas.js';

/** Words for a block kind. Literal keys, so the i18n checker sees every one. */
export function kindLabel(t, kind) {
  switch (kind) {
    case 'group': return t('cst.kind.group', 'Group');
    case 'tabs': return t('cst.kind.tabs', 'Tab card');
    case 'modal': return t('cst.kind.modal', 'Dialog');
    default: return t(`cst.kind.${kind}`, kind);
  }
}

/** Words for a broken link in the tree (tree.js), shown on the block's row. */
export function treeReasonText(t, reason) {
  switch (reason) {
    case 'unknown_parent': return t('cst.tree.r.unknown', 'Its container is not on this page.');
    case 'self_parent': return t('cst.tree.r.self', 'It names itself as its own container.');
    case 'not_container': return t('cst.tree.r.notbox', 'What it names as its container cannot hold blocks.');
    case 'cycle': return t('cst.tree.r.cycle', 'Its containers loop back on each other.');
    case 'too_deep': return t('cst.tree.r.deep', 'More than three containers deep.');
    case 'modal_nested': return t('cst.tree.r.modal', 'A dialog cannot be inside another block.');
    case 'too_many': return t('cst.tree.r.many', 'Its container already holds a hundred blocks.');
    default: return t('cst.tree.r.broken', 'The container above it is broken.');
  }
}

/** A block's name in a list: its own name, else its kind and the end of its id. */
const rowName = (t, b) => b.name || `${kindLabel(t, b.kind)} #${String(b.id).slice(-3)}`;

/**
 * The Layers panel as a tree. Rows: top of the paint order first, a container's blocks under it,
 * each level indented; a container folds. `onSelect(id, additive)` selects a block where it is
 * (the studio goes into its container). The arrows move a block among its SIBLINGS only: the
 * paint order is per container, a child is always drawn over its own container.
 */
export function LayersTree({ t, canvas, selIds, onSelect, patch, emit, add, bare = false, offIds = null, editSlots = {} }) {
  const [folded, setFolded] = useState({});
  const blocks = canvas.blocks;
  const { childrenOf } = treeIndex(blocks);
  // A broken block (tree.js) is listed at the top level, where the board draws it.
  const roots = blocks.filter((b) => !b.parent || b.treeError);
  const rows = [];
  const walk = (list, level, guard) => {
    const ordered = paintOrder(list).slice().reverse();
    ordered.forEach((b, i) => {
      rows.push({ b, level, first: i === 0, last: i === ordered.length - 1 });
      if (isContainer(b.kind) && !b.treeError && !folded[b.id] && guard <= MAX_DEPTH) walk(childrenOf(b.id), level + 1, guard + 1);
    });
  };
  walk(roots, 1, 0);
  const labelsOf = (id) => tabLabels(blocks.find((x) => x.id === id)?.props);
  return (
    // `bare` is the dock's form: the panel already has a title bar and a border of its own.
    <div className={bare ? '' : 'mb-3 rounded-xl border border-[var(--line)] p-2'} data-layers-tree>
      {!bare && (
        <div className="flex items-center gap-1.5 mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--faint)]">
          <LayoutList size={12} /> {t('cst.layers', 'Layers')}
          <span className="ms-auto tabular-nums font-normal">{blocks.length}</span>
        </div>
      )}
      {!blocks.length && (
        <div className="py-3 text-center">
          <div className="text-xs text-[var(--muted)]">{t('cst.layers.empty', 'No blocks yet, so there is no paint order to show.')}</div>
          {add && <div className="mt-2 flex justify-center">
            <Button size="sm" variant="primary" onClick={() => add('text')}><Type size={14} /> {t('cst.empty.add', 'Add a text block')}</Button>
          </div>}
        </div>
      )}
      <div role="tree" aria-label={t('cst.layers', 'Layers')} aria-multiselectable="true"
        className={`${bare ? '' : 'max-h-56 overflow-auto '}space-y-0.5`}>
        {rows.map(({ b, level, first, last }) => {
          const on = selIds.includes(b.id);
          const box = isContainer(b.kind) && !b.treeError;
          const parent = b.parent && !b.treeError ? blocks.find((x) => x.id === b.parent) : null;
          const tab = parent?.kind === 'tabs' ? (labelsOf(parent.id)[b.slot || 0] || `${(b.slot || 0) + 1}`) : '';
          const hiddenTab = parent?.kind === 'tabs' && (b.slot || 0) !== (editSlots[parent.id] || 0);
          return (
            <div key={b.id} role="treeitem" aria-level={level} aria-selected={on} aria-expanded={box ? !folded[b.id] : undefined}
              data-layer-row={b.id} data-layer-level={level}
              className={`flex items-center gap-1 rounded-lg py-1 pe-1.5 text-xs cursor-pointer ${on ? 'tint-primary' : 'hover:bg-[var(--surface-2)]'}`}
              style={{ paddingInlineStart: 6 + (level - 1) * 14 }}
              onClick={(e) => onSelect(b.id, e.shiftKey || e.ctrlKey || e.metaKey)}>
              {box ? (
                <button type="button" className="p-0.5 rounded hover:bg-[var(--surface-2)]" aria-label={folded[b.id] ? t('cst.tree.unfold', 'Show what is inside') : t('cst.tree.fold', 'Fold')}
                  title={folded[b.id] ? t('cst.tree.unfold', 'Show what is inside') : t('cst.tree.fold', 'Fold')}
                  onClick={(e) => { e.stopPropagation(); setFolded((f) => ({ ...f, [b.id]: !f[b.id] })); }}>
                  <ChevronRight size={12} style={{ transform: folded[b.id] ? undefined : 'rotate(90deg)' }} />
                </button>
              ) : <span className="w-[16px] shrink-0" aria-hidden />}
              <span className={`flex-1 min-w-0 truncate ${b.hidden || hiddenTab ? 'text-[var(--faint)]' : ''} ${b.hidden ? 'line-through' : ''}`}>
                {rowName(t, b)}
                {box && <span className="text-[var(--faint)] ms-1">· {kindLabel(t, b.kind)}</span>}
                {tab && <span className="text-[var(--faint)] ms-1" data-layer-tab>· {tab}</span>}
              </span>
              {b.treeError && (
                <span className="cst-offframe" data-tree-error={b.treeError} title={treeReasonText(t, b.treeError)}>{t('cst.tree.broken', 'Broken link')}</span>
              )}
              {offIds?.has(b.id) && (
                <span className="cst-offframe" data-off-frame title={t('cst.frame.off.h', 'Outside the page frame: it stays on the board, and visitors never see it')}>
                  {t('cst.frame.off', 'Off frame')}
                </span>
              )}
              <button type="button" className="p-0.5 rounded hover:bg-[var(--surface-2)] disabled:opacity-30" disabled={first} onClick={(e) => { e.stopPropagation(); emit(reorderSiblings(blocks, b.id, 'up')); }} title={t('cst.layer.up', 'Move up')} aria-label={t('cst.layer.up', 'Move up')}><ChevronUp size={12} /></button>
              <button type="button" className="p-0.5 rounded hover:bg-[var(--surface-2)] disabled:opacity-30" disabled={last} onClick={(e) => { e.stopPropagation(); emit(reorderSiblings(blocks, b.id, 'down')); }} title={t('cst.layer.down', 'Move down')} aria-label={t('cst.layer.down', 'Move down')}><ChevronDown size={12} /></button>
              <button type="button" className={`p-0.5 rounded hover:bg-[var(--surface-2)] ${b.locked ? 'text-[var(--accent-ink)]' : 'text-[var(--faint)]'}`} onClick={(e) => { e.stopPropagation(); patch(b.id, { locked: !b.locked }); }} title={b.locked ? t('cst.layer.unlock', 'Unlock') : t('cst.layer.lock', 'Lock')} aria-label={b.locked ? t('cst.layer.unlock', 'Unlock') : t('cst.layer.lock', 'Lock')}>{b.locked ? <Lock size={12} /> : <LockOpen size={12} />}</button>
              <button type="button" className={`p-0.5 rounded hover:bg-[var(--surface-2)] ${b.hidden ? 'text-[var(--accent-ink)]' : 'text-[var(--faint)]'}`} onClick={(e) => { e.stopPropagation(); patch(b.id, { hidden: !b.hidden }); }} title={b.hidden ? t('cst.layer.show', 'Show') : t('cst.layer.hide', 'Hide')} aria-label={b.hidden ? t('cst.layer.show', 'Show') : t('cst.layer.hide', 'Hide')}>{b.hidden ? <EyeOff size={12} /> : <Eye size={12} />}</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Where the selection is: the page, or inside a container, one crumb per level. Shown only
 * inside a container; each crumb goes back up to that level.
 */
export function ScopeBar({ t, canvas, scope, onScope }) {
  if (!scope) return null;
  const chain = [];
  let cur = canvas.blocks.find((b) => b.id === scope);
  let guard = 0;
  while (cur && guard++ <= MAX_DEPTH) { chain.unshift(cur); cur = cur.parent ? canvas.blocks.find((b) => b.id === cur.parent) : null; }
  return (
    <nav className="cst-scope flex items-center gap-1 flex-wrap text-[11px] mb-2" aria-label={t('cst.scope', 'Where you are editing')} data-cst-scope-bar={scope}>
      <button type="button" className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 hover:bg-[var(--surface-2)] text-[var(--muted)]" onClick={() => onScope('')}>
        <CornerLeftUp size={12} /> {t('cst.scope.page', 'Page')}
      </button>
      {chain.map((b, i) => (
        <span key={b.id} className="inline-flex items-center gap-1">
          <ChevronRight size={11} className="text-[var(--faint)]" aria-hidden />
          {i === chain.length - 1
            ? <span className="font-semibold" aria-current="location">{rowName(t, b)}</span>
            : <button type="button" className="rounded-md px-1.5 py-0.5 hover:bg-[var(--surface-2)] text-[var(--muted)]" onClick={() => onScope(b.id)}>{rowName(t, b)}</button>}
        </span>
      ))}
      <span className="text-[var(--faint)] ms-1">{t('cst.scope.h', 'Double-click a container to go in, Escape to come out.')}</span>
    </nav>
  );
}

/**
 * The containers block `id` could be moved into: not itself or anything under it, not a dialog
 * for a dialog (a dialog stays at the top), and not so deep that the block's own levels would
 * pass MAX_DEPTH. `[{ id, label, kind, tabs }]`.
 */
export function moveTargets(t, blocks, id) {
  const me = blocks.find((b) => b.id === id);
  if (!me || me.kind === 'modal') return [];
  const { depthOf } = treeIndex(blocks);
  const below = new Set([id, ...descendantIds(blocks, id)]);
  const extra = subtreeHeight(blocks, id);
  return blocks
    .filter((c) => isContainer(c.kind) && !c.treeError && !below.has(c.id) && depthOf(c.id) + 1 + extra <= MAX_DEPTH)
    .map((c) => ({ id: c.id, label: `${rowName(t, c)} · ${kindLabel(t, c.kind)}`, kind: c.kind, tabs: c.kind === 'tabs' ? tabLabels(c.props) : null }));
}

/**
 * The inspector's container section, for the selected block `sel`:
 *   · on a tab card: its tabs (rename, add, remove; removing one removes its blocks, undoable)
 *     and which one the board shows;
 *   · on a dialog: its title, and how it is opened;
 *   · on a group: ungroup;
 *   · on any block but a dialog: the container it is in, to move it in or out from the keyboard.
 */
export function ContainerFields({ t, sel, canvas, patch, emit, editSlot = 0, setEditSlot, onMoveTo, onUngroup }) {
  const raw = canvas.blocks.find((b) => b.id === sel.id) || sel;
  const targets = moveTargets(t, canvas.blocks, sel.id);
  const labels = sel.kind === 'tabs' ? tabLabels(raw.props) : [];
  const setLabels = (next) => patch(sel.id, { props: { ...(raw.props || {}), tabs: next } }, `tabs-${sel.id}`);
  const parent = raw.parent && !raw.treeError ? canvas.blocks.find((b) => b.id === raw.parent) : null;
  return (
    <div className="rounded-lg border border-[var(--line)] p-2 space-y-2" data-container-fields>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--faint)] flex items-center gap-1.5">
        <AppWindow size={12} /> {isContainer(sel.kind) ? kindLabel(t, sel.kind) : t('cst.box.in', 'Container')}
      </div>
      {sel.kind === 'tabs' && (<>
        <div className="space-y-1.5" data-tab-labels>
          {labels.map((l, i) => (
            <div key={i} className="flex items-center gap-1">
              <Input className="flex-1 min-w-0" value={l} maxLength={TAB_LABEL_MAX} aria-label={t('cst.tabs.label', 'Tab {n}').replace('{n}', String(i + 1))}
                placeholder={t('cst.tabs.label', 'Tab {n}').replace('{n}', String(i + 1))}
                onChange={(e) => setLabels(labels.map((x, j) => (j === i ? e.target.value : x)))} />
              <button type="button" className="p-1 rounded hover:bg-[var(--surface-2)] text-error disabled:opacity-30" disabled={labels.length <= 1}
                onClick={() => { emit(removeTab(canvas.blocks, sel.id, i)); if (editSlot >= i && editSlot > 0) setEditSlot?.(editSlot - 1); }}
                title={t('cst.tabs.remove', 'Remove this tab and the blocks in it')} aria-label={t('cst.tabs.remove', 'Remove this tab and the blocks in it')}><Trash2 size={13} /></button>
            </div>
          ))}
        </div>
        {labels.length < MAX_TABS && (
          <Button size="sm" variant="ghost" onClick={() => setLabels([...labels, t('cst.tabs.label', 'Tab {n}').replace('{n}', String(labels.length + 1))])}>
            <Plus size={13} /> {t('cst.tabs.add', 'Add a tab')}
          </Button>
        )}
        <Field label={t('cst.tabs.edit', 'Tab shown on the board')} hint={t('cst.tabs.edit.h', 'The blocks you add or drop into the card go into this tab. Visitors open the first one.')}>
          <Select value={String(Math.min(editSlot, labels.length - 1))} onChange={(e) => setEditSlot?.(Number(e.target.value))} data-edit-slot>
            {labels.map((l, i) => <option key={i} value={i}>{l || String(i + 1)}</option>)}
          </Select>
        </Field>
      </>)}
      {sel.kind === 'modal' && (<>
        <Field label={t('cst.modal.title', 'Title')} hint={t('cst.modal.title.h', 'Shown at the top of the dialog, and read out when it opens.')}>
          <Input value={raw.props?.title || ''} maxLength={200} onChange={(e) => patch(sel.id, { props: { ...(raw.props || {}), title: e.target.value } }, `mt-${sel.id}`)} />
        </Field>
        <p className="text-[11px] text-[var(--muted)]">{t('cst.modal.h', 'A dialog is not part of the page: visitors see it when a block with the step “Open a dialog” is pressed. Escape or its close button closes it.')}</p>
      </>)}
      {sel.kind === 'group' && onUngroup && (
        <Button size="sm" variant="ghost" onClick={onUngroup} title="Ctrl+Shift+G"><Ungroup size={13} /> {t('cst.ungroup', 'Ungroup')}</Button>
      )}
      {sel.kind !== 'modal' && (
        <Field label={t('cst.box.in', 'Container')} hint={t('cst.box.in.h', 'Or drag the block onto a container on the board, and out of it again.')}>
          <Select value={parent ? parent.id : ''} data-move-to onChange={(e) => {
            const id = e.target.value;
            const tg = targets.find((x) => x.id === id);
            onMoveTo(id, 0, tg);
          }}>
            <option value="">{t('cst.box.page', 'The page itself')}</option>
            {targets.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </Select>
        </Field>
      )}
      {parent?.kind === 'tabs' && (
        <Field label={t('cst.box.tab', 'In the tab')}>
          <Select value={String(raw.slot || 0)} data-move-slot onChange={(e) => onMoveTo(parent.id, Number(e.target.value))}>
            {tabLabels(parent.props).map((l, i) => <option key={i} value={i}>{l || String(i + 1)}</option>)}
          </Select>
        </Field>
      )}
    </div>
  );
}

// Two of the studio's dock panels (the palette, the saved components) and the empty board.
// Moved out of editor/canvas-studio.jsx (studio phase 8).
import {
  Type, Image as ImageIcon, Square, MousePointerClick, Film, Globe, PlayCircle, Sparkles, PanelTop, AppWindow,
  Plus, Trash2, Blocks,
} from 'lucide-react';
import { Button } from '../ui/ui.jsx';
import { thumbnailSvg } from '../lib/studio-components.js';
import { SHAPES } from '../lib/canvas.js';

/** The palette: every kind of block, and the shapes. One of the dock's panels. */
export function BlocksPanel({ t, add, addShape }) {
  const kinds = [['text', Type], ['image', ImageIcon], ['box', Square], ['button', MousePointerClick], ['video', Film], ['embed', Globe], ['replay', PlayCircle], ['svg', Sparkles]];
  return (
    // `data-tour` sits on the PANEL, not on the zone it happens to be docked in: the author
    // can drag any panel to any side, and an anchor that named a zone would point at whatever
    // they had moved there instead.
    <div className="space-y-2" data-tour="blocks">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--faint)]">{t('cst.pane.blocks.h', 'Add to the page')}</div>
      <div className="grid grid-cols-2 gap-1.5">
        {kinds.map(([k, Icon]) => (
          <Button key={k} size="sm" variant="ghost" className="justify-start" onClick={() => add(k)}><Icon size={14} /> {t(`cst.add.${k}`, k)}</Button>
        ))}
      </div>
      {/* Containers (phase 7a). A group is made from a selection, so it is not in this list. */}
      <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--faint)] pt-1">{t('cst.pane.boxes', 'Containers')}</div>
      <div className="grid grid-cols-2 gap-1.5">
        <Button size="sm" variant="ghost" className="justify-start" onClick={() => add('tabs')} data-add-kind="tabs"><PanelTop size={14} /> {t('cst.add.tabs', 'Tab card')}</Button>
        <Button size="sm" variant="ghost" className="justify-start" onClick={() => add('modal')} data-add-kind="modal"><AppWindow size={14} /> {t('cst.add.modal', 'Dialog')}</Button>
      </div>
      <p className="text-[11px] text-[var(--muted)]">{t('cst.pane.boxes.h', 'To group blocks, select them and press Group (Ctrl+G). Double-click a container to edit what is inside.')}</p>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--faint)] pt-1">{t('cst.shape', 'Shape')}</div>
      <div className="grid grid-cols-3 gap-1">
        {SHAPES.map((s) => (
          <button key={s} type="button" onClick={() => addShape(s)} className="text-[11px] px-1.5 py-1.5 rounded-lg border border-[var(--line)] hover:b-primary truncate" title={t(`cst.shape.${s}`, s)}>{t(`cst.shape.${s}`, s)}</button>
        ))}
      </div>
    </div>
  );
}

/** The saved components: a thumbnail, a name, insert and delete. */
export function ComponentsPanel({ t, components, insertComponent, deleteComponent }) {
  return (
    <div className="space-y-2" data-tour="components">
      <p className="text-[11px] text-[var(--muted)]">{t('cst.cmp.h', 'Select blocks on the board and choose “Save as component” to keep them here. Inserting places a copy; copies stay linked until you detach them.')}</p>
      {/* The action is a selection on the board, not a button that can live here — so the
          sentence names it rather than pretending there is something to press. */}
      {!components.length && (
        <div className="text-center py-6 px-3 rounded-xl border border-dashed border-[var(--line)]">
          <div className="text-[13px] font-semibold">{t('cst.cmp.empty', 'No saved components')}</div>
          <div className="text-xs text-[var(--muted)] mt-1">{t('cst.cmp.empty.s', 'Select blocks on the board, then use “Save as component” to keep that group here for every page you edit.')}</div>
        </div>
      )}
      <div className="space-y-1.5">
        {components.map((c) => (
          <div key={c.id} className="flex items-center gap-2 rounded-lg border border-[var(--line)] p-1.5">
            <span className="w-10 h-10 shrink-0 rounded-md bg-[var(--surface-2)] overflow-hidden" aria-hidden dangerouslySetInnerHTML={{ __html: thumbnailSvg(c.blocks, 40) }} />
            <span className="flex-1 min-w-0">
              <span className="block text-xs font-medium truncate" title={c.name}>{c.name}</span>
              <span className="block text-[10px] text-[var(--faint)] tabular-nums">{t('pce.canvases.n', '{n} block(s)').replace('{n}', c.blocks.length)} · {c.w}×{c.h}</span>
            </span>
            <Button size="sm" variant="ghost" className="!px-2" onClick={() => insertComponent(c)} title={t('cst.cmp.insert', 'Insert a copy')} aria-label={t('cst.cmp.insert', 'Insert a copy')}><Plus size={14} /></Button>
            <Button size="sm" variant="ghost" className="!px-2 !text-[var(--error)]" onClick={() => deleteComponent(c.id)} title={t('cst.cmp.delete', 'Delete this component (copies on pages stay)')} aria-label={t('cst.cmp.delete', 'Delete this component (copies on pages stay)')}><Trash2 size={14} /></Button>
          </div>
        ))}
      </div>
    </div>
  );
}

/** What a new page shows before it has anything on it: the three panes, in one sentence each. */
export function EmptyBoard({ t, onAdd, onOpenBlocks }) {
  return (
    <div className="mb-3 rounded-xl border border-dashed border-[var(--line)] p-4 text-sm" data-empty-board>
      <div className="font-medium mb-1">{t('cst.empty.title', 'This page is empty')}</div>
      <ul className="text-xs text-[var(--muted)] space-y-1 mb-3">
        <li><span className="font-medium text-[var(--text)]">{t('cst.pane.blocks', 'Blocks')}</span> — {t('cst.empty.blocks', 'on the left: everything you can add, the layers, and your saved components.')}</li>
        <li><span className="font-medium text-[var(--text)]">{t('cst.pane.canvas', 'Canvas')}</span> — {t('cst.empty.canvas', 'in the middle: a 1200px board. Drag to move, pull a handle to resize, drag on empty space to select several.')}</li>
        <li><span className="font-medium text-[var(--text)]">{t('cst.pane.props', 'Properties')}</span> — {t('cst.empty.props', 'on the right: everything about the selected block, content, size, animation, link.')}</li>
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="primary" onClick={onAdd}><Type size={14} /> {t('cst.empty.add', 'Add a text block')}</Button>
        <Button size="sm" variant="ghost" onClick={onOpenBlocks}><Blocks size={14} /> {t('cst.empty.browse', 'Browse the blocks')}</Button>
      </div>
    </div>
  );
}

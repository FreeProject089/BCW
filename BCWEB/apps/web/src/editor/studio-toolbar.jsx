// The studio's tool bar, over the board (moved out of editor/canvas-studio.jsx, studio phase 8).
//
// CONTEXTUAL (PLAN-STUDIO-2026, phase 8). The bar used to draw every command it knew, all the
// time: with nothing selected about twenty of them were greyed out (duplicate, delete, front,
// back, lock, hide, save as component...), which is a wall of controls to decode before the
// author has done anything. Now it is three groups, and a group is drawn only when it can run:
//
//   view       always: zoom, fit, show all, fit the frame, the hand, snapping, the grid;
//   selection  one block or more: duplicate, delete, save as component, group or ungroup,
//              front and back, lock and hide;
//   several    two blocks or more: align, same size, distribute (three or more), stagger.
//
// So nothing in this bar is ever disabled: a command that cannot run is not drawn at all. The
// document's own commands (undo, redo, save, the previews) live in the top bar, and every
// command is in ONE place: check-studio.mjs asserts both, on this file's markup.
//
// Every control carries an aria-label: it is the command's name for a screen reader, the
// tooltip's text and the key the uniqueness assertion reads.
import {
  Trash2, Eye, EyeOff, Magnet, Copy, Sparkles, Lock, LockOpen, Grid2x2, Puzzle,
  AlignStartVertical, AlignCenterVertical, AlignEndVertical, AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal,
  AlignHorizontalSpaceAround, AlignVerticalSpaceAround, ZoomIn, ZoomOut, Maximize, BringToFront, SendToBack,
  StretchHorizontal, StretchVertical, Hand, Expand, FoldVertical, Group, Ungroup,
} from 'lucide-react';
import { Button } from '../ui/ui.jsx';
import { GRID_SIZES, STAGGER_STEPS } from '../lib/canvas.js';

/** An icon command. `label` is its name everywhere: aria-label and tooltip. */
function Cmd({ label, icon: Icon, onClick, on = null, danger = false, text = '', data = {} }) {
  return (
    <Button size="sm" variant={on ? 'primary' : 'ghost'} className={`${text ? '' : '!px-2'} ${danger ? '!text-error' : ''}`}
      onClick={onClick} title={label} aria-label={label} aria-pressed={on == null ? undefined : !!on} {...data}>
      <Icon size={14} aria-hidden />{text ? <span className="cst-cmd-text">{text}</span> : null}
    </Button>
  );
}

export function Toolbar({ t,
  zoom, setZoom, zoomBy, fitScale = 1, onShowAll, frameFit = 'content', onFitContent,
  panMode = false, setPanMode, snapOn, setSnapOn, showGrid = true, setShowGrid, grid, setGrid,
  selCount = 0, selBlocks = [], duplicate, remove, onSaveComponent = null, onGroup = null, onUngroup = null,
  doZ, toggleFlag, doAlign, doDistribute, matchSize, stagger,
}) {
  const zoomPct = Math.round((zoom === 'fit' ? fitScale : Number(zoom)) * 100);
  const anyLocked = selBlocks.some((b) => b.locked);
  const anyHidden = selBlocks.some((b) => b.hidden);
  const L = {
    zoomOut: t('cst.zoom.out', 'Zoom out'), zoomIn: t('cst.zoom.in', 'Zoom in'), zoom: t('cst.zoom', 'Zoom'),
    fitFrame: t('cst.zoom.fitframe', 'Fit the frame to the pane (0)'),
    all: t('cst.zoom.all', 'Show everything, blocks off the frame included (Shift+1)'),
    fitContent: t('cst.frame.fit', 'Fit the frame to its content: the page grows and shrinks with its blocks again'),
    pan: t('cst.pan.h', 'Drag the board around instead of selecting (or hold space)'),
    snap: t('cst.snap.h', 'Snap to the grid and to other blocks'),
    grid: t('cst.grid.show', 'Show the grid'), gridStep: t('cst.grid', 'Grid'),
    dup: t('cst.dup.h', 'Duplicate the selection (Ctrl+D)'), del: t('cst.del', 'Delete'),
    comp: t('cst.cmp.saveas.h2', 'Keep the selection as a reusable component'),
    group: t('cst.group.h', 'Put the selection in a group, moved and shown as one (Ctrl+G)'),
    ungroup: t('cst.ungroup.h', 'Take the blocks out of this group (Ctrl+Shift+G)'),
    front: t('cst.front', 'Bring to front'), back: t('cst.back', 'Send to back'),
    lock: t('cst.locked.h2', 'Lock or unlock the selection (L)'), hide: t('cst.hidden.h2', 'Hide or show the selection (H)'),
    sameW: t('cst.same.w', 'Same width as the first block picked'), sameH: t('cst.same.h', 'Same height as the first block picked'),
    distX: t('cst.dist.x', 'Even gaps across'), distY: t('cst.dist.y', 'Even gaps down'),
    stagger: t('cst.anim.stagger', 'Stagger'),
  };
  // The English fallback is the real label, not the key: `t(k, fallback)` shows the fallback
  // when there is no entry for the language, so a bare `how` here meant the tooltip on an
  // icon-only button read "hcenter".
  const aligns = [
    ['left', AlignStartVertical, t('cst.al.left', 'Align left')], ['hcenter', AlignCenterVertical, t('cst.al.hcenter', 'Centre horizontally')],
    ['right', AlignEndVertical, t('cst.al.right', 'Align right')], ['top', AlignStartHorizontal, t('cst.al.top', 'Align top')],
    ['vmiddle', AlignCenterHorizontal, t('cst.al.vmiddle', 'Centre vertically')], ['bottom', AlignEndHorizontal, t('cst.al.bottom', 'Align bottom')],
  ];
  return (
    // Wraps rather than scrolling sideways: the studio is refused below 768px, and at every
    // width it is drawn at a scrolled-away command is a command elementFromPoint cannot reach
    // (and a person cannot see). A second row is the price of three groups on a narrow centre.
    <div className="cst-toolbar" role="toolbar" aria-label={t('cst.toolbar', 'Tools')} data-sel={selCount} data-tour="tools">
      {/* ── View: always, and never disabled. */}
      <div className="cst-tools" data-tools="view">
        {zoomBy && <Cmd label={L.zoomOut} icon={ZoomOut} onClick={() => zoomBy(-1)} />}
        <select className="cst-select" value={zoom === 'fit' || [0.5, 0.75, 1].includes(Number(zoom)) ? String(zoom) : 'custom'}
          onChange={(e) => { if (e.target.value !== 'custom') setZoom(e.target.value === 'fit' ? 'fit' : Number(e.target.value)); }}
          aria-label={L.zoom} title={L.zoom} data-zoom-pct={zoomPct}>
          <option value="fit">{t('cst.zoom.fit', 'Fit')}</option><option value="0.5">50%</option><option value="0.75">75%</option><option value="1">100%</option>
          {zoom !== 'fit' && ![0.5, 0.75, 1].includes(Number(zoom)) && <option value="custom">{zoomPct}%</option>}
        </select>
        {zoomBy && <Cmd label={L.zoomIn} icon={ZoomIn} onClick={() => zoomBy(1)} />}
        {/* Only while zoomed away from the fit: fitted, it would do nothing. */}
        {zoom !== 'fit' && <Cmd label={L.fitFrame} icon={Maximize} onClick={() => setZoom('fit')} />}
        {onShowAll && <Cmd label={L.all} icon={Expand} onClick={onShowAll} />}
        {/* Only while the height is pinned: a frame that already follows its content has
            nothing to be handed back. */}
        {onFitContent && frameFit === 'fixed' && <Cmd label={L.fitContent} icon={FoldVertical} onClick={onFitContent} data={{ 'data-fit-content': '' }} />}
        {/* The hand. Zoomed past the pane the board could only be moved by a scrollbar, which a
            touch author never gets; space-drag and the middle button do the same thing. */}
        {setPanMode && <Cmd label={L.pan} icon={Hand} on={panMode} onClick={() => setPanMode((v) => !v)} />}
        <span className="cst-tools-sep" aria-hidden />
        <Cmd label={L.snap} icon={Magnet} on={snapOn} onClick={() => setSnapOn((v) => !v)} />
        {/* ONE grid control, not two: the glyph is the toggle, the number beside it the step. */}
        <span className="cst-grid-pair" title={t('cst.grid.h', 'The grid step blocks snap to')}>
          {setShowGrid && (
            <button type="button" onClick={() => setShowGrid((v) => !v)} aria-pressed={showGrid}
              className={`inline-flex p-1 rounded-md ${showGrid ? 'tint-primary text-[var(--text)]' : 'text-[var(--muted)]'}`}
              title={L.grid} aria-label={L.grid}><Grid2x2 size={13} aria-hidden /></button>
          )}
          <select className="cst-select" value={grid} onChange={(e) => setGrid(Number(e.target.value))} aria-label={L.gridStep} title={L.gridStep}>
            {GRID_SIZES.map((n) => <option key={n} value={n}>{n}px</option>)}
          </select>
        </span>
      </div>

      {/* ── The selection: drawn with it, gone without it. */}
      {selCount > 0 && (
        <div className="cst-tools cst-tools-in" data-tools="selection" role="group" aria-label={t('cst.tools.sel', 'Selection')}>
          <Cmd label={L.dup} icon={Copy} onClick={duplicate} text={t('cst.dup', 'Duplicate')} />
          <Cmd label={L.del} icon={Trash2} onClick={remove} danger />
          {onSaveComponent && <Cmd label={L.comp} icon={Puzzle} onClick={onSaveComponent} text={t('cst.cmp.saveas', 'Save as component')} />}
          {/* Containers (phase 7a): only when they can run. */}
          {onGroup && <Cmd label={L.group} icon={Group} onClick={onGroup} text={t('cst.group', 'Group')} data={{ 'data-cst-group': '' }} />}
          {onUngroup && <Cmd label={L.ungroup} icon={Ungroup} onClick={onUngroup} text={t('cst.ungroup', 'Ungroup')} data={{ 'data-cst-ungroup': '' }} />}
          {/* The paint order and the two flags, for the WHOLE selection. */}
          {doZ && <Cmd label={L.front} icon={BringToFront} onClick={() => doZ('front')} />}
          {doZ && <Cmd label={L.back} icon={SendToBack} onClick={() => doZ('back')} />}
          {toggleFlag && <Cmd label={L.lock} icon={anyLocked ? Lock : LockOpen} on={anyLocked} onClick={() => toggleFlag('locked')} />}
          {toggleFlag && <Cmd label={L.hide} icon={anyHidden ? EyeOff : Eye} on={anyHidden} onClick={() => toggleFlag('hidden')} />}
        </div>
      )}

      {/* ── Several blocks: the group operations, only then. */}
      {selCount > 1 && (
        <div className="cst-tools cst-tools-in" data-tools="multi" role="group" aria-label={t('cst.tools.multi', 'Several blocks')}>
          <span className="text-[11px] text-[var(--faint)] tabular-nums px-1">{t('cst.nsel', '{n} selected').replace('{n}', selCount)}</span>
          {aligns.map(([how, I, label]) => <Cmd key={how} label={label} icon={I} onClick={() => doAlign(how)} />)}
          {/* Aligning four cards on their left edge still looks wrong while they are four
              different widths. The first block picked is the model. */}
          {matchSize && <Cmd label={L.sameW} icon={StretchHorizontal} onClick={() => matchSize('w')} />}
          {matchSize && <Cmd label={L.sameH} icon={StretchVertical} onClick={() => matchSize('h')} />}
          {selCount > 2 && <Cmd label={L.distX} icon={AlignHorizontalSpaceAround} onClick={() => doDistribute('x')} />}
          {selCount > 2 && <Cmd label={L.distY} icon={AlignVerticalSpaceAround} onClick={() => doDistribute('y')} />}
          {/* Stagger. A select rather than a button because the useful part IS the number. */}
          {stagger && (
            <span className="cst-grid-pair" title={t('cst.anim.stagger.h', 'Give the selection the same entrance, each one starting a little after the one before, in reading order.')}>
              <Sparkles size={13} className="text-[var(--muted)]" aria-hidden />
              <select className="cst-select" value="" aria-label={L.stagger}
                onChange={(e) => { const v = e.target.value; e.target.value = ''; if (v !== '') stagger(Number(v)); }}>
                <option value="">{L.stagger}</option>
                {STAGGER_STEPS.map((n) => <option key={n} value={n}>{`${n} ms`}</option>)}
                <option value="0">{t('cst.anim.stagger.off', 'All at once')}</option>
              </select>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

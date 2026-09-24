// Where the studio's panels live, and how the author moves them.
//
// The studio used to have exactly one arrangement: a palette on the left, an inspector on the
// right, both always there and neither movable. That is fine until you are building a page
// whose blocks are 320px wide on a 1280px screen — then the inspector you need open costs a
// quarter of the board, and the palette you opened once in the session costs another quarter.
//
// So the panels became furniture: every one of them can sit in the LEFT, RIGHT or BOTTOM
// zone, can be collapsed to its title bar, can be closed entirely and reopened from a menu,
// and the zones can be dragged wider or narrower. That arrangement is the author's, not the
// page's, so it is kept per browser in localStorage rather than in the canvas — two people
// editing the same page want their own desk, not each other's.
//
// What this file is NOT: a full docking system. There are no floating windows, no tab groups
// inside a zone, no split editors, no per-document layouts. A panel belongs to exactly one
// zone and zones stack their panels vertically. That is the shape that can be built to work
// every time, and a dock that always does what it looks like it will do beats a richer one
// that drops a panel into nowhere once a session.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, GripVertical, PanelLeft, PanelRight, PanelBottom, X, RotateCcw } from 'lucide-react';

/** The three places a panel can be. Order matters: it is the order the menus list them in. */
export const DOCK_ZONES = ['left', 'right', 'bottom'];

/** Below this a zone is not a zone any more, it is a sliver. Above it, the board is a strip. */
const ZONE_MIN = { left: 200, right: 220, bottom: 120 };
const ZONE_MAX = { left: 520, right: 560, bottom: 520 };

const STORE_KEY = 'bcw_studio_dock_v2';

/**
 * The arrangement a studio opens in when the author has never moved anything.
 *
 * Deliberately the arrangement the studio already had — palette left, inspector right — so
 * nothing about this change is visible until someone goes looking for it. A dock that greets
 * you with a layout you did not ask for is a dock you spend your first minute undoing.
 */
export function defaultDockLayout() {
  return {
    zones: {
      left: { panels: ['blocks', 'layers', 'components'], size: 280, collapsed: false },
      // `page` (background, stylesheet) under the inspector: both describe what is selected, the
      // block or, with nothing selected, the page. A layout saved before it existed gets it here.
      right: { panels: ['props', 'page'], size: 320, collapsed: false },
      bottom: { panels: [], size: 200, collapsed: false },
    },
    // A panel closed from its × is remembered as closed; it comes back from the Panels menu.
    closed: [],
    // Collapsed to its title bar, in place. Per panel, not per zone.
    folded: [],
    // The BOARD is furniture too. It was the one region with no size of its own: the panels
    // could all be dragged wider and the thing being edited took whatever was left. 0 on an
    // axis means "fill the pane", which is what it always did, so a layout saved before this
    // existed opens exactly as it did.
    board: { w: 0, h: 0 },
  };
}

const clampSize = (zone, n) => Math.round(Math.min(ZONE_MAX[zone], Math.max(ZONE_MIN[zone], Number(n) || 0)));

/** The board's own size on one axis. 0 is "fill the pane"; anything smaller than the floor
 *  would be a board you cannot see, and anything past the ceiling is a scroll with no end. */
export const BOARD_MIN = 240;
export const BOARD_MAX = 4000;
const clampBoard = (n) => {
  const v = Math.round(Number(n) || 0);
  if (v <= 0) return 0;
  return Math.min(BOARD_MAX, Math.max(BOARD_MIN, v));
};

/** Set the board's width or height. `0` gives the axis back to the pane. */
export const setBoardSize = (layout, axis, n) => ({
  ...layout, board: { ...(layout.board || { w: 0, h: 0 }), [axis]: clampBoard(n) },
});

/**
 * Make sense of whatever was in storage.
 *
 * Storage is the one input here that a future version of this file cannot control: a layout
 * written by an older build names panels that no longer exist, and one hand-edited in devtools
 * names zones that never did. Rather than trusting it, every id is checked against the panels
 * the caller actually registered — an unknown one is dropped, and a known one that storage
 * forgot to place is appended to its default zone so it is reachable instead of invisible.
 */
export function normalizeDockLayout(raw, ids) {
  const base = defaultDockLayout();
  const known = new Set(ids);
  const out = { zones: {}, closed: [], folded: [] };
  const placed = new Set();
  for (const z of DOCK_ZONES) {
    const from = raw?.zones?.[z] || {};
    const panels = (Array.isArray(from.panels) ? from.panels : base.zones[z].panels)
      .filter((id) => known.has(id) && !placed.has(id));
    for (const id of panels) placed.add(id);
    out.zones[z] = { panels, size: clampSize(z, from.size ?? base.zones[z].size), collapsed: !!from.collapsed };
  }
  out.board = { w: clampBoard(raw?.board?.w), h: clampBoard(raw?.board?.h) };
  out.closed = (Array.isArray(raw?.closed) ? raw.closed : []).filter((id) => known.has(id));
  for (const id of out.closed) placed.add(id);
  out.folded = (Array.isArray(raw?.folded) ? raw.folded : []).filter((id) => known.has(id));
  // Anything the stored layout never mentioned: put it back where it belongs rather than
  // leaving a registered panel with no way to reach it.
  for (const id of ids) {
    if (placed.has(id)) continue;
    const home = DOCK_ZONES.find((z) => base.zones[z].panels.includes(id)) || 'left';
    out.zones[home].panels.push(id);
  }
  return out;
}

/** The author's arrangement, read once. Storage can be absent (SSR), blocked or corrupt. */
export function readDockLayout(ids) {
  try {
    const raw = typeof window !== 'undefined' && window.localStorage
      ? JSON.parse(window.localStorage.getItem(STORE_KEY) || 'null') : null;
    return normalizeDockLayout(raw, ids);
  } catch { return normalizeDockLayout(null, ids); }
}

export function writeDockLayout(layout) {
  try { window.localStorage?.setItem(STORE_KEY, JSON.stringify(layout)); }
  catch { /* private mode, quota, no storage: the layout is simply not remembered */ }
}

/** Which zone holds a panel, or null when it is closed. */
export const zoneOf = (layout, id) => DOCK_ZONES.find((z) => layout.zones[z].panels.includes(id)) || null;

/**
 * Put a panel in a zone at a position.
 *
 * One function for all four gestures — move between zones, reorder inside one, reopen a closed
 * panel, and the drop that lands a panel back exactly where it came from — because they differ
 * only in where the id was before, and writing them separately is how a dock ends up with a
 * panel in two zones at once.
 */
export function movePanel(layout, id, zone, index = -1) {
  if (!DOCK_ZONES.includes(zone)) return layout;
  const zones = {};
  for (const z of DOCK_ZONES) zones[z] = { ...layout.zones[z], panels: layout.zones[z].panels.filter((p) => p !== id) };
  const list = zones[zone].panels;
  const at = index < 0 || index > list.length ? list.length : index;
  list.splice(at, 0, id);
  // Landing in a collapsed zone has to open it, or the panel the author just dropped is
  // invisible and the gesture looks like it did nothing.
  zones[zone].collapsed = false;
  return { ...layout, zones, closed: layout.closed.filter((p) => p !== id) };
}

export function closePanel(layout, id) {
  const zones = {};
  for (const z of DOCK_ZONES) zones[z] = { ...layout.zones[z], panels: layout.zones[z].panels.filter((p) => p !== id) };
  return { ...layout, zones, closed: [...new Set([...layout.closed, id])] };
}

export const togglePanelFolded = (layout, id) => ({
  ...layout,
  folded: layout.folded.includes(id) ? layout.folded.filter((p) => p !== id) : [...layout.folded, id],
});

export const setZoneSize = (layout, zone, size) => ({
  ...layout, zones: { ...layout.zones, [zone]: { ...layout.zones[zone], size: clampSize(zone, size) } },
});

export const toggleZone = (layout, zone) => ({
  ...layout, zones: { ...layout.zones, [zone]: { ...layout.zones[zone], collapsed: !layout.zones[zone].collapsed } },
});

/**
 * The layout, with the operations bound and every change written through to storage.
 *
 * Read during the FIRST render rather than in an effect: a dock that mounts with the default
 * arrangement and swaps to the author's one frame later is a visible flinch on every open,
 * and it moves whatever was under the pointer.
 */
export function useDockLayout(ids) {
  const key = ids.join(',');
  const [layout, setLayout] = useState(() => readDockLayout(ids));
  // The registered panels can change between renders (a panel that only exists for some
  // documents); re-normalising against them keeps a newly registered one reachable.
  useEffect(() => { setLayout((l) => normalizeDockLayout(l, ids));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const apply = useCallback((next) => {
    setLayout((cur) => {
      const v = typeof next === 'function' ? next(cur) : next;
      writeDockLayout(v);
      return v;
    });
  }, []);
  const reset = useCallback(() => apply(normalizeDockLayout(null, ids)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [apply, key]);
  return { layout, apply, reset };
}

/**
 * A drag in flight, tracked at the dock level.
 *
 * Pointer events rather than HTML5 drag-and-drop: the board next to this already speaks
 * pointer, drag-and-drop has no touch story at all, and a dock that only rearranges with a
 * mouse would be exactly the mobile hole this work was meant to close.
 */
export function useDockDrag(apply) {
  const [drag, setDrag] = useState(null);     // { id, over: { zone, index } | null, x, y }
  const dragRef = useRef(null);
  dragRef.current = drag;

  const start = useCallback((e, id) => {
    e.preventDefault();
    setDrag({ id, over: null, x: e.clientX, y: e.clientY });
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }, []);

  const move = useCallback((e) => {
    if (!dragRef.current) return;
    // What is under the pointer, asked of the document rather than tracked with enter/leave
    // handlers: the pointer is CAPTURED by the handle for the whole drag, so no other element
    // receives an event at all and enter/leave would never fire.
    const el = typeof document !== 'undefined' ? document.elementFromPoint(e.clientX, e.clientY) : null;
    const slot = el?.closest?.('[data-dock-slot]');
    const over = slot
      ? { zone: slot.getAttribute('data-dock-zone'), index: Number(slot.getAttribute('data-dock-index')) }
      : null;
    setDrag((d) => (d ? { ...d, over, x: e.clientX, y: e.clientY } : d));
  }, []);

  const end = useCallback(() => {
    const d = dragRef.current;
    setDrag(null);
    if (d?.over?.zone) apply((l) => movePanel(l, d.id, d.over.zone, d.over.index));
  }, [apply]);

  return { drag, start, move, end };
}

/** A drop slot: the gap between two panels in a zone, and the gap after the last one. */
function DropSlot({ zone, index, active }) {
  return (
    <div data-dock-slot data-dock-zone={zone} data-dock-index={index}
      className={`cst-dock-slot ${active ? 'is-over' : ''}`} aria-hidden />
  );
}

/**
 * One panel: a title bar that is also the drag handle, and a body that folds away.
 *
 * The title bar carries every operation the panel has — fold, move to another zone, close —
 * because a panel whose controls live in a menu somewhere else is a panel nobody discovers
 * they can move.
 */
function DockPanel({ t, panel, zone, folded, onFold, onMove, onClose, dragging, onDragStart }) {
  const Icon = panel.icon;
  return (
    <section className={`cst-dock-panel ${folded ? 'is-folded' : ''} ${dragging ? 'is-dragging' : ''}`}>
      <header className="cst-dock-head">
        <button type="button" className="cst-dock-fold" onClick={onFold}
          aria-expanded={!folded}
          title={folded ? t('cst.dock.unfold', 'Unfold this panel') : t('cst.dock.fold', 'Fold this panel to its title')}
          aria-label={folded ? t('cst.dock.unfold', 'Unfold this panel') : t('cst.dock.fold', 'Fold this panel to its title')}>
          {folded ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
        </button>
        {Icon && <Icon size={12} className="shrink-0 text-[var(--faint)]" />}
        <span className="flex-1 min-w-0 truncate" title={panel.title}>{panel.title}</span>
        {DOCK_ZONES.filter((z) => z !== zone).map((z) => {
          const ZI = z === 'left' ? PanelLeft : z === 'right' ? PanelRight : PanelBottom;
          const label = z === 'left' ? t('cst.dock.to.left', 'Move to the left')
            : z === 'right' ? t('cst.dock.to.right', 'Move to the right')
              : t('cst.dock.to.bottom', 'Move to the bottom');
          return (
            <button key={z} type="button" className="cst-dock-btn" onClick={() => onMove(z)} title={label} aria-label={label}>
              <ZI size={12} />
            </button>
          );
        })}
        <button type="button" className="cst-dock-btn" onClick={onClose}
          title={t('cst.dock.close', 'Close this panel, it stays in the Panels menu')}
          aria-label={t('cst.dock.close', 'Close this panel, it stays in the Panels menu')}><X size={12} /></button>
        {/* Last, and a handle rather than the whole bar: a title bar that drags on any press
            makes the four buttons beside it feel broken, because a 3px wobble during the click
            starts a drag instead. */}
        <span className="cst-dock-grip" onPointerDown={onDragStart}
          title={t('cst.dock.drag', 'Drag this panel to another place')} aria-hidden><GripVertical size={12} /></span>
      </header>
      {!folded && <div className="cst-dock-body">{panel.render()}</div>}
    </section>
  );
}

/**
 * One zone and everything in it.
 *
 * An EMPTY zone still renders, as a thin strip that says what it is for, but only while
 * something is being dragged: a permanent empty column would be the third of the screen this
 * whole change exists to give back.
 */
export function DockZone({ t, zone, layout, panels, apply, drag, onDragStart, className = '' }) {
  const z = layout.zones[zone];
  const ids = z.panels;
  const dragActive = !!drag;
  if (!ids.length && !dragActive) return null;
  const label = zone === 'left' ? t('cst.dock.left', 'Left panels')
    : zone === 'right' ? t('cst.dock.right', 'Right panels') : t('cst.dock.bottom', 'Bottom panels');
  return (
    // The zone's own class comes FIRST: check-studio.mjs asserts on `class="cst-left` in the
    // rendered markup, and a class list is a string to a regex.
    // The zone is ITSELF a drop target, at index -1 (the end). The thin slots between panels
    // are its children, so a precise drop still wins — `closest()` finds the nearest one — but
    // a drop anywhere else in the zone lands the panel at the bottom instead of nowhere. Every
    // drop that missed a 4px seam used to be a gesture that silently did nothing.
    <aside className={`${className} cst-dock-zone`} data-zone={zone} aria-label={label}
      data-dock-slot data-dock-zone={zone} data-dock-index="-1"
      // Inline rather than a class: it exists only for the length of a drag, and it says the
      // same thing the seam highlight says — this is where the panel will land.
      style={drag?.over?.zone === zone && drag?.over?.index === -1
        ? { outline: '2px solid var(--primary)', outlineOffset: '-2px' } : undefined}>
      {z.collapsed ? (
        <button type="button" className="cst-dock-reopen" onClick={() => apply((l) => toggleZone(l, zone))}>
          {t('cst.dock.expand', 'Expand')}
        </button>
      ) : (<>
        <DropSlot zone={zone} index={0} active={drag?.over?.zone === zone && drag?.over?.index === 0} />
        {ids.map((id, i) => {
          const panel = panels[id];
          if (!panel) return null;
          return (
            <div key={id}>
              <DockPanel t={t} panel={panel} zone={zone} folded={layout.folded.includes(id)}
                dragging={drag?.id === id}
                onFold={() => apply((l) => togglePanelFolded(l, id))}
                onMove={(to) => apply((l) => movePanel(l, id, to))}
                onClose={() => apply((l) => closePanel(l, id))}
                onDragStart={(e) => onDragStart(e, id)} />
              <DropSlot zone={zone} index={i + 1} active={drag?.over?.zone === zone && drag?.over?.index === i + 1} />
            </div>
          );
        })}
        {!ids.length && (
          <div className="cst-dock-empty" style={{ flex: 1 }} data-dock-slot data-dock-zone={zone} data-dock-index="0">
            {t('cst.dock.drop', 'Drop a panel here')}
          </div>
        )}
      </>)}
    </aside>
  );
}

/**
 * The bar between two zones.
 *
 * Positioned against the body rather than living inside a zone: the zones scroll, and a
 * resizer that scrolls away with the panel it resizes is a resizer you cannot find.
 */
export function DockResizer({ t, zone, layout, apply, style }) {
  const from = useRef(null);
  const down = (e) => {
    e.preventDefault();
    from.current = { at: zone === 'bottom' ? e.clientY : e.clientX, size: layout.zones[zone].size };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const move = (e) => {
    const f = from.current; if (!f) return;
    // Right and bottom grow the other way: dragging left widens the right-hand zone.
    const d = zone === 'left' ? e.clientX - f.at : zone === 'right' ? f.at - e.clientX : f.at - e.clientY;
    apply((l) => setZoneSize(l, zone, f.size + d));
  };
  const up = () => { from.current = null; };
  const label = t('cst.dock.resize', 'Resize this panel area');
  // Keyboard too: a pointer-only resizer is one more control a keyboard cannot reach, and the
  // arithmetic for a step is the same arithmetic as a drag.
  const key = (e) => {
    const by = zone === 'bottom' ? { ArrowUp: 24, ArrowDown: -24 } : { ArrowLeft: zone === 'left' ? -24 : 24, ArrowRight: zone === 'left' ? 24 : -24 };
    if (by[e.key] == null) return;
    e.preventDefault();
    apply((l) => setZoneSize(l, zone, l.zones[zone].size + by[e.key]));
  };
  return (
    <div className={`cst-dock-resizer cst-dock-resizer-${zone}`} style={style} role="separator"
      tabIndex={0} aria-label={label} title={label}
      aria-orientation={zone === 'bottom' ? 'horizontal' : 'vertical'}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onKeyDown={key} />
  );
}

/**
 * The board's own edge: the handle that makes the thing being edited a region like the rest.
 *
 * It starts from the MEASURED size rather than the stored one, so the first drag away from
 * "fill the pane" continues from where the board actually is instead of jumping to a floor.
 * Double-click, or Home, gives the axis back to the pane — a board the author has shrunk and
 * cannot grow again is the trap a fixed size would replace one bug with.
 */
export function BoardEdge({ t, axis, measured, apply, className = '' }) {
  const from = useRef(null);
  // NOT `cst.board.h`: that key is already the board's own hint line. A key reused for a
  // second string is a string that changes meaning the day somebody translates one of them.
  const label = axis === 'w'
    ? t('cst.board.size.w', 'Drag to set the board width, double-click to fill the pane')
    : t('cst.board.size.h', 'Drag to set the board height, double-click to fill the pane');
  /**
   * The board's size RIGHT NOW, read off the element rather than off a prop.
   *
   * The prop is measured by a ResizeObserver, which lands a frame late — and a drag that
   * starts from a stale number does not resize, it jumps. Caught in the browser: resizing the
   * width and then immediately the height began the second gesture from the height the board
   * had before the first, and a 120px drag upwards made the board 300px taller.
   */
  const live = (el, fallback) => {
    const host = el?.parentElement?.querySelector('.cst-board');
    if (!host) return fallback;
    return axis === 'w' ? host.offsetWidth : host.offsetHeight;
  };
  const down = (e) => {
    e.preventDefault();
    from.current = { at: axis === 'w' ? e.clientX : e.clientY, size: live(e.currentTarget, measured) };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const move = (e) => {
    const f = from.current; if (!f) return;
    const d = (axis === 'w' ? e.clientX : e.clientY) - f.at;
    apply((l) => setBoardSize(l, axis, f.size + d));
  };
  const up = () => { from.current = null; };
  const key = (e) => {
    const by = axis === 'w' ? { ArrowLeft: -24, ArrowRight: 24 } : { ArrowUp: -24, ArrowDown: 24 };
    if (e.key === 'Home') { e.preventDefault(); apply((l) => setBoardSize(l, axis, 0)); return; }
    if (by[e.key] == null) return;
    e.preventDefault();
    const now = live(e.currentTarget, measured);
    apply((l) => setBoardSize(l, axis, now + by[e.key]));
  };
  return (
    <div className={`cst-board-edge cst-board-edge-${axis} ${className}`} role="separator" tabIndex={0}
      aria-orientation={axis === 'w' ? 'vertical' : 'horizontal'} aria-label={label} title={label}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
      onDoubleClick={() => apply((l) => setBoardSize(l, axis, 0))} onKeyDown={key} />
  );
}

/** What the author is dragging, following the pointer, so the gesture has something to watch. */
export function DockGhost({ drag, panels }) {
  if (!drag) return null;
  const panel = panels[drag.id];
  if (!panel) return null;
  return (
    <div className="cst-dock-ghost" style={{ left: drag.x + 12, top: drag.y + 12 }} aria-hidden>{panel.title}</div>
  );
}

/**
 * The Panels menu: everything that exists, where it is, and the way back from a closed one.
 *
 * Also the only place a zone can be collapsed wholesale and the arrangement put back to
 * what it was — two operations that have no natural home on a panel, because they are about
 * every panel at once.
 */
export function PanelsMenu({ t, layout, panels, apply, reset, onClose }) {
  const ids = useMemo(() => Object.keys(panels), [panels]);
  return (
    <div className="cst-menu" role="menu">
      <div className="cst-menu-h">{t('cst.dock.panels', 'Panels')}</div>
      {ids.map((id) => {
        const here = zoneOf(layout, id);
        const panel = panels[id];
        const Icon = panel.icon;
        return (
          <div key={id} className="cst-menu-row">
            <label className="flex items-center gap-1.5 flex-1 min-w-0 cursor-pointer">
              <input type="checkbox" checked={!!here}
                onChange={() => apply((l) => (zoneOf(l, id) ? closePanel(l, id) : movePanel(l, id, 'left')))} />
              {Icon && <Icon size={12} className="shrink-0 text-[var(--faint)]" />}
              <span className="truncate" title={panel.title}>{panel.title}</span>
            </label>
            <span className="inline-flex gap-0.5">
              {DOCK_ZONES.map((z) => {
                const ZI = z === 'left' ? PanelLeft : z === 'right' ? PanelRight : PanelBottom;
                const label = z === 'left' ? t('cst.dock.to.left', 'Move to the left')
                  : z === 'right' ? t('cst.dock.to.right', 'Move to the right')
                    : t('cst.dock.to.bottom', 'Move to the bottom');
                return (
                  <button key={z} type="button" className={`cst-dock-btn ${here === z ? 'is-on' : ''}`}
                    onClick={() => apply((l) => movePanel(l, id, z))} title={label} aria-label={label}><ZI size={12} /></button>
                );
              })}
            </span>
          </div>
        );
      })}
      <div className="cst-menu-sep" />
      {DOCK_ZONES.map((z) => {
        const label = z === 'left' ? t('cst.dock.left', 'Left panels')
          : z === 'right' ? t('cst.dock.right', 'Right panels') : t('cst.dock.bottom', 'Bottom panels');
        if (!layout.zones[z].panels.length) return null;
        return (
          <button key={z} type="button" className="cst-menu-item" onClick={() => apply((l) => toggleZone(l, z))}>
            {layout.zones[z].collapsed ? t('cst.dock.show', 'Show {area}').replace('{area}', label) : t('cst.dock.hide', 'Hide {area}').replace('{area}', label)}
          </button>
        );
      })}
      {!!(layout.board?.w || layout.board?.h) && (
        <button type="button" className="cst-menu-item" onClick={() => apply((l) => ({ ...l, board: { w: 0, h: 0 } }))}>
          {t('cst.board.fill', 'Let the board fill the middle again')}
        </button>
      )}
      <div className="cst-menu-sep" />
      <button type="button" className="cst-menu-item" onClick={() => { reset(); onClose?.(); }}>
        <RotateCcw size={12} /> {t('cst.dock.reset', 'Put the panels back where they started')}
      </button>
      <p className="cst-menu-note">{t('cst.dock.note', 'This arrangement is kept in this browser only, not on the page.')}</p>
    </div>
  );
}

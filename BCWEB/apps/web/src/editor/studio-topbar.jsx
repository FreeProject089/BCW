// The studio's top bar: the document, its save state, undo and redo, the board, the previews.
// Moved out of editor/canvas-studio.jsx (studio phase 8).
import { useState } from 'react';
import {
  Smartphone, Monitor, Tablet, FileText, Keyboard, ArrowLeft, Undo2, Redo2, PanelsTopLeft, MoreHorizontal,
  GraduationCap, X, Save,
} from 'lucide-react';
import { Button } from '../ui/ui.jsx';
import { TourButton } from './studio-tour.jsx';
import { PanelsMenu } from './studio-dock.jsx';

/**
 * Page mode's top bar: the document, its save state, undo/redo, the board, the previews.
 *
 * This bar used to be a single wrapping flex row whose left-hand group was `flex-1 min-w-0`
 * — flex-basis 0 — and that combination is the bug the studio was reported for. A flex-basis
 * of 0 contributes NOTHING to where a wrapping container breaks its lines, so the browser
 * packed every button onto the first line and then handed the document group whatever was
 * left. Measured at a 700px pane the document's name was 5px wide out of the 306px it needed;
 * at 480–560px it was 0px, and the "Unsaved changes" label — `whitespace-nowrap` in a box that
 * had been squeezed to 39px — spilled out of that box and ran underneath the undo and redo
 * icons. Below ~570px the controls finally did wrap and the bar grew from 42px to 108px,
 * taking that much off the board on the smallest screen in the house.
 *
 * So: the bar no longer wraps. The document group has a real basis and clips its own overflow
 * (with the full title one hover away, because a clipped value must stay readable), and below
 * the three-pane width the secondary clusters move into one menu instead of onto a second
 * line. One row at every width, and nothing falls off the screen.
 */
export function PageTopBar({ t, chrome, hist, doUndo, doRedo, preview, setPreview, themeSwitch, hasPage,
  wide = true, onKeys, onTour, panelsMenu, setPanelsMenu, dock, panels, applyDock, resetDock,
  board = 'light', title = '', onTitle, offerPage = true }) {
  const [more, setMore] = useState(false);
  const state = chrome?.state || 'saved';
  const stateLabel = {
    saved: t('cst.save.saved', 'Saved'),
    dirty: t('cst.save.dirty', 'Unsaved changes'),
    saving: t('cst.save.saving', 'Saving…'),
    error: t('cst.save.error', 'Save failed'),
  }[state] || '';
  const tog = (v) => setPreview((cur) => (cur === v ? '' : v));
  /**
   * The preview group, with ONE phone in the bar.
   *
   * Measured before this change: `lucide-smartphone` appeared twice in `.cst-topbar`, three
   * buttons apart — once in the board switch ("author the 390px phone board") and once here
   * ("preview what a phone gets"). Two controls owning the same idea and the same glyph is
   * the duplication, so it is removed where it starts rather than hidden: the preview now
   * previews the board being AUTHORED. On the phone board the first entry IS the phone, and
   * on the light or dark board it is the desktop. The phone preview is therefore one click
   * from the phone board, which is where somebody thinking about phones already is.
   */
  const phoneTarget = board === 'phone';
  const previewGroup = (
    <div className="inline-flex rounded-lg border border-[var(--line)] overflow-hidden" data-tour="preview" role="group" aria-label={t('cst.preview', 'Preview')}>
      {[phoneTarget
        ? ['phone', Smartphone, t('cst.phone.h', 'What a phone gets: the canvas stacks')]
        : ['desktop', Monitor, t('cst.preview.desktop', 'Desktop preview')],
      ['tablet', Tablet, t('cst.preview.tablet', 'Tablet preview')],
      /* The page button is here for every PAGE. It used to be dropped when the document
         belonged to no page, which left the author with a preview group that quietly had one
         fewer control than it does elsewhere and no way to find out why. Disabled, with the
         reason on it, is the version that can be read.
         A component (phase 8, `offerPage` false) is not a page that is missing one: it is
         never shown on its own, so there is no page preview to offer, disabled or not. */
      ...(offerPage ? [['page', FileText,
        hasPage
          ? t('cst.preview.page', 'The whole project page, with this block in place')
          : t('cst.preview.page.none', 'This document is not part of a page yet, so there is no page to show it in.'),
        !hasPage]] : [])].map(([k, Icon, label, off]) => (
        <button key={k} type="button" onClick={() => tog(k)} title={label} aria-label={label} aria-pressed={preview === k}
          disabled={!!off} aria-disabled={off ? 'true' : undefined}
          className={`inline-flex items-center px-2 py-1 text-xs ${off ? 'text-[var(--faint)] cursor-not-allowed' : preview === k ? 'tint-primary text-[var(--text)]' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}>
          <Icon size={13} />
        </button>
      ))}
    </div>
  );
  const keysButton = (
    <Button size="sm" variant="ghost" className="!px-2" onClick={onKeys} title={t('cst.keys.h2', 'Keyboard shortcuts (?)')} aria-label={t('cst.keys', 'Keyboard shortcuts')}><Keyboard size={14} /></Button>
  );
  // The way back into the tour. It runs itself once and is then never seen again, so without
  // this the author who dismissed it on the first afternoon has no way to ask for it.
  const tourButton = onTour ? <TourButton t={t} onClick={onTour} /> : null;
  return (
    <header className="cst-topbar">
      {/* The document. A real basis, so it takes part in the layout instead of being handed
          whatever is left, and `overflow:hidden` on the group so the save-state label cannot
          run out of it and over the buttons after it. */}
      <div className="cst-topbar-id">
        <Button size="sm" variant="ghost" className="!px-2" onClick={chrome?.onBack} title={t('cst.back.h', 'Back to the page settings')} aria-label={t('common.back', 'Back')}><ArrowLeft size={15} /></Button>
        {/* The page's name, edited where it is shown. It was read-only here and editable only
            back in the config editor, which meant leaving the studio to rename the thing you
            are looking at. It looks like the label it replaces until it is focused. */}
        {onTitle ? (
          <input className="cst-title" value={title}
            onChange={(e) => onTitle(e.target.value.slice(0, 120))}
            placeholder={t('pce.canvases.untitled', 'Untitled page')}
            aria-label={t('cst.title', 'Name of this page')}
            title={title || t('cst.title', 'Name of this page')} />
        ) : (
          <span className="font-medium text-sm truncate" title={chrome?.title || t('pce.canvases.untitled', 'Untitled page')}>{chrome?.title || t('pce.canvases.untitled', 'Untitled page')}</span>
        )}
        <span className={`text-[11px] whitespace-nowrap ${state === 'error' ? 'text-error' : state === 'dirty' ? 'text-warning' : 'text-[var(--faint)]'}`} data-save-state={state}>{stateLabel}</span>
        {chrome?.draftRestored && (
          <button type="button" className="text-[11px] text-[var(--accent-ink)] hover:underline whitespace-nowrap" onClick={chrome.onDiscardDraft} title={t('cst.draft.h', 'A draft from this tab was restored. Discard it to go back to what is saved.')}>{t('cst.draft.discard', 'Discard draft')}</button>
        )}
      </div>
      <div className="cst-topbar-tools">
        <Button size="sm" variant="ghost" className="!px-2" disabled={!hist.past.length} onClick={doUndo} data-undo-steps={hist.past.length} title={`Ctrl+Z · ${hist.past.length}`} aria-label={t('cst.undo', 'Undo')}><Undo2 size={14} /></Button>
        <Button size="sm" variant="ghost" className="!px-2" disabled={!hist.future.length} onClick={doRedo} title="Ctrl+Shift+Z" aria-label={t('cst.redo', 'Redo')}><Redo2 size={14} /></Button>
        {wide ? (<>
          <span className="cst-topbar-sep" />
          {!preview && themeSwitch}
          <span className="cst-topbar-sep" />
          {previewGroup}
          {keysButton}
          {tourButton}
          <span className="cst-topbar-pop">
            <Button size="sm" variant={panelsMenu ? 'primary' : 'ghost'} className="!px-2" onClick={() => setPanelsMenu((v) => !v)}
              title={t('cst.dock.panels.h', 'Which panels are open, and where they sit')} aria-label={t('cst.dock.panels', 'Panels')} aria-expanded={!!panelsMenu}><PanelsTopLeft size={14} /></Button>
            {panelsMenu && (
              <PanelsMenu t={t} layout={dock} panels={panels} apply={applyDock} reset={resetDock} onClose={() => setPanelsMenu(false)} />
            )}
          </span>
        </>) : (
          /* Below the three-pane width the secondary clusters go into ONE opaque menu rather
             than onto a second line: a bar that grows to 108px takes an eighth of a phone
             away from the thing being edited. */
          <span className="cst-topbar-pop">
            <Button size="sm" variant={more ? 'primary' : 'ghost'} className="!px-2" onClick={() => setMore((v) => !v)}
              title={t('cst.more', 'More')} aria-label={t('cst.more', 'More')} aria-expanded={more}><MoreHorizontal size={14} /></Button>
            {more && (
              <div className="cst-menu" role="menu">
                <div className="cst-menu-h">{t('cst.theme.board', 'Board')}</div>
                <div className="px-2 pb-1.5">{themeSwitch}</div>
                <div className="cst-menu-sep" />
                <div className="cst-menu-h">{t('cst.preview', 'Preview')}</div>
                <div className="px-2 pb-1.5">{previewGroup}</div>
                <div className="cst-menu-sep" />
                <button type="button" className="cst-menu-item" onClick={() => { setMore(false); onKeys?.(); }}>
                  <Keyboard size={12} /> {t('cst.keys', 'Keyboard shortcuts')}
                </button>
                {onTour && (
                  <button type="button" className="cst-menu-item" onClick={() => { setMore(false); onTour(); }}>
                    <GraduationCap size={12} /> {t('cst.tour.again', 'Take the tour of the studio')}
                  </button>
                )}
              </div>
            )}
          </span>
        )}
        {preview && <Button size="sm" variant="ghost" className="!px-2" onClick={() => setPreview('')} title={t('cst.preview.close', 'Close preview')} aria-label={t('cst.preview.close', 'Close preview')}><X size={14} /></Button>}
        <Button size="sm" variant="primary" disabled={chrome?.canSave === false || state === 'saving'} onClick={chrome?.onSave} title="Ctrl+S"><Save size={14} /> <span className="cst-hide-narrow">{t('common.save', 'Save')}</span></Button>
      </div>
    </header>
  );
}

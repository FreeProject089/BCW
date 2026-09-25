// The studio's preview: what a reader gets, framed as the device they would read it on.
// Moved out of editor/canvas-studio.jsx (studio phase 8) unchanged.
import { useState } from 'react';
import { Monitor, RotateCcw } from 'lucide-react';
import { Button } from '../ui/ui.jsx';
import { PAGE_DEVICES } from '../lib/studio-preview.js';
import CanvasView from '../ui/canvas-view.jsx';

/**
 * What a reader gets, framed as the device they would read it on. The SAME CanvasView the
 * public page renders — a preview drawn by anything else would be a second opinion.
 * `renderPage` (page mode) shows the whole project page with this canvas in its tab.
 */
const DEVICE_WIDTHS = { desktop: 1280, tablet: 820, phone: 390 };

export function PreviewSurface({ t, preview, canvas, renderPage, onReplay, pageNote = null }) {
  /**
   * Every mode is a device at a real width, including `desktop`.
   *
   * It used to be the odd one out: phone got 390 and tablet 820, and `desktop` got no frame
   * at all — so what it showed was the pane it happened to be in. In the config editor's
   * modal that pane is a settings column, which made "desktop preview" a 1200px page drawn
   * inside about 600px of it. A named width, shown next to the name, is the only way the
   * author can tell what they are being shown.
   */
  const frame = DEVICE_WIDTHS[preview] || null;
  const onPage = preview === 'page';
  // The page preview is the REAL route in a frame (editor/studio-page-frame.jsx), at the width
  // of a device, so its own header, footer, backdrop and media queries are the ones a visitor
  // on that device gets. The width is the frame's, not this pane's: wider than the pane, the
  // preview scrolls sideways rather than lying about the width.
  const [pageDevice, setPageDevice] = useState('desktop');
  const label = onPage
    ? t('cst.preview.page', 'The whole project page, with this block in place')
    : { desktop: t('cst.preview.desktop', 'Desktop preview'), tablet: t('cst.preview.tablet', 'Tablet preview'), phone: t('cst.phone.h', 'What a phone gets: the canvas stacks') }[preview] || '';
  return (
    <div className="cst-preview" data-preview-mode={preview}>
      <div className="flex items-center gap-2 flex-wrap mb-3 text-[11px] text-[var(--faint)]">
        <span className="inline-flex items-center gap-1"><Monitor size={12} /> {t('cst.previewing', 'Preview, editing is paused')}</span>
        <span className="inline-flex items-center gap-1 text-[var(--muted)]">
          {label}{frame ? ` · ${frame}px` : ''}
        </span>
        <span className="flex-1" />
        <Button size="sm" variant="ghost" onClick={onReplay} title={t('cst.replay.anim.h', 'Mount the page again so every entrance animation plays from the start')}><RotateCcw size={13} /> {t('cst.replay.anim', 'Replay animations')}</Button>
      </div>
      {/* Nothing is silently missing: when this document belongs to no page, the reason is
          said here rather than leaving the author to notice a button that is not there. */}
      {onPage && !renderPage && (
        <p className="mb-3 text-xs text-[var(--muted)] rounded-xl border border-dashed border-[var(--line)] p-3">{pageNote}</p>
      )}
      {onPage && renderPage ? (
        <>
          <div className="flex items-center gap-1 flex-wrap mb-2" role="group" aria-label={t('cst.preview.devices', 'Device width')}>
            {Object.entries(PAGE_DEVICES).map(([k, w]) => (
              <Button key={k} size="sm" variant={pageDevice === k ? 'primary' : 'ghost'} aria-pressed={pageDevice === k} onClick={() => setPageDevice(k)}>
                {t(`cst.preview.dev.${k}`, k)} · {w}px
              </Button>
            ))}
          </div>
          <div className="overflow-x-auto">
            <div className="mx-auto" style={{ width: PAGE_DEVICES[pageDevice] }} data-page-device={pageDevice}>
              {renderPage(canvas, PAGE_DEVICES[pageDevice])}
            </div>
          </div>
        </>
      ) : (
        <div className={frame ? 'cst-device mx-auto max-w-full' : ''} style={frame ? { width: frame } : undefined}>
          <CanvasView canvas={canvas} stackPreview={preview === 'phone'} actionsPreview />
        </div>
      )}
    </div>
  );
}

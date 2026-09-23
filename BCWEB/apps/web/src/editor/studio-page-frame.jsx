// The studio's half of the page preview: the REAL route in a frame, fed the draft.
//
// See lib/studio-preview.js for why it is a frame and not the page component mounted here:
// the header, the footer, the 3D backdrop and the media queries are only right in a document
// of their own, at the device's width. The draft goes over postMessage, to this origin only,
// and only once the framed page has said it is listening (it may still be loading the app).
import { useEffect, useRef, useState } from 'react';
import { draftMessage, isReady } from '../lib/studio-preview.js';

export default function StudioPageFrame({ src, kind, payload, title, reasons = [], t }) {
  const ref = useRef(null);
  // A counter, not a flag: the framed page says "ready" again after any navigation inside it,
  // and each time it needs the draft again.
  const [ready, setReady] = useState(0);
  const json = JSON.stringify(payload ?? null);
  useEffect(() => {
    const onMsg = (e) => { if (isReady(e, { origin: window.location.origin, frame: ref.current?.contentWindow })) setReady((n) => n + 1); };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);
  useEffect(() => {
    if (!ready) return;
    ref.current?.contentWindow?.postMessage(draftMessage(kind, JSON.parse(json)), window.location.origin);
  }, [ready, json, kind]);
  return (
    <>
      {reasons.length > 0 && (
        <p className="mb-2 text-xs text-warning rounded-xl border border-dashed border-[var(--line)] p-2" role="status" data-preview-reasons={reasons.join(' ')}>
          {t('cst.preview.notlive', 'Not visible to visitors yet:')} {reasons.map((r) => t(`cst.preview.why.${r}`, r)).join(', ')}
        </p>
      )}
      <iframe ref={ref} src={src} title={title} data-studio-frame=""
        style={{ width: '100%', height: 'min(85vh, 1100px)', border: '1px solid var(--line)', borderRadius: 12, background: 'var(--bg-solid)', display: 'block' }} />
    </>
  );
}

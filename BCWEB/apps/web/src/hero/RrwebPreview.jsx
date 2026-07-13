import { useEffect, useRef, useState } from 'react';

// Plays a real BMM rrweb session as a transparent, auto-looping preview.
// Uses rrweb's raw Replayer (matches BMM's rrweb v2) + manual scaling so it
// reliably fits the window. rrweb + the 26 MB replay are lazy-loaded.
export default function RrwebPreview({ url, onFail }) {
  const wrap = useRef(null);   // visible, sized box
  const stage = useRef(null);  // where the Replayer mounts (gets scaled)
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    let replayer, cancelled = false, ro;
    (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error('fetch');
        const doc = await res.json();
        const events = doc.events || doc;
        if (!Array.isArray(events) || events.length < 2) throw new Error('empty');
        const [{ Replayer }] = await Promise.all([import('rrweb'), import('rrweb/dist/style.css')]);
        if (cancelled || !stage.current) return;
        const meta = events.find((e) => e.type === 4)?.data || { width: 1480, height: 960 };

        replayer = new Replayer(events, { root: stage.current, speed: 1, skipInactive: true, mouseTail: false, showWarning: false, showDebug: false, useVirtualDom: false });
        replayer.play(0);
        replayer.on('finish', () => { try { replayer.play(0); } catch {} });
        setStatus('playing');

        const fit = () => {
          const w = wrap.current?.clientWidth || 760;
          const scale = w / meta.width;
          const h = meta.height * scale;
          if (wrap.current) wrap.current.style.height = h + 'px';
          const inner = stage.current?.querySelector('.replayer-wrapper');
          if (inner) { inner.style.transform = `scale(${scale})`; inner.style.transformOrigin = 'top left'; }
        };
        fit();
        ro = new ResizeObserver(fit); if (wrap.current) ro.observe(wrap.current);
      } catch {
        if (!cancelled) { setStatus('error'); onFail?.(); }
      }
    })();
    return () => { cancelled = true; try { ro?.disconnect(); } catch {} try { replayer?.pause?.(); } catch {} };
  }, [url]);

  return (
    <div ref={wrap} className="bmm-replay" style={{ width: '100%', minHeight: 260, position: 'relative', overflow: 'hidden' }}>
      <div ref={stage} style={{ position: 'absolute', top: 0, left: 0 }} />
      {status === 'loading' && <div className="absolute inset-0 grid place-items-center text-sm text-[var(--muted)]">Loading live preview…</div>}
    </div>
  );
}

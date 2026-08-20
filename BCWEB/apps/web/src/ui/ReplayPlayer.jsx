import { useEffect, useRef, useState } from 'react';
import { Play, Pause, RotateCcw, Maximize2, PlayCircle } from 'lucide-react';
import { useI18n } from '../i18n.jsx';

// One rrweb player, for every place that shows a session.
//
// It was a private function inside md.jsx, reachable only through the `:::replay` directive.
// That was fine while a replay only ever appeared in a doc — and stopped being fine the moment
// a moderator needed to WATCH the .bmmreplay somebody attached to a report, because the only
// other option was writing a second player. Two players means the day one learns to read a
// format and the other does not, and a moderator concludes a file is broken when it is not.
//
// It accepts three shapes, deliberately:
//   `src`   a URL to fetch — what the docs use
//   `doc`   an already-parsed object — what an inspector has, having just read the file
//   either one being a `.bmmreplay` document `{ events, durationMs, regions… }` OR a bare
//   rrweb events array, because both exist in the wild and telling a reviewer "wrong kind of
//   replay" is not an answer they can act on.
//
// rrweb and the (large) recording are lazy-loaded only when the user hits Play, so a page full
// of replays costs nothing until watched. Playback advances via requestAnimationFrame, so a
// hidden/background tab throttles it — an rrweb limitation, not a bug.

const fmtTime = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

export default function ReplayPlayer({ src = '', doc = null, title = '', autoplay = false, loop = false }) {
  const { lang } = useI18n();
  const wrap = useRef(null);
  const stage = useRef(null);
  const replayerRef = useRef(null);
  const rafRef = useRef(0);
  const [started, setStarted] = useState(autoplay);
  const [status, setStatus] = useState('idle'); // idle | loading | ready | error
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [dur, setDur] = useState(0);
  const [cur, setCur] = useState(0);

  const tr = (fr, en) => (lang === 'fr' ? fr : en);

  useEffect(() => {
    if (!started || (!src && !doc)) return undefined;
    let cancelled = false, ro;
    setStatus('loading');
    (async () => {
      try {
        // An in-memory document skips the round trip entirely. The inspector has already read
        // the file off the reviewer's disk; fetching it back from a URL that does not exist is
        // how "the inspector cannot play what it just parsed" would have happened.
        const source = doc || await (async () => {
          const res = await fetch(src);
          if (!res.ok) throw new Error('fetch');
          return res.json();
        })();
        const events = Array.isArray(source) ? source : (source.events || []);
        if (!Array.isArray(events) || events.length < 2) throw new Error('empty');
        const [{ Replayer }] = await Promise.all([import('rrweb'), import('rrweb/dist/style.css')]);
        if (cancelled || !stage.current) return;
        const meta = events.find((e) => e.type === 4)?.data || { width: 1480, height: 960 };
        // A Replay-Studio recording can carry a `regions` timeline (the moving capture frame);
        // when present we crop the viewport to the active region and follow it.
        const regs = (Array.isArray(source.regions) ? source.regions : []).filter((r) => r && r.rect && r.rect.w).sort((a, b) => a.t - b.t);
        const hasRegions = regs.length > 0;
        const rectAt = (t) => { let r = { x: 0, y: 0, w: meta.width, h: meta.height }; for (const k of regs) { if (k.t <= t) r = k.rect; else break; } return r; };
        const replayer = new Replayer(events, { root: stage.current, speed: 1, skipInactive: true, mouseTail: false, showWarning: false, showDebug: false, useVirtualDom: false });
        replayerRef.current = replayer;
        const total = replayer.getMetaData?.().totalTime || source.durationMs || 0;
        setDur(total);
        const fit = (t) => {
          const w = wrap.current?.clientWidth || 760;
          const rect = hasRegions ? rectAt(t ?? (replayer.getCurrentTime?.() || 0)) : { x: 0, y: 0, w: meta.width, h: meta.height };
          const scale = Math.min(1, w / rect.w);
          const inner = stage.current?.querySelector('.replayer-wrapper');
          if (inner) { inner.style.transform = `translate(${-rect.x * scale}px,${-rect.y * scale}px) scale(${scale})`; inner.style.transformOrigin = 'top left'; if (hasRegions) inner.style.transition = 'transform .35s ease'; }
          if (stage.current) stage.current.style.height = `${rect.h * scale}px`;
        };
        fit();
        ro = new ResizeObserver(() => fit()); if (wrap.current) ro.observe(wrap.current);
        replayer.on('finish', () => {
          if (loop) { try { replayer.play(0); } catch { /* ignore */ } }
          else { setPlaying(false); cancelAnimationFrame(rafRef.current); }
        });
        let lastIdx = -2;
        const tick = () => {
          let t = 0; try { t = replayer.getCurrentTime?.() ?? 0; setCur(t); } catch { /* ignore */ }
          if (hasRegions) { let i = -1; for (let k = 0; k < regs.length; k++) { if (regs[k].t <= t) i = k; else break; } if (i !== lastIdx) { lastIdx = i; fit(t); } }
          rafRef.current = requestAnimationFrame(tick);
        };
        replayer.play(0); setPlaying(true); setStatus('ready'); rafRef.current = requestAnimationFrame(tick);
      } catch { if (!cancelled) setStatus('error'); }
    })();
    return () => { cancelled = true; cancelAnimationFrame(rafRef.current); try { ro?.disconnect(); } catch { /* ignore */ } try { replayerRef.current?.pause?.(); } catch { /* ignore */ } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started, src, doc]);

  const toggle = () => {
    const r = replayerRef.current; if (!r) return;
    if (playing) { r.pause(); setPlaying(false); cancelAnimationFrame(rafRef.current); }
    else { const at = cur >= dur - 50 ? 0 : cur; r.play(at); setPlaying(true); const tick = () => { try { setCur(r.getCurrentTime?.() ?? 0); } catch { /* ignore */ } rafRef.current = requestAnimationFrame(tick); }; rafRef.current = requestAnimationFrame(tick); }
  };
  const restart = () => { const r = replayerRef.current; if (!r) return; r.play(0); setPlaying(true); if (!rafRef.current) { const tick = () => { try { setCur(r.getCurrentTime?.() ?? 0); } catch { /* ignore */ } rafRef.current = requestAnimationFrame(tick); }; rafRef.current = requestAnimationFrame(tick); } };
  const seek = (e) => { const r = replayerRef.current; if (!r || !dur) return; const to = Number(e.target.value); setCur(to); if (playing) r.play(to); else r.pause(to); };
  const changeSpeed = () => { const next = speed === 1 ? 2 : speed === 2 ? 4 : 1; setSpeed(next); try { replayerRef.current?.setConfig?.({ speed: next }); } catch { /* ignore */ } };
  const fullscreen = () => { const el = wrap.current; if (!el) return; if (document.fullscreenElement) document.exitFullscreen?.(); else el.requestFullscreen?.(); };

  if (!src && !doc) {
    return <div className="doc-replay doc-replay-empty text-sm text-[var(--faint)] rounded-xl border border-dashed border-[var(--line)] p-4">{tr('Replay vide — fournis un « src » vers un fichier .bmmreplay.', 'Empty replay — provide a "src" to a .bmmreplay file.')}</div>;
  }

  return (
    <figure className="doc-replay not-prose my-4 rounded-2xl overflow-hidden border border-[var(--line)] bg-[var(--bg-solid)]" style={{ boxShadow: 'var(--shadow)' }}>
      {title && <figcaption className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b border-[var(--line)] bg-[var(--surface-2)]"><PlayCircle size={15} className="text-[var(--primary-2)]" /> {title}</figcaption>}
      <div ref={wrap} className="relative bg-black" style={{ minHeight: 200 }}>
        <div ref={stage} style={{ position: 'relative', width: '100%' }} />
        {!started && (
          <button type="button" onClick={() => setStarted(true)} className="absolute inset-0 grid place-items-center bg-black/50 hover:bg-black/40 transition group" aria-label={tr('Lire le replay', 'Play replay')}>
            <span className="flex flex-col items-center gap-2 text-white">
              <span className="w-16 h-16 rounded-full bg-[var(--primary)]/90 grid place-items-center group-hover:scale-105 transition-transform"><Play size={28} className="translate-x-0.5" fill="currentColor" /></span>
              <span className="text-xs opacity-90">{tr('Lire la session', 'Play session')}</span>
            </span>
          </button>
        )}
        {status === 'loading' && <div className="absolute inset-0 grid place-items-center text-sm text-white/80">{tr('Chargement du replay…', 'Loading replay…')}</div>}
        {status === 'error' && <div className="absolute inset-0 grid place-items-center text-sm text-error px-4 text-center">{tr('Impossible de charger ce replay.', 'Could not load this replay.')}</div>}
      </div>
      {status === 'ready' && (
        <div className="flex items-center gap-2 px-3 py-2 border-t border-[var(--line)] bg-[var(--surface-2)]">
          <button type="button" onClick={toggle} className="shrink-0 text-[var(--text)] hover:text-[var(--primary-2)]" aria-label={playing ? tr('Pause', 'Pause') : tr('Lire', 'Play')}>{playing ? <Pause size={17} /> : <Play size={17} />}</button>
          <button type="button" onClick={restart} className="shrink-0 text-[var(--muted)] hover:text-[var(--text)]" aria-label={tr('Recommencer', 'Restart')}><RotateCcw size={15} /></button>
          <span className="text-[11px] tabular-nums text-[var(--faint)] shrink-0 w-9 text-right">{fmtTime(cur)}</span>
          <input type="range" min={0} max={dur || 0} value={Math.min(cur, dur || 0)} onChange={seek} className="flex-1 accent-[var(--primary)] h-1 cursor-pointer" aria-label={tr('Position', 'Seek')} />
          <span className="text-[11px] tabular-nums text-[var(--faint)] shrink-0 w-9">{fmtTime(dur)}</span>
          <button type="button" onClick={changeSpeed} className="shrink-0 text-xs font-semibold text-[var(--muted)] hover:text-[var(--text)] w-7 text-center" aria-label={tr('Vitesse', 'Speed')}>{speed}×</button>
          <button type="button" onClick={fullscreen} className="shrink-0 text-[var(--muted)] hover:text-[var(--text)]" aria-label={tr('Plein écran', 'Fullscreen')}><Maximize2 size={15} /></button>
        </div>
      )}
    </figure>
  );
}

// Visual session replay — plays the REAL recorded BMM DOM (rrweb) with the cursor, scroll
// and clicks, scaled to fit. Falls back to the event-based reconstruction (SessionReplay)
// when a session has no recording.
//
// Three fixes over the first version, each a black-frame cause seen in the field:
//   1. The stream is run through `normalizeEvents` (lib/replay-decode): chunks sorted,
//      duplicates dropped, everything before the first FullSnapshot trimmed — rrweb cannot
//      paint incremental mutations onto an empty document and says nothing about it. A
//      stream with NO snapshot is reported as such instead of rendered black.
//   2. rrweb advances on requestAnimationFrame, which a hidden tab throttles to nothing.
//      Coming back, the replayer's clock had run on while no frame was applied, so the
//      picture lagged the scrubber by however long the tab was away. On `visibilitychange`
//      the player re-seeks to its own current time (`play(t)` replays up to t at once),
//      and the progress ticker uses a plain interval while hidden so the scrubber stays live.
//   3. `.bmmreplay` files can be opened locally (plain JSON or gzip'd — the decoder reads
//      the header), so an export from BMM or from the GDPR package plays here too.
import { useEffect, useMemo, useRef, useState } from "react";
import { Play, Pause, Maximize2, Minimize2, Download, FolderOpen, AlertTriangle } from "lucide-react";
import { apiGet } from "../lib/store";
import { SessionReplay } from "./replay";
import { classify, eventLabel, eventLocation, buildModalTitles, EvIcon, TYPES } from "./events";
import { normalizeEvents, eventsOf, decodeReplayBytes, type NormalizeReport, type RrwebEvent } from "../lib/replay-decode";
import "rrweb/dist/style.css";

const mmss = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export function RrwebReplay({ sessionId, fallbackEvents }: { sessionId: string; fallbackEvents: any[] }) {
  const [report, setReport] = useState<NormalizeReport | null>(null);
  const [localName, setLocalName] = useState("");
  const [loadErr, setLoadErr] = useState("");

  useEffect(() => {
    let on = true;
    setReport(null); setLocalName(""); setLoadErr("");
    apiGet(`/api/replay?session_id=${encodeURIComponent(sessionId)}`)
      .then((r) => { if (on) setReport(normalizeEvents(eventsOf(r))); })
      .catch(() => on && setReport(normalizeEvents([])));
    return () => { on = false; };
  }, [sessionId]);

  const openFile = async (f: File | undefined) => {
    if (!f) return;
    setLoadErr("");
    try {
      const doc = await decodeReplayBytes(new Uint8Array(await f.arrayBuffer()));
      setReport(normalizeEvents(eventsOf(doc)));
      setLocalName(f.name);
    } catch (e) {
      setLoadErr(`Could not read ${f.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const opener = (
    <label className="pill text-xs bg-panel2 text-sub hover:text-ink cursor-pointer inline-flex items-center gap-1.5" title="Open a .bmmreplay file (plain or gzip'd JSON)">
      <FolderOpen size={13} /> Open .bmmreplay
      <input type="file" accept=".bmmreplay,.json,.gz,application/json,application/gzip" className="hidden" onChange={(e) => { openFile(e.target.files?.[0]); e.target.value = ""; }} />
    </label>
  );

  if (report === null) return <div className="text-sm text-sub py-6 text-center">Loading replay…</div>;
  if (report.events.length < 2 || !report.has_snapshot) {
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-sub">
          {report.total > 0 && !report.has_snapshot ? (
            <span className="inline-flex items-center gap-1.5 text-warn"><AlertTriangle size={12} /> {report.total} replay events but no full snapshot — the recording joined mid-session and cannot be painted. Event reconstruction below.</span>
          ) : (
            <span>No DOM recording for this session — reconstruction from the events.</span>
          )}
          {opener}
          {loadErr && <span className="text-bad">{loadErr}</span>}
        </div>
        <SessionReplay events={fallbackEvents} />
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-sub">
        <span>{report.events.length} events · {report.width}×{report.height}{report.dropped_before_snapshot ? ` · ${report.dropped_before_snapshot} pre-snapshot dropped` : ""}{report.duplicates ? ` · ${report.duplicates} duplicates` : ""}{localName ? ` · ${localName}` : ""}</span>
        {opener}
        {loadErr && <span className="text-bad">{loadErr}</span>}
      </div>
      <Player key={localName || sessionId} events={report.events} markers={localName ? [] : fallbackEvents} recW={report.width} recH={report.height} />
    </div>
  );
}

function Player({ events, markers, recW, recH }: { events: RrwebEvent[]; markers: any[]; recW: number; recH: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const repRef = useRef<any>(null);
  const playingRef = useRef(true);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [cur, setCur] = useState(0);
  const [total, setTotal] = useState(0);
  const [startTime, setStartTime] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  playingRef.current = playing;

  useEffect(() => {
    let raf = 0;
    let iv: number | null = null;
    let disposed = false;
    let rep: any;
    let fit: (() => void) | null = null;
    let onVis: (() => void) | null = null;

    (async () => {
      const rrweb = await import("rrweb");
      if (disposed || !hostRef.current) return;
      hostRef.current.innerHTML = "";
      rep = new rrweb.Replayer(events as any, {
        root: hostRef.current,
        speed,
        skipInactive: true,
        showWarning: false,
        showDebug: false,
        mouseTail: { strokeStyle: "#5b8cff", lineWidth: 2 },
      });
      repRef.current = rep;
      const meta = rep.getMetaData();
      setTotal(meta.totalTime);
      setStartTime(meta.startTime);

      fit = () => {
        const box = boxRef.current;
        const wrapper = (rep as any).wrapper as HTMLElement | undefined;
        if (!box || !wrapper) return;
        const boxW = box.clientWidth;
        const isFS = !!document.fullscreenElement;
        const maxH = isFS ? box.clientHeight : Math.min(window.innerHeight * 0.6, 560);
        let scale = boxW / recW;
        if (recH * scale > maxH) scale = maxH / recH;
        wrapper.style.position = "absolute";
        wrapper.style.transformOrigin = "top left";
        wrapper.style.transform = `scale(${scale})`;
        wrapper.style.left = `${Math.max(0, (boxW - recW * scale) / 2)}px`;
        wrapper.style.top = `${Math.max(0, (maxH - recH * scale) / 2)}px`;
        if (!isFS) box.style.height = `${recH * scale}px`;
      };
      fit();
      window.addEventListener("resize", fit);
      (rep as any).__fit = fit;

      rep.on("finish", () => setPlaying(false));
      rep.play();

      // Progress ticker: rAF while visible (smooth), a 250 ms interval while hidden (rAF is
      // paused there and the scrubber would freeze).
      const readClock = () => { if (!disposed) setCur(Math.min(rep.getCurrentTime(), meta.totalTime)); };
      const startTicker = () => {
        cancelAnimationFrame(raf); if (iv) { clearInterval(iv); iv = null; }
        if (document.visibilityState === "hidden") { iv = window.setInterval(readClock, 250); return; }
        const tick = () => { if (disposed) return; readClock(); raf = requestAnimationFrame(tick); };
        raf = requestAnimationFrame(tick);
      };
      startTicker();
      // Back from a hidden tab: re-seek to the clock so the frame catches up with the time
      // that elapsed without a paint.
      onVis = () => {
        if (disposed) return;
        if (document.visibilityState === "visible" && playingRef.current) {
          try { const t = Math.min(rep.getCurrentTime(), meta.totalTime); rep.pause(); rep.play(t); } catch { /* ignore */ }
        }
        startTicker();
      };
      document.addEventListener("visibilitychange", onVis);
    })();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      if (iv) clearInterval(iv);
      if (fit) window.removeEventListener("resize", fit);
      if (onVis) document.removeEventListener("visibilitychange", onVis);
      try { rep?.pause?.(); } catch { /* ignore */ }
      try { rep?.destroy?.(); } catch { /* ignore */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, recW, recH]);

  useEffect(() => {
    const onFs = () => {
      setIsFullscreen(!!document.fullscreenElement);
      if (repRef.current?.__fit) setTimeout(repRef.current.__fit, 50); // let the layout settle first
    };
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) containerRef.current?.requestFullscreen().catch(() => {});
    else document.exitFullscreen().catch(() => {});
  };
  const toggle = () => {
    const rep = repRef.current;
    if (!rep) return;
    if (playing) { rep.pause(); setPlaying(false); }
    else { rep.play(cur >= total ? 0 : rep.getCurrentTime()); setPlaying(true); }
  };
  const exportBmmReplay = () => {
    const json = JSON.stringify({ bmmReplay: 1, app: "BetterModsManager", createdAt: new Date().toISOString(), masked: false, events });
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `bmm-replay-${Date.now()}.bmmreplay`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  const changeSpeed = (s: number) => { setSpeed(s); try { repRef.current?.setConfig?.({ speed: s }); } catch { /* ignore */ } };
  const seek = (ms: number) => {
    const rep = repRef.current;
    if (!rep) return;
    rep.play(ms);
    if (!playing) rep.pause();
    setCur(ms);
  };

  // Telemetry events overlaid as markers on the timeline (what happened + when).
  const titles = useMemo(() => buildModalTitles(markers || []), [markers]);
  const markPts = useMemo(() => {
    if (!startTime || !total) return [] as any[];
    return (markers || [])
      .filter((e: any) => e.event !== "page_leave" && e.event !== "perf" && e.event !== "$replay" && !e.event?.startsWith("$log_"))
      .map((e: any) => ({ off: new Date(e.ts).getTime() - startTime, type: classify(e), label: eventLabel(e), loc: eventLocation(e, titles) }))
      .filter((m: any) => m.off >= 0 && m.off <= total);
  }, [markers, startTime, total, titles]);
  const curEvent = useMemo(() => { let last: any = null; for (const m of markPts) { if (m.off <= cur) last = m; else break; } return last; }, [markPts, cur]);

  const logs = useMemo(() => {
    if (!startTime) return [];
    const list: any[] = [];
    for (const e of markers || []) {
      if (e.event === "$log_js") {
        list.push({ off: new Date(e.ts).getTime() - startTime, type: "JS", level: e.level || "info", msg: e.msg || "" });
      } else if (e.event === "$log_rust") {
        for (const line of (e.log || "").split("\n").filter(Boolean)) {
          list.push({ off: new Date(e.ts).getTime() - startTime, type: "Rust", level: line.toLowerCase().includes("error") ? "error" : "warn", msg: line });
        }
      }
    }
    return list.sort((a, b) => a.off - b.off);
  }, [markers, startTime]);

  return (
    <div ref={containerRef} className={isFullscreen ? "bg-bg p-6 h-full w-full flex flex-col gap-3 overflow-hidden text-ink" : "space-y-3"}>
      <div className={`flex gap-3 ${isFullscreen ? "flex-1 min-h-0 flex-col md:flex-row" : "flex-col"}`}>
        <div ref={boxRef} className={`relative w-full overflow-hidden rounded-xl border border-line bg-black ${isFullscreen ? "flex-1" : ""}`} style={isFullscreen ? {} : { height: 320 }}>
          <div ref={hostRef} className="absolute inset-0" />
        </div>

        {logs.length > 0 && (
          <div className={`bg-panel2 rounded-xl border border-line flex flex-col ${isFullscreen ? "md:w-[400px] md:h-full h-48 shrink-0" : "h-48"}`}>
            <div className="px-3 py-2 border-b border-line text-[11px] font-semibold text-sub tracking-wide uppercase flex justify-between shrink-0">
              <span>Live logs</span>
              <span>{logs.length} entries</span>
            </div>
            <div className="flex-1 overflow-y-auto p-3 font-mono text-[10px] space-y-1">
              {logs.map((log, i) => {
                const past = log.off <= cur;
                const color = log.level === "error" ? "text-bad" : "text-warn";
                return (
                  <div key={i} className={`flex gap-2 ${past ? color : "text-sub opacity-30"} ${Math.abs(log.off - cur) < 1500 ? "bg-line/30" : ""}`}>
                    <span className="shrink-0">{mmss(log.off)}</span>
                    <span className="shrink-0 w-8">[{log.type}]</span>
                    <span className="break-all whitespace-pre-wrap">{log.msg}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* current action (synced with playback) */}
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-panel2 border border-line min-h-[34px]">
        {curEvent ? <><EvIcon type={curEvent.type} size={14} /><span className="text-sm truncate">{curEvent.label}</span>{curEvent.loc ? <span className="text-[11px] text-sub truncate">· {curEvent.loc}</span> : null}</> : <span className="text-[11px] text-sub">—</span>}
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={toggle} className="w-9 h-9 rounded-full bg-brand text-white grid place-items-center shrink-0" title={playing ? "Pause" : "Play"} aria-label={playing ? "Pause" : "Play"}>
          {playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" className="translate-x-px" />}
        </button>

        <div className="relative flex-1 min-w-[160px]">
          {/* event markers above the scrubber */}
          <div className="relative h-3 mb-0.5">
            {markPts.map((m, i) => (
              <button
                key={i}
                onClick={() => seek(m.off)}
                title={`${mmss(m.off)} · ${m.label}${m.loc ? " — " + m.loc : ""}`}
                className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full hover:scale-150 transition-transform"
                style={{ left: `${(m.off / total) * 100}%`, background: (TYPES as any)[m.type].color }}
              />
            ))}
          </div>
          <input type="range" min={0} max={total || 1} value={cur} onChange={(e) => seek(+e.target.value)} className="w-full accent-brand" aria-label="Seek" />
        </div>
        <span className="text-[11px] text-sub font-mono shrink-0">{mmss(cur)} / {mmss(total)}</span>

        <div className="flex gap-1 shrink-0 items-center">
          {[1, 2, 4, 8].map((s) => (
            <button key={s} onClick={() => changeSpeed(s)} className={`pill text-xs ${speed === s ? "bg-brand text-white" : "bg-panel2 text-sub"}`}>{s}×</button>
          ))}
          <button onClick={exportBmmReplay} className="pill text-xs ml-2 bg-panel2 text-sub hover:text-ink inline-flex items-center gap-1.5" title="Export as .bmmreplay">
            <Download size={13} /> Export
          </button>
          <button onClick={toggleFullscreen} className="pill text-xs bg-panel2 text-sub hover:text-ink ml-1" title="Fullscreen" aria-label="Fullscreen">
            {isFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
        </div>
      </div>
    </div>
  );
}

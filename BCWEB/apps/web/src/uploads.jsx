import { createContext, useContext, useState, useCallback, useRef } from 'react';
import { UploadCloud, CheckCircle2, X, AlertTriangle, Loader2, Ban, ChevronDown, ChevronUp } from 'lucide-react';
import { uploadRepoFile } from './api.js';
import { useToast } from './ui.jsx';

// Global background-upload manager. Repo file/folder uploads run here (not inside a
// modal), so they keep going after the modal is closed. A floating dock shows live
// byte-level progress + transfer speed, and every job can be cancelled mid-flight.
const Ctx = createContext(null);
export const useUploads = () => useContext(Ctx);

const fmtBytes = (n) => {
  n = Number(n) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
};

let _id = 0;
export function UploadProvider({ children }) {
  const toast = useToast();
  const [jobs, setJobs] = useState([]);
  const [minimized, setMinimized] = useState(false);
  // Mutable per-job control (AbortController + cancel flag) — kept out of state so the
  // running async loop always sees the latest value without a stale closure.
  const ctrl = useRef(new Map());
  const patch = (id, p) => setJobs((js) => js.map((j) => (j.id === id ? { ...j, ...p } : j)));
  const dismiss = (id) => { ctrl.current.delete(id); setJobs((js) => js.filter((j) => j.id !== id)); };

  // Cancel: abort the in-flight PUT and stop the queue. The file being sent is rolled
  // back by the browser (the pre-signed PUT never completes → nothing is registered).
  const cancel = useCallback((id) => {
    const c = ctrl.current.get(id);
    if (!c) return;
    c.cancelled = true;
    try { c.ac?.abort(); } catch { /* already gone */ }
  }, []);

  const enqueue = useCallback((repoId, repoName, fileList, opts = {}) => {
    const files = [...fileList];
    if (!files.length) return;
    const id = ++_id;
    const totalBytes = files.reduce((a, f) => a + (f.size || 0), 0);
    ctrl.current.set(id, { cancelled: false, ac: null });
    setJobs((js) => [...js, {
      id, repoName, total: files.length, done: 0, failed: 0, status: 'uploading',
      totalBytes, sentBytes: 0, curLoaded: 0, curName: files[0]?.name || '', bps: 0,
    }]);
    setMinimized(false);

    (async () => {
      let done = 0, failed = 0, sentBytes = 0;
      const started = performance.now();
      for (const f of files) {
        const c = ctrl.current.get(id);
        if (c?.cancelled) break;
        const ac = new AbortController();
        c.ac = ac;
        patch(id, { curName: f.name, curLoaded: 0 });
        try {
          await uploadRepoFile(repoId, f, undefined, {
            signal: ac.signal,
            dashboard: opts.dashboard,
            onProgress: (loaded) => {
              const elapsed = (performance.now() - started) / 1000;
              patch(id, { curLoaded: loaded, bps: elapsed > 0 ? (sentBytes + loaded) / elapsed : 0 });
            },
          });
          sentBytes += f.size || 0;
        } catch (e) {
          if (e?.aborted) break;         // cancelled — stop the whole job
          failed++;
        }
        done++;
        patch(id, { done, failed, sentBytes, curLoaded: 0 });
        opts.onProgress?.(done, files.length);
      }
      const c = ctrl.current.get(id);
      const cancelled = !!c?.cancelled;
      const status = cancelled ? 'cancelled' : (failed ? 'error' : 'done');
      patch(id, { status, done, failed, sentBytes });
      if (cancelled) toast.info(`${repoName}: upload cancelled (${done} sent)`);
      else if (failed) toast.error(`${repoName}: ${done - failed}/${files.length} uploaded · ${failed} failed`);
      else toast.success(`${repoName}: ${files.length} file(s) uploaded`);
      opts.onDone?.({ done, failed, total: files.length, cancelled });
      if (status === 'done') setTimeout(() => dismiss(id), 6000); // auto-clear a clean job
    })();
  }, [toast]);

  const active = jobs.filter((j) => j.status === 'uploading').length;

  return (
    <Ctx.Provider value={{ enqueue, jobs, cancel }}>
      {children}
      {jobs.length > 0 && (
        <div className="fixed bottom-4 right-4 z-[60] w-[22rem] max-w-[calc(100vw-2rem)]">
          {/* dock header */}
          <div className="flex items-center gap-2 px-3 py-2 rounded-t-2xl border border-b-0 border-[var(--line-strong)]"
               style={{ background: 'var(--bg-solid)', boxShadow: '0 -1px 0 0 var(--line) inset' }}>
            <UploadCloud size={15} className="text-[var(--primary-2)]" />
            <span className="text-sm font-semibold flex-1">
              {active ? `Uploading — ${active} active` : 'Uploads'}
            </span>
            <button onClick={() => setMinimized((v) => !v)} className="text-[var(--faint)] hover:text-[var(--text)] p-0.5" title={minimized ? 'Expand' : 'Minimize'}>
              {minimized ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
            </button>
            {!active && <button onClick={() => jobs.forEach((j) => dismiss(j.id))} className="text-[var(--faint)] hover:text-[var(--text)] p-0.5" title="Clear all"><X size={15} /></button>}
          </div>
          {!minimized && (
            <div className="border border-[var(--line-strong)] rounded-b-2xl overflow-hidden divide-y divide-[var(--line)] max-h-[60vh] overflow-y-auto"
                 style={{ background: 'var(--bg-solid)', boxShadow: '0 18px 50px -12px rgba(0,0,0,0.5)' }}>
              {jobs.map((j) => {
                const sent = j.sentBytes + j.curLoaded;
                const pct = j.totalBytes ? Math.min(100, Math.round((sent / j.totalBytes) * 100)) : (j.status === 'done' ? 100 : 0);
                const uploading = j.status === 'uploading';
                return (
                  <div key={j.id} className="p-3 anim-fade">
                    <div className="flex items-center gap-2 mb-1.5">
                      {uploading ? <Loader2 size={14} className="text-[var(--primary-2)] animate-spin shrink-0" />
                        : j.status === 'cancelled' ? <Ban size={14} className="text-[var(--faint)] shrink-0" />
                        : j.failed ? <AlertTriangle size={14} className="text-amber-400 shrink-0" />
                        : <CheckCircle2 size={14} className="text-emerald-400 shrink-0" />}
                      <span className="text-sm font-medium flex-1 truncate">{j.repoName}</span>
                      {uploading
                        ? <button onClick={() => cancel(j.id)} className="text-[11px] px-2 py-0.5 rounded-md border border-[var(--line)] text-[var(--muted)] hover:text-red-400 hover:border-red-400/50 flex items-center gap-1"><Ban size={11} /> Cancel</button>
                        : <button onClick={() => dismiss(j.id)} className="text-[var(--faint)] hover:text-[var(--text)]"><X size={13} /></button>}
                    </div>
                    <div className="h-1.5 rounded-full bg-[var(--surface-2)] overflow-hidden">
                      <div className={`h-full transition-all ${j.status === 'cancelled' ? 'bg-[var(--faint)]' : j.failed ? 'bg-amber-500' : 'bg-gradient-to-r from-orange-500 to-amber-400'}`} style={{ width: `${pct}%` }} />
                    </div>
                    <div className="flex items-center justify-between gap-2 text-[11px] text-[var(--muted)] mt-1">
                      <span className="truncate">
                        {uploading ? `${j.done}/${j.total} · ${j.curName}` : j.status === 'cancelled' ? `Cancelled · ${j.done}/${j.total} sent` : j.failed ? `${j.done - j.failed}/${j.total} done · ${j.failed} failed` : `${j.total} file(s) · done`}
                      </span>
                      <span className="shrink-0 tabular-nums">
                        {fmtBytes(sent)}/{fmtBytes(j.totalBytes)}{uploading && j.bps ? ` · ${fmtBytes(j.bps)}/s` : ''}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </Ctx.Provider>
  );
}

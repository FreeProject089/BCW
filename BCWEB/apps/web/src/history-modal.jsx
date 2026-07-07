import { useEffect, useState } from 'react';
import { api } from './api.js';
import { useToast, Button, Spinner, Modal, EmptyState } from './ui.jsx';
import Markdown from './md.jsx';
import { History, RotateCcw, Clock, User as UserIcon } from 'lucide-react';

// Edit-history browser for a blog post / doc page. Lists past snapshots (newest
// first), previews the selected one, and restores it INTO the editor — the caller
// then saves, which snapshots the current state first, so nothing is ever lost.
// `base` is the resource path, e.g. `/blog/<id>` or `/docs/<id>`.
export default function HistoryModal({ base, onClose, onRestore }) {
  const toast = useToast();
  const [revs, setRevs] = useState(null);
  const [active, setActive] = useState(null);      // selected revision id
  const [preview, setPreview] = useState(null);    // { version, title, body, bodyFr, createdAt }
  const [loadingPreview, setLoadingPreview] = useState(false);
  // The API says whether the viewer may restore (editors) vs read-only (public view).
  const [canRestore, setCanRestore] = useState(false);

  useEffect(() => {
    api.get(`${base}/history`).then((r) => {
      setRevs(r.revisions || []);
      setCanRestore(!!r.canRestore && !!onRestore);
      if (r.revisions?.[0]) select(r.revisions[0].id);
    }).catch(() => setRevs([]));
    // eslint-disable-next-line
  }, [base]);

  const select = (id) => {
    setActive(id); setLoadingPreview(true); setPreview(null);
    api.get(`${base}/history/${id}`).then((r) => setPreview(r.revision)).catch(() => toast.error('Could not load that version.')).finally(() => setLoadingPreview(false));
  };
  const fmt = (d) => { try { return new Date(d).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };
  const restore = () => { if (preview) { onRestore(preview); onClose(); toast.success(`Restored version ${preview.version} into the editor — review, then Save.`); } };

  return (
    <Modal open onClose={onClose} title="Edit history" icon={History} width="max-w-4xl"
      footer={<>
        <span className="text-xs text-[var(--faint)] mr-auto">{canRestore ? 'Restoring loads the version into the editor — nothing is lost until you Save.' : 'Read-only version history for this published post.'}</span>
        <Button variant="ghost" onClick={onClose}>Close</Button>
        {canRestore && <Button variant="primary" disabled={!preview} onClick={restore}><RotateCcw size={14} /> Restore this version</Button>}
      </>}>
      <div className="grid sm:grid-cols-[240px_1fr] gap-4 min-h-[50vh]">
        {/* revision list */}
        <div className="max-h-[56vh] overflow-auto -mr-1 pr-1 space-y-1">
          {revs === null ? <div className="grid place-items-center py-10"><Spinner /></div>
            : revs.length ? revs.map((r, i) => (
              <button key={r.id} onClick={() => select(r.id)}
                className={`w-full text-left rounded-lg border px-3 py-2 transition ${active === r.id ? 'border-[var(--primary)] bg-[var(--primary)]/8' : 'border-[var(--line)] hover:border-[var(--line-strong)]'}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">v{r.version}{i === 0 && <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-400">latest</span>}</span>
                  <span className="text-[11px] text-[var(--faint)]">{(r.bytes / 1024).toFixed(1)} KB</span>
                </div>
                <div className="text-[11px] text-[var(--faint)] flex items-center gap-1 mt-0.5"><UserIcon size={10} /> {r.editor}</div>
                <div className="text-[11px] text-[var(--faint)] flex items-center gap-1"><Clock size={10} /> {fmt(r.createdAt)}</div>
              </button>
            )) : <EmptyState icon={History} title="No history yet" sub="Snapshots appear here after each save." />}
        </div>
        {/* preview */}
        <div className="min-w-0 border-l border-[var(--line)] pl-4 max-h-[56vh] overflow-auto">
          {loadingPreview ? <div className="grid place-items-center py-10"><Spinner /></div>
            : preview ? <>
              <div className="text-xs text-[var(--faint)] mb-2">Version {preview.version} · {fmt(preview.createdAt)}</div>
              <h3 className="text-lg font-bold mb-2">{preview.title}</h3>
              <div className="text-sm"><Markdown>{preview.body || '*(empty)*'}</Markdown></div>
            </> : <div className="text-sm text-[var(--faint)] grid place-items-center h-full">Select a version to preview it.</div>}
        </div>
      </div>
    </Modal>
  );
}

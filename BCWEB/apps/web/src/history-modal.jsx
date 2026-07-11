import { useEffect, useMemo, useState } from 'react';
import { api } from './api.js';
import { useToast, Button, Spinner, Modal, EmptyState } from './ui.jsx';
import { useI18n } from './i18n.jsx';
import Markdown from './md.jsx';
import { diffLines, lineStat } from './merge3.js';
import { History, RotateCcw, Clock, User as UserIcon, Eye, GitCompare, Languages } from 'lucide-react';

const bodyOf = (rev, lang) => (lang === 'fr' ? (rev?.bodyFr ?? rev?.body) : rev?.body) || '';

// GitHub-style line diff (old → new): red deletions, green additions, plain context.
function DiffView({ a, b }) {
  const { t } = useI18n();
  const rows = useMemo(() => diffLines(a || '', b || ''), [a, b]);
  const stat = useMemo(() => lineStat(a || '', b || ''), [a, b]);
  return (
    <div>
      <div className="text-xs font-mono mb-2"><span className="text-emerald-500">+{stat.added}</span> <span className="text-red-500">−{stat.removed}</span> <span className="text-[var(--faint)]">{t('hm.vsprev', 'vs previous version')}</span></div>
      <div className="font-mono text-[12.5px] leading-[1.55] rounded-lg border border-[var(--line)] overflow-hidden">
        {rows.map((r, i) => (
          <div key={i} className={`flex ${r.type === 'add' ? 'bg-emerald-500/[0.09]' : r.type === 'del' ? 'bg-red-500/[0.09]' : ''}`}>
            <span className={`select-none w-6 shrink-0 text-center ${r.type === 'add' ? 'text-emerald-500' : r.type === 'del' ? 'text-red-500' : 'text-transparent'}`}>{r.type === 'add' ? '+' : r.type === 'del' ? '−' : ''}</span>
            <span className="whitespace-pre-wrap break-words flex-1 pr-2">{r.text || ' '}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Edit-history browser for a blog post / doc page. Lists past snapshots (newest first),
// shows the selected one either RENDERED or as a git-style DIFF vs the previous version,
// in EN or FR, and restores it INTO the editor. `base` = `/blog/<id>` or `/docs/<id>`.
export default function HistoryModal({ base, onClose, onRestore }) {
  const toast = useToast(); const { t } = useI18n();
  const [revs, setRevs] = useState(null);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [preview, setPreview] = useState(null);   // selected revision full content
  const [prevBody, setPrevBody] = useState(null); // { body, bodyFr } of the older adjacent revision (for diff)
  const [loading, setLoading] = useState(false);
  const [canRestore, setCanRestore] = useState(false);
  const [mode, setMode] = useState('rendered');   // 'rendered' | 'diff'
  const [lang, setLang] = useState('en');         // 'en' | 'fr'

  useEffect(() => {
    api.get(`${base}/history`).then((r) => {
      const list = r.revisions || [];
      setRevs(list); setCanRestore(!!r.canRestore && !!onRestore);
      if (list.length) select(0, list);
    }).catch(() => setRevs([]));
    // eslint-disable-next-line
  }, [base]);

  const select = (idx, list = revs) => {
    setActiveIdx(idx); setLoading(true); setPreview(null); setPrevBody(null);
    const older = list[idx + 1]; // revisions are newest-first, so idx+1 is the previous version
    Promise.all([
      api.get(`${base}/history/${list[idx].id}`),
      older ? api.get(`${base}/history/${older.id}`) : Promise.resolve(null),
    ]).then(([cur, prev]) => { setPreview(cur.revision); setPrevBody(prev ? prev.revision : null); })
      .catch(() => toast.error(t('hm.loadfail', 'Could not load that version.'))).finally(() => setLoading(false));
  };
  const fmt = (d) => { try { return new Date(d).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };
  const restore = () => { if (preview) { onRestore(preview); onClose(); toast.success(t('hm.restored', 'Restored version {v} into the editor — review, then Save.').replace('{v}', preview.version)); } };
  const hasFr = !!(preview?.bodyFr || prevBody?.bodyFr);

  return (
    <Modal open onClose={onClose} title={t('hm.title', 'Edit history')} icon={History} width="max-w-4xl"
      footer={<>
        <span className="text-xs text-[var(--faint)] mr-auto">{canRestore ? t('hm.restorehint', 'Restoring loads the version into the editor — nothing is lost until you Save.') : t('hm.readonly', 'Read-only version history for this published post.')}</span>
        <Button variant="ghost" onClick={onClose}>{t('hm.close', 'Close')}</Button>
        {canRestore && <Button variant="primary" disabled={!preview} onClick={restore}><RotateCcw size={14} /> {t('hm.restorebtn', 'Restore this version')}</Button>}
      </>}>
      <div className="grid sm:grid-cols-[240px_1fr] gap-4 sm:min-h-[50vh]">
        {/* On a phone the two panes stack: cap the version list short so the preview
            below is reachable without scrolling past every snapshot. */}
        <div className="max-h-[30vh] sm:max-h-[56vh] overflow-auto scroll-thin -mr-1 pr-1 space-y-1">
          {revs === null ? <div className="grid place-items-center py-10"><Spinner /></div>
            : revs.length ? revs.map((r, i) => (
              <button key={r.id} onClick={() => select(i)}
                className={`w-full text-left rounded-lg border px-3 py-2 transition ${activeIdx === i ? 'border-[var(--primary)] bg-[var(--primary)]/8' : 'border-[var(--line)] hover:border-[var(--line-strong)]'}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">v{r.version}{i === 0 && <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-400">{t('hm.latest', 'latest')}</span>}</span>
                  <span className="text-[11px] text-[var(--faint)]">{(r.bytes / 1024).toFixed(1)} KB</span>
                </div>
                <div className="text-[11px] text-[var(--faint)] flex items-center gap-1 mt-0.5"><UserIcon size={10} /> {r.editor}</div>
                <div className="text-[11px] text-[var(--faint)] flex items-center gap-1"><Clock size={10} /> {fmt(r.createdAt)}</div>
              </button>
            )) : <EmptyState icon={History} title={t('hm.nohistory', 'No history yet')} sub={t('hm.nohistorysub', 'Snapshots appear here after each save.')} />}
        </div>
        <div className="min-w-0 border-t sm:border-t-0 sm:border-l border-[var(--line)] pt-4 sm:pt-0 sm:pl-4 max-h-[52vh] sm:max-h-[56vh] overflow-auto scroll-thin">
          {loading ? <div className="grid place-items-center py-10"><Spinner /></div>
            : preview ? <>
              <div className="flex items-center justify-between gap-2 mb-2.5 flex-wrap">
                <div className="text-xs text-[var(--faint)]">{t('hm.version', 'Version')} {preview.version} · {fmt(preview.createdAt)}</div>
                <div className="flex items-center gap-1.5">
                  <div className="inline-flex rounded-lg border border-[var(--line)] p-0.5 text-xs">
                    <button onClick={() => setMode('rendered')} className={`px-2 py-0.5 rounded-md flex items-center gap-1 ${mode === 'rendered' ? 'bg-[var(--surface-2)] text-[var(--text)]' : 'text-[var(--muted)]'}`}><Eye size={12} /> {t('hm.rendered', 'Rendered')}</button>
                    <button onClick={() => setMode('diff')} className={`px-2 py-0.5 rounded-md flex items-center gap-1 ${mode === 'diff' ? 'bg-[var(--surface-2)] text-[var(--text)]' : 'text-[var(--muted)]'}`}><GitCompare size={12} /> {t('hm.diff', 'Diff')}</button>
                  </div>
                  {hasFr && (
                    <div className="inline-flex rounded-lg border border-[var(--line)] p-0.5 text-xs" title={t('hm.language', 'Language')}>
                      {['en', 'fr'].map((l) => <button key={l} onClick={() => setLang(l)} className={`px-2 py-0.5 rounded-md uppercase ${lang === l ? 'bg-[var(--surface-2)] text-[var(--text)]' : 'text-[var(--muted)]'}`}>{l}</button>)}
                    </div>
                  )}
                </div>
              </div>
              {preview.title && <h3 className="text-lg font-bold mb-2">{preview.title}</h3>}
              {mode === 'diff'
                ? (prevBody
                    ? <DiffView a={bodyOf(prevBody, lang)} b={bodyOf(preview, lang)} />
                    : <div className="text-sm text-[var(--faint)] flex items-center gap-1.5 py-4"><Languages size={14} /> {t('hm.firstversion', 'First version — nothing to compare against.')}</div>)
                : <div className="text-sm"><Markdown>{bodyOf(preview, lang) || '*(empty)*'}</Markdown></div>}
            </> : <div className="text-sm text-[var(--faint)] grid place-items-center h-full">{t('hm.selectversion', 'Select a version to preview it.')}</div>}
        </div>
      </div>
    </Modal>
  );
}

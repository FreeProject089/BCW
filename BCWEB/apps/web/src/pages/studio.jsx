// The studio as a page: /studio/:kind/:id/:index.
//
// A canvas is a page, and it wants a page's worth of room — the modal it used to open in gave
// it whatever was left of a settings column. This route owns three things the modal never
// had to: WHERE the config comes from, WHERE it goes back, and what happens to an edit that
// was never saved.
//
//   From: the config editor hands over the config it has in memory (sessionStorage, keyed by
//   target) so an unsaved edit made in the form is what the studio starts from; with no
//   handoff — a bookmark, a reload — the config is fetched. Fixed projects come from
//   GET /projects/:key; showcase pages from the admin list, matched by slug or short, because
//   the editor knows the slug and the save route wants the id.
//
//   Back: the SAME write the editor's Save makes — PUT /projects/:key { config } or
//   PUT /admin/showcase/:id { config } — with this one canvas replaced (withCanvasAt). The
//   modal wrote through `patch(studioAt, next)` into the editor's state and the editor saved
//   the whole config; this saves the whole config too, from the same starting point.
//
//   Unsaved: every change is kept as a draft in sessionStorage for this tab, restored on the
//   next open with a way to discard it, and leaving with unsaved changes asks first.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { LayoutTemplate, ShieldCheck, AlertTriangle } from 'lucide-react';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { Button, EmptyState, Spinner, useDialog, useToast } from '../ui/ui.jsx';
import CanvasStudio from '../editor/canvas-studio.jsx';
import ProjectPage, { ShowcaseProjectPage } from './project.jsx';
import { parseStudioParams, handoffKey, draftKey, withCanvasAt, saveState, studioPath } from '../lib/studio-page.js';

const readJson = (key) => { try { const raw = sessionStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch { return null; } };
const writeJson = (key, v) => { try { sessionStorage.setItem(key, JSON.stringify(v)); } catch { /* quota, private mode */ } };
const drop = (key) => { try { sessionStorage.removeItem(key); } catch { /* nothing to clear */ } };

/** Where the config lives for each kind, and where "Back" goes. */
async function loadTarget(kind, id) {
  if (kind === 'project') {
    const r = await api.get(`/projects/${encodeURIComponent(id)}`);
    return { config: r.config || {}, saveId: id, back: `/admin?s=projects&key=${encodeURIComponent(id)}`, name: id.toUpperCase() };
  }
  // The editor passes the slug (or the short, lower-cased) — the save route wants the id.
  const r = await api.get('/admin/showcase');
  const rows = r.projects || [];
  const row = rows.find((x) => x.slug === id) || rows.find((x) => String(x.short || '').toLowerCase() === id.toLowerCase()) || rows.find((x) => x.id === id);
  if (!row) throw Object.assign(new Error('not_found'), { status: 404 });
  return { config: row.config || {}, saveId: row.id, back: '/admin?s=showcase', name: row.name || row.slug, slug: row.slug, row };
}

async function saveTarget(kind, saveId, config) {
  if (kind === 'project') return api.put(`/projects/${encodeURIComponent(saveId)}`, { config });
  return api.put(`/admin/showcase/${encodeURIComponent(saveId)}`, { config });
}

export default function StudioPage() {
  const { t } = useI18n();
  const params = useParams();
  const navigate = useNavigate();
  const dialog = useDialog();
  const toast = useToast();
  const { kind, id, index } = parseStudioParams(params);

  const [target, setTarget] = useState(null);     // { config, saveId, back, name }
  const [err, setErr] = useState(null);
  const [canvas, setCanvas] = useState(null);
  const [savedCanvas, setSavedCanvas] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);

  // Load: the editor's handoff first, the API otherwise.
  useEffect(() => {
    if (!kind || !id) return undefined;
    let alive = true;
    setErr(null); setTarget(null); setCanvas(null);
    const hand = readJson(handoffKey(kind, id));
    const fromHand = hand && hand.config && typeof hand.config === 'object'
      ? Promise.resolve({ config: hand.config, saveId: hand.saveId || null, back: hand.back || null, name: hand.name || id })
      : null;
    (fromHand || loadTarget(kind, id))
      .then(async (tg) => {
        // A handoff carries the config but not always the id the save route wants (showcase);
        // fetch that half when it is missing, keeping the handed-over config.
        if (!tg.saveId) {
          try { const full = await loadTarget(kind, id); tg = { ...full, config: tg.config, name: tg.name || full.name }; }
          catch (e) { if (kind !== 'project') throw e; tg = { ...tg, saveId: id, back: `/admin?s=projects&key=${encodeURIComponent(id)}` }; }
        }
        if (!alive) return;
        setTarget(tg);
        if (index != null && Number.isInteger(index)) {
          const list = Array.isArray(tg.config.canvases) ? tg.config.canvases : [];
          const base = list[index] || null;
          const draft = readJson(draftKey(kind, id, index));
          setSavedCanvas(base);
          if (draft && draft.canvas && base && draft.canvas.id === base.id && JSON.stringify(draft.canvas) !== JSON.stringify(base)) {
            setCanvas(draft.canvas); setDraftRestored(true);
          } else { setCanvas(base); setDraftRestored(false); if (draft) drop(draftKey(kind, id, index)); }
        }
      })
      .catch((e) => { if (alive) setErr(e); });
    return () => { alive = false; };
  }, [kind, id, index]);

  const dirty = !!canvas && JSON.stringify(canvas) !== JSON.stringify(savedCanvas);

  // The draft: written a moment after each change, not on every keystroke.
  const draftTimer = useRef(null);
  const onChange = useCallback((next) => {
    setCanvas(next);
    setSaveErr(false);
    clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => writeJson(draftKey(kind, id, index), { at: Date.now(), canvas: next }), 300);
  }, [kind, id, index]);
  useEffect(() => () => clearTimeout(draftTimer.current), []);

  // Leaving the tab with unsaved changes asks; the draft survives either way.
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const save = useCallback(async () => {
    if (!target || !canvas || saving) return;
    setSaving(true); setSaveErr(false);
    try {
      const cfg = withCanvasAt(target.config, index, canvas);
      await saveTarget(kind, target.saveId, cfg);
      setTarget((tg) => ({ ...tg, config: cfg }));
      setSavedCanvas(canvas);
      setDraftRestored(false);
      drop(draftKey(kind, id, index));
      // The handoff described a config that is now stale; the editor will fetch the saved one.
      drop(handoffKey(kind, id));
      toast.success(t('cst.save.done', 'Page saved.'));
    } catch (e) {
      setSaveErr(true);
      toast.error(e?.data?.error === 'forbidden' ? t('cst.save.forbidden', 'You cannot edit this page.') : t('cst.save.fail', 'The page could not be saved. Your changes are kept as a draft in this tab.'));
    } finally { setSaving(false); }
  }, [target, canvas, saving, kind, id, index, t, toast]);

  const back = useCallback(async () => {
    if (dirty) {
      const ok = await dialog.confirm({
        title: t('cst.leave.title', 'Unsaved changes'),
        message: t('cst.leave.msg', 'This page has changes that were not saved. They stay as a draft in this tab, and are lost when the tab closes. Leave anyway?'),
        okLabel: t('cst.leave.go', 'Leave'),
        danger: true,
      });
      if (!ok) return;
    }
    drop(handoffKey(kind, id));
    navigate(target?.back || '/admin');
  }, [dirty, dialog, t, kind, id, navigate, target]);

  const discardDraft = useCallback(() => {
    drop(draftKey(kind, id, index));
    setCanvas(savedCanvas);
    setDraftRestored(false);
  }, [kind, id, index, savedCanvas]);

  // The whole public page, with THIS canvas in its tab — the same component visitors get,
  // fed the draft config instead of a fetch.
  const renderPage = useMemo(() => {
    if (!target || index == null) return null;
    return (cv) => {
      const config = withCanvasAt(target.config, index, cv);
      const tab = `c-${cv?.id || ''}`;
      if (kind === 'project') return <ProjectPage preview={{ key: id, config, tab }} />;
      // The public page reads `project` the way GET /showcase/:slug shapes it; the admin row
      // carries every one of those fields, with the draft config in place of the saved one.
      const row = target.row || { id: target.saveId, slug: target.slug || id, name: target.name, short: '', icon: null };
      return <ShowcaseProjectPage preview={{ project: { ...row, config, tagline: config.tagline || '' }, tab }} />;
    };
  }, [target, index, kind, id]);

  // ── The states a URL can land in ──────────────────────────────────────────
  if (!kind || !id || (index != null && Number.isNaN(index))) {
    return <EmptyState icon={LayoutTemplate} title={t('cst.route.bad', 'This is not a studio address')} sub={t('cst.route.bad.h', 'Open the studio from a page’s settings in the admin.')} />;
  }
  if (err) {
    const forbidden = err.status === 403 || err.status === 401;
    return (
      <EmptyState icon={forbidden ? ShieldCheck : AlertTriangle}
        title={forbidden ? t('proj.notAvailable', 'Not available') : t('proj.notFound', 'Project not found')}
        sub={forbidden ? t('proj.noAccess', "You don't have access to this page.") : t('cst.route.missing', 'Nothing is configured under this address.')}>
        <Link to="/admin"><Button size="sm" variant="ghost">{t('common.back', 'Back')}</Button></Link>
      </EmptyState>
    );
  }
  if (!target) return <div className="flex items-center gap-2 text-[var(--muted)] py-10"><Spinner /> {t('common.loading', 'Loading…')}</div>;

  const list = Array.isArray(target.config.canvases) ? target.config.canvases : [];
  // No index: a chooser. One row per studio page of this config.
  if (index == null || !canvas) {
    return (
      <div className="max-w-2xl mx-auto py-6">
        <div className="flex items-center gap-2 mb-4">
          <LayoutTemplate size={18} className="text-[var(--primary-2)]" />
          <h1 className="text-lg font-semibold flex-1 min-w-0 truncate">{t('cst.pick.title', 'Studio pages of {name}').replace('{name}', target.name || id)}</h1>
          <Button size="sm" variant="ghost" onClick={() => navigate(target.back || '/admin')}>{t('common.back', 'Back')}</Button>
        </div>
        {target.config.studioEnabled !== true && <p className="text-xs text-[var(--muted)] mb-3">{t('pce.studio.off', 'The studio is off for this page. An administrator can turn it on.')}</p>}
        {!list.length && <div className="text-xs text-[var(--faint)] text-center py-8 rounded-xl border border-dashed border-[var(--line)]">{t('cst.pick.empty', 'No studio pages yet — add one from the page settings.')}</div>}
        <div className="space-y-2">
          {list.map((cv, i) => (
            <Link key={cv?.id || i} to={studioPath(kind, id, i)} className="flex items-center gap-2 rounded-xl border border-[var(--line)] p-3 hover:border-[var(--primary)]/50">
              <span className="flex-1 min-w-0 truncate text-sm">{cv?.title || t('pce.canvases.untitled', 'Untitled page')}</span>
              <span className="text-[11px] text-[var(--faint)] tabular-nums">{t('pce.canvases.n', '{n} block(s)').replace('{n}', (cv?.blocks || []).length)}</span>
            </Link>
          ))}
        </div>
        {index != null && !canvas && list.length > 0 && <p className="text-xs text-warning mt-3">{t('cst.pick.gone', 'There is no page at that position — pick one above.')}</p>}
      </div>
    );
  }

  const state = saveState({ dirty, saving, error: saveErr });
  return (
    <CanvasStudio
      layout="page"
      value={canvas}
      onChange={onChange}
      renderPage={renderPage}
      chrome={{
        title: canvas.title || t('pce.canvases.untitled', 'Untitled page'),
        state,
        canSave: dirty && !saving,
        onSave: save,
        onBack: back,
        draftRestored,
        onDiscardDraft: discardDraft,
      }}
    />
  );
}

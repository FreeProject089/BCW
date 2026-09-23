// The studio as a page: /studio/:kind/:id/:index.
//
// A canvas is a page, and it wants a page's worth of room — the modal it used to open in gave
// it whatever was left of a settings column. This route owns three things the modal never
// had to: WHERE the config comes from, WHERE it goes back, and what happens to an edit that
// was never saved.
//
//   From: ALWAYS the admin route that asks what saving asks (studioLoadPath): the public
//   GET /projects/:key used to be enough to open, so a grantee of project A edited B's studio
//   and only the save said no. The config editor may still hand over the config it holds in
//   memory (sessionStorage, keyed by target), so a page added in the form and not saved yet
//   opens; the handoff is used only once the guarded load has answered.
//
//   Back: ONE page, by id, with the revision it was opened at (studioSavePath). The server
//   puts that page back into the config as stored NOW, so a text fix saved meanwhile in the
//   config editor, or another page saved from another tab, survives; and if this page itself
//   moved meanwhile the answer is a 409 and the author chooses, never a silent overwrite.
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
import { parseStudioParams, handoffKey, draftKey, canvasAt, blankCanvasAt, withCanvasAt, saveState, studioPath, studioLoadPath, studioSaveRequest, pageIdAt } from '../lib/studio-page.js';
import StudioPageFrame from '../editor/studio-page-frame.jsx';
import { framedPreviewUrl, previewReasons } from '../lib/studio-preview.js';

const readJson = (key) => { try { const raw = sessionStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch { return null; } };
const writeJson = (key, v) => { try { sessionStorage.setItem(key, JSON.stringify(v)); } catch { /* quota, private mode */ } };
const drop = (key) => { try { sessionStorage.removeItem(key); } catch { /* nothing to clear */ } };

/** Where the config lives for each kind, and where "Back" goes. Every kind is read through
 *  the guarded admin route, which answers 403 to somebody who could not save it either. */
async function loadTarget(kind, id) {
  const r = await api.get(studioLoadPath(kind, id));
  // The landing page. It has no id of its own — there is one home page — so the route carries
  // `home` as a placeholder and the config is the site setting the Home page screen edits.
  if (kind === 'home') {
    const { variants: _v, studioRevs, ...config } = r || {};
    return { config, revs: studioRevs || {}, saveId: 'home', back: '/admin?s=homepage', name: 'Home' };
  }
  const revs = r?.revs && typeof r.revs === 'object' ? r.revs : {};
  if (kind === 'project') return { config: r?.config || {}, revs, saveId: id, back: `/admin?s=projects&key=${encodeURIComponent(id)}`, name: id.toUpperCase() };
  // The editor passes the slug (or the short); the route finds the row and the save wants its id.
  const row = r?.project;
  if (!row) throw Object.assign(new Error('not_found'), { status: 404 });
  return { config: r.config || {}, revs, saveId: row.id, back: '/admin?s=showcase', name: row.name || row.slug, slug: row.slug, row };
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
    // The guarded load FIRST, always: a handoff in sessionStorage is not a permission. Only
    // once the server has said yes is the handed-over config (unsaved form edits) used.
    loadTarget(kind, id)
      .then((tg) => {
        if (hand && hand.config && typeof hand.config === 'object') tg = { ...tg, config: hand.config };
        if (!alive) return;
        // The page is addressed by its id from here on: the index only picked it.
        tg = { ...tg, pageId: index != null && Number.isInteger(index) ? pageIdAt(tg.config, index, kind) : null };
        setTarget(tg);
        if (index != null && Number.isInteger(index)) {
          // A home section that was never drawn has no canvas yet. It used to land on the
          // chooser with "There is no page at that position", so a section switched to Drawn
          // could not be opened at all: it starts on a blank page instead. `savedCanvas` is
          // that same blank, so opening and leaving is not an unsaved change.
          const base = canvasAt(tg.config, index, kind) || blankCanvasAt(tg.config, index, kind);
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
    const pageId = target.pageId;
    if (!pageId) { setSaveErr(true); toast.error(t('cst.save.noid', 'This page has no id, it cannot be saved from the studio.')); return; }
    setSaving(true); setSaveErr(false);
    // One page, from the revision it was opened at ('' = a page that was never stored).
    const put = (base) => { const rq = studioSaveRequest(kind, target.saveId, pageId, canvas, base); return api.put(rq.path, rq.body); };
    const landed = (rev) => {
      setTarget((tg) => ({ ...tg, config: withCanvasAt(tg.config, index, canvas, kind), revs: { ...(tg.revs || {}), [pageId]: rev } }));
      setSavedCanvas(canvas);
      setDraftRestored(false);
      drop(draftKey(kind, id, index));
      // The handoff described a config that is now stale; the editor will fetch the saved one.
      drop(handoffKey(kind, id));
      toast.success(t('cst.save.done', 'Page saved.'));
    };
    try {
      const r = await put(target.revs?.[pageId] ?? '');
      landed(r?.rev ?? '');
    } catch (e) {
      const err = e?.data?.error;
      if (e?.status === 409 && err === 'conflict') {
        // Somebody saved THIS page after it was opened here. Nothing is overwritten without
        // the author saying so, and nothing of theirs is lost either way: Escape keeps editing.
        setSaving(false);
        const mine = await dialog.confirm({
          title: t('cst.conflict.title', 'Saved elsewhere meanwhile'),
          message: t('cst.conflict.msg', 'Somebody saved this page after you opened it. Replace their version with yours? Your version stays in this tab whatever you choose.'),
          okLabel: t('cst.conflict.mine', 'Replace with mine'),
          cancelLabel: t('cst.conflict.other', 'Other choices'),
          danger: true,
        });
        if (mine) {
          setSaving(true);
          try { const r2 = await put(e.data.rev ?? ''); landed(r2?.rev ?? ''); }
          catch { setSaveErr(true); toast.error(t('cst.save.fail', 'The page could not be saved. Your changes are kept as a draft in this tab.')); }
          finally { setSaving(false); }
          return;
        }
        const theirs = await dialog.confirm({
          title: t('cst.conflict.theirs.title', 'Load the saved version?'),
          message: t('cst.conflict.theirs.msg', 'Your changes in this tab are replaced by the version that was saved. Choose Keep editing to keep yours and decide later.'),
          okLabel: t('cst.conflict.theirs', 'Load the saved version'),
          cancelLabel: t('cst.conflict.keep', 'Keep editing'),
          danger: true,
        });
        if (theirs && e.data.current) {
          setCanvas(e.data.current); setSavedCanvas(e.data.current);
          setTarget((tg) => ({ ...tg, config: withCanvasAt(tg.config, index, e.data.current, kind), revs: { ...(tg.revs || {}), [pageId]: e.data.rev ?? '' } }));
          drop(draftKey(kind, id, index)); setDraftRestored(false);
        } else setSaveErr(true);
        return;
      }
      setSaveErr(true);
      if (err === 'invalid_studio_doc') {
        toast.error(t('cst.save.invalid', 'Refused by the server: {what} ({where}). Your changes are kept as a draft in this tab.')
          .replace('{what}', t(`cst.save.why.${e.data.reason}`, e.data.reason || '?')).replace('{where}', String(e.data.path || '').replace(/^(canvases|customSections)\[\d+\]\.(canvas\.)?/, '')));
      } else if (err === 'page_gone') toast.error(t('cst.save.gone', 'This page was deleted elsewhere since you opened it. Your changes are kept as a draft in this tab.'));
      else toast.error(err === 'forbidden' ? t('cst.save.forbidden', 'You cannot edit this page.') : t('cst.save.fail', 'The page could not be saved. Your changes are kept as a draft in this tab.'));
    } finally { setSaving(false); }
  }, [target, canvas, saving, kind, id, index, t, toast, dialog]);

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

  // The whole public page, with THIS canvas in its tab: the REAL route, framed at a device
  // width, fed the draft (editor/studio-page-frame.jsx, lib/studio-preview.js). It used to be
  // the page component mounted in here, without the site around it, at the studio's width,
  // and a page with no title fell back to its Overview (PLAN-STUDIO-2026 bug B).
  const renderPage = useMemo(() => {
    if (!target || index == null) return null;
    return (cv, width) => {
      const config = withCanvasAt(target.config, index, cv, kind);
      const tab = `c-${cv?.id || ''}`;
      const title = t('cst.preview.page', 'The whole project page, with this block in place');
      if (kind === 'home') {
        // The section being drawn is shown even while it is switched off: that is what is
        // being looked at. The note above the frame says visitors do not see it yet.
        const section = (target.config.customSections || [])[index] || null;
        const sections = (config.customSections || []).map((s, i) => (i === index ? { ...s, enabled: true } : s));
        return <StudioPageFrame key={width} src={framedPreviewUrl('home')} kind="home" payload={{ config: { ...config, customSections: sections } }}
          title={title} reasons={previewReasons('home', config, cv, section)} t={t} />;
      }
      if (kind === 'project') {
        return <StudioPageFrame key={width} src={framedPreviewUrl('project', id, cv?.id)} kind="project" payload={{ key: id, config, tab }}
          title={title} reasons={previewReasons('project', config, cv)} t={t} />;
      }
      // The public page reads `project` the way GET /showcase/:slug shapes it; the admin row
      // carries every one of those fields, with the draft config in place of the saved one.
      const row = target.row || { id: target.saveId, slug: target.slug || id, name: target.name, short: '', icon: null };
      return <StudioPageFrame key={width} src={framedPreviewUrl('showcase', row.slug || id, cv?.id)} kind="showcase"
        payload={{ project: { ...row, config, tagline: config.tagline || '' }, tab }}
        title={title} reasons={previewReasons('showcase', config, cv)} t={t} />;
    };
  }, [target, index, kind, id, t]);

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

  // What this kind offers to edit. For the home page that is its custom sections, which are
  // written OR drawn; only a drawn one is a studio page.
  const list = kind === 'home'
    ? (Array.isArray(target.config.customSections) ? target.config.customSections : [])
      .map((sec, i) => ({ id: sec?.id || `s${i}`, title: sec?.title?.en || sec?.title?.fr || '', blocks: sec?.canvas?.blocks || [], drawn: sec?.mode === 'canvas' }))
    : (Array.isArray(target.config.canvases) ? target.config.canvases : []);
  // No index: a chooser. One row per studio page of this config.
  if (index == null || !canvas) {
    return (
      <div className="max-w-2xl mx-auto py-6">
        <div className="flex items-center gap-2 mb-4">
          <LayoutTemplate size={18} className="text-[var(--accent-ink)]" />
          <h1 className="text-lg font-semibold flex-1 min-w-0 truncate">{t('cst.pick.title', 'Studio pages of {name}').replace('{name}', target.name || id)}</h1>
          <Button size="sm" variant="ghost" onClick={() => navigate(target.back || '/admin')}>{t('common.back', 'Back')}</Button>
        </div>
        {kind !== 'home' && target.config.studioEnabled !== true && <p className="text-xs text-[var(--muted)] mb-3">{t('pce.studio.off', 'The studio is off for this page. An administrator can turn it on.')}</p>}
        {!list.length && <div className="text-xs text-[var(--faint)] text-center py-8 rounded-xl border border-dashed border-[var(--line)]">{kind === 'home' ? t('cst.pick.emptyhome', 'The home page has no sections of its own yet. Add one under Navigation and footer, Home page.') : t('cst.pick.empty', 'No studio pages yet, add one from the page settings.')}</div>}
        <div className="space-y-2">
          {list.map((cv, i) => (
            <Link key={cv?.id || i} to={studioPath(kind, id, i)} className="flex items-center gap-2 rounded-xl border border-[var(--line)] p-3 hover:b-primary">
              <span className="flex-1 min-w-0 truncate text-sm">{cv?.title || t('pce.canvases.untitled', 'Untitled page')}</span>
              <span className="text-[11px] text-[var(--faint)] tabular-nums">{t('pce.canvases.n', '{n} block(s)').replace('{n}', (cv?.blocks || []).length)}</span>
            </Link>
          ))}
        </div>
        {index != null && !canvas && list.length > 0 && <p className="text-xs text-warning mt-3">{t('cst.pick.gone', 'There is no page at that position, pick one above.')}</p>}
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

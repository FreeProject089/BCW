// The studio as a page: /studio/:kind/:id/:page.
//
// A canvas is a page, and it wants a page's worth of room — the modal it used to open in gave
// it whatever was left of a settings column. This route owns what the modal never had to:
// WHERE the config comes from, WHERE it goes back, what happens to an edit that was never
// saved, and (phase 6) the target's other pages.
//
//   From: ALWAYS the admin route that asks what saving asks (studioLoadPath): the public
//   GET /projects/:key used to be enough to open, so a grantee of project A edited B's studio
//   and only the save said no. The Home page screen may still hand over the sections it holds
//   in memory (sessionStorage), used only once the guarded load has answered.
//
//   Which page: the URL names it by ID (phase 6), which stays right whatever happens to the
//   order. An old link by index (/studio/project/bmm/0) is resolved against the order it was
//   made for (lib/studio-page.js resolvePageRef, `studioIndexIds`) and REPLACED by the id.
//
//   Back: ONE page, by id, with the revision its draft started from (studioSavePath). The
//   server puts that page back into the config as stored NOW, so a text fix saved meanwhile
//   in the config editor, or another page saved from another tab, survives; and if this page
//   itself moved meanwhile the answer is a 409 and the author chooses, never a silent
//   overwrite.
//
//   Unsaved: every change is kept as a draft PER PAGE (sessionStorage, keyed by page id, with
//   the revision it started from), so switching page keeps each page's draft; it is restored
//   on the next open with a way to discard it, and leaving with unsaved changes asks first.
//
//   The page list (phase 6): create from a preset, duplicate, rename, reorder, hide, delete,
//   each through its own route on the config as stored now (the API locks each write). New
//   pages and copies start HIDDEN from visitors, so a preset's placeholder text never goes
//   public by itself. The preset libraries (site, this page) are read here too.
//
//   Who: the route is not the admin's role gate any more (PLAN-STUDIO-2026 phase 2). Before
//   anything is requested, the page asks lib/roles.js canUseStudio, the mirror of the
//   server's rule (manage_studio, or the `studio` right on THIS page); somebody without it
//   sees "access denied" and nothing is loaded. The server asks again on every request.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, Link, Navigate } from 'react-router-dom';
import { LayoutTemplate, ShieldCheck, AlertTriangle } from 'lucide-react';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { Button, EmptyState, Spinner, useDialog, useToast } from '../ui/ui.jsx';
import CanvasStudio from '../editor/canvas-studio.jsx';
import { PagesPanel } from '../editor/studio-pages.jsx';
import {
  parseStudioParams, handoffKey, draftKey, saveState, studioPath, studioLoadPath, studioSaveRequest,
  resolvePageRef, pageEntries, pageIndexOf, canvasById, withCanvasById, withPageInserted, withPageRemoved,
  withPageOrder, movedOrder, newPageId, studioListPaths,
} from '../lib/studio-page.js';
import { codedPresets, normalizeLibrary, storedEntry, pageFromPreset, duplicatePage, libraryPath } from '../lib/studio-components.js';
import StudioPageFrame from '../editor/studio-page-frame.jsx';
import { framedPreviewUrl, previewReasons } from '../lib/studio-preview.js';
import { canUseStudio, hasStudioCap } from '../lib/roles.js';
import { useAuth } from './auth.jsx';

const readJson = (key) => { try { const raw = sessionStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch { return null; } };
const writeJson = (key, v) => { try { sessionStorage.setItem(key, JSON.stringify(v)); } catch { /* quota, private mode */ } };
const drop = (key) => { try { sessionStorage.removeItem(key); } catch { /* nothing to clear */ } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

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

/** A project/showcase page with one field set or removed, as little changed as possible. */
function withMeta(doc, patch) {
  const next = { ...(doc || {}) };
  if ('title' in patch) next.title = String(patch.title || '').slice(0, 120);
  if ('hidden' in patch) { if (patch.hidden) next.hidden = true; else delete next.hidden; }
  return next;
}
/** The config with one page replaced as is (no merge: a removed `hidden` stays removed). */
const withPageReplaced = (config, doc) => ({ ...config, canvases: (config.canvases || []).map((c) => (c && c.id === doc.id ? doc : c)) });

export default function StudioPage() {
  const { t, lang } = useI18n();
  const params = useParams();
  const navigate = useNavigate();
  const dialog = useDialog();
  const toast = useToast();
  const { kind, id, page, bad } = parseStudioParams(params);
  const { user, loading: authLoading } = useAuth();
  // The client's half of canUseStudio: decides whether anything is REQUESTED at all. The
  // switch (D2) is not known before loading; the server answers `studio_off` for it.
  const allowed = !!user && !!user.totpEnabled && !!kind && !!id && canUseStudio(user, kind, id);

  const [target, setTarget] = useState(null);     // { config, revs, saveId, back, name }
  const [err, setErr] = useState(null);
  // Every page's unsaved state in this tab: { [pageId]: { canvas, base } }, `base` = the
  // revision the draft started from, which is what its save is checked against.
  const [drafts, setDrafts] = useState({});
  const [restored, setRestored] = useState(() => new Set());
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState(false);
  const [busy, setBusy] = useState(false);
  const [libs, setLibs] = useState({ site: null, project: null, error: false });
  // Pages deleted in this tab whose undo window is still open: out of the list, not sent yet.
  const [pendingDel, setPendingDel] = useState(() => new Set());

  // ── Load: the guarded route, then the drafts this tab kept, then the libraries ──────────
  const loadAll = useCallback(async () => {
    let tg = await loadTarget(kind, id);
    // The Home page screen hands over its unsaved sections (a section switched to Drawn and
    // not saved yet). Projects no longer hand anything over: their pages are made here.
    const hand = kind === 'home' ? readJson(handoffKey(kind, id)) : null;
    if (hand && hand.config && typeof hand.config === 'object') tg = { ...tg, config: hand.config };
    return tg;
  }, [kind, id]);

  useEffect(() => {
    if (!kind || !id || !allowed) return undefined;
    let alive = true;
    setErr(null); setTarget(null); setDrafts({}); setRestored(new Set());
    loadAll()
      .then((tg) => {
        if (!alive) return;
        setTarget(tg);
        // The drafts this tab kept, one per page, matched to the page by id.
        const kept = {};
        const back = new Set();
        for (const e of pageEntries(tg.config, kind)) {
          const key = draftKey(kind, id, e.id);
          const d = readJson(key);
          const stored = canvasById(tg.config, e.id, kind);
          if (d && d.canvas && stored && d.canvas.id === stored.id && !same(d.canvas, stored)) {
            kept[e.id] = { canvas: d.canvas, base: typeof d.base === 'string' ? d.base : (tg.revs?.[e.id] ?? '') };
            back.add(e.id);
          } else if (d) drop(key);
        }
        setDrafts(kept); setRestored(back);
      })
      .catch((e) => { if (alive) setErr(e); });
    return () => { alive = false; };
  }, [kind, id, allowed, loadAll]);

  // The preset libraries: the site's (any studio user may read it) and this page's own.
  const loadLibs = useCallback(async (tg) => {
    const get = (path) => api.get(path).then((r) => r).catch((e) => (e?.status === 403 || e?.status === 404 ? null : Promise.reject(e)));
    try {
      const site = await get(libraryPath('site'));
      const own = kind === 'home' ? null : await get(libraryPath(kind, tg.saveId));
      setLibs({ site, project: own, error: false });
    } catch { setLibs({ site: null, project: null, error: true }); }
  }, [kind]);
  useEffect(() => { if (target?.saveId) loadLibs(target); }, [target?.saveId, loadLibs]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Which page ──────────────────────────────────────────────────────────────────────────
  const ref = useMemo(() => (target ? resolvePageRef(target.config, page, kind) : { pageId: null, legacy: false }), [target, page, kind]);
  const pageId = ref.pageId && !pendingDel.has(ref.pageId) ? ref.pageId : null;
  // An old index link: replaced by the id, so the address bar, a bookmark made now and the
  // back button all name the page itself.
  useEffect(() => {
    if (target && ref.legacy && ref.pageId) navigate(studioPath(kind, id, ref.pageId), { replace: true });
  }, [target, ref, kind, id, navigate]);

  const stored = useMemo(() => (target && pageId ? canvasById(target.config, pageId, kind) : null), [target, pageId, kind]);
  const draft = pageId ? drafts[pageId] : null;
  const canvas = draft?.canvas || stored;
  const dirty = !!draft && !!stored && !same(draft.canvas, stored);
  // Which pages hold changes not saved: a draft that differs from its stored page (a draft
  // undone back to the stored page is no change).
  const dirtyIds = useMemo(() => {
    if (!target) return new Set();
    return new Set(Object.entries(drafts).filter(([pid, d]) => { const s0 = canvasById(target.config, pid, kind); return !s0 || !same(d.canvas, s0); }).map(([pid]) => pid));
  }, [drafts, target, kind]);
  const anyDirty = dirtyIds.size > 0;
  useEffect(() => { setSaveErr(false); }, [pageId]);

  // The draft: written a moment after each change, not on every keystroke, and at once when
  // the author switches page (flush), so the page left keeps what was typed last.
  const pending = useRef(null);
  const timer = useRef(null);
  const flush = useCallback(() => {
    clearTimeout(timer.current);
    if (pending.current) { writeJson(pending.current.key, pending.current.value); pending.current = null; }
  }, []);
  useEffect(() => () => flush(), [flush]);
  const onChange = useCallback((next) => {
    if (!pageId) return;
    setSaveErr(false);
    setDrafts((d) => {
      const base = d[pageId]?.base ?? (target?.revs?.[pageId] ?? '');
      pending.current = { key: draftKey(kind, id, pageId), value: { at: Date.now(), canvas: next, base } };
      return { ...d, [pageId]: { canvas: next, base } };
    });
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 300);
  }, [pageId, target, kind, id, flush]);
  const forget = useCallback((pid) => {
    if (pending.current?.key === draftKey(kind, id, pid)) { clearTimeout(timer.current); pending.current = null; }
    drop(draftKey(kind, id, pid));
    setDrafts((d) => { if (!(pid in d)) return d; const { [pid]: _gone, ...rest } = d; return rest; });
    setRestored((s) => { if (!s.has(pid)) return s; const n = new Set(s); n.delete(pid); return n; });
  }, [kind, id]);

  // Leaving the tab with unsaved changes (on any page) asks; the drafts survive either way.
  useEffect(() => {
    if (!anyDirty) return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [anyDirty]);

  // ── Save ONE page ─────────────────────────────────────────────────────────────────────────
  const save = useCallback(async () => {
    if (!target || !canvas || saving || !pageId) return;
    setSaving(true); setSaveErr(false);
    const put = (base) => { const rq = studioSaveRequest(kind, target.saveId, pageId, canvas, base); return api.put(rq.path, rq.body); };
    const landed = (rev) => {
      setTarget((tg) => ({ ...tg, config: withCanvasById(tg.config, pageId, canvas, kind), revs: { ...(tg.revs || {}), [pageId]: rev } }));
      forget(pageId);
      // The handoff described a config that is now stale; the editor will fetch the saved one.
      drop(handoffKey(kind, id));
      toast.success(t('cst.save.done', 'Page saved.'));
    };
    try {
      const r = await put(draft?.base ?? target.revs?.[pageId] ?? '');
      landed(r?.rev ?? '');
    } catch (e) {
      const code = e?.data?.error;
      if (e?.status === 409 && code === 'conflict') {
        // Somebody saved THIS page after the draft started. Nothing is overwritten without
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
          setTarget((tg) => ({ ...tg, config: kind === 'home' ? withCanvasById(tg.config, pageId, e.data.current, kind) : withPageReplaced(tg.config, { ...e.data.current, id: pageId }), revs: { ...(tg.revs || {}), [pageId]: e.data.rev ?? '' } }));
          forget(pageId);
        } else setSaveErr(true);
        return;
      }
      setSaveErr(true);
      if (code === 'invalid_studio_doc') {
        toast.error(t('cst.save.invalid', 'Refused by the server: {what} ({where}). Your changes are kept as a draft in this tab.')
          .replace('{what}', t(`cst.save.why.${e.data.reason}`, e.data.reason || '?')).replace('{where}', String(e.data.path || '').replace(/^(canvases|customSections)\[\d+\]\.(canvas\.)?/, '')));
      } else if (code === 'page_gone') toast.error(t('cst.save.gone', 'This page was deleted elsewhere since you opened it. Your changes are kept as a draft in this tab.'));
      else toast.error(code === 'forbidden' ? t('cst.save.forbidden', 'You cannot edit this page.') : t('cst.save.fail', 'The page could not be saved. Your changes are kept as a draft in this tab.'));
    } finally { setSaving(false); }
  }, [target, canvas, saving, pageId, draft, kind, id, t, toast, dialog, forget]);

  const back = useCallback(async () => {
    if (anyDirty) {
      const ok = await dialog.confirm({
        title: t('cst.leave.title', 'Unsaved changes'),
        message: t('cst.leave.msg', 'This page has changes that were not saved. They stay as a draft in this tab, and are lost when the tab closes. Leave anyway?'),
        okLabel: t('cst.leave.go', 'Leave'),
        danger: true,
      });
      if (!ok) return;
    }
    flush();
    drop(handoffKey(kind, id));
    navigate(target?.back || '/admin');
  }, [anyDirty, dialog, t, kind, id, navigate, target, flush]);

  const discardDraft = useCallback(() => { if (pageId) forget(pageId); }, [pageId, forget]);

  // ── The page list (phase 6) ────────────────────────────────────────────────────────────
  const paths = target ? studioListPaths(kind, target.saveId) : null;
  const refresh = useCallback(async () => {
    try { const tg = await loadTarget(kind, id); setTarget(tg); } catch { /* the next action says so */ }
  }, [kind, id]);
  const listError = useCallback((e) => {
    const code = e?.data?.error;
    if (code === 'too_many_pages') toast.error(t('cst.pages.err.max', 'This page already has as many studio pages as it can hold ({n}).').replace('{n}', String(e.data.max || 30)));
    else if (code === 'invalid_studio_doc') toast.error(t('cst.save.invalid', 'Refused by the server: {what} ({where}). Your changes are kept as a draft in this tab.').replace('{what}', t(`cst.save.why.${e.data.reason}`, e.data.reason || '?')).replace('{where}', String(e.data.path || '')));
    else if (e?.status === 409 || code === 'page_gone') { toast.error(t('cst.pages.err.stale', 'The pages changed elsewhere meanwhile. The list was reloaded, try again.')); refresh(); }
    else toast.error(code === 'forbidden' ? t('cst.save.forbidden', 'You cannot edit this page.') : t('cst.pages.err', 'That did not work. Nothing was changed.'));
  }, [t, toast, refresh]);

  const select = useCallback((pid) => { flush(); navigate(studioPath(kind, id, pid)); }, [flush, navigate, kind, id]);

  const addPage = useCallback(async (doc, after) => {
    if (!paths) return;
    setBusy(true);
    try {
      const r = await api.post(paths.pages, { canvas: doc, after: after || '' });
      setTarget((tg) => ({ ...tg, config: withPageInserted(tg.config, doc, after || ''), revs: { ...(tg.revs || {}), [doc.id]: r?.rev ?? '' } }));
      toast.success(t('cst.pages.made', 'Page created, hidden from visitors until you show it.'));
      select(doc.id);
    } catch (e) { listError(e); } finally { setBusy(false); }
  }, [paths, t, toast, select, listError]);

  const create = useCallback((entry) => {
    const pid = newPageId();
    const name = entry?.coded ? (lang === 'fr' && entry.nameFr ? entry.nameFr : entry.name) : (entry?.name || '');
    const title = entry?.coded === 'blank' ? '' : name;
    addPage({ ...pageFromPreset(entry, pid, title), hidden: true }, pageId || '');
  }, [addPage, lang, pageId]);

  const duplicate = useCallback((pid) => {
    const src = drafts[pid]?.canvas || canvasById(target?.config, pid, kind);
    if (!src) return;
    const title = t('cst.pages.copyof', '{title} (copy)').replace('{title}', String(src.title || t('pce.canvases.untitled', 'Untitled page')));
    addPage({ ...duplicatePage(src, newPageId(), title), hidden: true }, pid);
  }, [drafts, target, kind, t, addPage]);

  // Rename and hide are saved at once, on the stored page (and carried into its draft, if it
  // has one, so the draft's own save does not put the old title back).
  const setMeta = useCallback(async (pid, patch) => {
    if (!paths || !target) return;
    const put = (doc, base) => api.put(`${paths.pages}/${encodeURIComponent(pid)}`, { canvas: doc, base });
    const apply = (doc, oldRev, rev) => {
      setTarget((tg) => ({ ...tg, config: withPageReplaced(tg.config, doc), revs: { ...(tg.revs || {}), [pid]: rev } }));
      setDrafts((d) => {
        if (!d[pid]) return d;
        const cur = d[pid];
        const next = { canvas: withMeta(cur.canvas, patch), base: cur.base === oldRev ? rev : cur.base };
        writeJson(draftKey(kind, id, pid), { at: Date.now(), ...next });
        return { ...d, [pid]: next };
      });
    };
    setBusy(true);
    try {
      const old = canvasById(target.config, pid, kind);
      const oldRev = target.revs?.[pid] ?? '';
      const doc = withMeta(old, patch);
      try {
        const r = await put(doc, oldRev);
        apply(doc, oldRev, r?.rev ?? '');
      } catch (e) {
        // Changed elsewhere: the same field set on the version stored now, once.
        if (e?.status !== 409 || !e.data?.current) throw e;
        const doc2 = withMeta({ ...e.data.current, id: pid }, patch);
        const r2 = await put(doc2, e.data.rev ?? '');
        apply(doc2, oldRev, r2?.rev ?? '');
      }
    } catch (e) { listError(e); } finally { setBusy(false); }
  }, [paths, target, kind, id, listError]);

  const move = useCallback(async (pid, dir) => {
    if (!paths || !target) return;
    const order = movedOrder(pageEntries(target.config, kind).map((x) => x.id), pid, dir);
    setBusy(true);
    try {
      await api.put(paths.order, { order });
      setTarget((tg) => ({ ...tg, config: withPageOrder(tg.config, order) }));
    } catch (e) { listError(e); } finally { setBusy(false); }
  }, [paths, target, kind, listError]);

  // Delete, with an undo window (the house pattern, toast.action): the page leaves the list at
  // once and the DELETE is sent when the window closes; Undo puts it back and sends nothing.
  // It is sent from the revision this tab knows, so a page somebody changed meanwhile is a 409
  // and stays.
  const remove = useCallback((pid) => {
    if (!paths || !target) return;
    const ids = pageEntries(target.config, kind).map((x) => x.id).filter((x) => !pendingDel.has(x));
    const at = ids.indexOf(pid);
    const rest = ids.filter((x) => x !== pid);
    const base = target.revs?.[pid] ?? '';
    const unhide = () => setPendingDel((s) => { const n = new Set(s); n.delete(pid); return n; });
    setPendingDel((s) => new Set(s).add(pid));
    if (pid === pageId) { flush(); navigate(rest.length ? studioPath(kind, id, rest[Math.min(at, rest.length - 1)]) : studioPath(kind, id), { replace: true }); }
    toast.action({
      tone: 'info', cancelLabel: t('common.undo', 'Undo'),
      msg: t('cst.pages.deleted', 'Page deleted.'),
      onCommit: async () => {
        try {
          await api.del(`${paths.pages}/${encodeURIComponent(pid)}?base=${encodeURIComponent(base)}`);
          setTarget((tg) => ({ ...tg, config: withPageRemoved(tg.config, pid), revs: Object.fromEntries(Object.entries(tg.revs || {}).filter(([k]) => k !== pid)) }));
          forget(pid);
        } catch (e) { listError(e); }
        unhide();
      },
      onCancel: unhide,
    });
  }, [paths, target, kind, pendingDel, pageId, flush, navigate, id, toast, t, forget, listError]);

  // ── The preset libraries ─────────────────────────────────────────────────────────────────
  const saveToLibrary = useCallback(async (entry, scope) => {
    const path = scope === 'site' ? libraryPath('site') : libraryPath(kind, target?.saveId);
    const cur = scope === 'site' ? libs.site : libs.project;
    const write = (base, list) => api.put(path, { entries: [storedEntry(entry), ...list.map(storedEntry)], base });
    try {
      let r;
      try { r = await write(cur?.rev ?? '', normalizeLibrary(cur?.entries, scope)); }
      catch (e) {
        if (e?.status !== 409) throw e;
        r = await write(e.data?.rev ?? '', normalizeLibrary(e.data?.entries, scope)); // somebody added one meanwhile: kept
      }
      setLibs((l) => ({ ...l, [scope === 'site' ? 'site' : 'project']: { ...(cur || {}), entries: r.entries, rev: r.rev, canWrite: true } }));
      toast.success(t('cst.pr.saved', 'Preset saved.'));
      return true;
    } catch (e) {
      const code = e?.data?.error;
      toast.error(code === 'invalid_studio_doc'
        ? t('cst.save.invalid', 'Refused by the server: {what} ({where}). Your changes are kept as a draft in this tab.').replace('{what}', t(`cst.save.why.${e.data.reason}`, e.data.reason || '?')).replace('{where}', String(e.data.path || ''))
        : code === 'forbidden' ? t('cst.pr.forbidden', 'You cannot write to this preset library.') : t('cst.pr.savefail', 'The preset could not be saved.'));
      return false;
    }
  }, [kind, target, libs, t, toast]);

  const removeFromLibrary = useCallback(async (entry) => {
    const scope = entry.scope === 'site' ? 'site' : 'project';
    const ok = await dialog.confirm({
      title: t('cst.pr.del.title', 'Delete this preset?'),
      message: t('cst.pr.del.msg', '“{name}” leaves the library. Pages made from it keep their blocks.').replace('{name}', entry.name),
      okLabel: t('cst.pr.del.ok', 'Delete the preset'), danger: true,
    });
    if (!ok) return;
    const cur = scope === 'site' ? libs.site : libs.project;
    const path = scope === 'site' ? libraryPath('site') : libraryPath(kind, target?.saveId);
    try {
      const r = await api.put(path, { entries: normalizeLibrary(cur?.entries, scope).filter((e) => e.id !== entry.id).map(storedEntry), base: cur?.rev ?? '' });
      setLibs((l) => ({ ...l, [scope]: { ...(cur || {}), entries: r.entries, rev: r.rev } }));
    } catch (e) {
      if (e?.status === 409) { toast.error(t('cst.pr.stale', 'The library changed meanwhile. It was reloaded, try again.')); loadLibs(target); }
      else toast.error(t('cst.pr.savefail', 'The preset could not be saved.'));
    }
  }, [dialog, t, libs, kind, target, toast, loadLibs]);

  const library = useMemo(() => ({
    entries: [...codedPresets(), ...normalizeLibrary(libs.site?.entries, 'site'), ...normalizeLibrary(libs.project?.entries, 'project')],
    canWrite: { site: !!libs.site?.canWrite && hasStudioCap(user), project: !!libs.project?.canWrite },
    error: libs.error,
    save: saveToLibrary,
    remove: removeFromLibrary,
  }), [libs, user, saveToLibrary, removeFromLibrary]);

  const pagesApi = useMemo(() => {
    if (!target) return null;
    return {
      kind,
      list: pageEntries(target.config, kind).filter((e) => !pendingDel.has(e.id)).map((e) => ({ ...e, dirty: dirtyIds.has(e.id) })),
      currentId: pageId,
      canEditList: kind !== 'home',
      busy,
      select, create, duplicate, move, remove,
      rename: (pid, title) => setMeta(pid, { title }),
      setHidden: (pid, hidden) => setMeta(pid, { hidden }),
      library,
    };
  }, [target, kind, dirtyIds, pendingDel, pageId, busy, select, create, duplicate, move, remove, setMeta, library]);

  // The whole public page, with THIS canvas in its tab: the REAL route, framed at a device
  // width, fed the draft (editor/studio-page-frame.jsx, lib/studio-preview.js).
  const renderPage = useMemo(() => {
    if (!target || !pageId) return null;
    return (cv, width) => {
      const config = withCanvasById(target.config, pageId, cv, kind);
      const tab = `c-${cv?.id || ''}`;
      const title = t('cst.preview.page', 'The whole project page, with this block in place');
      if (kind === 'home') {
        // The section being drawn is shown even while it is switched off: that is what is
        // being looked at. The note above the frame says visitors do not see it yet.
        const index = pageIndexOf(target.config, pageId, kind);
        const section = (target.config.customSections || [])[index] || null;
        const sections = (config.customSections || []).map((s, i) => (i === index ? { ...s, enabled: true } : s));
        return <StudioPageFrame key={width} src={framedPreviewUrl('home')} kind="home" payload={{ config: { ...config, customSections: sections } }}
          title={title} reasons={previewReasons('home', config, cv, section)} t={t} />;
      }
      if (kind === 'project') {
        return <StudioPageFrame key={width} src={framedPreviewUrl('project', id, cv?.id)} kind="project" payload={{ key: id, config, tab }}
          title={title} reasons={previewReasons('project', config, cv)} t={t} />;
      }
      const row = target.row || { id: target.saveId, slug: target.slug || id, name: target.name, short: '', icon: null };
      return <StudioPageFrame key={width} src={framedPreviewUrl('showcase', row.slug || id, cv?.id)} kind="showcase"
        payload={{ project: { ...row, config, tagline: config.tagline || '' }, tab }}
        title={title} reasons={previewReasons('showcase', config, cv)} t={t} />;
    };
  }, [target, pageId, kind, id, t]);

  // ── The states a URL can land in ──────────────────────────────────────────
  if (!kind || !id || bad) {
    return <EmptyState icon={LayoutTemplate} title={t('cst.route.bad', 'This is not a studio address')} sub={t('cst.route.bad.h', 'Open the studio from a page’s settings in the admin.')} />;
  }
  // Who may be here, before anything is loaded. Signed out: the sign-in page. No 2FA: said so,
  // as the admin says it. No studio right on this page: access denied, and no request went out.
  if (authLoading) return <div className="flex items-center gap-2 text-[var(--muted)] py-10"><Spinner /> {t('common.loading', 'Loading…')}</div>;
  if (!user) return <Navigate to="/auth" replace />;
  if (!user.totpEnabled) {
    return (
      <EmptyState icon={ShieldCheck} title={t('admin.2fa.title', 'Two-factor authentication required')} sub={t('cst.denied.2fa', 'The studio requires 2FA on your account. Enable it in your profile to continue.')}>
        <Link to="/profile"><Button size="sm" variant="primary">{t('admin.2fa.cta', 'Go to profile')}</Button></Link>
      </EmptyState>
    );
  }
  if (!allowed) {
    return (
      <EmptyState icon={ShieldCheck} title={t('cst.denied.title', 'Access denied')}
        sub={kind === 'home' ? t('cst.denied.home', 'Drawing the home page needs the “Use the studio everywhere” permission.') : t('cst.denied.sub', 'You do not have the studio right on this page. An administrator can grant it next to the page permission.')}>
        <Link to="/"><Button size="sm" variant="ghost">{t('common.back', 'Back')}</Button></Link>
      </EmptyState>
    );
  }
  if (err) {
    // A holder of the right on a page whose studio is switched off (decision D2).
    if (err.status === 403 && err.data?.error === 'studio_off') {
      return (
        <EmptyState icon={ShieldCheck} title={t('cst.off.title', 'The studio is off for this page')}
          sub={t('pce.studio.off', 'The studio is off for this page. An administrator can turn it on.')}>
          <Link to="/"><Button size="sm" variant="ghost">{t('common.back', 'Back')}</Button></Link>
        </EmptyState>
      );
    }
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

  // No page (or one that does not exist any more): the page list, full width.
  if (!pageId || !canvas) {
    return (
      <div className="max-w-2xl mx-auto py-6" data-studio-chooser>
        <div className="flex items-center gap-2 mb-4">
          <LayoutTemplate size={18} className="text-[var(--accent-ink)]" />
          <h1 className="text-lg font-semibold flex-1 min-w-0 truncate">{t('cst.pick.title', 'Studio pages of {name}').replace('{name}', target.name || id)}</h1>
          <Button size="sm" variant="ghost" onClick={() => navigate(target.back || '/admin')}>{t('common.back', 'Back')}</Button>
        </div>
        {kind !== 'home' && target.config.studioEnabled !== true && <p className="text-xs text-[var(--muted)] mb-3">{t('pce.studio.off', 'The studio is off for this page. An administrator can turn it on.')}</p>}
        {kind === 'home' && !pageEntries(target.config, kind).length && <p className="text-xs text-[var(--faint)] text-center py-8 rounded-xl border border-dashed border-[var(--line)]">{t('cst.pick.emptyhome', 'The home page has no sections of its own yet. Add one under Navigation and footer, Home page.')}</p>}
        {page != null && <p className="text-xs text-warning mb-3" role="status">{t('cst.pick.gone2', 'There is no such page any more, pick one below.')}</p>}
        <PagesPanel t={t} lang={lang} pages={pagesApi} />
      </div>
    );
  }

  const state = saveState({ dirty, saving, error: saveErr });
  return (
    <CanvasStudio
      key={pageId}
      layout="page"
      value={canvas}
      onChange={onChange}
      renderPage={renderPage}
      pages={pagesApi}
      chrome={{
        title: canvas.title || t('pce.canvases.untitled', 'Untitled page'),
        state,
        canSave: dirty && !saving,
        onSave: save,
        onBack: back,
        draftRestored: restored.has(pageId) && dirty,
        onDiscardDraft: discardDraft,
      }}
    />
  );
}

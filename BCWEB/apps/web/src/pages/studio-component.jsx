// The studio on ONE component definition: /studio/component/:scope/:id (PLAN-STUDIO-2026 7b).
//
// The same studio as a page (editor/canvas-studio.jsx), with the component's desktop and phone
// frames, working on a library entry instead of a page:
//
//   From: GET /admin/studio/library/:scope/:ref/components/:cid, the library's own door
//   (a project or showcase library: the studio right on that page; the site's: read by any
//   studio holder, written by manage_studio). Nothing is requested before lib/roles.js says
//   this person could be let in; the server answers every request again.
//
//   Back: the entry, whole, from the revision it was opened at (409 when somebody saved it
//   meanwhile: the author chooses, nothing is overwritten silently). With it, the list of
//   fields its copies may change (`exposed`, the inspector's "What a copy can change").
//
//   The pages that use it keep THEIR copy of the definition until their studio's "Update the
//   copies" (studio-component-editor.jsx), so saving here never changes a public page by itself.
//
//   Unsaved: kept as a draft in this tab (sessionStorage), like a page's.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams, Link, Navigate } from 'react-router-dom';
import { Puzzle, ShieldCheck, AlertTriangle } from 'lucide-react';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { Button, EmptyState, Spinner, useDialog, useToast } from '../ui/ui.jsx';
import CanvasStudio from '../editor/canvas-studio.jsx';
import { parseComponentParams, componentBack, saveState } from '../lib/studio-page.js';
import { libraryPath } from '../lib/studio-components.js';
import { normalizeExposed } from '../lib/canvas.js';
import { canUseStudio, canReadSiteLibrary } from '../lib/roles.js';
import { useAuth } from './auth.jsx';

const readJson = (key) => { try { const raw = sessionStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch { return null; } };
const writeJson = (key, v) => { try { sessionStorage.setItem(key, JSON.stringify(v)); } catch { /* quota, private mode */ } };
const drop = (key) => { try { sessionStorage.removeItem(key); } catch { /* nothing to clear */ } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export default function StudioComponentPage() {
  const { t } = useI18n();
  const params = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const dialog = useDialog();
  const toast = useToast();
  const where = parseComponentParams(params);
  const { user, loading: authLoading } = useAuth();
  const allowed = !!user && !!user.totpEnabled && !!where
    && (where.scope === 'site' ? canReadSiteLibrary(user) : canUseStudio(user, where.scope, where.ref));
  const path = where ? `${libraryPath(where.scope, where.ref)}/components/${encodeURIComponent(where.cid)}` : '';
  const key = where ? `bcw_studio_cdraft:${where.scope}:${where.ref}:${where.cid}` : '';
  const backTo = componentBack(search.get('from'));

  const [stored, setStored] = useState(null);   // { entry, rev, canWrite }
  const [err, setErr] = useState(null);
  const [draft, setDraft] = useState(null);     // { doc, exposed, base }
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState(false);

  useEffect(() => {
    if (!allowed || !path) return undefined;
    let alive = true;
    setErr(null); setStored(null); setDraft(null);
    api.get(path).then((r) => {
      if (!alive) return;
      setStored(r);
      const d = readJson(key);
      if (d && d.doc && !same({ doc: d.doc, exposed: d.exposed }, { doc: r.entry.doc, exposed: r.entry.exposed || [] })) setDraft({ doc: d.doc, exposed: d.exposed || [], base: typeof d.base === 'string' ? d.base : r.rev });
      else if (d) drop(key);
    }).catch((e) => { if (alive) setErr(e); });
    return () => { alive = false; };
  }, [allowed, path, key]);

  const doc = useMemo(() => (draft?.doc || (stored ? { ...stored.entry.doc, id: stored.entry.id } : null)), [draft, stored]);
  const exposed = draft ? draft.exposed : (stored?.entry?.exposed || []);
  const dirty = !!draft && !!stored && !same({ doc: draft.doc, exposed: draft.exposed }, { doc: { ...stored.entry.doc, id: stored.entry.id }, exposed: stored.entry.exposed || [] });

  const timer = useRef(null);
  const change = useCallback((patch) => {
    setSaveErr(false);
    setDraft((d) => {
      const cur = d || { doc: { ...stored.entry.doc, id: stored.entry.id }, exposed: stored.entry.exposed || [], base: stored.rev };
      const next = { ...cur, ...patch };
      clearTimeout(timer.current);
      timer.current = setTimeout(() => writeJson(key, { at: Date.now(), ...next }), 300);
      return next;
    });
  }, [stored, key]);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const save = useCallback(async () => {
    if (!stored || !draft || saving) return;
    setSaving(true); setSaveErr(false);
    // What is sent is the definition as stored (the id is the URL's), and only the exposed
    // fields that still name a block of it with a field it has.
    const { id: _id, ...body } = draft.doc;
    const entry = { name: stored.entry.name, doc: body, exposed: normalizeExposed(draft.exposed, body.blocks) };
    const landed = (r) => {
      setStored({ entry: r.entry, rev: r.rev, canWrite: stored.canWrite });
      setDraft(null); drop(key);
      toast.success(t('cst.cmp7.mode.saved', 'Component saved. The pages that use it get it through “Update the copies”.'));
    };
    try {
      landed(await api.put(path, { entry, base: draft.base ?? stored.rev }));
    } catch (e) {
      const code = e?.data?.error;
      if (e?.status === 409 && code === 'conflict') {
        setSaving(false);
        const mine = await dialog.confirm({
          title: t('cst.conflict.title', 'Saved elsewhere meanwhile'),
          message: t('cst.cmp7.conflict', 'Somebody saved this component after you opened it. Replace their version with yours? Yours stays in this tab whatever you choose.'),
          okLabel: t('cst.conflict.mine', 'Replace with mine'), cancelLabel: t('cst.conflict.keep', 'Keep editing'), danger: true,
        });
        if (mine) {
          setSaving(true);
          try { landed(await api.put(path, { entry, base: e.data.rev ?? '' })); }
          catch { setSaveErr(true); toast.error(t('cst.cmp7.mode.fail', 'The component could not be saved. Your changes are kept in this tab.')); }
          finally { setSaving(false); }
        } else setSaveErr(true);
        return;
      }
      setSaveErr(true);
      if (code === 'invalid_studio_doc') {
        toast.error(t('cst.save.invalid', 'Refused by the server: {what} ({where}). Your changes are kept as a draft in this tab.')
          .replace('{what}', t(`cst.save.why.${e.data.reason}`, e.data.reason || '?')).replace('{where}', String(e.data.path || '')));
      } else toast.error(code === 'forbidden' ? t('cst.cmp7.mode.forbidden', 'You cannot change this component.') : t('cst.cmp7.mode.fail', 'The component could not be saved. Your changes are kept in this tab.'));
    } finally { setSaving(false); }
  }, [stored, draft, saving, path, key, dialog, toast, t]);

  const back = useCallback(async () => {
    if (dirty) {
      const ok = await dialog.confirm({
        title: t('cst.leave.title', 'Unsaved changes'),
        message: t('cst.cmp7.leave', 'This component has changes that were not saved. They stay as a draft in this tab. Leave anyway?'),
        okLabel: t('cst.leave.go', 'Leave'), danger: true,
      });
      if (!ok) return;
    }
    navigate(backTo);
  }, [dirty, dialog, t, navigate, backTo]);

  const componentMode = useMemo(() => ({ exposed, onExposed: (next) => change({ exposed: next }) }), [exposed, change]);

  if (!where) {
    return <EmptyState icon={Puzzle} title={t('cst.route.bad', 'This is not a studio address')} sub={t('cst.route.bad.h', 'Open the studio from a page’s settings in the admin.')} />;
  }
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
      <EmptyState icon={ShieldCheck} title={t('cst.denied.title', 'Access denied')} sub={t('cst.cmp7.denied', 'You cannot open this component library. The studio right on its page (or on any page, for the site library) is needed.')}>
        <Link to="/"><Button size="sm" variant="ghost">{t('common.back', 'Back')}</Button></Link>
      </EmptyState>
    );
  }
  if (err) {
    const forbidden = err.status === 403 || err.status === 401;
    return (
      <EmptyState icon={forbidden ? ShieldCheck : AlertTriangle}
        title={forbidden ? t('proj.notAvailable', 'Not available') : t('cst.cmp7.gone', 'No such component')}
        sub={forbidden ? t('proj.noAccess', "You don't have access to this page.") : t('cst.cmp7.gone.h', 'It is not in this library (any more).')}>
        <Button size="sm" variant="ghost" onClick={() => navigate(backTo)}>{t('common.back', 'Back')}</Button>
      </EmptyState>
    );
  }
  if (!stored || !doc) return <div className="flex items-center gap-2 text-[var(--muted)] py-10"><Spinner /> {t('common.loading', 'Loading…')}</div>;

  return (
    <CanvasStudio
      key={where.cid}
      layout="page"
      value={doc}
      onChange={(next) => change({ doc: { ...next, id: stored.entry.id } })}
      componentMode={componentMode}
      chrome={{
        title: `${t('cst.cmp7.mode', 'Component')} · ${stored.entry.name}${stored.canWrite ? '' : ` (${t('cst.cmp7.mode.ro', 'read only')})`}`,
        state: saveState({ dirty, saving, error: saveErr }),
        canSave: dirty && !saving && !!stored.canWrite,
        onSave: save,
        onBack: back,
        draftRestored: false,
        onDiscardDraft: () => { setDraft(null); drop(key); },
      }}
    />
  );
}

// The studio's page list and its preset gallery (PLAN-STUDIO-2026 phase 6).
//
// Two dock panels, drawn by editor/canvas-studio.jsx; everything they DO is handed in by the
// page (pages/studio.jsx), which owns the requests, the per-page drafts and the URL:
//
//   Pages     the pages of the target, in order: open one (its URL names it by id), rename,
//             move up / down, duplicate, hide from visitors, delete (after a confirmation), and
//             "New page" from a page preset. The page being edited is marked, and a page with
//             unsaved changes in this tab says so. The home page's sections are listed (open
//             only): they are made and ordered on the Home page screen.
//   Presets   the gallery: page, section, background and component presets from the coded,
//             site and page libraries, each with a real thumbnail (ui/canvas-thumb.jsx, never a
//             live 3D scene), and "Save as preset" into a library the author may write.
//
// Keyboard: every control is a real button with an accessible name; renaming is an input that
// Enter commits and Escape abandons; the gallery's sorts are a tablist with arrow keys.
import { useMemo, useRef, useState } from 'react';
import {
  FileText, Plus, ChevronUp, ChevronDown, Copy, Eye, EyeOff, Trash2, Pencil, Check, X, LayoutTemplate, Save, Download,
} from 'lucide-react';
import { Button, Field, Input, Select, Modal } from '../ui/ui.jsx';
import CanvasThumb from '../ui/canvas-thumb.jsx';
import { PRESET_SORTS } from '../lib/studio-components.js';
// Phase 7c: export a page or a preset, import a studio file (editor/studio-io.js).
import { ImportButton } from './studio-io-panel.jsx';

/** Literal keys (i18n-check reads literals only). */
function sortName(t, sort) {
  switch (sort) {
    case 'page': return t('cst.pr.sort.page', 'Pages');
    case 'section': return t('cst.pr.sort.section', 'Sections');
    case 'background': return t('cst.pr.sort.background', 'Backgrounds');
    case 'component': return t('cst.pr.sort.component', 'Components');
    default: return sort;
  }
}
function scopeName(t, scope) {
  switch (scope) {
    case 'coded': return t('cst.pr.scope.coded', 'Built in');
    case 'site': return t('cst.pr.scope.site', 'Site');
    case 'project': return t('cst.pr.scope.project', 'This page');
    default: return scope;
  }
}

/**
 * @param {object} props.pages  from pages/studio.jsx: { kind, list: [{ id, title, hidden,
 *   blocks, dirty }], currentId, canEditList, busy, select(id), rename(id, title),
 *   move(id, dir), duplicate(id), setHidden(id, bool), remove(id), create(entry) , library }
 */
export function PagesPanel({ t, lang, pages, onImport = null, onExport = null }) {
  const [editing, setEditing] = useState(null);   // { id, value }
  const [newOpen, setNewOpen] = useState(false);
  if (!pages) {
    return <p className="text-[11px] text-[var(--muted)]">{t('cst.pages.none', 'This page is edited on its own: open it from a project to see its other pages.')}</p>;
  }
  const { list, currentId, canEditList, busy } = pages;
  const commit = () => {
    if (!editing) return;
    const v = editing.value.trim();
    const was = list.find((x) => x.id === editing.id)?.title || '';
    setEditing(null);
    if (v !== was) pages.rename(editing.id, v);
  };
  return (
    <div className="space-y-2" data-studio-pages data-tour="pages">
      {!canEditList && <p className="text-[11px] text-[var(--muted)]">{t('cst.pages.home', 'The home page’s sections are added, ordered and switched on or off on the Home page screen. Open one here to draw it.')}</p>}
      {!list.length && (
        <div className="text-center py-6 px-3 rounded-xl border border-dashed border-[var(--line)]">
          <div className="text-[13px] font-semibold">{t('cst.pages.empty', 'No pages yet')}</div>
          <div className="text-xs text-[var(--muted)] mt-1">{t('cst.pages.empty.s', 'Start one from a preset with “New page”.')}</div>
        </div>
      )}
      <ol className="space-y-1" aria-label={t('cst.pages', 'Pages')}>
        {list.map((pg, i) => {
          const cur = pg.id === currentId;
          const label = pg.title || t('pce.canvases.untitled', 'Untitled page');
          return (
            <li key={pg.id} data-page-row={pg.id} aria-current={cur ? 'page' : undefined}
              className={`rounded-lg border p-1.5 ${cur ? 'border-[var(--accent-ink)] bg-[var(--surface-2)]' : 'border-[var(--line)]'}`}>
              {editing?.id === pg.id ? (
                <div className="flex items-center gap-1">
                  <Input autoFocus className="flex-1 min-w-0" value={editing.value} maxLength={120}
                    aria-label={t('cst.pages.title', 'Page title')}
                    onChange={(e) => setEditing({ id: pg.id, value: e.target.value })}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setEditing(null); } }} />
                  <Button size="sm" variant="ghost" className="!px-1.5" onClick={commit} aria-label={t('cst.pages.rename.ok', 'Keep this title')} title={t('cst.pages.rename.ok', 'Keep this title')}><Check size={13} /></Button>
                  <Button size="sm" variant="ghost" className="!px-1.5" onClick={() => setEditing(null)} aria-label={t('common.cancel', 'Cancel')} title={t('common.cancel', 'Cancel')}><X size={13} /></Button>
                </div>
              ) : (
                <div className="flex items-center gap-1">
                  <button type="button" className="flex-1 min-w-0 flex items-center gap-1.5 text-left rounded px-1 py-0.5 hover:bg-[var(--surface-2)]"
                    onClick={() => !cur && pages.select(pg.id)} data-page-open={pg.id} aria-current={cur ? 'page' : undefined}
                    title={cur ? t('cst.pages.current', 'The page you are editing') : t('cst.pages.open', 'Open this page')}>
                    <FileText size={13} className="shrink-0 text-[var(--muted)]" aria-hidden />
                    <span className="truncate text-xs font-medium" title={label}>{label}</span>
                    {pg.hidden && <EyeOff size={12} className="shrink-0 text-[var(--muted)]" aria-label={t('cst.pages.hidden', 'Hidden from visitors')} />}
                    {pg.dirty && <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-warning" role="img" aria-label={t('cst.pages.dirty', 'Unsaved changes in this tab')} title={t('cst.pages.dirty', 'Unsaved changes in this tab')} data-page-dirty />}
                    <span className="ml-auto shrink-0 text-[10px] text-[var(--faint)] tabular-nums">{pg.blocks}</span>
                  </button>
                  {canEditList && (
                    <>
                      <Button size="sm" variant="ghost" className="!px-1.5" disabled={busy} onClick={() => setEditing({ id: pg.id, value: pg.title })}
                        aria-label={t('cst.pages.rename', 'Rename {page}').replace('{page}', label)} title={t('cst.pages.rename', 'Rename {page}').replace('{page}', label)} data-page-act="rename"><Pencil size={12} /></Button>
                      <Button size="sm" variant="ghost" className="!px-1.5" disabled={busy || i === 0} onClick={() => pages.move(pg.id, -1)}
                        aria-label={t('cst.pages.up', 'Move {page} up').replace('{page}', label)} title={t('cst.pages.up', 'Move {page} up').replace('{page}', label)} data-page-act="up"><ChevronUp size={12} /></Button>
                      <Button size="sm" variant="ghost" className="!px-1.5" disabled={busy || i === list.length - 1} onClick={() => pages.move(pg.id, 1)}
                        aria-label={t('cst.pages.down', 'Move {page} down').replace('{page}', label)} title={t('cst.pages.down', 'Move {page} down').replace('{page}', label)} data-page-act="down"><ChevronDown size={12} /></Button>
                    </>
                  )}
                </div>
              )}
              {(canEditList || onExport) && editing?.id !== pg.id && (
                <div className="flex items-center gap-1 mt-1 pl-5 flex-wrap">
                  {onExport && (
                    <Button size="sm" variant="ghost" className="!px-1.5 !py-0.5 text-[11px]" onClick={() => onExport(pg.id)}
                      aria-label={t('cst.io.export.page', 'Export {page} as a file').replace('{page}', label)} title={t('cst.io.export.page', 'Export {page} as a file').replace('{page}', label)} data-page-act="export"><Download size={12} /> {t('cst.io.export.s', 'Export')}</Button>
                  )}
                  {canEditList && (<>
                  <Button size="sm" variant="ghost" className="!px-1.5 !py-0.5 text-[11px]" disabled={busy} onClick={() => pages.duplicate(pg.id)}
                    aria-label={t('cst.pages.dup', 'Duplicate {page}').replace('{page}', label)} data-page-act="duplicate"><Copy size={12} /> {t('cst.pages.dup.s', 'Duplicate')}</Button>
                  <Button size="sm" variant="ghost" className="!px-1.5 !py-0.5 text-[11px]" disabled={busy} onClick={() => pages.setHidden(pg.id, !pg.hidden)}
                    aria-pressed={pg.hidden} aria-label={(pg.hidden ? t('cst.pages.show', 'Show {page} to visitors') : t('cst.pages.hide', 'Hide {page} from visitors')).replace('{page}', label)} data-page-act="hide">
                    {pg.hidden ? <Eye size={12} /> : <EyeOff size={12} />} {pg.hidden ? t('cst.pages.show.s', 'Show') : t('cst.pages.hide.s', 'Hide')}
                  </Button>
                  <Button size="sm" variant="ghost" className="!px-1.5 !py-0.5 text-[11px] !text-[var(--error)]" disabled={busy} onClick={() => pages.remove(pg.id)}
                    aria-label={t('cst.pages.del', 'Delete {page}').replace('{page}', label)} data-page-act="delete"><Trash2 size={12} /> {t('cst.pages.del.s', 'Delete')}</Button>
                  </>)}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {canEditList && (
        <Button size="sm" variant="primary" className="w-full justify-center" disabled={busy} onClick={() => setNewOpen(true)} data-page-new>
          <Plus size={14} /> {t('cst.pages.new', 'New page')}
        </Button>
      )}
      <ImportButton t={t} onImport={onImport} label={canEditList ? t('cst.io.import.page', 'Import a page from a file') : ''} />
      {newOpen && (
        <Modal open onClose={() => setNewOpen(false)} title={t('cst.pages.new.title', 'Start a page from…')} icon={LayoutTemplate} width="max-w-3xl">
          <PresetGallery t={t} lang={lang} entries={(pages.library?.entries || []).filter((e) => e.sort === 'page')} sorts={['page']}
            onUse={(entry) => { setNewOpen(false); pages.create(entry); }} />
        </Modal>
      )}
    </div>
  );
}

/**
 * The gallery: tabs per sort, a filter per scope, a card per preset with its thumbnail.
 * `onUse(entry)`; `onDelete(entry)` for an entry of a library the author may write.
 */
export function PresetGallery({ t, lang, entries, sorts = PRESET_SORTS, onUse, onDelete = null, canDelete = () => false, onExport = null }) {
  const [sort, setSort] = useState(sorts[0]);
  const [scope, setScope] = useState('all');
  const tabs = useRef([]);
  const shown = useMemo(() => (entries || []).filter((e) => e.sort === sort && (scope === 'all' || e.scope === scope)), [entries, sort, scope]);
  const scopes = ['all', ...['coded', 'site', 'project'].filter((s) => (entries || []).some((e) => e.sort === sort && e.scope === s))];
  const onTabKey = (e, i) => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const j = (i + d + sorts.length) % sorts.length;
    setSort(sorts[j]); setScope('all');
    tabs.current[j]?.focus();
  };
  return (
    <div className="space-y-2" data-preset-gallery>
      {sorts.length > 1 && (
        <div role="tablist" aria-label={t('cst.pr.sorts', 'Kind of preset')} className="flex flex-wrap gap-1">
          {sorts.map((s, i) => (
            <button key={s} ref={(el) => { tabs.current[i] = el; }} type="button" role="tab" aria-selected={s === sort} tabIndex={s === sort ? 0 : -1}
              onKeyDown={(e) => onTabKey(e, i)} onClick={() => { setSort(s); setScope('all'); }}
              className={`px-2 py-1 rounded-md text-[11px] border ${s === sort ? 'border-[var(--accent-ink)] font-semibold' : 'border-[var(--line)] text-[var(--muted)]'}`}>
              {sortName(t, s)}
            </button>
          ))}
        </div>
      )}
      {scopes.length > 2 && (
        <div className="flex flex-wrap gap-1" role="group" aria-label={t('cst.pr.scopes', 'Where the presets come from')}>
          {scopes.map((s) => (
            <button key={s} type="button" aria-pressed={s === scope} onClick={() => setScope(s)}
              className={`px-2 py-0.5 rounded-full text-[10px] border ${s === scope ? 'border-[var(--accent-ink)]' : 'border-[var(--line)] text-[var(--muted)]'}`}>
              {s === 'all' ? t('cst.pr.scope.all', 'All') : scopeName(t, s)}
            </button>
          ))}
        </div>
      )}
      {!shown.length && <p className="text-[11px] text-[var(--muted)] py-4 text-center">{t('cst.pr.empty', 'No preset of this kind yet. Use “Save as preset” to keep one.')}</p>}
      <ul className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
        {shown.map((e) => {
          const name = lang === 'fr' && e.nameFr ? e.nameFr : e.name;
          return (
            <li key={`${e.scope}:${e.id}`} className="rounded-lg border border-[var(--line)] p-1.5 flex flex-col gap-1 min-w-0" data-preset={e.id} data-preset-scope={e.scope}>
              <div className="rounded-md overflow-hidden bg-[var(--surface-2)] border border-[var(--line)]" style={{ height: 96 }}>
                <CanvasThumb doc={e.doc} width={150} maxHeight={960} />
              </div>
              <div className="flex items-center gap-1 min-w-0">
                <span className="text-xs font-medium truncate flex-1 min-w-0" title={name}>{name}</span>
                <span className="text-[9px] uppercase tracking-wider text-[var(--faint)] shrink-0">{scopeName(t, e.scope)}</span>
              </div>
              <div className="flex items-center gap-1">
                <Button size="sm" variant="ghost" className="flex-1 justify-center !py-0.5 text-[11px]" onClick={() => onUse(e)}
                  aria-label={t('cst.pr.use', 'Use {name}').replace('{name}', name)} data-preset-use>{t('cst.pr.use.s', 'Use')}</Button>
                {onExport && (
                  <Button size="sm" variant="ghost" className="!px-1.5 !py-0.5" onClick={() => onExport(e)} data-preset-export
                    aria-label={t('cst.io.export.preset', 'Export the preset {name} as a file').replace('{name}', name)} title={t('cst.io.export.preset', 'Export the preset {name} as a file').replace('{name}', name)}><Download size={12} /></Button>
                )}
                {onDelete && canDelete(e) && (
                  <Button size="sm" variant="ghost" className="!px-1.5 !py-0.5 !text-[var(--error)]" onClick={() => onDelete(e)}
                    aria-label={t('cst.pr.delete', 'Delete the preset {name}').replace('{name}', name)} title={t('cst.pr.delete', 'Delete the preset {name}').replace('{name}', name)}><Trash2 size={12} /></Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * The Presets dock panel: the whole gallery, applied to the page being edited, and "Save as
 * preset" into a library the author may write (the page's own, and the site's with
 * manage_studio; the server checks both again).
 */
export function PresetsPanel({ t, lang, library, onApply, onSaveAs, canSection, canComponent, sorts = PRESET_SORTS, onImport = null, onExport = null }) {
  const [saveOpen, setSaveOpen] = useState(false);
  if (!library) return <p className="text-[11px] text-[var(--muted)]">{t('cst.pages.none', 'This page is edited on its own: open it from a project to see its other pages.')}</p>;
  const scopes = [library.canWrite?.project && 'project', library.canWrite?.site && 'site'].filter(Boolean);
  return (
    <div className="space-y-2" data-tour="presets">
      {library.error && <p className="text-[11px] text-warning" role="status">{t('cst.pr.loadfail', 'The shared presets could not be loaded; the built-in ones are shown.')}</p>}
      <PresetGallery t={t} lang={lang} entries={library.entries} onUse={onApply} sorts={sorts} onExport={onExport}
        onDelete={(e) => library.remove(e)} canDelete={(e) => (e.scope === 'site' && library.canWrite?.site) || (e.scope === 'project' && library.canWrite?.project)} />
      <Button size="sm" variant="ghost" className="w-full justify-center" disabled={!scopes.length} onClick={() => setSaveOpen(true)} data-preset-save
        title={scopes.length ? undefined : t('cst.pr.save.no', 'You cannot write to a preset library here.')}>
        <Save size={13} /> {t('cst.pr.save', 'Save as preset')}
      </Button>
      {scopes.length > 0 && <ImportButton t={t} onImport={onImport} label={t('cst.io.import.preset', 'Import a preset from a file')} />}
      {saveOpen && (
        <SavePresetModal t={t} scopes={scopes} canSection={canSection} canComponent={canComponent}
          onClose={() => setSaveOpen(false)} onSave={async (name, sort, scope) => { const ok = await onSaveAs(name, sort, scope); if (ok) setSaveOpen(false); }} />
      )}
    </div>
  );
}

function SavePresetModal({ t, scopes, canSection, canComponent, onSave, onClose }) {
  const [name, setName] = useState('');
  const [sort, setSort] = useState('page');
  const [scope, setScope] = useState(scopes[0]);
  const [busy, setBusy] = useState(false);
  const sortOk = sort === 'section' ? canSection : sort === 'component' ? canComponent : true;
  const go = async () => {
    if (!name.trim() || !sortOk || busy) return;
    setBusy(true);
    try { await onSave(name.trim(), sort, scope); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={t('cst.pr.save', 'Save as preset')} icon={Save}
      footer={<><Button variant="ghost" onClick={onClose}>{t('common.cancel', 'Cancel')}</Button><Button variant="primary" loading={busy} disabled={!name.trim() || !sortOk} onClick={go} data-preset-save-ok>{t('common.save', 'Save')}</Button></>}>
      <div className="space-y-2">
        <Field label={t('cst.cmp.name', 'Name')}>
          <Input autoFocus value={name} maxLength={60} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') go(); }} />
        </Field>
        <Field label={t('cst.pr.save.sort', 'What to keep')}>
          <Select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="page">{t('cst.pr.save.page', 'This whole page')}</option>
            <option value="section">{t('cst.pr.save.section', 'The selected blocks, as a section')}</option>
            <option value="component">{t('cst.pr.save.component', 'The selected blocks, as a component')}</option>
            <option value="background">{t('cst.pr.save.background', 'This page’s background')}</option>
          </Select>
        </Field>
        {!sortOk && <p className="text-[11px] text-warning" role="status">{t('cst.pr.save.nosel', 'Select blocks on the board first.')}</p>}
        <Field label={t('cst.pr.save.scope', 'Library')}>
          <Select value={scope} onChange={(e) => setScope(e.target.value)}>
            {scopes.map((s) => <option key={s} value={s}>{s === 'site' ? t('cst.pr.save.site', 'The site (every studio user sees it)') : t('cst.pr.save.project', 'This page (its studio holders see it)')}</option>)}
          </Select>
        </Field>
      </div>
    </Modal>
  );
}

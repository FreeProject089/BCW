// A project's catalogues, configured from the project's own admin page (G4).
//
// Mounted in admin.jsx's project editor for the project in the rail, official or other. The
// server decides who may read and save (canEditProject / canEditShowcase behind the 2FA wall);
// this screen only reflects it: a 403 on load hides the panel instead of showing a form whose
// Save would be refused.
//
// A draft is edited locally and written by one Save, like the page config above it. Removing
// a catalogue, a tag, a field or an entry takes it out of the draft at once with an Undo window
// (the house rule for every removal), and nothing reaches the server until Save.
import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, FileJson, LayoutGrid, Plus, Save, Trash2, Upload, Boxes } from 'lucide-react';
import { Button, Card, Badge, Field, Input, Textarea, Select, Spinner, useToast } from '../ui/ui.jsx';
import { useI18n } from '../i18n.jsx';
import { api } from '../lib/api.js';
import IconPicker from '../editor/icon-picker.jsx';
import { IconGlyph } from '../ui/md.jsx';
import { TagPicker, TAG_KEY } from '../ui/catalog-pickers.jsx';
import { kindLabel } from './pages.jsx';

const slugify = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
const fieldKey = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^[^a-z]+|_+$/g, '').slice(0, 32);
const uniqueId = (base, taken) => { let id = base || 'catalogue'; let n = 2; while (taken.has(id)) id = `${base}-${n++}`; return id; };
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
const dropMarks = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith('_')));
/**
 * The draft as the server's STRICT schema wants it. Switching a catalogue's format or source
 * leaves the other shape's keys behind in the draft (so switching back loses nothing), and
 * `_new` marks a tag or field whose key still follows its label; neither may be sent.
 */
function forSave(d) {
  return {
    enabled: d.enabled !== false,
    tags: (d.tags || []).map((x) => pick(dropMarks(x), ['key', 'label', 'labelFr', 'icon'])),
    catalogs: (d.catalogs || []).map((c) => {
      const base = pick(c, ['id', 'name', 'description', 'icon', 'format']);
      if (c.format === 'custom') return { ...base, fields: c.fields.map((f) => pick(dropMarks(f), ['key', 'label', 'labelFr', 'type', 'card', 'required'])), entries: c.entries || [] };
      return { ...base, ...pick(c, ['source', 'kind']), ...(c.source === 'community' ? pick(c, ['communitySlug']) : {}), ...(c.source === 'inline' ? pick(c, ['feed']) : {}) };
    }),
  };
}

function IconButton({ icon, onPick, label }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} title={label} aria-label={label}
        className="grid place-items-center w-10 h-10 rounded-lg border border-[var(--line-strong)] bg-[var(--surface-2)] text-[var(--accent-ink)] shrink-0 hover:border-[var(--ring)]">
        {icon ? <IconGlyph name={icon} size={18} /> : <LayoutGrid size={18} className="text-[var(--faint)]" />}
      </button>
      {open && <IconPicker title={label} onPick={(n) => { onPick(n); setOpen(false); }} onClose={() => setOpen(false)} />}
    </>
  );
}

// What the server's refusals mean, in words. `path` points at the field (catalogs.0.entries.3.link).
function errorText(t, e) {
  const code = e?.error;
  const where = e?.path ? ` (${e.path})` : '';
  const map = {
    invalid_value_url: t('apc.err.url', 'A link or a picture is not an http(s) address.'),
    invalid_value_unknown_tag: t('apc.err.tag', 'An entry uses a tag that is not in the list.'),
    required_value: t('apc.err.required', 'A required value is empty.'),
    duplicate_catalog_id: t('apc.err.dupid', 'Two catalogues have the same identifier.'),
    duplicate_field: t('apc.err.dupfield', 'Two fields have the same key.'),
    duplicate_tag: t('apc.err.duptag', 'Two tags have the same key.'),
    tag_is_builtin: t('apc.err.builtin', 'That tag already exists in the built-in list.'),
    feed_missing_array: t('apc.err.feed', 'The catalog.json has no list for this type.'),
    feed_too_many: t('apc.err.feedmany', 'The catalog.json holds too many entries (500 at most).'),
    inline_kind_unsupported: t('apc.err.kind', 'An uploaded catalog.json can hold apps, plugins, themes or presets.'),
    community_slug_required: t('apc.err.nocc', 'Choose the community catalogue to link.'),
    community_not_found: t('apc.err.ccgone', 'That community catalogue does not exist or is suspended.'),
    community_not_linkable: t('apc.err.ccpriv', 'That community catalogue is private and not yours.'),
    official_source_needs_official_project: t('apc.err.official', 'Only an official project has official items.'),
    url_blocked: t('apc.err.blocked', 'A link was taken down after a rights notice and cannot be listed.'),
    config_too_large: t('apc.err.big', 'Too much content in one project (600 KB at most).'),
    forbidden: t('apc.err.forbidden', 'You cannot edit this project.'),
  };
  return (map[code] || t('apc.err.generic', 'Not saved: the content was refused.')) + where;
}

/** One value input of a custom entry, by field type. */
function ValueInput({ f, v, onChange, vocab }) {
  if (f.type === 'longtext') return <Textarea rows={3} value={v || ''} onChange={(e) => onChange(e.target.value)} />;
  if (f.type === 'tags') return <TagPicker value={Array.isArray(v) ? v : []} onChange={onChange} tags={vocab} allowCustom={false} />;
  if (f.type === 'number') return <Input type="number" plain value={v ?? ''} onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))} />;
  if (f.type === 'date') return <Input type="date" value={v || ''} onChange={(e) => onChange(e.target.value)} />;
  if (f.type === 'url' || f.type === 'image') return <Input type="url" inputMode="url" placeholder="https://" value={v || ''} onChange={(e) => onChange(e.target.value)} />;
  return <Input value={v || ''} onChange={(e) => onChange(e.target.value)} maxLength={f.type === 'version' ? 24 : 300} />;
}

export default function ProjectCatalogsPanel({ scope, refKey }) {
  const { t, lang } = useI18n(); const toast = useToast();
  const [meta, setMeta] = useState(null);      // editor meta from the server, null while loading
  const [denied, setDenied] = useState(false);
  const [draft, setDraft] = useState(null);
  const [saved, setSaved] = useState('');
  const [open, setOpen] = useState(false);
  const [openCat, setOpenCat] = useState(null);
  const [openEntry, setOpenEntry] = useState(null);
  const [busy, setBusy] = useState(false);
  const base = `/admin/project-catalogs/${scope}/${encodeURIComponent(refKey || '')}`;

  useEffect(() => {
    if (!refKey) return;
    setMeta(null); setDenied(false); setDraft(null); setOpenCat(null); setOpenEntry(null);
    api.get(base).then((r) => { setMeta(r); setDraft(r.config); setSaved(JSON.stringify(r.config)); })
      .catch(() => setDenied(true));
  }, [base]); // eslint-disable-line react-hooks/exhaustive-deps

  const vocab = useMemo(() => [...(meta?.builtinTags || []), ...(draft?.tags || [])], [meta, draft]);
  if (denied || !refKey) return null;
  if (!meta || !draft) return <Card className="p-4 mb-4 flex items-center gap-2 text-sm text-[var(--muted)]"><Spinner /> {t('apc.loading', 'Loading the catalogues…')}</Card>;
  const dirty = JSON.stringify(draft) !== saved;
  const cats = draft.catalogs || [];
  const setCats = (fn) => setDraft((d) => ({ ...d, catalogs: fn(d.catalogs || []) }));
  const patchCat = (i, p) => setCats((cs) => cs.map((c, j) => (j === i ? { ...c, ...p } : c)));
  // Removal with an undo window: out of the draft now, back in on Undo.
  const removeWithUndo = (msg, apply) => {
    const before = draft;
    setDraft(apply(draft));
    toast.action({ tone: 'success', duration: 6000, cancelLabel: t('common.undo', 'Undo'), msg, onCommit: () => {}, onCancel: () => setDraft(before) });
  };

  const addCatalog = (format) => {
    const id = uniqueId(format === 'custom' ? 'liste' : 'catalogue', new Set(cats.map((c) => c.id)));
    const c = format === 'custom'
      ? { id, name: t('apc.new.custom', 'New list'), description: '', format: 'custom', fields: [{ key: 'title', label: t('apc.f.title', 'Title'), type: 'text', card: true, required: true }, { key: 'link', label: t('apc.f.link', 'Link'), type: 'url', card: true, required: false }], entries: [] }
      : { id, name: t('apc.new.bmm', 'New catalogue'), description: '', format: 'bmm', source: meta.isOfficial ? 'official' : 'inline', kind: meta.isOfficial ? 'APP' : 'PLUGIN' };
    setCats((cs) => [...cs, c]); setOpenCat(cats.length); setOpen(true);
  };

  const readFeed = async (i, file, kind) => {
    if (!file) return;
    try {
      const j = JSON.parse(await file.text());
      const field = meta.inlineFields[kind];
      if (!Array.isArray(j?.[field])) { toast.error(t('apc.err.feed', 'The catalog.json has no list for this type.')); return; }
      patchCat(i, { feed: j });
      toast.success(t('apc.feed.read', '{n} entries read.').replace('{n}', j[field].length));
    } catch { toast.error(t('apc.feed.bad', 'That file is not valid JSON.')); }
  };
  const importEntries = async (i, file) => {
    if (!file) return;
    try {
      const j = JSON.parse(await file.text());
      const arr = Array.isArray(j) ? j : Array.isArray(j?.entries) ? j.entries : null;
      if (!arr) { toast.error(t('apc.import.bad', 'Expected a JSON array of entries, or an object with "entries".')); return; }
      patchCat(i, { entries: [...(cats[i].entries || []), ...arr.filter((x) => x && typeof x === 'object')].slice(0, meta.limits.entries) });
      toast.success(t('apc.import.ok', '{n} entries added. Save to check them.').replace('{n}', arr.length));
    } catch { toast.error(t('apc.feed.bad', 'That file is not valid JSON.')); }
  };

  const save = async () => {
    setBusy(true);
    try {
      const r = await api.put(base, { config: forSave(draft) });
      setDraft(r.config); setSaved(JSON.stringify(r.config));
      toast.success(t('apc.saved', 'Catalogues saved.'));
    } catch (x) { toast.error(errorText(t, x.data)); }
    finally { setBusy(false); }
  };

  const fmtName = (c) => (c.format === 'custom' ? t('apc.fmt.custom', 'Custom format') : `catalog.json · ${kindLabel(c.kind, scope === 'project' ? refKey : 'bmm')}`);
  const sources = [
    ...(meta.isOfficial ? [['official', t('apc.src.official', 'Official items of this project')]] : []),
    ['inline', t('apc.src.inline', 'A catalog.json I upload')],
    ['community', t('apc.src.community', 'A hosted community catalogue')],
  ];
  const publicHref = scope === 'project' ? `/catalog?project=${encodeURIComponent(refKey)}` : null;

  return (
    <Card className="mb-4 overflow-hidden">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="w-full flex items-center gap-2.5 px-4 py-3 text-start">
        <Boxes size={16} className="text-[var(--accent-ink)] shrink-0" />
        <span className="font-semibold text-sm flex-1 min-w-0">{t('apc.title', 'Catalogues of this project')}</span>
        <Badge tone="">{cats.length}</Badge>
        {dirty && <Badge tone="amber">{t('apc.unsaved', 'Not saved')}</Badge>}
        <ChevronDown size={15} className={`text-[var(--muted)] transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-4 border-t border-[var(--line)] pt-3">
          <p className="text-xs text-[var(--muted)]">{t('apc.desc', 'Each catalogue shows on the Catalogue page under this project. Either the established catalog.json format (read by BMM), or a custom format: you declare the fields and fill the entries, shown as cards.')}</p>
          <label className="flex items-center gap-2 text-sm cursor-pointer w-fit">
            <input type="checkbox" checked={draft.enabled !== false} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} className="accent-[var(--primary)]" />
            {t('apc.enabled', 'Show these catalogues publicly')}
          </label>

          {/* ── The project's own tags ── */}
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-1.5">{t('apc.tags', 'Tags of this project')}</div>
            <p className="text-xs text-[var(--muted)] mb-2">{t('apc.tags.d', 'Added to the built-in tags in the tag dropdowns of this project.')} <span className="inline-flex flex-wrap gap-1 align-middle">{(meta.builtinTags || []).slice(0, 6).map((x) => <span key={x.key} className="inline-flex items-center gap-1 text-[11px]"><IconGlyph name={x.icon} size={11} /> {lang.startsWith('fr') ? x.labelFr || x.label : x.label}</span>)}…</span></p>
            <div className="space-y-2">
              {(draft.tags || []).map((tg, i) => (
                <div key={i} className="flex items-center gap-2 flex-wrap">
                  <IconButton icon={tg.icon} label={t('apc.tag.icon', 'Tag icon')} onPick={(n) => setDraft((d) => ({ ...d, tags: d.tags.map((x, j) => (j === i ? { ...x, icon: n } : x)) }))} />
                  <Input className="!w-36" value={tg.label} placeholder={t('apc.tag.label', 'Label (English)')} aria-label={t('apc.tag.label', 'Label (English)')}
                    onChange={(e) => { const label = e.target.value; setDraft((d) => ({ ...d, tags: d.tags.map((x, j) => (j === i ? { ...x, label, key: x._new ? slugify(label).slice(0, 24) : x.key } : x)) })); }} />
                  <Input className="!w-36" value={tg.labelFr || ''} placeholder={t('apc.tag.labelFr', 'Label (French)')} aria-label={t('apc.tag.labelFr', 'Label (French)')}
                    onChange={(e) => setDraft((d) => ({ ...d, tags: d.tags.map((x, j) => (j === i ? { ...x, labelFr: e.target.value } : x)) }))} />
                  <code className={`text-xs ${TAG_KEY.test(tg.key) ? 'text-[var(--faint)]' : 'text-error'}`}>{tg.key || '?'}</code>
                  <button type="button" className="text-[var(--faint)] hover:text-error p-1" aria-label={t('apc.tag.del', 'Remove this tag')} title={t('apc.tag.del', 'Remove this tag')}
                    onClick={() => removeWithUndo(t('apc.tag.deleted', 'Tag removed.'), (d) => ({ ...d, tags: d.tags.filter((_, j) => j !== i) }))}><Trash2 size={14} /></button>
                </div>
              ))}
              {(draft.tags || []).length < meta.limits.tags && (
                <Button size="sm" variant="ghost" onClick={() => setDraft((d) => ({ ...d, tags: [...(d.tags || []), { key: '', label: '', icon: 'hash', _new: true }] }))}><Plus size={13} /> {t('apc.tag.add', 'Add a tag')}</Button>
              )}
            </div>
          </div>

          {/* ── The catalogues ── */}
          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)]">{t('apc.cats', 'Catalogues')}</div>
            {cats.map((c, i) => (
              <div key={i} className="rounded-xl border border-[var(--line)]">
                <div className="flex items-center gap-2.5 px-3 py-2.5">
                  <button type="button" onClick={() => setOpenCat(openCat === i ? null : i)} aria-expanded={openCat === i} className="flex items-center gap-2.5 flex-1 min-w-0 text-start">
                    <span className="grid place-items-center w-8 h-8 rounded-lg bg-[var(--surface-2)] text-[var(--accent-ink)] shrink-0">{c.icon ? <IconGlyph name={c.icon} size={16} /> : <LayoutGrid size={16} />}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium truncate" title={c.name}>{c.name}</span>
                      <span className="block text-[11px] text-[var(--faint)] truncate" title={fmtName(c)}>{fmtName(c)}</span>
                    </span>
                    <ChevronDown size={14} className={`text-[var(--muted)] shrink-0 transition-transform ${openCat === i ? 'rotate-180' : ''}`} />
                  </button>
                  <button type="button" className="text-[var(--faint)] hover:text-error p-1" aria-label={t('apc.cat.del', 'Remove this catalogue')} title={t('apc.cat.del', 'Remove this catalogue')}
                    onClick={() => { setOpenCat(null); removeWithUndo(t('apc.cat.deleted', 'Catalogue removed. Save to apply.'), (d) => ({ ...d, catalogs: d.catalogs.filter((_, j) => j !== i) })); }}><Trash2 size={15} /></button>
                </div>
                {openCat === i && (
                  <div className="px-3 pb-3 space-y-3 border-t border-[var(--line)] pt-3">
                    <div className="flex items-start gap-2">
                      <IconButton icon={c.icon} label={t('apc.cat.icon', 'Catalogue icon')} onPick={(n) => patchCat(i, { icon: n })} />
                      <div className="grid sm:grid-cols-2 gap-2 flex-1 min-w-0">
                        <Field label={t('apc.cat.name', 'Name')}><Input value={c.name} maxLength={80} onChange={(e) => patchCat(i, { name: e.target.value })} /></Field>
                        <Field label={t('apc.cat.id', 'Identifier (in the address)')}><Input value={c.id} maxLength={40} onChange={(e) => patchCat(i, { id: slugify(e.target.value) })} /></Field>
                      </div>
                    </div>
                    <Field label={t('apc.cat.desc', 'Description')}><Textarea rows={2} maxLength={500} value={c.description || ''} onChange={(e) => patchCat(i, { description: e.target.value })} /></Field>
                    <Field label={t('apc.cat.format', 'Format')}>
                      <Select value={c.format} onChange={(e) => patchCat(i, e.target.value === 'custom'
                        ? { format: 'custom', fields: c.fields || [{ key: 'title', label: t('apc.f.title', 'Title'), type: 'text', card: true, required: true }], entries: c.entries || [] }
                        : { format: 'bmm', source: c.source || (meta.isOfficial ? 'official' : 'inline'), kind: c.kind || 'PLUGIN' })}>
                        <option value="bmm">{t('apc.fmt.bmm', 'Established format (catalog.json, read by BMM)')}</option>
                        <option value="custom">{t('apc.fmt.custom.l', 'Custom format (my own fields)')}</option>
                      </Select>
                    </Field>

                    {c.format === 'bmm' && (<>
                      <div className="grid sm:grid-cols-2 gap-2">
                        <Field label={t('apc.src', 'Source')}>
                          <Select value={c.source} onChange={(e) => patchCat(i, { source: e.target.value, ...(e.target.value === 'inline' && !meta.inlineKinds.includes(c.kind) ? { kind: 'PLUGIN' } : {}) })}>
                            {sources.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                          </Select>
                        </Field>
                        {c.source !== 'community' && (
                          <Field label={t('apc.kind', 'Type')}>
                            <Select value={c.kind} onChange={(e) => patchCat(i, { kind: e.target.value, ...(c.source === 'inline' ? { feed: undefined } : {}) })}>
                              {(c.source === 'inline' ? meta.inlineKinds : meta.kinds).map((k) => <option key={k} value={k}>{kindLabel(k, scope === 'project' ? refKey : 'bmm')}</option>)}
                            </Select>
                          </Field>
                        )}
                      </div>
                      {c.source === 'official' && <p className="text-xs text-[var(--muted)]">{t('apc.src.official.d', 'Shows the items people submitted to this project for this type, once reviewed. The submission form offers this type for this project.')}</p>}
                      {c.source === 'inline' && (
                        <Field label={t('apc.feed', 'The catalog.json file')} hint={t('apc.feed.h', 'The BMM-native feed (apps, plugins, themes or presets). Only the list of the chosen type is kept.')}>
                          <label className="flex items-center gap-2 cursor-pointer text-sm">
                            <span className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--line-strong)] px-3 py-2 hover:border-[var(--ring)]"><Upload size={14} /> {t('apc.feed.pick', 'Choose a file')}</span>
                            <input type="file" accept=".json,application/json" className="sr-only" onChange={(e) => { readFeed(i, e.target.files?.[0], c.kind); e.target.value = ''; }} />
                            {c.feed && <span className="text-xs text-success flex items-center gap-1"><FileJson size={12} /> {t('apc.feed.n', '{n} entries').replace('{n}', (c.feed[meta.inlineFields[c.kind]] || []).length)}</span>}
                          </label>
                        </Field>
                      )}
                      {c.source === 'community' && (
                        <Field label={t('apc.cc', 'Community catalogue')} hint={t('apc.cc.h', 'One of yours, or any public listed one (its address, the part after /c/).')}>
                          <div className="flex gap-2 flex-wrap">
                            {meta.myCatalogs.length > 0 && (
                              <Select className="!w-auto" value={meta.myCatalogs.some((m) => m.slug === c.communitySlug) ? c.communitySlug : ''} onChange={(e) => e.target.value && patchCat(i, { communitySlug: e.target.value })}>
                                <option value="">{t('apc.cc.mine', 'My catalogues…')}</option>
                                {meta.myCatalogs.map((m) => <option key={m.slug} value={m.slug}>{m.name}</option>)}
                              </Select>
                            )}
                            <Input className="flex-1 min-w-[10rem]" value={c.communitySlug || ''} placeholder="mon-catalogue" onChange={(e) => patchCat(i, { communitySlug: slugify(e.target.value).slice(0, 120) })} aria-label={t('apc.cc', 'Community catalogue')} />
                          </div>
                        </Field>
                      )}
                    </>)}

                    {c.format === 'custom' && (<>
                      <div>
                        <div className="text-xs font-semibold text-[var(--faint)] mb-1.5">{t('apc.fields', 'Fields')}</div>
                        <div className="space-y-1.5">
                          {c.fields.map((f, fi) => (
                            <div key={fi} className="flex items-center gap-1.5 flex-wrap rounded-lg bg-[var(--surface-2)] p-2">
                              <Input className="!w-32" value={f.label} placeholder={t('apc.f.label', 'Label')} aria-label={t('apc.f.label', 'Label')}
                                onChange={(e) => { const label = e.target.value; patchCat(i, { fields: c.fields.map((x, j) => (j === fi ? { ...x, label, key: x._new ? (fieldKey(label) || x.key) : x.key } : x)) }); }} />
                              <Input className="!w-32" value={f.labelFr || ''} placeholder={t('apc.tag.labelFr', 'Label (French)')} aria-label={t('apc.tag.labelFr', 'Label (French)')}
                                onChange={(e) => patchCat(i, { fields: c.fields.map((x, j) => (j === fi ? { ...x, labelFr: e.target.value } : x)) })} />
                              <Select className="!w-auto" value={f.type} aria-label={t('apc.f.type', 'Type')} onChange={(e) => patchCat(i, { fields: c.fields.map((x, j) => (j === fi ? { ...x, type: e.target.value } : x)) })}>
                                <option value="text">{t('apc.t.text', 'Short text')}</option>
                                <option value="longtext">{t('apc.t.longtext', 'Long text')}</option>
                                <option value="url">{t('apc.t.url', 'Link')}</option>
                                <option value="image">{t('apc.t.image', 'Picture (address)')}</option>
                                <option value="number">{t('apc.t.number', 'Number')}</option>
                                <option value="date">{t('apc.t.date', 'Date')}</option>
                                <option value="version">{t('apc.t.version', 'Version')}</option>
                                <option value="tags">{t('apc.t.tags', 'Tags')}</option>
                              </Select>
                              <code className="text-[11px] text-[var(--faint)]">{f.key}</code>
                              <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={f.card !== false} onChange={(e) => patchCat(i, { fields: c.fields.map((x, j) => (j === fi ? { ...x, card: e.target.checked } : x)) })} /> {t('apc.f.card', 'On the card')}</label>
                              <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={!!f.required} onChange={(e) => patchCat(i, { fields: c.fields.map((x, j) => (j === fi ? { ...x, required: e.target.checked } : x)) })} /> {t('apc.f.req', 'Required')}</label>
                              {c.fields.length > 1 && <button type="button" className="text-[var(--faint)] hover:text-error p-1 ms-auto" aria-label={t('apc.f.del', 'Remove this field')} title={t('apc.f.del', 'Remove this field')}
                                onClick={() => removeWithUndo(t('apc.f.deleted', 'Field removed.'), (d) => ({ ...d, catalogs: d.catalogs.map((x, j) => (j === i ? { ...x, fields: x.fields.filter((_, k) => k !== fi) } : x)) }))}><Trash2 size={13} /></button>}
                            </div>
                          ))}
                          {c.fields.length < meta.limits.fields && (
                            <Button size="sm" variant="ghost" onClick={() => patchCat(i, { fields: [...c.fields, { key: `field_${c.fields.length + 1}`, label: '', type: 'text', card: true, required: false, _new: true }] })}><Plus size={13} /> {t('apc.f.add', 'Add a field')}</Button>
                          )}
                        </div>
                      </div>
                      <div>
                        <div className="flex items-center gap-2 mb-1.5">
                          <div className="text-xs font-semibold text-[var(--faint)] flex-1">{t('apc.entries', 'Entries')} ({(c.entries || []).length}/{meta.limits.entries})</div>
                          <label className="text-xs text-[var(--accent-ink)] cursor-pointer inline-flex items-center gap-1"><Upload size={12} /> {t('apc.import', 'Import JSON')}
                            <input type="file" accept=".json,application/json" className="sr-only" onChange={(e) => { importEntries(i, e.target.files?.[0]); e.target.value = ''; }} /></label>
                        </div>
                        <div className="space-y-1.5">
                          {(c.entries || []).map((en, ei) => {
                            const titleField = c.fields.find((f) => f.type === 'text');
                            const label = (titleField && en[titleField.key]) || t('pcat.untitled', 'Untitled');
                            const isOpen = openEntry === `${i}:${ei}`;
                            return (
                              <div key={en.id || ei} className="rounded-lg border border-[var(--line)]">
                                <div className="flex items-center gap-2 px-2.5 py-1.5">
                                  <button type="button" onClick={() => setOpenEntry(isOpen ? null : `${i}:${ei}`)} aria-expanded={isOpen} className="flex-1 min-w-0 text-start text-sm truncate" title={String(label)}>{String(label)}</button>
                                  <button type="button" className="text-[var(--faint)] hover:text-error p-1" aria-label={t('apc.e.del', 'Remove this entry')} title={t('apc.e.del', 'Remove this entry')}
                                    onClick={() => { setOpenEntry(null); removeWithUndo(t('apc.e.deleted', 'Entry removed.'), (d) => ({ ...d, catalogs: d.catalogs.map((x, j) => (j === i ? { ...x, entries: x.entries.filter((_, k) => k !== ei) } : x)) })); }}><Trash2 size={13} /></button>
                                </div>
                                {isOpen && (
                                  <div className="px-2.5 pb-2.5 grid sm:grid-cols-2 gap-2">
                                    {c.fields.map((f) => (
                                      <div key={f.key} className={f.type === 'longtext' || f.type === 'tags' ? 'sm:col-span-2' : ''}>
                                        <Field label={`${(lang.startsWith('fr') && f.labelFr) || f.label || f.key}${f.required ? ' *' : ''}`}>
                                          <ValueInput f={f} v={en[f.key]} vocab={vocab} onChange={(v) => patchCat(i, { entries: c.entries.map((x, k) => (k === ei ? { ...x, [f.key]: v } : x)) })} />
                                        </Field>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                          {(c.entries || []).length < meta.limits.entries && (
                            <Button size="sm" variant="ghost" onClick={() => { patchCat(i, { entries: [...(c.entries || []), {}] }); setOpenEntry(`${i}:${(c.entries || []).length}`); }}><Plus size={13} /> {t('apc.e.add', 'Add an entry')}</Button>
                          )}
                        </div>
                      </div>
                    </>)}
                  </div>
                )}
              </div>
            ))}
            {cats.length < meta.limits.catalogs && (
              <div className="flex gap-2 flex-wrap">
                <Button size="sm" onClick={() => addCatalog('bmm')}><Plus size={13} /> {t('apc.add.bmm', 'catalog.json catalogue')}</Button>
                <Button size="sm" onClick={() => addCatalog('custom')}><Plus size={13} /> {t('apc.add.custom', 'Custom-format list')}</Button>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 pt-2 border-t border-[var(--line)] flex-wrap">
            {publicHref && <a href={publicHref} target="_blank" rel="noreferrer" className="text-xs text-[var(--accent-ink)] hover:underline">{t('apc.view', 'See on the Catalogue page')}</a>}
            <div className="flex-1" />
            {dirty && <Button size="sm" variant="ghost" onClick={() => setDraft(JSON.parse(saved))}>{t('apc.reset', 'Discard changes')}</Button>}
            <Button size="sm" variant="primary" disabled={!dirty || busy} onClick={save}>{busy ? <Spinner /> : <><Save size={14} /> {t('apc.save', 'Save the catalogues')}</>}</Button>
          </div>
        </div>
      )}
    </Card>
  );
}

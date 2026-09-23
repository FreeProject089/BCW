// The catalogue's pickers (G4): tags as a dropdown with icons, and the project selector.
//
// Both draw their icons through the markdown kit's IconGlyph, the same registry the icon
// picker and the blog use, so a tag's icon and a project's logo are one system with the rest
// of the site. Both popups are portals on --bg-solid (a translucent menu renders its text over
// whatever card is behind it) and both are keyboard-driven: arrows move, Enter picks, Escape
// closes and gives focus back to the button that opened it.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Plus, Search, Tag, X, LayoutGrid } from 'lucide-react';
import { IconGlyph, ShowcaseIcon, appIconKeys } from './md.jsx';
import { useI18n } from '../i18n.jsx';
import { api } from '../lib/api.js';

/** A tag's label in the reader's language. Tags come from the API with `label` + `labelFr`. */
export const tagText = (tag, lang) => (String(lang || '').startsWith('fr') && tag?.labelFr) || tag?.label || tag?.key || '';

/** The same shape a tag key must have server-side (lib/project-catalogs.mjs TAG_KEY). */
export const TAG_KEY = /^[a-z0-9][a-z0-9-]{0,23}$/;
const toKey = (s) => String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);

/** A popup anchored under a button, following it on scroll like ui.jsx's Dropdown does. */
function usePopover() {
  const btnRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const place = useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return null;
    const w = Math.min(Math.max(r.width, 260), window.innerWidth - 16);
    const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
    // Open upward when the room under the button is short and there is more above: on a phone
    // a filter bar halfway down the screen left the list running off the bottom edge.
    const below = window.innerHeight - r.bottom - 14;
    const above = r.top - 14;
    const up = below < 260 && above > below;
    const maxH = Math.max(160, Math.min(up ? above : below, 460));
    return { ...(up ? { bottom: window.innerHeight - r.top + 6 } : { top: r.bottom + 6 }), left, width: w, maxH, btm: r.bottom, top0: r.top };
  }, []);
  const show = () => { const at = place(); if (at) setPos(at); setOpen(true); };
  const hide = (refocus = true) => { setOpen(false); if (refocus) btnRef.current?.focus?.(); };
  useEffect(() => {
    if (!open) return undefined;
    const follow = () => {
      const at = place();
      if (!at || at.btm < 0 || at.top0 > window.innerHeight) { setOpen(false); return; }
      setPos(at);
    };
    window.addEventListener('scroll', follow, true);
    window.addEventListener('resize', follow);
    return () => { window.removeEventListener('scroll', follow, true); window.removeEventListener('resize', follow); };
  }, [open, place]);
  return { btnRef, open, pos, show, hide };
}

/** Arrow / Home / End / Enter / Escape over a filtered list, with the active row scrolled into view. */
function useListKeys(count, onPick, onClose) {
  const [active, setActive] = useState(0);
  const listRef = useRef(null);
  useEffect(() => { if (active >= count) setActive(Math.max(0, count - 1)); }, [count, active]);
  useEffect(() => { listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView?.({ block: 'nearest' }); }, [active]);
  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => (count ? (i + 1) % count : 0)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (count ? (i - 1 + count) % count : 0)); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
    else if (e.key === 'End') { e.preventDefault(); setActive(Math.max(0, count - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (count) onPick(active); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  };
  return { active, setActive, listRef, onKeyDown };
}

function Popup({ pos, onClose, children, label }) {
  return createPortal(<>
    <div className="fixed inset-0 z-[70]" onClick={() => onClose(false)} />
    <div role="dialog" aria-label={label} className="fixed z-[71] rounded-xl border border-[var(--line-strong)] shadow-lg anim-pop overflow-hidden flex flex-col"
      style={{ top: pos.top, bottom: pos.bottom, left: pos.left, width: pos.width, maxHeight: pos.maxH, background: 'var(--bg-solid)' }}>
      {children}
    </div>
  </>, document.body);
}

function SearchBox({ value, onChange, onKeyDown, placeholder, ariaControls, activeId }) {
  return (
    <div className="relative border-b border-[var(--line)] shrink-0">
      <Search size={14} className="absolute start-3 top-1/2 -translate-y-1/2 text-[var(--faint)] pointer-events-none" />
      <input autoFocus value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={onKeyDown} placeholder={placeholder}
        role="combobox" aria-expanded="true" aria-controls={ariaControls} aria-activedescendant={activeId}
        className="w-full bg-transparent border-0 outline-none ps-9 pe-3 py-2.5 text-sm" />
    </div>
  );
}

/**
 * Several tags, picked from the project's vocabulary (built-in + its own), each with its icon.
 *
 * `tags` is the vocabulary; `value` the chosen keys. A key already on an item but absent from
 * the vocabulary (items written before tags had one) stays, drawn with a plain tag icon, so
 * editing an old item never silently drops its tags. `allowCustom` offers "Add x" for a word
 * the list does not have; the server still decides whether it is accepted.
 */
export function TagPicker({ value = [], onChange, tags = [], max = 12, allowCustom = true, id }) {
  const { t, lang } = useI18n();
  const pop = usePopover();
  const [q, setQ] = useState('');
  const byKey = useMemo(() => Object.fromEntries(tags.map((x) => [x.key, x])), [tags]);
  const chosen = new Set(value);
  const needle = q.trim().toLowerCase();
  const matches = tags.filter((x) => !needle || x.key.includes(needle) || tagText(x, lang).toLowerCase().includes(needle));
  const custom = allowCustom && needle && !byKey[toKey(needle)] && TAG_KEY.test(toKey(needle)) ? toKey(needle) : null;
  const rows = [...matches.map((x) => ({ key: x.key, tag: x })), ...(custom ? [{ key: custom, custom: true }] : [])];
  const toggle = (k) => {
    if (chosen.has(k)) onChange(value.filter((x) => x !== k));
    else if (value.length < max) onChange([...value, k]);
  };
  const close = (refocus = true) => { setQ(''); pop.hide(refocus); };
  const keys = useListKeys(rows.length, (i) => { toggle(rows[i].key); if (rows[i].custom) setQ(''); }, () => close());
  const full = value.length >= max;
  const listId = `${id || 'tagpick'}-list`;
  return (
    <div className="flex flex-wrap items-center gap-1.5 min-h-[40px] rounded-lg border border-[var(--line-strong)] bg-[var(--surface-2)] px-2 py-1.5">
      {value.map((k) => { const x = byKey[k]; const label = x ? tagText(x, lang) : k; return (
        <span key={k} className="inline-flex items-center gap-1 rounded-md bg-[var(--bg-solid)] border border-[var(--line)] ps-1.5 pe-0.5 py-0.5 text-xs max-w-full">
          {x ? <IconGlyph name={x.icon} size={12} className="text-[var(--accent-ink)] shrink-0" /> : <Tag size={12} className="text-[var(--faint)] shrink-0" />}
          <span className="truncate" title={label}>{label}</span>
          <button type="button" onClick={() => toggle(k)} className="grid place-items-center w-5 h-5 rounded text-[var(--faint)] hover:text-error shrink-0"
            aria-label={t('tagp.remove', 'Remove the tag {t}').replace('{t}', label)}><X size={12} /></button>
        </span>
      ); })}
      <button ref={pop.btnRef} id={id} type="button" disabled={full && !pop.open} onClick={() => (pop.open ? close() : pop.show())}
        aria-haspopup="dialog" aria-expanded={pop.open}
        onKeyDown={(e) => { if (!pop.open && e.key === 'ArrowDown') { e.preventDefault(); pop.show(); } }}
        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-50 disabled:cursor-not-allowed">
        <Plus size={13} /> {value.length ? t('tagp.more', 'Add a tag') : t('tagp.pick', 'Choose tags')}
        <ChevronDown size={12} className={`transition-transform ${pop.open ? 'rotate-180' : ''}`} />
      </button>
      {full && <span className="text-[11px] text-[var(--faint)]">{t('tagp.max', 'Maximum {n} tags').replace('{n}', max)}</span>}
      {pop.open && pop.pos && (
        <Popup pos={pop.pos} onClose={close} label={t('tagp.pick', 'Choose tags')}>
          <SearchBox value={q} onChange={(v) => { setQ(v); keys.setActive(0); }} onKeyDown={keys.onKeyDown} placeholder={t('tagp.search', 'Search a tag…')}
            ariaControls={listId} activeId={rows.length ? `${listId}-${keys.active}` : undefined} />
          <div ref={keys.listRef} id={listId} role="listbox" aria-multiselectable="true" className="flex-1 min-h-0 overflow-auto scroll-thin p-1">
            {rows.map((r, i) => { const on = chosen.has(r.key); const label = r.tag ? tagText(r.tag, lang) : r.key; return (
              <div key={r.key} id={`${listId}-${i}`} data-idx={i} role="option" aria-selected={on}
                onMouseEnter={() => keys.setActive(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => { toggle(r.key); if (r.custom) setQ(''); }}
                className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm cursor-pointer ${i === keys.active ? 'bg-[var(--surface-2)] text-[var(--text)]' : 'text-[var(--muted)]'}`}>
                {r.custom ? <Plus size={15} className="text-[var(--accent-ink)] shrink-0" /> : <IconGlyph name={r.tag.icon} size={15} className="text-[var(--accent-ink)] shrink-0" />}
                <span className="flex-1 min-w-0 truncate" title={label}>{r.custom ? t('tagp.add', 'Add “{t}”').replace('{t}', r.key) : label}</span>
                {on && <Check size={14} className="text-[var(--accent-ink)] shrink-0" />}
              </div>
            ); })}
            {!rows.length && <div className="px-3 py-3 text-xs text-[var(--faint)]">{t('tagp.none', 'No tag matches.')}</div>}
          </div>
        </Popup>
      )}
    </div>
  );
}

/** One tag or none, for a filter bar. Same vocabulary and icons as TagPicker. */
export function TagFilter({ value = '', onChange, tags = [] }) {
  const { t, lang } = useI18n();
  const pop = usePopover();
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const rows = [{ key: '', all: true }, ...tags.filter((x) => !needle || x.key.includes(needle) || tagText(x, lang).toLowerCase().includes(needle)).map((x) => ({ key: x.key, tag: x }))];
  const cur = tags.find((x) => x.key === value);
  const close = (refocus = true) => { setQ(''); pop.hide(refocus); };
  const pick = (k) => { close(); if (k !== value) onChange(k); };
  const keys = useListKeys(rows.length, (i) => pick(rows[i].key), () => close());
  const listId = 'tagfilter-list';
  return (
    <>
      <button ref={pop.btnRef} type="button" onClick={() => (pop.open ? close() : pop.show())} aria-haspopup="dialog" aria-expanded={pop.open}
        onKeyDown={(e) => { if (!pop.open && e.key === 'ArrowDown') { e.preventDefault(); pop.show(); } }}
        aria-label={t('tagp.filter', 'Filter by tag')}
        className="press-sm inline-flex items-center justify-between gap-2 rounded-lg border border-[var(--line-strong)] bg-[var(--surface-2)] px-3 py-2 min-h-[24px] max-lg:min-h-[44px] text-sm font-medium hover:border-[var(--ring)] transition-colors max-w-full">
        <span className="flex items-center gap-1.5 min-w-0">
          {cur ? <IconGlyph name={cur.icon} size={14} className="text-[var(--accent-ink)] shrink-0" /> : <Tag size={14} className="text-[var(--muted)] shrink-0" />}
          <span className="truncate" title={cur ? tagText(cur, lang) : t('tagp.all', 'All tags')}>{cur ? tagText(cur, lang) : (value || t('tagp.all', 'All tags'))}</span>
        </span>
        <ChevronDown size={14} className={`text-[var(--muted)] shrink-0 transition-transform ${pop.open ? 'rotate-180' : ''}`} />
      </button>
      {pop.open && pop.pos && (
        <Popup pos={pop.pos} onClose={close} label={t('tagp.filter', 'Filter by tag')}>
          <SearchBox value={q} onChange={(v) => { setQ(v); keys.setActive(0); }} onKeyDown={keys.onKeyDown} placeholder={t('tagp.search', 'Search a tag…')}
            ariaControls={listId} activeId={`${listId}-${keys.active}`} />
          <div ref={keys.listRef} id={listId} role="listbox" className="flex-1 min-h-0 overflow-auto scroll-thin p-1">
            {rows.map((r, i) => { const label = r.all ? t('tagp.all', 'All tags') : tagText(r.tag, lang); return (
              <div key={r.key || '_all'} id={`${listId}-${i}`} data-idx={i} role="option" aria-selected={r.key === value}
                onMouseEnter={() => keys.setActive(i)} onClick={() => pick(r.key)}
                className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm cursor-pointer ${i === keys.active ? 'bg-[var(--surface-2)] text-[var(--text)]' : 'text-[var(--muted)]'}`}>
                {r.all ? <Tag size={15} className="text-[var(--muted)] shrink-0" /> : <IconGlyph name={r.tag.icon} size={15} className="text-[var(--accent-ink)] shrink-0" />}
                <span className="flex-1 min-w-0 truncate" title={label}>{label}</span>
                {r.key === value && <Check size={14} className="text-[var(--accent-ink)] shrink-0" />}
              </div>
            ); })}
          </div>
        </Popup>
      )}
    </>
  );
}

// The official projects' logos are the kit's `app:` marks. `community` is the site itself.
const APP_MARK = { community: 'bc' };
/** A project's logo: its app mark, its own icon (an image or an icon name), or its initial. */
export function ProjectLogo({ project, size = 20 }) {
  const known = new Set([...appIconKeys(), 'installer']);
  const mark = project?.official ? (APP_MARK[project.ref] || project.ref) : null;
  const initial = (
    <span className="grid place-items-center rounded-md bg-[var(--surface-2)] border border-[var(--line)] text-[var(--muted)] font-semibold shrink-0"
      style={{ width: size + 2, height: size + 2, fontSize: Math.max(10, Math.round(size * 0.5)) }} aria-hidden>
      {String(project?.name || '?').trim().charAt(0).toUpperCase()}
    </span>
  );
  if (!project) return <span className="grid place-items-center shrink-0 text-[var(--accent-ink)]" style={{ width: size + 2, height: size + 2 }}><LayoutGrid size={size - 2} /></span>;
  if (mark && known.has(mark)) return <IconGlyph name={`app:${mark}`} size={size} className="shrink-0" />;
  if (project.icon) return <span className="grid place-items-center shrink-0" style={{ width: size + 2, height: size + 2 }}><ShowcaseIcon icon={project.icon} size={size} rounded={5} fallback={initial} /></span>;
  return initial;
}

/**
 * The project selector of the catalogue: a searchable list with each project's logo, official
 * projects first, then the other projects that carry a catalogue.
 *
 * `projects` is /project-catalogs' list; `value` is the selected project's `${scope}:${ref}`
 * id, '' for every project. The two groups are headed, so a reader knows whether what they
 * are about to browse is published by BetterCommunity or by a project hosted here.
 */
export const projectId = (pr) => (pr ? `${pr.scope}:${pr.ref}` : '');
export function ProjectPicker({ value = '', onChange, projects = [], allowAll = true }) {
  const { t } = useI18n();
  const pop = usePopover();
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const hit = (pr) => !needle || pr.name.toLowerCase().includes(needle) || pr.ref.toLowerCase().includes(needle);
  const official = projects.filter((pr) => pr.official && hit(pr));
  const others = projects.filter((pr) => !pr.official && hit(pr));
  const rows = [...(!needle && allowAll ? [null] : []), ...official, ...others];
  const cur = projects.find((pr) => projectId(pr) === value) || null;
  const close = (refocus = true) => { setQ(''); pop.hide(refocus); };
  const pick = (pr) => { close(); if (projectId(pr) !== value) onChange(pr); };
  const keys = useListKeys(rows.length, (i) => pick(rows[i]), () => close());
  const listId = 'projpick-list';
  const meta = (pr) => {
    const n = (pr.catalogs || []).length;
    const parts = [];
    if (pr.official && pr.items) parts.push(t('projp.items', '{n} item(s)').replace('{n}', pr.items));
    if (n) parts.push(t('projp.cats', '{n} catalogue(s)').replace('{n}', n));
    return parts.join(' · ');
  };
  const row = (pr, i) => {
    const on = projectId(pr) === value;
    const name = pr ? pr.name : t('cat.allprojects2', 'All projects');
    const sub = pr ? meta(pr) : t('projp.all.d', 'Every official catalogue');
    return (
      <div key={projectId(pr) || '_all'} id={`${listId}-${i}`} data-idx={i} role="option" aria-selected={on}
        onMouseEnter={() => keys.setActive(i)} onClick={() => pick(pr)}
        className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 cursor-pointer ${i === keys.active ? 'bg-[var(--surface-2)]' : ''}`}>
        <ProjectLogo project={pr} size={22} />
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-medium text-[var(--text)] truncate" title={name}>{name}</span>
          {sub && <span className="block text-[11px] text-[var(--faint)] truncate" title={sub}>{sub}</span>}
        </span>
        {on && <Check size={14} className="text-[var(--accent-ink)] shrink-0" />}
      </div>
    );
  };
  let idx = 0;
  return (
    <>
      <button ref={pop.btnRef} type="button" onClick={() => (pop.open ? close() : pop.show())} aria-haspopup="dialog" aria-expanded={pop.open}
        onKeyDown={(e) => { if (!pop.open && e.key === 'ArrowDown') { e.preventDefault(); pop.show(); } }}
        aria-label={t('projp.label', 'Project')}
        className="press-sm inline-flex items-center gap-2.5 rounded-xl border border-[var(--line-strong)] bg-[var(--surface-2)] ps-2 pe-3 py-1.5 min-h-[40px] max-lg:min-h-[44px] hover:border-[var(--ring)] transition-colors max-w-full">
        <ProjectLogo project={cur} size={22} />
        <span className="min-w-0 text-start">
          <span className="block text-[10px] uppercase tracking-wider text-[var(--faint)] leading-tight">{t('projp.label', 'Project')}</span>
          <span className="block text-sm font-semibold truncate leading-tight" title={cur ? cur.name : t('cat.allprojects2', 'All projects')}>{cur ? cur.name : t('cat.allprojects2', 'All projects')}</span>
        </span>
        <ChevronDown size={14} className={`text-[var(--muted)] shrink-0 transition-transform ${pop.open ? 'rotate-180' : ''}`} />
      </button>
      {pop.open && pop.pos && (
        <Popup pos={pop.pos} onClose={close} label={t('projp.label', 'Project')}>
          <SearchBox value={q} onChange={(v) => { setQ(v); keys.setActive(0); }} onKeyDown={keys.onKeyDown} placeholder={t('projp.search', 'Search a project…')}
            ariaControls={listId} activeId={rows.length ? `${listId}-${keys.active}` : undefined} />
          <div ref={keys.listRef} id={listId} role="listbox" className="flex-1 min-h-0 overflow-auto scroll-thin p-1">
            {!needle && allowAll && row(null, idx++)}
            {official.length > 0 && <div className="px-2.5 pt-2 pb-1 text-[10px] uppercase tracking-wider text-[var(--faint)]" role="presentation">{t('projp.official', 'Official projects')}</div>}
            {official.map((pr) => row(pr, idx++))}
            {others.length > 0 && <div className="px-2.5 pt-2 pb-1 text-[10px] uppercase tracking-wider text-[var(--faint)]" role="presentation">{t('projp.others', 'Other projects')}</div>}
            {others.map((pr) => row(pr, idx++))}
            {!rows.length && <div className="px-3 py-3 text-xs text-[var(--faint)]">{t('projp.none', 'No project matches.')}</div>}
          </div>
        </Popup>
      )}
    </>
  );
}

/**
 * TagPicker with the built-in vocabulary fetched for you, for forms that edit an item and
 * have no project vocabulary at hand (the dashboard's item editor). Tags already on the item
 * that the vocabulary does not know stay, drawn with a plain tag icon.
 */
export function ItemTagPicker({ value = [], onChange, id }) {
  const [vocab, setVocab] = useState([]);
  useEffect(() => {
    let live = true;
    api.get('/project-catalogs').then((r) => { if (live) setVocab(r?.builtinTags || []); }).catch(() => {});
    return () => { live = false; };
  }, []);
  return <TagPicker id={id} value={value} onChange={onChange} tags={vocab} />;
}

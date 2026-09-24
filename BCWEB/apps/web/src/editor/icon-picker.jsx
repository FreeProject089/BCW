import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../i18n.jsx';
import { createPortal } from 'react-dom';
import { Search, X } from 'lucide-react';
import PHOSPHOR_NAMES from './phosphor-names.json';
import { ICON_NAMES, ISO_NAMES, IconGlyph, appIconKeys, appIconLabel } from '../ui/md-lite.js'; // M18: icons without the renderer
import { Button } from '../ui/ui.jsx';

// The names come from the kit's registry — the bundled four plus whatever an admin added
// under Site theme → App icons — so a new project shows up here without a code change.
const PROJECT_LABEL = new Proxy({}, { get: (_, k) => (typeof k === 'string' ? appIconLabel(k) : undefined) });

// Icon picker searching the FULL catalogues: every lucide icon (name list from the
// lucide-static CDN, previews rendered as colour-inheriting CSS-mask images) and
// every Simple Icons brand (slug list from the simple-icons CDN). Falls back to the
// curated built-in set when offline. Lucide inserts `name`, brands `simple:slug`.
let _lucideAll = null;   // string[] of kebab-case names
let _simpleAll = null;   // [{ slug, title }]

async function loadLucide() {
  if (_lucideAll) return _lucideAll;
  try {
    const r = await fetch('https://cdn.jsdelivr.net/npm/lucide-static@latest/tags.json');
    const j = await r.json();
    _lucideAll = Object.keys(j);
  } catch { _lucideAll = ICON_NAMES; }
  return _lucideAll;
}
async function loadSimple() {
  if (_simpleAll) return _simpleAll;
  const slugify = (t) => String(t).toLowerCase().replace(/\+/g, 'plus').replace(/\./g, 'dot').replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
  try {
    const r = await fetch('https://cdn.jsdelivr.net/npm/simple-icons@latest/data/simple-icons.json');
    const j = await r.json();
    const arr = Array.isArray(j) ? j : (j.icons || []);
    _simpleAll = arr.map((e) => ({ slug: e.slug || slugify(e.title), title: e.title }));
  } catch {
    _simpleAll = ['github', 'discord', 'youtube', 'x', 'steam', 'docker', 'react', 'rust', 'python'].map((s) => ({ slug: s, title: s }));
  }
  return _simpleAll;
}

/** A lucide *component* name to the lucide-static *file* name.
 *
 *  They are not the same string, and lowercasing is not the conversion. lucide-react
 *  exports `Music2`; the CDN file is `music-2.svg`. Just lowercasing gives `music2`,
 *  which 404s — that is the request in the console.
 *
 *  A digit is its own segment, which is the part everyone forgets: Volume2 →
 *  volume-2, LayoutGrid → layout-grid, Home → home. Already-kebab input passes
 *  through unchanged, so a config storing either spelling works.
 */
export function lucideFileName(name) {
  return String(name || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')   // caseBoundary  → case-Boundary
    .replace(/([a-zA-Z])([0-9])/g, '$1-$2')   // Music2        → Music-2
    .toLowerCase();
}

// Lucide preview that inherits currentColor: CSS mask over the CDN svg.
export function LucideCdnIcon({ name, size = 18, className = '' }) {
  const url = `https://cdn.jsdelivr.net/npm/lucide-static@latest/icons/${lucideFileName(name)}.svg`;
  return <span aria-hidden className={className} style={{ display: 'inline-block', width: size, height: size, backgroundColor: 'currentColor', WebkitMask: `url(${url}) center / contain no-repeat`, mask: `url(${url}) center / contain no-repeat` }} />;
}

const MAX_SHOWN = 96;

export default function IconPicker({ onPick, onClose, title = 'Pick an icon' }) {
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const [lucide, setLucide] = useState(ICON_NAMES);
  const [simple, setSimple] = useState([]);
  useEffect(() => { let on = true; loadLucide().then((l) => on && setLucide(l)); loadSimple().then((s) => on && setSimple(s)); return () => { on = false; }; }, []);

  const nq = q.trim().toLowerCase();
  const lucideHits = useMemo(() => (nq ? lucide.filter((n) => n.includes(nq)) : lucide).slice(0, MAX_SHOWN), [lucide, nq]);
  // Phosphor: the 1 512 regular-weight names shipped in phosphor-names.json (generated from the
  // @phosphor-icons/core package listing), drawn as currentColor masks straight from the CDN.
  // Inserted as `ph:<name>`; a weight is a prefix the author adds by hand (`ph-bold:<name>`).
  const phHits = useMemo(() => (nq ? PHOSPHOR_NAMES.filter((n) => n.includes(nq)) : PHOSPHOR_NAMES).slice(0, MAX_SHOWN), [nq]);
  // G5: the isometric family (`iso:<name>`), 83 full-colour drawings from three third-party sets
  // whose licences allow redistribution; the notices are served beside the files
  // (/icons/iso/LICENSES.txt, linked from the section). Drawn as <img>, each fetched only when
  // its cell scrolls into view (loading="lazy"), and none of them is in any JS chunk.
  const isoHits = useMemo(() => (nq ? ISO_NAMES.filter((n) => n.includes(nq) || `iso:${n}`.includes(nq)) : ISO_NAMES).slice(0, MAX_SHOWN), [nq]);
  const simpleHits = useMemo(() => (nq ? simple.filter((s) => s.slug.includes(nq) || s.title.toLowerCase().includes(nq)) : simple).slice(0, MAX_SHOWN / 2), [simple, nq]);
  const projectHits = useMemo(() => appIconKeys().filter((k) => !nq || k.includes(nq) || PROJECT_LABEL[k]?.toLowerCase().includes(nq)), [nq]);
  const nothingAnywhere = !!nq && !projectHits.length && !lucideHits.length && !phHits.length && !isoHits.length && !simpleHits.length;

  // Portal to <body>: the picker is often opened from inside a modal whose card uses a
  // transform (anim-pop) for its entrance. A CSS transform makes it the containing block
  // for any `position: fixed` descendant, so without the portal `fixed inset-0` anchored
  // to the modal card instead of the viewport — the broken, offset overlay (image 1).
  return createPortal(
    <div className="fixed inset-0 z-[80] grid place-items-center p-4" style={{ background: 'rgba(4,5,8,0.55)', backdropFilter: 'blur(3px)' }} onMouseDown={onClose}>
      <div className="card modal-card w-full max-w-lg p-0 overflow-hidden anim-pop flex flex-col max-h-[80vh]" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--line)] shrink-0">
          <span className="font-semibold flex-1">{title}</span>
          <button className="text-[var(--faint)] hover:text-[var(--text)]" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="px-3 py-2.5 border-b border-[var(--line)] flex items-center gap-2 shrink-0">
          <Search size={14} className="text-[var(--faint)]" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${lucide.length + PHOSPHOR_NAMES.length + ISO_NAMES.length + simple.length} icons…`} className="flex-1 bg-transparent border-0 outline-none text-sm text-[var(--text)]" />
        </div>
        <div className="p-3 overflow-auto">
          {/* Every catalogue empty at once is a search result, not an empty picker: say which
              search excluded them and put the way out on screen. Three separate "no match"
              lines under three headings said the same thing three times and offered nothing. */}
          {nothingAnywhere ? (
            <div className="text-center py-10 px-4">
              <Search size={28} className="mx-auto text-[var(--faint)] mb-3" />
              <div className="font-semibold break-words">{t('ip.none.t', 'No icon matches “{q}”').replace('{q}', q)}</div>
              <div className="text-sm text-[var(--muted)] mt-1 mx-auto max-w-sm">{t('ip.none.s', 'The search reads icon names only, so a word for what the icon means rarely finds it. Try the object instead: “trash”, “bell”, “arrow”.')}</div>
              <div className="mt-4"><Button variant="primary" onClick={() => setQ('')}><X size={15} /> {t('ip.none.a', 'Clear the search')}</Button></div>
            </div>
          ) : (<>
          {/* Our own project logos — usable in the topbar, blog, docs, faq. */}
          {(() => { const pj = projectHits; return pj.length > 0 && <>
            <div className="text-[11px] font-bold uppercase tracking-wide text-[var(--faint)] mb-1.5">{t('ip.ourprojects', "Better* projects")}</div>
            <div className="grid grid-cols-7 sm:grid-cols-9 gap-1.5 mb-4">
              {pj.map((k) => (
                <button key={k} type="button" title={PROJECT_LABEL[k] || k} onClick={() => { onPick(`app:${k}`); onClose(); }}
                  className="aspect-square grid place-items-center rounded-lg border border-[var(--line)] hover:border-[var(--primary)] hover:bg-[var(--surface-2)]">
                  <IconGlyph name={`app:${k}`} size={18} />
                </button>
              ))}
            </div>
          </>; })()}
          <div className="text-[11px] font-bold uppercase tracking-wide text-[var(--faint)] mb-1.5">Lucide {nq && `· ${lucideHits.length}${lucideHits.length === MAX_SHOWN ? '+' : ''}`}</div>
          <div className="grid grid-cols-7 sm:grid-cols-9 gap-1.5">
            {lucideHits.map((name) => (
              <button key={name} type="button" title={name} onClick={() => { onPick(name); onClose(); }}
                className="aspect-square grid place-items-center rounded-lg border border-[var(--line)] hover:border-[var(--primary)] hover:bg-[var(--surface-2)] text-[var(--muted)] hover:text-[var(--text)]">
                {ICON_NAMES.includes(name) ? <IconGlyph name={name} size={17} /> : <LucideCdnIcon name={name} size={17} />}
              </button>
            ))}
            {!lucideHits.length && <div className="col-span-full text-center text-sm text-[var(--faint)] py-4">{t('ip.lu.none', 'No Lucide icon matches “{q}”.').replace('{q}', q)}</div>}
          </div>
          <div className="text-[11px] font-bold uppercase tracking-wide text-[var(--faint)] mt-4 mb-1.5">Phosphor {nq && `· ${phHits.length}${phHits.length === MAX_SHOWN ? '+' : ''}`} <span className="normal-case font-normal tracking-normal">· {t('ip.ph.weights', 'ph-bold: / ph-fill: / ph-duotone: for other weights')}</span></div>
          <div className="grid grid-cols-7 sm:grid-cols-9 gap-1.5">
            {phHits.map((name) => (
              <button key={name} type="button" title={`ph:${name}`} onClick={() => { onPick(`ph:${name}`); onClose(); }}
                className="aspect-square grid place-items-center rounded-lg border border-[var(--line)] hover:border-[var(--primary)] hover:bg-[var(--surface-2)] text-[var(--muted)] hover:text-[var(--text)]">
                <IconGlyph name={`ph:${name}`} size={17} />
              </button>
            ))}
            {!phHits.length && <div className="col-span-full text-center text-sm text-[var(--faint)] py-4">{t('ip.ph.none', 'No Phosphor icon matches “{q}”.').replace('{q}', q)}</div>}
          </div>
          <div className="text-[11px] font-bold uppercase tracking-wide text-[var(--faint)] mt-4 mb-1.5">{t('ip.iso.title', 'Isometric')} {nq && `· ${isoHits.length}`} <span className="normal-case font-normal tracking-normal">· {t('ip.iso.credit', 'Isoflow, MI2, Jolloficons (MIT)')} · <a href="/icons/iso/LICENSES.txt" target="_blank" rel="noreferrer" className="underline hover:text-[var(--text)]">{t('ip.iso.licences', 'licences')}</a></span></div>
          <div className="grid grid-cols-7 sm:grid-cols-9 gap-1.5">
            {isoHits.map((name) => (
              <button key={name} type="button" title={`iso:${name}`} onClick={() => { onPick(`iso:${name}`); onClose(); }}
                className="aspect-square grid place-items-center rounded-lg border border-[var(--line)] hover:border-[var(--primary)] hover:bg-[var(--surface-2)]">
                <IconGlyph name={`iso:${name}`} size={24} />
              </button>
            ))}
            {!isoHits.length && <div className="col-span-full text-center text-sm text-[var(--faint)] py-4">{t('ip.iso.none', 'No isometric icon matches “{q}”.').replace('{q}', q)}</div>}
          </div>
          <div className="text-[11px] font-bold uppercase tracking-wide text-[var(--faint)] mt-4 mb-1.5">Brands · Simple Icons {nq && `· ${simpleHits.length}`}</div>
          <div className="grid grid-cols-7 sm:grid-cols-9 gap-1.5">
            {simpleHits.map(({ slug, title: st }) => (
              <button key={slug} type="button" title={st} onClick={() => { onPick(`simple:${slug}`); onClose(); }}
                className="aspect-square grid place-items-center rounded-lg border border-[var(--line)] hover:border-[var(--primary)] hover:bg-[var(--surface-2)]">
                <img src={`https://cdn.simpleicons.org/${slug}`} width={17} height={17} alt={st} loading="lazy" />
              </button>
            ))}
            {!simpleHits.length && <div className="col-span-full text-center text-sm text-[var(--faint)] py-4">{t('ip.si.none', 'No brand matches “{q}”.').replace('{q}', q)}</div>}
          </div>
          </>)}
        </div>
      </div>
    </div>,
    document.body,
  );
}

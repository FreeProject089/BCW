import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search, X } from 'lucide-react';
import { ICON_NAMES, IconGlyph } from './md.jsx';

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

// Lucide preview that inherits currentColor: CSS mask over the CDN svg.
export function LucideCdnIcon({ name, size = 18, className = '' }) {
  const url = `https://cdn.jsdelivr.net/npm/lucide-static@latest/icons/${name}.svg`;
  return <span aria-hidden className={className} style={{ display: 'inline-block', width: size, height: size, backgroundColor: 'currentColor', WebkitMask: `url(${url}) center / contain no-repeat`, mask: `url(${url}) center / contain no-repeat` }} />;
}

const MAX_SHOWN = 96;

export default function IconPicker({ onPick, onClose, title = 'Pick an icon' }) {
  const [q, setQ] = useState('');
  const [lucide, setLucide] = useState(ICON_NAMES);
  const [simple, setSimple] = useState([]);
  useEffect(() => { let on = true; loadLucide().then((l) => on && setLucide(l)); loadSimple().then((s) => on && setSimple(s)); return () => { on = false; }; }, []);

  const nq = q.trim().toLowerCase();
  const lucideHits = useMemo(() => (nq ? lucide.filter((n) => n.includes(nq)) : lucide).slice(0, MAX_SHOWN), [lucide, nq]);
  const simpleHits = useMemo(() => (nq ? simple.filter((s) => s.slug.includes(nq) || s.title.toLowerCase().includes(nq)) : simple).slice(0, MAX_SHOWN / 2), [simple, nq]);

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
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${lucide.length + simple.length} icons…`} className="flex-1 bg-transparent border-0 outline-none text-sm text-[var(--text)]" />
        </div>
        <div className="p-3 overflow-auto">
          <div className="text-[11px] font-bold uppercase tracking-wide text-[var(--faint)] mb-1.5">Lucide {nq && `· ${lucideHits.length}${lucideHits.length === MAX_SHOWN ? '+' : ''}`}</div>
          <div className="grid grid-cols-7 sm:grid-cols-9 gap-1.5">
            {lucideHits.map((name) => (
              <button key={name} type="button" title={name} onClick={() => { onPick(name); onClose(); }}
                className="aspect-square grid place-items-center rounded-lg border border-[var(--line)] hover:border-[var(--primary)] hover:bg-[var(--surface-2)] text-[var(--muted)] hover:text-[var(--text)]">
                {ICON_NAMES.includes(name) ? <IconGlyph name={name} size={17} /> : <LucideCdnIcon name={name} size={17} />}
              </button>
            ))}
            {!lucideHits.length && <div className="col-span-full text-center text-sm text-[var(--faint)] py-4">No lucide icon matches “{q}”.</div>}
          </div>
          <div className="text-[11px] font-bold uppercase tracking-wide text-[var(--faint)] mt-4 mb-1.5">Brands · Simple Icons {nq && `· ${simpleHits.length}`}</div>
          <div className="grid grid-cols-7 sm:grid-cols-9 gap-1.5">
            {simpleHits.map(({ slug, title: st }) => (
              <button key={slug} type="button" title={st} onClick={() => { onPick(`simple:${slug}`); onClose(); }}
                className="aspect-square grid place-items-center rounded-lg border border-[var(--line)] hover:border-[var(--primary)] hover:bg-[var(--surface-2)]">
                <img src={`https://cdn.simpleicons.org/${slug}`} width={17} height={17} alt={st} loading="lazy" />
              </button>
            ))}
            {!simpleHits.length && <div className="col-span-full text-center text-sm text-[var(--faint)] py-4">No brand matches “{q}”.</div>}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

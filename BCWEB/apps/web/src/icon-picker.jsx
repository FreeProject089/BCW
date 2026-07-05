import { useState } from 'react';
import { Search, X } from 'lucide-react';
import { ICON_NAMES, IconGlyph } from './md.jsx';

// Clickable icon picker (grid + filter). Used by the editor's "Icon" block and the
// callout/card icon fields, so authors pick from a list instead of typing a name.
const BRANDS = ['github', 'discord', 'youtube', 'x', 'steam', 'docker', 'react', 'nodedotjs', 'rust', 'python', 'javascript', 'typescript', 'linux', 'windows', 'apple', 'android'];

export default function IconPicker({ onPick, onClose, title = 'Pick an icon' }) {
  const [q, setQ] = useState('');
  const [brand, setBrand] = useState('');
  const list = q.trim() ? ICON_NAMES.filter((n) => n.includes(q.trim().toLowerCase())) : ICON_NAMES;
  const brandList = brand.trim() ? BRANDS.filter((b) => b.includes(brand.trim().toLowerCase())) : BRANDS;
  const pickBrand = (slug) => { onPick(`simple:${slug}`); onClose(); };
  return (
    <div className="fixed inset-0 z-[70] grid place-items-center p-4" style={{ background: 'rgba(4,5,8,0.55)', backdropFilter: 'blur(3px)' }} onMouseDown={onClose}>
      <div className="card modal-card w-full max-w-md p-0 overflow-hidden anim-pop" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--line)]">
          <span className="font-semibold flex-1">{title}</span>
          <button className="text-[var(--faint)] hover:text-[var(--text)]" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="px-3 py-2.5 border-b border-[var(--line)] flex items-center gap-2">
          <Search size={14} className="text-[var(--faint)]" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search icons…" className="flex-1 bg-transparent border-0 outline-none text-sm text-[var(--text)]" />
        </div>
        <div className="p-2 grid grid-cols-6 sm:grid-cols-8 gap-1.5 max-h-[46vh] overflow-auto">
          {list.map((name) => (
            <button key={name} type="button" title={name} onClick={() => { onPick(name); onClose(); }}
              className="aspect-square grid place-items-center rounded-lg border border-[var(--line)] hover:border-[var(--primary)] hover:bg-[var(--surface-2)] text-[var(--muted)] hover:text-[var(--text)]">
              <IconGlyph name={name} size={18} />
            </button>
          ))}
          {!list.length && <div className="col-span-full text-center text-sm text-[var(--faint)] py-6">No icon matches “{q}”.</div>}
        </div>
        {/* Brand icons (Simple Icons) */}
        <div className="border-t border-[var(--line)] px-3 py-2.5">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wide text-[var(--faint)]">Brand (Simple Icons)</span>
            <input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="slug e.g. github"
              onKeyDown={(e) => { if (e.key === 'Enter' && brand.trim()) pickBrand(brand.trim().toLowerCase().replace(/[^a-z0-9-]/g, '')); }}
              className="flex-1 bg-transparent border border-[var(--line)] rounded-md px-2 py-1 text-xs outline-none" />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {brandList.map((slug) => (
              <button key={slug} type="button" title={slug} onClick={() => pickBrand(slug)}
                className="w-9 h-9 grid place-items-center rounded-lg border border-[var(--line)] hover:border-[var(--primary)] hover:bg-[var(--surface-2)]">
                <img src={`https://cdn.simpleicons.org/${slug}`} width={18} height={18} alt={slug} />
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

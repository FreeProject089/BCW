// agent-bcw-nav: the phone's section picker, for a page made of sections (Settings, Profile).
//
// The same object the dashboards use below md (SideDash in pages/pages.jsx): one card showing
// the section you are on, its position, and a chevron; tapping it opens the list. It replaces a
// row of anchors that scrolled sideways, where half the sections were off screen and nothing
// said they existed.
//
// items: [{ id, icon, label }]. `sticky` keeps it under the topbar while the page scrolls, for
// a long page of anchors (Settings) where the picker is also the way to jump.
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Check } from 'lucide-react';

export function SectionPicker({ items = [], active, onPick, label, className = '', sticky = false }) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);
  const idx = Math.max(0, items.findIndex((i) => i.id === active));
  const cur = items[idx];
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    const onDown = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown, true);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onDown, true); };
  }, [open]);
  if (!items.length) return null;
  const Icon = cur?.icon;
  return (
    <div ref={boxRef} className={`relative z-20 ${sticky ? 'sticky' : ''} ${className}`}
      style={sticky ? { top: 'calc(var(--header-h, 64px) + 8px)' } : undefined}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="true" aria-label={label}
        className="card w-full flex items-center gap-2.5 px-4 py-3 text-sm font-medium press" style={{ background: 'var(--bg-solid)' }}>
        {Icon && <Icon size={16} className="text-[var(--accent-ink)] shrink-0" aria-hidden />}
        <span className="flex-1 min-w-0 text-start truncate" title={cur?.label}>{cur?.label}</span>
        <span className="text-[11px] text-[var(--faint)] tabular-nums">{idx + 1}/{items.length}</span>
        <ChevronDown size={16} className={`text-[var(--muted)] transition-transform duration-200 ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {open && (
        <div className="card absolute left-0 right-0 mt-2 p-1.5 anim-pop max-h-[62vh] overflow-y-auto scroll-thin shadow-lg" style={{ background: 'var(--bg-solid)' }}>
          {items.map((it) => {
            const I = it.icon;
            const on = it.id === cur?.id;
            return (
              <button key={it.id} type="button" aria-current={on ? 'true' : undefined}
                onClick={() => { setOpen(false); onPick?.(it.id); }}
                className={`w-full flex items-center gap-2.5 rounded-lg px-3 min-h-[44px] text-sm text-start transition-colors ${on ? 'bg-[var(--surface-2)] font-semibold text-[var(--text)]' : 'text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]'}`}>
                {I && <I size={15} className={`shrink-0 ${on ? 'text-[var(--accent-ink)]' : ''}`} aria-hidden />}
                <span className="flex-1 min-w-0">{it.label}</span>
                {on && <Check size={14} className="text-[var(--accent-ink)] shrink-0" aria-hidden />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default SectionPicker;

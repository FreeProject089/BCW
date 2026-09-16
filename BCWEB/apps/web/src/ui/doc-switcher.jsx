// Switching between the legal documents, at any width.
//
// It used to be a row of buttons, one per document, in a `overflow-x-auto no-scrollbar`
// strip. That row has a fault at BOTH ends of the range and neither is visible from the
// other: on a desktop it overflows with the scrollbar hidden, so the documents past the
// right edge exist, are focusable, and cannot be reached with a mouse; on a phone it is a
// horizontal scroller with no affordance beside a page that scrolls vertically, and the
// document you are reading can be the one off-screen. Letting an admin ADD documents, which
// is the point of the menu coming from the API, makes both worse every time somebody does.
//
// So: one control that names the document you are on and opens the list. It cannot overflow,
// because it is one button and a popup clamped to the viewport; nothing is cut, because the
// list wraps its labels; and it says where you are twice over, in the trigger and by the
// tick in the list.
//
// The popup is a portal (never clipped by a card) and OPAQUE — `--bg-solid`, not
// `--surface-1`: the translucent-surfaces setting would otherwise render a document list
// over the text of the document behind it.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { Check, ChevronDown } from 'lucide-react';

/**
 * @param options [{ key, to, label, icon }] — `icon` is a rendered node, so the caller keeps
 *                whatever rule it already has for choosing one.
 * @param current the key of the document being read, or null on the index page.
 * @param label   what the trigger says when `current` is not in `options`.
 */
export function DocSwitcher({ options, current, label, className = '' }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);
  const menuRef = useRef(null);
  const cur = options.find((o) => o.key === current) || null;

  // Measured on open AND on the layout pass after it, so the first paint is already in the
  // right place. Clamped to the viewport on both axes: a trigger near the right edge would
  // otherwise open a popup that runs off the page, which is the fault being fixed here.
  const place = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const width = Math.min(Math.max(r.width, 260), window.innerWidth - 16);
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    const below = window.innerHeight - r.bottom - 12;
    const maxH = Math.max(160, Math.min(below, window.innerHeight * 0.6));
    setPos({ top: r.bottom + 6, left, width, maxH });
  };
  useLayoutEffect(() => { if (open) place(); }, [open]);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') { setOpen(false); btnRef.current?.focus?.(); } };
    const onMove = () => setOpen(false); // scrolling or resizing: close rather than drift
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('resize', onMove); window.removeEventListener('scroll', onMove, true); };
  }, [open]);
  // Focus lands on the current document, so the list is usable from the keyboard and opens
  // where you are rather than at the top.
  useEffect(() => {
    if (!open || !menuRef.current) return;
    const items = menuRef.current.querySelectorAll('[data-doc]');
    (items[Math.max(0, options.findIndex((o) => o.key === current))] || items[0])?.focus?.();
  }, [open]);
  const onMenuKey = (e) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const items = [...menuRef.current.querySelectorAll('[data-doc]')];
    const i = items.indexOf(document.activeElement);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1
      : e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
    items[next]?.focus();
  };

  return (
    <div className={`print:hidden ${className}`}>
      <button ref={btnRef} type="button" onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox" aria-expanded={open}
        onKeyDown={(e) => { if (!open && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setOpen(true); } }}
        className="press-sm w-full sm:w-auto sm:min-w-[18rem] sm:max-w-full inline-flex items-center gap-2 rounded-xl border border-[var(--line-strong)] bg-[var(--surface-2)] px-3 py-2 text-start hover:border-[var(--ring)] transition-colors">
        {cur?.icon}
        {/* No `truncate` anywhere in this control: a document called "Conditions générales
            d'utilisation" must be readable, not shortened to three words and an ellipsis. */}
        <span className="flex-1 min-w-0 text-sm font-medium break-words">{cur ? cur.label : label}</span>
        <ChevronDown size={15} className={`text-[var(--muted)] shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && pos && createPortal(<>
        <div className="fixed inset-0 z-[70]" onClick={() => setOpen(false)} />
        <div ref={menuRef} role="listbox" onKeyDown={onMenuKey}
          className="fixed z-[71] rounded-xl border border-[var(--line-strong)] p-1 shadow-lg anim-pop overflow-y-auto scroll-thin"
          style={{ top: pos.top, left: pos.left, width: pos.width, maxHeight: pos.maxH, background: 'var(--bg-solid)' }}>
          {options.map((o) => (
            <Link key={o.key} to={o.to} data-doc role="option" aria-selected={o.key === current}
              onClick={() => setOpen(false)}
              className={`press-sm w-full flex items-start gap-2 rounded-lg px-2.5 py-2 text-sm transition-colors ${
                o.key === current ? 'bg-[var(--surface-2)] font-medium text-[var(--text)]' : 'hover:bg-[var(--surface-2)] text-[var(--muted)]'
              }`}>
              <span className="mt-0.5 shrink-0">{o.icon}</span>
              <span className="flex-1 min-w-0 break-words">{o.label}</span>
              {o.key === current && <Check size={14} className="text-[var(--primary-2)] shrink-0 mt-0.5" />}
            </Link>
          ))}
        </div>
      </>, document.body)}
    </div>
  );
}

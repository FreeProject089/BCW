// A list of questions that open one at a time.
//
// Extracted from the /hosting FAQ when that page was reorganised, because /charity needed the
// same thing and a second hand-rolled copy is the one that forgets `aria-expanded`. It is the
// house version of progressive disclosure for LONG answers: a question you can scan, an answer
// only for whoever asked it. (For a short aside inside a paragraph, `Explain` in ui.jsx is the
// lighter tool.)
//
//   items   [{ id, q, a }]: `a` is any node, so an answer can hold a link or a list.
//   single  true (default): opening one closes the other, which keeps a long list scannable.
//
// Every answer stays in the DOM, collapsed with the grid-rows trick so it animates without
// measuring heights, and `visibility: hidden` once closed so a closed answer is neither read
// nor tabbed into. Reduced motion drops the animation, not the behaviour (accordion.css: in a
// stylesheet rather than inline, because an inline `transition` beats the reduced-motion rule).
import { useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import './accordion.css';

export default function Accordion({ items, single = true, className = '', defaultOpen = null }) {
  const uid = useId();
  const [open, setOpen] = useState(() => new Set(defaultOpen != null ? [defaultOpen] : []));
  const toggle = (id) => setOpen((cur) => {
    const next = new Set(single ? [] : cur);
    if (!cur.has(id)) next.add(id);
    return next;
  });
  return (
    <div className={`flex flex-col gap-2.5 ${className}`}>
      {items.map(({ id, q, a }) => {
        const on = open.has(id);
        const bid = `${uid}-b-${id}`; const pid = `${uid}-p-${id}`;
        return (
          <div key={id} className={`card overflow-hidden transition-colors ${on ? 'border-[var(--line-strong)]' : ''}`}>
            <h3 className="m-0">
              <button type="button" id={bid} aria-expanded={on} aria-controls={pid} onClick={() => toggle(id)}
                className="w-full text-start px-5 py-4 min-h-[44px] flex items-center gap-3 hover:bg-[var(--surface-2)] transition-colors">
                <span className="font-semibold text-[14.5px] leading-snug flex-1 min-w-0">{q}</span>
                <span aria-hidden className={`shrink-0 grid place-items-center w-7 h-7 rounded-full border border-[var(--line)] text-[var(--muted)] transition-transform duration-200 motion-reduce:transition-none ${on ? 'rotate-180' : ''}`}>
                  <ChevronDown size={15} />
                </span>
              </button>
            </h3>
            <div id={pid} role="region" aria-labelledby={bid} className={`acc-panel ${on ? 'is-open' : ''}`}>
              <div>
                <div className="px-5 pb-5 text-[13.5px] text-[var(--muted)] leading-relaxed max-w-3xl">{a}</div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

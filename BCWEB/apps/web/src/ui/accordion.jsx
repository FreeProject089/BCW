// A list of questions that open one at a time.
//
// Extracted from the /hosting FAQ when that page was reorganised, because /charity needed the
// same thing and a second hand-rolled copy is the one that forgets `aria-expanded`. It is the
// house version of progressive disclosure for LONG answers: a question you can scan, an answer
// only for whoever asked it. (For a short aside inside a paragraph, `Explain` in ui.jsx is the
// lighter tool.)
//
//   items    [{ id, q, a, anchor? }]: `a` is any node, so an answer can hold a link, a list, or
//            a whole guide. `anchor` puts a DOM id on that question so `/page#anchor` lands on
//            it (the caller opens it with `defaultOpen`).
//   single   true (default): opening one closes the other, which keeps a long list scannable.
//   variant  'cards' (default): one card per question, as /charity has it.
//            'list': one surface, the questions divided by hairlines, a +/− marker. The plain
//            FAQ of a pricing page: eight cards stacked read as eight things to look at, one
//            list reads as one thing to scan.
//
// Every answer stays in the DOM, collapsed with the grid-rows trick so it animates without
// measuring heights, and `visibility: hidden` once closed so a closed answer is neither read
// nor tabbed into. Reduced motion drops the animation, not the behaviour (accordion.css: in a
// stylesheet rather than inline, because an inline `transition` beats the reduced-motion rule).
import { useId, useState } from 'react';
import { ChevronDown, Plus } from 'lucide-react';
import './accordion.css';

export default function Accordion({ items, single = true, className = '', defaultOpen = null, variant = 'cards' }) {
  const uid = useId();
  const [open, setOpen] = useState(() => new Set(defaultOpen != null ? [defaultOpen] : []));
  const toggle = (id) => setOpen((cur) => {
    const next = new Set(single ? [] : cur);
    if (!cur.has(id)) next.add(id);
    return next;
  });
  const list = variant === 'list';
  return (
    <div className={list ? `card divide-y divide-[var(--line)] ${className}` : `flex flex-col gap-2.5 ${className}`}>
      {items.map(({ id, q, a, anchor }) => {
        const on = open.has(id);
        const bid = `${uid}-b-${id}`; const pid = `${uid}-p-${id}`;
        return (
          <div key={id} id={anchor || undefined}
            className={list ? 'scroll-mt-24' :`card overflow-hidden transition-colors scroll-mt-24 ${on ? 'border-[var(--line-strong)]' : ''}`}>
            <h3 className="m-0">
              <button type="button" id={bid} aria-expanded={on} aria-controls={pid} onClick={() => toggle(id)}
                className={`w-full text-start px-5 ${list ? 'py-5' : 'py-4'} min-h-[44px] flex items-center gap-3 hover:bg-[var(--surface-2)] transition-colors`}>
                <span className={`font-semibold ${list ? 'text-[15px]' : 'text-[14.5px]'} leading-snug flex-1 min-w-0`}>{q}</span>
                {list ? (
                  <span aria-hidden className={`shrink-0 text-[var(--muted)] transition-transform duration-200 motion-reduce:transition-none ${on ? 'rotate-45 text-[var(--text)]' : ''}`}>
                    <Plus size={18} />
                  </span>
                ) : (
                  <span aria-hidden className={`shrink-0 grid place-items-center w-7 h-7 rounded-full border border-[var(--line)] text-[var(--muted)] transition-transform duration-200 motion-reduce:transition-none ${on ? 'rotate-180' : ''}`}>
                    <ChevronDown size={15} />
                  </span>
                )}
              </button>
            </h3>
            <div id={pid} role="region" aria-labelledby={bid} className={`acc-panel ${on ? 'is-open' : ''}`}>
              <div>
                <div className={`px-5 pb-5 text-[13.5px] text-[var(--muted)] leading-relaxed ${list ? '' : 'max-w-3xl'}`}>{a}</div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

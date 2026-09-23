// M12 (agent-charity-M12): the ready-made looks for the Community Charity card, in the admin's
// "Landing design" editor (admin.jsx, CharityDesignEditor).
//
// One click writes a preset's fields (pages/charity.jsx CHARITY_PRESETS: mode, width, align and
// `preset`) into the design; nothing else is touched, so the admin's artwork, stylesheet and
// blocks are still there when they pick "Custom" again. Each tile's thumbnail is the REAL card
// (CharityCard, the component the home page renders) with this month's preview numbers, scaled
// down to the tile: a thumbnail that is a drawing of the card would drift from it.
import { useLayoutEffect, useRef, useState } from 'react';
import { Check, Palette } from 'lucide-react';
import { CharityCard, CHARITY_PRESETS, CHARITY_WIDTHS } from './charity.jsx';

// The card at its real width, scaled to whatever width the tile has. Inert: the thumbnail's
// buttons and links are a picture, never a tab stop and never a click.
function PresetThumb({ design, pot, t }) {
  const outer = useRef(null);
  const inner = useRef(null);
  const [fit, setFit] = useState({ k: 0.3, h: 0 });
  const W = (CHARITY_WIDTHS[design.width] || CHARITY_WIDTHS.xl) + 48;
  useLayoutEffect(() => {
    const o = outer.current; const i = inner.current;
    if (!o || !i) return undefined;
    o.setAttribute('inert', '');
    const measure = () => {
      const k = Math.min(1, Math.max(0.12, o.clientWidth / Math.max(1, i.scrollWidth)));
      setFit({ k, h: Math.ceil(i.scrollHeight * k) });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure); ro.observe(o); ro.observe(i);
    return () => ro.disconnect();
  }, [design.preset, design.width]);
  return (
    <div ref={outer} aria-hidden="true" className="rounded-lg bg-[var(--bg)] overflow-hidden pointer-events-none select-none" style={{ height: fit.h || 150 }}>
      <div ref={inner} style={{ width: W, padding: 24, transform: `scale(${fit.k})`, transformOrigin: 'top left' }}>
        <CharityCard pot={pot} design={design} t={t} onGive={() => {}} preview />
      </div>
    </div>
  );
}

export function CharityPresetPicker({ d, onChange, onCustom, pot, t }) {
  const active = d.mode === 'default' ? (d.preset || 'classic') : 'custom';
  const NAMES = {
    classic: [t('chp.classic', 'Classic'), t('chp.classic.h', 'The glowing card, centred. The site’s original.')],
    minimal: [t('chp.minimal', 'Minimal'), t('chp.minimal.h', 'A quiet card with no glow, read from the left.')],
    band: [t('chp.band', 'Bold band'), t('chp.band.h', 'A full accent band across the top, the numbers below it.')],
    glass: [t('chp.glass', 'Glass'), t('chp.glass.h', 'A frosted pane over two soft glows.')],
    hand: [t('chp.hand', 'Handwritten'), t('chp.hand.h', 'Ruled paper and a handwritten title, highlighted.')],
  };
  const tile = (on) => `relative rounded-xl border p-2 flex flex-col gap-2 min-w-0 transition ${on ? 'border-[var(--primary)] tint-primary-soft' : 'border-[var(--line)] hover:border-[var(--line-strong)]'}`;
  const label = (name, hint, on) => (
    <div className="px-1 pb-0.5 min-w-0">
      <div className="text-sm font-medium flex items-center gap-1.5">{name}{on && <Check size={13} className="text-[var(--accent-ink)] shrink-0" aria-hidden="true" />}</div>
      <div className="text-[11px] text-[var(--muted)] leading-snug">{hint}</div>
    </div>
  );
  return (
    <div className="mb-4" data-charity-presets="">
      <div className="flex items-baseline justify-between gap-2 flex-wrap mb-2">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">{t('chp.title', 'Ready-made looks')}</div>
        <div className="text-[11px] text-[var(--muted)]">{t('chp.sub', 'One click sets the card. The big preview below is the real one.')}</div>
      </div>
      <div className="grid gap-2.5 grid-cols-1 min-[480px]:grid-cols-2 xl:grid-cols-3">
        {CHARITY_PRESETS.map((p) => {
          const on = active === p.id;
          const [name, hint] = NAMES[p.id];
          return (
            <div key={p.id} className={tile(on)} data-preset={p.id}>
              <PresetThumb design={{ ...d, ...p.fields }} pot={pot} t={t} />
              {label(name, hint, on)}
              <button type="button" className="absolute inset-0 rounded-xl" aria-pressed={on} aria-label={name} title={hint}
                onClick={() => onChange({ ...d, ...p.fields })} />
            </div>
          );
        })}
        <div className={tile(active === 'custom')} data-preset="custom">
          <div aria-hidden="true" className="rounded-lg border border-dashed border-[var(--line-strong)] bg-[var(--bg)] grid place-items-center min-h-[120px] flex-1">
            <Palette size={22} className="text-[var(--muted)]" />
          </div>
          {label(t('chp.custom', 'Custom'), t('chp.custom.h', 'Your own artwork, CSS or blocks. What you set there is kept.'), active === 'custom')}
          <button type="button" className="absolute inset-0 rounded-xl" aria-pressed={active === 'custom'} aria-label={t('chp.custom', 'Custom')}
            title={t('chp.custom.h', 'Your own artwork, CSS or blocks. What you set there is kept.')}
            onClick={() => { if (d.mode === 'default') onCustom(); }} />
        </div>
      </div>
    </div>
  );
}

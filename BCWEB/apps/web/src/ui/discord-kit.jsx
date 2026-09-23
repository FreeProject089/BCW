// The Discord dashboard's spacing scale and its small controls, in one place.
//
// WHY A FILE FOR THIS: the four screens (automod, logs, welcome, the host in
// discord-servers.jsx) were each inventing their own margins — p-2.5 here, p-3 there,
// space-y-2 in one card and space-y-4 in the next, gap-1.5 beside gap-3. Read one card it
// looks deliberate; scroll the page and the rhythm breaks on every boundary, and on a phone
// the 2.5s and the 4s collapse into noise. A scale only holds if there is exactly one copy of
// it, so the classes live here as strings and the screens spend them rather than retyping
// them.
//
// The scale, and what each step is FOR:
//   SP.page     between the big blocks of a screen        (16px, 20px from sm)
//   SP.stack    between the parts of one block            (12px)
//   SP.tight    between two lines that belong together    (8px)
//   SP.card     the padding inside any bordered surface   (12px, 16px from sm)
//   SP.row      the padding of one row in a list          (12/16px across, 10px down)
//   SP.grid     between the columns of a form grid        (12px)
// Nothing else. A value that is not on the scale is a bug, not a decision.
import { useEffect, useRef, useState } from 'react';
import { Minus, Plus, X } from 'lucide-react';
import { useI18n } from '../i18n.jsx';
import { Input, Button } from './ui.jsx';

export const SP = {
  page: 'space-y-4 sm:space-y-5',
  stack: 'space-y-3',
  tight: 'space-y-2',
  card: 'p-3 sm:p-4',
  row: 'px-3 sm:px-4 py-2.5',
  grid: 'gap-3',
};

/** A bordered surface. Every card on these screens is this one, so they cannot drift apart. */
export const Panel = ({ children, className = '', pad = true }) => (
  <div className={`rounded-xl border border-[var(--line)] ${pad ? SP.card : ''} ${className}`}>{children}</div>
);

/** A list of rows inside a Panel: the divider is the panel's, the padding is SP.row. */
export const Rows = ({ children, className = '' }) => (
  <div className={`rounded-xl border border-[var(--line)] divide-y divide-[var(--line)] overflow-hidden ${className}`}>{children}</div>
);

/** The one heading shape. `right` is for a control that belongs to the heading, not below it. */
export const Head = ({ title, sub, right, className = '' }) => (
  <div className={`flex items-start gap-3 flex-wrap ${className}`}>
    <div className="min-w-0 flex-1">
      <h3 className="text-sm font-semibold text-[var(--text)]">{title}</h3>
      {sub && <p className="text-[11.5px] text-[var(--muted)] mt-0.5">{sub}</p>}
    </div>
    {right}
  </div>
);

/** The small uppercase label that opens a block inside a card. */
export const Eyebrow = ({ children, className = '' }) => (
  <div className={`text-[11px] font-semibold uppercase tracking-wider text-[var(--faint)] ${className}`}>{children}</div>
);

export const Check = ({ checked, onChange, children, className = '', disabled }) => (
  <label className={`flex items-center gap-2 text-xs cursor-pointer select-none ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${className}`}>
    <input type="checkbox" checked={!!checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} /> {children}
  </label>
);

/**
 * A chip that is also a checkbox. Used where a boolean is a PROPERTY of the thing beside it
 * (delete the message, tell them by DM) rather than a line of its own: as a row of chips the
 * three of them read as one answer instead of three unrelated questions.
 */
export function ToggleChip({ on, onChange, icon: Icon, children, tone = 'primary', disabled, title }) {
  const active = !!on && !disabled;
  return (
    <button type="button" disabled={disabled} onClick={() => onChange(!on)} aria-pressed={active} title={title}
      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] border transition disabled:opacity-40 disabled:cursor-not-allowed ${
        active
          ? (tone === 'warning' ? 'tint-warning b-warning text-warning' : 'tint-primary b-primary text-[var(--accent-ink)]')
          : 'border-[var(--line)] text-[var(--muted)] hover:text-[var(--text)] hover:border-[var(--line-strong)]'}`}>
      {Icon && <Icon size={12} className="shrink-0" />} {children}
    </button>
  );
}

/** A state dot: on / off / watching. The colour is never the only signal — a label sits beside it. */
export const Dot = ({ tone = 'off', className = '' }) => (
  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${tone === 'on' ? 'bg-[var(--success)]' : tone === 'watch' ? 'bg-[var(--warning)]' : 'bg-[var(--faint)]'} ${className}`} />
);

/**
 * A number that commits on blur / Enter and only forwards a valid value while typing, so a
 * field can be cleared and retyped without the draft ever holding an empty string.
 * `f` is a bound descriptor: { min, max, int, step }.
 */
//
// WHY NOT THE SITE'S <Input type="number">: these fields sit INSIDE a sentence ("At [3]
// warnings, timeout for [60] minutes"), at 11.5px. The shared stepper is a form control: under
// 9rem wide it stacks its − and + in one column, each with a 24px floor, so every field here
// became a 56x48 block whose value had 14px of room. "40320" drew 32px wide in it and read as
// "403", "1000" as "10", and each sentence line jumped to 48px around a 12px word. Measured, not
// eyeballed: 4 of the 18 fields on the automod screen clipped their own value, at 344px and at
// 1280px alike. This one is a single row [−][value][+], one line tall, and the value box is
// sized in `ch` from the field's own bounds, so the widest legal value always fits (`ch` is
// the width of "0", and tabular-nums makes every digit that wide). On a touch screen `.input`
// is 44px tall and 16px, so the buttons stretch with it and `ch` grows with the font.
const digitsOf = (f) => {
  const w = (n) => String(Math.trunc(Math.abs(Number(n) || 0))).length + (Number(n) < 0 ? 1 : 0);
  return Math.max(2, w(f.max), w(f.min)) + (f.int ? 0 : 2);
};
const STEP_BTN = 'grid place-items-center shrink-0 w-6 min-h-[24px] max-lg:w-8 border border-[var(--control-border)] bg-[var(--surface-2)] text-[var(--muted)] hover:text-[var(--text)] hover:bg-[color-mix(in_srgb,var(--primary)_14%,var(--surface-2))] disabled:opacity-40 disabled:pointer-events-none transition-colors';

export function NumField({ value, onCommit, f, clamp, className = '', ariaLabel, disabled }) {
  const { t } = useI18n();
  const [txt, setTxt] = useState(String(value ?? ''));
  const ref = useRef(null);
  useEffect(() => { setTxt(String(value ?? '')); }, [value]);
  const commit = () => { const v = clamp(txt, f, value); onCommit(v); setTxt(String(v)); };
  // The buttons call the field's own stepUp/stepDown, so min/max/step hold exactly as typing
  // would, then raise `input` so React's onChange follows the DOM value it did not set.
  const bump = (dir) => {
    const el = ref.current;
    if (!el || el.disabled) return;
    try { dir > 0 ? el.stepUp() : el.stepDown(); } catch { /* off the step grid: leave it */ }
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  // A focused field steps on the wheel; an unfocused one lets the page scroll (React's onWheel
  // is passive, so it cannot preventDefault: hence the manual listener).
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      if (document.activeElement !== el || e.deltaY === 0) return;
      e.preventDefault();
      bump(e.deltaY < 0 ? 1 : -1);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);
  const n = Number(txt);
  const atMin = txt !== '' && Number.isFinite(n) && n <= f.min;
  const atMax = txt !== '' && Number.isFinite(n) && n >= f.max;
  // tabIndex -1 and a swallowed mousedown: the arrows keys on the field are the keyboard
  // control, the buttons are for the pointer, and a click must not steal the field's focus.
  const btn = (dir) => (
    <button type="button" tabIndex={-1} disabled={disabled || (dir > 0 ? atMax : atMin)}
      className={`${STEP_BTN} ${dir > 0 ? 'rounded-e-md border-s-0' : 'rounded-s-md border-e-0'}`}
      aria-label={dir > 0 ? t('num.inc', 'Increase') : t('num.dec', 'Decrease')}
      onMouseDown={(e) => e.preventDefault()} onClick={() => bump(dir)}>
      {dir > 0 ? <Plus size={12} /> : <Minus size={12} />}
    </button>
  );
  return (
    <span className={`dnum inline-flex items-stretch shrink-0 align-middle max-w-full ${className}`}>
      {btn(-1)}
      <Input plain type="number" ref={ref} min={f.min} max={f.max} step={f.step ?? (f.int ? 1 : 0.1)} value={txt} aria-label={ariaLabel} disabled={disabled}
        className="num-input !rounded-none !py-0.5 !px-1 text-xs tabular-nums text-center [appearance:textfield] min-w-0"
        style={{ width: `calc(${digitsOf(f)}ch + 10px)` }}
        onChange={(e) => { setTxt(e.target.value); const v = Number(e.target.value); if (e.target.value !== '' && Number.isFinite(v) && v >= f.min && v <= f.max) onCommit(f.int ? Math.round(v) : v); }}
        onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }} />
      {btn(1)}
    </span>
  );
}

/** Free-text chips (patterns, domains, file types). Ids get a real picker instead. */
export function Chips({ items, onChange, placeholder, max = 100, ariaLabel }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState('');
  const list = Array.isArray(items) ? items : [];
  const add = (raw) => {
    const v = String(raw || '').trim();
    if (!v || list.includes(v) || list.length >= max) return;
    onChange([...list, v]); setDraft('');
  };
  return (
    <div className={SP.tight}>
      {list.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {list.map((v) => (
            <span key={v} className="inline-flex items-center gap-1 ps-2 pe-1 py-0.5 rounded-md bg-[var(--surface-2)] border border-[var(--line)] text-[11px] max-w-full">
              <span className="truncate" title={v}>{v}</span>
              <button type="button" onClick={() => onChange(list.filter((x) => x !== v))} className="text-[var(--faint)] hover:text-error shrink-0" title={t('common.remove', 'Remove')}><X size={11} /></button>
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-1.5">
        <Input className="!py-1 text-xs" value={draft} placeholder={placeholder} aria-label={ariaLabel || placeholder}
          onChange={(e) => setDraft(e.target.value.slice(0, 200))}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(draft); } }} />
        <Button size="sm" variant="ghost" onClick={() => add(draft)} title={t('common.add', 'Add')}><Plus size={13} /></Button>
      </div>
    </div>
  );
}

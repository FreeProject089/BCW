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
import { useEffect, useState } from 'react';
import { Plus, X } from 'lucide-react';
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
export function NumField({ value, onCommit, f, clamp, className = '', ariaLabel }) {
  const [txt, setTxt] = useState(String(value ?? ''));
  useEffect(() => { setTxt(String(value ?? '')); }, [value]);
  const commit = () => { const v = clamp(txt, f, value); onCommit(v); setTxt(String(v)); };
  return (
    <Input type="number" min={f.min} max={f.max} step={f.step ?? (f.int ? 1 : 0.1)} value={txt} aria-label={ariaLabel}
      className={`!py-0.5 !px-1.5 text-xs tabular-nums !w-14 text-center ${className}`}
      onChange={(e) => { setTxt(e.target.value); const n = Number(e.target.value); if (e.target.value !== '' && Number.isFinite(n) && n >= f.min && n <= f.max) onCommit(f.int ? Math.round(n) : n); }}
      onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }} />
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

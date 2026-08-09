// Reusable UI kit — keep page code declarative. No browser prompt()/confirm()/alert():
// use the Dialog + Toast providers below. Icons come from lucide-react.
import { createContext, useContext, useEffect, useState, useCallback, useRef, useId, forwardRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Check, AlertTriangle, Info, Loader2, Eye, EyeOff, ChevronDown, Undo2, Star, MoreHorizontal } from 'lucide-react';
import { useI18n } from '../i18n.jsx';
import { getUndoDisabled } from '../lib/prefs.js';

// Robust clipboard copy — navigator.clipboard is unavailable on non-HTTPS origins and
// inside some embedded webviews, so fall back to a hidden <textarea> + execCommand.
// Returns true on success so callers can give honest success/error feedback.
export async function copyText(text) {
  try { if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; } } catch { /* fall through */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; ta.style.pointerEvents = 'none';
    document.body.appendChild(ta); ta.focus(); ta.select();
    const ok = document.execCommand('copy'); document.body.removeChild(ta); return ok;
  } catch { return false; }
}

/* ── Primitives ── */
export function Button({ variant = 'default', size, className = '', loading = false, disabled, children, ...p }) {
  const v = variant === 'primary' ? 'btn-primary' : variant === 'ghost' ? 'btn-ghost' : '';
  // `loading` → aria-busy shows the CSS spinner and blocks the click (also disables).
  return <button className={`btn ${v} ${size === 'sm' ? 'btn-sm' : ''} ${className}`} aria-busy={loading || undefined} disabled={disabled || loading} {...p}>{children}</button>;
}
export const Card = forwardRef(({ hover, className = '', children, ...p }, ref) =>
  <div ref={ref} className={`card ${hover ? 'card-hover' : ''} ${className}`} {...p}>{children}</div>);
export const Badge = ({ tone = '', className = '', children }) =>
  <span className={`badge ${tone ? `badge-${tone}` : ''} ${className}`}>{children}</span>;

// A row of actions that keeps itself on ONE line: it renders what fits and folds the rest
// into a "More" menu. Cards here carry 5-6 actions, which free-wrapping turned into a 3-4 row
// block that dwarfed the content it belonged to.
//
// It MEASURES rather than guessing at a breakpoint, because "does it fit" depends on the
// action count and their labels, not just the viewport: the same card can fit six actions on a
// wide desktop and two in a narrow sidebar at the same window size. Widths are read once from
// a hidden copy of the full row (they don't change), then a ResizeObserver recomputes the
// split as the container resizes.
//
// `actions`: [{ key, label, icon: Icon, onClick, variant?, danger?, hidden? }]
export function ActionBar({ actions, extra = [], className = '', size = 'sm' }) {
  const list = actions.filter((a) => a && !a.hidden);
  // `extra` = secondary actions that belong in the menu at ANY width (the long tail a
  // kebab used to hold). They share the overflow menu, so a card never grows a second one.
  const tail = extra.filter((a) => a && !a.hidden);
  const { t } = useI18n();
  const wrapRef = useRef(null);
  const measureRef = useRef(null);
  const [fit, setFit] = useState(list.length); // how many render inline
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const moreRef = useRef(null);

  useEffect(() => {
    const wrap = wrapRef.current, measure = measureRef.current;
    if (!wrap || !measure) return;
    const GAP = 8, MORE = 44; // gap-2, and the width the "More" button needs
    const hasTail = tail.length > 0; // then the menu button is there no matter what
    const compute = () => {
      const widths = [...measure.children].map((c) => c.getBoundingClientRect().width);
      const avail = wrap.getBoundingClientRect().width;
      if (!avail || !widths.length) return;
      // Everything fits → no menu at all (don't spend a slot on "More" for nothing).
      const total = widths.reduce((a, w) => a + w, 0) + GAP * (widths.length - 1) + (hasTail ? MORE + GAP : 0);
      if (total <= avail) { setFit(widths.length); return; }
      let used = MORE, n = 0;
      for (const w of widths) { const next = used + w + GAP; if (next > avail) break; used = next; n++; }
      setFit(Math.max(1, n)); // always keep at least the primary action visible
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [list.length, tail.length, list.map((a) => a.label).join('|')]);

  const shown = list.slice(0, fit);
  const rest = [...list.slice(fit), ...tail];
  const place = () => {
    const r = moreRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right), minWidth: Math.max(r.width, 180) });
    return r;
  };
  const openMenu = () => { place(); setOpen(true); };
  // The menu is fixed-positioned, so it would hang in place while the card scrolls away.
  // Keep it glued to its button, and close it once the button leaves the viewport.
  // Capture phase so scrolling an inner container counts too.
  useEffect(() => {
    if (!open) return;
    const update = () => {
      const r = moreRef.current?.getBoundingClientRect();
      if (!r) return;
      if (r.bottom < 0 || r.top > window.innerHeight) { setOpen(false); return; }
      place();
    };
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => { window.removeEventListener('scroll', update, true); window.removeEventListener('resize', update); };
  }, [open]);
  // Escape closes it, like every other menu in the app.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div ref={wrapRef} className={`flex items-center gap-2 min-w-0 ${className}`}>
      {/* Hidden full-width copy: the source of truth for each action's natural width. */}
      <div ref={measureRef} aria-hidden className="absolute -z-10 opacity-0 pointer-events-none flex gap-2 whitespace-nowrap" style={{ left: -9999, top: -9999 }}>
        {list.map((a) => (
          <Button key={a.key} size={size} variant={a.variant || 'default'}>{a.icon && <a.icon size={14} />} {a.label}</Button>
        ))}
      </div>

      {shown.map((a) => {
        const btn = (
          <Button key={a.key} size={size} variant={a.variant || 'default'} onClick={a.href ? undefined : a.onClick} disabled={a.disabled}
            className={`shrink-0 ${a.danger ? '!text-error' : ''}`}>
            {a.icon && <a.icon size={14} />} {a.label}
          </Button>
        );
        // An action that navigates carries a real href, so middle-click / ctrl-click /
        // "open in new tab" work like any link. A plain left click is intercepted and
        // handed to `onClick` for SPA routing (a bare <a> would full-reload). Kept as an
        // <a> rather than react-router's <Link> so this kit stays router-agnostic.
        return a.href && !a.disabled ? (
          <a key={a.key} href={a.href} target={a.target} rel={a.target === '_blank' ? 'noreferrer' : undefined} className="shrink-0 inline-flex"
            onClick={(e) => { if (a.target || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return; e.preventDefault(); a.onClick?.(); }}>
            {btn}
          </a>
        ) : btn;
      })}

      {rest.length > 0 && (
        <>
          {/* span, not ref={Button}: Button isn't a forwardRef, so a ref on it is silently
              dropped and the menu would anchor to nothing. */}
          <span ref={moreRef} className="shrink-0 inline-flex">
            <Button size={size} variant="ghost" aria-expanded={open} aria-haspopup="menu"
              onClick={() => (open ? setOpen(false) : openMenu())}
              title={t('ab.more', '{n} more actions').replace('{n}', rest.length)}>
              <MoreHorizontal size={15} />
            </Button>
          </span>
          {open && pos && createPortal(
            <>
              <div className="fixed inset-0 z-[60]" onClick={() => setOpen(false)} />
              {/* --bg-solid, not --surface-1: a popup must stay OPAQUE, else "Translucent
                  surfaces" makes the cards behind it show through its text. Same rule the
                  Dropdown/DotDropdown menus follow. */}
              <div role="menu" className="fixed z-[61] rounded-xl border border-[var(--line-strong)] shadow-xl p-1"
                style={{ top: pos.top, right: pos.right, minWidth: pos.minWidth, background: 'var(--bg-solid)' }}>
                {rest.map((a) => {
                  const cls = `w-full text-left px-3 py-2 rounded-lg text-xs font-medium flex items-center gap-2 enabled:hover:bg-[var(--surface-2)] disabled:opacity-40 disabled:cursor-not-allowed ${a.danger ? 'text-error' : 'text-[var(--text)]'}`;
                  const body = <>{a.icon && <a.icon size={14} />} {a.label}</>;
                  // A navigating action stays a link once it folds in here too — otherwise
                  // the affordance would vanish at exactly the narrow widths that fold it.
                  return a.href && !a.disabled ? (
                    <a key={a.key} role="menuitem" href={a.href} target={a.target} rel={a.target === '_blank' ? 'noreferrer' : undefined} className={`${cls} hover:bg-[var(--surface-2)]`}
                      onClick={(e) => { if (a.target) { setOpen(false); return; } if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return; e.preventDefault(); setOpen(false); a.onClick?.(); }}>
                      {body}
                    </a>
                  ) : (
                    <button key={a.key} role="menuitem" disabled={a.disabled} onClick={() => { setOpen(false); a.onClick?.(); }} className={cls}>
                      {body}
                    </button>
                  );
                })}
              </div>
            </>, document.body)}
        </>
      )}
    </div>
  );
}

// Star toggle for a repo or a community catalog. One component for both because the two
// endpoints answer identically ({ favorited, favoriteCount }) — `post` is the caller's toggle
// so this stays unaware of which entity it's starring.
// Updates optimistically and rolls back if the call fails: a star is a trivial, high-frequency
// action, so waiting on a round-trip to redraw feels broken.
export function StarButton({ favorited, count, post, onDone, signedIn, size = 'sm', className = '' }) {
  const [state, setState] = useState({ on: !!favorited, n: count || 0 });
  const [busy, setBusy] = useState(false);
  useEffect(() => { setState({ on: !!favorited, n: count || 0 }); }, [favorited, count]);
  const toggle = async () => {
    if (busy) return;
    const prev = state;
    setState({ on: !prev.on, n: prev.n + (prev.on ? -1 : 1) });
    setBusy(true);
    try { const r = await post(); const next = { on: !!r.favorited, n: r.favoriteCount ?? 0 }; setState(next); onDone?.(next); }
    catch { setState(prev); }
    finally { setBusy(false); }
  };
  return (
    <Button size={size} variant={state.on ? 'primary' : 'ghost'} onClick={toggle} disabled={!signedIn || busy}
      title={!signedIn ? 'Sign in to star' : state.on ? 'Starred — click to remove' : 'Star this'}
      className={className} aria-pressed={state.on}>
      <Star size={14} className={state.on ? 'fill-current' : ''} /> {state.n}
    </Button>
  );
}
export const Input = forwardRef((p, ref) => <input ref={ref} {...p} className={`input ${p.className || ''}`} />);
export const Textarea = forwardRef((p, ref) => <textarea ref={ref} {...p} className={`input ${p.className || ''}`} />);
export const Select = ({ className = '', children, ...p }) => <select className={`input ${className}`} {...p}>{children}</select>;

// Themed dropdown replacing OS-native <select> popups (which ignore the app theme and
// render as ugly square OS menus). `options`: [{ value, label, icon? }]. Portal-based so
// it's never clipped by a card/overflow. `onChange(value)`.
export function Dropdown({ value, options, onChange, className = '', size, placeholder }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef(null);
  const menuRef = useRef(null);
  const [pos, setPos] = useState(null);
  const cur = options.find((o) => String(o.value) === String(value));
  const openMenu = () => { const r = btnRef.current?.getBoundingClientRect(); if (r) setPos({ top: r.bottom + 6, left: r.left, minWidth: Math.max(r.width, 160) }); setOpen(true); };
  useEffect(() => { if (!open) return; const onKey = (e) => { if (e.key === 'Escape') { setOpen(false); btnRef.current?.focus?.(); } }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey); }, [open]);
  // On open, move focus onto the selected option (else the first) so the list is keyboard-usable.
  useEffect(() => {
    if (!open || !menuRef.current) return;
    const opts = menuRef.current.querySelectorAll('[role="option"]');
    (opts[Math.max(0, options.findIndex((o) => String(o.value) === String(value)))] || opts[0])?.focus?.();
  }, [open]);
  // Roving focus between options with the arrow keys (Enter/Space activate the option buttons natively).
  const onMenuKey = (e) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const opts = [...menuRef.current.querySelectorAll('[role="option"]')];
    const i = opts.indexOf(document.activeElement);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? opts.length - 1 : e.key === 'ArrowDown' ? (i + 1) % opts.length : (i - 1 + opts.length) % opts.length;
    opts[next]?.focus();
  };
  const pad = size === 'sm' ? 'px-2.5 py-1.5 text-xs' : 'px-3 py-2 text-sm';
  return (
    <>
      <button ref={btnRef} type="button" onClick={() => (open ? setOpen(false) : openMenu())}
        aria-haspopup="listbox" aria-expanded={open} onKeyDown={(e) => { if (!open && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openMenu(); } }}
        className={`dd-trigger press-sm inline-flex items-center justify-between gap-2 rounded-lg border border-[var(--line-strong)] bg-[var(--surface-2)] font-medium hover:border-[var(--ring)] transition-colors ${pad} ${className}`}>
        <span className="truncate flex items-center gap-1.5">{cur?.icon}{cur ? cur.label : <span className="text-[var(--faint)]">{placeholder || '—'}</span>}</span>
        <ChevronDown size={14} className={`text-[var(--muted)] shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && pos && createPortal(<>
        <div className="fixed inset-0 z-[70]" onClick={() => setOpen(false)} />
        <div ref={menuRef} role="listbox" onKeyDown={onMenuKey} className="dd-menu fixed z-[71] rounded-xl border border-[var(--line-strong)] p-1 shadow-lg anim-pop max-h-[60vh] overflow-auto scroll-thin" style={{ top: pos.top, left: pos.left, minWidth: pos.minWidth, background: 'var(--bg-solid)' }}>
          {options.map((o) => (
            <button key={String(o.value)} type="button" role="option" aria-selected={String(o.value) === String(value)} onClick={() => { setOpen(false); btnRef.current?.focus?.(); if (String(o.value) !== String(value)) onChange(o.value); }}
              className={`press-sm w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-left transition-colors ${String(o.value) === String(value) ? 'bg-[var(--surface-2)] font-medium text-[var(--text)]' : 'hover:bg-[var(--surface-2)] text-[var(--muted)]'}`}>
              {o.icon}<span className="flex-1 truncate">{o.label}</span>
              {String(o.value) === String(value) && <Check size={14} className="text-[var(--primary-2)]" />}
            </button>
          ))}
        </div>
      </>, document.body)}
    </>
  );
}
export const Spinner = ({ className = '' }) => <Loader2 className={`animate-spin ${className}`} size={18} />;

export function Field({ label, hint, children }) {
  return <label className="block"><div className="text-xs font-medium text-[var(--muted)] mb-1.5">{label}</div>{children}{hint && <div className="text-xs text-[var(--faint)] mt-1">{hint}</div>}</label>;
}
export function PageHeader({ icon: Icon, title, subtitle, actions }) {
  return (
    <div className="flex items-start justify-between gap-4 mb-6">
      <div className="flex items-center gap-3">
        {Icon && <div className="grid place-items-center w-10 h-10 rounded-xl bg-[var(--surface-2)] border border-[var(--line)]"><Icon size={20} className="text-[var(--primary-2)]" /></div>}
        <div><h1 className="text-2xl font-bold">{title}</h1>{subtitle && <p className="text-sm text-[var(--muted)] mt-0.5">{subtitle}</p>}</div>
      </div>
      {actions}
    </div>
  );
}
export function EmptyState({ icon: Icon, title, sub, children }) {
  return (
    <Card className="p-12 text-center">
      {Icon && <Icon size={32} className="mx-auto text-[var(--faint)] mb-3" />}
      <div className="font-semibold">{title}</div>
      {sub && <div className="text-sm text-[var(--muted)] mt-1">{sub}</div>}
      {/* Center the action row explicitly: the card's `text-center` only centers inline
          content, so a caller passing a flex row (two buttons side by side) got them
          left-aligned under centered text. */}
      {children && <div className="mt-4 flex flex-wrap justify-center gap-2">{children}</div>}
    </Card>
  );
}

/* ── Modal ── */
export function Modal({ open, onClose, title, icon: Icon, children, footer, width = 'max-w-md' }) {
  const cardRef = useRef(null);
  const restoreRef = useRef(null);
  const titleId = useId();
  // `onClose` must NOT be a dependency of the focus effect below, and this ref is why.
  //
  // Every call site passes an inline arrow (`onClose={() => setOpen(false)}`), so its identity
  // changes on every render of the parent — and the field you are typing into keeps its value
  // in that parent's state. With `onClose` in the deps, one keystroke meant: parent re-renders
  // → deps changed → cleanup runs → `restoreRef.current.focus()` pulls focus OUT of the dialog
  // → the effect re-runs and focuses the FIRST focusable element in it. So you typed one
  // letter and had to click the field again. Every modal in the app, not just one.
  //
  // It also tore down the Escape listener and re-locked body scroll on every render, and reset
  // `restoreRef` to whatever was focused mid-edit — so closing the dialog no longer returned
  // focus where it came from.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    // Remember what had focus so we can restore it when the dialog closes (keyboard users
    // shouldn't be dumped back at the top of the page).
    restoreRef.current = document.activeElement;
    const onKey = (e) => {
      if (e.key === 'Escape') { closeRef.current?.(); return; }
      if (e.key !== 'Tab') return;
      // Focus trap: keep Tab / Shift+Tab cycling inside the dialog.
      const f = cardRef.current?.querySelectorAll('a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])');
      if (!f || !f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    // Move focus into the dialog (the first field, else the dialog itself).
    const first = cardRef.current?.querySelector('a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])');
    (first || cardRef.current)?.focus?.();
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      restoreRef.current?.focus?.();
    };
  }, [open]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center p-4 anim-fade" style={{ background: 'rgba(4,5,8,0.62)', backdropFilter: 'blur(4px)' }} onMouseDown={onClose}>
      <div ref={cardRef} role="dialog" aria-modal="true" aria-labelledby={title ? titleId : undefined} aria-label={title ? undefined : 'Dialog'} tabIndex={-1}
        className={`card modal-card anim-pop w-full ${width} p-0 overflow-hidden max-h-[92vh] flex flex-col`} onMouseDown={(e) => e.stopPropagation()} style={{ boxShadow: '0 24px 70px -20px rgba(0,0,0,0.7)', outline: 'none' }}>
        <div className="flex items-center gap-2.5 px-5 py-4 border-b border-[var(--line)] shrink-0">
          {Icon && <Icon size={18} className="text-[var(--primary-2)]" />}
          <div id={titleId} className="font-semibold flex-1 min-w-0 truncate">{title}</div>
          <button className="btn-ghost btn btn-sm !px-1.5" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        <div className="px-5 py-4 overflow-auto">{children}</div>
        {footer && <div className="px-5 py-4 border-t border-[var(--line)] flex justify-end gap-2 shrink-0 flex-wrap">{footer}</div>}
      </div>
    </div>, document.body);
}

/* ── Dialog provider: async prompt / confirm / alert as real modals ── */
const DialogCtx = createContext(null);
export const useDialog = () => useContext(DialogCtx);

export function DialogProvider({ children }) {
  const [state, setState] = useState(null); // { kind, opts, resolve }
  const [value, setValue] = useState('');
  const [reveal, setReveal] = useState(false); // show/hide for password prompts
  const inputRef = useRef(null);
  const close = (result) => { state?.resolve(result); setState(null); };

  const api = {
    prompt: (opts) => new Promise((resolve) => { setValue(opts.defaultValue || ''); setReveal(false); setState({ kind: 'prompt', opts, resolve }); }),
    confirm: (opts) => new Promise((resolve) => setState({ kind: 'confirm', opts, resolve })),
    alert: (opts) => new Promise((resolve) => setState({ kind: 'alert', opts, resolve })),
  };
  useEffect(() => { if (state?.kind === 'prompt') setTimeout(() => inputRef.current?.focus(), 50); }, [state]);

  const o = state?.opts || {};
  const danger = o.danger;
  const Icon = state?.kind === 'confirm' ? AlertTriangle : state?.kind === 'alert' ? Info : null;
  return (
    <DialogCtx.Provider value={api}>
      {children}
      <Modal open={!!state} onClose={() => close(state?.kind === 'confirm' || state?.kind === 'prompt' ? false : undefined)}
        title={o.title || 'Confirm'} icon={Icon}
        footer={<>
          {state?.kind !== 'alert' && <Button variant="ghost" onClick={() => close(false)}>{o.cancelLabel || 'Cancel'}</Button>}
          <Button variant="primary" className={danger ? '!bg-none !bg-error-bg' : ''}
            onClick={() => close(state?.kind === 'prompt' ? (value || '') : true)}>{o.okLabel || 'OK'}</Button>
        </>}>
        {o.message && <p className="text-sm text-[var(--muted)] leading-relaxed">{o.message}</p>}
        {state?.kind === 'prompt' && <div className={o.message ? 'mt-3' : ''}>
          {o.label && <div className="text-xs font-medium text-[var(--muted)] mb-1.5">{o.label}</div>}
          {o.type === 'password' ? (
            <div className="relative">
              <Input ref={inputRef} type={reveal ? 'text' : 'password'} value={value} placeholder={o.placeholder} onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && close(value || '')} className="!pr-10" />
              <button type="button" onClick={() => setReveal((v) => !v)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--faint)] hover:text-[var(--text)]" title={reveal ? 'Hide' : 'Show'} aria-label={reveal ? 'Hide' : 'Show'}>
                {reveal ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          ) : (
            <Input ref={inputRef} type={o.type || 'text'} value={value} placeholder={o.placeholder} onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && close(value || '')} />
          )}
        </div>}
      </Modal>
    </DialogCtx.Provider>
  );
}

/* ── Toasts ── */
const ToastCtx = createContext(null);
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  // Per-toast control: the pending timer + optional commit/cancel callbacks. `done`
  // guards against a toast being resolved twice (timer AND click racing).
  const ctl = useRef(new Map());
  const remove = useCallback((id) => setItems((s) => s.filter((t) => t.id !== id)), []);

  // Resolve a toast exactly once. `how`:
  //  • 'commit' — the timer elapsed (or a plain toast was dismissed): run onCommit, the
  //    deferred side effect (e.g. actually publish the post).
  //  • 'cancel' — the user hit × / Undo: run onCancel to restore the previous state; the
  //    deferred side effect never happens.
  const finalize = useCallback((id, how) => {
    const c = ctl.current.get(id);
    if (c?.done) return;
    if (c) { c.done = true; clearTimeout(c.timer); ctl.current.delete(id); }
    remove(id);
    try { if (how === 'cancel') c?.onCancel?.(); else c?.onCommit?.(); } catch { /* a callback must never crash the toast host */ }
  }, [remove]);

  const push = useCallback((toast) => {
    const id = Math.random().toString(36).slice(2);
    const duration = toast.duration || 4200;
    setItems((s) => [...s, { id, ...toast, duration }]);
    const timer = setTimeout(() => finalize(id, 'commit'), duration);
    ctl.current.set(id, { timer, onCommit: toast.onCommit, onCancel: toast.onCancel, done: false });
    return id;
  }, [finalize]);

  const dismiss = useCallback((id) => finalize(id, 'commit'), [finalize]);
  const api = {
    success: (msg, opts) => push({ tone: 'success', msg, ...opts }),
    error: (msg, opts) => push({ tone: 'error', msg, ...opts }),
    info: (msg, opts) => push({ tone: 'info', msg, ...opts }),
    // Optimistic action with an undo window: the toast counts down; on expiry onCommit
    // fires (do the real work), or the user cancels (× / Undo) → onCancel restores state.
    //
    // Settings → "Instant actions" turns the window off. Then there is nothing to undo, so
    // the deferred work runs straight away and the toast degrades to a plain confirmation —
    // every caller keeps working unchanged, because they already put their optimistic UI
    // update before this call and their real work inside onCommit.
    action: ({ tone = 'info', duration = 6000, onCommit, onCancel, cancelLabel, ...rest }) => {
      if (getUndoDisabled()) {
        try { onCommit?.(); } catch { /* a callback must never crash the toast host */ }
        return push({ tone, duration: 3200, ...rest });
      }
      return push({ tone, action: true, duration, onCommit, onCancel, cancelLabel, ...rest });
    },
  };
  const Ico = { success: Check, error: AlertTriangle, info: Info };
  return (
    <ToastCtx.Provider value={api}>
      {children}
      {createPortal(
        <div className="toast-host fixed bottom-5 right-5 z-[60] flex flex-col gap-2 w-80 max-w-[calc(100vw-2.5rem)]">
          {items.map((t) => { const I = Ico[t.tone] || Info;
            const tone = t.tone === 'success' ? 'var(--success)' : t.tone === 'error' ? 'var(--error)' : 'var(--info)';
            return (
            <div key={t.id} role="alert" className="anim-slide relative overflow-hidden rounded-xl border flex items-center gap-3 pl-3.5 pr-2 py-3"
              style={{ background: `color-mix(in srgb, ${tone} 8%, var(--bg-solid))`, borderColor: `color-mix(in srgb, ${tone} 32%, var(--line))`, boxShadow: '0 14px 40px -14px rgba(0,0,0,0.62)' }}>
              {/* tone-tinted, spring-in icon chip: an explicit success / error / info cue */}
              <span className={`toast-icon-in grid place-items-center w-7 h-7 rounded-lg shrink-0 ${t.tone === 'success' ? 'burst' : ''}`} style={{ background: `color-mix(in srgb, ${tone} 18%, transparent)`, color: tone }}><I size={16} /></span>
              <div className="text-sm flex-1 min-w-0 break-words leading-snug">{t.msg}</div>
              {/* Gmail-style: a done statement + one clear Cancel button (which restores the
                  previous state). The × does the same, so nothing is ambiguous. */}
              {t.action && <button onClick={() => finalize(t.id, 'cancel')} className="shrink-0 flex items-center gap-1 text-[13px] font-bold rounded-lg px-2.5 py-1.5 transition hover:bg-[color-mix(in_srgb,var(--text)_10%,transparent)]" style={{ color: tone }}><Undo2 size={13} /> {t.cancelLabel || 'Cancel'}</button>}
              <button onClick={() => finalize(t.id, t.action ? 'cancel' : 'commit')} aria-label={t.action ? 'Cancel' : 'Dismiss'} className="shrink-0 -mr-0.5 p-1 rounded-lg text-[var(--faint)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] transition"><X size={14} /></button>
              {/* countdown bar — for action toasts this is the undo window before commit */}
              <span className="absolute left-0 bottom-0 h-[3px] rounded-full toast-progress" style={{ background: tone, animationDuration: `${t.duration}ms` }} />
            </div>); })}
        </div>, document.body)}
    </ToastCtx.Provider>
  );
}

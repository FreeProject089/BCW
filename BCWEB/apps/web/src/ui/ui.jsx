// Reusable UI kit — keep page code declarative. No browser prompt()/confirm()/alert():
// use the Dialog + Toast providers below. Icons come from lucide-react.
import { createContext, useContext, useEffect, useState, useCallback, useRef, forwardRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Check, AlertTriangle, Info, Loader2, Eye, EyeOff, ChevronDown, Undo2 } from 'lucide-react';

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
export const Input = forwardRef((p, ref) => <input ref={ref} {...p} className={`input ${p.className || ''}`} />);
export const Textarea = forwardRef((p, ref) => <textarea ref={ref} {...p} className={`input ${p.className || ''}`} />);
export const Select = ({ className = '', children, ...p }) => <select className={`input ${className}`} {...p}>{children}</select>;

// Themed dropdown replacing OS-native <select> popups (which ignore the app theme and
// render as ugly square OS menus). `options`: [{ value, label, icon? }]. Portal-based so
// it's never clipped by a card/overflow. `onChange(value)`.
export function Dropdown({ value, options, onChange, className = '', size, placeholder }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef(null);
  const [pos, setPos] = useState(null);
  const cur = options.find((o) => String(o.value) === String(value));
  const openMenu = () => { const r = btnRef.current?.getBoundingClientRect(); if (r) setPos({ top: r.bottom + 6, left: r.left, minWidth: Math.max(r.width, 160) }); setOpen(true); };
  useEffect(() => { if (!open) return; const onKey = (e) => e.key === 'Escape' && setOpen(false); window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey); }, [open]);
  const pad = size === 'sm' ? 'px-2.5 py-1.5 text-xs' : 'px-3 py-2 text-sm';
  return (
    <>
      <button ref={btnRef} type="button" onClick={() => (open ? setOpen(false) : openMenu())} aria-expanded={open}
        className={`press-sm inline-flex items-center justify-between gap-2 rounded-lg border border-[var(--line-strong)] bg-[var(--surface-2)] font-medium hover:border-[var(--ring)] transition-colors ${pad} ${className}`}>
        <span className="truncate flex items-center gap-1.5">{cur?.icon}{cur ? cur.label : <span className="text-[var(--faint)]">{placeholder || '—'}</span>}</span>
        <ChevronDown size={14} className={`text-[var(--muted)] shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && pos && createPortal(<>
        <div className="fixed inset-0 z-[70]" onClick={() => setOpen(false)} />
        <div className="fixed z-[71] rounded-xl border border-[var(--line-strong)] p-1 shadow-lg anim-pop max-h-[60vh] overflow-auto scroll-thin" style={{ top: pos.top, left: pos.left, minWidth: pos.minWidth, background: 'var(--bg-solid)' }}>
          {options.map((o) => (
            <button key={String(o.value)} type="button" onClick={() => { setOpen(false); if (String(o.value) !== String(value)) onChange(o.value); }}
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
      {children && <div className="mt-4">{children}</div>}
    </Card>
  );
}

/* ── Modal ── */
export function Modal({ open, onClose, title, icon: Icon, children, footer, width = 'max-w-md' }) {
  useEffect(() => {
    if (!open) return;
    const h = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', h);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', h); document.body.style.overflow = ''; };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center p-4 anim-fade" style={{ background: 'rgba(4,5,8,0.62)', backdropFilter: 'blur(4px)' }} onMouseDown={onClose}>
      <div className={`card modal-card anim-pop w-full ${width} p-0 overflow-hidden max-h-[92vh] flex flex-col`} onMouseDown={(e) => e.stopPropagation()} style={{ boxShadow: '0 24px 70px -20px rgba(0,0,0,0.7)' }}>
        <div className="flex items-center gap-2.5 px-5 py-4 border-b border-[var(--line)] shrink-0">
          {Icon && <Icon size={18} className="text-[var(--primary-2)]" />}
          <div className="font-semibold flex-1 min-w-0 truncate">{title}</div>
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
          <Button variant="primary" className={danger ? '!bg-none !bg-red-500/90' : ''}
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
    action: ({ tone = 'info', duration = 6000, ...rest }) => push({ tone, action: true, duration, ...rest }),
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

// Reusable UI kit — keep page code declarative. No browser prompt()/confirm()/alert():
// use the Dialog + Toast providers below. Icons come from lucide-react.
import { createContext, useContext, useEffect, useState, useCallback, useRef, forwardRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Check, AlertTriangle, Info, Loader2 } from 'lucide-react';

/* ── Primitives ── */
export function Button({ variant = 'default', size, className = '', children, ...p }) {
  const v = variant === 'primary' ? 'btn-primary' : variant === 'ghost' ? 'btn-ghost' : '';
  return <button className={`btn ${v} ${size === 'sm' ? 'btn-sm' : ''} ${className}`} {...p}>{children}</button>;
}
export const Card = ({ hover, className = '', children, ...p }) =>
  <div className={`card ${hover ? 'card-hover' : ''} ${className}`} {...p}>{children}</div>;
export const Badge = ({ tone = '', className = '', children }) =>
  <span className={`badge ${tone ? `badge-${tone}` : ''} ${className}`}>{children}</span>;
export const Input = forwardRef((p, ref) => <input ref={ref} {...p} className={`input ${p.className || ''}`} />);
export const Textarea = (p) => <textarea className={`input ${p.className || ''}`} {...p} />;
export const Select = ({ className = '', children, ...p }) => <select className={`input ${className}`} {...p}>{children}</select>;
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
      <div className={`card anim-pop w-full ${width} p-0 overflow-hidden`} onMouseDown={(e) => e.stopPropagation()} style={{ boxShadow: '0 24px 70px -20px rgba(0,0,0,0.7)' }}>
        <div className="flex items-center gap-2.5 px-5 py-4 border-b border-[var(--line)]">
          {Icon && <Icon size={18} className="text-[var(--primary-2)]" />}
          <div className="font-semibold flex-1">{title}</div>
          <button className="btn-ghost btn btn-sm !px-1.5" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="px-5 py-4 border-t border-[var(--line)] flex justify-end gap-2">{footer}</div>}
      </div>
    </div>, document.body);
}

/* ── Dialog provider: async prompt / confirm / alert as real modals ── */
const DialogCtx = createContext(null);
export const useDialog = () => useContext(DialogCtx);

export function DialogProvider({ children }) {
  const [state, setState] = useState(null); // { kind, opts, resolve }
  const [value, setValue] = useState('');
  const inputRef = useRef(null);
  const close = (result) => { state?.resolve(result); setState(null); };

  const api = {
    prompt: (opts) => new Promise((resolve) => { setValue(opts.defaultValue || ''); setState({ kind: 'prompt', opts, resolve }); }),
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
          <Input ref={inputRef} value={value} placeholder={o.placeholder} onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && close(value || '')} />
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
  const push = useCallback((toast) => {
    const id = Math.random().toString(36).slice(2);
    setItems((s) => [...s, { id, ...toast }]);
    setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), toast.duration || 3800);
  }, []);
  const api = { success: (msg) => push({ tone: 'success', msg }), error: (msg) => push({ tone: 'error', msg }), info: (msg) => push({ tone: 'info', msg }) };
  const Ico = { success: Check, error: AlertTriangle, info: Info };
  return (
    <ToastCtx.Provider value={api}>
      {children}
      {createPortal(
        <div className="fixed bottom-5 right-5 z-[60] flex flex-col gap-2 w-80 max-w-[calc(100vw-2.5rem)]">
          {items.map((t) => { const I = Ico[t.tone] || Info; return (
            <div key={t.id} className="card anim-slide px-4 py-3 flex items-start gap-2.5" style={{ boxShadow: '0 12px 34px -12px rgba(0,0,0,0.6)' }}>
              <I size={17} className={t.tone === 'success' ? 'text-emerald-400' : t.tone === 'error' ? 'text-red-400' : 'text-orange-400'} />
              <div className="text-sm flex-1">{t.msg}</div>
            </div>); })}
        </div>, document.body)}
    </ToastCtx.Provider>
  );
}

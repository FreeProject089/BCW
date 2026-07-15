import { useEffect, useState, lazy } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import {
  Boxes, Server, Rocket, Download, ArrowRight, Search, Upload, Bell, CheckCircle2, XCircle, Clock, Package, ShieldCheck, Inbox, TrendingUp, Lock, LayoutDashboard, Trash2, PenSquare, Star, Bell as BellIcon, CheckCheck, Receipt, Copy, Globe, BadgeCheck, Send, MessageSquare, Files, RefreshCw, X, ChevronDown, AlertTriangle, Ticket, Gift, Info, Save,
} from 'lucide-react';
import { Button, Card, Badge, Input, Textarea, Select, Field, EmptyState, Spinner, Modal, useDialog, useToast, copyText } from '../ui/ui.jsx';
import { api, uploadPayload } from '../lib/api.js';
import { useAuth } from './auth.jsx';
import { useI18n } from '../i18n.jsx';
import { useIntro } from '../ui/IntroContext.jsx';
import { MyRepos, Billing } from './repos.jsx';

// These two tabs live in admin.jsx (an artefact of splitting the old pages monolith —
// nothing in admin.jsx renders them; this page is their only consumer). Referencing them
// without importing anything is what made both tabs throw `X is not defined` at render.
//
// They're imported LAZILY on purpose: a static import makes the dashboard chunk pull the
// whole admin chunk (~134 KB gzip, 13x this page's own size) onto every member's dashboard,
// admin or not. This way only someone who actually opens Catalogs/Reports fetches it. The
// route already sits inside a <Suspense> boundary in App.jsx.
// Proper fix, when someone has the appetite: move these sections out of admin.jsx — it needs
// `useAsync`/`Loading` relocated out of pages.jsx first, since pages.jsx already imports
// ui/report.jsx and moving them naively creates an import cycle.
const OwnerCatalogs = lazy(() => import('./admin.jsx').then((m) => ({ default: m.OwnerCatalogs })));
const MyReports = lazy(() => import('./admin.jsx').then((m) => ({ default: m.MyReports })));
import { KofiIcon } from '../ui/brand.jsx';
import { useAsync, Loading, statusTone, KIND_ICON, fmtRemaining, JsonEditor, SideDash } from './pages.jsx';

/* ─────────────────────────  Dashboard  ───────────────────────── */
const SUBMIT_INIT = { projectKey: 'bmm', kind: 'PLUGIN', name: '', description: '', version: '1.0.0', meta: '{}' };

// The notification icon/label map lives in ../ui/notif.js so the nav bell can import it
// without dragging this whole page into the initial bundle. Re-exported for existing callers.
import { NOTIF, NOTIF_FALLBACK } from '../ui/notif.js';
export { NOTIF, NOTIF_FALLBACK };
function NotificationsPanel() {
  const dialog = useDialog();
  const { data, loading, reload } = useAsync(() => api.get('/me/notifications'), []);
  const list = data?.notifications || [];
  const unread = list.filter((n) => !n.readAt).length;
  const markAll = async () => { try { await api.post('/me/notifications/read-all'); reload(); } catch {} };
  const markOne = async (n) => { if (!n.readAt) { try { await api.post(`/me/notifications/${n.id}/read`); reload(); } catch {} } };
  const del = async (n) => { try { await api.del(`/me/notifications/${n.id}`); reload(); } catch {} };
  const clearAll = async () => {
    if (!(await dialog.confirm({ title: 'Clear all notifications', message: 'This permanently deletes all of your notifications. Continue?', okLabel: 'Clear all', danger: true }))) return;
    try { await api.del('/me/notifications'); reload(); } catch {}
  };
  const ago = (d) => { const s = (Date.now() - new Date(d)) / 1000; if (s < 60) return 'now'; if (s < 3600) return `${Math.floor(s / 60)}m`; if (s < 86400) return `${Math.floor(s / 3600)}h`; return `${Math.floor(s / 86400)}d`; };
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold flex items-center gap-2"><Bell size={16} /> Notifications {unread > 0 && <Badge tone="primary">{unread}</Badge>}</h2>
        <div className="flex items-center gap-3">
          {unread > 0 && <button className="text-xs text-[var(--primary-2)] flex items-center gap-1" onClick={markAll}><CheckCheck size={13} /> Mark all read</button>}
          {list.length > 0 && <button className="text-xs text-red-400 flex items-center gap-1" onClick={clearAll}><Trash2 size={13} /> Clear all</button>}
        </div>
      </div>
      {loading ? <Loading /> : (list.length ? <div className="space-y-2 max-h-[460px] overflow-auto pr-1">
        {list.map((n) => { const m = NOTIF[n.kind] || NOTIF_FALLBACK; return (
          <Card key={n.id} className={`p-3.5 flex gap-3 group ${!n.readAt ? 'border-[var(--ring)]' : ''}`} onClick={() => markOne(n)} style={{ cursor: n.readAt ? 'default' : 'pointer' }}>
            <span className={`grid place-items-center w-9 h-9 rounded-xl shrink-0 ${m.tint}`}><m.icon size={16} className={m.tone} /></span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className={`text-[10px] font-semibold uppercase tracking-wider ${m.tone}`}>{m.label}</span>
                <span className="text-[11px] text-[var(--faint)]">· {ago(n.createdAt)} ago</span>
              </div>
              <div className={`text-sm break-words [overflow-wrap:anywhere] ${n.readAt ? 'text-[var(--muted)]' : 'text-[var(--text)]'}`}>{n.body}</div>
            </div>
            {!n.readAt && <span className="w-2 h-2 rounded-full bg-[var(--primary)] mt-1.5 shrink-0" />}
            <button className="text-[var(--faint)] hover:text-red-400 opacity-0 group-hover:opacity-100" onClick={(e) => { e.stopPropagation(); del(n); }}><Trash2 size={13} /></button>
          </Card>); })}
      </div> : <EmptyState icon={Bell} title="All caught up" sub="You have no notifications." />)}
    </div>
  );
}

// Gentle, dismissible prompt shown to any signed-in account WITHOUT 2FA — covers
// every path in: a password signup, a GitHub/Discord OAuth signup (they land
// here with no 2FA), and a normal login of an account that never enrolled. One
// tap goes to the 2FA setup; dismissal is per-device so it's never naggy.
// Getting-started checklist (Goal-Gradient effect): a brand-new dashboard is a wall of
// zeros, which reads as "0% done" and kills momentum. This starts users ABOVE zero
// (account already ✓) and shows a visible path to first value. Controlled by the parent
// so it can hand off to the 2FA nudge once dismissed. Auto-hides when every step is done.
function GettingStarted({ user, items, repos, onSubmit, onDismiss }) {
  const { t } = useI18n();
  const steps = [
    { key: 'account', label: t('gs.account', 'Create your account'), done: true },
    { key: '2fa', label: t('gs.2fa', 'Secure it with 2FA'), done: !!user?.totpEnabled, to: '/profile?setup2fa=1' },
    { key: 'item', label: t('gs.item', 'Submit your first item'), done: (items?.length || 0) > 0, action: 'submit' },
    { key: 'repo', label: t('gs.repo', 'Host your first Server-Repo'), done: (repos?.length || 0) > 0, to: '/hosting' },
  ];
  const done = steps.filter((s) => s.done).length;
  const pct = Math.round((done / steps.length) * 100);
  return (
    <Card className="p-5 mb-6">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <div className="font-semibold flex items-center gap-2"><Rocket size={16} className="text-[var(--primary-2)]" /> {t('gs.title', 'Getting started')}</div>
          <div className="text-xs text-[var(--muted)] mt-0.5">{t('gs.sub', "You're already {pct}% set up — finish the last steps to get the most out of it.").replace('{pct}', pct)}</div>
        </div>
        <button onClick={onDismiss} className="text-[var(--faint)] hover:text-[var(--text)] p-1 shrink-0" title={t('gs.dismiss', 'Dismiss')}><X size={15} /></button>
      </div>
      <div className="flex items-center gap-3 mb-4">
        <div className="progress-track flex-1"><div className="progress-fill is-done pop-in" style={{ width: `${pct}%` }} /></div>
        <span className="text-xs font-semibold tabular-nums text-[var(--muted)] shrink-0">{done}/{steps.length}</span>
      </div>
      <div className="space-y-1">
        {steps.map((st) => {
          const inner = (
            <div className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 transition-colors ${!st.done && (st.to || st.action) ? 'hover:bg-[var(--surface-2)] press cursor-pointer' : ''}`}>
              {st.done ? <CheckCircle2 size={18} className="text-[var(--success)] shrink-0" /> : <span className="w-[18px] h-[18px] rounded-full border-2 border-[var(--line-strong)] shrink-0" />}
              <span className={`text-sm flex-1 ${st.done ? 'text-[var(--faint)] line-through' : 'font-medium'}`}>{st.label}</span>
              {!st.done && (st.to || st.action) && <ArrowRight size={14} className="text-[var(--primary-2)] shrink-0" />}
            </div>
          );
          if (st.done || (!st.to && !st.action)) return <div key={st.key}>{inner}</div>;
          if (st.action === 'submit') return <button key={st.key} type="button" className="w-full text-left" onClick={onSubmit}>{inner}</button>;
          return <Link key={st.key} to={st.to}>{inner}</Link>;
        })}
      </div>
    </Card>
  );
}

const TWOFA_NUDGE_KEY = 'bcw_2fa_nudge_dismissed';
const GS_DISMISS_KEY = 'bcw_gs_dismissed';
function TwoFactorNudge() {
  const { user } = useAuth(); const { t } = useI18n();
  const [dismissed, setDismissed] = useState(() => { try { return localStorage.getItem(TWOFA_NUDGE_KEY) === '1'; } catch { return false; } });
  if (!user || user.totpEnabled || dismissed) return null;
  const hide = () => { setDismissed(true); try { localStorage.setItem(TWOFA_NUDGE_KEY, '1'); } catch {} };
  return (
    <Card className="p-4 mb-6 flex items-start gap-3 bg-gradient-to-r from-orange-500/12 to-transparent border-[var(--ring)]">
      <span className="grid place-items-center w-10 h-10 rounded-xl bg-[var(--surface-2)] border border-[var(--line)] shrink-0"><ShieldCheck size={18} className="text-[var(--primary-2)]" /></span>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold">{t('twofa.nudge.title', 'Don’t risk losing access to your account')}</div>
        <div className="text-xs text-[var(--muted)] mt-0.5">{t('twofa.nudge.d', 'A single leaked password could cost you your repos, submissions and payment history. Add a second factor — about a minute, and you stay in control.')}</div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <Link to="/profile?setup2fa=1"><Button size="sm" variant="primary"><ShieldCheck size={14} /> {t('twofa.nudge.setup', 'Set up')}</Button></Link>
        <button onClick={hide} className="text-[var(--faint)] hover:text-[var(--text)] p-1" title={t('twofa.nudge.later', 'Maybe later')}><X size={16} /></button>
      </div>
    </Card>
  );
}

// Card-payment-terminal (TPE) illustration, tinted by outcome. `ok` → the terminal
// shows an approved slip + green check; else a declined slip + amber cross.
function PaymentTerminal({ ok }) {
  const a1 = ok ? '#34d399' : '#f87171';
  const a2 = ok ? '#059669' : '#dc2626';
  const g = ok ? 'ptok' : 'ptfail';
  return (
    <svg viewBox="0 0 240 210" width="150" height="132" className="mx-auto" role="img" aria-hidden="true">
      <defs>
        <linearGradient id={`${g}-body`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--surface-2)" /><stop offset="1" stopColor="var(--bg-solid)" /></linearGradient>
        <linearGradient id={`${g}-acc`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={a1} /><stop offset="1" stopColor={a2} /></linearGradient>
        {/* userSpaceOnUse + r=100 centred at (120,100) so the glow fades fully to 0
            BEFORE the svg edges — an objectBoundingBox radial was still non-zero at
            the rect boundary, which showed as a hard-cut rectangle around the icon. */}
        <radialGradient id={`${g}-glow`} gradientUnits="userSpaceOnUse" cx="120" cy="100" r="100"><stop offset="0" stopColor={a1} stopOpacity="0.28" /><stop offset="0.6" stopColor={a1} stopOpacity="0.1" /><stop offset="1" stopColor={a1} stopOpacity="0" /></radialGradient>
      </defs>
      <rect x="0" y="0" width="240" height="210" fill={`url(#${g}-glow)`} />
      {/* handheld terminal, slightly tilted for depth */}
      <g transform="rotate(-6 120 120)">
        <rect x="74" y="52" width="92" height="130" rx="17" fill={`url(#${g}-body)`} stroke="var(--line-strong)" strokeWidth="2" />
        {/* screen */}
        <rect x="86" y="64" width="68" height="40" rx="6" fill="#0b1220" />
        <g stroke={a1} strokeWidth="2.6" fill="none" strokeLinecap="round" opacity="0.95"><path d="M104 84 a10 10 0 0 1 0 12" /><path d="M110 80 a17 17 0 0 1 0 20" /></g>
        <rect x="122" y="81" width="24" height="4" rx="2" fill={a1} opacity="0.85" />
        <rect x="122" y="90" width="16" height="4" rx="2" fill="#475569" />
        {/* rounded keypad keys */}
        {[0, 1, 2].map((r) => [0, 1, 2].map((c) => (
          <rect key={`${r}-${c}`} x={90 + c * 24} y={116 + r * 18} width="17" height="12" rx="3.5" fill="var(--line-strong)" />
        )))}
      </g>
      {/* card tapped on top (contactless) */}
      <g transform="rotate(11 152 58)">
        <rect x="120" y="32" width="66" height="43" rx="8" fill={`url(#${g}-acc)`} />
        <rect x="120" y="45" width="66" height="9" fill="#0b1220" opacity="0.32" />
        <rect x="128" y="40" width="13" height="10" rx="2" fill="#fde68a" />
        <rect x="128" y="62" width="28" height="5" rx="2.5" fill="#fff" opacity="0.9" />
      </g>
      {/* outcome badge with a clean ring */}
      <g transform="translate(170 152)">
        <circle r="26" fill="var(--bg-solid)" />
        <circle r="21" fill={`url(#${g}-acc)`} />
        {ok
          ? <path d="M-9 1 l6 6 l12 -13" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
          : <path d="M-7 -7 l14 14 M7 -7 l-14 14" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" />}
      </g>
    </svg>
  );
}

function PaymentResultModal({ result, onClose }) {
  const { t } = useI18n();
  const ok = result?.ok;
  const kind = result?.kind;
  const failed = result?.failed;             // true = payment failed (declined), vs plain cancel
  const [inv, setInv] = useState(null);       // most-recent Stripe invoice (for the real PDF)
  const [pay, setPay] = useState(null);       // fallback: local payment row (amount display)
  const [linking, setLinking] = useState(false);
  // The webhook + Stripe invoice can land a beat after the redirect — poll briefly so
  // "Download invoice" lights up once the real invoice exists.
  useEffect(() => {
    if (!ok) return;
    let tries = 0, cancelled = false;
    const poll = async () => {
      try {
        const [iv, r] = await Promise.all([api.get('/me/invoices').catch(() => null), api.get('/me/payments').catch(() => null)]);
        const latestInv = iv?.invoices?.[0]; const latestPay = r?.payments?.[0];
        if (!cancelled && (latestInv || latestPay)) { setInv(latestInv || null); setPay(latestPay || null); if (latestInv) return; }
      } catch {}
      if (tries++ < 6 && !cancelled) setTimeout(poll, 1500);
    };
    poll();
    return () => { cancelled = true; };
  }, [ok]);
  const downloadInvoice = async () => {
    setLinking(true);
    try {
      if (inv?.hasPdf) {
        // Real download through the API (attachment, correct filename).
        const res = await fetch(`/api/me/invoices/${inv.id}/pdf`); const blob = await res.blob();
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `invoice-${inv.number}.pdf`;
        document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      } else if (pay) {
        const link = await api.get(`/me/payments/${pay.id}/stripe-link`).catch(() => null);
        const url = link?.pdf || link?.hosted || link?.receipt;
        if (url) window.open(url, '_blank', 'noopener');
      }
    } finally { setLinking(false); }
  };
  const src = inv || pay;
  const amount = src ? (() => { const c = inv ? inv.amountCents : pay.amountCents; const cur = (src.currency || 'usd').toUpperCase(); const sym = cur === 'USD' ? '$' : cur === 'EUR' ? '€' : cur === 'GBP' ? '£' : ''; return sym ? `${sym}${(c / 100).toFixed(2)}` : `${(c / 100).toFixed(2)} ${cur}`; })() : null;
  const canDl = (inv?.hasPdf) || !!pay;
  return (
    <Modal open onClose={onClose} title="" width="max-w-sm"
      footer={<>
        {ok && <Button variant="ghost" disabled={!canDl || linking} onClick={downloadInvoice}>{linking ? <Spinner /> : <><Download size={15} /> {t('dash.pay.dl', 'Download invoice')}</>}</Button>}
        <Button variant="primary" onClick={onClose}>{ok ? t('dash.pay.done', 'Done') : t('dash.pay.retry', 'Try again')}</Button>
      </>}>
      <div className="text-center pt-2 pb-1">
        <PaymentTerminal ok={ok} />
        <div className={`text-xl font-extrabold mt-3 ${failed ? 'text-red-400' : ''}`}>{ok ? t('dash.pay.ok.t', 'Payment confirmed') : failed ? t('dash.pay.fail.t', 'Payment failed') : t('dash.pay.cancel.t', 'Checkout cancelled')}</div>
        <p className="text-sm text-[var(--muted)] mt-1.5 max-w-xs mx-auto">
          {ok
            ? (kind === 'feature' ? t('dash.pay.feature.m', 'Your repo is now featured on the public listing.') : t('dash.pay.hosting.m', "Your repo is being provisioned — it'll be online shortly."))
            : failed ? t('dash.pay.fail.m', 'The payment could not be completed — no charge was made. Check your card details and try again.')
            : t('dash.pay.cancel.m', 'No charge was made. You can try again anytime.')}
        </p>
        {ok && (() => {
          const lines = inv?.lines || [];
          const money2 = (c) => { const cur = (inv?.currency || pay?.currency || 'usd').toUpperCase(); const sym = cur === 'USD' ? '$' : cur === 'EUR' ? '€' : cur === 'GBP' ? '£' : ''; return sym ? `${sym}${(c / 100).toFixed(2)}` : `${(c / 100).toFixed(2)} ${cur}`; };
          const single = pay?.description || (kind === 'feature' ? t('dash.pay.boost', 'Repo boost') : t('dash.pay.hostingitem', 'Repo hosting'));
          return (
          <div className="mt-4 rounded-xl border border-[var(--line)] bg-[var(--surface-2)]/50 px-4 py-3 text-left text-sm max-w-xs mx-auto">
            {inv?.number && (
              <div className="flex items-center justify-between gap-3 mb-1.5 pb-1.5 border-b border-[var(--line)]">
                <span className="text-[var(--faint)]">{t('dash.pay.invoice', 'Invoice №')}</span>
                <span className="font-mono text-xs">{inv.number}</span>
              </div>
            )}
            {lines.length > 1 ? (
              <details open className="group/items">
                <summary className="flex items-center justify-between gap-3 cursor-pointer select-none list-none">
                  <span className="text-[var(--faint)] flex items-center gap-1"><ChevronDown size={13} className="transition-transform group-open/items:rotate-180" /> {t('dash.pay.items', '{n} items').replace('{n}', lines.length)}</span>
                  <span className="font-semibold tabular-nums">{amount || money2(lines.reduce((s, l) => s + l.amountCents, 0))}</span>
                </summary>
                <div className="mt-2 space-y-1">
                  {lines.map((l, i) => (
                    <div key={i} className="flex items-center justify-between gap-3 text-[13px]">
                      <span className="truncate text-[var(--muted)]">{l.description}</span>
                      <span className="tabular-nums shrink-0 text-[var(--faint)]">{money2(l.amountCents)}</span>
                    </div>
                  ))}
                </div>
              </details>
            ) : (<>
              <div className="flex items-center justify-between gap-3">
                <span className="text-[var(--faint)]">{t('dash.pay.item', 'Item')}</span>
                <span className="font-medium truncate">{lines[0]?.description || single}</span>
              </div>
              <div className="flex items-center justify-between gap-3 mt-1.5">
                <span className="text-[var(--faint)]">{t('dash.pay.amount', 'Amount')}</span>
                <span className="font-semibold tabular-nums">{amount || <span className="text-[var(--faint)]">{t('dash.pay.processing', 'processing…')}</span>}</span>
              </div>
            </>)}
            <div className="text-[11px] text-[var(--faint)] mt-2 flex items-center gap-1"><Info size={11} /> {t('dash.pay.receipt', 'A receipt is available in the Billing tab.')}</div>
          </div>
          );
        })()}
      </div>
    </Modal>
  );
}

export function Dashboard() {
  const { user } = useAuth(); const toast = useToast(); const nav = useNavigate(); const { t } = useI18n();
  const items = useAsync(() => api.get('/me/items'), []);
  const repos = useAsync(() => api.get('/me/repos'), []);
  const [gsDismissed, setGsDismissed] = useState(() => { try { return localStorage.getItem(GS_DISMISS_KEY) === '1'; } catch { return false; } });
  const [editing, setEditing] = useState(null); // the item opened in the view/edit modal
  const cancelDelete = async (it) => { try { await api.post(`/catalog/${it.id}/delete/cancel`); toast.success(t('dash.delcancelled', 'Deletion cancelled.')); items.reload(); } catch { toast.error(t('dash.cancelfail', 'Failed to cancel.')); } };

  // Handle the return trip from a Stripe Checkout redirect (?hosting=ok/cancel, ?feature=ok/cancel).
  // Surfaces a prominent, dismissible confirmation/cancel banner (not just a toast).
  const [sp, setSp] = useSearchParams();
  const { active: introActive } = useIntro(); // hold the payment modal until the site intro finishes
  const [payReturn, setPayReturn] = useState(null); // { ok, kind, failed } | null
  useEffect(() => {
    const hosting = sp.get('hosting'); const feature = sp.get('feature'); const oauth = sp.get('oauth');
    if (!hosting && !feature && !oauth) return;
    if (hosting === 'ok') { setPayReturn({ ok: true, kind: 'hosting' }); repos.reload(); items.reload(); try { localStorage.removeItem('bcw_cart'); } catch {} }
    else if (hosting === 'fail' || hosting === 'failed') { setPayReturn({ ok: false, failed: true, kind: 'hosting' }); }
    else if (hosting === 'cancel') { setPayReturn({ ok: false, kind: 'hosting' }); }
    if (feature === 'ok') { setPayReturn({ ok: true, kind: 'feature' }); repos.reload(); }
    else if (feature === 'fail' || feature === 'failed') { setPayReturn({ ok: false, failed: true, kind: 'feature' }); }
    else if (feature === 'cancel') { setPayReturn({ ok: false, kind: 'feature' }); }
    if (oauth === 'success') toast.success(t('auth.welcome.toast', 'Welcome!'));
    setSp((p) => { const n = new URLSearchParams(p); n.delete('hosting'); n.delete('feature'); n.delete('oauth'); return n; }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const list = items.data?.items || [];
  const rlist = repos.data?.repos || [];
  // My items — search + kind/status filters.
  const [itemQ, setItemQ] = useState('');
  const [itemKind, setItemKind] = useState('all');
  const [itemStatus, setItemStatus] = useState('all');
  const iq = itemQ.trim().toLowerCase();
  const filteredItems = list.filter((it) =>
    (!iq || it.name?.toLowerCase().includes(iq))
    && (itemKind === 'all' || it.kind === itemKind)
    && (itemStatus === 'all' || (itemStatus === 'deleting' ? !!it.deleteAt : it.status === itemStatus)));
  const stats = [
    { icon: Package, label: t('dash.items', 'Items'), value: list.length },
    { icon: CheckCircle2, label: t('dash.published', 'Published'), value: list.filter((i) => i.status === 'PUBLISHED').length, tone: 'text-emerald-400' },
    { icon: Clock, label: t('dash.pending', 'Pending'), value: list.filter((i) => i.status === 'PENDING').length, tone: 'text-amber-400' },
    { icon: Server, label: t('dash.repos', 'Repos'), value: rlist.length },
    { icon: Star, label: t('dash.featured', 'Featured'), value: rlist.filter((r) => r.featuredUntil && new Date(r.featuredUntil) > new Date()).length, tone: 'text-amber-400' },
  ];
  // Quick actions — no "Write a post" here (that lives in the Blog for staff).
  const actions = [
    { icon: Upload, label: t('sub.title', 'Submit content'), to: '/submit' },
    { icon: Rocket, label: t('dash.hostrepo', 'Host a repo'), to: '/hosting' },
    { icon: Package, label: t('dash.browse', 'Browse catalog'), to: '/catalog?project=bmm' },
    { icon: LayoutDashboard, label: t('dash.editprofile', 'Edit profile'), to: '/profile' },
  ];
  const tabs = [
    { id: 'overview', label: t('dash.overview', 'Overview'), icon: LayoutDashboard },
    { id: 'items', label: t('dash.myitems', 'My items'), icon: Package, badge: list.length || undefined },
    { id: 'catalogs', label: t('dash.mycatalogs', 'My catalogs'), icon: Boxes },
    { id: 'repos', label: t('dash.myrepos', 'My repos'), icon: Server, badge: rlist.length || undefined },
    { id: 'billing', label: t('dash.billing', 'Billing'), icon: Receipt },
    { id: 'reports', label: t('dash.reports', 'Reports & contact'), icon: MessageSquare },
  ];
  return (
    <>
      {payReturn && !introActive && <PaymentResultModal result={payReturn} onClose={() => setPayReturn(null)} />}
      <SideDash icon={LayoutDashboard} title={t('dash.hi', 'Hi, {name}').replace('{name}', user?.displayName || 'there')} subtitle={t('dash.sub', 'Manage your content, repos and billing.')} tabs={tabs}
        headerActions={<Link to="/submit"><Button variant="primary"><Upload size={16} /> {t('sub.title', 'Submit content')}</Button></Link>}>
        {(s) => (<>
          {s === 'overview' && <>
            {/* Goal-gradient onboarding: the checklist owns first-run guidance (incl. 2FA);
                once it's done or dismissed, fall back to the standalone 2FA nudge. */}
            {(() => {
              const complete = !!user?.totpEnabled && list.length > 0 && rlist.length > 0;
              return (!gsDismissed && !complete)
                ? <GettingStarted user={user} items={list} repos={rlist} onSubmit={() => nav('/submit')} onDismiss={() => { setGsDismissed(true); try { localStorage.setItem(GS_DISMISS_KEY, '1'); } catch {} }} />
                : <TwoFactorNudge />;
            })()}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
              {actions.map((a) => (
                <button key={a.label} onClick={() => a.onClick ? a.onClick() : nav(a.to)} className="card card-hover p-4 text-left flex items-center gap-2.5">
                  <span className="grid place-items-center w-9 h-9 rounded-lg bg-gradient-to-br from-orange-500 to-amber-500"><a.icon size={16} className="text-white" /></span>
                  <span className="text-sm font-medium">{a.label}</span>
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
              {stats.map((st) => <Card key={st.label} className="p-5"><st.icon size={18} className={st.tone || 'text-[var(--primary-2)]'} />
                <div className="text-3xl font-bold mt-3">{st.value}</div><div className="text-xs text-[var(--muted)] mt-0.5">{st.label}</div></Card>)}
            </div>
            <NotificationsPanel />
          </>}

          {s === 'items' && <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold flex items-center gap-2"><Package size={16} /> {t('dash.myitems', 'My items')}</h2>
              <Link to="/submit"><Button size="sm"><Upload size={14} /> {t('dash.new', 'New')}</Button></Link>
            </div>
            {list.length > 3 && (
              <div className="flex flex-wrap gap-2 mb-3">
                <div className="relative flex-1 min-w-[160px]"><Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--faint)]" />
                  <Input className="!pl-8 !py-1.5 !text-sm" placeholder={t('dash.search', 'Search my items…')} value={itemQ} onChange={(e) => setItemQ(e.target.value)} /></div>
                <Select className="!w-auto !py-1.5 !text-sm" value={itemKind} onChange={(e) => setItemKind(e.target.value)}>
                  <option value="all">{t('dash.allkinds', 'All kinds')}</option><option value="APP">APP</option><option value="PLUGIN">PLUGIN</option><option value="THEME">THEME</option><option value="PRESET">PRESET</option></Select>
                <Select className="!w-auto !py-1.5 !text-sm" value={itemStatus} onChange={(e) => setItemStatus(e.target.value)}>
                  <option value="all">{t('dash.allstatus', 'All statuses')}</option><option value="PUBLISHED">Published</option><option value="PENDING">Pending</option><option value="REJECTED">Rejected</option><option value="SUSPENDED">Suspended</option><option value="deleting">Deleting</option></Select>
              </div>
            )}
            {items.loading ? <Loading /> : (list.length ? (filteredItems.length ? <div className="space-y-2">
              {filteredItems.map((it) => { const I = KIND_ICON[it.kind] || Package; const v = it.kind === 'PLUGIN' ? it.meta?.validation : null; return (
                <Card key={it.id} className="p-4 flex items-center gap-3">
                  <I size={18} className="text-[var(--primary-2)] shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{it.name}</div>
                    <div className="text-xs text-[var(--faint)] flex items-center gap-2 flex-wrap">
                      <span>{it.kind} · v{it.version}</span>
                      {it.payloadKey && !it.meta?.download_url && <span className="text-[var(--primary-2)]">· {t('dash.hostedhere', 'hosted here')}</span>}
                      {v && (v.valid ? <span className="text-emerald-400 flex items-center gap-1"><BadgeCheck size={12} /> {t('dash.verified', 'verified')}</span> : <span className="text-red-400 flex items-center gap-1"><XCircle size={12} /> {t('dash.invalid', 'invalid')}</span>)}
                    </div>
                    {/* Public listing needs admin validation; until then the item is private
                        but the owner can always share its own direct link (like a repo). */}
                    {(() => {
                      const isPub = it.status === 'PUBLISHED';
                      const link = isPub ? `${location.origin}/item/${it.slug}` : (it.shareKey ? `${location.origin}/item/${it.slug}?k=${it.shareKey}` : null);
                      if (!link || it.deleteAt) return null;
                      return (
                        <button onClick={() => { copyText(link); toast.success(isPub ? t('dash.pubcopied', 'Public link copied.') : t('dash.privcopied', 'Private share link copied.')); }}
                          className="mt-1 inline-flex items-center gap-1 text-[11px] text-[var(--faint)] hover:text-[var(--primary-2)] transition" title={link}>
                          {isPub ? <Globe size={11} /> : <Lock size={11} />} {isPub ? t('dash.copypublic', 'Copy public link') : t('dash.copyprivate', 'Copy private link')}
                        </button>
                      );
                    })()}
                    {it.status === 'SUSPENDED' && <div className="text-[11px] text-red-400 mt-0.5">{t('dash.suspendednote', 'Suspended by an admin — you can’t edit or resubmit it. Contact support to appeal.')}</div>}
                  </div>
                  {it.deleteAt
                    ? <><Badge tone="red"><Trash2 size={11} /> {t('dash.deletingin', 'Deleting in')} {fmtRemaining(it.deleteAt)}</Badge>
                        <Button size="sm" variant="ghost" onClick={() => cancelDelete(it)}>{t('common.cancel', 'Cancel')}</Button></>
                    : <><Badge tone={statusTone(it.status)}>{it.status}</Badge>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(it)}><PenSquare size={14} /> <span className="hidden sm:inline">{t('dash.viewedit', 'View / edit')}</span></Button></>}
                </Card>); })}
            </div> : <div className="text-sm text-[var(--muted)] py-8 text-center">{t('dash.nomatch', 'No items match your filters.')}</div>)
              : <EmptyState icon={Inbox} title={t('dash.noitems', 'No items yet')} sub={t('dash.noitems.s', 'Submit your first app, plugin, theme or preset.')}>
              <Link to="/submit"><Button variant="primary"><Upload size={15} /> {t('sub.title', 'Submit content')}</Button></Link></EmptyState>)}
          </div>}

          {s === 'catalogs' && <OwnerCatalogs />}
          {s === 'repos' && <MyRepos />}
          {s === 'billing' && <Billing />}
          {s === 'reports' && <MyReports />}
        </>)}
      </SideDash>

      <ItemEditModal open={!!editing} item={editing} onClose={() => setEditing(null)} onDone={() => items.reload()} />
    </>
  );
}

// View + edit one of your own items. Saving proposes an UPDATE (admin re-validation
// still required) — the item flips back to PENDING until a moderator re-approves it.
// For our-hosted plugins the .bmmplug can be replaced; the new package is re-verified
// (checksums recomputed) before the change can go live again.
function ItemEditModal({ open, item, onClose, onDone }) {
  const toast = useToast(); const { t } = useI18n();
  const [form, setForm] = useState(null);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [confirmCancelHost, setConfirmCancelHost] = useState(false);
  const isPlugin = item?.kind === 'PLUGIN';
  // Any kind we host the payload for ourselves (not just PLUGIN) can be replaced —
  // app/theme/preset submissions are billed by size past the free tier exactly
  // like plugins, so they deserve the same self-service re-upload.
  const ourHosted = !!item?.payloadKey && !item?.meta?.download_url;
  const v = isPlugin ? item?.meta?.validation : null;
  const [quote, setQuote] = useState(null);
  const [cap, setCap] = useState(null); // hosting capacity — re-uploads also draw from the temp margin
  const noSubmitSpace = !!cap && (cap.tempMarginGB - cap.tempUsedGB) <= 0.01;
  useEffect(() => {
    if (file) {
      api.get(`/catalog/hosting-quote?bytes=${file.size}`).then(setQuote).catch(() => setQuote(null));
      api.get('/hosting/capacity').then((r) => setCap(r.capacity)).catch(() => setCap(null));
    } else setQuote(null);
  }, [file]);

  useEffect(() => {
    if (item) {
      const { validation, _prevStatus, ...cleanMeta } = item.meta || {}; // hide server-computed fields
      setForm({ description: item.description || '', version: item.version || '', tags: (item.tags || []).join(', '), meta: JSON.stringify(cleanMeta, null, 2) });
      setFile(null); setConfirmDel(false);
    }
  }, [item]);
  if (!item || !form) return null;
  const I = KIND_ICON[item.kind] || Package;

  const viewPayload = async () => {
    try { const { url } = await api.get(`/me/items/${item.id}/payload`); window.open(url, '_blank'); }
    catch { toast.error(t('ie.nopayload', 'No downloadable payload.')); }
  };
  const save = async () => {
    if (file && noSubmitSpace) return toast.error(t('sub.tempfull', 'Submission storage is full right now — try again once moderation clears space.'));
    let meta; try { meta = JSON.parse(form.meta || '{}'); } catch { return toast.error(t('ie.metajson', 'Metadata must be valid JSON.')); }
    setBusy(true);
    try {
      const patch = { description: form.description, version: form.version, tags: form.tags.split(',').map((s) => s.trim()).filter(Boolean), meta };
      if (file) { patch.payloadKey = await uploadPayload(item.kind, file); patch.payloadSize = file.size; }
      const res = await api.post(`/catalog/${item.id}/update`, patch);
      // A re-upload past the free tier is billed by size → finish payment first;
      // the new file only takes effect once the webhook confirms it's paid.
      if (res?.checkoutUrl) { window.location.href = res.checkoutUrl; return; }
      if (res?.validation && res.validation.valid === false) toast.error(t('ie.savefail', 'Saved, but the new .bmmplug failed validation ({reason}). A moderator will review.').replace('{reason}', res.validation.reason));
      else if (res?.validation?.valid) toast.success(t('ie.saveverified', 'Saved — plugin re-verified. Pending admin re-approval.'));
      else toast.success(t('ie.savepending', 'Saved — changes are pending admin re-approval.'));
      onClose(); onDone();
    } catch (x) { toast.error(x.data?.error === 'item_suspended' ? t('ie.suspended', 'This item was suspended by an admin — you can’t edit or resubmit it. Contact support to appeal.') : (x.data?.error || x.message || t('ie.savefail2', 'Failed to save.'))); } finally { setBusy(false); }
  };
  const doDelete = async () => {
    setBusy(true);
    try { await api.post(`/catalog/${item.id}/delete`); toast.success(t('ie.scheduled', 'Scheduled for deletion in 72h. Files are kept until then — you can cancel any time.')); onClose(); onDone(); }
    catch (x) { toast.error(x.data?.error || t('ie.delfail', 'Failed to delete.')); } finally { setBusy(false); }
  };
  const cancelDeletion = async () => {
    setBusy(true);
    try { await api.post(`/catalog/${item.id}/delete/cancel`); toast.success(t('dash.delcancelled', 'Deletion cancelled.')); onClose(); onDone(); }
    catch (x) { toast.error(x.data?.error || t('dash.cancelfail', 'Failed to cancel.')); } finally { setBusy(false); }
  };
  const cancelHosting = async () => {
    setBusy(true);
    try { await api.post(`/catalog/${item.id}/hosting/cancel`); toast.success(t('ie.hostcancelled', 'Hosting subscription cancelled — the item is now hidden.')); onClose(); onDone(); }
    catch (x) { toast.error(x.data?.error || t('ie.hostcancelfail', 'Failed to cancel.')); } finally { setBusy(false); }
  };

  const footer = item.deleteAt
    ? <><Button variant="ghost" onClick={onClose}>{t('bill.close', 'Close')}</Button><Button variant="primary" disabled={busy} onClick={cancelDeletion}>{busy ? <Spinner /> : t('ie.canceldel', 'Cancel deletion')}</Button></>
    : <>
        {confirmDel
          ? <span className="flex items-center gap-2 mr-auto text-sm text-[var(--muted)]">{t('ie.delthis', 'Delete this item?')}<Button size="sm" className="!bg-red-500/15 !text-red-400 !border-red-500/30" disabled={busy} onClick={doDelete}>{busy ? <Spinner /> : t('ie.yesdelete', 'Yes, delete')}</Button><Button size="sm" variant="ghost" onClick={() => setConfirmDel(false)}>{t('ie.no', 'No')}</Button></span>
          : <button className="mr-auto text-sm text-red-400/80 hover:text-red-400 flex items-center gap-1.5" onClick={() => setConfirmDel(true)}><Trash2 size={14} /> {t('repos.del.ok', 'Delete')}</button>}
        <Button variant="ghost" onClick={onClose}>{t('common.cancel', 'Cancel')}</Button>
        <Button variant="primary" disabled={busy || (!!file && noSubmitSpace)} onClick={save}>{busy ? <Spinner /> : t('ie.savereview', 'Save (send for re-review)')}</Button>
      </>;

  return (
    <Modal open={open} onClose={onClose} title={t('ie.title', 'View / edit item')} icon={PenSquare} width="max-w-lg" footer={footer}>
      <div className="flex items-center gap-3 mb-4">
        <div className="grid place-items-center w-11 h-11 rounded-xl bg-gradient-to-br from-orange-500/25 to-amber-500/15 border border-[var(--line)]"><I size={20} className="text-[var(--primary-2)]" /></div>
        <div className="min-w-0"><div className="font-semibold truncate">{item.name}</div>
          <div className="text-xs text-[var(--faint)] flex items-center gap-2"><Badge tone={statusTone(item.status)}>{item.status}</Badge>{item.kind}
            {(item.payloadKey || item.meta?.download_url) && <button onClick={viewPayload} className="text-[var(--primary-2)] hover:underline flex items-center gap-1"><Download size={11} /> payload</button>}</div></div>
      </div>

      {item.deleteAt
        ? <div className="rounded-lg border border-red-500/30 bg-red-500/8 p-2.5 text-xs text-red-400 flex items-start gap-2 mb-4">
            <Trash2 size={13} className="shrink-0 mt-0.5" />
            <span>{t('ie.notice.del1', 'Scheduled for deletion in')} <b>{fmtRemaining(item.deleteAt)}</b>. {t('ie.notice.del2', 'The files are kept until then — cancel below to keep this item.')}</span>
          </div>
        : <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-2.5 text-xs text-[var(--muted)] flex items-start gap-2 mb-4">
            <Lock size={13} className="text-[var(--primary-2)] shrink-0 mt-0.5" />
            <span>{t('ie.notice.edit', 'Editing sends the item back for moderation. The live version stays unchanged until an admin re-approves your changes.')}</span>
          </div>}

      {isPlugin && v && (
        <div className={`rounded-lg p-2.5 text-xs mb-4 flex items-center gap-2 border ${v.valid ? 'bg-emerald-500/8 border-emerald-500/25 text-emerald-400' : 'bg-red-500/8 border-red-500/25 text-red-400'}`}>
          {v.valid ? <BadgeCheck size={14} /> : <XCircle size={14} />}
          <span className="flex-1">{v.valid ? t('ie.pkgok', 'Current package verified — checksums match.') : t('ie.pkgbad', 'Current package invalid: {reason}').replace('{reason}', v.reason)}</span>
          {v.sha256 && <code className="text-[10px] text-[var(--faint)]">{v.sha256.slice(0, 12)}…</code>}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label={t('sub.name', 'Name')} hint={t('ie.noedit', 'Not editable')}><Input value={item.name} disabled /></Field>
        <Field label={t('sub.version', 'Version')}><Input value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} /></Field>
      </div>
      <div className="mt-3"><Field label={t('sub.desc', 'Description')}><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field></div>
      <div className="mt-3"><Field label={t('repos.f.tags', 'Tags')} hint={t('repos.f.tags.hint', 'Comma-separated.')}><Input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="backup, utility" /></Field></div>

      {ourHosted && (
        <div className="mt-3">
          <Field label={t('ie.replace', 'Replace file')} hint={t('ie.replace.hint2', 'Optional — uploads a new file, re-verified before it can go live. Billed by size past the free tier.')}>
            <Input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </Field>
          {file && <div className="mt-1.5 text-xs text-[var(--primary-2)] flex items-center gap-1.5"><Upload size={12} /> {file.name} {t('ie.replaces', '— replaces the current file and is re-validated on save.')}</div>}
          {file && noSubmitSpace && (
            <div className="mt-1.5 text-xs text-red-400 flex items-center gap-1.5"><AlertTriangle size={12} /> {t('sub.nospace', 'Submission storage is full right now — every upload is held for moderation and there is no room left. Try again later, or self-host and paste a URL above instead.')}</div>
          )}
          {file && quote && !quote.free && quote.monthlyCents > 0 && (
            <div className="mt-1.5 text-xs text-amber-400/90 flex items-center gap-1.5"><Receipt size={12} /> {t('ie.replacecost', 'This size is billed: {price}/mo — you\'ll be sent to checkout after saving.').replace('{price}', `$${(quote.monthlyCents / 100).toFixed(2)}`)}</div>
          )}
        </div>
      )}
      {ourHosted && item.meta?._hostingSubId && (
        <div className="mt-3 rounded-lg border border-red-500/25 bg-red-500/8 p-2.5 text-xs text-[var(--muted)] flex items-center gap-2 flex-wrap">
          <Receipt size={13} className="text-red-400 shrink-0" />
          <span className="flex-1">{t('ie.hostactive', 'This file is on a recurring monthly hosting subscription.')}</span>
          {confirmCancelHost
            ? <span className="flex items-center gap-2"><span className="text-red-400">{t('ie.hostcancelq', 'Cancel and hide this item?')}</span>
                <Button size="sm" className="!bg-red-500/15 !text-red-400 !border-red-500/30" disabled={busy} onClick={cancelHosting}>{busy ? <Spinner /> : t('ie.yescancel', 'Yes, cancel')}</Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmCancelHost(false)}>{t('ie.no', 'No')}</Button></span>
            : <Button size="sm" variant="ghost" className="!text-red-400" onClick={() => setConfirmCancelHost(true)}>{t('ie.cancelhosting', 'Cancel hosting')}</Button>}
        </div>
      )}
      {isPlugin && !ourHosted && item.meta?.download_url && (
        <div className="mt-3 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-2.5 text-xs text-[var(--muted)]">{t('ie.selfhosted1', 'This plugin is self-hosted. Point')} <code>download_url</code> {t('ie.selfhosted2', '(below) at a new')} <code>.bmmplug</code>{t('ie.selfhosted3', '; it is re-validated on save.')}</div>
      )}

      <div className="mt-3"><div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-1.5">{t('sub.metadata', 'Metadata (JSON)')}</div>
        <JsonEditor value={form.meta} onChange={(meta) => setForm({ ...form, meta })} /></div>
    </Modal>
  );
}

// Per-type copy + generator templates so the form adapts to what's being submitted.
const KIND_COPY = {
  APP: { name: 'My companion app', desc: 'A tool that works alongside BMM.', file: 'Payload file (zip / exe)', tmpl: { id: 'my-app', title: 'My App', category: 'utility', price: 'free', tags: [], download: { url: 'https://…/app.exe', file_type: 'exe', sha256: '' } } },
  PLUGIN: { name: 'Auto Backup', desc: 'What does this plugin do?', file: 'Plugin file (.bmmplug)', tmpl: { id: 'auto-backup', download_url: 'https://…/auto-backup.bmmplug', sha256: '', permissions: [] } },
  THEME: { name: 'Midnight Orange', desc: 'A dark, warm UI theme.', file: 'Theme file (.bmmtheme)', tmpl: { author: '', url: 'https://…' } },
  PRESET: { name: 'Afterburner Boom', desc: 'A punchy engine sound preset.', file: 'Preset .json file', tmpl: { name: '', version: '1.0.0', assetPaths: [] } },
};

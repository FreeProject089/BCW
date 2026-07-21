import { useEffect, useState, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Link, useParams, useSearchParams, useNavigate } from 'react-router-dom';
import {
  Boxes, Music2, Puzzle, Palette, Server, Rocket, Download, ArrowRight, Search, Upload,
  Bell, CheckCircle2, XCircle, Clock, Package, ShieldCheck, Inbox, Tag, FileJson, HardDrive, HelpCircle,
  Cpu, Gauge, TrendingUp, Eye, Sparkles, Lock, Zap, Users, GitBranch, Settings2,
  Newspaper, LayoutDashboard, Cookie, Sliders, Heart, Trash2, PenSquare, Star, Bell as BellIcon, CheckCheck, ArrowUpRight,
  Receipt, Wand2, Plus, Link2, Copy, Globe, BadgeCheck, Mail, Send, MessageSquare, Files, RefreshCw, X, ChevronDown, Monitor, MonitorOff, AlertTriangle, Ticket,
  CreditCard, Gift, Archive, Shield, Ban, FolderGit2, FileText, History, Target, Megaphone, EyeOff, Rss,
  Info, Orbit, Fingerprint, Layers, MapPin, Globe2, Activity, Building2, Map as MapIcon, ShoppingCart,
  Mic, KeyRound, MousePointerClick, PanelTop, Navigation, Save, Loader2,
  Home as HomeIcon, BookOpen, LayoutGrid, Smartphone, Monitor as MonitorIcon, Upload as UploadIcon, RotateCcw, Calendar,
} from 'lucide-react';
import { api, uploadPayload, uploadImage, uploadAsset } from '../lib/api.js';
import { useAuth } from './auth.jsx';
import { useI18n } from '../i18n.jsx';
import { useTheme } from '../ui/theme.jsx';
import { getConsent, setConsent } from '../lib/analytics.js';
import { SKIP_KEY, useIntro } from '../ui/IntroContext.jsx';
import { getGlassPrefs, setGlassPrefs, getOrbTransitionPref, setOrbTransitionPref } from '../lib/prefs.js';
import { TotpQuickFill } from './twofa-fill.jsx';
import { AuthorsRow, MarkdownEditor } from './blog.jsx';
import Avatar, { VARIANTS as AV_VARIANTS, PALETTES as AV_PALETTES } from '../ui/Avatar.jsx';
import { Badges, BadgeIcon } from '../ui/Badges.jsx';
import { ReportThread, ReportComposer, ReportModal } from '../ui/report.jsx';

// A stable-but-varied Boring-avatar look for an anonymous analytics session (keyed by
// the visitor hash) — so each session gets its OWN geometric avatar instead of the
// generic BC brand icon, and the same visitor always looks the same.
const AV_PAL_LIST = Object.values(AV_PALETTES);
export function seededAvatar(seed) {
  let h = 0; const s = String(seed || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return { variant: AV_VARIANTS[h % AV_VARIANTS.length], colors: AV_PAL_LIST[(h >> 5) % AV_PAL_LIST.length] };
}
import { createRoot } from 'react-dom/client';
import { AppLogo, KofiIcon, GithubIcon, DiscordIcon, RedditIcon, GoogleIcon } from '../ui/brand.jsx';
import { Button, Card, Badge, Input, Textarea, Select, Dropdown, Field, PageHeader, EmptyState, Spinner, Modal, useDialog, useToast, copyText } from '../ui/ui.jsx';
import Markdown, { ShowcaseIcon } from '../ui/md.jsx';
import IconPicker from '../editor/icon-picker.jsx';
import { IconGlyph } from '../ui/md.jsx';
import ProjectConfigEditor from '../editor/project-config-editor.jsx';

/* ── helpers ── */
export function useAsync(fn, deps = []) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);
  const reload = () => { setLoading(true); return fn().then((d) => { setData(d); setErr(null); }).catch(setErr).finally(() => setLoading(false)); };
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, deps);
  return { data, err, loading, reload };
}

// Measure an element's live pixel width (ResizeObserver). Used to size SVG charts so
// their viewBox matches real pixels 1:1 — keeps axis/label text legible on phones
// instead of shrinking with a fixed-width viewBox.
export function useElementWidth(fallback = 760) {
  const ref = useRef(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => { const cw = e.contentRect.width; if (cw > 0) setW(Math.round(cw)); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}
export const KIND_ICON = { APP: Boxes, PLUGIN: Puzzle, THEME: Palette, PRESET: FileJson };
export const KIND_LABEL = { APP: 'App', PLUGIN: 'Plugin', THEME: 'Theme', PRESET: 'Preset' };
export const statusTone = (s) => s === 'PUBLISHED' ? 'green' : (s === 'REJECTED' || s === 'SUSPENDED') ? 'red' : 'amber';
export const Loading = () => <div className="flex items-center gap-2 text-[var(--muted)] py-10"><Spinner /> Loading…</div>;

// Optimistic, undoable delete/revoke. `del(id, run, msg)` hides the row immediately (add id
// to `pending`, filter your list by !pending.has(id)) and shows a "Undo" toast; the actual
// `run()` (the DELETE) only fires when the window elapses — Undo means nothing was ever
// sent. On failure the row is un-hidden. Shared so admin.jsx AND admin-myo.jsx use one copy.
export function useUndoableDelete(reload) {
  const toast = useToast(); const { t } = useI18n();
  const [pending, setPending] = useState(() => new Set());
  const unhide = (id) => setPending((s) => { const n = new Set(s); n.delete(id); return n; });
  const del = (id, run, msg) => {
    setPending((s) => new Set(s).add(id));
    toast.action({
      tone: 'success', duration: 6000, cancelLabel: t('common.undo', 'Undo'), msg,
      onCommit: async () => { try { await run(); reload?.(); } catch { toast.error(t('common.failed', 'Failed.')); unhide(id); } },
      onCancel: () => unhide(id),
    });
  };
  return { pending, del };
}
// Optimistic, undoable field mutation (a toggle or small edit that would otherwise fire an
// immediate PATCH/PUT). `act(id, patch, run, msg)` overlays `patch` on the row right away —
// read the displayed row through `apply(row)` — shows an "Undo" toast, and only fires `run()`
// (the actual request) once the window elapses. Undo means the server was never touched. The
// override is held until a post-commit reload lands so the value never flashes back. Mirrors
// useUndoableDelete; shared so any admin panel gets the same feel.
export function useUndoableToggle(reload) {
  const toast = useToast(); const { t } = useI18n();
  const [overrides, setOverrides] = useState(() => new Map());
  const clear = (id) => setOverrides((m) => { const n = new Map(m); n.delete(id); return n; });
  const apply = (row) => { const o = overrides.get(row.id); return o ? { ...row, ...o } : row; };
  const act = (id, patch, run, msg) => {
    setOverrides((m) => new Map(m).set(id, patch));
    toast.action({
      tone: 'info', duration: 6000, cancelLabel: t('common.undo', 'Undo'), msg,
      onCommit: async () => { try { await run(); } catch { toast.error(t('common.failed', 'Failed.')); } await reload?.(); clear(id); },
      onCancel: () => clear(id),
    });
  };
  return { overrides, apply, act };
}
// CSV cell that is safe against spreadsheet formula injection (CWE-1236): a value that
// starts with =, @, or a +/- that isn't a plain number is prefixed with ' so Excel/Sheets
// treat it as text, then quoted if it contains CSV specials. Analytics paths, emails, IPs,
// audit details etc. can be attacker-influenced, so every export routes through this.
export const csvCell = (s) => {
  let v = String(s ?? '');
  if (/^[=@\t\r]/.test(v) || (/^[+\-]/.test(v) && !Number.isFinite(Number(v)))) v = `'${v}`;
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
};
// Coarse "time left" for a scheduled deletion.
export function fmtRemaining(deleteAt) {
  const ms = new Date(deleteAt).getTime() - Date.now();
  if (ms <= 0) return 'soon';
  const h = Math.floor(ms / 3600000);
  return h >= 1 ? `${h}h` : `${Math.max(1, Math.floor(ms / 60000))}m`;
}

// A friendlier JSON editor: framed panel with a live valid/invalid indicator, a
// one-click Format button, and tab-to-indent — replaces the raw ugly <textarea>.
export function JsonEditor({ value, onChange, placeholder, minH = 170 }) {
  const [err, setErr] = useState(null);
  useEffect(() => { try { if ((value || '').trim()) JSON.parse(value); setErr(null); } catch (e) { setErr(String(e.message || e)); } }, [value]);
  const format = () => { try { onChange(JSON.stringify(JSON.parse(value || '{}'), null, 2)); } catch {} };
  const onKey = (e) => {
    if (e.key === 'Tab') { // indent instead of leaving the field
      e.preventDefault(); const el = e.target; const s = el.selectionStart, en = el.selectionEnd;
      onChange(value.slice(0, s) + '  ' + value.slice(en));
      requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = s + 2; });
    }
  };
  return (
    <div className={`rounded-xl border overflow-hidden transition-colors ${err ? 'border-red-500/40' : 'border-[var(--line)]'}`} style={{ background: 'var(--surface-2)' }}>
      <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-[var(--line)]">
        <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--faint)]"><FileJson size={12} /> JSON</span>
        <div className="flex items-center gap-2.5 text-[10px]">
          <span className={`flex items-center gap-1 ${err ? 'text-red-400' : 'text-emerald-400'}`}><span className={`w-1.5 h-1.5 rounded-full ${err ? 'bg-red-400' : 'bg-emerald-400'}`} />{err ? 'invalid' : 'valid'}</span>
          <button type="button" onClick={format} className="flex items-center gap-1 text-[var(--muted)] hover:text-[var(--text)]"><Wand2 size={11} /> Format</button>
        </div>
      </div>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={onKey} placeholder={placeholder} spellCheck={false}
        className="w-full bg-transparent px-3 py-2.5 font-mono text-xs leading-relaxed outline-none resize-y text-[var(--text)]" style={{ minHeight: minH }} />
      {err && <div className="px-3 py-1.5 text-[10px] text-red-400 border-t border-red-500/20 truncate" title={err}>{err}</div>}
    </div>
  );
}

// Pro dashboard shell: a sticky left sidebar of sections + a content pane.
// `tabs`: [{ id, label, icon, badge? }] — or a `{ heading }` entry (no id) to group
// tabs under a small non-clickable section label (e.g. long admin sidebars).
// Persists the active tab in the URL (?s=).
export function SideDash({ title, subtitle, icon, tabs, headerActions, children }) {
  const [sp, setSp] = useSearchParams();
  const [navOpen, setNavOpen] = useState(false);
  const realTabs = tabs.filter((t) => t.id);
  const active = sp.get('s') || realTabs[0]?.id;
  const set = (id) => { setSp((p) => { const n = new URLSearchParams(p); n.set('s', id); return n; }, { replace: true }); setNavOpen(false); };
  const current = realTabs.find((t) => t.id === active) || realTabs[0];
  const idx = realTabs.findIndex((t) => t.id === active);
  // One row renderer, reused by the desktop sidebar and the mobile sheet.
  const renderTab = (tb, big) => (
    <button key={tb.id} onClick={() => set(tb.id)}
      className={`flex items-center gap-2.5 px-3 ${big ? 'py-2.5' : 'py-2'} rounded-xl text-sm text-left w-full whitespace-nowrap transition-colors press ${active === tb.id ? 'bg-[var(--surface-2)] text-[var(--text)] border border-[var(--line)] font-medium' : 'text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] border border-transparent'}`}>
      <tb.icon size={16} className={`shrink-0 ${active === tb.id ? 'text-[var(--primary-2)]' : ''}`} /> <span className="min-w-0 truncate">{tb.label}</span>
      {tb.badge ? <Badge tone="primary" className="ml-auto shrink-0">{tb.badge}</Badge> : null}
    </button>
  );
  return (
    <div>
      <PageHeader icon={icon} title={title} subtitle={subtitle} actions={headerActions} />

      {/* Mobile (<md): the ~15-tab sidebar becomes a proper dropdown sheet — a
          cramped horizontal scroll strip of tabs + section headings is unusable on
          a phone. Shows the current section; tapping opens the grouped list. */}
      <div className="md:hidden mb-4 relative z-20">
        <button onClick={() => setNavOpen((o) => !o)} aria-expanded={navOpen}
          className="card w-full flex items-center gap-2.5 px-4 py-3 text-sm font-medium press">
          {current?.icon && <current.icon size={16} className="text-[var(--primary-2)]" />}
          <span className="flex-1 text-left truncate">{current?.label}</span>
          <span className="text-[11px] text-[var(--faint)] tabular-nums">{idx + 1}/{realTabs.length}</span>
          <ChevronDown size={16} className={`text-[var(--muted)] transition-transform duration-200 ${navOpen ? 'rotate-180' : ''}`} />
        </button>
        {navOpen && <>
          <div className="fixed inset-0 z-10" onClick={() => setNavOpen(false)} />
          <div className="card absolute left-0 right-0 mt-2 p-2 anim-pop z-20 max-h-[62vh] overflow-y-auto scroll-thin shadow-lg">
            {tabs.map((tb, i) => tb.heading
              ? <div key={`h-${i}`} className="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--faint)] first:pt-1">{tb.heading}</div>
              : renderTab(tb, true))}
          </div>
        </>}
      </div>

      <div className="grid md:grid-cols-[220px_1fr] gap-6">
        {/* Desktop sidebar — a real card panel behind the whole nav (not just the
            active pill) so it feels grounded next to the content cards. */}
        <nav className="hidden md:flex card p-2 flex-col gap-1 md:sticky md:top-20 self-start pb-2">
          {tabs.map((tb, i) => tb.heading ? (
            <div key={`h-${i}`} className="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--faint)] first:pt-1">{tb.heading}</div>
          ) : renderTab(tb))}
        </nav>
        <div className="min-w-0">{typeof children === 'function' ? children(current.id) : children}</div>
      </div>
    </div>
  );
}

/* ─────────────────────────  Installer  ───────────────────────── */
export function Installer() {
  const { t } = useI18n();
  const feats = [[Zap, t('inst.feat1', 'Fast & lightweight'), t('inst.feat1.d', 'A native installer that gets out of your way.')],
    [ShieldCheck, t('inst.feat2', 'Signed & verified'), t('inst.feat2.d', 'Integrity-checked payloads, every release.')],
    [GitBranch, t('inst.feat3', 'Smart updates'), t('inst.feat3.d', 'Delta updates keep downloads tiny.')],
    [Settings2, t('inst.feat4', 'Full control'), t('inst.feat4.d', 'Pick components, paths and channels.')]];
  return (
    <div>
      <section className="text-center py-10">
        <div className="inline-flex items-center gap-2 badge badge-primary mb-5"><Download size={13} /> BetterInstaller</div>
        <h1 className="text-4xl md:text-5xl font-extrabold">{t('inst.hero1', 'The modern installer')}<br />{t('inst.hero2', 'for the')} <span className="gradient-text">Better*</span>{t('inst.hero3', ' suite.')}</h1>
        <p className="text-[var(--muted)] text-lg max-w-xl mx-auto mt-5">{t('inst.sub', 'A fast, secure NSIS/MSI replacement with a clean UI, delta updates and a handoff contract with the app.')}</p>
        <div className="flex gap-3 justify-center mt-8">
          <Button variant="primary"><Download size={16} /> {t('inst.download', 'Download for Windows')}</Button>
          <Button>{t('inst.releases', 'Release notes')}</Button>
        </div>
        <div className="text-xs text-[var(--faint)] mt-3">{t('inst.platform', 'Windows 10/11 · 64-bit')}</div>
      </section>
      <section className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {feats.map(([I, title, d]) => <Card key={title} className="p-5"><I size={20} className="text-[var(--primary-2)]" /><div className="font-semibold mt-3">{title}</div><div className="text-sm text-[var(--muted)] mt-1">{d}</div></Card>)}
      </section>
      <Card className="p-8 mt-6 text-center bg-gradient-to-b from-orange-500/10 to-transparent">
        <Sparkles size={22} className="mx-auto text-[var(--primary-2)]" />
        <div className="font-semibold text-lg mt-2">{t('inst.dev', 'In active development')}</div>
        <p className="text-sm text-[var(--muted)] mt-1 max-w-md mx-auto">{t('inst.dev.d', 'BetterInstaller is being built as a separate Slint-based app. Follow progress on the blog.')}</p>
      </Card>
    </div>
  );
}


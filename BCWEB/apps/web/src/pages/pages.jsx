import { useEffect, useState, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import Prism from 'prismjs';
import 'prismjs/components/prism-json';
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
  // `quiet` refetches WITHOUT flipping `loading`. A live thread reloads on every incoming
  // message, and flipping `loading` swaps the whole conversation for a spinner each time —
  // the page visibly blinked on every message, which is the opposite of what a live chat
  // should feel like. The new data still replaces the old in one render; only the
  // intermediate "we are loading" state is skipped.
  const reload = (quiet = false) => {
    if (!quiet) setLoading(true);
    return fn().then((d) => { setData(d); setErr(null); }).catch(setErr).finally(() => { if (!quiet) setLoading(false); });
  };
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, deps);
  return { data, err, loading, reload };
}

// Subscribe to a conversation thread's SSE stream and run `onEvent` for each event.
//
// `onEvent` is held in a ref rather than being a dependency: it is almost always an inline
// arrow, so depending on it would tear down and rebuild the EventSource on every render —
// reconnecting constantly, and dropping messages in the gaps.
//
// EventSource sends the session cookie on same-origin requests, which is what authenticates
// the stream; it also reconnects on its own, so a dropped connection needs no handling here.
// A null `path` disables it (a thread that is not open yet).
export function useThreadStream(path, onEvent) {
  const cb = useRef(onEvent);
  cb.current = onEvent;
  useEffect(() => {
    if (!path || typeof EventSource === 'undefined') return;
    const es = new EventSource(`/api${path}`);
    es.onmessage = (e) => {
      // A malformed frame must not kill the subscription — skip it and keep listening.
      try { cb.current?.(JSON.parse(e.data)); } catch { /* ignore */ }
    };
    return () => es.close();
  }, [path]);
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
// Undoable SAVE — the third member of the family, for a form's "Save"/"Publish" button.
// `save(run, msg, opts)` defers `run()` (the PUT/POST) behind the undo window and reloads
// after it lands; Undo means the request was never sent, so there is nothing to roll back.
//
// Use `opts.onSettled` for the busy flag: it fires on BOTH paths, so a spinner can't be left
// spinning when the user cancels. `opts.errorFor(x)` maps a server error to a message.
export function useUndoableSave(reload) {
  const toast = useToast(); const { t } = useI18n();
  return (run, msg, opts = {}) => {
    toast.action({
      tone: 'success', duration: 6000, cancelLabel: t('common.undo', 'Undo'), msg,
      onCommit: async () => {
        try { await run(); await reload?.(); }
        catch (x) { toast.error(opts.errorFor?.(x) || x?.data?.detail || x?.data?.error || t('common.failed', 'Failed.')); }
        finally { opts.onSettled?.(); }
      },
      onCancel: () => { opts.onCancel?.(); opts.onSettled?.(); },
    });
  };
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
// Both layers must lay text out identically or the caret and the glyphs part company.
const EDITOR_TEXT = 'px-3 py-2.5 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words';

/** JSON, highlighted with Prism into the classes prism-bmm.css already styles. Escaped first:
 *  this renders with dangerouslySetInnerHTML, and the value is whatever is being typed. */
// Exported for the Projects-config editor, which has its own chrome (line gutter, fixed
// height) and so reuses the highlighting rather than the whole JsonEditor.
//
// Safe for dangerouslySetInnerHTML: Prism.highlight() escapes the source it tokenises, and
// the no-Prism fallback escapes explicitly. Nothing here interpolates raw input.
export function highlightJson(src) {
  const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  try {
    if (Prism?.languages?.json) return Prism.highlight(src, Prism.languages.json, 'json');
  } catch { /* fall through to plain text */ }
  return esc(src);
}

export function JsonEditor({ value, onChange, placeholder, minH = 170 }) {
  const [err, setErr] = useState(null);
  const taRef = useRef(null); const preRef = useRef(null);
  // The overlay does not scroll on its own; it follows the textarea exactly.
  const syncScroll = () => { if (preRef.current && taRef.current) { preRef.current.scrollTop = taRef.current.scrollTop; preRef.current.scrollLeft = taRef.current.scrollLeft; } };
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
    <div className={`rounded-xl border overflow-hidden transition-colors ${err ? 'border-error-border' : 'border-[var(--line)]'}`} style={{ background: 'var(--surface-2)' }}>
      <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-[var(--line)]">
        <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--faint)]"><FileJson size={12} /> JSON</span>
        <div className="flex items-center gap-2.5 text-[10px]">
          <span className={`flex items-center gap-1 ${err ? 'text-error' : 'text-success'}`}><span className={`w-1.5 h-1.5 rounded-full ${err ? 'bg-error' : 'bg-success'}`} />{err ? 'invalid' : 'valid'}</span>
          <button type="button" onClick={format} className="flex items-center gap-1 text-[var(--muted)] hover:text-[var(--text)]"><Wand2 size={11} /> Format</button>
        </div>
      </div>
      {/* Highlighted overlay: a <pre> Prism paints, with the real <textarea> transparent on top.
          A textarea cannot render markup, so this is the only way to colour what is being typed.
          The two must agree on font, size, line-height, padding and wrapping or the caret drifts
          away from the glyphs — hence the shared EDITOR_TEXT class rather than two style props. */}
      <div className="relative">
        <pre aria-hidden="true" ref={preRef}
             className={`${EDITOR_TEXT} pointer-events-none absolute inset-0 overflow-hidden m-0`}
             style={{ minHeight: minH }}><code className="language-json"
             dangerouslySetInnerHTML={{ __html: highlightJson(value || '') }} /></pre>
      <textarea ref={taRef} onScroll={syncScroll} value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={onKey} placeholder={placeholder} spellCheck={false}
        className={`${EDITOR_TEXT} relative w-full bg-transparent outline-none resize-y text-transparent caret-[var(--text)]`} style={{ minHeight: minH }} />
      </div>
      {err && <div className="px-3 py-1.5 text-[10px] text-error border-t border-error-border truncate" title={err}>{err}</div>}
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
  // Sections, so a heading can fold the tabs under it. The flat `tabs` array stays the
  // public shape — callers keep passing `{heading}` markers and know nothing about this.
  // A leading run with no heading becomes an unnamed section, which is never collapsible:
  // hiding tabs behind nothing would leave a fold with no label to reopen it.
  const sections = [];
  for (const tb of tabs) {
    if (tb.heading) sections.push({ heading: tb.heading, items: [] });
    else {
      if (!sections.length) sections.push({ heading: null, items: [] });
      sections[sections.length - 1].items.push(tb);
    }
  }
  // Collapsed state is per session and per heading. Kept in sessionStorage rather than
  // localStorage: folding a section to get through a long list is a working posture, not a
  // preference you want greeting you in a week with half the admin apparently missing.
  const [collapsed, setCollapsed] = useState(() => {
    try { return new Set(JSON.parse(sessionStorage.getItem('bcw_sidedash_collapsed') || '[]')); }
    catch { return new Set(); }
  });
  const toggleSection = (heading) => setCollapsed((prev) => {
    const next = new Set(prev);
    next.has(heading) ? next.delete(heading) : next.add(heading);
    try { sessionStorage.setItem('bcw_sidedash_collapsed', JSON.stringify([...next])); } catch { /* private mode */ }
    return next;
  });
  const active = sp.get('s') || realTabs[0]?.id;
  const set = (id) => { setSp((p) => { const n = new URLSearchParams(p); n.set('s', id); return n; }, { replace: true }); setNavOpen(false); };
  const current = realTabs.find((t) => t.id === active) || realTabs[0];
  const idx = realTabs.findIndex((t) => t.id === active);
  // A section, reused by the desktop sidebar and the mobile sheet so the two can never
  // drift into disagreeing about what is folded.
  const renderSection = (sec, i, big) => {
    // Never fold away the section holding the tab you are looking at — the content would
    // stay on screen with nothing in the nav pointing at it.
    // A heading with nothing under it would render a fold that opens onto nothing.
    if (!sec.items.length) return null;
    const holdsActive = sec.items.some((tb) => tb.id === active);
    const isFolded = !!sec.heading && collapsed.has(sec.heading) && !holdsActive;
    return (
      <div key={sec.heading || `s-${i}`} className="contents">
        {sec.heading && (
          <button type="button" onClick={() => toggleSection(sec.heading)} aria-expanded={!isFolded}
            className="flex items-center gap-1 w-full px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--faint)] hover:text-[var(--text)] transition-colors first:pt-1">
            <ChevronDown size={12} className={`transition-transform duration-200 ${isFolded ? '-rotate-90' : ''}`} />
            <span className="truncate">{sec.heading}</span>
            {isFolded && <span className="ml-auto tabular-nums opacity-70">{sec.items.length}</span>}
          </button>
        )}
        {!isFolded && sec.items.map((tb) => renderTab(tb, big))}
      </div>
    );
  };
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
            {sections.map((sec, i) => renderSection(sec, i, true))}
          </div>
        </>}
      </div>

      <div className="grid md:grid-cols-[220px_1fr] gap-6">
        {/* Desktop sidebar — a real card panel behind the whole nav (not just the
            active pill) so it feels grounded next to the content cards. */}
        <nav className="hidden md:flex card p-2 flex-col gap-1 md:sticky md:top-20 self-start pb-2">
          {sections.map((sec, i) => renderSection(sec, i, false))}
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
      <Card className="p-8 mt-6 text-center bg-gradient-to-b from-brand to-transparent">
        <Sparkles size={22} className="mx-auto text-[var(--primary-2)]" />
        <div className="font-semibold text-lg mt-2">{t('inst.dev', 'In active development')}</div>
        <p className="text-sm text-[var(--muted)] mt-1 max-w-md mx-auto">{t('inst.dev.d', 'BetterInstaller is being built as a separate Slint-based app. Follow progress on the blog.')}</p>
      </Card>
    </div>
  );
}


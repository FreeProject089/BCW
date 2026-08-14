import { useEffect, useState, useRef, useMemo } from 'react';
import { lucideFileName } from '../editor/icon-picker.jsx';
import { Link, useSearchParams } from 'react-router-dom';
import {
  BarChart3, Boxes, Music2, Puzzle, Server, Rocket, Download, ArrowRight, Search, Upload, Bell, CheckCircle2, XCircle, Clock, Package, ShieldCheck, Inbox, Tag, FileJson, HardDrive, HelpCircle, Cpu, Gauge, TrendingUp, Eye, Sparkles, Lock, Zap, Users, GitBranch, Settings2, Newspaper, LayoutDashboard, Cookie, Sliders, Heart, Trash2, PenSquare, Star, Bell as BellIcon, CheckCheck, ArrowUpRight, Receipt, Wand2, Plus, Link2, Copy, Globe, BadgeCheck, Mail, Send, MessageSquare, Files, RefreshCw, X, ChevronDown, Monitor, MonitorOff, AlertTriangle, Ticket, CreditCard, Gift, Archive, Shield, Ban, FolderGit2, FileText, History, Target, Megaphone, EyeOff, Rss, Info, Fingerprint, Layers, MapPin, Globe2, Activity, Building2, Map as MapIcon, Mic, KeyRound, MousePointerClick, PanelTop, Navigation, Save, Loader2, BookOpen, LayoutGrid, Smartphone, Monitor as MonitorIcon, Upload as UploadIcon, RotateCcw, Calendar, Minus, Sun, Moon, Languages, LogOut, LogIn, User as UserIcon, Settings as SettingsIcon, GripVertical, Check, ExternalLink, Palette, Pencil, Gavel, Code2
} from 'lucide-react';
import { Button, Card, Badge, Input, Textarea, Select, Dropdown, Field, EmptyState, Spinner, Modal, ActionBar, useDialog, useToast, copyText } from '../ui/ui.jsx';
import { AppLogo } from '../ui/brand.jsx';
import Markdown, { IconGlyph, ShowcaseIcon } from '../ui/md.jsx';
import IconPicker from '../editor/icon-picker.jsx';
import ProjectConfigEditor from '../editor/project-config-editor.jsx';
import { createRoot } from 'react-dom/client';
import { KofiIcon, DiscordIcon } from '../ui/brand.jsx';
import { api, uploadPayload, uploadImage, uploadAsset } from '../lib/api.js';
import Avatar from '../ui/Avatar.jsx';
import { THEME_PRESETS } from '../ui/theme-presets.js';
import { defaultFooterConfig, DEFAULT_FOOTER_SOCIALS } from '../ui/footer-default.js';
import { TOKENS, TOKEN_GROUPS } from '../ui/theme-tokens.js';
import { themeCss, applySiteTheme, inkOn, contrastRatio } from '../ui/theme.jsx';
import { useAuth } from './auth.jsx';
import { utilAllowed, effectiveCaps } from '../lib/roles.js';
import { readLayout, navAlignClass } from '../lib/navLayout.js';
import { useI18n } from '../i18n.jsx';
import { useTheme } from '../ui/theme.jsx';
import { rawStatusLabel, DotDropdown } from './repos.jsx';
import { AdminRepos, AdminPools } from './repos-admin.jsx';
import { TotpQuickFill } from './twofa-fill.jsx';
import { MarkdownEditor } from './blog.jsx';
import { Badges, BadgeIcon } from '../ui/Badges.jsx';
import { ReportThread, ReportComposer, ReportModal } from '../ui/report.jsx';
import { AdminMyo } from './admin-myo.jsx';
import { AdminApi } from './admin-api.jsx';
import { AdminSanctions } from './admin-sanctions.jsx';
import { AdminPolls } from './admin-polls.jsx';
import { useAsync, Loading, useUndoableDelete, useUndoableToggle, useUndoableSave, useElementWidth, statusTone, KIND_ICON, KIND_LABEL, csvCell, fmtRemaining, seededAvatar, JsonEditor, highlightJson, SideDash, useThreadStream } from './pages.jsx';

// Deferred-commit delete with a Gmail-style undo toast. The row hides immediately and the
// actual api.del only fires once the 6s window elapses — Undo means nothing was ever deleted,
// no email sent, no round-trip. Replaces a confirm modal, which asks BEFORE and can't take it
// back AFTER. Returns { pending, del }: filter your list by `!pending.has(id)`, and call
// The background-image for the preview pane.
//
// `var(--page-glows)` alone would be wrong: themeCss only emits that property when a glow
// list is CONFIGURED, and an unresolved var() with no fallback makes background-image
// `none`. The preview would then show a bare colour for every unconfigured theme while the
// real page shows three glows — a preview that lies in the default case, which is the case
// most people look at it in.
function previewGlowCss(f) {
  const active = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  const list = Array.isArray(f?.[active]?.glows) ? f[active].glows : DEFAULT_GLOWS(active);
  if (!list.length) return 'none'; // an explicit empty list IS a flat background
  return list
    .map((g) => `radial-gradient(${g.w ?? 55}% ${g.h ?? 55}% at ${g.x ?? 50}% ${g.y ?? 0}%, ${g.color}, transparent ${g.fade ?? 60}%)`)
    .join(',');
}

// The shipped glow stack per mode, as data — the starting point when an admin takes the
// background over. These mirror the fallbacks in index.css; they are not read from it,
// so if the CSS stack changes these want changing with it.
const DEFAULT_GLOWS = (mode) => (mode === 'light'
  ? [
    { color: 'rgba(249,115,22,.14)', w: 58, h: 42, x: 80, y: -12, fade: 60 },
    { color: 'rgba(245,158,11,.12)', w: 46, h: 40, x: -6, y: 6, fade: 56 },
    { color: 'rgba(249,115,22,.07)', w: 90, h: 46, x: 50, y: 118, fade: 62 },
  ]
  : [
    { color: 'rgba(249,115,22,.16)', w: 60, h: 52, x: 82, y: -14, fade: 56 },
    { color: 'rgba(245,158,11,.12)', w: 48, h: 46, x: -8, y: 4, fade: 56 },
    { color: 'rgba(245,158,11,.07)', w: 130, h: 90, x: 50, y: 128, fade: 60 },
  ]);

// <input type="color"> only speaks #rrggbb, but a glow is usually an rgba() with the alpha
// carrying most of the effect. The swatch shows the closest hex so the picker is usable;
// the text field beside it stays the source of truth for anything with transparency.
function hexOf(v) {
  const m = String(v || '').match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
  if (m) return '#' + m.slice(1, 4).map((n) => Number(n).toString(16).padStart(2, '0')).join('');
  return /^#[0-9a-f]{6}$/i.test(String(v || '')) ? v : '#f97316';
}

/* ─────────────────────────  Admin  ───────────────────────── */
export function Admin() {
  const { user } = useAuth(); const dialog = useDialog(); const toast = useToast(); const { t } = useI18n();
  const [modQ, setModQ] = useState(''); const [modQApplied, setModQApplied] = useState('');
  const [modSort, setModSort] = useState('oldest'); const [modKind, setModKind] = useState(''); const [modType, setModType] = useState(''); const [modStatus, setModStatus] = useState('PENDING');
  const subs = useAsync(() => api.get(`/mod/submissions?q=${encodeURIComponent(modQApplied)}&sort=${modSort}&kind=${modKind}&type=${modType}&status=${modStatus}`), [modQApplied, modSort, modKind, modType, modStatus]);
  // Moderating notifies the author (and suspend blocks resubmission), so every verdict gets
  // an undo window. The API call is DEFERRED, not reversed: the card hides immediately, and
  // nothing is sent — no mail, no state change — unless the window elapses. Undo means the
  // author never knew.
  const [modPending, setModPending] = useState(new Set()); // ids hidden during their window
  const unhideSub = (id) => setModPending((s) => { const n = new Set(s); n.delete(id); return n; });
  const modVerdict = (s, url, body, msg) => {
    setModPending((p) => new Set(p).add(s.id));
    setReview((r) => (r?.id === s.id ? null : r)); // close the review modal if it's this one
    toast.action({
      tone: 'success', duration: 6000, cancelLabel: t('common.undo', 'Undo'), msg,
      onCommit: async () => {
        try { await api.post(url, body); subs.reload(); }
        catch { toast.error(t('mod.failed', 'Failed.')); }
        finally { unhideSub(s.id); } // reload() drops it from the list when it really applied
      },
      onCancel: () => unhideSub(s.id),
    });
  };
  const approve = (s) => modVerdict(s, `/mod/submissions/${s.id}/approve`, undefined, t('mod.approved', 'Approved "{name}".').replace('{name}', s.item?.name));
  const reject = async (s) => {
    const reason = await dialog.prompt({ title: t('mod.reject.title', 'Reject submission'), label: t('mod.reject.label', 'Reason (sent to the author)'), placeholder: t('mod.reject.ph', 'Why is this rejected?'), okLabel: t('mod.reject.ok', 'Reject'), danger: true });
    if (!reason) return;
    modVerdict(s, `/mod/submissions/${s.id}/reject`, { reason }, t('mod.rejected', 'Rejected and author notified.'));
  };
  // Suspend (ADMIN): harsher than reject — the owner can't resubmit. Reversible via approve/reject.
  const suspend = async (s) => {
    const reason = await dialog.prompt({ title: t('mod.suspend.title', 'Suspend submission'), label: t('mod.suspend.label', 'Reason (sent to the author)'), placeholder: t('mod.suspend.ph', "Why is this suspended? The author can't resubmit."), okLabel: t('mod.suspend.ok', 'Suspend'), danger: true });
    if (!reason) return;
    modVerdict(s, `/mod/submissions/${s.id}/suspend`, { reason }, t('mod.suspended2', 'Suspended — the author can no longer resubmit.'));
  };
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPERADMIN';
  const isSuperAdmin = user?.role === 'SUPERADMIN';
  const isMod = isAdmin || user?.role === 'MOD';
  // A tab is visible if the user is an admin, has the capability granted (individually OR
  // via a custom role — effectiveCaps), or is a MOD for the capabilities MODs hold by
  // default (users/repos) — mirrors the server's requireCap.
  const caps = effectiveCaps(user);
  const can = (c) => isAdmin || caps.includes(c) || (isMod && ['manage_users', 'manage_repos'].includes(c));
  // Per-project edit grants (ProjectPermission) let a non-admin reach the project tabs even
  // with no capability — scoped to what they were granted (the tab itself scopes further).
  const pg = user?.projectGrants || {};
  const canShowcaseTab = can('manage_showcase') || !!pg.allShowcase || (pg.showcaseIds?.length > 0);
  const canProjectsTab = can('manage_projects') || (pg.projectKeys?.length > 0);
  const queue = (subs.data?.submissions || []).filter((s) => !modPending.has(s.id));
  // What is waiting on a human, refreshed on a slow poll so a badge appearing is the first
  // thing you notice rather than something you find by opening every tab. The server filters
  // each queue by capability, so a count here is always something this user can act on.
  const pending = useAsync(() => api.get('/admin/pending'), []);
  // useAsync builds `reload` fresh on every render, so depending on it would clear and
  // recreate this interval each time — the 60s timer would restart on every keystroke
  // elsewhere in the shell and, in practice, never mature. Hold the latest reload in a ref
  // and set the interval up exactly once.
  const pendingReload = useRef(pending.reload);
  pendingReload.current = pending.reload;
  useEffect(() => { const id = setInterval(() => pendingReload.current?.(), 60_000); return () => clearInterval(id); }, []);
  const pc = pending.data?.counts || {};
  const [review, setReview] = useState(null);
  // The nav, grouped.
  //
  // Forty-five rows at one level meant "Errors" and "Site theme" looked equally important and
  // neither could be found. A tab may now carry `sub`, which SideDash renders as one sidebar
  // row plus a sub-tab strip above the content — so the sidebar answers "what kind of thing
  // am I doing" and the strip answers "which one".
  //
  // Leaf ids are untouched on purpose: every deep link, every badge target and every
  // `s === 'x'` branch below keeps working. This moves rows in the nav, not pages.
  //
  // Headings say what the section is FOR rather than naming a noun-pile: a moderator scanning
  // for where to answer a report is helped more by "Waiting on you" than by "Moderation".
  const raw = [
    { heading: t('adm.h.queues', 'Waiting on you') },
    // No badge, deliberately. This tab is a DIGEST of the six queues below, and every one of
    // them carries its own badge (Submissions, Reports, Messages, Sanctions, Commissions,
    // Performance). Summing them here counted every waiting item a second time — the sidebar
    // read 12 when six things were waiting, and the arithmetic got worse the more queues were
    // added. The numbers belong on the tabs where the work is actually done; this tab answers
    // "what is waiting", not "how much".
    isMod && { id: 'needs', label: t('adm.tab.needs', 'Needs attention'), icon: BellIcon },
    isMod && { id: 'moderation', label: t('adm.tab.moderation', 'Moderation'), icon: Inbox,
      sub: [
        { id: 'moderation', label: t('adm.tab.submissions', 'Submissions'), icon: Inbox, badge: queue.length || undefined },
        can('manage_reports') && { id: 'reports', label: t('adm.tab.reports', 'Reports'), icon: AlertTriangle, badge: pc.reports || undefined },
        { id: 'messages', label: t('adm.tab.messages', 'Messages'), icon: Mail, badge: pc.contact || undefined },
        { id: 'sanctions', label: t('adm.tab.sanctions', 'Sanctions'), icon: Gavel, badge: pc.contests || undefined },
      ].filter(Boolean) },

    { heading: t('adm.h.people', 'People') },
    can('manage_users') && { id: 'users', label: t('adm.tab.users', 'Accounts'), icon: Users,
      sub: [
        { id: 'users', label: t('adm.tab.users2', 'All accounts'), icon: Users },
        { id: 'planusers', label: t('adm.tab.planusers', 'Free vs paid'), icon: Receipt },
        isAdmin && { id: 'access', label: t('adm.tab.access', 'Roles & permissions'), icon: Shield },
        // The two "who did what" screens, together: the audit chain and the whole-site
        // history read the same way and were two sections apart.
        isAdmin && { id: 'security', label: t('adm.tab.security', 'Security log'), icon: Lock },
        isAdmin && { id: 'history', label: t('adm.tab.history', 'Site history'), icon: History },
      ].filter(Boolean) },

    { heading: t('adm.h.content', 'What the site shows') },
    canProjectsTab && { id: 'projects', label: t('adm.tab.projects', 'Projects'), icon: Settings2,
      sub: [
        { id: 'projects', label: t('adm.tab.projects2', 'Better* projects'), icon: Settings2 },
        // "Other projects" had a tab of its own next to Projects, which read as a separate
        // subsystem rather than as the second kind of project it is.
        canShowcaseTab && { id: 'showcase', label: t('adm.tab.showcase', 'Other projects'), icon: Sparkles },
      ].filter(Boolean) },
    isAdmin && { id: 'catalogs', label: t('adm.tab.catalogs', 'Catalogs'), icon: Boxes,
      sub: [
        { id: 'catalogs', label: t('adm.tab.catalogs2', 'Official'), icon: Boxes },
        can('manage_catalogs') && { id: 'commcatalogs', label: t('adm.tab.commcatalogs', 'Community'), icon: Layers },
        { id: 'assets', label: t('adm.tab.assets', 'Downloads & assets'), icon: Download },
      ].filter(Boolean) },
    can('manage_announcements') && { id: 'announcements', label: t('adm.tab.editorial', 'Writing & notices'), icon: Newspaper,
      sub: [
        { id: 'announcements', label: t('adm.tab.announcements', 'Announcements'), icon: BellIcon },
        can('manage_faq') && { id: 'faq', label: t('adm.tab.faq', 'FAQ'), icon: HelpCircle },
        can('manage_newsletter') && { id: 'newsletter', label: t('adm.tab.newsletter', 'Newsletter'), icon: Mail },
        isAdmin && { id: 'mail', label: t('adm.tab.mail', 'Mail delivery'), icon: Send },
        isAdmin && { id: 'reviews', label: t('adm.tab.reviews', 'Reviews'), icon: MessageSquare },
        can('manage_polls') && { id: 'polls', label: t('adm.tab.polls', 'Polls'), icon: BarChart3 },
      ].filter(Boolean) },
    isAdmin && { id: 'badges', label: t('adm.tab.badges', 'Badges'), icon: BadgeCheck },

    { heading: t('adm.h.repos', 'Hosting') },
    can('manage_repos') && { id: 'repos', label: t('adm.tab.repos', 'Repos & pools'), icon: Server,
      sub: [
        { id: 'repos', label: t('adm.tab.repos2', 'Server repos'), icon: Server },
        { id: 'pools', label: t('adm.tab.pools', 'Storage pools'), icon: HardDrive },
        isAdmin && { id: 'hosting', label: t('adm.tab.hosting', 'Free hosting'), icon: Rocket },
      ].filter(Boolean) },
    isAdmin && { id: 'plans', label: t('adm.tab.plans2', 'Hosting plans'), icon: CreditCard },

    { heading: t('adm.h.growth', 'Growth & money') },
    can('manage_promotions') && { id: 'promotions', label: t('adm.tab.promotions', 'Promotions & codes'), icon: Megaphone },
    can('manage_events') && { id: 'events', label: t('adm.tab.events', 'Events'), icon: Sparkles },
    can('manage_myo') && { id: 'myo', label: t('adm.tab.myo', 'Commissions'), icon: Wand2, badge: pc.myo || undefined },
    isAdmin && { id: 'kofi', label: t('adm.tab.kofi', 'Ko-fi & funding'), icon: KofiIcon },

    { heading: t('adm.h.integrations', 'Integrations') },
    isAdmin && { id: 'sso', label: t('adm.tab.sso', 'SSO / OAuth'), icon: Shield },
    can('manage_api') && { id: 'api', label: t('adm.tab.api', 'Public API'), icon: KeyRound },
    isAdmin && { id: 'bot', label: t('adm.tab.bot', 'Discord bot'), icon: MessageSquare },

    { heading: t('adm.h.serverdata', 'The machine') },
    isAdmin && { id: 'serverperf', label: t('adm.tab.server', 'Server'), icon: Cpu,
      sub: [
        { id: 'serverperf', label: t('adm.tab.serverperf2', 'Performance'), icon: Cpu, badge: pc.alerts || undefined },
        { id: 'storage', label: t('adm.tab.storage', 'Storage'), icon: HardDrive },
        { id: 'serveradv', label: t('adm.tab.serveradv', 'Advanced'), icon: AlertTriangle },
      ] },
    can('manage_analytics') && { id: 'analytics', label: t('adm.tab.analytics', 'Analytics'), icon: TrendingUp,
      sub: [
        { id: 'analytics', label: t('adm.tab.analytics2', 'Traffic'), icon: TrendingUp },
        { id: 'goals', label: t('adm.tab.goals', 'Goals'), icon: Target },
        { id: 'errors', label: t('adm.tab.errors', 'Errors'), icon: AlertTriangle },
      ] },

    { heading: t('adm.h.settings', 'How it looks & behaves') },
    isAdmin && { id: 'settings', label: t('adm.tab.settings', 'Settings'), icon: Sliders },
    isAdmin && { id: 'navui', label: t('adm.tab.chrome', 'Navigation & footer'), icon: Navigation,
      sub: [
        { id: 'navui', label: t('adm.tab.navui2', 'Topbar'), icon: Navigation },
        { id: 'footer', label: t('adm.tab.footer', 'Footer'), icon: PanelTop },
      ] },
    // Site theme changes what EVERY visitor sees, so it sits a tier above the per-project
    // settings an ADMIN manages.
    isSuperAdmin && { id: 'sitetheme', label: t('adm.tab.sitetheme', 'Site theme'), icon: Palette },
  ].filter(Boolean);
  // Drop group headings whose whole group is hidden (no visible tab follows before the
  // next heading / the end) — so a granted non-admin sees only their sections.
  const tabs = raw.filter((it, i) => !it.heading || (raw[i + 1] && !raw[i + 1].heading));
  return (
    <SideDash icon={ShieldCheck} title={t('adm.title', 'Admin')} subtitle={t('adm.subtitle', 'Moderation, catalogs, hosting, analytics and settings.')} tabs={tabs}>
      {(s) => (<>
        {s === 'moderation' && <div>
          <h2 className="font-semibold mb-3 flex items-center gap-2"><Inbox size={16} /> {t('mod.queue', 'Moderation queue')}</h2>
          <BmmpaInspector />
          <div className="flex flex-wrap gap-2 mb-3">
            <div className="relative flex-1 min-w-[200px]"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--faint)]" />
              <Input className="!pl-9" placeholder={t('mod.search.ph', 'Search by item name, author or email…')} value={modQ} onChange={(e) => setModQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && setModQApplied(modQ)} /></div>
            <Button variant="primary" onClick={() => setModQApplied(modQ)}><Search size={15} /> {t('mod.search', 'Search')}</Button>
            <Dropdown value={modKind} onChange={setModKind} options={[
              { value: '', label: t('mod.allkinds', 'All kinds') }, { value: 'APP', label: t('mod.k.app', 'App') },
              { value: 'PLUGIN', label: t('mod.k.plugin', 'Plugin') }, { value: 'THEME', label: t('mod.k.theme', 'Theme') }, { value: 'PRESET', label: t('mod.k.preset', 'Preset') },
            ]} />
            <Dropdown value={modType} onChange={setModType} options={[
              { value: '', label: t('mod.alltypes', 'All types') }, { value: 'NEW', label: t('mod.t.new', 'New') }, { value: 'UPDATE', label: t('mod.t.update', 'Update') },
            ]} />
            <Dropdown value={modSort} onChange={setModSort} options={[
              { value: 'oldest', label: t('mod.oldest', 'Oldest first') }, { value: 'newest', label: t('mod.newest', 'Newest first') },
            ]} />
            <Dropdown value={modStatus} onChange={setModStatus} options={[
              { value: 'PENDING', label: t('mod.s.pending', 'Pending') }, { value: 'REJECTED', label: t('mod.s.rejected', 'Rejected') },
              { value: 'SUSPENDED', label: t('mod.s.suspended', 'Suspended') }, { value: 'PUBLISHED', label: t('mod.s.published', 'Published') },
            ]} />
          </div>
          {subs.loading ? <Loading /> : (queue.length ? <div className="space-y-2">
            {queue.map((sub) => { const I = KIND_ICON[sub.item?.kind] || Package; return (
              /* The four actions used to be flex children of the card row: with no shrink-0
                 they squashed against the content on a phone and their labels printed over
                 the badges. Content first, actions on their own measured row. */
              <Card key={sub.id} className="p-4">
                <div className="flex items-start gap-3">
                  <I size={18} className="text-[var(--primary-2)] shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{sub.item?.name} {sub.item?.version && <span className="text-xs text-[var(--faint)] font-normal">v{sub.item.version}</span>}</div>
                    <div className="text-xs text-[var(--faint)] flex items-center gap-1.5 flex-wrap">
                      <Badge>{sub.type}</Badge> <Badge tone="primary">{sub.item?.kind}</Badge>
                      {sub.status && sub.status !== 'PENDING' && <Badge tone={sub.status === 'SUSPENDED' ? 'red' : sub.status === 'REJECTED' ? 'amber' : sub.status === 'PUBLISHED' ? 'green' : ''}>{sub.status}</Badge>}
                      {sub.item?.project?.key && <span className="uppercase">{sub.item.project.key}</span>} · {sub.item?.owner?.displayName || '—'}
                      {sub.tags?.map((tg) => <Badge key={tg} tone="amber"><Tag size={9} /> {tg}</Badge>)}
                      {sub.comments?.length > 0 && <span className="flex items-center gap-1 text-[var(--faint)]"><MessageSquare size={11} /> {sub.comments.length}</span>}
                    </div>
                    {sub.reason && (sub.status === 'REJECTED' || sub.status === 'SUSPENDED') && <div className="text-[11px] text-[var(--muted)] mt-1 truncate" title={sub.reason}><b>{t('mod.reasonlabel', 'Reason')}:</b> {sub.reason}</div>}
                  </div>
                </div>
                <div className="mt-3">
                  <ActionBar actions={[
                    { key: 'review', label: t('mod.review', 'Review'), icon: Eye, onClick: () => setReview(sub) },
                    sub.status !== 'PUBLISHED' && { key: 'approve', label: t('mod.approve', 'Approve'), icon: CheckCircle2, variant: 'primary', onClick: () => approve(sub) },
                    sub.status !== 'REJECTED' && { key: 'reject', label: t('mod.reject', 'Reject'), icon: XCircle, onClick: () => reject(sub) },
                    isAdmin && sub.status !== 'SUSPENDED' && { key: 'suspend', label: t('mod.suspend', 'Suspend'), icon: Ban, danger: true, onClick: () => suspend(sub) },
                  ].filter(Boolean)} />
                </div>
              </Card>); })}
          </div> : <EmptyState icon={CheckCircle2} title={t('mod.empty.t', 'Queue is empty')} sub={t('mod.empty.s', 'Nothing waiting for review.')} />)}
          {review && <SubmissionReview sub={review} onClose={() => setReview(null)} onApprove={() => { approve(review); setReview(null); }} onReject={() => { reject(review); setReview(null); }} reload={subs.reload} />}
        </div>}
        {s === 'needs' && <AdminNeedsAttention data={pending.data} loading={pending.loading} onReload={pending.reload} />}
        {s === 'messages' && <AdminMessages />}
        {s === 'users' && <AdminUsers />}
        {s === 'planusers' && <AdminPlanUsers />}
        {s === 'access' && <AdminAccess isSuperAdmin={isSuperAdmin} />}
        {s === 'security' && <AdminSecurity />}
        {s === 'serverperf' && <AdminServerPerf />}
        {s === 'serveradv' && <AdminServerAdvanced />}
        {s === 'announcements' && <AdminAnnouncements />}
        {s === 'badges' && <AdminBadges />}
        {s === 'newsletter' && <AdminNewsletter />}
        {s === 'faq' && <AdminFaq />}
        {s === 'repos' && <AdminRepos />}
        {s === 'pools' && <AdminPools />}
        {/* Plugin/theme verification used to live here; the moderation queue now owns that
            review step, so the standalone panels were a second, diverging place to do it. */}
        {s === 'catalogs' && <AdminCatalogCreator />}
        {s === 'commcatalogs' && <AdminCatalogs />}
        {s === 'reports' && <AdminReports />}
        {s === 'plans' && <AdminHostingPlans />}
        {s === 'mail' && <AdminMail />}
        {s === 'history' && <AdminHistory />}
        {s === 'hosting' && <AdminFreeHost />}
        {s === 'promotions' && <><AdminCampaigns /><div className="mt-8"><AdminPromo /></div></>}
        {s === 'kofi' && <AdminKofi />}
        {s === 'events' && <AdminEvents />}
        {s === 'myo' && <AdminMyo />}
        {s === 'sso' && <AdminSso />}
        {s === 'api' && <AdminApi />}
        {s === 'sanctions' && <AdminSanctions />}
        {s === 'polls' && <AdminPolls />}
        {s === 'storage' && <AdminStorage />}
        {s === 'bot' && <AdminBot />}
        {s === 'analytics' && <AdminAnalytics />}
        {s === 'errors' && <AdminErrors />}
        {s === 'goals' && <AdminGoals />}
        {s === 'projects' && <AdminProjects />}
        {s === 'assets' && <AdminAssets />}
        {s === 'showcase' && <AdminShowcase />}
        {s === 'reviews' && <AdminReviews />}
        {s === 'navui' && <AdminNav />}
        {s === 'footer' && <AdminFooter />}
        {s === 'settings' && <AdminSettings />}
        {s === 'sitetheme' && <AdminSiteTheme />}
      </>)}
    </SideDash>
  );
}


// The official catalogs, as catalogs — which is what they have always been on the BMM side:
// one feed URL per project+kind, each with its own payload shape. The form used to ask for
// project and kind on every single entry, which made "which catalog am I filling?" something
// you re-answered each time and never actually saw the contents of.
//
// This mirrors the community side deliberately: pick ONE catalog, see what is in it, add to
// it. The entry's type then follows from the catalog rather than being a per-entry choice
// that could quietly put a theme in the app feed.
const OFFICIAL_CATALOGS = [
  { id: 'bmm-app', projectKey: 'bmm', kind: 'APP', label: (t) => t('cc.cat.bmmapp', 'BMM · Apps') },
  { id: 'bmm-plugin', projectKey: 'bmm', kind: 'PLUGIN', label: (t) => t('cc.cat.bmmplugin', 'BMM · Plugins') },
  { id: 'bmm-theme', projectKey: 'bmm', kind: 'THEME', label: (t) => t('cc.cat.bmmtheme', 'BMM · Themes') },
  { id: 'bsm-preset', projectKey: 'bsm', kind: 'PRESET', label: (t) => t('cc.cat.bsmpreset', 'BSM · Presets') },
];

// Admin: quickly publish an OFFICIAL catalog entry for BMM or BSM.
function AdminCatalogCreator() {
  const toast = useToast(); const { t } = useI18n(); const dialog = useDialog();
  const [f, setF] = useState({ name: '', version: '1.0.0', description: '', tags: '', url: '' });
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  // Picking a catalog sets project AND kind together — they are not independent choices.
  const [catId, setCatId] = useState(OFFICIAL_CATALOGS[0].id);
  const cat = OFFICIAL_CATALOGS.find((c) => c.id === catId) || OFFICIAL_CATALOGS[0];
  // Derived, never mirrored into form state: two copies of the same fact drift, and the one
  // that drifts here would publish an entry into the wrong feed.
  const projectKey = cat.projectKey;
  const kind = cat.kind;
  // What is already in the catalog being filled — the community catalog page shows its
  // contents, and there was no reason the official one should not.
  const contents = useAsync(() => api.get(`/admin/catalog?project=${cat.projectKey}&kind=${cat.kind}&status=PUBLISHED`), [catId]);
  const [edit, setEdit] = useState(null);
  const [removed, setRemoved] = useState(() => new Set()); // optimistically hidden during the undo window

  // The download URL is stored in a different place per kind — the feeds have different
  // payload shapes — so reading it back for the edit form has to mirror that.
  const urlOf = (it) => it.kind === 'PLUGIN' ? (it.meta?.download_url || '')
    : it.kind === 'APP' ? (it.meta?.download?.url || '')
    : (it.meta?.url || '');
  const startEdit = (it) => setEdit({
    id: it.id, name: it.name || '', version: it.version || '',
    description: it.description || '', url: urlOf(it), tags: (it.tags || []).join(', '),
  });
  const saveEdit = async () => {
    try {
      await api.patch(`/admin/catalog/${edit.id}`, {
        name: edit.name.trim(), version: edit.version.trim(), description: edit.description,
        url: edit.url.trim(), tags: edit.tags.split(',').map((x) => x.trim()).filter(Boolean),
      });
      toast.success(t('common.saved', 'Saved.')); setEdit(null); contents.reload();
    } catch (x) { toast.error(x.data?.error || t('common.failed', 'Failed.')); }
  };
  // Deletion is the existing 72h-grace schedule, not a hard delete — the entry unpublishes now
  // and its files survive until the window closes, so an undo really can put it back.
  const removeEntry = (it) => {
    setRemoved((s) => new Set(s).add(it.id));
    const restore = () => setRemoved((s) => { const n = new Set(s); n.delete(it.id); return n; });
    toast.action({
      tone: 'success', duration: 6000, cancelLabel: t('common.undo', 'Undo'),
      msg: t('cc.removed', 'Entry removed from the catalog.'),
      onCommit: async () => {
        try { await api.post(`/catalog/${it.id}/delete`); contents.reload(); }
        catch { toast.error(t('common.failed', 'Failed.')); restore(); }
      },
      onCancel: restore,
    });
  };
  const deeplink = projectKey === 'bmm'
    ? `bmm://catalog/${kind.toLowerCase()}/install?name=${encodeURIComponent(f.name || 'name')}${f.url ? `&url=${encodeURIComponent(f.url)}` : ''}`
    : '';

  const onFile = async (uploaded) => {
    setFile(uploaded);
    if (uploaded && kind === 'PRESET' && /json$/i.test(uploaded.name)) {
      try { const j = JSON.parse(await uploaded.text()); setF((s) => ({ ...s, name: j.name || s.name, version: j.version || s.version, meta: j })); }
      catch { toast.error(t('cc.presetinvalid', 'Preset is not valid JSON.')); }
    }
  };
  const submit = async () => {
    if (f.name.length < 2) return toast.error(t('cc.namereq', 'Name is required.'));
    setBusy(true);
    try {
      let payloadKey; if (file) payloadKey = await uploadPayload(kind, file);
      // Plugins use download_url; apps use the BMM App-Catalog shape (download.{url,file_type}).
      const ftype = /\.(zip|msi|exe)(\?|$)/i.exec(f.url || '')?.[1]?.toLowerCase() || 'exe';
      const meta = kind === 'PRESET' ? (f.meta || {})
        : kind === 'PLUGIN' ? { ...(f.url ? { download_url: f.url } : {}), ...(deeplink ? { deeplink } : {}) }
        : kind === 'APP' ? { id: f.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), title: f.name, category: 'utility', price: 'free', tags: f.tags.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 3), ...(f.url ? { download: { url: f.url, file_type: ftype } } : {}), ...(deeplink ? { deeplink } : {}) }
        : { ...(f.url ? { url: f.url } : {}), ...(deeplink ? { deeplink } : {}) };
      const body = { projectKey: projectKey, kind: kind, name: f.name, version: f.version, description: f.description,
        tags: f.tags.split(',').map((t) => t.trim()).filter(Boolean), payloadKey, meta };
      const res = await api.post('/admin/catalog', body);
      if (kind === 'PLUGIN' && res.validation) toast[res.validation.valid ? 'success' : 'error'](res.validation.valid ? t('cc.pubvalidated', 'Plugin "{n}" published & validated.').replace('{n}', f.name) : t('cc.pubinvalid', 'Published but INVALID: {r} — fix before users install.').replace('{r}', res.validation.reason));
      else toast.success(t('cc.published', 'Official {k} "{n}" published.').replace('{k}', KIND_LABEL[kind]).replace('{n}', f.name));
      setF({ name: '', version: '1.0.0', description: '', tags: '', url: '' }); setFile(null);
      contents.reload(); // the new entry should appear in the list below, not on next reload
    } catch (x) {
      const e = x.data?.error;
      // The API returns the accepted list with a 415; showing the raw code left you guessing
      // which of a dozen allowlists you had just missed.
      toast.error(
        e === 'unsupported_type' ? t('cc.badtype', 'That file type is not accepted for this kind. Allowed: {a}').replace('{a}', (x.data?.allowed || []).join(', '))
        : e === 'invalid_preset' ? t('cc.presetjsoninvalid', 'Preset JSON is invalid.')
        : e || t('common.failed', 'Failed.'));
    } finally {
      // Was missing entirely: `busy` went true and was never cleared, so the Publish button
      // stayed disabled after the FIRST attempt — success or failure — until a page reload.
      setBusy(false);
    }
  };
  const copy = () => { navigator.clipboard?.writeText(deeplink); toast.success(t('cc.dlcopied', 'Deeplink copied.')); };

  // The URL BMM actually consumes as a catalog source. It is derived from the project + kind
  // already chosen above, so there is nothing extra to fill in — the panel that publishes the
  // entry is also where you get the link to the feed it lands in.
  const feedUrl = `${location.origin}/api/catalog.json?project=${encodeURIComponent(projectKey)}&kind=${encodeURIComponent(kind.toLowerCase())}`;
  const copyFeed = () => { navigator.clipboard?.writeText(feedUrl); toast.success(t('cc.feedcopied', 'Catalog URL copied.')); };

  return (
    <div>
      <h2 className="font-semibold mb-1 flex items-center gap-2"><BadgeCheck size={16} className="text-[var(--primary-2)]" /> {t('cc.title', 'Create an official catalog entry')}</h2>
      <p className="text-sm text-[var(--muted)] mb-4" dangerouslySetInnerHTML={{ __html: t('cc.sub', 'Publishes instantly (no moderation) and is flagged <b>Official</b>. BSM offers presets; BMM offers apps, plugins and themes with a <code>bmm://</code> deeplink.') }} />
      {/* Which catalog you are filling — chosen once, not re-answered per entry. */}
      <div className="flex flex-wrap gap-2 mb-3">
        {OFFICIAL_CATALOGS.map((c) => {
          const Icon = KIND_ICON[c.kind] || Boxes;
          const on = c.id === catId;
          return (
            <button key={c.id} type="button" onClick={() => setCatId(c.id)}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-sm transition-colors ${on ? 'border-[var(--primary)] bg-[var(--primary)]/5 text-[var(--text)] font-medium' : 'border-[var(--line)] text-[var(--muted)] hover:border-[var(--line-strong)]'}`}>
              <Icon size={14} className={on ? 'text-[var(--primary-2)]' : ''} /> {c.label(t)}
            </button>
          );
        })}
      </div>

      {/* Where this entry ends up. BMM adds this URL as a catalog source, so it belongs next to
          the form that publishes into it rather than somewhere a reader has to go and find. */}
      <Card className="p-3 mb-4 flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-[var(--muted)]">{t('cc.feed', 'Catalog URL for BMM')}</span>
        <code className="font-mono text-xs px-2 py-1 rounded-lg bg-[var(--surface-2)] break-all flex-1 min-w-0">{feedUrl}</code>
        <Button size="sm" variant="ghost" onClick={copyFeed}><Copy size={13} /> {t('common.copy', 'Copy')}</Button>
        <a href={feedUrl} target="_blank" rel="noreferrer"><Button size="sm" variant="ghost"><ExternalLink size={13} /> {t('cc.open', 'Open')}</Button></a>
      </Card>
      <Card className="p-5 space-y-3">
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label={t('cc.name', 'Name')}><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={kind === 'PRESET' ? 'Afterburner Boom' : kind === 'THEME' ? 'Midnight Orange' : 'Auto Backup'} /></Field>
          <Field label={t('cc.version', 'Version')}><Input value={f.version} onChange={(e) => setF({ ...f, version: e.target.value })} /></Field>
        </div>
        <Field label={t('cc.description', 'Description')}><Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder={t('cc.descph', 'What it does, in a sentence or two…')} /></Field>
        <Field label={t('cc.tags', 'Tags (comma-separated)')}><Input value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} placeholder="audio, utility, dark-theme" /></Field>
        {kind === 'PLUGIN' && <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-2.5 text-xs text-[var(--muted)]" dangerouslySetInnerHTML={{ __html: t('cc.pluginnote', "Host the <code>.bmmplug</code> yourself (URL below) or with us (upload it — priced by size). Either way it's checksum-validated on publish.") }} />}
        {kind !== 'PRESET' && <Field label={kind === 'PLUGIN' ? t('cc.plugurl', '.bmmplug URL (self-hosted)') : t('cc.dlurl', 'Download URL')} hint={kind === 'PLUGIN' ? t('cc.plugurlhint', 'GitHub raw / personal server. Leave empty to host with us via upload.') : t('cc.dlurlhint', 'Where the app/theme is fetched from.')}><Input value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder={kind === 'PLUGIN' ? 'https://raw.githubusercontent.com/you/repo/main/plugin.bmmplug' : 'https://github.com/you/repo/releases/latest/download/app.zip'} /></Field>}
        <Field label={kind === 'PRESET' ? t('cc.presetfile', 'Preset .json (metadata is read from the file)') : kind === 'PLUGIN' ? t('cc.plugfile', '.bmmplug file (our-hosted — priced by size)') : t('cc.payloadfile', 'Payload file (optional — zip / wasm)')}>
          <Input type="file" accept={kind === 'PRESET' ? '.json,application/json' : kind === 'PLUGIN' ? '.bmmplug,.zip' : undefined} onChange={(e) => onFile(e.target.files?.[0] || null)} /></Field>
        {deeplink && (
          <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-3">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--faint)] mb-1 flex items-center gap-1"><Link2 size={11} /> {t('cc.deeplink', 'BMM deeplink')}</div>
            <div className="flex items-center gap-2"><code className="text-xs text-[var(--muted)] truncate flex-1">{deeplink}</code><Button size="sm" onClick={copy}><Copy size={13} /></Button></div>
          </div>
        )}
        <div className="flex justify-end"><Button variant="primary" disabled={busy} onClick={submit}>{busy ? <Spinner /> : <><BadgeCheck size={15} /> {t('cc.publish', 'Publish official')}</>}</Button></div>
      </Card>

      {/* What is already in this catalog. Without it, publishing was a blind append — no way
          to see a duplicate, or to check the last entry actually landed. */}
      <div className="mt-5">
        <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-2">
          {t('cc.contents', 'Already in this catalog')}
          {contents.data?.items?.length > 0 && <span className="text-[var(--muted)] normal-case tracking-normal"> · {contents.data.items.length}</span>}
        </div>
        {contents.loading ? <Loading /> : !contents.data?.items?.length ? (
          <EmptyState icon={Boxes} title={t('cc.empty.t', 'Nothing published yet')} sub={t('cc.empty.s', 'Entries you publish above appear here.')} />
        ) : (
          <Card className="divide-y divide-[var(--line)] overflow-hidden">
            {contents.data.items.filter((it) => !removed.has(it.id)).map((it) => (
              <div key={it.id} className="p-3">
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium truncate">{it.name}</span>
                      {it.version && <span className="text-[11px] font-mono text-[var(--faint)]">v{it.version}</span>}
                      {it.status === 'HIDDEN' && <Badge tone="">{t('cc.hidden', 'hidden')}</Badge>}
                      {it.meta?.validation?.valid === false && <Badge tone="red">{t('cc.invalid', 'invalid')}</Badge>}
                    </div>
                    {it.description && <p className="text-xs text-[var(--muted)] truncate">{it.description}</p>}
                  </div>
                  <span className="text-[11px] text-[var(--faint)] shrink-0">{fmtAgo(it.updatedAt)}</span>
                  <button onClick={() => startEdit(it)} title={t('common.edit', 'Edit')}
                    className="p-1.5 rounded-lg text-[var(--muted)] hover:text-[var(--text)]"><Pencil size={13} /></button>
                  <button onClick={() => removeEntry(it)} title={t('common.delete', 'Delete')}
                    className="p-1.5 rounded-lg text-error hover:bg-error-bg"><Trash2 size={13} /></button>
                </div>
                {edit?.id === it.id && (
                  <div className="mt-3 pt-3 border-t border-[var(--line)] grid sm:grid-cols-2 gap-2">
                    <Field label={t('cc.name', 'Name')}><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
                    <Field label={t('cc.version', 'Version')}><Input value={edit.version} onChange={(e) => setEdit({ ...edit, version: e.target.value })} /></Field>
                    <div className="sm:col-span-2"><Field label={t('cc.description', 'Description')}><Textarea rows={2} value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></Field></div>
                    <div className="sm:col-span-2"><Field label={t('cc.dlurl', 'Download URL')}><Input value={edit.url} onChange={(e) => setEdit({ ...edit, url: e.target.value })} placeholder="https://…" /></Field></div>
                    <div className="sm:col-span-2"><Field label={t('cc.tags', 'Tags (comma-separated)')}><Input value={edit.tags} onChange={(e) => setEdit({ ...edit, tags: e.target.value })} /></Field></div>
                    <div className="sm:col-span-2 flex gap-2">
                      <Button size="sm" variant="primary" onClick={saveEdit}><Save size={13} /> {t('common.save', 'Save')}</Button>
                      <Button size="sm" variant="ghost" onClick={() => setEdit(null)}>{t('common.cancel', 'Cancel')}</Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </Card>
        )}
      </div>
    </div>
  );
}



// Admin: find a user by id / display name / email / linked creator id, then inspect them.
function AdminUsers() {
  const { t } = useI18n();
  const [sp] = useSearchParams();
  const [q, setQ] = useState(sp.get('q') || '');
  const [results, setResults] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState(null);
  // Load users; `append` pages more (Load more), else replaces. Empty term = all users.
  const load = async (term, append = false) => {
    term = (term || '').trim();
    setBusy(true);
    try {
      const skip = append ? (results?.length || 0) : 0;
      const { users, hasMore: more } = await api.get(`/admin/users?q=${encodeURIComponent(term)}&skip=${skip}&take=30`);
      setResults(append ? [...(results || []), ...users] : users); setHasMore(more);
    } catch { if (!append) setResults([]); } finally { setBusy(false); }
  };
  const search = () => load(q, false);
  useEffect(() => { load(sp.get('q') || '', false); /* eslint-disable-next-line */ }, []);
  const since = (d) => new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  return (
    <div>
      <h2 className="font-semibold mb-1 flex items-center gap-2"><Users size={16} className="text-[var(--primary-2)]" /> {t('au.title', 'User search')}</h2>
      <p className="text-sm text-[var(--muted)] mb-4">{t('au.desc', 'Search by user id, Unique BC id (BC-XXXX-XXXX), display name, email, a linked creator id, or a linked Discord (username / id). Click a user to see full details.')}</p>
      <div className="flex gap-2 mb-5">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--faint)]" />
          <Input className="!pl-9" placeholder={t('au.search.ph', 'id / display name / email / creator id / Discord…')} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} />
        </div>
        <Button variant="primary" disabled={busy} onClick={search}>{busy ? <Spinner /> : <><Search size={15} /> {t('au.search', 'Search')}</>}</Button>
      </div>
      {results === null ? <EmptyState icon={Users} title={t('au.find.t', 'Find a user')} sub={t('au.find.s', 'Enter a term above to search.')} />
        : results.length ? <div className="space-y-2">
          {results.map((u) => (
            <button key={u.id} onClick={() => setDetail(u.id)} className="w-full text-left card card-hover p-4 flex items-center gap-3">
              <Avatar user={u} size={40} />
              <div className="flex-1 min-w-0">
                <div className="font-medium flex items-center gap-2 flex-wrap min-w-0"><span className="truncate min-w-0">{u.displayName}</span> <Badge tone={u.role === 'SUPERADMIN' ? 'red' : u.role === 'ADMIN' ? 'amber' : u.role === 'MOD' ? 'primary' : ''}>{u.role}</Badge>{u.status === 'banned' ? <Badge tone="red"><Ban size={10} /> {t('au.banned', 'banned')}</Badge> : u.status === 'suspended' ? <Badge tone="amber"><Clock size={10} /> {t('au.suspended', 'suspended')}</Badge> : null}</div>
                <div className="text-xs text-[var(--faint)] truncate">{u.email} · {t('au.since', 'since')} {since(u.createdAt)}</div>
                <div className="text-xs text-[var(--faint)] mt-0.5 font-mono truncate flex items-center gap-2">
                  {u.bcId && <span className="inline-flex items-center gap-1 text-[var(--primary-2)]"><Fingerprint size={11} /> {u.bcId}</span>}
                  <span className="truncate">{u.id}</span>
                </div>
                {u.discord && (
                  <div className="text-xs mt-0.5 flex items-center gap-1.5 truncate text-[#5865F2]">
                    <DiscordIcon size={12} /> <span className="font-medium">{u.discord.username || 'linked'}</span>
                    <span className="text-[var(--faint)] font-mono">· {u.discord.id}</span>
                  </div>
                )}
              </div>
              <div className="text-xs text-[var(--muted)] flex flex-col items-end gap-0.5 shrink-0">
                <span className="flex items-center gap-1"><Server size={11} /> {u.repoCount}</span>
                <span className="flex items-center gap-1"><Package size={11} /> {u.itemCount}</span>
                {u.creatorIds.length > 0 && <Badge tone="green">{t('au.creatorids', '{n} creator id(s)').replace('{n}', u.creatorIds.length)}</Badge>}
                {u.discord && <Badge tone="primary"><DiscordIcon size={10} /> {t('au.discord', 'Discord')}</Badge>}
              </div>
            </button>
          ))}
          {hasMore && <div className="text-center pt-1"><Button variant="ghost" disabled={busy} onClick={() => load(q, true)}>{busy ? <Spinner /> : t('au.loadmore', 'Load more')}</Button></div>}
        </div> : <EmptyState icon={XCircle} title={t('au.none.t', 'No users found')} sub={t('au.none.s', 'Try a different id, name, email or creator id.')} />}
      {detail && <UserDetailModal id={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

// Admin: who's on a free plan vs. who has actually paid us. "Paying" is driven by
// real Payment rows (never by plan name), so it stays correct as pricing/thresholds
// change — a user who was billed once and then stays under the free tier forever
// after still counts as a paying customer (they have Payment history).
const PLANUSERS_TABS = [
  ['paying', CreditCard, 'Paying customers'],
  ['free', Gift, 'Free plan'],
  ['archived', Archive, 'Archived'],
];
// Classified by CURRENT state (see the endpoint): a user can appear in more than one
// tab — e.g. one free repo + one paid boost — since the tabs aren't a strict partition.
function AdminPlanUsers() {
  const { t } = useI18n(); const toast = useToast();
  const [sp] = useSearchParams();
  const [tab, setTab] = useState('paying');
  const [results, setResults] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [includeStaff, setIncludeStaff] = useState(false);
  const [mrr, setMrr] = useState(null); // { totalCents, subCount, annualCents }
  const [q, setQ] = useState(''); const [qApplied, setQApplied] = useState('');
  const load = async (append = false) => {
    setBusy(true);
    try {
      const skip = append ? (results?.length || 0) : 0;
      const { users, hasMore: more, mrr: m } = await api.get(`/admin/billing/users?tab=${tab}&skip=${skip}&take=30${includeStaff ? '&includeStaff=1' : ''}${qApplied ? `&q=${encodeURIComponent(qApplied)}` : ''}`);
      setResults(append ? [...(results || []), ...users] : users); setHasMore(more); if (m) setMrr(m);
    } catch { if (!append) setResults([]); } finally { setBusy(false); }
  };
  const mrrMoney = (c) => `$${((c || 0) / 100).toFixed(2)}`;
  useEffect(() => { load(false); setExpanded(null); /* eslint-disable-next-line */ }, [tab, includeStaff, qApplied]);
  // Deep-link from the Discord payment embed: /admin?s=planusers&user=<id> opens that
  // customer's detail straight away.
  useEffect(() => { const u = sp.get('user'); if (u) setDetail(u); /* eslint-disable-next-line */ }, []);
  const since = (d) => new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  const emptyCopy = [t(`pu.empty.${tab}.t`, ''), t(`pu.empty.${tab}.s`, '')];
  return (
    <div>
      <h2 className="font-semibold mb-1 flex items-center gap-2"><Receipt size={16} className="text-[var(--primary-2)]" /> {t('pu.title', 'Customers & revenue')}</h2>
      <p className="text-sm text-[var(--muted)] mb-3">{t('pu.desc', "What every customer currently has active: free-tier hosting, paid hosting/boosts, or expired/ended terms. Click a row to see the detail; click the user's name for their full profile.")}</p>
      {/* The cards render even with nothing to show. They used to be hidden until the
          request came back with an `mrr` object, so an empty site showed no figures at
          all — and the honest answer to "how much am I making" on an empty site is a
          visible 0, not a blank space where a number should be. */}
      {(() => {
        const measured = mrr?.stripe !== false;   // undefined = older API, treat as measured
        const dash = <span className="text-[var(--faint)]">—</span>;
        const num = (v) => (measured ? v : dash);
        return (
          <>
            <div className="grid sm:grid-cols-3 gap-3 mb-2">
              <Card className="p-4"><div className="text-xs text-[var(--faint)] flex items-center gap-1.5 mb-1"><RefreshCw size={12} className="text-success" /> {t('pu.mrr', 'Monthly recurring revenue')}</div><div className="text-2xl font-bold text-success tabular-nums">{num(<>{mrrMoney(mrr?.totalCents || 0)}<span className="text-sm font-normal text-[var(--faint)]">/{t('pu.mo', 'mo')}</span></>)}</div></Card>
              <Card className="p-4"><div className="text-xs text-[var(--faint)] flex items-center gap-1.5 mb-1"><TrendingUp size={12} className="text-[var(--primary-2)]" /> {t('pu.arr', 'Annualized (est.)')}</div><div className="text-2xl font-bold tabular-nums">{num(<>{mrrMoney(mrr?.annualCents || 0)}<span className="text-sm font-normal text-[var(--faint)]">/{t('pu.yr', 'yr')}</span></>)}</div></Card>
              <Card className="p-4"><div className="text-xs text-[var(--faint)] flex items-center gap-1.5 mb-1"><CreditCard size={12} className="text-[var(--primary-2)]" /> {t('pu.activesubs', 'Active subscriptions')}</div><div className="text-2xl font-bold tabular-nums">{num(mrr?.subCount || 0)}</div></Card>
            </div>
            {/* A zero you cannot trust is worse than no number: without this the card
                reads a confident "$0.00/mo" whether nobody is paying or Stripe simply
                never answered. */}
            {!measured && (
              <div className="text-xs text-warning flex items-center gap-1.5 mb-4">
                <AlertTriangle size={12} /> {t('pu.nostripe', 'Stripe did not answer — these figures could not be measured.')}
              </div>
            )}
            {/* Subscriptions live in Stripe with no account here — a wiped database, a
                shared test key, a deleted customer. Named, because otherwise this page
                is quietly smaller than the Stripe dashboard and nothing explains the gap. */}
            {measured && mrr?.orphanSubs > 0 && (
              <div className="text-xs text-[var(--muted)] flex items-start gap-1.5 mb-4">
                <Info size={12} className="mt-0.5 shrink-0" />
                <span>{t('pu.orphans', '{n} active subscription(s) in Stripe ({m}/mo) belong to no account here, so they are excluded above.')
                  .replace('{n}', String(mrr.orphanSubs)).replace('{m}', mrrMoney(mrr.orphanMrrCents))}</span>
              </div>
            )}
            {measured && !mrr?.orphanSubs && <div className="mb-4" />}
          </>
        );
      })()}
      <div className="flex flex-wrap gap-2 items-center mb-3">
        <div className="relative flex-1 min-w-[200px]"><Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--faint)]" />
          <Input className="!pl-8 !py-1.5 !text-sm" placeholder={t('pu.search', 'Search a customer — name, email, creator id…')} value={q}
            onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && setQApplied(q.trim())} /></div>
        <Button size="sm" onClick={() => setQApplied(q.trim())}>{t('pu.searchbtn', 'Search')}</Button>
        {qApplied && <Button size="sm" variant="ghost" onClick={() => { setQ(''); setQApplied(''); }}><X size={13} /> {t('pu.clear', 'Clear')}</Button>}
      </div>
      <label className="flex items-center gap-2 text-xs text-[var(--muted)] mb-4 cursor-pointer w-fit">
        <input type="checkbox" checked={includeStaff} onChange={(e) => setIncludeStaff(e.target.checked)} /> {t('pu.includestaff', 'Include staff (admins/mods) — normally excluded from this customer report')}
      </label>
      <div className="flex gap-2 mb-4">
        {PLANUSERS_TABS.map(([id, I, label]) => (
          <button key={id} onClick={() => setTab(id)} className={`flex-1 px-3 py-2 rounded-xl text-sm font-medium border transition ${tab === id ? 'bg-[var(--surface-2)] border-[var(--line)] text-[var(--text)]' : 'border-transparent text-[var(--muted)] hover:text-[var(--text)]'}`}>
            <I size={14} className="inline mr-1.5 -mt-0.5" /> {t(`pu.tab.${id}`, label)}</button>
        ))}
      </div>
      {busy && !results ? <Loading /> : results && results.length ? <div className="space-y-2">
        {results.map((u) => {
          const isOpen = expanded === u.id;
          return (
          <Card key={u.id} className="p-0 overflow-hidden">
            <button onClick={() => setExpanded(isOpen ? null : u.id)} className="w-full text-left p-4 flex items-center gap-3 hover:bg-[var(--surface-2)] transition">
              <Avatar user={u} size={40} />
              <div className="flex-1 min-w-0">
                {/* A <button>, not a clickable <span>: it opens the user detail, and looked
                    like a link (hover:underline) while being unreachable by keyboard — no
                    focus, no Enter (WCAG 2.1.1 / 4.1.2). */}
                <div className="font-medium flex items-center gap-2 flex-wrap min-w-0"><span className="truncate min-w-0"><button type="button" onClick={(e) => { e.stopPropagation(); setDetail(u.id); }} className="text-left hover:underline hover:text-[var(--primary-2)]" title={t('au.opendetail', 'Open this account’s details')}>{u.displayName}</button></span> <Badge tone={u.role === 'SUPERADMIN' ? 'red' : u.role === 'ADMIN' ? 'amber' : u.role === 'MOD' ? 'primary' : ''}>{u.role}</Badge></div>
                <div className="text-xs text-[var(--faint)] truncate">{u.email}</div>
              </div>
              {tab === 'paying' && (u.totalSpentCents != null || u.mrrCents > 0) && (
                <div className="text-xs text-right shrink-0">
                  {u.mrrCents > 0 && <div className="text-sm font-semibold text-success">{mrrMoney(u.mrrCents)}<span className="text-[var(--faint)] font-normal">/{t('pu.mo', 'mo')}</span></div>}
                  {u.totalSpentCents != null && <div className="text-[var(--faint)]">{t('pu.spent', '{n} spent').replace('{n}', mrrMoney(u.totalSpentCents))} · {t('pu.payments', '{n} payment(s)').replace('{n}', u.paymentCount)}</div>}
                </div>
              )}
              <Badge className="shrink-0">{t('pu.active', '{n} active').replace('{n}', u.active.length)}</Badge>
              <ChevronDown size={15} className={`shrink-0 text-[var(--faint)] transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>
            {isOpen && (
              <div className="px-4 pb-4 pt-1 space-y-1.5 border-t border-[var(--line)]">
                {u.active.map((a, i) => {
                  // Back-compat: tolerate a plain-string entry (old API shape).
                  if (typeof a === 'string') return (
                    <div key={i} className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg bg-[var(--surface-2)]"><span className="truncate">{a}</span></div>
                  );
                  const TypeIcon = a.type === 'subscription' ? RefreshCw : a.type === 'boost' ? Star : a.type === 'catalog' ? Package : Server;
                  const money = (c, cur) => { const C = (cur || 'usd').toUpperCase(); const s = C === 'USD' ? '$' : C === 'EUR' ? '€' : C === 'GBP' ? '£' : ''; return s ? `${s}${(c / 100).toFixed(2)}` : `${(c / 100).toFixed(2)} ${C}`; };
                  const bits = [];
                  if (a.type === 'hosting' && a.specs) bits.push(`${a.specs.storageGB} GB · ${a.specs.uploadMbps} Mbps`);
                  if (a.type === 'boost' && a.featuredUntil) bits.push(`${t('pu.d.until', 'until')} ${since(a.featuredUntil)}`);
                  if (a.type === 'catalog') bits.push(`${a.kind || ''}${a.sizeMB != null ? ` · ${a.sizeMB} MB` : ''}`.trim());
                  if (a.type === 'subscription') { const per = a.intervalCount > 1 ? `/${a.intervalCount} ${a.interval}` : `/${a.interval}`; bits.push(`${money(a.amountCents, a.currency)} ${per}`); if (a.currentPeriodEnd) bits.push(`${t('bill.sub.renews', 'Renews {d}').replace('{d}', since(a.currentPeriodEnd))}`); }
                  if (a.status) bits.push(a.status);
                  if (a.deleteAt) bits.push(`${t('pu.d.deletes', 'deletes')} ${since(a.deleteAt)}`);
                  return (
                    <div key={i} className="flex items-start gap-2.5 text-sm px-3 py-2 rounded-lg bg-[var(--surface-2)]">
                      <TypeIcon size={14} className={`shrink-0 mt-0.5 ${a.paid ? 'text-success' : 'text-[var(--primary-2)]'}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium truncate">{a.name || a.label}</span>
                          <Badge tone={a.paid ? 'green' : ''}>{a.paid ? t('pu.d.paid', 'paid') : t('pu.d.free', 'free')}</Badge>
                          {a.repoId && <a href={`/repo/${a.repoId}`} target="_blank" rel="noreferrer" className="text-[var(--primary-2)] hover:underline text-xs inline-flex items-center gap-0.5">{t('pu.d.open', 'open')} <ArrowUpRight size={11} /></a>}
                        </div>
                        {bits.length > 0 && <div className="text-xs text-[var(--faint)] mt-0.5">{bits.join(' · ')}</div>}
                        {a.spend && a.spend.spentCents > 0 && (
                          <div className="text-xs text-success mt-0.5">{money(a.spend.spentCents, a.spend.currency)} {t('pu.d.acrosspay', 'across {n} payment(s)').replace('{n}', a.spend.count)}{a.spend.lastAt ? ` · ${t('pu.last', 'last')} ${since(a.spend.lastAt)}` : ''}</div>
                        )}
                        {a.spend?.invoiceNos?.length > 0 && (
                          <div className="text-[11px] text-[var(--faint)] mt-0.5 flex items-center gap-1.5 flex-wrap"><Receipt size={10} className="shrink-0" /> {t('pu.d.invoices', 'Invoices:')}
                            {a.spend.invoiceNos.slice(-3).map((n) => (
                              <button key={n} onClick={(e) => { e.stopPropagation(); navigator.clipboard?.writeText(n); toast.success(t('common.copied', 'Copied.')); }} className="font-mono hover:text-[var(--primary-2)]" title={t('common.copy', 'Copy')}>{n}</button>
                            ))}
                            {a.spend.invoiceNos.length > 3 && <span>+{a.spend.invoiceNos.length - 3}</span>}
                          </div>
                        )}
                        {a.type === 'subscription' && a.mrrCents > 0 && (
                          <div className="text-xs text-success mt-0.5">≈ {money(a.mrrCents, a.currency)} {t('pu.permo', 'per month')}</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
          ); })}
        {hasMore && <div className="text-center pt-1"><Button variant="ghost" disabled={busy} onClick={() => load(true)}>{busy ? <Spinner /> : t('pu.loadmore', 'Load more')}</Button></div>}
      </div> : <EmptyState icon={tab === 'paying' ? CreditCard : tab === 'free' ? Gift : Archive} title={emptyCopy[0]} sub={emptyCopy[1]} />}
      {detail && <UserDetailModal id={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

function PolicyChipList({ label, items, onAdd, onRemove, placeholder }) {
  const [v, setV] = useState('');
  const add = () => { const x = v.trim(); if (x) { onAdd(x); setV(''); } };
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--faint)] mb-1">{label}</div>
      <div className="flex gap-1.5"><Input value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} onKeyDown={(e) => e.key === 'Enter' && add()} /><Button size="sm" onClick={add}><Plus size={13} /></Button></div>
      <div className="flex flex-wrap gap-1 mt-1.5">
        {items.length ? items.map((x) => (
          <span key={x} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-[var(--surface-2)] border border-[var(--line)] text-[11px]">{x}<button onClick={() => onRemove(x)} className="text-[var(--faint)] hover:text-error"><X size={10} /></button></span>
        )) : <span className="text-[11px] text-[var(--faint)]">{'—'}</span>}
      </div>
    </div>
  );
}

// Account entries ({type:"bcweb"|"discord", id, label}) — searches the same
// creator-id/Discord-id/username/display-name index as the "Find a user" box below.
function PolicyAccountChips({ label, items, onAdd, onRemove }) {
  const { t } = useI18n();
  const [q, setQ] = useState(''); const [results, setResults] = useState(null); const [busy, setBusy] = useState(false);
  const search = async () => {
    if (!q.trim()) return setResults(null);
    setBusy(true);
    try { const { users } = await api.get(`/admin/users?q=${encodeURIComponent(q)}&take=8`); setResults(users); } catch { setResults([]); } finally { setBusy(false); }
  };
  const has = (type, id) => items.some((a) => a.type === type && a.id === id);
  const add = (entry) => { if (!has(entry.type, entry.id)) onAdd(entry); };
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--faint)] mb-1">{label}</div>
      <div className="flex gap-1.5">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('gap.accsearch', 'id / display name / creator id / Discord…')} onKeyDown={(e) => e.key === 'Enter' && search()} />
        <Button size="sm" onClick={search}>{busy ? <Spinner /> : <Search size={13} />}</Button>
      </div>
      {results && (
        <div className="mt-1.5 space-y-1">
          {results.length ? results.map((u) => (
            <div key={u.id} className="flex items-center justify-between gap-2 px-2 py-1 rounded-md bg-[var(--surface-2)] border border-[var(--line)] text-[11px]">
              <span className="truncate">{u.displayName}{u.discord && <span className="text-[var(--faint)]"> · Discord: {u.discord.username || u.discord.id}</span>}</span>
              <span className="flex gap-1 shrink-0">
                <button onClick={() => add({ type: 'bcweb', id: u.id, label: u.displayName })} className="px-1.5 py-0.5 rounded border border-[var(--line)] hover:text-[var(--primary-2)] hover:border-[var(--primary-2)]">+ BC</button>
                {u.discord && <button onClick={() => add({ type: 'discord', id: u.discord.id, label: u.discord.username || u.discord.id })} className="px-1.5 py-0.5 rounded border border-[var(--line)] hover:text-[var(--primary-2)] hover:border-[var(--primary-2)]">+ Discord</button>}
              </span>
            </div>
          )) : <div className="text-[11px] text-[var(--faint)] px-1">{t('gap.noaccounts', 'No accounts found.')}</div>}
        </div>
      )}
      <div className="flex flex-wrap gap-1 mt-1.5">
        {items.length ? items.map((a) => (
          <span key={`${a.type}:${a.id}`} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-[var(--surface-2)] border border-[var(--line)] text-[11px]">
            <Users size={9} className="text-[var(--faint)]" /> {a.type === 'discord' ? 'Discord: ' : ''}{a.label || a.id}
            <button onClick={() => onRemove(a)} className="text-[var(--faint)] hover:text-error"><X size={10} /></button>
          </span>
        )) : <span className="text-[11px] text-[var(--faint)]">{'—'}</span>}
      </div>
    </div>
  );
}

// Site-wide whitelist/blacklist applied identically to every hosted repo (see
// GlobalAccessPolicy in schema.prisma + hosting-content.mjs's sandboxGate). MOD can
// see it (GET is MOD+); only ADMIN+ can change it (PUT enforces that server-side).
function GlobalAccessPolicyCard() {
  const toast = useToast();
  const { t } = useI18n();
  const { data, loading, reload } = useAsync(() => api.get('/admin/access-policy'), []);
  const [policy, setPolicy] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data?.policy && !policy) setPolicy(data.policy); /* eslint-disable-next-line */ }, [data]);

  if (!policy) return <Card className="p-5">{loading ? <Loading /> : null}</Card>;

  const addTo = (field, val) => setPolicy((s) => ({ ...s, [field]: [...new Set([...(s[field] || []), val])] }));
  const rm = (field, val) => setPolicy((s) => ({ ...s, [field]: (s[field] || []).filter((x) => x !== val) }));
  const addAccount = (field, entry) => setPolicy((s) => {
    const list = s[field] || [];
    if (list.some((a) => a.type === entry.type && a.id === entry.id)) return s;
    return { ...s, [field]: [...list, entry] };
  });
  const rmAccount = (field, entry) => setPolicy((s) => ({ ...s, [field]: (s[field] || []).filter((a) => !(a.type === entry.type && a.id === entry.id)) }));

  const undoSave = useUndoableSave(reload);
  const save = () => {
    setBusy(true);
    undoSave(() => api.put('/admin/access-policy', policy),
      t('gap.saved', 'Global access policy saved.'),
      { onSettled: () => setBusy(false), errorFor: () => t('gap.savefail', 'Failed to save.') });
  };

  return (
    <Card className="p-5 space-y-4">
      <div>
        <h2 className="font-semibold mb-1 flex items-center gap-2"><Globe size={16} className="text-[var(--primary-2)]" /> {t('gap.title', 'Global access policy')}</h2>
        <p className="text-sm text-[var(--muted)]">{t('gap.desc', "Applied identically to every hosted repo, on top of each owner's own settings — a ban here blocks a client everywhere; the whitelist here is added to whichever repos require one.")}</p>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={policy.whitelistOnly} onChange={(e) => setPolicy({ ...policy, whitelistOnly: e.target.checked })} /> {t('gap.wlonly', 'Whitelist-only for ALL repos (forces every hosted repo into whitelist mode, site-wide)')}</label>
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="space-y-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] flex items-center gap-1.5"><Shield size={12} className="text-success" /> {t('gap.whitelist', 'Whitelist')}</div>
          <PolicyChipList label={t('gap.ips', 'IPs')} items={policy.whitelistIps || []} onAdd={(v) => addTo('whitelistIps', v)} onRemove={(v) => rm('whitelistIps', v)} placeholder="203.0.113.4" />
          <PolicyChipList label={t('gap.creatorid', 'Creator ID')} items={policy.whitelistKeys || []} onAdd={(v) => addTo('whitelistKeys', v)} onRemove={(v) => rm('whitelistKeys', v)} placeholder="BMM creator id…" />
          <PolicyAccountChips label={t('gap.accounts', 'Accounts')} items={policy.whitelistAccounts || []} onAdd={(e) => addAccount('whitelistAccounts', e)} onRemove={(e) => rmAccount('whitelistAccounts', e)} />
        </div>
        <div className="space-y-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] flex items-center gap-1.5"><Ban size={12} className="text-error" /> {t('gap.blacklist', 'Blacklist')}</div>
          <PolicyChipList label={t('gap.ips', 'IPs')} items={policy.bannedIps || []} onAdd={(v) => addTo('bannedIps', v)} onRemove={(v) => rm('bannedIps', v)} placeholder="198.51.100.7" />
          <PolicyChipList label={t('gap.creatorid', 'Creator ID')} items={policy.bannedKeys || []} onAdd={(v) => addTo('bannedKeys', v)} onRemove={(v) => rm('bannedKeys', v)} placeholder="BMM creator id…" />
          <PolicyAccountChips label={t('gap.accounts', 'Accounts')} items={policy.bannedAccounts || []} onAdd={(e) => addAccount('bannedAccounts', e)} onRemove={(e) => rmAccount('bannedAccounts', e)} />
        </div>
      </div>
      <div className="flex justify-end"><Button variant="primary" disabled={busy} onClick={save}>{busy ? <Spinner /> : t('gap.save', 'Save global policy')}</Button></div>
    </Card>
  );
}

// Admin (+SuperAdmin): grant/revoke blog-post permissions (any ADMIN+), and — only
// for a SUPERADMIN — reassign a user's role. Kept in one screen since both are
// "who can do what" access-control actions.
// Login attempts (success/fail, IP, which account) + the admin/staff audit trail
// (role changes, access-policy edits, server-control grants/elevations).
const SECURITY_RANGES = [['24', '24h'], ['168', '7d'], ['720', '30d'], ['8760', '1y']];
// A failed-login IP is flagged once it's tried 5+ times in the loaded window —
// a cheap, no-config heuristic to surface likely brute-force/credential-stuffing
// activity without needing a real rate-limiting/ban system here.
const BRUTE_FORCE_THRESHOLD = 5;

function AdminSecurity() {
  const { t } = useI18n();
  const [tab, setTab] = useState('logins');
  const [q, setQ] = useState('');
  const [loginFilter, setLoginFilter] = useState('all'); // all | success | failed | suspicious
  const [hours, setHours] = useState('168');
  const logins = useAsync(() => api.get(`/admin/security/logins?hours=${hours}`), [hours]);
  const audit = useAsync(() => api.get(`/admin/security/audit?hours=${hours}`), [hours]);
  const [verify, setVerify] = useState(null); // null | 'checking' | { ok, total, checked, legacy, firstBreak }
  const runVerify = async () => { setVerify('checking'); try { setVerify(await api.get('/admin/security/audit/verify')); } catch { setVerify({ error: true }); } };
  const attempts = logins.data?.attempts || [];
  const entries = audit.data?.entries || [];

  const failsByIp = {};
  for (const a of attempts) if (!a.success) failsByIp[a.ip] = (failsByIp[a.ip] || 0) + 1;
  const suspiciousIps = new Set(Object.entries(failsByIp).filter(([, n]) => n >= BRUTE_FORCE_THRESHOLD).map(([ip]) => ip));

  const qLower = q.trim().toLowerCase();
  const filteredAttempts = attempts.filter((a) => {
    if (loginFilter === 'success' && !a.success) return false;
    if (loginFilter === 'failed' && a.success) return false;
    if (loginFilter === 'suspicious' && !suspiciousIps.has(a.ip)) return false;
    if (!qLower) return true;
    return a.email.toLowerCase().includes(qLower) || a.ip.includes(qLower) || a.user?.displayName?.toLowerCase().includes(qLower);
  });
  const filteredEntries = entries.filter((e) => {
    if (!qLower) return true;
    return e.actor?.displayName?.toLowerCase().includes(qLower) || e.action.toLowerCase().includes(qLower) || e.detail?.toLowerCase().includes(qLower) || e.ip.includes(qLower);
  });

  const failedCount = attempts.filter((a) => !a.success).length;
  const uniqueIps = new Set(attempts.map((a) => a.ip)).size;

  const exportCsv = (rowsArr, cols, name) => {
    if (!rowsArr.length) return;
    const esc = csvCell;
    const csv = [cols.map((c) => esc(c[0])).join(','), ...rowsArr.map((r) => cols.map((c) => esc(c[1](r))).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `${name}.csv`; document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <h2 className="font-semibold mb-1 flex items-center gap-2"><Lock size={16} className="text-[var(--primary-2)]" /> {t('sec.title', 'Security log')}</h2>
      <p className="text-sm text-[var(--muted)] mb-3">{t('sec.desc', 'Login attempts (success/fail, IP) and the admin action audit trail.')}</p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
        <Card className="p-3"><div className="text-[var(--faint)] text-xs mb-1">{t('sec.attempts', 'Attempts')}</div><div className="text-xl font-bold tabular-nums">{attempts.length}</div></Card>
        <Card className="p-3"><div className="text-[var(--faint)] text-xs mb-1">{t('sec.failedn', 'Failed')}</div><div className="text-xl font-bold tabular-nums text-error">{failedCount}</div></Card>
        <Card className="p-3"><div className="text-[var(--faint)] text-xs mb-1">{t('sec.uniqueips', 'Unique IPs')}</div><div className="text-xl font-bold tabular-nums">{uniqueIps}</div></Card>
        <Card className="p-3"><div className="text-[var(--faint)] text-xs mb-1 flex items-center gap-1"><AlertTriangle size={11} className={suspiciousIps.size ? 'text-error' : ''} /> {t('sec.suspicious', 'Suspicious IPs')}</div><div className={`text-xl font-bold tabular-nums ${suspiciousIps.size ? 'text-error' : ''}`}>{suspiciousIps.size}</div></Card>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <div className="seg-rail p-0.5 gap-0.5">
          <button onClick={() => setTab('logins')} className={`px-3 py-1.5 rounded-[10px] text-sm transition ${tab === 'logins' ? 'bg-[var(--bg-solid)] text-[var(--primary)] shadow-sm font-medium' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}>{t('sec.tab.logins', 'Login attempts')}</button>
          <button onClick={() => setTab('audit')} className={`px-3 py-1.5 rounded-[10px] text-sm transition ${tab === 'audit' ? 'bg-[var(--bg-solid)] text-[var(--primary)] shadow-sm font-medium' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}>{t('sec.tab.audit', 'Admin audit trail')}</button>
        </div>
        <div className="seg-rail p-0.5 gap-0.5">
          {SECURITY_RANGES.map(([h, label]) => (
            <button key={h} onClick={() => setHours(h)} className={`px-2.5 py-1 rounded-[10px] text-xs transition ${hours === h ? 'bg-[var(--bg-solid)] text-[var(--primary-2)] shadow-sm font-medium' : 'text-[var(--faint)] hover:text-[var(--text)]'}`}>{label}</button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        <div className="relative flex-1 min-w-[200px]"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--faint)]" />
          <Input className="!pl-9" placeholder={tab === 'logins' ? t('sec.search.logins', 'Search email, IP or account…') : t('sec.search.audit', 'Search actor, action, detail or IP…')} value={q} onChange={(e) => setQ(e.target.value)} /></div>
        {tab === 'logins' && (
          <Select className="!w-auto" value={loginFilter} onChange={(e) => setLoginFilter(e.target.value)}>
            <option value="all">{t('sec.f.all', 'All outcomes')}</option><option value="success">{t('sec.f.success', 'Success only')}</option><option value="failed">{t('sec.f.failed', 'Failed only')}</option><option value="suspicious">{t('sec.f.suspicious', 'Suspicious IPs only')}</option>
          </Select>
        )}
        <Button size="sm" onClick={() => tab === 'logins'
          ? exportCsv(filteredAttempts, [['email', (a) => a.email], ['success', (a) => a.success], ['ip', (a) => a.ip], ['reason', (a) => a.reason], ['createdAt', (a) => a.createdAt]], 'login_attempts')
          : exportCsv(filteredEntries, [['actor', (e) => e.actor?.displayName], ['action', (e) => e.action], ['detail', (e) => e.detail], ['ip', (e) => e.ip], ['createdAt', (e) => e.createdAt]], 'audit_trail')}>
          <Download size={13} /> CSV
        </Button>
      </div>

      {tab === 'logins' && (logins.loading ? <Loading /> : filteredAttempts.length ? <Card className="p-0 overflow-hidden">
        <div className="max-h-[65vh] overflow-auto divide-y divide-[var(--line)]">
          {filteredAttempts.map((a) => (
            <div key={a.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              {a.success ? <CheckCircle2 size={15} className="text-success shrink-0" /> : <XCircle size={15} className="text-error shrink-0" />}
              <div className="flex-1 min-w-0">
                <div className="truncate"><button onClick={() => setQ(a.email)} className="font-medium hover:text-[var(--primary-2)]">{a.email}</button> {a.user && <span className="text-xs text-[var(--faint)]">· {a.user.displayName} ({a.user.role})</span>} {suspiciousIps.has(a.ip) && <Badge tone="red" className="ml-1">{t('sec.bruteforce', 'Brute-force?')}</Badge>}</div>
                <div className="text-[11px] text-[var(--faint)] font-mono"><button onClick={() => setQ(a.ip)} className="hover:text-[var(--primary-2)]">{a.ip}</button> {a.reason ? `· ${a.reason}` : ''}</div>
              </div>
              <span className="text-[11px] text-[var(--faint)] shrink-0">{new Date(a.createdAt).toLocaleString()}</span>
            </div>
          ))}
        </div>
      </Card> : <EmptyState icon={Lock} title={attempts.length ? t('sec.nomatch', 'No matches') : t('sec.none.logins', 'No login attempts in this range')} />)}
      {tab === 'audit' && (
        <Card className="p-3 mb-3 flex items-center gap-3 flex-wrap">
          <ShieldCheck size={16} className="text-success shrink-0" />
          <div className="flex-1 min-w-[180px] text-sm">
            <div className="font-medium">{t('sec.tamper.title', 'Tamper-evident log')}</div>
            <div className="text-[11px] text-[var(--faint)]">{t('sec.tamper.desc', 'Every staff action is HMAC-chained — edits or deletions are detectable. Sensitive actions (file downloads, DB writes, power) are anchored off-DB (catches truncation) and alert SUPERADMINs.')}</div>
          </div>
          {verify && verify !== 'checking' && !verify.error && (() => {
            const brk = verify.firstBreak || verify.anchorBreak;
            const reasonLabel = { content_altered: t('sec.r.content', 'Content altered'), chain_broken: t('sec.r.chain', 'Chain broken'), anchored_entry_deleted: t('sec.r.truncated', 'Log truncated'), anchored_entry_altered: t('sec.r.anchored', 'Anchored entry altered') }[brk?.reason] || t('sec.r.tampered', 'Tampered');
            return verify.ok
              ? <Badge tone="green" className="flex items-center gap-1"><CheckCircle2 size={12} /> {t('sec.intact', 'Intact')} · {verify.checked} {t('sec.chained', 'chained')}{verify.anchorsChecked ? ` · ${verify.anchorsChecked} ${t('sec.anchored', 'anchored')}` : ''}{verify.legacy ? ` (+${verify.legacy} ${t('sec.legacy', 'legacy')})` : ''}</Badge>
              : <Badge tone="red" className="flex items-center gap-1"><AlertTriangle size={12} /> {reasonLabel}{brk?.at ? ` @ ${new Date(brk.at).toLocaleString()}` : ''}</Badge>;
          })()}
          {verify?.error && <Badge tone="red">{t('sec.verify.failed', 'Verify failed')}</Badge>}
          <Button size="sm" variant="ghost" disabled={verify === 'checking'} onClick={runVerify}>{verify === 'checking' ? <Spinner /> : <><ShieldCheck size={13} /> {t('sec.verify', 'Verify integrity')}</>}</Button>
        </Card>
      )}
      {tab === 'audit' && (audit.loading ? <Loading /> : filteredEntries.length ? <Card className="p-0 overflow-hidden">
        <div className="max-h-[65vh] overflow-auto divide-y divide-[var(--line)]">
          {filteredEntries.map((e) => (
            <div key={e.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <Shield size={15} className="text-[var(--primary-2)] shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="truncate"><span className="font-medium">{e.actor?.displayName || '—'}</span> <span className="text-[var(--muted)]">{e.action}</span>{e.detail && <span className="text-[var(--faint)]"> · {e.detail}</span>}</div>
                <div className="text-[11px] text-[var(--faint)] font-mono"><button onClick={() => setQ(e.ip)} className="hover:text-[var(--primary-2)]">{e.ip}</button></div>
              </div>
              <span className="text-[11px] text-[var(--faint)] shrink-0">{new Date(e.createdAt).toLocaleString()}</span>
            </div>
          ))}
        </div>
      </Card> : <EmptyState icon={Shield} title={entries.length ? t('sec.nomatch', 'No matches') : t('sec.none.audit', 'No audit entries in this range')} />)}
    </div>
  );
}

// A compact multi-line SVG chart for cpu/mem/disk % history — same hand-rolled
// approach as the repo dashboard's traffic chart (no charting library dependency).
// Smooth path through points [{x,y}] via Catmull-Rom → cubic Bézier. Turns jagged
// straight-segment line charts into polished flowing curves (the "pro chart" look).
function smoothPath(pts) {
  if (!pts.length) return '';
  if (pts.length < 3) return pts.map((p, i) => `${i ? 'L' : 'M'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

function MetricChart({ history }) {
  const [wrapRef, W] = useElementWidth(760); const H = 200; const padL = 32; const padR = 8; const padY = 16;
  const [hoverIdx, setHoverIdx] = useState(null);
  if (!history.length) return <div className="text-sm text-[var(--faint)] py-10 text-center">No samples yet — click "Sample now" or wait for the next ~10 min tick.</div>;
  const n = history.length;
  const x = (i) => n === 1 ? (padL + W - padR) / 2 : padL + (i / Math.max(1, n - 1)) * (W - padL - padR);
  const y = (pct) => H - padY - (Math.max(0, Math.min(100, pct)) / 100) * (H - padY * 2);
  // A lone point (or two) has no meaningful line yet — draw dots too, so the chart
  // is never blank while history is still building up (a single "M ..." path with
  // no "L" segment renders invisibly, which looked like a broken/empty graph).
  const series = (key, color) => {
    const d = smoothPath(history.map((h, i) => ({ x: x(i), y: y(h[key]) })));
    return (
      <g key={key}>
        {n > 1 && <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
        {history.map((h, i) => <circle key={i} cx={x(i)} cy={y(h[key])} r={hoverIdx === i ? (n > 12 ? 3 : 4) : (n > 12 ? 1.5 : 2.5)} fill={color} />)}
      </g>
    );
  };
  // Map mouse position -> nearest sample by comparing against the SVG's own
  // viewBox coordinate space (via its rendered bounding box), so this stays
  // correct regardless of how wide the chart is actually drawn on screen.
  const onMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const svgX = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0; let bestDist = Infinity;
    for (let i = 0; i < n; i++) { const d = Math.abs(x(i) - svgX); if (d < bestDist) { bestDist = d; best = i; } }
    setHoverIdx(best);
  };
  const hv = hoverIdx != null ? history[hoverIdx] : null;
  const ttW = 132; const ttH = 62;
  const ttX = hoverIdx != null ? Math.min(Math.max(x(hoverIdx) - ttW / 2, padL), W - padR - ttW) : 0;
  return (
    <div ref={wrapRef} className="w-full">
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="192" preserveAspectRatio="none" className="cursor-crosshair" onMouseMove={onMove} onMouseLeave={() => setHoverIdx(null)}>
      {/* Danger band: anything above 90% is tinted red so sustained pressure is obvious. */}
      <rect x={padL} y={y(100)} width={W - padL - padR} height={y(90) - y(100)} fill="#f87171" opacity="0.08" />
      <line x1={padL} x2={W - padR} y1={y(90)} y2={y(90)} stroke="#f87171" strokeWidth={1} strokeDasharray="4 3" opacity="0.5" />
      {[0, 25, 50, 75, 100].map((g) => (
        <g key={g}>
          <line x1={padL} x2={W - padR} y1={y(g)} y2={y(g)} stroke="var(--line)" strokeWidth={1} />
          <text x={2} y={y(g) + 3} fontSize="9" fill="var(--faint)">{g}%</text>
        </g>
      ))}
      {series('diskPct', '#a78bfa')}
      {series('memPct', '#38bdf8')}
      {series('cpuPct', '#f97316')}
      {hv && (
        <g pointerEvents="none">
          <line x1={x(hoverIdx)} x2={x(hoverIdx)} y1={padY} y2={H - padY} stroke="var(--faint)" strokeWidth={1} strokeDasharray="3 3" />
          <rect x={ttX} y={4} width={ttW} height={ttH} rx={6} fill="var(--surface-2)" stroke="var(--line)" />
          <text x={ttX + 8} y={18} fontSize="9" fill="var(--faint)">{new Date(hv.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</text>
          <text x={ttX + 8} y={32} fontSize="10" fontWeight="600" fill="#f97316">CPU {hv.cpuPct.toFixed(1)}%</text>
          <text x={ttX + 8} y={45} fontSize="10" fontWeight="600" fill="#38bdf8">RAM {hv.memPct.toFixed(1)}%</text>
          <text x={ttX + 8} y={58} fontSize="10" fontWeight="600" fill="#a78bfa">Disk {hv.diskPct.toFixed(1)}%</text>
        </g>
      )}
    </svg>
    </div>
  );
}

// Utilisation thresholds → tone. Disk fills slowly so its "warn" is higher; CPU/RAM
// spike, so they warn earlier. Used to colour the KPI cards and the health summary.
const PERF_THRESH = { cpuPct: [75, 90], memPct: [80, 92], diskPct: [85, 95], loadRatio: [1, 1.5] };
const toneFor = (v, [warn, crit]) => v == null ? '' : v >= crit ? 'crit' : v >= warn ? 'warn' : 'ok';
const TONE_TEXT = { ok: 'text-success', warn: 'text-warning', crit: 'text-error', '': '' };
const TONE_STROKE = { ok: '#34d399', warn: '#f59e0b', crit: '#f87171', '': 'var(--primary)' };
// kbit/s → a readable rate (Mb/s above 1000, else kb/s).
const fmtKbps = (k) => k == null ? '—' : k >= 1000 ? `${(k / 1000).toFixed(1)} Mb/s` : `${Math.round(k)} kb/s`;

// Server performance dashboard — read-only (no dangerous action lives here, so no
// step-up 2FA required). CPU/RAM/disk/latency/uptime are sampled from INSIDE this
// container every ~10 min by the sweeper (monitor.mjs); a per-container/per-service
// breakdown with restart controls would need Docker-socket access, which is a
// separate, bigger ask (see the "Advanced server management" tab).
// The thresholds every alert fires on. They lived only in the database until now, so
// tuning them meant writing SQL — and a threshold nobody can reach is a threshold nobody
// tunes, which is how an alert channel becomes noise people mute.
//
// The form shows the EFFECTIVE values (stored overrides merged with the defaults), never
// blank boxes: an empty field would read as "no threshold" when it actually means "the
// default applies". Reset writes an empty override rather than writing the defaults in,
// so a later change to a default is picked up instead of being frozen at today's number.
function AlertThresholds() {
  const { t } = useI18n(); const toast = useToast();
  const data = useAsync(() => api.get('/admin/server/thresholds'), []);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data.data?.thresholds) setForm(data.data.thresholds); }, [data.data]);

  const FIELDS = [
    { k: 'cpuPct', label: t('sp.th.cpu', 'CPU %'), hint: t('sp.th.cpu.h', 'Alert above this usage.') },
    { k: 'memPct', label: t('sp.th.mem', 'Memory %'), hint: t('sp.th.mem.h', 'Alert above this usage.') },
    { k: 'diskPct', label: t('sp.th.disk', 'Disk %'), hint: t('sp.th.disk.h', 'Alert above this usage.') },
    { k: 'storagePct', label: t('sp.th.storage', 'Storage pool %'), hint: t('sp.th.storage.h', 'Warn while a hosting pool still has room to act.') },
    { k: 'vitalsPoorPct', label: t('sp.th.vitals', 'Web Vitals poor %'), hint: t('sp.th.vitals.h', 'Share of "poor" samples on a metric, over the last hour.') },
    { k: 'vitalsMinSamples', label: t('sp.th.vitalsmin', 'Web Vitals min samples'), hint: t('sp.th.vitalsmin.h', 'Below this, two bad loads would fire it.') },
    { k: 'errorBurst', label: t('sp.th.errors', 'Error burst'), hint: t('sp.th.errors.h', 'New errors within ten minutes.') },
  ];

  const save = async () => {
    setBusy(true);
    try { const r = await api.put('/admin/server/thresholds', form); setForm(r.thresholds); toast.success(t('sp.th.saved', 'Thresholds saved.')); }
    catch { toast.error(t('sp.failed', 'Failed.')); } finally { setBusy(false); }
  };
  const reset = async () => {
    setBusy(true);
    try { const r = await api.put('/admin/server/thresholds', {}); setForm(r.thresholds); toast.success(t('sp.th.reset', 'Back to defaults.')); }
    catch { toast.error(t('sp.failed', 'Failed.')); } finally { setBusy(false); }
  };

  if (data.loading || !form) return <Loading />;
  return (
    <Card className="p-5">
      <p className="text-xs text-[var(--muted)] mb-3">
        {t('sp.th.sub', 'What each alert fires on. Leave them alone and the built-in defaults apply.')}
      </p>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {FIELDS.map((f) => (
          <Field key={f.k} label={f.label} hint={f.hint}>
            <Input type="number" min="0" value={form[f.k] ?? ''}
              onChange={(e) => setForm({ ...form, [f.k]: e.target.value === '' ? '' : Number(e.target.value) })} />
          </Field>
        ))}
      </div>
      <div className="flex gap-2 mt-4">
        <Button size="sm" variant="primary" disabled={busy} onClick={save}>{t('common.save', 'Save')}</Button>
        <Button size="sm" disabled={busy} onClick={reset}>{t('sp.th.resetbtn', 'Reset to defaults')}</Button>
      </div>
    </Card>
  );
}

function AdminServerPerf() {
  const toast = useToast();
  const { t } = useI18n();
  const { data, loading, reload } = useAsync(() => api.get('/admin/server/metrics'), []);
  const alerts = useAsync(() => api.get('/admin/server/alerts'), []);
  const outages = useAsync(() => api.get('/admin/server/outages'), []);
  const depsCfg = useAsync(() => api.get('/admin/server/deps-config'), []);
  const [busy, setBusy] = useState(false);
  const [configuring, setConfiguring] = useState(false);
  const [depsBusy, setDepsBusy] = useState(false);
  // Live network rate: diff the cumulative rx/tx byte counters between two 30s refreshes.
  const netPrevRef = useRef(null);
  const [liveNet, setLiveNet] = useState({ rx: null, tx: null });
  const [sec, setSec] = useState({ alloc: true, downtime: true, alerts: true, outages: true, vitals: true }); // collapsible sections
  const [outageOpen, setOutageOpen] = useState(null);
  const toggleSec = (k) => setSec((s) => ({ ...s, [k]: !s[k] }));
  useEffect(() => {
    const cur = data?.net; if (!cur) return;
    const prev = netPrevRef.current;
    if (prev && cur.at > prev.at) {
      const dt = (cur.at - prev.at) / 1000;
      setLiveNet({ rx: Math.max(0, Math.round((cur.rx - prev.rx) * 8 / 1000 / dt)), tx: Math.max(0, Math.round((cur.tx - prev.tx) * 8 / 1000 / dt)) });
    }
    netPrevRef.current = cur;
  }, [data?.net?.at]);
  // Auto-refresh the read-only metrics + alerts every 30s (cheap — deps/SSL config,
  // which rarely changes, is NOT re-polled). Keeps the dashboard live between samples.
  useEffect(() => { const id = setInterval(() => { reload(); alerts.reload(); }, 30_000); return () => clearInterval(id); /* eslint-disable-next-line */ }, []);
  const sampleNow = async () => {
    setBusy(true);
    try { await api.post('/admin/server/sample-now'); toast.success(t('sp.sampled', 'Sampled.')); reload(); alerts.reload(); } catch { toast.error(t('sp.failed', 'Failed.')); } finally { setBusy(false); }
  };
  // Acknowledging is not resolving: it clears the tab badge and says a human has read the
  // alert. Nothing about the underlying condition changes, and the row stays in the list.
  const [ackPending, setAckPending] = useState(false);
  const ackAll = () => {
    // The same undo window as everything else on this site that cannot be un-clicked. The
    // badge clears now — that IS the undo affordance — and the write happens when the toast
    // expires, so cancelling never touched the server.
    setAckPending(true);
    toast.action({
      tone: 'success', cancelLabel: t('common.undo', 'Undo'), msg: t('sp.al.acked', 'Marked as seen.'),
      onCommit: async () => {
        try { await api.post('/admin/server/alerts/ack'); alerts.reload(); }
        catch { toast.error(t('sp.failed', 'Failed.')); }
        finally { setAckPending(false); }
      },
      onCancel: () => setAckPending(false),
    });
  };
  const toggleDep = async (key, on) => {
    setDepsBusy(true);
    try { await api.put('/admin/server/deps-config', { [key]: on }); depsCfg.reload(); reload(); } catch { toast.error(t('sp.failed', 'Failed.')); } finally { setDepsBusy(false); }
  };
  // Only blank to a spinner on the FIRST load — during the 30s background refresh keep
  // showing the current data (otherwise the whole tab flashes empty every 30s).
  // The two histories, merged into one list.
  //
  // They come from different places and mean different things — a gap in our own samples is
  // the server itself being gone, a ServiceOutage row is one dependency refusing — but to
  // whoever was turned away they are the same event, so they are read as one list and the
  // row says which kind it is. Sorted newest first, because the question is almost always
  // "what just happened".
  const fmtDur = (sec) => (sec < 90 ? `${Math.round(sec)}s` : sec < 5400 ? `${Math.round(sec / 60)} min` : `${(sec / 3600).toFixed(1)} h`);
  const mergedOutages = useMemo(() => {
    const dt = data?.downtime || [];
    const dep = (outages.data?.outages || []).map((o) => ({
      key: `d-${o.id}`, source: 'dep', label: o.label, cause: o.cause,
      startedAt: o.startedAt, endedAt: o.endedAt, seconds: o.seconds, ongoing: o.ongoing,
    }));
    const srv = dt.map((d, i) => ({
      key: `s-${i}-${d.from}`, source: 'server',
      label: t('sp.out.server', 'The server'),
      cause: t('sp.out.server.cause', 'No sample was recorded for this period — the process was down or restarting.'),
      startedAt: d.from, endedAt: d.to, seconds: (d.minutes || 0) * 60, ongoing: false,
    }));
    return [...dep, ...srv].sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
  }, [outages.data, data?.downtime, t]);

  // Availability per source over the same window the outages were fetched for. The server's
  // own row is computed from the same gaps, so the two numbers are comparable.
  const uptimeRows = useMemo(() => {
    const days = outages.data?.days || 30;
    const windowSec = days * 86400;
    const rows = (outages.data?.uptime || []).map((u) => ({ key: u.dep, label: u.label, pct: u.pct, downSeconds: u.downSeconds }));
    const srvDown = (data?.downtime || []).reduce((n, d) => n + (d.minutes || 0) * 60, 0);
    if (srvDown) {
      rows.push({
        key: '__server', label: t('sp.out.server', 'The server'),
        downSeconds: srvDown, pct: Math.max(0, Math.round((1 - srvDown / windowSec) * 10000) / 100),
      });
    }
    return rows.sort((a, b) => b.downSeconds - a.downSeconds);
  }, [outages.data, data?.downtime, t]);

  const outageLine = (o) => `${o.label} — ${fmtDur(o.seconds)} — ${new Date(o.startedAt).toLocaleString()}${o.endedAt ? ` → ${new Date(o.endedAt).toLocaleString()}` : ' → still down'}${o.cause ? ` — ${o.cause}` : ''}`;
  const copyOutages = async () => {
    const ok = await copyText([`BetterCommunity outage history`, `exported: ${new Date().toISOString()}`, '', ...mergedOutages.map(outageLine)].join('\n'));
    ok ? toast.success(t('common.copied', 'Copied.')) : toast.error(t('sp.al.copyfail', 'Could not copy — select the rows manually.'));
  };

  if (loading && !data) return <Loading />;
  const latest = data?.latest;
  const deps = data?.deps || {};
  const ssl = data?.ssl;
  const history = data?.history || [];
  const downtime = data?.downtime || [];
  const cg = data?.cgroupMemory;
  const totals = data?.totals || {};
  const labels = depsCfg.data?.labels || {};
  const allKeys = depsCfg.data?.keys || Object.keys(deps);
  const enabledCfg = depsCfg.data?.enabled || {};
  const depBadge = (ok, label) => <Badge key={label} tone={ok === null ? '' : ok ? 'green' : 'red'}>{ok === null ? <Clock size={10} /> : ok ? <CheckCircle2 size={10} /> : <XCircle size={10} />} {label}</Badge>;
  const gb = (b) => b == null ? null : b / 1024 ** 3;
  const memUsedGB = totals.memTotalBytes != null && totals.memFreeBytes != null ? gb(totals.memTotalBytes - totals.memFreeBytes) : null;
  const diskUsedGB = totals.diskTotalBytes != null && totals.diskFreeBytes != null ? gb(totals.diskTotalBytes - totals.diskFreeBytes) : null;
  // Per-metric tone (green/amber/red) + an overall health rollup = the worst of them.
  const loadRatio = latest && totals.cpuCores ? latest.loadAvg1 / totals.cpuCores : null;
  const cpuTone = toneFor(latest?.cpuPct, PERF_THRESH.cpuPct), memTone = toneFor(latest?.memPct, PERF_THRESH.memPct), diskTone = toneFor(latest?.diskPct, PERF_THRESH.diskPct), loadTone = toneFor(loadRatio, PERF_THRESH.loadRatio);
  const worst = [cpuTone, memTone, diskTone, loadTone];
  const health = !latest ? null : worst.includes('crit') ? 'crit' : worst.includes('warn') ? 'warn' : 'ok';
  const healthLabel = { ok: t('sp.health.ok', 'Healthy'), warn: t('sp.health.warn', 'Under load'), crit: t('sp.health.crit', 'Critical') }[health];
  // Per-metric sparklines from the sampled history (oldest→newest).
  const spark = (key) => history.map((h) => h[key]).filter((v) => v != null);
  const kpi = (label, value, Icon, tone, sparkKey) => (
    <Card className="p-3 relative overflow-hidden">
      {sparkKey && spark(sparkKey).length > 1 && <Sparkline data={spark(sparkKey)} stroke={TONE_STROKE[tone]} className="absolute inset-x-0 bottom-0 h-8 w-full opacity-60 pointer-events-none" />}
      <div className="relative">
        <div className="flex items-center gap-2 text-[var(--faint)] text-xs mb-1"><Icon size={13} /> {label}</div>
        <div className={`text-xl font-bold tabular-nums ${TONE_TEXT[tone] || ''}`}>{value}</div>
      </div>
    </Card>
  );
  return (
    <div>
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <h2 className="font-semibold flex items-center gap-2"><Cpu size={16} className="text-[var(--primary-2)]" /> {t('sp.title', 'Server performance')}
          {health && <Badge tone={health === 'ok' ? 'green' : health === 'warn' ? 'amber' : 'red'}>{health === 'ok' ? <CheckCircle2 size={11} /> : <AlertTriangle size={11} />} {healthLabel}</Badge>}
        </h2>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-[var(--faint)] flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" /> {t('sp.auto', 'auto 30s')}</span>
          <Button size="sm" variant="ghost" disabled={busy} onClick={sampleNow}>{busy ? <Spinner /> : <><RefreshCw size={14} /> {t('sp.samplenow', 'Sample now')}</>}</Button>
        </div>
      </div>
      <p className="text-xs text-[var(--muted)] mb-3">{t('sp.desc', 'Metrics reflect this API container\'s own view (os/cgroup) — sampled every ~10 min, auto-refreshed here every 30s. A full per-service breakdown with restart controls needs Docker-socket access (see "Advanced server management").')}</p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
        {kpi('CPU', latest ? `${latest.cpuPct.toFixed(0)}%` : '—', Cpu, cpuTone, 'cpuPct')}
        {kpi(t('sp.memory', 'Memory'), latest ? `${latest.memPct.toFixed(0)}%` : '—', Gauge, memTone, 'memPct')}
        {kpi(t('sp.disk', 'Disk'), latest ? `${latest.diskPct.toFixed(0)}%` : '—', HardDrive, diskTone, 'diskPct')}
        {kpi(t('sp.load', 'Load (1m)'), latest ? latest.loadAvg1.toFixed(2) : '—', TrendingUp, loadTone)}
        {kpi(t('sp.uptime', 'Uptime'), latest ? `${(latest.uptimeSec / 3600).toFixed(1)}h` : '—', Clock, '')}
        {kpi(t('sp.latency', 'Avg latency'), latest?.latencyMs != null ? `${latest.latencyMs}ms` : '—', Zap, latest?.latencyMs != null ? toneFor(latest.latencyMs, [400, 1000]) : '')}
        {kpi(t('sp.download', 'Download'), (liveNet.rx ?? latest?.netRxKbps) != null ? fmtKbps(liveNet.rx ?? latest.netRxKbps) : '—', Download, '', 'netRxKbps')}
        {kpi(t('sp.upload', 'Upload'), (liveNet.tx ?? latest?.netTxKbps) != null ? fmtKbps(liveNet.tx ?? latest.netTxKbps) : '—', Upload, '', 'netTxKbps')}
      </div>

      {/* Absolute totals alongside the percentages above — "11% used" only means
          something once you know it's 11% of how much. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <Card className="p-3"><div className="flex items-center gap-2 text-[var(--faint)] text-xs mb-1"><Cpu size={13} /> {t('sp.cores', 'CPU cores')}</div><div className="text-xl font-bold tabular-nums">{totals.cpuCores ?? '—'}</div></Card>
        <Card className="p-3"><div className="flex items-center gap-2 text-[var(--faint)] text-xs mb-1"><Gauge size={13} /> {t('sp.ramtotal', 'RAM total')}</div><div className="text-xl font-bold tabular-nums">{memUsedGB != null ? `${memUsedGB.toFixed(1)} / ${gb(totals.memTotalBytes).toFixed(1)} GB` : '—'}</div></Card>
        <Card className="p-3"><div className="flex items-center gap-2 text-[var(--faint)] text-xs mb-1"><HardDrive size={13} /> {t('sp.disktotal', 'Disk total')}</div><div className="text-xl font-bold tabular-nums">{diskUsedGB != null ? `${diskUsedGB.toFixed(0)} / ${gb(totals.diskTotalBytes).toFixed(0)} GB` : '—'}</div></Card>
        <Card className="p-3"><div className="flex items-center gap-2 text-[var(--faint)] text-xs mb-1"><ShieldCheck size={13} /> {t('sp.availability', 'Availability')}</div><div className="text-xl font-bold tabular-nums">{totals.uptimePct != null ? `${totals.uptimePct.toFixed(2)}%` : '—'}</div></Card>
      </div>

      <Card className="p-4 mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)]">{t('sp.history', 'CPU / Memory / Disk — history')}</span>
          <span className="flex items-center gap-3 text-[11px] text-[var(--muted)]"><span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: '#f97316' }} /> CPU</span><span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: '#38bdf8' }} /> Mem</span><span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: '#a78bfa' }} /> Disk</span></span>
        </div>
        <MetricChart history={history} />
        {cg?.usedBytes != null && <div className="text-[11px] text-[var(--faint)] mt-2">This process's own cgroup memory: {(cg.usedBytes / 1024 / 1024).toFixed(0)} MB{cg.limitBytes ? ` / ${(cg.limitBytes / 1024 / 1024).toFixed(0)} MB allocated` : ' (no cgroup limit set — showing real usage only)'}.</div>}
      </Card>

      {/* Bandwidth served, broken down by what's consuming it (since the API last started). */}
      {(() => {
        const bw = data?.bandwidthByCat; if (!bw) return null;
        const rows = [['repo', t('sp.bw.repo', 'Repo downloads'), '#f97316'], ['catalog', t('sp.bw.catalog', 'Catalog / submissions'), '#38bdf8'], ['media', t('sp.bw.media', 'Media'), '#a78bfa'], ['other', t('sp.bw.other', 'App / API'), '#64748b']];
        const total = rows.reduce((a, [k]) => a + (bw[k] || 0), 0);
        return (
          <Card className="p-4 mb-4">
            <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] flex items-center gap-1.5"><Download size={13} className="text-[var(--primary-2)]" /> {t('sp.bw.title', 'Bandwidth served — by consumer')}</span>
              <span className="text-[11px] text-[var(--muted)] tabular-nums">{fmtBytes(total)} {t('sp.bw.since', 'since restart')}</span>
            </div>
            {total > 0 ? <>
              <div className="flex h-2.5 rounded-full overflow-hidden mb-2.5 bg-[var(--surface-2)]">
                {rows.map(([k, , c]) => (bw[k] || 0) > 0 && <div key={k} style={{ width: `${(bw[k] / total) * 100}%`, background: c }} title={`${bw[k]} B`} />)}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                {rows.map(([k, label, c]) => (
                  <div key={k} className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: c }} /><span className="text-[var(--muted)] truncate">{label}</span><span className="ml-auto tabular-nums font-medium">{Math.round(((bw[k] || 0) / total) * 100)}%</span></div>
                ))}
              </div>
              <p className="text-[11px] text-[var(--faint)] mt-2.5">{t('sp.bw.note', 'Counted from response sizes since the API last restarted. Telemetry runs as a separate service, so it isn’t included here.')}</p>
            </> : <div className="text-sm text-[var(--faint)]">{t('sp.bw.none', 'No traffic served yet since restart.')}</div>}
          </Card>
        );
      })()}

      {/* Per-repo ALLOCATED upload + live-served throughput and storage. (CPU is no
          longer a product dimension, so it's not shown here.) */}
      {(() => {
        const ra = data?.repoAllocations;
        if (!ra?.repos?.length) return null;
        return (
          <Card className="p-4 mb-4">
            <button onClick={() => toggleSec('alloc')} className="w-full flex items-center justify-between gap-2 mb-1 flex-wrap text-left">
              <span className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] flex items-center gap-1.5"><Server size={13} className="text-[var(--primary-2)]" /> {t('sp.alloc', 'Per-repo allocation')} <span className="text-[var(--muted)] normal-case tracking-normal">· {ra.repos.length}</span></span>
              <span className="flex items-center gap-2">
                <span className="text-[11px] tabular-nums text-[var(--muted)] hidden sm:inline">
                  {t('sp.alloc.summary2', '{n} repo(s) · {u} Mbps total upload').replace('{n}', ra.repos.length).replace('{u}', ra.totalUploadMbps)}
                </span>
                <ChevronDown size={15} className={`text-[var(--faint)] transition-transform ${sec.alloc ? '' : '-rotate-90'}`} />
              </span>
            </button>
            {sec.alloc && (() => {
              const totUsed = ra.repos.reduce((a, r) => a + (r.storageUsedBytes || 0), 0);
              const totQuota = ra.repos.reduce((a, r) => a + (r.storageQuotaBytes || 0), 0);
              const totLive = ra.repos.reduce((a, r) => a + (r.liveUploadMbps || 0), 0);
              return (
              <>
                {/* Totals summary — live upload actually served + storage used across all repos. */}
                <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)]/40 p-3 mb-3">
                  <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-[var(--faint)]">
                    <span className="flex items-center gap-1.5">{totLive > 0 && <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />}{t('sp.alloc.uplivetot', 'Live upload (total)')}: <b className="text-[var(--text)] tabular-nums">{totLive.toFixed(2)} Mbps</b> <span className="text-[var(--faint)]/70">/ {ra.totalUploadMbps} {t('sp.alloc.reserved', 'reserved')}</span></span>
                    <span>{t('sp.alloc.stotot', 'Storage used (total)')}: <b className="text-[var(--text)] tabular-nums">{fmtBytes(totUsed)} / {fmtBytes(totQuota)}</b></span>
                  </div>
                </div>
                <div className="text-[11px] text-[var(--faint)] mb-2">{t('sp.alloc.note3', "Upload = throughput actually served right now vs the plan limit; Storage = what's actually stored vs the quota.")}</div>

                {/* Per-repo table — live upload + storage, each with a real used/total bar. */}
                <div className="max-h-96 overflow-auto -mx-1">
                  <table className="w-full text-sm border-collapse min-w-[480px]">
                    <thead>
                      <tr className="text-[10px] uppercase tracking-wider text-[var(--faint)]">
                        <th className="font-semibold text-left py-1.5 pl-1 pr-3 min-w-[150px]">{t('sp.repo', 'Repo')}</th>
                        <th className="font-semibold text-left py-1.5 px-3 min-w-[150px]">{t('sp.upload', 'Upload')}</th>
                        <th className="font-semibold text-left py-1.5 pl-3 pr-1 min-w-[150px]">{t('sp.storage', 'Storage')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--line)]">
                      {ra.repos.map((r) => {
                        const stoUsed = r.storageQuotaBytes ? Math.min(100, (r.storageUsedBytes / r.storageQuotaBytes) * 100) : 0;
                        const stoTone = stoUsed >= 90 ? '#f87171' : stoUsed >= 70 ? '#f59e0b' : '#34d399';
                        const live = r.liveUploadMbps || 0;
                        const cap = r.uploadMbps || 0;
                        const upPct = cap > 0 ? Math.min(100, (live / cap) * 100) : (live > 0 ? 100 : 0);
                        return (
                          <tr key={r.id} className="hover:bg-[var(--surface-2)]/40">
                            <td className="py-2 pl-1 pr-3 min-w-[150px]">
                              <div className="font-medium break-all leading-tight">{r.name}</div>
                              <div className="text-[11px] text-[var(--faint)] flex items-center gap-1.5 flex-wrap">{r.owner}{r.status !== 'ONLINE' && <Badge tone={r.status === 'SUSPENDED' ? 'red' : ''}>{rawStatusLabel(r.status, t)}</Badge>}</div>
                            </td>
                            {/* Live upload actually served now vs the plan limit (0 = idle). */}
                            <td className="py-2 px-3">
                              <div className="flex items-baseline justify-between gap-2 text-[11px] tabular-nums mb-1">
                                <span className="flex items-center gap-1">{live > 0 && <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse shrink-0" />}<b className="text-[var(--text)]">{live.toFixed(2)}</b> <span className="text-[var(--faint)]">/ {cap} Mbps</span></span>
                                <span className="text-[var(--faint)]">{live <= 0 ? t('sp.alloc.idle', 'idle') : t('sp.alloc.pctused', '{n}%').replace('{n}', upPct.toFixed(0))}</span>
                              </div>
                              <div className="h-1.5 rounded-full bg-[var(--surface-2)] overflow-hidden"><div className="h-full rounded-full bg-info transition-all" style={{ width: `${Math.max(live > 0 ? 3 : 0, upPct)}%` }} /></div>
                            </td>
                            {/* Storage actually used vs quota. */}
                            <td className="py-2 pl-3 pr-1">
                              <div className="flex items-baseline justify-between gap-2 text-[11px] tabular-nums mb-1">
                                <span><b className="text-[var(--text)]">{fmtBytes(r.storageUsedBytes)}</b> <span className="text-[var(--faint)]">/ {fmtBytes(r.storageQuotaBytes)}</span></span>
                                <span className="text-[var(--faint)]">{stoUsed < 0.5 ? t('sp.alloc.empty', 'empty') : t('sp.alloc.pctused', '{n}%').replace('{n}', stoUsed.toFixed(0))}</span>
                              </div>
                              <div className="h-1.5 rounded-full bg-[var(--surface-2)] overflow-hidden"><div className="h-full rounded-full" style={{ width: `${Math.max(2, stoUsed)}%`, background: stoTone }} /></div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
              );
            })()}
          </Card>
        );
      })()}

      <div className="grid sm:grid-cols-2 gap-4 mb-4">
        <Card className="p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)]">{t('sp.deps', 'Dependencies')}</span>
            <button className="text-[11px] text-[var(--muted)] hover:text-[var(--text)] hover:underline" onClick={() => setConfiguring((c) => !c)}>{configuring ? t('sp.done', 'Done') : t('sp.configure', 'Configure')}</button>
          </div>
          {configuring ? (
            <div className="space-y-1.5">
              {allKeys.map((k) => (
                <label key={k} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" disabled={depsBusy} checked={enabledCfg[k] !== false} onChange={(e) => toggleDep(k, e.target.checked)} /> {labels[k] || k}
                </label>
              ))}
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {Object.keys(deps).length ? Object.entries(deps).map(([k, ok]) => depBadge(ok, labels[k] || k)) : <span className="text-xs text-[var(--faint)]">{t('sp.deps.off', 'All dependency checks are disabled.')}</span>}
            </div>
          )}
        </Card>
        <Card className="p-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-2 flex items-center gap-1.5"><Lock size={11} /> {t('sp.ssl', 'SSL certificate')}</div>
          {ssl?.notHttps ? <div className="text-xs text-[var(--muted)] flex items-center gap-1.5"><Info size={12} className="text-[var(--primary-2)] shrink-0" /> {t('sp.ssl.nohttps', 'SITE_URL is http:// — no certificate to probe. HTTPS is provisioned & auto-renewed by Caddy/Let’s Encrypt in production.')}</div>
            : ssl?.daysLeft != null ? <div className="text-sm">{ssl.daysLeft <= 14 ? <Badge tone="red">{t('sp.ssl.left', '{n}d left').replace('{n}', ssl.daysLeft)}</Badge> : ssl.daysLeft <= 30 ? <Badge tone="amber">{t('sp.ssl.left', '{n}d left').replace('{n}', ssl.daysLeft)}</Badge> : <Badge tone="green">{t('sp.ssl.left', '{n}d left').replace('{n}', ssl.daysLeft)}</Badge>} <span className="text-[var(--faint)] text-xs">{t('sp.ssl.expires', 'expires {d}').replace('{d}', new Date(ssl.expiresAt).toLocaleDateString())}</span></div>
            : <div className="text-xs text-[var(--faint)]">{t('sp.ssl.noprobe', "Couldn't probe SITE_URL's certificate.")}</div>}
        </Card>
      </div>


      {/* The thresholds those alerts fire on, right above the alerts themselves — you
          read the list, then change what produced it. */}
      <div className="mt-8 pt-6 border-t border-[var(--line)]">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-2">{t('sp.th.title', 'Alert thresholds')}</h3>
        <AlertThresholds />
      </div>

      <div className="mt-8 pt-6 border-t border-[var(--line)]">
        <button onClick={() => toggleSec('alerts')} className="w-full flex items-center justify-between text-left mb-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] flex items-center gap-1.5">{t('sp.alerts', 'Recent alerts')}{(alerts.data?.alerts || []).length ? <span className="text-[var(--muted)] normal-case tracking-normal">· {alerts.data.alerts.length}</span> : null}</h3>
          <ChevronDown size={15} className={`text-[var(--faint)] transition-transform ${sec.alerts ? '' : '-rotate-90'}`} />
        </button>
        {sec.alerts && (alerts.loading ? <Loading /> : (() => {
          const list = alerts.data?.alerts || [];
          if (!list.length) return <EmptyState icon={CheckCircle2} title={t('sp.alerts.none', 'No alerts')} sub={t('sp.alerts.nonesub', 'Nothing has crossed a threshold yet.')} />;
          // Collapse repeats of the exact same alert (kind+message) into one row with a
          // count + first/last seen, so a long outage doesn't read as a wall of dupes.
          const groups = [];
          const byKey = new Map();
          for (const a of list) {
            const key = `${a.kind}::${a.message}`;
            if (byKey.has(key)) { const g = byKey.get(key); g.count++; g.firstAt = a.createdAt; }
            else { const g = { ...a, count: 1, firstAt: a.createdAt, lastAt: a.createdAt }; byKey.set(key, g); groups.push(g); }
          }
          const copyAll = async () => {
            const log = [
              `BetterCommunity server-perf alerts`,
              `exported: ${new Date().toISOString()}`,
              ``,
              ...groups.map((g) => `[${g.kind}] ${g.message}${g.count > 1 ? ` (×${g.count})` : ''} — last ${new Date(g.lastAt).toLocaleString()}${g.count > 1 ? `, first ${new Date(g.firstAt).toLocaleString()}` : ''}`),
            ].join('\n');
            const ok = await copyText(log);
            ok ? toast.success(t('common.copied', 'Copied.')) : toast.error(t('sp.al.copyfail', 'Could not copy — select the alerts manually.'));
          };
          const unacked = ackPending ? 0 : list.filter((a) => !a.ackAt).length;
          return (<>
            <div className="flex justify-end gap-2 mb-1.5">
              {unacked > 0 && (
                <Button size="sm" variant="ghost" onClick={ackAll} title={t('sp.al.ack.h', 'Clears the badge on this tab. The condition itself is unchanged.')}>
                  <CheckCircle2 size={12} /> {t('sp.al.ack', 'Mark {n} as seen').replace('{n}', String(unacked))}
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={copyAll}><Copy size={12} /> {t('sp.al.copyall', 'Copy all')}</Button>
            </div>
            <div className="space-y-1.5 max-h-96 overflow-auto pr-1 -mr-1">
              {groups.map((g) => <AlertRow key={g.id} a={g} />)}
            </div>
          </>);
        })())}
      </div>

      {/* One outage history, not two.
          There were two sections answering "when was it broken", from different sources and
          disagreeing about what an outage even is: the gaps in our own sampling (the server
          itself was down or restarting) and the periods a dependency was unreachable. Both
          are outages to whoever was refused, so they are one list — with the source named on
          each row, because "the database was unreachable for 8 minutes" and "the whole
          process was gone for 10 hours" call for very different reactions.
          A Card, like everything else on this page: a bare div ignores the translucent-
          surfaces setting and reads as loose text rather than as a panel. */}
      <Card className="p-4 mt-4">
        <button onClick={() => toggleSec('outages')} className="w-full flex items-center justify-between text-left mb-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] flex items-center gap-1.5">
            <AlertTriangle size={11} /> {t('sp.out.title', 'Outage history')}
            {mergedOutages.length > 0 && <span className="text-[var(--muted)] normal-case tracking-normal">· {mergedOutages.length}</span>}
            {mergedOutages.some((o) => o.ongoing) && <span className="text-error normal-case tracking-normal">· {t('sp.out.ongoing', 'one is ongoing')}</span>}
          </span>
          <ChevronDown size={15} className={`text-[var(--faint)] transition-transform ${sec.outages ? '' : '-rotate-90'}`} />
        </button>
        {sec.outages && (outages.loading && !outages.data ? <Loading /> : !mergedOutages.length ? (
          <EmptyState icon={CheckCircle2} title={t('sp.out.none', 'No outage recorded')}
            sub={t('sp.out.nonesub2', 'Nothing has been unreachable, and the server has not stopped reporting, in the window kept. Both are measured by the same 10-minute check that raises the alerts — anything shorter than one interval is invisible to it.')} />
        ) : (<>
          {/* Availability per source, including the server itself. A percentage without the
              time behind it is a number you cannot argue with, so both are shown. */}
          {uptimeRows.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3">
              {uptimeRows.map((u) => (
                <span key={u.key} className="text-[11px] px-2 py-1 rounded-lg bg-[var(--surface-2)] border border-[var(--line)]">
                  {u.label} · <b className={u.pct < 99 ? 'text-warning' : ''}>{u.pct}%</b>{' '}
                  <span className="text-[var(--faint)]">({fmtDur(u.downSeconds)} {t('sp.out.down', 'down')})</span>
                </span>
              ))}
            </div>
          )}

          <div className="flex justify-end mb-1.5">
            <Button size="sm" variant="ghost" onClick={copyOutages}><Copy size={12} /> {t('sp.al.copyall', 'Copy all')}</Button>
          </div>

          <div className="space-y-1.5 max-h-96 overflow-auto pr-1 -mr-1">
            {mergedOutages.map((o) => {
              const from = new Date(o.startedAt);
              const to = o.endedAt ? new Date(o.endedAt) : null;
              const sameDay = to && from.toDateString() === to.toDateString();
              const time = (x) => x.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
              const day = (x) => x.toLocaleDateString([], { day: 'numeric', month: 'short' });
              return (
                <div key={o.key} role="button" tabIndex={0} onClick={() => setOutageOpen(o)}
                  onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); setOutageOpen(o); } }}
                  className="flex items-start gap-3 text-sm rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 group cursor-pointer hover:border-[var(--ring)] transition-colors">
                  <Badge tone={o.ongoing ? 'red' : o.seconds >= 3600 ? 'red' : 'amber'} className="shrink-0 tabular-nums mt-0.5">{fmtDur(o.seconds)}</Badge>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-medium">{o.label}</span>
                      {/* The source, said plainly: one of these means the box fell over. */}
                      <span className="text-[10px] uppercase tracking-wider text-[var(--faint)]">
                        {o.source === 'server' ? t('sp.out.src.server', 'stopped reporting') : t('sp.out.src.dep', 'unreachable')}
                      </span>
                      {o.ongoing && <span className="text-[10px] uppercase tracking-wider text-error">{t('sp.out.stillnow', 'still down')}</span>}
                    </div>
                    {o.cause && <div className="text-[11px] text-[var(--muted)] break-words">{o.cause}</div>}
                    <div className="text-[11px] text-[var(--faint)] tabular-nums">
                      {sameDay
                        ? <>{day(from)} · {time(from)} → {time(to)}</>
                        : to ? <>{day(from)} {time(from)} → {day(to)} {time(to)}</> : <>{day(from)} {time(from)} → …</>}
                      {' · '}{from.getFullYear()}
                    </div>
                  </div>
                  <button onClick={(ev) => { ev.stopPropagation(); copyText(outageLine(o)); toast.success(t('common.copied', 'Copied.')); }}
                    className="text-[var(--faint)] hover:text-[var(--primary-2)] shrink-0 opacity-0 group-hover:opacity-100 transition mt-0.5"
                    title={t('common.copy', 'Copy')}><Copy size={12} /></button>
                </div>
              );
            })}
          </div>
          {outageOpen && (
            <Modal open onClose={() => setOutageOpen(null)} width="max-w-lg" icon={AlertTriangle}
              title={`${outageOpen.label} · ${fmtDur(outageOpen.seconds)}`}>
              <div className="space-y-3 text-[13px]">
                {outageOpen.cause && <div className="rounded-lg bg-[var(--surface-2)] border border-[var(--line)] p-3 break-words">{outageOpen.cause}</div>}
                <div className="grid sm:grid-cols-2 gap-x-4 gap-y-1.5">
                  {[
                    [t('sp.out.d.what', 'What'), outageOpen.label],
                    [t('sp.out.d.kind', 'Kind'), outageOpen.source === 'server' ? t('sp.out.src.server', 'stopped reporting') : t('sp.out.src.dep', 'unreachable')],
                    [t('sp.out.d.from', 'Started'), new Date(outageOpen.startedAt).toLocaleString()],
                    [t('sp.out.d.to', 'Ended'), outageOpen.endedAt ? new Date(outageOpen.endedAt).toLocaleString() : t('sp.out.stillnow', 'still down')],
                    [t('sp.out.d.dur', 'Duration'), fmtDur(outageOpen.seconds)],
                  ].map(([k, v]) => (
                    <div key={k} className="flex items-baseline gap-2 min-w-0">
                      <span className="text-[10px] uppercase tracking-wider text-[var(--faint)] w-20 shrink-0">{k}</span>
                      <span className="break-words min-w-0">{v}</span>
                    </div>
                  ))}
                </div>
                {/* The measurement itself, said here rather than in a footnote: whether a
                    gap is real or just shorter than the check is the first question anybody
                    asks of an outage record. */}
                <p className="text-[11px] text-[var(--muted)]">
                  {outageOpen.source === 'server'
                    ? t('sp.out.d.srvnote', 'Measured as a gap in our own samples: the process recorded nothing for this period, which is what being down looks like from the inside.')
                    : t('sp.out.d.depnote', 'Measured by the dependency check that runs every ten minutes. An incident shorter than one interval is invisible to it.')}
                </p>
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" onClick={() => { copyText(outageLine(outageOpen)); toast.success(t('common.copied', 'Copied.')); }}><Copy size={12} /> {t('common.copy', 'Copy')}</Button>
                </div>
              </div>
            </Modal>
          )}
          <p className="text-[11px] text-[var(--muted)] mt-2">{t('sp.out.s2', 'A dependency outage is measured by the 10-minute dependency check; a “stopped reporting” one is a gap in our own samples, which is what being down looks like from the inside. Neither can see an incident shorter than one interval.')}</p>
        </>))}
      </Card>

      {/* Real-user Web Vitals — moved here from the Site-analytics tab so all
          performance (server-side + client-side) lives on one Server-perf tab.
          Collapsible + separated so it isn't jammed against the alerts list. */}
      <div className="mt-8 pt-6 border-t border-[var(--line)]">
        <button onClick={() => toggleSec('vitals')} className="w-full flex items-center justify-between text-left mb-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] flex items-center gap-1.5"><Gauge size={13} /> {t('sp.vitals', 'Web Vitals (real-user)')}</h3>
          <ChevronDown size={15} className={`text-[var(--faint)] transition-transform ${sec.vitals ? '' : '-rotate-90'}`} />
        </button>
        {sec.vitals && <WebVitals />}
      </div>
    </div>
  );
}

// A tiny in-container file browser, confined server-side to FILES_ROOT — good for
// inspecting the deployed code/config, not a general host filesystem browser.
// Two-step confirmation for actions that touch live server files/DB rows: a
// normal confirm dialog, then a second dialog that requires literally typing
// CONFIRM — the same token the backend independently re-checks (server-
// control.mjs's requireConfirm()), so this isn't just a UI speed bump.
// Type CONFIRM, THEN press the red button — in that order.
//
// It used to be the other way round: the danger button first, then a prompt whose OK was a
// generic "Continue". So the last gesture before something irreversible happened was an
// ordinary OK on a text box, which is exactly the click people make without reading. Now
// the typing is the speed bump and the final, deliberate act is pressing the red button
// that names what it will do.
async function doubleConfirm(dialog, { title, message, okLabel = 'Continue' }) {
  const typed = await dialog.prompt({
    title,
    message,
    label: `Type CONFIRM to continue.`,
    placeholder: 'CONFIRM',
    okLabel: 'Next',
  });
  if (typed !== 'CONFIRM') return false;
  return dialog.confirm({ title, message, okLabel, danger: true });
}

function FileManager() {
  const toast = useToast(); const dialog = useDialog(); const { t } = useI18n();
  const [dir, setDir] = useState('.');
  const [data, setData] = useState(null);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const [history, setHistory] = useState(null); // { path, items } for the backup-history modal
  const [trash, setTrash] = useState(null);     // deleted-but-restorable files, or null while closed
  const undoable = useUndoableSave(() => load(dir));

  const load = (d) => api.get(`/server/files?path=${encodeURIComponent(d)}`).then((r) => { setData(r); setDir(r.path); setQ(''); }).catch(() => toast.error(t('fm.listfail', 'Failed to list.')));
  useEffect(() => { load('.'); /* eslint-disable-next-line */ }, []);

  const openEntry = async (e) => {
    const full = dir === '.' ? e.name : `${dir}/${e.name}`;
    if (e.isDir) return load(full);
    try { const r = await api.get(`/server/files/read?path=${encodeURIComponent(full)}`); setEditing({ path: r.path, content: r.content }); }
    catch (x) { toast.error(x.data?.error === 'too_large' ? t('fm.toolarge', 'File too large to view here — use download instead.') : t('fm.readfail', 'Failed to read (probably binary — use download instead).')); }
  };
  const up = () => { const parts = dir.split('/').filter((x) => x !== '.'); parts.pop(); load(parts.length ? parts.join('/') : '.'); };
  // DELIBERATELY NOT behind the undo window. The undo window is a convenience for edits you
  // might regret, not a safety mechanism — and for this action a six-second "maybe" is worse
  // than a plain yes: you want to know, at the moment you click, that it has taken effect.
  const saveFile = async () => {
    if (!(await doubleConfirm(dialog, { title: t('fm.savechanges', 'Save changes'), message: t('fm.saveconfirm', 'Overwrite "{p}" on the live server? A backup of the current content is kept automatically.').replace('{p}', editing.path), okLabel: t('common.save', 'Save') }))) return;
    setBusy(true);
    try { await api.put('/server/files/write', { path: editing.path, content: editing.content, confirmToken: 'CONFIRM' }); toast.success(t('fm.savedbackup', 'Saved — a backup of the previous version was kept.')); setEditing(null); }
    catch { toast.error(t('fm.savefail', 'Failed to save.')); } finally { setBusy(false); }
  };
  // Deleting is the one action here worth two safety nets, because it is the one whose
  // damage is invisible: the file simply stops being in the list.
  //
  //   1. A six-second undo window, during which the request has not been sent at all.
  //   2. If it does commit, the file is still in the backup repo and now appears under
  //      "Recently deleted" below — which is the half that was missing. Restore has always
  //      existed, but it needed a path to ask about, and a deleted file has no row to
  //      click on. You could only recover a file whose exact path you still remembered.
  //
  // Saving an edit keeps its immediate semantics on purpose (see saveFile above): there
  // the version history is the way back, and a six-second "maybe" is worse than a yes.
  const delEntry = async (e) => {
    const full = dir === '.' ? e.name : `${dir}/${e.name}`;
    if (!(await doubleConfirm(dialog, { title: t('fm.del', 'Delete'), message: t('fm.delconfirm2', 'Delete "{p}"? A backup is kept and it can be restored from "Recently deleted".').replace('{p}', full), okLabel: t('fm.del', 'Delete') }))) return;
    undoable(
      () => api.del(`/server/files?path=${encodeURIComponent(full)}&confirmToken=CONFIRM`),
      t('fm.deletedundo', 'Deleted “{p}”.').replace('{p}', full),
    );
  };

  const loadTrash = async () => {
    try { const r = await api.get('/server/files/deleted'); setTrash(r.deleted || []); }
    catch { toast.error(t('fm.trashfail', 'Failed to list deleted files.')); }
  };
  const restoreDeleted = async (row) => {
    if (!(await doubleConfirm(dialog, {
      title: t('fm.undelete', 'Restore this file'),
      message: t('fm.undeleteconfirm', 'Write "{p}" back to the server, with the content it had just before it was deleted?').replace('{p}', row.path),
      okLabel: t('fm.restorebtn', 'Restore'),
    }))) return;
    // Behind the undo window like the delete it reverses: writing a file onto a live
    // server is worth the same six seconds of grace as removing one.
    undoable(
      async () => { await api.post(`/server/files/backups/${row.hash}/restore`, { path: row.path, confirmToken: 'CONFIRM' }); await loadTrash(); },
      t('fm.restoredundo', 'Restored “{p}”.').replace('{p}', row.path),
    );
  };
  const viewHistory = async (full) => {
    try { const r = await api.get(`/server/files/backups?path=${encodeURIComponent(full)}`); setHistory({ path: full, items: r.history }); }
    catch { toast.error(t('fm.histfail', 'Failed to load history.')); }
  };
  const restoreVersion = async (hash) => {
    if (!(await doubleConfirm(dialog, { title: t('fm.restore', 'Restore this version'), message: t('fm.restoreconfirm', 'Overwrite "{p}" with the version from this backup? The current content is backed up first.').replace('{p}', history.path), okLabel: t('fm.restorebtn', 'Restore') }))) return;
    const path = history.path;
    setHistory(null);
    undoable(
      () => api.post(`/server/files/backups/${hash}/restore`, { path, confirmToken: 'CONFIRM' }),
      t('fm.restoredundo', 'Restored “{p}”.').replace('{p}', path),
    );
  };
  const newFolder = async () => {
    const name = await dialog.prompt({ title: t('fm.newfolder', 'New folder'), label: t('fm.foldername', 'Folder name'), placeholder: 'assets' });
    if (!name) return;
    const full = dir === '.' ? name : `${dir}/${name}`;
    try { await api.post('/server/files/mkdir', { path: full }); toast.success(t('fm.created', 'Created.')); load(dir); }
    catch (x) { toast.error(x.data?.error === 'already_exists' ? t('fm.exists', 'Already exists.') : t('common.failed', 'Failed.')); }
  };
  const newFile = async () => {
    const name = await dialog.prompt({ title: t('fm.newfile', 'New file'), label: t('fm.filename', 'File name'), placeholder: 'notes.txt' });
    if (!name) return;
    const full = dir === '.' ? name : `${dir}/${name}`;
    try { await api.put('/server/files/write', { path: full, content: '' }); toast.success(t('fm.created', 'Created.')); load(dir); }
    catch { toast.error(t('common.failed', 'Failed.')); }
  };
  const rename = async (e) => {
    const newName = await dialog.prompt({ title: t('fm.renametitle', 'Rename "{n}"').replace('{n}', e.name), label: t('fm.newname', 'New name'), placeholder: e.name });
    if (!newName || newName === e.name) return;
    const full = dir === '.' ? e.name : `${dir}/${e.name}`;
    try { await api.put('/server/files/rename', { path: full, newName }); toast.success(t('fm.renamed', 'Renamed.')); load(dir); }
    catch (x) { toast.error(x.data?.error === 'bad_name' ? t('fm.badname', 'Invalid name.') : t('common.failed', 'Failed.')); }
  };
  const downloadEntry = (e) => {
    const full = dir === '.' ? e.name : `${dir}/${e.name}`;
    window.open(`/api/server/files/download?path=${encodeURIComponent(full)}`, '_blank');
  };

  const crumbs = dir === '.' ? [] : dir.split('/').filter(Boolean);
  const entries = (data?.entries || []).filter((e) => !q.trim() || e.name.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-2 text-sm flex-wrap">
        <FileText size={14} className="text-[var(--primary-2)] shrink-0" /> <span className="font-semibold shrink-0">{t('fm.title', 'File manager')}</span>
        <div className="flex items-center gap-1 text-xs font-mono text-[var(--faint)] min-w-0 overflow-x-auto">
          <button onClick={() => load('.')} className="hover:text-[var(--primary-2)] shrink-0">/</button>
          {crumbs.map((c, i) => (
            <span key={i} className="flex items-center gap-1 shrink-0">
              <button onClick={() => load(crumbs.slice(0, i + 1).join('/'))} className="hover:text-[var(--primary-2)]">{c}</button>
              {i < crumbs.length - 1 && <span>/</span>}
            </span>
          ))}
        </div>
        <div className="flex-1" />
        <Button size="sm" onClick={newFolder}><Plus size={12} /> {t('fm.folder', 'Folder')}</Button>
        <Button size="sm" onClick={newFile}><Plus size={12} /> {t('fm.file', 'File')}</Button>
        {/* The way back to something you cannot browse to. */}
        <Button size="sm" variant={trash ? 'primary' : 'ghost'} onClick={() => (trash ? setTrash(null) : loadTrash())}>
          <RotateCcw size={12} /> {t('fm.trash', 'Recently deleted')}
        </Button>
        {dir !== '.' && <Button size="sm" onClick={up}>{t('fm.up', 'Up')}</Button>}
      </div>
      {editing ? (
        <div>
          <div className="flex items-center justify-between mb-1">
            <div className="text-xs text-[var(--faint)] font-mono">{editing.path}</div>
            <button onClick={() => viewHistory(editing.path)} className="text-xs text-[var(--faint)] hover:text-[var(--primary-2)] flex items-center gap-1"><History size={12} /> {t('fm.history', 'History')}</button>
          </div>
          <textarea value={editing.content} onChange={(e) => setEditing({ ...editing, content: e.target.value })} className="w-full h-64 font-mono text-xs bg-[var(--surface-2)] rounded-lg p-3 outline-none" spellCheck={false} />
          <div className="flex gap-2 mt-2"><Button variant="primary" disabled={busy} onClick={saveFile}>{busy ? <Spinner /> : t('common.save', 'Save')}</Button><Button onClick={() => setEditing(null)}>{t('su.cancel', 'Cancel')}</Button></div>
        </div>
      ) : trash ? (
        /* The deleted list REPLACES the browser rather than sitting beside it: it answers
           a different question ("what did I lose"), and mixing the two invites restoring a
           file into whichever directory you happen to be standing in. */
        <div>
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="text-xs text-[var(--muted)]">
              {t('fm.trash.desc', 'Files deleted through this manager that are still gone. Restoring writes back the content it had just before the delete.')}
            </div>
            <Button size="sm" onClick={() => setTrash(null)}>{t('common.close', 'Close')}</Button>
          </div>
          {!trash.length ? (
            <EmptyState icon={RotateCcw} title={t('fm.trash.none.t', 'Nothing deleted')} sub={t('fm.trash.none.s', 'Files removed here would be listed for restoring.')} />
          ) : (
            <div className="divide-y divide-[var(--line)]">
              {trash.map((row) => (
                <div key={`${row.path}-${row.hash}`} className="flex items-center gap-3 py-2">
                  <FileText size={14} className="text-[var(--faint)] shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-mono truncate">{row.path}</div>
                    <div className="text-[11px] text-[var(--faint)]">
                      {t('fm.trash.when', 'deleted {d}').replace('{d}', new Date(row.at).toLocaleString())} · {row.hash.slice(0, 8)}
                    </div>
                  </div>
                  {/* Download before restoring — sometimes you want the content back
                      without putting the file back onto a live server. */}
                  <a href={`/api/server/files/backups/${row.hash}/download?path=${encodeURIComponent(row.path)}`} download>
                    <Button size="sm" variant="ghost"><Download size={13} /></Button>
                  </a>
                  <Button size="sm" variant="primary" onClick={() => restoreDeleted(row)}>
                    <RotateCcw size={13} /> {t('fm.restorebtn', 'Restore')}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="relative mb-2"><Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--faint)]" />
            <Input className="!pl-8 !py-1.5 !text-xs" placeholder={t('fm.filter', 'Filter this folder…')} value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <div className="divide-y divide-[var(--line)] max-h-80 overflow-auto scroll-thin">
            {entries.length ? entries.map((e) => (
              <div key={e.name} className="flex items-center gap-2 py-1.5 text-sm group">
                <button onClick={() => openEntry(e)} className="flex-1 min-w-0 text-left flex items-center gap-2 hover:text-[var(--primary-2)]">
                  {e.isDir ? <FolderGit2 size={13} className="text-[var(--primary-2)] shrink-0" /> : <FileText size={13} className="text-[var(--faint)] shrink-0" />} <span className="truncate">{e.name}</span>
                </button>
                {!e.isDir && <span className="text-[11px] text-[var(--faint)] shrink-0">{(e.size / 1024).toFixed(1)} KB</span>}
                <span className="hidden group-hover:flex items-center gap-2 shrink-0">
                  {!e.isDir && <button onClick={() => downloadEntry(e)} className="text-[var(--faint)] hover:text-[var(--primary-2)]" title="Download"><Download size={12} /></button>}
                  {!e.isDir && <button onClick={() => viewHistory(dir === '.' ? e.name : `${dir}/${e.name}`)} className="text-[var(--faint)] hover:text-[var(--primary-2)]" title="Backup history"><History size={12} /></button>}
                  <button onClick={() => rename(e)} className="text-[var(--faint)] hover:text-[var(--primary-2)]" title="Rename"><PenSquare size={12} /></button>
                  <button onClick={() => delEntry(e)} className="text-[var(--faint)] hover:text-error" title="Delete"><Trash2 size={12} /></button>
                </span>
              </div>
            )) : <div className="text-xs text-[var(--faint)] py-4 text-center">{data?.entries?.length ? t('fm.nomatches', 'No matches.') : t('fm.emptydir', 'Empty directory.')}</div>}
          </div>
        </>
      )}
      {history && (
        <Modal open onClose={() => setHistory(null)} title={t('fm.histtitle', 'Backup history — {p}').replace('{p}', history.path)} icon={History} width="max-w-lg">
          {history.items.length ? (
            <div className="divide-y divide-[var(--line)] max-h-96 overflow-auto scroll-thin">
              {history.items.map((h) => (
                <div key={h.hash} className="flex items-center gap-2.5 py-2 text-sm">
                  <div className="flex-1 min-w-0"><div className="truncate">{h.message}</div><div className="text-[11px] text-[var(--faint)]">{new Date(h.at).toLocaleString()} · <code className="font-mono">{h.hash.slice(0, 8)}</code></div></div>
                  {/* Download the version instead of restoring it — the safe half of
                      "what did this file look like before", with nothing written to the
                      live server. */}
                  <a href={`/api/server/files/backups/${h.hash}/download?path=${encodeURIComponent(history.path)}`} download title={t('common.download', 'Download')}>
                    <Button size="sm" variant="ghost"><Download size={13} /></Button>
                  </a>
                  <Button size="sm" onClick={() => restoreVersion(h.hash)}>{t('fm.restorebtn', 'Restore')}</Button>
                </div>
              ))}
            </div>
          ) : <div className="text-xs text-[var(--faint)] py-6 text-center">{t('fm.nobackups', 'No backups yet for this file.')}</div>}
        </Modal>
      )}
    </Card>
  );
}

// Read-only database browser — table list + paginated rows, no free-form SQL
// input anywhere (that's exactly the surface the web terminal risked). Table
// names are validated server-side against the real Postgres catalog.
const DB_SENSITIVE_COL = /hash|secret|token|password|totp/i;

function DbViewer() {
  const toast = useToast(); const dialog = useDialog(); const { t } = useI18n();
  const [source, setSource] = useState('bcweb'); // 'bcweb' | 'telemetry'
  const [tables, setTables] = useState(null);
  const [tableQ, setTableQ] = useState('');
  const [active, setActive] = useState(null);
  const [rows, setRows] = useState(null);
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState({ col: null, dir: 'asc' });
  const [cell, setCell] = useState(null); // { col, value, pk } for the expand/edit modal
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [rowHistory, setRowHistory] = useState(null); // { table, pk, items }
  const pageSize = 25;
  const canEdit = source === 'bcweb'; // the telemetry DB is read-only (no cell/edit routes)
  const dbBase = (s = source) => (s === 'telemetry' ? '/server/telemetry-db' : '/server/db');

  useEffect(() => {
    setTables(null); setActive(null); setRows(null);
    api.get(`${dbBase(source)}/tables`).then((r) => setTables(r.tables))
      .catch((x) => toast.error(x.data?.error === 'telemetry_db_not_configured' ? t('dbv.notconfigured', 'BMM telemetry DB is not configured.') : t('dbv.listfail', 'Failed to list tables.')));
    /* eslint-disable-next-line */
  }, [source]);
  const openTable = async (name, p = 0, s = sort) => {
    setActive(name); setPage(p); setRows(null); setSort(s);
    try {
      const qs = new URLSearchParams({ page: p, pageSize }); if (s.col) { qs.set('sort', s.col); qs.set('dir', s.dir); }
      const r = await api.get(`${dbBase()}/table/${encodeURIComponent(name)}?${qs}`); setRows(r);
    } catch { toast.error(t('dbv.tablefail', 'Failed to load table.')); }
  };
  const toggleSort = (c) => openTable(active, 0, sort.col === c ? { col: c, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { col: c, dir: 'asc' });
  const cols = rows?.rows?.[0] ? Object.keys(rows.rows[0]) : [];
  const cellText = (v) => v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  const exportCsv = () => {
    if (!rows?.rows?.length) return;
    const esc = csvCell;
    const csv = [cols.map(esc).join(','), ...rows.rows.map((r) => cols.map((c) => esc(cellText(r[c]))).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `${active}_page${page + 1}.csv`; document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };
  const visibleTables = tables?.filter((t) => !tableQ.trim() || t.name.toLowerCase().includes(tableQ.trim().toLowerCase())) || [];

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-2 text-sm flex-wrap"><HardDrive size={14} className="text-[var(--primary-2)]" /><span className="font-semibold">{t('dbv.title', 'Database viewer')}</span>
        <span className="text-xs text-[var(--faint)]">{canEdit ? t('dbv.editcare', '(edit with care)') : t('dbv.readonly', '(read-only)')}</span>
        <div className="ml-auto flex rounded-lg border border-[var(--line)] overflow-hidden text-xs">
          {[['bcweb', 'BCWEB'], ['telemetry', 'BMM Telemetry']].map(([v, l]) => (
            <button key={v} onClick={() => setSource(v)} className={`px-2.5 py-1 ${source === v ? 'bg-[var(--surface-2)] text-[var(--text)] font-medium' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}>{l}</button>
          ))}
        </div>
      </div>
      {!tables ? <Loading /> : (
        <div className="grid sm:grid-cols-[180px_1fr] gap-3">
          <div>
            <div className="relative mb-1.5"><Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--faint)]" />
              <Input className="!pl-7 !py-1 !text-xs" placeholder={t('dbv.filtertables', 'Filter tables…')} value={tableQ} onChange={(e) => setTableQ(e.target.value)} /></div>
            <div className="max-h-80 overflow-auto scroll-thin space-y-0.5">
              {visibleTables.map((t) => (
                <button key={t.name} onClick={() => openTable(t.name)} className={`w-full text-left px-2 py-1.5 rounded-lg text-xs flex items-center justify-between gap-2 ${active === t.name ? 'bg-[var(--surface-2)] text-[var(--text)] font-medium' : 'text-[var(--muted)] hover:bg-[var(--surface-2)]'}`}>
                  <span className="truncate">{t.name}</span><span className="text-[var(--faint)] shrink-0">{t.approxRows}</span>
                </button>
              ))}
              {!visibleTables.length && <div className="text-xs text-[var(--faint)] py-3 text-center">{t('fm.nomatches', 'No matches.')}</div>}
            </div>
          </div>
          <div className="min-w-0">
            {!active ? <div className="text-xs text-[var(--faint)] py-6 text-center">{t('dbv.picktable', 'Pick a table.')}</div>
              : !rows ? <Loading />
              : (
                <>
                  <div className="overflow-auto max-h-96 scroll-thin border border-[var(--line)] rounded-lg">
                    <table className="text-xs w-full">
                      <thead><tr className="border-b border-[var(--line)]">{cols.map((c) => (
                        <th key={c} className="text-left px-2 py-1.5 font-semibold text-[var(--faint)] whitespace-nowrap">
                          <button onClick={() => toggleSort(c)} className="flex items-center gap-1 hover:text-[var(--text)]">
                            {c} {sort.col === c && <ChevronDown size={11} className={sort.dir === 'asc' ? 'rotate-180' : ''} />}
                          </button>
                        </th>
                      ))}</tr></thead>
                      <tbody>
                        {rows.rows.map((r, i) => (
                          <tr key={i} className="border-b border-[var(--line)] last:border-0">
                            {cols.map((c) => (
                              <td key={c} onClick={() => { setCell({ col: c, value: r[c], pk: rows.pkColumn ? r[rows.pkColumn] : null }); setDraft(r[c] === null ? '' : cellText(r[c])); }} className="px-2 py-1.5 whitespace-nowrap max-w-[220px] truncate font-mono cursor-pointer hover:bg-[var(--surface-2)]" title="Click to view / edit">
                                {r[c] === null ? <span className="text-[var(--faint)]">null</span> : cellText(r[c])}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex items-center justify-between mt-2 text-xs text-[var(--muted)]">
                    <span>{rows.total} {rows.total !== 1 ? t('dbv.rows', 'rows') : t('dbv.row', 'row')}</span>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={exportCsv}><Download size={12} /> {t('dbv.csv', 'CSV (page)')}</Button>
                      <Button size="sm" disabled={page === 0} onClick={() => openTable(active, page - 1)}>{t('dbv.prev', 'Prev')}</Button>
                      <Button size="sm" disabled={(page + 1) * pageSize >= rows.total} onClick={() => openTable(active, page + 1)}>{t('dbv.next', 'Next')}</Button>
                    </div>
                  </div>
                </>
              )}
          </div>
          {cell && (() => {
            const isPk = rows?.pkColumn === cell.col;
            const protected_ = DB_SENSITIVE_COL.test(cell.col);
            const editable = canEdit && !!rows?.pkColumn && cell.pk != null && !isPk && !protected_;
            // DELIBERATELY NOT behind the undo window: this writes a row straight into the
            // database. It already carries a double confirmation and a confirmToken, and the
            // server backs the old value up — that is the right shape of safety here. Adding a
            // six-second "maybe" on top would only blur when the write actually happened.
            const save = async () => {
              if (!(await doubleConfirm(dialog, { title: t('dbv.saverow', 'Save row edit'), message: t('dbv.saverowconfirm', 'Overwrite {t}.{c} (row {pk}) on the live database? The current row is backed up automatically.').replace('{t}', active).replace('{c}', cell.col).replace('{pk}', cell.pk), okLabel: t('common.save', 'Save') }))) return;
              setSaving(true);
              try {
                await api.put(`/server/db/table/${encodeURIComponent(active)}/cell`, { pk: cell.pk, column: cell.col, value: draft, confirmToken: 'CONFIRM' });
                toast.success(t('dbv.rowsaved', 'Saved — the previous row value was backed up.'));
                setCell(null);
                openTable(active, page, sort);
              } catch (x) {
                toast.error(x.data?.error === 'table_protected' ? t('dbv.tableprotected', 'Audit/log tables are read-only — they can\'t be edited here.') : x.data?.error === 'column_protected' ? t('dbv.colprotected', 'This column can\'t be edited here.') : x.data?.error === 'update_failed' ? t('dbv.updatefail', 'Failed: {d}').replace('{d}', x.data?.detail || 'invalid value') : t('common.failed', 'Failed.'));
              } finally { setSaving(false); }
            };
            const viewRowHistory = async () => {
              try { const r = await api.get(`/server/db/backups?table=${encodeURIComponent(active)}&pk=${encodeURIComponent(cell.pk)}`); setRowHistory({ table: active, pk: cell.pk, items: r.history }); }
              catch { toast.error(t('fm.histfail', 'Failed to load history.')); }
            };
            return (
              <Modal open onClose={() => setCell(null)} title={cell.col} icon={HardDrive} width="max-w-lg"
                footer={editable ? <><Button onClick={() => setCell(null)}>{t('su.cancel', 'Cancel')}</Button><Button onClick={viewRowHistory}><History size={13} /> {t('fm.history', 'History')}</Button><Button variant="primary" disabled={saving} onClick={save}>{saving ? <Spinner /> : t('common.save', 'Save')}</Button></> : undefined}>
                {editable ? (
                  <textarea value={draft} onChange={(e) => setDraft(e.target.value)} className="w-full h-40 font-mono text-xs bg-[var(--surface-2)] rounded-lg p-3 outline-none" spellCheck={false} />
                ) : (
                  <>
                    <pre className="text-xs font-mono bg-[var(--surface-2)] rounded-lg p-3 max-h-80 overflow-auto scroll-thin whitespace-pre-wrap break-all">{cell.value === null ? 'null' : cellText(cell.value)}</pre>
                    <p className="text-xs text-[var(--faint)] mt-2">{protected_ ? t('dbv.sensitivenote', "This column can't be edited here (sensitive).") : isPk ? t('dbv.pknote', "The primary key can't be edited.") : t('dbv.nopknote', 'This table has no single-column primary key, so it can only be viewed.')}</p>
                  </>
                )}
              </Modal>
            );
          })()}
          {rowHistory && (
            <Modal open onClose={() => setRowHistory(null)} title={t('dbv.rowhisttitle', 'Row backup history — {t} (pk={pk})').replace('{t}', rowHistory.table).replace('{pk}', rowHistory.pk)} icon={History} width="max-w-lg">
              {rowHistory.items.length ? (
                <div className="divide-y divide-[var(--line)] max-h-96 overflow-auto scroll-thin">
                  {rowHistory.items.map((h) => (
                    <div key={h.hash} className="flex items-center gap-2.5 py-2 text-sm">
                      <div className="flex-1 min-w-0"><div className="truncate">{h.message}</div><div className="text-[11px] text-[var(--faint)]">{new Date(h.at).toLocaleString()} · <code className="font-mono">{h.hash.slice(0, 8)}</code></div></div>
                      <Button size="sm" onClick={async () => {
                        if (!(await doubleConfirm(dialog, { title: t('dbv.restorerow', 'Restore this row'), message: t('dbv.restorerowconfirm', 'Overwrite {t} (pk={pk}) with this backed-up version? Sensitive columns are never restored. The current row is backed up first.').replace('{t}', rowHistory.table).replace('{pk}', rowHistory.pk), okLabel: t('fm.restorebtn', 'Restore') }))) return;
                        try { const r = await api.post(`/server/db/backups/${h.hash}/restore`, { table: rowHistory.table, pk: rowHistory.pk, confirmToken: 'CONFIRM' }); toast.success(t('dbv.rowrestored', 'Restored {n} column(s){s}.').replace('{n}', r.restored.length).replace('{s}', r.skipped.length ? t('dbv.skipped', ', skipped {k}').replace('{k}', r.skipped.length) : '')); setRowHistory(null); setCell(null); openTable(active, page, sort); }
                        catch { toast.error(t('fm.restorefail', 'Failed to restore.')); }
                      }}>{t('fm.restorebtn', 'Restore')}</Button>
                    </div>
                  ))}
                </div>
              ) : <div className="text-xs text-[var(--faint)] py-6 text-center">{t('dbv.norowbackups', 'No backups yet for this row.')}</div>}
            </Modal>
          )}
        </div>
      )}
    </Card>
  );
}

// The step-up-gated "danger zone": file manager, read-only DB viewer, and a
// server restart — all confined to this container/process. Docker management
// and host power control are NOT wired up — they'd require mounting the Docker
// socket (and, for power, a privileged agent), a docker-compose change with real
// security implications that hasn't been made.
function AdminServerAdvanced() {
  const toast = useToast(); const dialog = useDialog(); const { t } = useI18n(); const { user: me } = useAuth();
  const me2fa = useAsync(() => api.get('/me/2fa'), []);
  const elevateStatus = useAsync(() => api.get('/server/elevate/status').catch(() => ({ elevated: false })), []);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  const elevate = async () => {
    setBusy(true);
    try { await api.post('/server/elevate', { code: code.trim() }); toast.success(t('asa.elevated', 'Elevated for 15 minutes.')); setCode(''); elevateStatus.reload(); }
    catch (x) { toast.error(x.data?.error === 'invalid_code' ? t('asa.invalidcode', 'Invalid code.') : x.data?.error === '2fa_not_enabled' ? t('asa.no2fa', 'Enable 2FA in your profile first.') : x.data?.error === 'forbidden' ? t('asa.noaccess', "You don't have server-control access.") : t('common.failed', 'Failed.')); }
    finally { setBusy(false); }
  };

  if (me2fa.loading || elevateStatus.loading) return <Loading />;
  // Server control is deliberately ORTHOGONAL to the role hierarchy — even a SUPERADMIN
  // holds it only when it has been granted, so shell/Docker/power access is never ambient.
  // But telling a SUPERADMIN that "a SUPERADMIN must grant you" is a riddle: they are the
  // one who can, including to themselves. Say that instead.
  if (!me2fa.data?.canControlServer) return <EmptyState icon={AlertTriangle} title={t('asa.notauth', 'Not authorized')}
    sub={me?.role === 'SUPERADMIN'
      ? t('asa.notauthself', 'Server control is granted separately from your role, so it is never implicit — not even for a SUPERADMIN. Grant it to yourself in the Access & permissions tab.')
      : t('asa.notauthsub', 'A SUPERADMIN must grant you server-control access from the Access & permissions tab first.')} />;

  return (
    <div>
      <h2 className="font-semibold mb-1 flex items-center gap-2"><AlertTriangle size={16} className="text-error" /> {t('asa.title', 'Advanced server management')}</h2>
      <p className="text-sm text-[var(--muted)] mb-3">{t('asa.sub', "Confined to this API container's own filesystem/process — no host or Docker access today. A fuller per-service view (Docker start/stop/restart/logs, host power) needs a docker-compose change (mounting the Docker socket, or a separate privileged power agent) that hasn't been made yet.")}</p>

      {!elevateStatus.data?.elevated ? (
        <Card className="p-5 max-w-sm">
          <div className="text-sm font-semibold mb-2 flex items-center gap-2"><ShieldCheck size={15} className="text-[var(--primary-2)]" /> {t('asa.stepup', 'Step-up verification required')}</div>
          <p className="text-xs text-[var(--muted)] mb-3">{t('asa.stepupsub', 'Enter a fresh code from your authenticator app to unlock these tools for 15 minutes.')}</p>
          <div className="flex gap-2">
            <Input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="123456" />
            <Button variant="primary" disabled={busy || code.length !== 6} onClick={elevate}>{busy ? <Spinner /> : t('asa.elevate', 'Elevate')}</Button>
          </div>
          <div className="mt-2"><TotpQuickFill onFill={(c) => setCode(c)} /></div>
        </Card>
      ) : (
        <div className="space-y-4">
          <FileManager />
          <DbViewer />
          <BackupManager />
        </div>
      )}
    </div>
  );
}


// What is actually inside a backup, and the only place a rollback can be started.
//
// The rollback lives HERE rather than next to the row because it should not be reachable
// without having looked: the two facts that decide whether a restore is safe — is the file
// intact, and is it the backup you think it is — are both on this screen.
function SnapshotInspector({ id, onClose, onRestored }) {
  const { t } = useI18n(); const toast = useToast();
  const { data, loading } = useAsync(() => api.get(`/server/backups/snapshots/${id}/inspect`), [id]);
  const [confirm, setConfirm] = useState('');
  const [toDisk, setToDisk] = useState(false);
  const [busy, setBusy] = useState(false);

  const restore = async () => {
    setBusy(true);
    try {
      const r = await api.post(`/server/backups/snapshots/${id}/restore`, { confirmToken: 'CONFIRM', applyToDisk: toDisk });
      toast.success(t('snap.restored', 'Rolled back. The previous state was saved as a backup first ({n}).').replace('{n}', r.safetySnapshot?.id || '—'));
      // Said out loud, because it is the difference between what a rollback sounds like and
      // what a copy-over does: files created after the backup are still there.
      if (r.extra?.length) {
        toast.error(t('snap.extra', '{n} path(s) on disk were not in this backup and were left in place: {l}')
          .replace('{n}', String(r.extra.length)).replace('{l}', r.extra.slice(0, 6).join(', ')));
      }
      onRestored(); onClose();
    } catch (x) {
      toast.error(x?.data?.error === 'no_safety_snapshot' ? t('snap.nosafety', 'Could not back up the current state, so nothing was rolled back.')
        : x?.data?.error === 'invalid_bundle' ? t('snap.invalid', 'This backup does not verify — it will not be restored.')
        : t('common.failed', 'Failed.'));
    } finally { setBusy(false); }
  };

  const d = data || {};
  return (
    <Modal open onClose={onClose} title={t('snap.inspect', 'Inspect this backup')} icon={Archive} width="max-w-xl">
      {loading ? <Loading /> : (
        <div className="space-y-4">
          {/* One verdict, in a sentence, before the detail. The three checks were four badges
              of jargon in a row — a reader had to know what a digest is, and to work out for
              themselves whether the combination meant "safe to restore". */}
          <div className={`rounded-xl border p-3 ${d.valid && d.digestMatches ? 'border-success/40 bg-success/5' : d.valid ? 'border-warning/40 bg-warning/5' : 'border-error/40 bg-error/5'}`}>
            <div className="flex items-center gap-2 text-[14px] font-semibold">
              {d.valid && d.digestMatches ? <CheckCircle2 size={16} className="text-success" />
                : d.valid ? <AlertTriangle size={16} className="text-warning" />
                  : <XCircle size={16} className="text-error" />}
              {d.valid && d.digestMatches ? t('snap.v.ok', 'This backup is intact and is the file we wrote.')
                : d.valid ? t('snap.v.warn', 'This backup opens, but it is not the file we wrote.')
                  : t('snap.v.bad', 'This backup will not open.')}
            </div>
            <p className="text-[12px] text-[var(--muted)] mt-1">
              {d.valid && d.digestMatches ? t('snap.v.ok.s', 'Both checks passed, so a rollback will use exactly what was captured.')
                : d.valid ? t('snap.v.warn.s', 'Git reads it, but its fingerprint does not match the one recorded when it was made — it has been altered or replaced since. Do not roll back to it without knowing why.')
                  : t('snap.v.bad.s', 'Git cannot read it as a bundle, so there is nothing to restore from. Keep an older backup instead.')}
            </p>
          </div>

          {/* The two checks, each said in a full sentence rather than a word. They answer
              different questions and a reader who conflates them draws the wrong conclusion. */}
          <div className="grid sm:grid-cols-2 gap-2">
            {[
              [d.valid, t('snap.c.readable', 'Git can read it'), t('snap.c.readable.s', 'The file is a coherent bundle.')],
              [d.digestMatches, t('snap.c.ours', 'It is our file'), t('snap.c.ours.s', 'Its fingerprint matches what we recorded when it was written.')],
              [d.signature?.present, t('snap.c.signed', 'Signed'), t('snap.c.signed.s', 'Carries a signature that can be checked independently.')],
            ].map(([ok, label, desc]) => (
              <div key={label} className="flex items-start gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface-2)]/50 px-2.5 py-2">
                {ok ? <CheckCircle2 size={14} className="text-success shrink-0 mt-0.5" /> : <XCircle size={14} className="text-[var(--faint)] shrink-0 mt-0.5" />}
                <div className="min-w-0">
                  <div className="text-[12px] font-medium">{label}</div>
                  <div className="text-[11px] text-[var(--muted)]">{desc}</div>
                </div>
              </div>
            ))}
            <div className="flex items-start gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface-2)]/50 px-2.5 py-2">
              <Archive size={14} className="text-[var(--faint)] shrink-0 mt-0.5" />
              <div className="min-w-0">
                <div className="text-[12px] font-medium">{fmtBytes(d.meta?.bytes || 0)}</div>
                <div className="text-[11px] text-[var(--muted)]">{t('snap.c.size', 'On disk')}</div>
              </div>
            </div>
          </div>

          <div>
            <div className="text-[11px] uppercase tracking-wider text-[var(--faint)] mb-1">
              {t('snap.contents', 'What it contains')}
              {(d.commits || []).length > 0 && <span className="normal-case tracking-normal text-[var(--muted)]"> · {t('snap.ncommits', '{n} entries').replace('{n}', String(d.commits.length))}</span>}
            </div>
            <div className="max-h-56 overflow-y-auto divide-y divide-[var(--line)] rounded-lg border border-[var(--line)]">
              {(d.commits || []).map((c) => (
                <div key={c.hash} className="px-2.5 py-1.5 flex items-baseline gap-2 text-[12px]">
                  <code className="font-mono text-[10px] text-[var(--faint)] shrink-0">{c.hash.slice(0, 8)}</code>
                  <span className="truncate flex-1">{c.message}</span>
                  <span className="text-[11px] text-[var(--faint)] shrink-0">{new Date(c.at).toLocaleDateString()}</span>
                </div>
              ))}
              {!(d.commits || []).length && <div className="px-2.5 py-2 text-[12px] text-[var(--faint)]">{t('snap.nocommits', 'Nothing readable in it.')}</div>}
            </div>
          </div>

          {/* The raw git output, folded away. It is what you want when a check failed and
              noise the rest of the time. */}
          {d.verify && (
            <details className="rounded-lg border border-[var(--line)]">
              <summary className="px-2.5 py-1.5 text-[11px] text-[var(--muted)] cursor-pointer select-none">{t('snap.raw', 'Raw output from git')}</summary>
              <pre className="text-[10px] font-mono whitespace-pre-wrap text-[var(--muted)] bg-[var(--surface-2)] p-2 max-h-40 overflow-auto">{d.verify}</pre>
            </details>
          )}

          {d.valid && (
            <div className="rounded-lg border border-warning/40 bg-warning/5 p-3 space-y-2">
              <div className="text-[13px] font-semibold flex items-center gap-1.5"><RotateCcw size={13} /> {t('snap.rollback', 'Roll back to this backup')}</div>
              <p className="text-[11px] text-[var(--muted)]">
                {t('snap.rollback.s', 'The current state is backed up first and the rollback is refused if that fails — a rollback with no way back is just a hopeful restore. This resets the backup history only.')}
              </p>
              <p className="text-[11px] text-[var(--muted)]">
                {t('snap.rollback.merge', 'Writing to disk copies the backup OVER what is there. Files created since — uploads, caches, anything a later version writes — are not removed, so the result is a merge rather than an exact return to that moment. Whatever is left over is listed afterwards so you can decide about it.')}
              </p>
              {d.meta?.kind === 'files' && (
                <label className="flex items-start gap-2 text-[11px]">
                  <input type="checkbox" checked={toDisk} onChange={(e) => setToDisk(e.target.checked)} className="mt-0.5" />
                  {/* Separate from the rollback because it is the irreversible half: resetting
                      history can be undone from the safety snapshot, overwriting the live tree
                      cannot. */}
                  <span>{t('snap.rollback.disk', 'Also write these files over the live application directory. This changes what the server is running and cannot be undone by another rollback.')}</span>
                </label>
              )}
              <div className="flex items-center gap-2">
                <Input className="!w-40" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="CONFIRM" />
                <Button size="sm" variant="danger" disabled={busy || confirm !== 'CONFIRM'} onClick={restore}>
                  {busy ? <Spinner /> : t('snap.rollback.ok', 'Roll back')}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

// Snapshots: the backups an admin can actually take, hold and throw away.
//
// Kept visually apart from the history above because they answer a different question.
// The history answers "put that file back"; a snapshot answers "the server is gone".
function SnapshotsPanel({ onChanged }) {
  const { t } = useI18n(); const toast = useToast(); const dialog = useDialog();
  const { data, loading, reload } = useAsync(() => api.get('/server/backups/snapshots'), []);
  const [busy, setBusy] = useState('');
  const [keep, setKeep] = useState('');
  const [inspecting, setInspecting] = useState(null);

  const snaps = data?.snapshots || [];

  // Import reads the file in the browser and posts it base64. The bundles this produces are
  // megabytes; the endpoint verifies before storing, so a wrong file is refused with git's
  // own words rather than landing in the list as something that cannot be restored.
  const importFile = async (file, kind) => {
    if (!file) return;
    setBusy('import');
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      let bin = '';
      for (let i = 0; i < buf.length; i += 8192) bin += String.fromCharCode(...buf.subarray(i, i + 8192));
      const r = await api.post('/server/backups/snapshots/import', { kind, note: file.name.slice(0, 120), data: btoa(bin) });
      toast.success(t('snap.imported', 'Imported — it verified, and is in the list.'));
      reload(); onChanged?.();
      setInspecting(r.snapshot.id);
    } catch (x) {
      toast.error(x?.data?.error === 'invalid_bundle' ? t('snap.badimport', 'That file is not a backup git will open: {d}').replace('{d}', String(x.data.detail || '').split('\n')[0].slice(0, 120))
        : x?.data?.error === 'too_large' ? t('bkp.toobig', 'Too large to export in one file — compact the backups first.')
        : t('common.failed', 'Failed.'));
    } finally { setBusy(''); }
  };
  const keepNow = data?.keep ?? 10;

  const take = async (kind) => {
    setBusy('new');
    try {
      const r = await api.post('/server/backups/snapshots', { kind });
      // The rotation is reported, never silent. A backup routine that quietly deletes is
      // the reason people distrust backup routines.
      toast.success(r.rotated?.length
        ? t('snap.made.rot', 'Backup taken — {n} older one(s) rotated out.').replace('{n}', String(r.rotated.length))
        : t('snap.made', 'Backup taken.'));
      reload(); onChanged?.();
    } catch (x) {
      toast.error(x?.data?.error === 'no_backups' ? t('bkp.nobackups', 'Nothing has been backed up yet.') : t('common.failed', 'Failed.'));
    } finally { setBusy(''); }
  };

  const saveKeep = async () => {
    const n = keep.trim() === '' ? keepNow : Math.max(0, Math.round(Number(keep)));
    if (!Number.isFinite(n)) return;
    if (n > 0 && n < snaps.filter((x) => x.kind === 'files').length) {
      // Naming the number that will be deleted, because "Save" on a settings row is not a
      // place anyone expects to lose backups.
      if (!await dialog.confirm({
        title: t('snap.keep.t', 'Delete older backups now?'),
        message: t('snap.keep.m', 'Keeping {n} means the older ones are removed immediately, not at the next backup.').replace('{n}', String(n)),
        okLabel: t('snap.keep.ok', 'Keep {n} and rotate').replace('{n}', String(n)),
        danger: true,
      })) return;
    }
    setBusy('keep');
    try {
      const r = await api.put('/server/backups/limit', { maxBytes: data?.maxBytes ?? null, keep: n });
      toast.success(r.removed?.length ? t('snap.rotated', '{n} removed.').replace('{n}', String(r.removed.length)) : t('common.saved', 'Saved.'));
      setKeep(''); reload(); onChanged?.();
    } catch { toast.error(t('common.failed', 'Failed.')); } finally { setBusy(''); }
  };

  // Same reason as the history export: the signature travels in a response header, so a
  // plain <a download> would save the file and bin the thing that makes it checkable.
  const download = async (snap) => {
    setBusy(snap.id);
    try {
      const res = await fetch(`/api/server/backups/snapshots/${snap.id}/download`, { credentials: 'include' });
      if (!res.ok) throw new Error('dl');
      const sig = res.headers.get('X-Backup-Signature') || '';
      const blob = await res.blob();
      const name = `bcweb-${snap.id}.bundle`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = name; a.click();
      URL.revokeObjectURL(url);
      if (sig) {
        const su = URL.createObjectURL(new Blob([sig], { type: 'text/plain' }));
        const b = document.createElement('a'); b.href = su; b.download = `${name}.sig.b64`; b.click();
        URL.revokeObjectURL(su);
      }
      toast.success(t('bkp.exported', 'Downloaded {n} — the signature was saved next to it.').replace('{n}', name));
    } catch { toast.error(t('common.failed', 'Failed.')); } finally { setBusy(''); }
  };

  const remove = async (snap) => {
    if (!await dialog.confirm({
      title: t('snap.del.t', 'Delete this backup?'),
      message: t('snap.del.m', 'It is removed from the disk for good. Anything already downloaded is unaffected.'),
      okLabel: t('common.delete', 'Delete'), danger: true,
    })) return;
    setBusy(snap.id);
    try { await api.del(`/server/backups/snapshots/${snap.id}`, { confirmToken: 'CONFIRM' }); toast.success(t('common.deleted', 'Deleted.')); reload(); onChanged?.(); }
    catch { toast.error(t('common.failed', 'Failed.')); } finally { setBusy(''); }
  };

  return (
    <div className="mt-4 pt-3 border-t border-[var(--line)]">
      <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-1.5 flex items-center gap-1.5">
        <Archive size={12} /> {t('snap.title', 'Point-in-time backups')}
      </div>
      <p className="text-[11px] text-[var(--muted)] mb-2">
        {t('snap.sub', 'One frozen, signed file per backup — taken here, or automatically once a day. Unlike the history above these never change after they are made, which is what makes one worth copying off the box.')}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="primary" disabled={!!busy} onClick={() => take('both')}>
          {busy === 'new' ? <Spinner /> : <Archive size={13} />} {t('snap.now', 'Back up now')}
        </Button>
        <Button size="sm" disabled={!!busy} onClick={() => take('files')}>{t('snap.files', 'Files only')}</Button>
        <Button size="sm" disabled={!!busy} onClick={() => take('db')}>{t('snap.db', 'DB rows only')}</Button>
        <label className="inline-flex">
          <input type="file" accept=".bundle" className="hidden" onChange={(e) => { importFile(e.target.files?.[0], 'files'); e.target.value = ''; }} />
          <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] text-sm border border-[var(--line)] cursor-pointer hover:bg-[var(--surface-2)] ${busy ? 'opacity-50 pointer-events-none' : ''}`}>
            {busy === 'import' ? <Spinner /> : <UploadIcon size={13} />} {t('snap.import', 'Import a backup')}
          </span>
        </label>
        <div className="flex items-center gap-1.5 ml-auto">
          <span className="text-[11px] text-[var(--muted)]">{t('snap.keeplabel', 'Keep')}</span>
          <Input className="w-20" type="number" min="0" value={keep} onChange={(e) => setKeep(e.target.value)} placeholder={String(keepNow)} />
          <Button size="sm" disabled={!!busy} onClick={saveKeep}>{busy === 'keep' ? <Spinner /> : t('common.save', 'Save')}</Button>
        </div>
      </div>
      <p className="text-[11px] text-[var(--faint)] mt-1.5">
        {keepNow > 0
          ? t('snap.keep.on', 'Keeping the {n} most recent of each kind — older ones are overwritten as new ones are taken.').replace('{n}', String(keepNow))
          : t('snap.keep.off', 'Rotation is off: backups are kept until you delete them, and nothing watches the disk for you.')}
      </p>

      <div className="mt-3 rounded-lg border border-[var(--line)] divide-y divide-[var(--line)] max-h-72 overflow-y-auto">
        {loading ? <div className="p-3"><Spinner /></div>
          : !snaps.length ? <div className="px-3 py-3 text-[11px] text-[var(--faint)]">{t('snap.none', 'No backup taken yet.')}</div>
          : snaps.map((snap) => (
            <div key={snap.id} className="px-3 py-2 flex items-center gap-2">
              <span className="text-[10px] px-1.5 py-0.5 rounded shrink-0 bg-[var(--surface-2)]">
                {snap.kind === 'db' ? t('bkp.dbhist', 'DB row history') : t('bkp.filehist', 'File history')}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-xs truncate">{new Date(snap.createdAt).toLocaleString()} · {fmtBytes(snap.bytes || 0)}</div>
                <div className="text-[10px] text-[var(--faint)] truncate">
                  {snap.note || (snap.by === 'sweeper' ? t('snap.auto', 'automatic daily') : t('snap.manual', 'taken by hand'))}
                  {' · '}<code className="font-mono">{String(snap.sha256 || '').slice(0, 12)}</code>
                  {!snap.signature && <span className="text-warning"> · {t('snap.unsigned', 'unsigned')}</span>}
                </div>
              </div>
              <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => setInspecting(snap.id)} title={t('snap.inspect', 'Inspect this backup')}><Eye size={13} /></Button>
              <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => download(snap)} title={t('common.download', 'Download')}><Download size={13} /></Button>
              <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => remove(snap)} title={t('common.delete', 'Delete')}><Trash2 size={13} className="text-[var(--error)]" /></Button>
            </div>
          ))}
      </div>

      {inspecting && <SnapshotInspector id={inspecting} onClose={() => setInspecting(null)} onRestored={() => { reload(); onChanged?.(); }} />}
    </div>
  );
}

// Backups here are git-based history for edits made through the File manager
// and DB viewer above (see gitbackup.mjs) — NOT a full disaster-recovery
// backup of the whole app. Size shown here is also mirrored in the admin
// Storage tab's ledger.
function BackupManager() {
  const toast = useToast(); const { t } = useI18n();
  const { data, loading, reload } = useAsync(() => api.get('/server/backups/usage'), []);
  const [limitGB, setLimitGB] = useState('');
  const [busy, setBusy] = useState(false);
  const [gcBusy, setGcBusy] = useState(false);
  // The field is cleared inside the deferred work, not before it: on Undo the value the user
  // typed is still sitting there, which is what "nothing happened" should look like.
  const undoSave = useUndoableSave(reload);
  const saveLimit = () => {
    setBusy(true);
    undoSave(async () => {
      await api.put('/server/backups/limit', { maxBytes: limitGB.trim() ? Math.round(Number(limitGB) * 1024 ** 3) : null });
      setLimitGB('');
    }, t('common.saved', 'Saved.'), { onSettled: () => setBusy(false) });
  };
  const runGc = async () => {
    setGcBusy(true);
    try { await api.post('/server/backups/gc'); toast.success(t('bkp.compacted', 'Compacted.')); reload(); } catch { toast.error(t('common.failed', 'Failed.')); } finally { setGcBusy(false); }
  };

  // Downloaded through fetch rather than a plain <a download>, because the signature
  // travels in a RESPONSE HEADER — a link would save the file and throw the one thing
  // that makes it verifiable straight in the bin.
  const [exporting, setExporting] = useState('');
  const exportRepo = async (which) => {
    setExporting(which);
    try {
      const res = await fetch(`/api/server/backups/export?repo=${which}`, { credentials: 'include' });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw Object.assign(new Error('export'), { data: j });
      }
      const sig = res.headers.get('X-Backup-Signature') || '';
      const blob = await res.blob();
      const name = (res.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/)?.[1] || `${which}.bundle`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = name; a.click();
      URL.revokeObjectURL(url);
      // The signature is saved beside the bundle automatically. Asking the admin to copy
      // a base64 blob out of a toast is how a signature ends up unchecked forever.
      if (sig) {
        const sigUrl = URL.createObjectURL(new Blob([sig], { type: 'text/plain' }));
        const b = document.createElement('a'); b.href = sigUrl; b.download = `${name}.sig.b64`; b.click();
        URL.revokeObjectURL(sigUrl);
      }
      toast.success(t('bkp.exported', 'Downloaded {n} — the signature was saved next to it.').replace('{n}', name));
    } catch (x) {
      toast.error(x?.data?.error === 'no_backups' ? t('bkp.nobackups', 'Nothing has been backed up yet.')
        : x?.data?.error === 'too_large' ? t('bkp.toobig', 'Too large to export in one file — compact the backups first.')
        : t('common.failed', 'Failed.'));
    } finally { setExporting(''); }
  };

  const [contents, setContents] = useState(null);   // { files: [...], db: [...] }
  const [pubkey, setPubkey] = useState(null);
  const openContents = async () => {
    try { setContents(await api.get('/server/backups/list')); }
    catch { toast.error(t('common.failed', 'Failed.')); }
  };
  if (loading) return <Loading />;
  const d = data || {};
  const pct = d.maxBytes ? Math.min(100, (d.totalBytes / d.maxBytes) * 100) : 0;
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-2 text-sm"><History size={14} className="text-[var(--primary-2)]" /><span className="font-semibold">{t('bkp.title', 'Backup storage')}</span></div>
      <p className="text-xs text-[var(--muted)] mb-3">{t('bkp.sub', "Every file edit/delete and DB row edit is git-committed first, so it can always be rolled back — plus a full daily snapshot of the file tree. This is separate from the app's own storage (see the Storage tab).")}</p>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div><div className="text-xs text-[var(--faint)] mb-0.5">{t('bkp.filehist', 'File history')}</div><div className="text-lg font-bold tabular-nums">{fmtBytes(d.filesBytes || 0)}</div></div>
        <div><div className="text-xs text-[var(--faint)] mb-0.5">{t('bkp.dbhist', 'DB row history')}</div><div className="text-lg font-bold tabular-nums">{fmtBytes(d.dbBytes || 0)}</div></div>
      </div>
      {d.maxBytes != null && (
        <div className="mb-3">
          <div className="h-1.5 rounded-full bg-[var(--surface-2)] overflow-hidden"><div className={`h-full ${pct >= 90 ? 'bg-error' : 'bg-gradient-to-r from-brand to-brand-2'}`} style={{ width: `${pct}%` }} /></div>
          <div className="text-[11px] text-[var(--faint)] mt-1">{fmtBytes(d.totalBytes)} / {fmtBytes(d.maxBytes)} ({Math.round(pct)}%)</div>
        </div>
      )}
      <div className="grid sm:grid-cols-[1fr_auto_auto] gap-2">
        <Input type="number" value={limitGB} onChange={(e) => setLimitGB(e.target.value)} placeholder={d.maxBytes ? t('bkp.currently', 'Currently {n} GB — blank = unlimited').replace('{n}', (d.maxBytes / 1024 ** 3).toFixed(1)) : t('bkp.limitph', 'Size limit in GB (blank = unlimited)')} />
        <Button variant="primary" disabled={busy} onClick={saveLimit}>{busy ? <Spinner /> : t('bkp.savelimit', 'Save limit')}</Button>
        <Button disabled={gcBusy} onClick={runGc} title={t('bkp.compacttip', 'Runs git gc on the backup repos to reclaim space from old/loose objects. Non-destructive: NO history is deleted — every version can still be restored.')}>{gcBusy ? <Spinner /> : t('bkp.compact', 'Compact backups')}</Button>
      </div>
      <p className="text-[11px] text-[var(--faint)] mt-2" dangerouslySetInnerHTML={{ __html: t('bkp.note', '<b>Compact backups</b> reclaims disk space by garbage-collecting the backup git repos (loose/duplicate objects). It never deletes history — every past version stays restorable.') }} />

      {/* Getting the backups OFF the box. A backup that only exists on the machine it
          protects is not a backup of that machine. */}
      <div className="mt-4 pt-3 border-t border-[var(--line)]">
        <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-1.5 flex items-center gap-1.5">
          <Download size={12} /> {t('bkp.export', 'Take a copy off the server')}
        </div>
        <p className="text-[11px] text-[var(--muted)] mb-2">
          {t('bkp.export.s', 'Each download is a git bundle containing the full history — open it anywhere with “git clone”, no part of this site required. It is signed, and the signature is saved beside it.')}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={!!exporting} onClick={() => exportRepo('files')}>
            {exporting === 'files' ? <Spinner /> : <Download size={13} />} {t('bkp.export.files', 'File history')}
          </Button>
          <Button size="sm" disabled={!!exporting} onClick={() => exportRepo('db')}>
            {exporting === 'db' ? <Spinner /> : <Download size={13} />} {t('bkp.export.db', 'DB row history')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => (contents ? setContents(null) : openContents())}>
            <Eye size={13} /> {contents ? t('common.close', 'Close') : t('bkp.contents', "What's in them")}
          </Button>
          <Button size="sm" variant="ghost" onClick={async () => {
            if (pubkey) return setPubkey(null);
            try { setPubkey(await api.get('/server/backups/pubkey')); } catch { toast.error(t('common.failed', 'Failed.')); }
          }}>
            <KeyRound size={13} /> {pubkey ? t('common.close', 'Close') : t('bkp.verify', 'How to verify')}
          </Button>
        </div>

        {pubkey && (
          <div className="mt-3 rounded-lg border border-[var(--line)] bg-[var(--surface-2)]/40 p-3">
            <p className="text-[11px] text-[var(--muted)] mb-2">
              {t('bkp.verify.s', 'Signed with Ed25519. The key below is public on purpose — checking a backup must not require asking the server that produced it, which is precisely the thing you would be doubting.')}
            </p>
            <div className="flex items-center gap-2 mb-2">
              <code className="flex-1 min-w-0 truncate text-[10px] font-mono px-2 py-1.5 rounded bg-[var(--bg-solid)]">{pubkey.publicKey.split('\n')[1]}…</code>
              <Button size="sm" variant="ghost" onClick={() => { copyText(pubkey.publicKey); toast.success(t('common.copied', 'Copied.')); }}><Copy size={13} /></Button>
            </div>
            <pre className="text-[10px] font-mono whitespace-pre-wrap text-[var(--faint)]">{(pubkey.verify || []).join('\n')}</pre>
          </div>
        )}

        {contents && (
          <div className="mt-3 rounded-lg border border-[var(--line)] max-h-64 overflow-y-auto">
            {['files', 'db'].map((k) => (
              <div key={k}>
                <div className="px-3 py-1.5 text-[11px] uppercase tracking-wider text-[var(--faint)] bg-[var(--surface-2)]/60 sticky top-0">
                  {k === 'files' ? t('bkp.filehist', 'File history') : t('bkp.dbhist', 'DB row history')} · {(contents[k] || []).length}
                </div>
                {!(contents[k] || []).length
                  ? <div className="px-3 py-2 text-[11px] text-[var(--faint)]">{t('bkp.empty', 'Nothing recorded yet.')}</div>
                  : contents[k].map((c) => (
                    <div key={c.hash} className="px-3 py-1.5 border-t border-[var(--line)] flex items-baseline gap-2">
                      <code className="text-[10px] font-mono text-[var(--faint)] shrink-0">{c.hash.slice(0, 8)}</code>
                      <span className="text-xs truncate flex-1">{c.message}</span>
                      <span className="text-[10px] text-[var(--faint)] shrink-0">{new Date(c.at).toLocaleString()}</span>
                    </div>
                  ))}
              </div>
            ))}
          </div>
        )}
      </div>

      <SnapshotsPanel onChanged={reload} />
    </Card>
  );
}

// Unified "Access & permissions": ONE user search that surfaces EVERY permission
// for the picked user in a single card — role + server-control (SUPERADMIN only)
// and blog-post grants (ADMIN+) — plus the site-wide access policy and a full grants
// overview. Replaces the old split "Roles & access" / "Blog access" tabs, so an
// admin no longer hunts across screens to see what a user can do.
// Granular admin capabilities a non-admin user can be granted (mirrors CAPABILITIES in
// the API's lib/lib.mjs). Each unlocks exactly one dashboard section + its endpoints.
// Mirrors CAPABILITIES in the API's lib/lib.mjs — every slug here MUST be enforced
// server-side. `cat` groups them in the role editor. Each unlocks exactly one dashboard
// area + its endpoints.
const ADMIN_CAPS = [
  { id: 'manage_users', cat: 'people', icon: Users, label: 'Manage users', labelFr: 'Gérer les utilisateurs', desc: 'View users, moderate, suspend/ban.', descFr: 'Voir les utilisateurs, modérer, suspendre/bannir.' },
  { id: 'manage_reports', cat: 'people', icon: MessageSquare, label: 'Handle reports', labelFr: 'Gérer les signalements', desc: 'View and reply to user reports & support threads.', descFr: 'Voir et répondre aux signalements et fils de support.' },
  { id: 'manage_projects', cat: 'content', icon: Settings2, label: 'Manage projects', labelFr: 'Gérer les projets', desc: 'Edit every fixed project page + its visibility & schedule.', descFr: 'Modifier chaque page de projet fixe + sa visibilité et sa planification.' },
  { id: 'manage_showcase', cat: 'content', icon: Sparkles, label: 'Manage other projects', labelFr: 'Gérer les autres projets', desc: 'Create, edit, pin and publish every other-project page.', descFr: 'Créer, modifier, épingler et publier chaque page « autre projet ».' },
  { id: 'manage_announcements', cat: 'content', icon: BellIcon, label: 'Manage announcements', labelFr: 'Gérer les annonces', desc: 'Post and edit the site announcement banners.', descFr: 'Publier et modifier les bannières d’annonce du site.' },
  { id: 'manage_faq', cat: 'content', icon: HelpCircle, label: 'Manage FAQ', labelFr: 'Gérer la FAQ', desc: 'Create and edit FAQ entries.', descFr: 'Créer et modifier les entrées de la FAQ.' },
  { id: 'manage_catalogs', cat: 'content', icon: Boxes, label: 'Manage catalogs', labelFr: 'Gérer les catalogues', desc: 'Moderate community catalogs (suspend / unlist).', descFr: 'Modérer les catalogues communautaires (suspendre / délister).' },
  { id: 'manage_newsletter', cat: 'growth', icon: Mail, label: 'Manage newsletter', labelFr: 'Gérer la newsletter', desc: 'Compose and send newsletters.', descFr: 'Rédiger et envoyer des newsletters.' },
  { id: 'manage_promotions', cat: 'growth', icon: Megaphone, label: 'Manage promotions', labelFr: 'Gérer les promotions', desc: 'Promo campaigns, discount & hosting codes.', descFr: 'Campagnes promo, codes de réduction et d’hébergement.' },
  { id: 'manage_events', cat: 'growth', icon: Sparkles, label: 'Manage events', labelFr: 'Gérer les événements', desc: 'Site events (fireworks, themed presentations).', descFr: 'Événements du site (feux d’artifice, présentations thématiques).' },
  { id: 'manage_myo', cat: 'growth', icon: Wand2, label: 'Manage commissions', labelFr: 'Gérer les commandes', desc: 'Handle "Make Your Own" requests, quotes, delivery + the catalog.', descFr: 'Gérer les demandes « Make Your Own », devis, livraisons + le catalogue.' },
  { id: 'manage_api', cat: 'growth', icon: KeyRound, label: 'Manage the public API', labelFr: 'Gérer l’API publique', desc: 'See API usage per key, the sampled call log, and revoke keys.', descFr: 'Voir l’usage de l’API par clé, l’échantillon d’appels, et révoquer des clés.' },
  { id: 'manage_polls', cat: 'content', icon: BarChart3, label: 'Manage polls', labelFr: 'Gérer les sondages', desc: 'Create polls, read the results and who answered.', descFr: 'Créer des sondages, lire les résultats et qui a répondu.' },
  { id: 'manage_analytics', cat: 'insight', icon: TrendingUp, label: 'View analytics', labelFr: 'Voir les analyses', desc: 'Analytics, errors and goals.', descFr: 'Analyses, erreurs et objectifs.' },
  { id: 'manage_repos', cat: 'ops', icon: Server, label: 'Manage server repos', labelFr: 'Gérer les dépôts serveur', desc: 'Review, verify and moderate hosted repos.', descFr: 'Vérifier, valider et modérer les dépôts hébergés.' },
];
// Category display order + labels for the role editor's grouping.
const CAP_CATEGORIES = [
  { id: 'people', label: 'People', labelFr: 'Personnes' },
  { id: 'content', label: 'Content', labelFr: 'Contenu' },
  { id: 'growth', label: 'Growth', labelFr: 'Croissance' },
  { id: 'insight', label: 'Insight', labelFr: 'Analyse' },
  { id: 'ops', label: 'Operations', labelFr: 'Opérations' },
];

function AdminAccess({ isSuperAdmin }) {
  const toast = useToast();
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState(null);
  const [roleSel, setRoleSel] = useState('USER');
  const [scopeSel, setScopeSel] = useState('global');
  const [permsSel, setPermsSel] = useState([]);
  const [rolesSel, setRolesSel] = useState([]);
  const [pscopeSel, setPscopeSel] = useState('all');
  const scopes = useAsync(() => api.get('/blog/my-scopes'), []);
  const grants = useAsync(() => api.get('/admin/blog-permissions'), []);
  // Custom roles are SUPERADMIN-managed; other admins never load the list.
  const roles = useAsync(() => isSuperAdmin ? api.get('/admin/custom-roles') : Promise.resolve({ roles: [] }), [isSuperAdmin]);
  const projGrants = useAsync(() => api.get('/admin/project-permissions'), []);
  const customRoles = roles.data?.roles || [];

  const search = async () => {
    if (!q.trim()) return setResults(null);
    setBusy(true);
    try { const { users } = await api.get(`/admin/users?q=${encodeURIComponent(q)}&take=10`); setResults(users); } catch { setResults([]); } finally { setBusy(false); }
  };
  const pick = (u) => { setPicked(u); setRoleSel(u.role); setScopeSel('global'); setPermsSel(u.permissions || []); setRolesSel(u.customRoleIds || []); setPscopeSel('all'); };
  const togglePerm = (cap) => setPermsSel((s) => s.includes(cap) ? s.filter((c) => c !== cap) : [...s, cap]);
  // DELIBERATELY NOT behind the undo window. The undo window is a convenience for edits you
  // might regret, not a safety mechanism — and for this action a six-second "maybe" is worse
  // than a plain yes: you want to know, at the moment you click, that it has taken effect.
  const savePerms = async () => {
    setBusy(true);
    try {
      await api.put(`/admin/users/${picked.id}/permissions`, { permissions: permsSel });
      setPicked((prev) => ({ ...prev, permissions: permsSel }));
      setResults((rs) => rs ? rs.map((u) => u.id === picked.id ? { ...u, permissions: permsSel } : u) : rs);
      toast.success(t('acc.perms.saved', 'Permissions updated for {name}.').replace('{name}', picked.displayName));
    } catch (x) {
      toast.error(x.data?.error === 'cannot_change_own_permissions' ? t('acc.perms.own', "You can't change your own permissions.") : x.data?.error || t('acc.failed', 'Failed.'));
    } finally { setBusy(false); }
  };
  // DELIBERATELY NOT behind the undo window. The undo window is a convenience for edits you
  // might regret, not a safety mechanism — and for this action a six-second "maybe" is worse
  // than a plain yes: you want to know, at the moment you click, that it has taken effect.
  const saveRole = async () => {
    setBusy(true);
    try { await api.put(`/admin/users/${picked.id}/role`, { role: roleSel }); toast.success(t('acc.rolenow', '{name} is now {role}.').replace('{name}', picked.displayName).replace('{role}', roleSel)); setPicked((p) => ({ ...p, role: roleSel })); }
    catch (x) { toast.error(x.data?.error === 'cannot_change_own_role' ? t('acc.ownrole', "You can't change your own role.") : x.data?.error || t('acc.failed', 'Failed.')); }
    finally { setBusy(false); }
  };
  const toggleServerControl = async () => {
    setBusy(true);
    try { await api.put(`/admin/server-control/${picked.id}`, { granted: !picked.canControlServer }); toast.success((!picked.canControlServer ? t('acc.sc.on', 'Server-control granted to {name}.') : t('acc.sc.off', 'Server-control revoked from {name}.')).replace('{name}', picked.displayName)); setPicked((p) => ({ ...p, canControlServer: !p.canControlServer })); }
    catch { toast.error(t('acc.failed', 'Failed.')); } finally { setBusy(false); }
  };
  const toggleTelemetry = async () => {
    setBusy(true);
    try { await api.put(`/admin/telemetry-access/${picked.id}`, { granted: !picked.canViewTelemetry }); toast.success((!picked.canViewTelemetry ? t('acc.tel.on', 'Telemetry access granted to {name}.') : t('acc.tel.off', 'Telemetry access revoked from {name}.')).replace('{name}', picked.displayName)); setPicked((p) => ({ ...p, canViewTelemetry: !p.canViewTelemetry })); }
    catch { toast.error(t('acc.failed', 'Failed.')); } finally { setBusy(false); }
  };
  const grantBlog = async () => {
    setBusy(true);
    try {
      const [kind, val] = scopeSel.split(':');
      await api.post('/admin/blog-permissions', { userId: picked.id, projectKey: kind === 'project' ? val : null, showcaseSlug: kind === 'showcase' ? val : null });
      toast.success(t('acc.blog.granted', 'Granted blog access to {name}.').replace('{name}', picked.displayName)); grants.reload();
    } catch (x) { toast.error(x.data?.error || t('acc.failed', 'Failed.')); } finally { setBusy(false); }
  };
  const undoBlog = useUndoableDelete(() => grants.reload());
  const undoProj = useUndoableDelete(() => projGrants.reload());
  const revoke = (g) => undoBlog.del(g.id, () => api.del(`/admin/blog-permissions/${g.id}`), t('acc.revoked', 'Revoked.'));
  const toggleRole = (id) => setRolesSel((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);
  // DELIBERATELY NOT behind the undo window. The undo window is a convenience for edits you
  // might regret, not a safety mechanism — and for this action a six-second "maybe" is worse
  // than a plain yes: you want to know, at the moment you click, that it has taken effect.
  const saveRoles = async () => {
    setBusy(true);
    try {
      await api.put(`/admin/users/${picked.id}/custom-roles`, { customRoleIds: rolesSel });
      setPicked((prev) => ({ ...prev, customRoleIds: rolesSel }));
      setResults((rs) => rs ? rs.map((u) => u.id === picked.id ? { ...u, customRoleIds: rolesSel } : u) : rs);
      toast.success(t('acc.roles.saved', 'Roles updated for {name}.').replace('{name}', picked.displayName));
    } catch (x) { toast.error(x.data?.error === 'cannot_change_own_roles' ? t('acc.roles.own', "You can't change your own roles.") : x.data?.error || t('acc.failed', 'Failed.')); }
    finally { setBusy(false); }
  };
  const grantProject = async () => {
    setBusy(true);
    try {
      const body = { userId: picked.id };
      if (pscopeSel === 'all') body.allShowcase = true;
      else { const [kind, val] = pscopeSel.split(':'); if (kind === 'project') body.projectKey = val; else body.showcaseSlug = val; }
      await api.post('/admin/project-permissions', body);
      toast.success(t('acc.proj.granted', 'Granted project-edit access to {name}.').replace('{name}', picked.displayName)); projGrants.reload();
    } catch (x) { toast.error(x.data?.error || t('acc.failed', 'Failed.')); } finally { setBusy(false); }
  };
  const revokeProject = (g) => undoProj.del(g.id, () => api.del(`/admin/project-permissions/${g.id}`), t('acc.revoked', 'Revoked.'));
  const projScopeLabel = (g) => g.allShowcase ? t('acc.proj.all', 'All other-projects') : g.showcase ? t('acc.proj.custom', 'Other · {name}').replace('{name}', g.showcase.name) : g.projectKey ? t('acc.proj.project', 'Project · {key}').replace('{key}', g.projectKey.toUpperCase()) : '';
  const allProjGrants = (projGrants.data?.grants || []).filter((g) => !undoProj.pending.has(g.id));
  const userProjGrants = picked ? allProjGrants.filter((g) => g.user?.id === picked.id) : [];
  const scopeLabel = (g) => g.showcase ? t('acc.scope.custom', 'Custom · {name}').replace('{name}', g.showcase.name) : g.projectKey ? t('acc.scope.project', 'Project · {key}').replace('{key}', g.projectKey.toUpperCase()) : t('acc.scope.global', 'Global (all blogs)');
  const roleTone = (role) => role === 'SUPERADMIN' ? 'red' : role === 'ADMIN' ? 'amber' : role === 'MOD' ? 'primary' : '';
  const allGrants = (grants.data?.grants || []).filter((g) => !undoBlog.pending.has(g.id));
  const userGrants = picked ? allGrants.filter((g) => g.user?.id === picked.id) : [];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-semibold mb-1 flex items-center gap-2"><Shield size={16} className="text-[var(--primary-2)]" /> {t('acc.title', 'Access & permissions')}</h2>
        <p className="text-sm text-[var(--muted)] mb-3">{isSuperAdmin ? t('acc.desc.super', 'Find a user to manage their role, server-control access and blog-post access — all in one place. Search by user id, display name, email, a linked creator id, or a linked Discord.') : t('acc.desc.admin', 'Find a user to manage blog-post access — all in one place. Search by user id, display name, email, a linked creator id, or a linked Discord.')}</p>
        <div className="flex gap-2 mb-3">
          <div className="relative flex-1"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--faint)]" />
            <Input className="!pl-9" placeholder={t('au.search.ph', 'id / display name / email / creator id / Discord…')} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} /></div>
          <Button variant="primary" disabled={busy} onClick={search}>{busy ? <Spinner /> : <><Search size={15} /> {t('acc.search', 'Search')}</>}</Button>
        </div>
        {results && (results.length ? <div className="space-y-1.5">
          {results.map((u) => (
            <button key={u.id} onClick={() => pick(u)} className={`w-full text-left card p-3 flex items-center gap-3 ${picked?.id === u.id ? 'border-[var(--primary)]' : ''}`}>
              <Avatar user={u} size={32} />
              <div className="flex-1 min-w-0"><div className="font-medium flex items-center gap-2 flex-wrap min-w-0"><span className="truncate min-w-0">{u.displayName}</span> <Badge tone={roleTone(u.role)}>{u.role}</Badge>{u.canControlServer && <Badge tone="red"><Server size={9} /> {t('acc.server', 'server')}</Badge>}{u.canViewTelemetry && <Badge tone="primary"><TrendingUp size={9} /> {t('acc.telemetry', 'telemetry')}</Badge>}{u.permissions?.length > 0 && !['ADMIN', 'SUPERADMIN'].includes(u.role) && <Badge tone="amber"><Shield size={9} /> {t('acc.perms.count', '{n} perms').replace('{n}', u.permissions.length)}</Badge>}</div><div className="text-xs text-[var(--faint)] truncate">{u.email}</div></div>
            </button>
          ))}
        </div> : <div className="text-sm text-[var(--faint)]">{t('acc.nousers', 'No users found.')}</div>)}
      </div>

      {picked && (
        <Card className="p-5 space-y-5">
          <div className="flex items-center gap-3"><Avatar user={picked} size={40} /><div className="min-w-0"><div className="font-semibold flex items-center gap-2">{picked.displayName} <Badge tone={roleTone(picked.role)}>{picked.role}</Badge></div><div className="text-xs text-[var(--faint)] truncate">{picked.email}</div></div></div>

          {isSuperAdmin && (
            <div className="pt-4 border-t border-[var(--line)]">
              <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-1.5">{t('acc.role', 'Role')}</div>
              <div className="flex items-center gap-2">
                <Select className="!w-auto" value={roleSel} onChange={(e) => setRoleSel(e.target.value)}>
                  <option value="USER">USER</option><option value="MOD">MOD</option><option value="ADMIN">ADMIN</option><option value="SUPERADMIN">SUPERADMIN</option>
                </Select>
                <Button size="sm" variant="primary" disabled={busy || roleSel === picked.role} onClick={saveRole}>{busy ? <Spinner /> : t('acc.saverole', 'Save role')}</Button>
              </div>
            </div>
          )}

          <div className="pt-4 border-t border-[var(--line)]">
            <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-1.5 flex items-center gap-1.5"><Shield size={12} /> {t('acc.perms.title', 'Dashboard permissions')}</div>
            {['ADMIN', 'SUPERADMIN'].includes(picked.role) ? (
              <p className="text-xs text-[var(--muted)]">{t('acc.perms.isadmin', 'Admins already have every permission. Lower the role to USER or MOD to grant specific capabilities instead.')}</p>
            ) : (<>
              <p className="text-xs text-[var(--muted)] mb-2.5">{t('acc.perms.desc', 'Grant this user access to specific admin sections — each unlocks exactly that area of the dashboard and nothing else. Actions are still checked on the server.')} {!picked.totpEnabled && <span className="text-warning">{t('acc.perms.no2fa', 'They must enable 2FA before the dashboard will open.')}</span>}</p>
              <div className="space-y-1.5 mb-3">
                {ADMIN_CAPS.map((c) => {
                  const on = permsSel.includes(c.id);
                  const Icon = c.icon;
                  return (
                    <button key={c.id} onClick={() => togglePerm(c.id)} className={`w-full text-left flex items-center gap-3 p-2.5 rounded-xl border transition ${on ? 'border-[var(--primary)] bg-[var(--primary)]/5' : 'border-[var(--line)] hover:border-[var(--line-strong)]'}`}>
                      <span className={`w-8 h-8 rounded-lg grid place-items-center shrink-0 ${on ? 'bg-[var(--primary)]/15 text-[var(--primary-2)]' : 'bg-[var(--surface-2)] text-[var(--faint)]'}`}><Icon size={15} /></span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-medium">{t('acc.perm.' + c.id, c.label)}</span>
                        <span className="block text-xs text-[var(--faint)]">{t('acc.permd.' + c.id, c.desc)}</span>
                      </span>
                      <span className={`w-9 h-5 rounded-full relative shrink-0 transition ${on ? 'bg-[var(--primary)]' : 'bg-[var(--surface-3,var(--line))]'}`}><span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} /></span>
                    </button>
                  );
                })}
              </div>
              <Button size="sm" variant="primary" disabled={busy || JSON.stringify([...permsSel].sort()) === JSON.stringify([...(picked.permissions || [])].sort())} onClick={savePerms}>{busy ? <Spinner /> : t('acc.perms.save', 'Save permissions')}</Button>
            </>)}
          </div>

          {isSuperAdmin && !['ADMIN', 'SUPERADMIN'].includes(picked.role) && customRoles.length > 0 && (
            <div className="pt-4 border-t border-[var(--line)]">
              <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-1.5 flex items-center gap-1.5"><ShieldCheck size={12} /> {t('acc.roles.title', 'Custom roles')}</div>
              <p className="text-xs text-[var(--muted)] mb-2.5">{t('acc.roles.desc', 'Assign one or more roles — each hands this user its whole bundle of capabilities, layered on top of any individual permissions above.')}</p>
              <div className="flex flex-wrap gap-1.5 mb-3">
                {customRoles.map((r) => {
                  const on = rolesSel.includes(r.id);
                  return (
                    <button key={r.id} onClick={() => toggleRole(r.id)} className={`inline-flex items-center gap-1.5 text-sm pl-2.5 pr-3 py-1.5 rounded-full border transition ${on ? 'border-[var(--primary)] bg-[var(--primary)]/10' : 'border-[var(--line)] hover:border-[var(--line-strong)]'}`}>
                      <RoleBadge color={r.color}>{r.name}</RoleBadge>
                      <span className="text-xs text-[var(--faint)]">{t('acc.roles.ncaps', '{n} caps').replace('{n}', (r.capabilities || []).length)}</span>
                      {on && <Check size={13} className="text-[var(--primary-2)]" />}
                    </button>
                  );
                })}
              </div>
              <Button size="sm" variant="primary" disabled={busy || JSON.stringify([...rolesSel].sort()) === JSON.stringify([...(picked.customRoleIds || [])].sort())} onClick={saveRoles}>{busy ? <Spinner /> : t('acc.roles.save', 'Save roles')}</Button>
            </div>
          )}

          <div className="pt-4 border-t border-[var(--line)]">
            <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-1.5 flex items-center gap-1.5"><Settings2 size={12} /> {t('acc.proj.title', 'Project-edit access')}</div>
            {['ADMIN', 'SUPERADMIN'].includes(picked.role) ? (
              <p className="text-xs text-[var(--muted)]">{t('acc.proj.isadmin', 'Admins can already edit every project.')}</p>
            ) : (<>
              <p className="text-xs text-[var(--muted)] mb-2.5">{t('acc.proj.desc', "Let this user edit a project's page content from the dashboard — one project, several, or all other-projects. They still can't pin, publish or change a project's visibility (that needs the “Manage other projects” capability).")}</p>
              {userProjGrants.length > 0 && <div className="flex flex-wrap gap-1.5 mb-2">
                {userProjGrants.map((g) => <span key={g.id} className="inline-flex items-center gap-1.5 text-xs pl-2.5 pr-1 py-1 rounded-full border border-[var(--line)] bg-[var(--surface-2)]"><Settings2 size={11} className="text-[var(--primary-2)]" /> {projScopeLabel(g)} <button onClick={() => revokeProject(g)} className="opacity-60 hover:opacity-100 hover:text-error" title={t('acc.revoke.title', 'Revoke')}><X size={11} /></button></span>)}
              </div>}
              <div className="flex flex-wrap items-center gap-2">
                <Select className="!w-auto" value={pscopeSel} onChange={(e) => setPscopeSel(e.target.value)}>
                  <option value="all">{t('acc.proj.allopt', 'All other-projects')}</option>
                  {(scopes.data?.showcases || []).map((s) => <option key={s.slug} value={`showcase:${s.slug}`}>{t('acc.proj.customopt', 'Other · {name}').replace('{name}', s.name)}</option>)}
                  {(scopes.data?.projects || []).map((pr) => <option key={pr.key} value={`project:${pr.key}`}>{t('acc.proj.projectopt', 'Project · {name}').replace('{name}', pr.name)}</option>)}
                </Select>
                <Button size="sm" variant="primary" disabled={busy} onClick={grantProject}>{busy ? <Spinner /> : <><Plus size={14} /> {t('acc.grant', 'Grant')}</>}</Button>
              </div>
            </>)}
          </div>

          {isSuperAdmin && (picked.role === 'ADMIN' || picked.role === 'SUPERADMIN' || picked.canControlServer) && (
            <div className="pt-4 border-t border-[var(--line)]">
              <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-1.5">{t('acc.sc.title', 'Server-control tools')}</div>
              <p className="text-xs text-[var(--muted)] mb-2">{t('acc.sc.desc', "Grants access to the server dashboard's dangerous actions (DB viewer, restart) — still gated by that user's own 2FA step-up.")} {!picked.totpEnabled && <span className="text-warning">{t('acc.sc.no2fa', "This user hasn't enabled 2FA yet, so the tools stay locked either way.")}</span>}</p>
              <Button size="sm" variant={picked.canControlServer ? 'default' : 'primary'} disabled={busy} onClick={toggleServerControl}>{busy ? <Spinner /> : (picked.canControlServer ? t('acc.sc.revoke', 'Revoke server-control') : t('acc.sc.grant', 'Grant server-control'))}</Button>
            </div>
          )}

          {isSuperAdmin && ['MOD', 'ADMIN', 'SUPERADMIN'].includes(picked.role) && (
            <div className="pt-4 border-t border-[var(--line)]">
              <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-1.5 flex items-center gap-1.5"><TrendingUp size={12} /> {t('acc.tel.title', 'BMM telemetry')}</div>
              <p className="text-xs text-[var(--muted)] mb-2">{t('acc.tel.desc', 'Lets this admin open the BMM telemetry dashboard (gated at the edge by a BCWEB login — no separate telemetry key needed).')} {picked.role === 'SUPERADMIN' && <span className="text-[var(--faint)]">{t('acc.tel.super', 'SUPERADMIN always has access.')}</span>}</p>
              <Button size="sm" variant={picked.canViewTelemetry ? 'default' : 'primary'} disabled={busy || picked.role === 'SUPERADMIN'} onClick={toggleTelemetry}>{busy ? <Spinner /> : (picked.canViewTelemetry ? t('acc.tel.revoke', 'Revoke telemetry access') : t('acc.tel.grant', 'Grant telemetry access'))}</Button>
            </div>
          )}

          <div className="pt-4 border-t border-[var(--line)]">
            <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-1.5">{t('acc.blog.title', 'Blog-post access')}</div>
            {userGrants.length > 0 && <div className="flex flex-wrap gap-1.5 mb-2">
              {userGrants.map((g) => <span key={g.id} className="inline-flex items-center gap-1.5 text-xs pl-2.5 pr-1 py-1 rounded-full border border-[var(--line)] bg-[var(--surface-2)]"><PenSquare size={11} className="text-[var(--primary-2)]" /> {scopeLabel(g)} <button onClick={() => revoke(g)} className="opacity-60 hover:opacity-100 hover:text-error" title={t('acc.revoke.title', 'Revoke')}><X size={11} /></button></span>)}
            </div>}
            <div className="flex flex-wrap items-center gap-2">
              <Select className="!w-auto" value={scopeSel} onChange={(e) => setScopeSel(e.target.value)}>
                <option value="global">{t('acc.blog.globalopt', 'Global (all blogs)')}</option>
                {(scopes.data?.projects || []).map((pr) => <option key={pr.key} value={`project:${pr.key}`}>{t('acc.blog.projectopt', 'Project · {name}').replace('{name}', pr.name)}</option>)}
                {(scopes.data?.showcases || []).map((s) => <option key={s.slug} value={`showcase:${s.slug}`}>{t('acc.blog.customopt', 'Custom · {name}').replace('{name}', s.name)}</option>)}
              </Select>
              <Button size="sm" variant="primary" disabled={busy} onClick={grantBlog}>{busy ? <Spinner /> : <><Plus size={14} /> {t('acc.grant', 'Grant')}</>}</Button>
            </div>
          </div>
        </Card>
      )}

      {isSuperAdmin && <RoleManager roles={roles} />}

      <GlobalAccessPolicyCard />

      {allProjGrants.length > 0 && <div>
        <h2 className="font-semibold mb-1 flex items-center gap-2"><Settings2 size={16} className="text-[var(--primary-2)]" /> {t('acc.allproj.title', 'All project-edit grants')}</h2>
        <p className="text-sm text-[var(--muted)] mb-3">{t('acc.allproj.desc', 'Everyone who can edit a project’s content, and which. Pick a user above to edit theirs.')}</p>
        <div className="space-y-1.5">
          {allProjGrants.map((g) => (
            <Card key={g.id} className="p-3 flex items-center gap-3">
              <Avatar user={g.user} size={32} />
              <div className="flex-1 min-w-0"><div className="font-medium truncate">{g.user?.displayName || t('acc.deleted', '(deleted)')}</div><div className="text-xs text-[var(--faint)] truncate">{g.user?.email}</div></div>
              <Badge tone="primary">{projScopeLabel(g)}</Badge>
              <Button size="sm" variant="ghost" className="!text-error" onClick={() => revokeProject(g)}><Trash2 size={13} /></Button>
            </Card>
          ))}
        </div>
      </div>}

      <div>
        <h2 className="font-semibold mb-1 flex items-center gap-2"><PenSquare size={16} className="text-[var(--primary-2)]" /> {t('acc.all.title', 'All blog-post grants')}</h2>
        <p className="text-sm text-[var(--muted)] mb-3">{t('acc.all.desc', 'Everyone who can write blog posts, and where. Pick a user above to edit theirs.')}</p>
        {grants.loading ? <Loading /> : allGrants.length ? <div className="space-y-1.5">
          {allGrants.map((g) => (
            <Card key={g.id} className="p-3 flex items-center gap-3">
              <Avatar user={g.user} size={32} />
              <div className="flex-1 min-w-0"><div className="font-medium truncate">{g.user?.displayName || t('acc.deleted', '(deleted)')}</div><div className="text-xs text-[var(--faint)] truncate">{g.user?.email}</div></div>
              <Badge tone="primary">{scopeLabel(g)}</Badge>
              <Button size="sm" variant="ghost" className="!text-error" onClick={() => revoke(g)}><Trash2 size={13} /></Button>
            </Card>
          ))}
        </div> : <EmptyState icon={PenSquare} title={t('acc.all.none.t', 'No grants yet')} sub={t('acc.all.none.s', "Regular users can't write blog posts until you grant access above.")} />}
      </div>
    </div>
  );
}

// SUPERADMIN-only: create/edit/delete custom roles — named bundles of capabilities that
// can then be assigned to users in the card above. The capability catalog (ADMIN_CAPS) is
// the same one the per-user toggles use, grouped here by CAP_CATEGORIES.
// A few starting swatches for the role-badge colour picker; any hex is allowed.
const ROLE_SWATCHES = ['#3b82f6', '#8b5cf6', '#ec4899', '#ef4444', '#f59e0b', '#22c55e', '#14b8a6', '#64748b'];
const isHex = (c) => /^#[0-9a-fA-F]{6}$/.test(c || '');
// Role badge that honours a chosen hex colour (tinted fill + coloured text/border), while
// staying back-compatible with roles created before the picker (a named Badge tone).
export function RoleBadge({ color, children, className = '' }) {
  if (isHex(color)) return <span className={`badge ${className}`} style={{ backgroundColor: `${color}22`, color, border: `1px solid ${color}66` }}>{children}</span>;
  return <Badge tone={color || 'primary'} className={className}>{children}</Badge>;
}
function RoleManager({ roles }) {
  const toast = useToast(); const { t, lang } = useI18n();
  const undo = useUndoableDelete(() => roles.reload());
  const [editing, setEditing] = useState(null); // null | {} (new) | role (edit)
  const [name, setName] = useState('');
  const [color, setColor] = useState('#3b82f6');
  const [caps, setCaps] = useState([]);
  const [busy, setBusy] = useState(false);
  const list = (roles.data?.roles || []).filter((r) => !undo.pending.has(r.id));

  const open = (r) => { setEditing(r || {}); setName(r?.name || ''); setColor(r?.color || '#3b82f6'); setCaps(r?.capabilities || []); };
  const close = () => setEditing(null);
  const toggleCap = (id) => setCaps((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);
  const capLabel = (c) => lang === 'fr' ? c.labelFr : c.label;
  const undoSave = useUndoableSave(() => roles.reload());
  const save = () => {
    if (name.trim().length < 2) return toast.error(t('rm.nametooShort', 'Give the role a name (2+ characters).'));
    setBusy(true);
    const body = { name: name.trim(), color, capabilities: caps };
    // Snapshot the target before deferring — `editing` is the modal's own state and the user
    // can switch roles inside the undo window, which would send the PUT to the wrong one.
    const id = editing?.id;
    // The editor closes right away (the change reads as done); Undo reopens nothing because
    // the request never went out, and the role list is simply left as the server has it.
    close();
    undoSave(() => (id ? api.put(`/admin/custom-roles/${id}`, body) : api.post('/admin/custom-roles', body)),
      id ? t('rm.updated', 'Role updated.') : t('rm.created', 'Role created.'),
      { onSettled: () => setBusy(false),
        errorFor: (x) => x.data?.error === 'name_taken' ? t('rm.nametaken', 'A role with that name already exists.') : (x.data?.error || t('acc.failed', 'Failed.')) });
  };
  // Undoable — the delete only fires when the Undo window elapses; nothing is removed from
  // members until then. (No confirm dialog: the 6s Undo IS the safety net.)
  const del = (r) => undo.del(r.id, () => api.del(`/admin/custom-roles/${r.id}`), t('rm.deleted', 'Role deleted.'));

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h2 className="font-semibold flex items-center gap-2"><ShieldCheck size={16} className="text-[var(--primary-2)]" /> {t('rm.title', 'Custom roles')}</h2>
        <Button size="sm" variant="primary" onClick={() => open(null)}><Plus size={14} /> {t('rm.new', 'New role')}</Button>
      </div>
      <p className="text-sm text-[var(--muted)] mb-3">{t('rm.desc', 'Reusable bundles of capabilities. Assign them to users above — effective access is the role’s caps on top of any individual permissions.')}</p>
      {roles.loading ? <Loading /> : list.length ? <div className="space-y-1.5 mb-3">
        {list.map((r) => (
          <Card key={r.id} className="p-3 flex items-center gap-3">
            <RoleBadge color={r.color}>{r.name}</RoleBadge>
            <div className="flex-1 min-w-0 text-xs text-[var(--faint)] truncate">
              {(r.capabilities || []).length ? r.capabilities.map((id) => (ADMIN_CAPS.find((c) => c.id === id) ? capLabel(ADMIN_CAPS.find((c) => c.id === id)) : id)).join(' · ') : t('rm.nocaps', 'No capabilities yet')}
            </div>
            <span className="text-xs text-[var(--faint)] shrink-0">{t('rm.members', '{n} members').replace('{n}', r.memberCount || 0)}</span>
            <Button size="sm" variant="ghost" onClick={() => open(r)}><PenSquare size={13} /></Button>
            <Button size="sm" variant="ghost" className="!text-error" onClick={() => del(r)}><Trash2 size={13} /></Button>
          </Card>
        ))}
      </div> : <EmptyState icon={ShieldCheck} title={t('rm.none.t', 'No custom roles yet')} sub={t('rm.none.s', 'Create one to bundle capabilities and hand them out in a click.')} />}

      {editing && (
        <Modal open onClose={close} title={editing.id ? t('rm.edit', 'Edit role') : t('rm.create', 'Create role')}>
          <div className="space-y-4">
            <Field label={t('rm.name', 'Role name')}>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('rm.name.ph', 'e.g. Showcase moderator')} maxLength={40} />
            </Field>
            <Field label={t('rm.color', 'Badge color')}>
              <div className="flex items-center gap-2 flex-wrap">
                <label className="relative w-9 h-9 rounded-lg border border-[var(--line)] overflow-hidden cursor-pointer shrink-0" title={t('rm.colorpick', 'Pick a colour')} style={{ backgroundColor: isHex(color) ? color : '#3b82f6' }}>
                  <input type="color" value={isHex(color) ? color : '#3b82f6'} onChange={(e) => setColor(e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer" />
                </label>
                {ROLE_SWATCHES.map((c) => <button key={c} type="button" onClick={() => setColor(c)} className={`w-6 h-6 rounded-full border-2 transition ${color === c ? 'border-[var(--text)] scale-110' : 'border-transparent hover:scale-105'}`} style={{ backgroundColor: c }} title={c} />)}
                <span className="ml-1"><RoleBadge color={color}>{name.trim() || t('rm.preview', 'Preview')}</RoleBadge></span>
              </div>
            </Field>
            <div>
              <div className="text-sm font-medium mb-2">{t('rm.caps', 'Capabilities')} <span className="text-xs text-[var(--faint)]">({caps.length})</span></div>
              <div className="space-y-3">
                {CAP_CATEGORIES.map((cat) => {
                  const inCat = ADMIN_CAPS.filter((c) => c.cat === cat.id);
                  if (!inCat.length) return null;
                  return (
                    <div key={cat.id}>
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--faint)] mb-1.5">{lang === 'fr' ? cat.labelFr : cat.label}</div>
                      <div className="space-y-1.5">
                        {inCat.map((c) => {
                          const on = caps.includes(c.id); const Icon = c.icon;
                          return (
                            <button key={c.id} type="button" onClick={() => toggleCap(c.id)} className={`w-full text-left flex items-center gap-3 p-2.5 rounded-xl border transition ${on ? 'border-[var(--primary)] bg-[var(--primary)]/5' : 'border-[var(--line)] hover:border-[var(--line-strong)]'}`}>
                              <span className={`w-8 h-8 rounded-lg grid place-items-center shrink-0 ${on ? 'bg-[var(--primary)]/15 text-[var(--primary-2)]' : 'bg-[var(--surface-2)] text-[var(--faint)]'}`}><Icon size={15} /></span>
                              <span className="flex-1 min-w-0">
                                <span className="block text-sm font-medium">{t('acc.perm.' + c.id, capLabel(c))}</span>
                                <span className="block text-xs text-[var(--faint)]">{t('acc.permd.' + c.id, lang === 'fr' ? c.descFr : c.desc)}</span>
                              </span>
                              <span className={`w-9 h-5 rounded-full relative shrink-0 transition ${on ? 'bg-[var(--primary)]' : 'bg-[var(--surface-3,var(--line))]'}`}><span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} /></span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={close}>{t('common.cancel', 'Cancel')}</Button>
              <Button variant="primary" disabled={busy} onClick={save}>{busy ? <Spinner /> : (editing.id ? t('rm.save', 'Save role') : t('rm.createbtn', 'Create role'))}</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

const ANN_TONE = { info: 'primary', warning: 'amber', success: 'green' };
// Icon + accent per announcement tone — shared shape used by the admin list, the
// site banner (App.jsx has its own copy) and the notification bell.
export const ANN_TONE_ICON = { info: Info, warning: AlertTriangle, success: CheckCircle2 };
const ANN_BODY_MAX = 500; // banner bodies stay short/scannable; hard-capped server-side too
// Admin: site-wide banner announcements (auto-notifies every user on publish) plus
// a standalone "notify everyone" action for a one-off ping with no persistent banner.
// Admin-curated landing testimonials: add/edit/delete, per-review + whole-section
// toggles, and both EN + FR text (the landing shows the visitor's language).
function AdminReviews() {
  const toast = useToast(); const dialog = useDialog(); const { t } = useI18n();
  const { data, loading, reload } = useAsync(() => api.get('/admin/reviews'), []);
  const [f, setF] = useState({ author: '', role: '', body: '', bodyFr: '', rating: '', enabled: true, avatar: null });
  const [editId, setEditId] = useState(null);
  const [busy, setBusy] = useState(false);
  const utog = useUndoableToggle(reload);
  const reviews = (data?.reviews || []).map(utog.apply);
  const sectionOn = data?.enabled !== false;
  const reset = () => { setF({ author: '', role: '', body: '', bodyFr: '', rating: '', enabled: true, avatar: null }); setEditId(null); };
  const toggleSection = async () => { try { await api.put('/admin/reviews/settings', { enabled: !sectionOn }); reload(); } catch { toast.error(t('common.failed', 'Failed.')); } };
  const pickAvatar = () => { const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*'; i.onchange = async () => { const file = i.files?.[0]; if (!file) return; try { toast.info(t('arv.pfp.uploading', 'Uploading…')); const url = await uploadImage(file); setF((s) => ({ ...s, avatar: { ...(s.avatar || {}), image: url } })); } catch { toast.error(t('arv.pfp.uploadfail', 'Upload failed.')); } }; i.click(); };
  const undoSave = useUndoableSave(reload);
  const save = () => {
    if (!f.author.trim() || !f.body.trim()) return toast.error(t('arv.req', 'Author and English text are required.'));
    setBusy(true);
    const payload = { author: f.author.trim(), role: f.role.trim(), body: f.body.trim(), bodyFr: f.bodyFr.trim(), rating: f.rating ? Number(f.rating) : null, enabled: f.enabled, avatar: f.avatar || null };
    // editId is captured here rather than read inside the deferred work: the user can start
    // editing another review during the undo window, and the request must still target the
    // one they pressed Save on. reset() moves inside too, so Undo leaves the form as it was.
    const id = editId;
    undoSave(async () => {
      if (id) await api.patch(`/admin/reviews/${id}`, payload); else await api.post('/admin/reviews', payload);
      reset();
    }, id ? t('arv.updated', 'Review updated.') : t('arv.added', 'Review added.'),
       { onSettled: () => setBusy(false) });
  };
  const edit = (rv) => { setEditId(rv.id); setF({ author: rv.author, role: rv.role || '', body: rv.body, bodyFr: rv.bodyFr || '', rating: rv.rating ? String(rv.rating) : '', enabled: rv.enabled, avatar: rv.avatar || null }); };
  const toggleEnabled = (rv) => utog.act(rv.id, { enabled: !rv.enabled }, () => api.patch(`/admin/reviews/${rv.id}`, { enabled: !rv.enabled }), !rv.enabled ? t('arv.shown2', 'Review shown.') : t('arv.hidden2', 'Review hidden.'));
  const del = async (rv) => { if (!(await dialog.confirm({ title: t('arv.del', 'Delete review?'), message: rv.author, okLabel: t('common.delete', 'Delete'), danger: true }))) return; try { await api.del(`/admin/reviews/${rv.id}`); reload(); } catch { toast.error(t('common.failed', 'Failed.')); } };
  return (
    <div>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h2 className="font-semibold flex items-center gap-2"><MessageSquare size={16} className="text-[var(--primary-2)]" /> {t('arv.title', 'Landing reviews')}</h2>
        <button onClick={toggleSection} className={`btn ${sectionOn ? 'btn-primary' : ''}`}>{sectionOn ? <><Eye size={14} /> {t('arv.on', 'Section shown')}</> : <><EyeOff size={14} /> {t('arv.off', 'Section hidden')}</>}</button>
      </div>
      <p className="text-sm text-[var(--muted)] mb-4">{t('arv.desc', 'Curated testimonials shown on the landing page. Each has an English and a French text (the site shows the one matching the visitor’s language). Turn the whole section — or individual reviews — on/off.')}</p>

      <Card className="p-5 mb-5">
        <div className="text-sm font-semibold mb-3">{editId ? t('arv.editing', 'Edit review') : t('arv.new', 'Add a review')}</div>
        <div className="flex items-start gap-4 mb-3">
          {/* Reviewer profile picture — upload an image, or leave blank for a generated one. */}
          <div className="shrink-0">
            <div className="text-[11px] text-[var(--faint)] mb-1">{t('arv.pfp', 'Photo')}</div>
            <Avatar variant={f.avatar?.variant || 'beam'} seed={f.avatar?.seed || f.author || 'review'} image={f.avatar?.image} colors={f.avatar?.colors} size={56} />
            <div className="flex flex-col gap-1 mt-1.5">
              <button type="button" onClick={pickAvatar} className="text-[11px] text-[var(--primary-2)] hover:underline flex items-center gap-1"><Upload size={11} /> {t('arv.pfp.upload', 'Upload')}</button>
              {f.avatar?.image && <button type="button" onClick={() => setF((s) => ({ ...s, avatar: null }))} className="text-[11px] text-[var(--faint)] hover:text-error">{t('arv.pfp.clear', 'Remove photo')}</button>}
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-3 flex-1 min-w-0">
            <Field label={t('arv.author', 'Author')}><Input value={f.author} onChange={(e) => setF({ ...f, author: e.target.value })} placeholder="Jane D." /></Field>
            <Field label={t('arv.role', 'Role / subtitle')}><Input value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} placeholder="BMM power user" /></Field>
          </div>
        </div>
        <div className="grid sm:grid-cols-2 gap-3 mt-3">
          <Field label={t('arv.bodyen', 'Text (English)')}><Textarea rows={3} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></Field>
          <Field label={t('arv.bodyfr', 'Text (French)')}><Textarea rows={3} value={f.bodyFr} onChange={(e) => setF({ ...f, bodyFr: e.target.value })} placeholder={t('arv.frph', 'Optional — falls back to English.')} /></Field>
        </div>
        <div className="flex items-end gap-3 mt-3 flex-wrap">
          <Field label={t('arv.rating', 'Rating (1-5, optional)')}><Input type="number" min="1" max="5" className="!w-28" value={f.rating} onChange={(e) => setF({ ...f, rating: e.target.value })} /></Field>
          <label className="flex items-center gap-2 text-sm pb-2.5"><input type="checkbox" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} /> {t('arv.enabled', 'Enabled')}</label>
          <div className="flex-1" />
          {editId && <Button variant="ghost" onClick={reset}>{t('common.cancel', 'Cancel')}</Button>}
          <Button variant="primary" disabled={busy} onClick={save}>{busy ? <Spinner /> : (editId ? t('arv.savebtn', 'Save changes') : <><Plus size={15} /> {t('arv.addbtn', 'Add review')}</>)}</Button>
        </div>
      </Card>

      {loading ? <Loading /> : reviews.length ? <div className="space-y-2">
        {reviews.map((rv) => (
          <Card key={rv.id} className="p-4 flex items-start gap-3">
            <Avatar variant={rv.avatar?.variant || 'beam'} seed={rv.avatar?.seed || rv.author} image={rv.avatar?.image} colors={rv.avatar?.colors} size={36} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap"><span className="font-medium">{rv.author}</span>{rv.role && <span className="text-xs text-[var(--faint)]">{rv.role}</span>}{rv.rating > 0 && <span className="text-xs text-warning flex items-center gap-0.5"><Star size={11} fill="currentColor" /> {rv.rating}</span>}{!rv.enabled && <Badge>{t('arv.hiddenb', 'hidden')}</Badge>}{rv.bodyFr && <Badge tone="primary">FR</Badge>}</div>
              <p className="text-sm text-[var(--muted)] mt-1 line-clamp-2">{rv.body}</p>
            </div>
            <button onClick={() => toggleEnabled(rv)} title={rv.enabled ? t('arv.hide', 'Hide') : t('arv.show', 'Show')} className="text-[var(--faint)] hover:text-[var(--primary-2)] p-1">{rv.enabled ? <Eye size={16} /> : <EyeOff size={16} />}</button>
            <button onClick={() => edit(rv)} title={t('common.edit', 'Edit')} className="text-[var(--faint)] hover:text-[var(--primary-2)] p-1"><PenSquare size={16} /></button>
            <button onClick={() => del(rv)} title={t('common.delete', 'Delete')} className="text-[var(--faint)] hover:text-error p-1"><Trash2 size={16} /></button>
          </Card>
        ))}
      </div> : <EmptyState icon={MessageSquare} title={t('arv.none', 'No reviews yet')} sub={t('arv.none.s', 'Add your first testimonial above.')} />}
    </div>
  );
}

function AdminAnnouncements() {
  const toast = useToast(); const dialog = useDialog(); const { t } = useI18n();
  const { data, loading, reload } = useAsync(() => api.get('/admin/announcements'), []);
  const [f, setF] = useState({ title: '', body: '', tone: 'info', showBanner: true, linkUrl: '' });
  const [busy, setBusy] = useState(false);
  const [broadcastMsg, setBroadcastMsg] = useState('');
  const [broadcastBusy, setBroadcastBusy] = useState(false);
  const undo = useUndoableDelete(reload);
  const utog = useUndoableToggle(reload);
  const announcements = (data?.announcements || []).filter((a) => !undo.pending.has(a.id)).map(utog.apply);

  const create = async () => {
    if (f.title.length < 2) return toast.error(t('ann.title.req', 'Title is required.'));
    setBusy(true);
    try { const r = await api.post('/admin/announcements', { ...f, linkUrl: f.linkUrl.trim() || null }); toast.success(t('ann.published', 'Published — notified {n} user(s).').replace('{n}', r.notified)); setF({ title: '', body: '', tone: 'info', showBanner: true, linkUrl: '' }); reload(); }
    catch (x) { toast.error(x.data?.error || t('ann.failed', 'Failed.')); } finally { setBusy(false); }
  };
  const toggleActive = (a) => utog.act(a.id, { active: !a.active }, () => api.put(`/admin/announcements/${a.id}`, { active: !a.active }), !a.active ? t('ann.activated', 'Announcement activated.') : t('ann.deactivated', 'Announcement deactivated.'));
  const toggleBanner = (a) => utog.act(a.id, { showBanner: !a.showBanner }, () => api.put(`/admin/announcements/${a.id}`, { showBanner: !a.showBanner }), !a.showBanner ? t('ann.bannerturnon', 'Site-wide banner on.') : t('ann.bannerturnoff', 'Site-wide banner off.'));
  const del = (a) => undo.del(a.id, () => api.del(`/admin/announcements/${a.id}`), t('ann.deleted2', 'Announcement deleted.'));
  const notifyAll = async () => {
    if (broadcastMsg.length < 2) return toast.error(t('ann.msg.req', 'Message is required.'));
    if (!(await dialog.confirm({ title: t('ann.notify.confirm.t', 'Notify every user'), message: t('ann.notify.confirm.m', 'This pushes a notification to every registered user immediately. Continue?'), okLabel: t('ann.notify.confirm.ok', 'Send') }))) return;
    setBroadcastBusy(true);
    try { const r = await api.post('/admin/notify-all', { body: broadcastMsg }); toast.success(t('ann.sent', 'Sent to {n} user(s).').replace('{n}', r.notified)); setBroadcastMsg(''); }
    catch (x) { toast.error(x.data?.error || t('ann.failed', 'Failed.')); } finally { setBroadcastBusy(false); }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-semibold mb-1 flex items-center gap-2"><BellIcon size={16} className="text-[var(--primary-2)]" /> {t('ann.new', 'New announcement')}</h2>
        <p className="text-sm text-[var(--muted)] mb-3">{t('ann.new.sub', 'Shows as a dismissible banner on every page and immediately notifies every user.')}</p>
        <Card className="p-4 space-y-3">
          <div className="grid sm:grid-cols-[1fr_auto] gap-3">
            <Field label={t('ann.title', 'Title')}><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder={t('ann.title.ph', 'Scheduled maintenance tonight')} /></Field>
            <Field label={t('ann.tone', 'Tone')}><Select value={f.tone} onChange={(e) => setF({ ...f, tone: e.target.value })}><option value="info">{t('ann.tone.info', 'Info')}</option><option value="warning">{t('ann.tone.warning', 'Warning')}</option><option value="success">{t('ann.tone.success', 'Success')}</option></Select></Field>
          </div>
          <Field label={<span className="flex items-center justify-between w-full">{t('ann.body', 'Body (optional)')} <span className={`text-[10px] tabular-nums ${f.body.length > ANN_BODY_MAX ? 'text-error' : 'text-[var(--faint)]'}`}>{f.body.length}/{ANN_BODY_MAX}</span></span>}>
            <Textarea value={f.body} maxLength={ANN_BODY_MAX} onChange={(e) => setF({ ...f, body: e.target.value.slice(0, ANN_BODY_MAX) })} placeholder={t('ann.body.ph', 'More detail shown after the title…')} />
          </Field>
          <Field label={t('ann.link', 'Link (optional)')}><Input value={f.linkUrl} onChange={(e) => setF({ ...f, linkUrl: e.target.value })} placeholder={t('ann.link.ph', '/blog/my-post or https://example.com')} /></Field>
          <label className="flex items-center gap-2 text-sm text-[var(--muted)]"><input type="checkbox" checked={f.showBanner} onChange={(e) => setF({ ...f, showBanner: e.target.checked })} /> {t('ann.showbanner', 'Also show as a dismissible site-wide banner (always notifies everyone either way)')}</label>
          <div className="flex justify-end"><Button variant="primary" disabled={busy} onClick={create}>{busy ? <Spinner /> : <><Bell size={15} /> {t('ann.publish', 'Publish & notify everyone')}</>}</Button></div>
        </Card>
      </div>

      <div>
        <h2 className="font-semibold mb-1 flex items-center gap-2"><Send size={16} className="text-[var(--primary-2)]" /> {t('ann.notify.h', 'Notify everyone (no banner)')}</h2>
        <p className="text-sm text-[var(--muted)] mb-3">{t('ann.notify.sub', "A one-off notification pushed to every user's bell menu, with no site-wide banner.")}</p>
        <Card className="p-4 flex flex-col sm:flex-row gap-2">
          <Input className="flex-1" value={broadcastMsg} onChange={(e) => setBroadcastMsg(e.target.value)} placeholder={t('ann.notify.ph', 'A quick message to every user…')} />
          <Button variant="primary" disabled={broadcastBusy} onClick={notifyAll}>{broadcastBusy ? <Spinner /> : <><Send size={15} /> {t('ann.notify.send', 'Send to everyone')}</>}</Button>
        </Card>
      </div>

      <div>
        <h2 className="font-semibold mb-1 flex items-center gap-2"><Bell size={16} className="text-[var(--primary-2)]" /> {t('ann.list', 'Announcements')}</h2>
        {loading ? <Loading /> : announcements.length ? <div className="space-y-2">
          {announcements.map((a) => {
            const TIcon = ANN_TONE_ICON[a.tone] || Info;
            return (
            <Card key={a.id} className="p-4 flex items-center gap-3">
              <Badge tone={ANN_TONE[a.tone] || 'primary'}><TIcon size={11} /> {a.tone}</Badge>
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{a.title}</div>
                {a.body && <div className="text-xs text-[var(--muted)] truncate">{a.body}</div>}
                {a.linkUrl && <div className="text-xs text-[var(--primary-2)] truncate flex items-center gap-1"><Link2 size={11} /> {a.linkUrl}</div>}
              </div>
              <Badge tone={a.active ? 'green' : ''}>{a.active ? t('ann.active', 'active') : t('ann.inactive', 'inactive')}</Badge>
              <Button size="sm" variant="ghost" onClick={() => toggleBanner(a)} title={t('ann.bannertitle', 'Toggle the site-wide banner for this announcement')}>{a.showBanner ? <Monitor size={13} /> : <MonitorOff size={13} />} {a.showBanner ? t('ann.banneron', 'Banner on') : t('ann.banneroff', 'No banner')}</Button>
              <Button size="sm" variant="ghost" onClick={() => toggleActive(a)}>{a.active ? t('ann.deactivate', 'Deactivate') : t('ann.activate', 'Activate')}</Button>
              <Button size="sm" variant="ghost" className="!text-error" onClick={() => del(a)}><Trash2 size={13} /></Button>
            </Card>
            );
          })}
        </div> : <EmptyState icon={BellIcon} title={t('ann.none', 'No announcements yet')} />}
      </div>
    </div>
  );
}

// Admin: compose & send a custom email to newsletter subscribers — to everyone active
// or to a hand-picked subset. Backed by POST /admin/newsletter/broadcast; every message
// carries the BetterCommunity brand header and a one-click unsubscribe footer + header.
function AdminNewsletter() {
  const toast = useToast(); const dialog = useDialog(); const { t } = useI18n();
  const { data, loading, reload } = useAsync(() => api.get('/admin/newsletter'), []);
  const [f, setF] = useState({ subject: '', title: '', body: '', url: '' });
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState('all');            // 'all' | 'en' | 'fr' segment | 'pick' a subset
  const [picked, setPicked] = useState(() => new Set());
  const [q, setQ] = useState('');

  const undo = useUndoableDelete(reload);
  const counts = data?.counts || { active: 0, pending: 0, unsubscribed: 0, activeEn: 0, activeFr: 0 };
  const subscribers = (data?.subscribers || []).filter((s) => !undo.pending.has(s.id));
  const activeSubs = subscribers.filter((s) => s.status === 'active');
  const shown = activeSubs.filter((s) => !q.trim() || s.email.toLowerCase().includes(q.trim().toLowerCase()));

  const toggle = (email) => setPicked((prev) => { const n = new Set(prev); n.has(email) ? n.delete(email) : n.add(email); return n; });
  const allShownPicked = shown.length > 0 && shown.every((s) => picked.has(s.email));
  const toggleAllShown = () => setPicked((prev) => {
    const n = new Set(prev);
    if (allShownPicked) shown.forEach((s) => n.delete(s.email)); else shown.forEach((s) => n.add(s.email));
    return n;
  });

  const recipientCount = mode === 'all' ? counts.active : mode === 'en' ? counts.activeEn : mode === 'fr' ? counts.activeFr : picked.size;

  const validComposed = () => {
    if (f.subject.trim().length < 2) { toast.error(t('nl.subj.req', 'A subject is required.')); return false; }
    if (f.title.trim().length < 2) { toast.error(t('nl.title.req', 'A title is required.')); return false; }
    if (f.body.trim().length < 2) { toast.error(t('nl.body.req', 'A message body is required.')); return false; }
    return true;
  };
  const payloadOf = () => { const pl = { subject: f.subject.trim(), title: f.title.trim(), body: f.body.trim() }; if (f.url.trim()) pl.url = f.url.trim(); return pl; };
  const [testing, setTesting] = useState(false);
  const [testTo, setTestTo] = useState('');
  const sendTest = async () => {
    if (!validComposed()) return;
    if (!testTo.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(testTo.trim())) return toast.error(t('nl.test.emailreq', 'Enter a valid email to send the test to.'));
    setTesting(true);
    try { const r = await api.post('/admin/newsletter/test', { ...payloadOf(), to: testTo.trim() }); toast.success(t('nl.test.sent', 'Test sent to {to}.').replace('{to}', r.to)); }
    catch (x) { toast.error(x.data?.error === 'email_disabled' ? t('nl.err.disabled', 'Email is not configured on this server (SMTP).') : x.data?.detail ? t('nl.test.errdetail', 'Send failed: {d}').replace('{d}', x.data.detail) : t('nl.test.err', 'Could not send the test.')); }
    finally { setTesting(false); }
  };
  // Add / remove subscribers manually (admin already has consent).
  const [addEmail, setAddEmail] = useState(''); const [addLocale, setAddLocale] = useState('en'); const [adding, setAdding] = useState(false);
  const addSub = async () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addEmail.trim())) return toast.error(t('nl.add.emailreq', 'Enter a valid email.'));
    setAdding(true);
    try { await api.post('/admin/newsletter/add', { email: addEmail.trim(), locale: addLocale }); toast.success(t('nl.add.done', 'Subscriber added.')); setAddEmail(''); reload(); }
    catch (x) { toast.error(x.data?.error || t('nl.add.err', 'Could not add.')); } finally { setAdding(false); }
  };
  const removeSub = (sub) => undo.del(sub.id, () => api.del(`/admin/newsletter/${sub.id}`), t('nl.rm.done', 'Removed.'));
  const send = async () => {
    if (!validComposed()) return;
    if (mode === 'pick' && picked.size === 0) return toast.error(t('nl.pick.req', 'Select at least one recipient.'));
    if (!(await dialog.confirm({
      title: t('nl.send.t', 'Send newsletter email'),
      message: t('nl.send.m', 'Send this email to {n} subscriber(s)? This cannot be undone.').replace('{n}', recipientCount),
      okLabel: t('nl.send.ok', 'Send'),
    }))) return;
    setBusy(true);
    try {
      const payload = payloadOf();
      if (mode === 'pick') payload.emails = [...picked];
      else if (mode === 'en' || mode === 'fr') payload.locale = mode;
      const r = await api.post('/admin/newsletter/broadcast', payload);
      toast.success(t('nl.sent', 'Sent to {n} of {total} subscriber(s).').replace('{n}', r.sent).replace('{total}', r.total));
      setF({ subject: '', title: '', body: '', url: '' }); setPicked(new Set());
    } catch (x) {
      toast.error(x.data?.error === 'email_disabled' ? t('nl.err.disabled', 'Email is not configured on this server (SMTP).') : (x.data?.error || t('nl.err', 'Failed to send.')));
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-semibold mb-1 flex items-center gap-2"><Mail size={16} className="text-[var(--primary-2)]" /> {t('nl.h', 'Newsletter')}</h2>
        <p className="text-sm text-[var(--muted)] mb-3">{t('nl.sub', 'Send a custom email to your subscribers — everyone, or a hand-picked list. Every message is branded and includes a one-click unsubscribe link.')}</p>
        <div className="flex flex-wrap gap-2 mb-4">
          <Badge tone="green"><CheckCircle2 size={11} /> {t('nl.c.active', '{n} active').replace('{n}', counts.active)}</Badge>
          <Badge tone="amber"><Clock size={11} /> {t('nl.c.pending', '{n} pending').replace('{n}', counts.pending)}</Badge>
          <Badge>{t('nl.c.unsub', '{n} unsubscribed').replace('{n}', counts.unsubscribed)}</Badge>
        </div>
      </div>

      <Card className="p-4 space-y-3">
        <Field label={t('nl.f.subject', 'Subject (email subject line)')}><Input value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} placeholder={t('nl.f.subject.ph', 'New on BetterCommunity: …')} maxLength={200} /></Field>
        <Field label={t('nl.f.title', 'Heading (shown inside the email)')}><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder={t('nl.f.title.ph', "What's new")} maxLength={200} /></Field>
        <Field label={<span className="flex items-center justify-between w-full">{t('nl.f.body', 'Message')} <span className={`text-[10px] tabular-nums ${f.body.length > 5000 ? 'text-error' : 'text-[var(--faint)]'}`}>{f.body.length}/5000</span></span>}>
          <Textarea rows={7} value={f.body} maxLength={5000} onChange={(e) => setF({ ...f, body: e.target.value.slice(0, 5000) })} placeholder={t('nl.f.body.ph', 'Write your update. Line breaks are preserved.')} />
        </Field>
        <Field label={t('nl.f.url', 'Call-to-action link (optional)')} hint={t('nl.f.url.h', 'Adds a “Read on the blog” button pointing here.')}><Input value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://bettercommunity.ch/blog/…" /></Field>

        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-2">{t('nl.rec', 'Recipients')}</div>
          <div className="flex flex-wrap gap-2">
            {[
              ['all', t('nl.rec.all', 'Everyone ({n})').replace('{n}', counts.active)],
              ['en', t('nl.rec.en', 'English ({n})').replace('{n}', counts.activeEn)],
              ['fr', t('nl.rec.fr', 'French ({n})').replace('{n}', counts.activeFr)],
              ['pick', t('nl.rec.pick', 'Pick subscribers ({n})').replace('{n}', picked.size)],
            ].map(([k, label]) => (
              <button key={k} type="button" onClick={() => setMode(k)} className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition ${mode === k ? 'border-[var(--primary)] bg-[var(--primary)]/12 text-[var(--text)]' : 'border-[var(--line)] text-[var(--muted)] hover:text-[var(--text)]'}`}>{label}</button>
            ))}
          </div>
          <p className="text-[11px] text-[var(--faint)] mt-2">{t('nl.rec.note', 'Language = the one each subscriber signed up in (footer/blog/registration use the site language at the time; defaults to English). “English” / “French” send to that whole segment — no need to hand-pick.')}</p>
        </div>

        {mode === 'pick' && (loading ? <Loading /> : <div className="rounded-xl border border-[var(--line)] overflow-hidden">
          <div className="flex items-center gap-2 p-2 border-b border-[var(--line)] bg-[var(--surface-2)]">
            <label className="flex items-center gap-2 text-sm text-[var(--muted)] cursor-pointer select-none"><input type="checkbox" checked={allShownPicked} onChange={toggleAllShown} /> {t('nl.pick.all', 'Select all shown')}</label>
            <div className="relative flex-1 min-w-[160px]"><Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--faint)]" /><Input className="!pl-8 !py-1.5 text-sm" placeholder={t('nl.pick.search', 'Filter by email…')} value={q} onChange={(e) => setQ(e.target.value)} /></div>
          </div>
          <div className="max-h-64 overflow-y-auto divide-y divide-[var(--line)]">
            {shown.length ? shown.map((s) => (
              <label key={s.id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-[var(--surface-2)]">
                <input type="checkbox" checked={picked.has(s.email)} onChange={() => toggle(s.email)} />
                <span className="flex-1 min-w-0 truncate">{s.email}</span>
                <Badge tone="">{s.locale?.toUpperCase() || 'EN'}</Badge>
              </label>
            )) : <div className="px-3 py-6 text-center text-sm text-[var(--faint)]">{t('nl.pick.none', 'No matching active subscribers.')}</div>}
          </div>
        </div>)}

        {/* Nobody to send to yet? Double opt-in means new sign-ups stay "pending" until
            they click the confirm email. The test send below works regardless. */}
        {counts.active === 0 && <div className="text-xs text-[var(--muted)] rounded-lg border border-[var(--line)] bg-[var(--surface-2)]/50 p-2.5">{t('nl.noactive', 'No confirmed subscribers yet — sign-ups stay “pending” until they click the confirm email. You can still send yourself a test below.')}</div>}

        <div className="flex flex-col gap-3 pt-1 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0 sm:max-w-xs w-full">
            <div className="text-[11px] text-[var(--faint)] mb-1">{t('nl.test.to', 'Test recipient')}</div>
            <div className="flex gap-2">
              <Input type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="you@example.com" className="!py-1.5 text-sm" />
              <Button variant="ghost" className="shrink-0" disabled={testing} onClick={sendTest}>{testing ? <Spinner /> : <><Mail size={15} /> {t('nl.test.btn2', 'Test')}</>}</Button>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:flex-col sm:items-end">
            <span className="text-xs text-[var(--faint)] sm:mb-1">{t('nl.willsend', 'Will send to {n} subscriber(s).').replace('{n}', recipientCount)}</span>
            <Button variant="primary" disabled={busy || recipientCount === 0} onClick={send}>{busy ? <Spinner /> : <><Send size={15} /> {t('nl.send.btn', 'Send email')}</>}</Button>
          </div>
        </div>
      </Card>

      {/* Manage subscribers — add an address directly (already-consented import) or remove one. */}
      <div>
        <h3 className="font-semibold mb-1 flex items-center gap-2 text-sm"><Users size={15} className="text-[var(--primary-2)]" /> {t('nl.subs', 'Subscribers')}</h3>
        <Card className="p-4 space-y-3">
          <div className="flex flex-wrap gap-2">
            <Input type="email" value={addEmail} onChange={(e) => setAddEmail(e.target.value)} placeholder={t('nl.add.ph', 'email to add…')} className="flex-1 min-w-[180px] !py-2 text-sm" onKeyDown={(e) => e.key === 'Enter' && addSub()} />
            <Dropdown value={addLocale} onChange={setAddLocale} options={[{ value: 'en', label: 'EN' }, { value: 'fr', label: 'FR' }]} />
            <Button variant="primary" disabled={adding} onClick={addSub}>{adding ? <Spinner /> : <><Plus size={15} /> {t('nl.add.btn', 'Add')}</>}</Button>
          </div>
          {loading ? <Loading /> : subscribers.length ? <div className="rounded-xl border border-[var(--line)] divide-y divide-[var(--line)] max-h-80 overflow-y-auto">
            {subscribers.map((s) => (
              <div key={s.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                <span className="flex-1 min-w-0 truncate">{s.email}</span>
                <Badge tone={s.status === 'active' ? 'green' : s.status === 'pending' ? 'amber' : ''}>{s.status}</Badge>
                <Badge tone="">{s.locale?.toUpperCase() || 'EN'}</Badge>
                <button onClick={() => removeSub(s)} title={t('nl.rm.ok', 'Remove')} className="shrink-0 p-1 rounded-md text-[var(--faint)] hover:text-error hover:bg-[var(--surface-2)] transition"><Trash2 size={14} /></button>
              </div>
            ))}
          </div> : <div className="text-sm text-[var(--faint)] text-center py-4">{t('nl.subs.none', 'No subscribers yet.')}</div>}
        </Card>
      </div>

      <div className="flex justify-end"><Button size="sm" variant="ghost" onClick={reload}><RefreshCw size={13} /> {t('nl.refresh', 'Refresh')}</Button></div>
    </div>
  );
}

// Admin: FAQ manager — CRUD of Q&A items grouped by category, answers authored with the
// BetterCommunity markdown editor (same block system as blog/docs). Public at /faq.
function AdminFaq() {
  const { t } = useI18n(); const toast = useToast();
  const { data, loading, reload } = useAsync(() => api.get('/admin/faq'), []);
  const undo = useUndoableDelete(reload);
  const items = (data?.items || []).filter((i) => !undo.pending.has(i.id));
  const [f, setF] = useState({ question: '', questionFr: '', answer: '', answerFr: '', category: 'General', categoryFr: '', published: true });
  const [editId, setEditId] = useState(null); const [busy, setBusy] = useState(false);
  const categories = [...new Set(items.map((i) => i.category))];
  const reset = () => { setF({ question: '', questionFr: '', answer: '', answerFr: '', category: 'General', categoryFr: '', published: true }); setEditId(null); };
  const undoSave = useUndoableSave(reload);
  const save = () => {
    if (f.question.trim().length < 2) return toast.error(t('faqa.qreq', 'The question is required.'));
    setBusy(true);
    // The French fields are sent even when empty, so CLEARING a translation actually clears
    // it — omitting them would leave the old value in place with no way to remove it.
    const payload = { question: f.question.trim(), questionFr: f.questionFr.trim() || null,
      answer: f.answer, answerFr: f.answerFr || null,
      category: f.category.trim() || 'General', categoryFr: f.categoryFr.trim() || null, published: f.published };
    // id captured now, not read inside the window: editing a different question during those
    // six seconds would otherwise retarget the PATCH. reset() moves in for the same reason.
    const id = editId;
    undoSave(async () => {
      if (id) await api.patch(`/admin/faq/${id}`, payload); else await api.post('/admin/faq', payload);
      reset();
    }, id ? t('faqa.saved', 'Saved.') : t('faqa.added', 'Added.'), { onSettled: () => setBusy(false) });
  };
  const edit = (it) => { setEditId(it.id); setF({ question: it.question, questionFr: it.questionFr || '', answer: it.answer || '', answerFr: it.answerFr || '', category: it.category || 'General', categoryFr: it.categoryFr || '', published: it.published !== false }); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const del = (it) => undo.del(it.id, () => api.del(`/admin/faq/${it.id}`), t('faqa.deleted', 'Question deleted.'));
  const toggle = async (it) => { try { await api.patch(`/admin/faq/${it.id}`, { published: !it.published }); reload(); } catch { toast.error(t('common.failed', 'Failed.')); } };
  return (
    <div>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h2 className="font-semibold flex items-center gap-2"><HelpCircle size={16} className="text-[var(--primary-2)]" /> {t('faqa.title', 'FAQ')}</h2>
        <Link to="/faq" className="btn btn-sm"><ArrowUpRight size={14} /> {t('faqa.view', 'View page')}</Link>
      </div>
      <p className="text-sm text-[var(--muted)] mb-4">{t('faqa.sub', 'Curated questions & answers shown at /faq. Answers support the full BetterCommunity markdown (headings, callouts, code, links…).')}</p>

      <Card className="p-4 mb-5 space-y-3">
        <div className="text-sm font-semibold">{editId ? t('faqa.editing', 'Edit question') : t('faqa.new', 'New question')}</div>
        {/* English is the base; every French field is optional and falls back to it. There was
            no French input at all before — not even for answerFr, which the schema had and the
            public page rendered, so a French answer could never actually be entered. */}
        <div className="grid sm:grid-cols-[1fr_200px] gap-3">
          <Field label={t('faqa.q', 'Question')}><Input value={f.question} onChange={(e) => setF({ ...f, question: e.target.value })} placeholder={t('faqa.qph', 'How do I…?')} /></Field>
          <Field label={t('faqa.cat', 'Category')}><Input value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} placeholder="General" list="faq-cats" /><datalist id="faq-cats">{categories.map((c) => <option key={c} value={c} />)}</datalist></Field>
        </div>
        <div className="grid sm:grid-cols-[1fr_200px] gap-3">
          <Field label={t('faqa.qfr', 'Question (FR)')} hint={t('faqa.frhint', 'Optional — falls back to the English when empty.')}><Input value={f.questionFr} onChange={(e) => setF({ ...f, questionFr: e.target.value })} placeholder={t('faqa.qfrph', 'Comment faire… ?')} /></Field>
          <Field label={t('faqa.catfr', 'Category (FR)')}><Input value={f.categoryFr} onChange={(e) => setF({ ...f, categoryFr: e.target.value })} placeholder="Général" /></Field>
        </div>
        <Field label={t('faqa.a', 'Answer (markdown)')}><MarkdownEditor value={f.answer} onChange={(v) => setF({ ...f, answer: v })} placeholder={t('faqa.aph', 'Write the answer — supports **markdown** and blocks.')} full /></Field>
        <Field label={t('faqa.afr', 'Answer FR (markdown)')} hint={t('faqa.frhint', 'Optional — falls back to the English when empty.')}><MarkdownEditor value={f.answerFr} onChange={(v) => setF({ ...f, answerFr: v })} placeholder={t('faqa.afrph', 'Écris la réponse en français…')} full /></Field>
        <label className="flex items-center gap-2 text-sm text-[var(--muted)]"><input type="checkbox" checked={f.published} onChange={(e) => setF({ ...f, published: e.target.checked })} /> {t('faqa.published', 'Published (visible on /faq)')}</label>
        <div className="flex justify-end gap-2">
          {editId && <Button variant="ghost" onClick={reset}>{t('common.cancel', 'Cancel')}</Button>}
          <Button variant="primary" disabled={busy} onClick={save}>{busy ? <Spinner /> : (editId ? t('faqa.savebtn', 'Save') : <><Plus size={15} /> {t('faqa.addbtn', 'Add question')}</>)}</Button>
        </div>
      </Card>

      {loading ? <Loading /> : items.length ? <div className="space-y-2">
        {items.map((it) => (
          <Card key={it.id} className="p-4 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate">{it.question}</div>
              <div className="text-xs text-[var(--faint)] flex items-center gap-2 mt-0.5"><Badge>{it.category}</Badge>{!it.published && <Badge tone="amber">{t('faq.draft', 'draft')}</Badge>}</div>
            </div>
            <button onClick={() => toggle(it)} title={it.published ? t('faqa.hide', 'Unpublish') : t('faqa.show', 'Publish')} className="p-1.5 text-[var(--faint)] hover:text-[var(--primary-2)]">{it.published ? <Eye size={16} /> : <EyeOff size={16} />}</button>
            <button onClick={() => edit(it)} className="p-1.5 text-[var(--faint)] hover:text-[var(--primary-2)]"><PenSquare size={16} /></button>
            <button onClick={() => del(it)} className="p-1.5 text-[var(--faint)] hover:text-error"><Trash2 size={16} /></button>
          </Card>
        ))}
      </div> : <EmptyState icon={HelpCircle} title={t('faqa.none', 'No questions yet')} sub={t('faqa.none.s', 'Add your first one above.')} />}
    </div>
  );
}

// Admin account-moderation control inside the user modal: suspend / ban (temporary or
// permanent, with a reason) or reactivate. Mirrors POST /admin/users/:id/moderate — the
// target is signed out within ~15s and emailed the reason.
const MOD_DURATIONS = [
  { key: '1h', label: '1 hour', hours: 1 },
  { key: '24h', label: '24 hours', hours: 24 },
  { key: '7d', label: '7 days', hours: 168 },
  { key: '30d', label: '30 days', hours: 720 },
  { key: 'perm', label: 'Permanent', hours: 0 },
];
const MOD_RANK = { USER: 0, MOD: 1, ADMIN: 2, SUPERADMIN: 3 };
function UserModerationCard({ user, onChange }) {
  const { t } = useI18n(); const toast = useToast(); const { user: me } = useAuth();
  const [form, setForm] = useState(null); // { action:'suspend'|'ban' } when composing
  const [dur, setDur] = useState('24h');
  const [reason, setReason] = useState('');
  // No `busy` state any more: the verdict is deferred behind the undo window, so there is
  // no in-flight request to spin on — `pending` is what the buttons gate on instead.
  // Moderation hierarchy (mirrors the API): you can act only on someone strictly below
  // your own rank, and only ADMIN+ may ban — a MOD can suspend users but never ban.
  const myRank = MOD_RANK[me?.role] ?? 0;
  const targetRank = MOD_RANK[user.role] ?? 0;
  const canModerate = myRank > targetRank;
  const canBan = me?.role === 'ADMIN' || me?.role === 'SUPERADMIN';
  // Banning/suspending emails the person and locks them out; reactivating lets them back in.
  // Each gets an undo window, and like everywhere else the call is DEFERRED rather than
  // reversed — undo means no mail was sent and no state ever changed. `pending` holds the
  // status we're about to apply so the card agrees with the toast during the window (it
  // would otherwise still read "active" while the toast says "banned").
  const [pending, setPending] = useState(null); // 'banned' | 'suspended' | 'active'
  const status = pending || user.status || 'active';
  const locked = status !== 'active';
  const moderate = (body, nextStatus, msg) => {
    setPending(nextStatus);
    setForm(null); setReason('');
    toast.action({
      tone: 'success', duration: 6000, cancelLabel: t('common.undo', 'Undo'), msg,
      onCommit: async () => {
        try { const r = await api.post(`/admin/users/${user.id}/moderate`, body); onChange?.(r); }
        catch (x) {
          toast.error(
            x.data?.error === 'cannot_moderate_higher' ? t('mod.higher', "You can only moderate accounts below your own level.")
            : x.data?.error === 'mod_cannot_ban' ? t('mod.nobanperm', 'Moderators can suspend but not ban.')
            : x.data?.error === 'cannot_moderate_self' ? t('mod.self', "You can't moderate your own account.")
            : t('common.failed', 'Failed.'));
        }
        finally { setPending(null); } // onChange refetches; the real status takes over
      },
      onCancel: () => setPending(null),
    });
  };
  const submit = () => {
    const d = MOD_DURATIONS.find((x) => x.key === dur);
    const body = { action: form.action, reason: reason.trim() || undefined };
    if (d && d.hours > 0) body.durationHours = d.hours;
    moderate(body, form.action === 'ban' ? 'banned' : 'suspended',
      form.action === 'ban' ? t('mod.banned', 'Account banned.') : t('mod.suspended', 'Account suspended.'));
  };
  const reactivate = () => moderate({ action: 'reactivate' }, 'active', t('mod.reactivated', 'Account reactivated.'));
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)]/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] flex items-center gap-1.5"><Ban size={12} /> {t('mod.title', 'Account moderation')}</div>
        <Badge tone={status === 'banned' ? 'red' : status === 'suspended' ? 'amber' : 'green'}>{status}</Badge>
      </div>
      {!canModerate ? (
        <div className="text-sm text-[var(--faint)] mt-2">{t('mod.higher', 'You can only moderate accounts below your own level.')}</div>
      ) : locked ? (
        <div className="mt-2">
          <div className="text-sm">{status === 'banned' ? t('mod.isbanned', 'This account is banned') : t('mod.issusp', 'This account is suspended')} {user.moderationUntil ? t('mod.until', 'until {d}').replace('{d}', new Date(user.moderationUntil).toLocaleString()) : t('mod.permlabel', '(permanent)')}.</div>
          {user.moderationReason && <div className="text-xs text-[var(--muted)] mt-1"><b>{t('lock.reason', 'Reason')}:</b> {user.moderationReason}</div>}
          <Button size="sm" variant="primary" className="mt-2" disabled={!!pending} onClick={reactivate}><CheckCircle2 size={14} /> {t('mod.reactivate', 'Reactivate account')}</Button>
        </div>
      ) : form ? (
        <div className="mt-2 space-y-2">
          <div className="text-sm font-medium">{form.action === 'ban' ? t('mod.banning', 'Ban this account') : t('mod.suspending', 'Suspend this account')}</div>
          <div>
            <div className="text-[11px] text-[var(--faint)] mb-1">{t('mod.duration', 'Duration')}</div>
            <div className="flex flex-wrap gap-1.5">
              {MOD_DURATIONS.map((d) => <button key={d.key} type="button" onClick={() => setDur(d.key)} className={`px-2.5 py-1 rounded-lg text-xs border transition ${dur === d.key ? 'border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--primary-2)]' : 'border-[var(--line)] text-[var(--muted)] hover:border-[var(--line-strong)]'}`}>{t(`mod.dur.${d.key}`, d.label)}</button>)}
            </div>
          </div>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('mod.reasonph', 'Reason — shown to the user and emailed to them…')} rows={2} />
          <div className="flex gap-2">
            <Button size="sm" variant="primary" className={form.action === 'ban' ? '!bg-error hover:!bg-error' : ''} disabled={!!pending} onClick={submit}>{form.action === 'ban' ? t('mod.confirmban', 'Ban account') : t('mod.confirmsusp', 'Suspend account')}</Button>
            <Button size="sm" variant="ghost" onClick={() => setForm(null)}>{t('su.cancel', 'Cancel')}</Button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2 mt-2">
          <Button size="sm" variant="ghost" onClick={() => { setForm({ action: 'suspend' }); setDur('24h'); }}><Clock size={14} /> {t('mod.suspend', 'Suspend')}</Button>
          {canBan && <Button size="sm" variant="ghost" className="!text-error" onClick={() => { setForm({ action: 'ban' }); setDur('perm'); }}><Ban size={14} /> {t('mod.ban', 'Ban')}</Button>}
          {!canBan && <span className="text-[11px] text-[var(--faint)] self-center">{t('mod.suspendonly', 'Mods can suspend, not ban.')}</span>}
        </div>
      )}
    </div>
  );
}

// Lost-authenticator recovery. 2FA is a personal factor a user normally disables only with
// their password + a live code; someone who loses BOTH the app and their recovery codes is
// locked out for good. Staff can clear it here so they sign in with their password and
// re-enrol. Same rank rules as moderation, deferred behind an undo window (so "undo" means
// nothing ever happened), and the API logs it + emails the user as a security event.
function UserTwoFactorCard({ user, onChange }) {
  const { t } = useI18n(); const toast = useToast(); const dialog = useDialog(); const { user: me } = useAuth();
  const myRank = MOD_RANK[me?.role] ?? 0;
  const targetRank = MOD_RANK[user.role] ?? 0;
  // ADMIN+ only (mirrors requireRole('ADMIN') on the API) — disabling 2FA is a security
  // downgrade a MOD shouldn't do. Still bounded by rank, so your own row is never actionable.
  const canReset = myRank >= MOD_RANK.ADMIN && myRank > targetRank;
  const [pending, setPending] = useState(false);
  const enabled = pending ? false : !!user.totpEnabled;
  const reset = async () => {
    // Ask first. Stripping someone else's second factor is a security DOWNGRADE on an
    // account that is not yours: it is the one admin action here whose damage lands on
    // another person, and it was firing on a single click with only a 6s undo window to
    // catch it. Every other destructive action on this page confirms; this one didn't.
    const ok = await dialog.confirm({
      title: t('twofa.reset.confirm.t', 'Reset this user’s two-factor?'),
      message: t('twofa.reset.confirm.m', 'They will be able to sign in with their password alone until they enrol again. This is logged, and they are emailed about it.'),
      okLabel: t('twofa.reset', 'Reset 2FA'),
      danger: true,
    });
    if (!ok) return;
    setPending(true);
    toast.action({
      tone: 'success', duration: 6000, cancelLabel: t('common.undo', 'Undo'),
      msg: t('twofa.reset.done', 'Two-factor reset — the user can now sign in with their password.'),
      onCommit: async () => {
        try { const r = await api.post(`/admin/users/${user.id}/2fa/reset`); onChange?.(r); }
        catch (x) {
          toast.error(
            x.data?.error === 'cannot_moderate_higher' ? t('mod.higher', 'You can only moderate accounts below your own level.')
            : x.data?.error === 'cannot_reset_self' ? t('twofa.reset.self', "You can't reset your own 2FA here — use Settings.")
            : t('common.failed', 'Failed.'));
        }
        finally { setPending(false); }
      },
      onCancel: () => setPending(false),
    });
  };
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)]/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] flex items-center gap-1.5"><KeyRound size={12} /> {t('twofa.title', 'Two-factor authentication')}</div>
        <Badge tone={enabled ? 'green' : ''}>{enabled ? t('twofa.on', 'Enabled') : t('twofa.off', 'Disabled')}</Badge>
      </div>
      {!enabled ? (
        <div className="text-sm text-[var(--faint)] mt-2">{t('twofa.notenabled', 'No two-factor authentication on this account — nothing to reset.')}</div>
      ) : !canReset ? (
        <div className="text-sm text-[var(--faint)] mt-2">{t('mod.higher', 'You can only moderate accounts below your own level.')}</div>
      ) : (
        <div className="mt-2">
          <div className="text-sm text-[var(--muted)]">{t('twofa.reset.desc', 'Lost their authenticator and recovery codes? Reset 2FA so they can sign in with their password and re-enrol. This is logged and the user is emailed.')}</div>
          <Button size="sm" variant="ghost" className="!text-warning mt-2" disabled={pending} onClick={reset}><KeyRound size={14} /> {t('twofa.reset', 'Reset 2FA')}</Button>
        </div>
      )}
    </div>
  );
}

// Getting someone back into their account.
//
// Two rungs, deliberately unequal. The reset LINK is the one to reach for: it goes to the
// address on file, and whoever sends it never learns the password — support can unblock a
// person without becoming able to impersonate them.
//
// Setting a password outright is the other rung, and it is SUPERADMIN + a live 2FA code,
// because it hands one human the keys to another human's account.
function UserPasswordCard({ user }) {
  const { t } = useI18n(); const toast = useToast(); const dialog = useDialog(); const { user: me } = useAuth();
  const myRank = MOD_RANK[me?.role] ?? 0;
  const targetRank = MOD_RANK[user.role] ?? 0;
  const canLink = myRank >= MOD_RANK.ADMIN;
  // Rank-bounded like every other action here: an admin never sets a superadmin's password,
  // and nobody sets their own from this modal.
  const canSet = me?.role === 'SUPERADMIN' && myRank > targetRank && me?.id !== user.id;
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState(''); const [code, setCode] = useState('');

  const sendLink = async () => {
    if (!await dialog.confirm({
      title: t('upw.link.t', 'Email a reset link?'),
      message: t('upw.link.m', 'They get the same one-hour link the forgot-password page sends, at {email}. Their current password keeps working until they use it.').replace('{email}', user.email),
      okLabel: t('upw.link.ok', 'Send the link'),
    })) return;
    setBusy(true);
    try {
      const r = await api.post(`/admin/users/${user.id}/password-reset`);
      // With no mail backend the API hands back the URL instead — otherwise this would be
      // untestable on a dev instance and its first real use would be its first test.
      if (r.devUrl) { copyText(r.devUrl); toast.success(t('upw.link.dev', 'No mail backend — the link was copied to your clipboard.')); }
      else toast.success(t('upw.link.sent', 'Reset link emailed.'));
    } catch { toast.error(t('common.failed', 'Failed.')); } finally { setBusy(false); }
  };

  const setPassword = async () => {
    if (pw.length < 8) return toast.error(t('upw.short', 'At least 8 characters.'));
    if (!await dialog.confirm({
      title: t('upw.set.t', 'Set this password?'),
      message: t('upw.set.m', 'You will know a password that is not yours. Every device they are signed in on is signed out, they are emailed about it, and your name is on the audit entry.'),
      okLabel: t('upw.set.ok', 'Set it'), danger: true,
    })) return;
    setBusy(true);
    try {
      await api.put(`/admin/users/${user.id}/password`, { password: pw, code });
      setPw(''); setCode(''); setOpen(false);
      toast.success(t('upw.set.done', 'Password set — all their devices were signed out.'));
    } catch (x) {
      toast.error(x.data?.error === 'bad_code' ? t('twofa.bad', 'That code is not valid.')
        : x.data?.error === '2fa_required' ? t('upw.need2fa', 'Enable two-factor on your own account first.')
        : t('common.failed', 'Failed.'));
    } finally { setBusy(false); }
  };

  if (!canLink && !canSet) return null;
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)]/40 p-3">
      <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] flex items-center gap-1.5"><Lock size={12} /> {t('upw.title', 'Password')}</div>
      {canLink && (
        <div className="mt-2">
          <div className="text-sm text-[var(--muted)]">{t('upw.desc', 'Locked out? Send the reset link — you never see their password, and only they can use it.')}</div>
          <Button size="sm" variant="ghost" className="mt-2" disabled={busy} onClick={sendLink}><Mail size={14} /> {t('upw.link', 'Email a reset link')}</Button>
        </div>
      )}
      {canSet && (
        <div className="mt-3 pt-3 border-t border-[var(--line)]">
          {!open ? (
            <Button size="sm" variant="ghost" className="!text-warning" onClick={() => setOpen(true)}><KeyRound size={14} /> {t('upw.set', 'Set a password directly')}</Button>
          ) : (
            <div className="space-y-2">
              <div className="text-sm text-[var(--muted)]">{t('upw.set.desc', 'Superadmin only, and it needs a code from your authenticator — a stolen session must not be enough to take over an account.')}</div>
              <Input type="password" autoComplete="new-password" placeholder={t('upw.new', 'New password')} value={pw} onChange={(e) => setPw(e.target.value)} />
              <Input inputMode="numeric" placeholder={t('twofa.code', '6-digit code')} value={code} onChange={(e) => setCode(e.target.value)} />
              <TotpQuickFill onFill={(c) => setCode(c)} />
              <div className="flex gap-2">
                <Button size="sm" variant="primary" disabled={busy || pw.length < 8 || !code} onClick={setPassword}>{t('upw.set.ok', 'Set it')}</Button>
                <Button size="sm" disabled={busy} onClick={() => { setOpen(false); setPw(''); setCode(''); }}>{t('common.cancel', 'Cancel')}</Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Everything else we hold about one account, loaded only when asked for.
//
// Lazy per panel, and each one tolerates its own 403: the four datasets belong to four
// different capabilities (manage_api, manage_polls, ADMIN for SSO and history), and a
// moderator with none of them should get a clear "not yours to see" rather than a modal
// that fails to open. The alternative — gating the whole panel on ADMIN — would hide the
// three panels a moderator IS allowed to read.
function UserExtras({ userId }) {
  const { t } = useI18n(); const toast = useToast(); const dialog = useDialog();
  const [tab, setTab] = useState('');
  const [cache, setCache] = useState({}); // tab -> { data } | { denied: true } | { error: true }
  const [busy, setBusy] = useState(false);

  const URLS = {
    sso: `/admin/sso/users/${userId}`,
    api: `/admin/api/users/${userId}`,
    polls: `/admin/polls/users/${userId}`,
    // `sources` empty = every source. Passing a word like "all" matches no key and
    // silently returns an empty history, which reads as "this person did nothing".
    history: `/admin/history?days=365&take=60&skip=0&sources=&actorId=${encodeURIComponent(userId)}`,
  };

  const open = async (k) => {
    setTab(tab === k ? '' : k);
    if (cache[k] || tab === k) return;
    setBusy(true);
    try {
      const data = await api.get(URLS[k]);
      setCache((c) => ({ ...c, [k]: { data } }));
    } catch (x) {
      const denied = x?.status === 403 || x?.data?.error === 'missing_permission';
      setCache((c) => ({ ...c, [k]: denied ? { denied: true } : { error: true } }));
    } finally { setBusy(false); }
  };

  const revokeGrant = async (g) => {
    if (!await dialog.confirm({
      title: t('ud.sso.revoke.t', 'Cut this connection?'),
      message: t('ud.sso.revoke.m', '“{n}” loses its access immediately, and its live sessions for this account are revoked too. Signing in there again will ask this person for permission afresh — they are notified, so an unexplained re-prompt does not read as a bug in that app.').replace('{n}', g.client.name),
      okLabel: t('ud.sso.revoke.ok', 'Cut it'), danger: true,
    })) return;
    try {
      await api.del(`/admin/sso/grants/${userId}/${g.clientId}`);
      toast.success(t('ud.sso.revoked', 'Connection removed.'));
      // Refetched rather than patched locally: the token count is the server's answer, and
      // a panel that says "0 live" because we decremented it is a panel that can be wrong.
      const fresh = await api.get(URLS.sso);
      setCache((c) => ({ ...c, sso: { data: fresh } }));
    } catch { toast.error(t('common.failed', 'Failed.')); }
  };

  const state = cache[tab];
  const TABS = [
    ['sso', t('ud.x.sso', 'SSO'), Shield],
    ['api', t('ud.x.api', 'API usage'), KeyRound],
    ['polls', t('ud.x.polls', 'Polls'), BarChart3],
    ['history', t('ud.x.history', 'History'), History],
  ];

  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-1.5 flex items-center gap-1.5">
        <Layers size={12} /> {t('ud.x.more', 'Everything else')}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {TABS.map(([k, label, Icon]) => (
          <Button key={k} size="sm" variant={tab === k ? 'primary' : 'ghost'} onClick={() => open(k)}>
            <Icon size={13} /> {label}
          </Button>
        ))}
      </div>

      {tab && (
        <div className="mt-2 rounded-lg border border-[var(--line)] p-3">
          {busy && !state ? <Spinner />
            : state?.denied ? <div className="text-[12px] text-[var(--muted)]">{t('ud.x.denied', 'Your role does not include this one.')}</div>
            : state?.error ? <div className="text-[12px] text-[var(--muted)]">{t('common.failed', 'Failed.')}</div>
            : !state ? null
            : tab === 'sso' ? (
              <>
                {/* The two halves are labelled, because they point in opposite directions:
                    one is how this person signs in HERE, the other is what they signed in TO
                    with this account. Merging them is how somebody revokes the wrong thing. */}
                <div className="text-[11px] uppercase tracking-wider text-[var(--faint)] mb-1">{t('ud.sso.in', 'Signs in here with')}</div>
                {(state.data.signInLinks || []).length || state.data.discord ? (
                  <div className="space-y-1 mb-3">
                    {(state.data.signInLinks || []).map((l) => (
                      <div key={l.provider + l.providerAccountId} className="flex items-center gap-2 text-[13px] px-2 py-1 rounded bg-[var(--surface-2)]">
                        <span className="capitalize">{l.provider}</span>
                        <span className="text-[var(--muted)] truncate flex-1">{l.username || l.providerAccountId}</span>
                        <span className="text-[10px] text-[var(--faint)]">{new Date(l.linkedAt).toLocaleDateString()}</span>
                      </div>
                    ))}
                    {state.data.discord && (
                      <div className="flex items-center gap-2 text-[13px] px-2 py-1 rounded bg-[var(--surface-2)]">
                        <span>Discord</span>
                        <span className="text-[var(--muted)] truncate flex-1">{state.data.discord.username || state.data.discord.discordId}</span>
                        <span className="text-[10px] text-[var(--faint)]">{new Date(state.data.discord.linkedAt).toLocaleDateString()}</span>
                      </div>
                    )}
                  </div>
                ) : <div className="text-[12px] text-[var(--faint)] mb-3">{t('ud.sso.noin', 'Password only — no social sign-in linked.')}</div>}

                <div className="text-[11px] uppercase tracking-wider text-[var(--faint)] mb-1">{t('ud.sso.out', 'Apps this account signs in to')}</div>
                {(state.data.grants || []).length ? (
                  <div className="space-y-1">
                    {state.data.grants.map((g) => (
                      <div key={g.clientId} className="flex items-center gap-2 text-[13px] px-2 py-1 rounded bg-[var(--surface-2)]">
                        <span className="truncate flex-1">
                          {g.client.name}
                          <span className="text-[10px] text-[var(--faint)] ml-1.5">{g.scope}</span>
                        </span>
                        {g.activeTokens > 0 && <Badge tone="green">{t('ud.sso.live', '{n} live').replace('{n}', String(g.activeTokens))}</Badge>}
                        <Button size="sm" variant="ghost" onClick={() => revokeGrant(g)} title={t('ud.sso.revoke.ok', 'Cut it')}><Ban size={12} className="text-[var(--error)]" /></Button>
                      </div>
                    ))}
                  </div>
                ) : <div className="text-[12px] text-[var(--faint)]">{t('ud.sso.noout', 'Has not signed in to any app with this account.')}</div>}
              </>
            ) : tab === 'api' ? (
              <>
                <div className="text-[13px] mb-2">
                  {t('ud.api.total', '{n} calls recorded, across {k} key(s).')
                    .replace('{n}', String(state.data.totalCalls || 0)).replace('{k}', String((state.data.keys || []).length))}
                </div>
                {(state.data.usage || []).length ? (
                  <div className="space-y-0.5 max-h-40 overflow-y-auto">
                    {state.data.usage.map((d) => (
                      <div key={d.day} className="flex items-center gap-2 text-[12px]">
                        <span className="text-[var(--faint)] w-20 shrink-0">{d.day}</span>
                        <span className="tabular-nums flex-1">{d.count}</span>
                        {d.errors > 0 && <span className="text-warning tabular-nums text-[11px]">{d.errors} {t('aapi.errs', 'errors')}</span>}
                      </div>
                    ))}
                  </div>
                ) : <div className="text-[12px] text-[var(--faint)]">{t('ud.api.none', 'No API call recorded for this account.')}</div>}
              </>
            ) : tab === 'polls' ? (
              (state.data.votes || []).length ? (
                <div className="space-y-1 max-h-52 overflow-y-auto">
                  {state.data.votes.map((v) => (
                    <div key={v.id} className="text-[12px] flex items-center gap-2">
                      <span className="truncate flex-1">{v.poll.question}</span>
                      <span className="text-[var(--muted)] truncate shrink-0">{v.option.label}</span>
                      <span className="text-[10px] text-[var(--faint)] shrink-0">{new Date(v.createdAt).toLocaleDateString()}</span>
                    </div>
                  ))}
                </div>
              ) : <div className="text-[12px] text-[var(--faint)]">{t('ud.polls.none', 'Has not answered any poll.')}</div>
            ) : (
              (state.data.entries || []).length ? (
                <div className="space-y-1 max-h-60 overflow-y-auto">
                  {state.data.entries.map((e, i) => (
                    <div key={i} className="text-[12px] flex items-center gap-2">
                      <Badge>{e.source}</Badge>
                      <span className="truncate flex-1">{e.action}{e.detail ? ` · ${e.detail}` : ''}</span>
                      <span className="text-[10px] text-[var(--faint)] shrink-0">{new Date(e.at).toLocaleDateString()}</span>
                    </div>
                  ))}
                </div>
              ) : <div className="text-[12px] text-[var(--faint)]">{t('ud.hist.none', 'Nothing recorded in the last year.')}</div>
            )}
        </div>
      )}
    </div>
  );
}

// The closure state of an account, and the button that starts one.
//
// Placed at the TOP of the details, above the profile: a pending closure changes what
// every other action on this screen means. Banning an account that deletes itself in nine
// days, or chasing a payment from one, is work nobody needed to do.
function ClosureBanner({ user, onChanged }) {
  const { t } = useI18n(); const toast = useToast(); const dialog = useDialog();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(null); // { reason, days, cancellable }

  const day = (d) => new Date(d).toLocaleDateString();

  const start = async () => {
    if (!form.reason.trim() || form.reason.trim().length < 3) return toast.error(t('ud.cl.needreason', 'Say why — it goes in the email they receive.'));
    if (!await dialog.confirm({
      title: t('ud.cl.start.t', 'Schedule this account for closure?'),
      // Naming what the person on the other end gets, because that is the part an admin
      // cannot see afterwards and the part they are actually deciding.
      message: (form.cancellable === false
        ? t('ud.cl.start.m.final', 'FINAL: they cannot call this off — no cancel link is sent, only the reason, the date and a way to contact us. On {d} any active subscription is cancelled and everything hosted under the account — repositories, catalogs, their storage — is deleted. Nothing is transferred to anyone. You can still call it off yourself until then.')
        : t('ud.cl.start.m', 'They are emailed the reason, the date, and a link to call it off themselves. On {d} any active subscription is cancelled and everything hosted under the account — repositories, catalogs, their storage — is deleted. Nothing is transferred to anyone.'))
        .replace('{d}', day(Date.now() + (Number(form.days) || 30) * 864e5)),
      okLabel: t('ud.cl.start.ok', 'Schedule it'), danger: true,
    })) return;
    setBusy(true);
    try {
      await api.post(`/admin/users/${user.id}/closure`, { reason: form.reason.trim(), days: Number(form.days) || 30, cancellable: form.cancellable !== false });
      toast.success(t('ud.cl.started', 'Scheduled — they have been told.'));
      setForm(null); onChanged();
    } catch (x) {
      toast.error(x?.data?.error === 'cannot_moderate_higher' ? t('ud.cl.outranked', 'That account outranks yours.')
        : x?.data?.error === 'already_pending' ? t('ud.cl.pendingerr', 'A closure is already scheduled.')
        : x?.data?.error === 'self' ? t('ud.cl.self', 'Close your own account from your profile.')
        : t('common.failed', 'Failed.'));
    } finally { setBusy(false); }
  };

  const callOff = async () => {
    setBusy(true);
    try { await api.del(`/admin/users/${user.id}/closure`); toast.success(t('ud.cl.calledoff', 'Called off.')); onChanged(); }
    catch { toast.error(t('common.failed', 'Failed.')); } finally { setBusy(false); }
  };

  if (user.closedAt) {
    return (
      <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)]/60 p-3 text-[13px]">
        <div className="font-semibold flex items-center gap-2"><Ban size={14} /> {t('ud.cl.closed', 'This account is closed.')}</div>
        <p className="text-[12px] text-[var(--muted)] mt-1">
          {t('ud.cl.closed.s', 'Closed on {d}. Everything personal was erased; the payment and moderation records below were kept on purpose.').replace('{d}', day(user.closedAt))}
        </p>
      </div>
    );
  }

  if (user.closureScheduledFor) {
    const staff = !!user.closureBy;
    return (
      <div className="rounded-xl border border-warning bg-warning/10 p-3">
        <div className="text-[13px] font-semibold flex items-center gap-2">
          <AlertTriangle size={14} className="text-warning" />
          {t('ud.cl.pending', 'Closing on {d}').replace('{d}', day(user.closureScheduledFor))}
        </div>
        <p className="text-[12px] text-[var(--muted)] mt-1">
          {staff
            ? `${t('ud.cl.pending.staff', 'Scheduled by staff. Reason given: “{r}”.').replace('{r}', user.closureReason || '—')} ${user.closureCancellable === false ? t('ud.cl.pending.final', 'Final — the account cannot call it off.') : t('ud.cl.pending.soft', 'They can call it off with the link in their email.')}`
            : t('ud.cl.pending.self', 'They asked for it themselves, and can cancel it with the link in their email until that date.')}
        </p>
        <Button size="sm" className="mt-2" disabled={busy} onClick={callOff}>{busy ? <Spinner /> : t('ud.cl.calloff', 'Call it off')}</Button>
      </div>
    );
  }

  return form ? (
    <div className="rounded-xl border border-[var(--line)] p-3 space-y-2">
      <div className="text-[13px] font-semibold">{t('ud.cl.start.t', 'Schedule this account for closure?')}</div>
      <Field label={t('ud.cl.reason', 'Reason (they read this)')}>
        <Textarea rows={2} value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
          placeholder={t('ud.cl.reason.ph', 'Repeated spam in community catalogs')} />
      </Field>
      {/* Two named outcomes rather than a checkbox: "can they undo it" is the decision, and
          the reversible one is first and default because it is the one that cannot go badly
          wrong. */}
      <div className="grid sm:grid-cols-2 gap-2">
        {[[true, t('ud.cl.mode.soft', 'They can call it off'), t('ud.cl.mode.soft.s', 'The email carries a cancel link. Use this when the account should probably go, but you might be wrong.')],
          [false, t('ud.cl.mode.final', 'Final'), t('ud.cl.mode.final.s', 'No cancel link is sent and the account cannot stop it. You can still call it off from here until the date.')]].map(([val, label, sub]) => (
          <button key={String(val)} onClick={() => setForm((f) => ({ ...f, cancellable: val }))}
            className={`text-left rounded-lg border p-2.5 transition ${(form.cancellable !== false) === val ? 'border-[var(--primary)] bg-[var(--primary)]/10' : 'border-[var(--line)] hover:border-[var(--line-strong)]'}`}>
            <div className="text-xs font-semibold">{label}</div>
            <div className="text-[11px] text-[var(--muted)] mt-0.5">{sub}</div>
          </button>
        ))}
      </div>
      <p className="text-[11px] text-warning">
        {t('ud.cl.teardown', 'Scheduling it suspends their repositories, catalogs and items immediately — nothing is deleted, and calling it off puts each one back in the state it was in. On the date: subscriptions cancelled, everything deleted with its storage, pools removed. Nothing is transferred — if any of it should survive, move it to another account first.')}
      </p>
      <div className="flex items-end gap-2">
        <Field label={t('ud.cl.days', 'Days of notice')}>
          <Input className="w-24" type="number" min="0" max="365" value={form.days} onChange={(e) => setForm((f) => ({ ...f, days: e.target.value }))} />
        </Field>
        <Button size="sm" variant="primary" disabled={busy} onClick={start}>{busy ? <Spinner /> : t('ud.cl.start.ok', 'Schedule it')}</Button>
        <Button size="sm" onClick={() => setForm(null)}>{t('common.cancel', 'Cancel')}</Button>
      </div>
    </div>
  ) : (
    <button onClick={() => setForm({ reason: '', days: 30, cancellable: true })}
      className="text-[11px] text-[var(--faint)] hover:text-[var(--error)] transition">
      {t('ud.cl.open', 'Schedule this account for closure…')}
    </button>
  );
}

function UserDetailModal({ id, onClose }) {
  const { data, loading, reload } = useAsync(() => api.get(`/admin/users/${id}`), [id]);
  const toast = useToast(); const { t } = useI18n(); const dialog = useDialog();
  const u = data?.user;
  const hosted = (u?.serverRepos || []).filter((r) => r.hosted);
  const listed = (u?.serverRepos || []).filter((r) => !r.hosted);
  const fdate = (d) => new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  // Per-element unique BC id chip (copyable) — shown on each repo / catalog item.
  const BcChip = ({ code }) => code ? (
    <button onClick={() => { navigator.clipboard?.writeText(code); toast.success(t('ud.elemcopied', 'Element BC id copied.')); }}
      className="shrink-0 inline-flex items-center gap-1 text-[10px] font-mono text-[var(--faint)] hover:text-[var(--primary-2)] transition" title={t('ud.elemid', 'Unique element id · {c}').replace('{c}', code)}>
      <Fingerprint size={10} /> {code}
    </button>
  ) : null;
  return (
    <Modal open onClose={onClose} title={t('ud.title', 'User details')} icon={Users} width="max-w-2xl"
      footer={<Button variant="ghost" onClick={onClose}>{t('su.close', 'Close')}</Button>}>
      {loading ? <Loading /> : !u ? <EmptyState icon={XCircle} title={t('ud.notfound', 'Not found')} /> : (
        <div className="space-y-5">
          <ClosureBanner user={u} onChanged={reload} />
          {u.priorUserId && (
            <div className="text-[12px] text-[var(--muted)] flex items-center gap-1.5">
              <RotateCcw size={12} />
              {/* Not a footnote: it is the reason a "new" account can arrive already banned. */}
              {t('ud.prior', 'This account came back to an address that had been closed — its record was carried over.')}
            </div>
          )}
          <div className="flex items-center gap-4">
            <Avatar user={u} size={64} />
            <div className="min-w-0">
              <div className="text-lg font-bold flex items-center gap-2">{u.displayName} <Badge tone={u.role === 'SUPERADMIN' ? 'red' : u.role === 'ADMIN' ? 'amber' : u.role === 'MOD' ? 'primary' : ''}>{u.role}</Badge></div>
              <div className="text-sm text-[var(--muted)] flex items-center gap-1.5"><Mail size={13} /> {u.email}</div>
              <div className="text-xs text-[var(--faint)] mt-0.5 flex items-center gap-1.5"><Cookie size={12} /> {t('ud.membersince', 'Member since {d}').replace('{d}', fdate(u.createdAt))}</div>
              <div className="text-[11px] text-[var(--faint)] font-mono mt-0.5">{u.id}</div>
              {u.bcId && (
                <button onClick={() => { navigator.clipboard?.writeText(u.bcId); toast.success(t('ud.bccopied', 'Unique BC id copied.')); }}
                  className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-mono font-semibold text-[var(--primary-2)] px-2 py-1 rounded-md bg-[var(--surface-2)] border border-[var(--line)] hover:border-[var(--primary)]/40 transition"
                  title={t('ud.bcidtip', 'Unique BC id — searchable in User search')}>
                  <Fingerprint size={12} /> {u.bcId} <Copy size={11} className="opacity-60" />
                </button>
              )}
            </div>
          </div>
          {u.bio && <p className="text-sm text-[var(--muted)]">{u.bio}</p>}

          <UserModerationCard user={u} onChange={reload} />

          <UserTwoFactorCard user={u} onChange={reload} />
          <UserPasswordCard user={u} />

          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-1.5 flex items-center gap-1.5"><BadgeCheck size={12} /> {t('ud.creatorids', 'Linked creator ids')}</div>
            {u.creatorLinks.length ? <div className="flex flex-wrap gap-1.5">{u.creatorLinks.map((c) => <Badge key={c.creatorId} tone="green"><code>{c.creatorId}</code>{c.displayName ? ` · ${c.displayName}` : ''}</Badge>)}</div>
              : <div className="text-sm text-[var(--faint)]">{t('ud.nocreator', 'No creator id linked.')}</div>}
          </div>

          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-1.5 flex items-center gap-1.5"><DiscordIcon size={12} /> Discord</div>
            {u.discordLinks?.length ? <div className="space-y-1">{u.discordLinks.map((d) => (
              <div key={d.discordId} className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg bg-[var(--surface-2)]">
                <DiscordIcon size={13} className="text-[#5865F2] shrink-0" />
                <span className="font-medium">{d.username || '—'}</span>
                <code className="text-xs text-[var(--faint)]">{d.discordId}</code>
                <span className="text-[11px] text-[var(--faint)] ml-auto shrink-0">{t('ud.linked', 'linked {d}').replace('{d}', fdate(d.linkedAt))}</span>
              </div>
            ))}</div> : <div className="text-sm text-[var(--faint)]">{t('ud.nodiscord', 'No Discord linked.')}</div>}
          </div>

          {u.subscriptions?.length > 0 && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-1.5 flex items-center gap-1.5"><RefreshCw size={12} /> {t('ud.subs', 'Active subscriptions')} · <span className="text-success normal-case">≈ ${(u.mrrCents / 100).toFixed(2)}/{t('pu.mo', 'mo')}</span></div>
              <div className="space-y-1">{u.subscriptions.map((s) => {
                const cur = (s.currency || 'usd').toUpperCase(); const sym = cur === 'USD' ? '$' : cur === 'EUR' ? '€' : cur === 'GBP' ? '£' : '';
                const amt = sym ? `${sym}${(s.amountCents / 100).toFixed(2)}` : `${(s.amountCents / 100).toFixed(2)} ${cur}`;
                const per = s.intervalCount > 1 ? `/${s.intervalCount} ${s.interval}` : `/${s.interval}`;
                return (
                  <div key={s.id} className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg bg-[var(--surface-2)]">
                    <RefreshCw size={13} className="text-[var(--primary-2)] shrink-0" />
                    <span className="flex-1 truncate">{s.kind === 'boost' ? t('bill.sub.boost', 'Repo boost subscription') : t('bill.sub.hosting', 'Hosting subscription')}</span>
                    <span className="font-medium shrink-0">{amt} <span className="text-[var(--faint)] font-normal text-xs">{per}</span></span>
                    {s.currentPeriodEnd && <span className="text-[11px] text-[var(--faint)] shrink-0">{fdate(s.currentPeriodEnd)}</span>}
                  </div>
                );
              })}</div>
            </div>
          )}

          {/* API keys. The endpoint returns null for a non-SUPERADMIN caller and [] for a
              SUPERADMIN looking at an account with none — two different facts, so the
              section renders only when it is actually allowed to say something. Hiding
              it for a MOD is better than showing an empty list that reads as "this user
              has no keys" when the truth is "you may not see them". */}
          {/* Signed-in devices. Present only for a SUPERADMIN — the API returns null
              otherwise, which is why this is a truthiness check and not `.length`: an
              empty array means "none", null means "you may not see this". */}
          {u.sessions && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-1.5 flex items-center gap-1.5"><Monitor size={12} /> {t('ud.sessions', 'Signed-in devices')} ({u.sessions.length})</div>
              {u.sessions.length ? <div className="space-y-1 max-h-52 overflow-auto pr-1">{u.sessions.map((sn) => (
                <div key={sn.id} className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg bg-[var(--surface-2)]">
                  <Monitor size={13} className="text-[var(--primary-2)] shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="truncate">{[sn.browser, sn.os].filter(Boolean).join(' · ') || t('ud.sessUnknown', 'Unknown device')}</div>
                    <div className="text-[11px] text-[var(--faint)] font-mono truncate">
                      {sn.ip || '—'}{[sn.city, sn.region, sn.country].filter(Boolean).length ? ' · ' + [sn.city, sn.region, sn.country].filter(Boolean).join(', ') : ''}
                    </div>
                  </div>
                  <div className="text-[11px] text-[var(--faint)] shrink-0 text-right">
                    {new Date(sn.lastSeenAt).toLocaleString()}
                  </div>
                  <Button size="sm" variant="ghost" onClick={async () => {
                    if (!await dialog.confirm({
                      title: t('ud.sessRevokeT', 'Sign this device out?'),
                      message: t('ud.sessRevokeB', 'It stops working on its next request. The user is not told, and can simply sign in again — this ends a session, it does not lock the account.'),
                      okLabel: t('ud.sessRevoke', 'Sign out'),
                    })) return;
                    try { await api.del(`/admin/users/${u.id}/sessions/${sn.id}`); toast.success(t('ud.sessRevoked', 'Device signed out.')); reload(); }
                    catch { toast.error(t('common.failed', 'Failed.')); }
                  }}><LogOut size={13} /></Button>
                </div>
              ))}</div> : <div className="text-[12px] text-[var(--faint)]">{t('ud.sessNone', 'No active sessions.')}</div>}
            </div>
          )}

          {u.apiKeys && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-1.5 flex items-center gap-1.5"><KeyRound size={12} /> {t('ud.apikeys', 'API keys')} ({u.apiKeys.length})</div>
              {u.apiKeys.length ? <div className="space-y-1 max-h-52 overflow-auto pr-1">{u.apiKeys.map((k) => {
                // A key is dead if it was revoked OR its expiry has passed. Showing only
                // the revoked ones as inactive would leave an expired key looking live,
                // and an admin would revoke something that already stopped working.
                const expired = k.expiresAt && new Date(k.expiresAt) < new Date();
                const dead = !!k.revokedAt || expired;
                return (
                  <div key={k.id} className={`flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg bg-[var(--surface-2)] ${dead ? 'opacity-55' : ''}`}>
                    <KeyRound size={13} className={dead ? 'text-[var(--faint)] shrink-0' : 'text-[var(--primary-2)] shrink-0'} />
                    <div className="flex-1 min-w-0">
                      <div className="truncate">{k.label || <span className="text-[var(--faint)]">{t('ud.keyNoLabel', 'Untitled key')}</span>}</div>
                      {/* The prefix, never the key. It is stored in clear precisely so two
                          keys can be told apart without either being usable. */}
                      <div className="text-[11px] text-[var(--faint)] font-mono truncate">{k.prefix}… · {(k.scopes || []).join(', ') || t('ud.keyNoScope', 'no scopes')}</div>
                    </div>
                    {k.revokedAt ? <Badge>{t('ud.keyRevoked', 'revoked')}</Badge>
                      : expired ? <Badge>{t('ud.keyExpired', 'expired')}</Badge>
                      : <Button size="sm" variant="ghost" onClick={async () => {
                          if (!await dialog.confirm({
                            title: t('ud.keyRevokeT', 'Revoke this key?'),
                            message: t('ud.keyRevokeB', 'Anything using it stops working immediately. This cannot be undone — a new key has to be created by the owner.'),
                            okLabel: t('ud.keyRevoke', 'Revoke'),
                            danger: true,
                          })) return;
                          try {
                            await api.post(`/admin/users/${u.id}/api-keys/${k.id}/revoke`);
                            toast.success(t('ud.keyRevoked2', 'Key revoked.'));
                            reload();
                          } catch (e) { toast.error(String(e?.message || e)); }
                        }}><Ban size={13} /> {t('ud.keyRevoke', 'Revoke')}</Button>}
                    <span className="text-[11px] text-[var(--faint)] shrink-0">{k.lastUsedAt ? t('ud.keyUsed', 'used {d}').replace('{d}', fdate(k.lastUsedAt)) : t('ud.keyUnused', 'never used')}</span>
                  </div>
                );
              })}</div> : <div className="text-sm text-[var(--faint)]">{t('ud.nokeys', 'No API keys.')}</div>}
            </div>
          )}

          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-1.5 flex items-center gap-1.5"><Receipt size={12} /> {t('ud.payments', 'Payments')} ({u.payments?.length || 0})</div>
            {u.payments?.length ? <div className="space-y-1 max-h-40 overflow-auto pr-1">{u.payments.map((pay) => (
              <div key={pay.id} className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg bg-[var(--surface-2)]">
                <Receipt size={13} className="text-success shrink-0" />
                <span className="flex-1 truncate">{pay.description}</span>
                <span className="text-success font-medium shrink-0">${(pay.amountCents / 100).toFixed(2)}</span>
                <span className="text-[11px] text-[var(--faint)] shrink-0">{fdate(pay.createdAt)}</span>
              </div>
            ))}</div> : <div className="text-sm text-[var(--faint)]">{t('ud.nopayments', 'No payments — free plan only.')}</div>}
          </div>

          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-1.5 flex items-center gap-1.5"><Rocket size={12} /> {t('ud.hosted', 'Hosted repos')} ({hosted.length})</div>
            {hosted.length ? <div className="space-y-1 max-h-40 overflow-auto pr-1">{hosted.map((r) => <div key={r.id} className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg bg-[var(--surface-2)]"><Server size={13} className="text-[var(--primary-2)] shrink-0" /><span className="flex-1 truncate">{r.name}</span><BcChip code={r.fingerprint} /><Badge tone={r.status === 'ONLINE' ? 'green' : ''}>{r.status}</Badge></div>)}</div>
              : <div className="text-sm text-[var(--faint)]">{t('ud.none', 'None.')}</div>}
          </div>

          {listed.length > 0 && <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-1.5 flex items-center gap-1.5"><GitBranch size={12} /> {t('ud.listed', 'Listed repos')} ({listed.length})</div>
            <div className="space-y-1 max-h-40 overflow-auto pr-1">{listed.map((r) => <div key={r.id} className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg bg-[var(--surface-2)]"><GitBranch size={13} className="text-[var(--primary-2)] shrink-0" /><span className="flex-1 truncate">{r.name}</span><BcChip code={r.fingerprint} />{r.verified && <Badge tone="green">{t('ud.verified', 'verified')}</Badge>}</div>)}</div>
          </div>}

          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-1.5 flex items-center gap-1.5"><Package size={12} /> {t('ud.catalogitems', 'Catalog items')} ({u.items.length})</div>
            {u.items.length ? <div className="space-y-1 max-h-40 overflow-auto pr-1">{u.items.map((it) => { const I = KIND_ICON[it.kind] || Package; return <div key={it.id} className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg bg-[var(--surface-2)]"><I size={13} className="text-[var(--primary-2)] shrink-0" /><span className="flex-1 truncate">{it.name}</span><BcChip code={it.fingerprint} /><Badge tone={statusTone(it.status)}>{it.status}</Badge></div>; })}</div>
              : <div className="text-sm text-[var(--faint)]">{t('ud.none', 'None.')}</div>}
          </div>

          <UserExtras userId={u.id} />
        </div>
      )}
    </Modal>
  );
}

function PluginContentModal({ item, onClose }) {
  const { data, loading, err } = useAsync(() => api.get(`/admin/catalog/${item.id}/plugin-content`), [item.id]);
  const { t } = useI18n();
  const kb = (n) => (Number(n) / 1024).toFixed(1);
  // Download a single extracted file (same-origin → session cookie is sent).
  const dlFile = (path) => { const a = document.createElement('a'); a.href = `/api/admin/catalog/${item.id}/plugin-file?path=${encodeURIComponent(path)}`; a.download = path.split('/').pop() || 'file'; document.body.appendChild(a); a.click(); a.remove(); };
  // The endpoint 502s when a plugin has no source (no payload / URL) — surface that
  // gracefully instead of crashing on data.valid.
  const errMsg = data?.error ? (data.detail || data.error) : err ? (err.data?.detail || err.data?.error || t('pcm.nosource', 'This plugin has no downloadable source.')) : null;
  return (
    <Modal open onClose={onClose} title={t('pcm.title', 'Plugin content — {n}').replace('{n}', item.name)} icon={Files} width="max-w-2xl"
      footer={<><Button variant="ghost" onClick={onClose}>{t('su.close', 'Close')}</Button>{data?.downloadUrl && <a href={data.downloadUrl} target="_blank" rel="noreferrer"><Button variant="primary"><Download size={15} /> {t('pcm.dlplug', 'Download .bmmplug')}</Button></a>}</>}>
      {loading ? <Loading /> : errMsg ? (
        <div className="flex items-start gap-2.5 text-sm text-[var(--muted)] py-2">
          <XCircle size={18} className="text-warning shrink-0 mt-0.5" />
          <div>{t('pcm.cannotinspect', 'Could not inspect this plugin:')} <b className="text-[var(--text)]">{errMsg}</b>
            <div className="text-xs text-[var(--faint)] mt-1">{t('pcm.nosourcehint', "A plugin with no uploaded file or download URL can't be unzipped. Add a source, then re-validate.")}</div></div>
        </div>
      ) : data ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm">
            {data.valid ? <Badge tone="green"><CheckCircle2 size={11} /> {t('pv.valid', 'Valid')}</Badge> : <Badge tone="red"><XCircle size={11} /> {data.reason}</Badge>}
            <span className="text-[var(--faint)] text-xs">{kb(data.size)} KB · sha {String(data.sha256).slice(0, 16)}…</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)]">{t('pcm.files', 'Files')} ({(data.files || []).length})</span>
            {data.downloadUrl && <a href={data.downloadUrl} target="_blank" rel="noreferrer" className="text-xs text-[var(--primary-2)] hover:underline flex items-center gap-1"><Download size={12} /> {t('pcm.dlall', 'Download all (.bmmplug)')}</a>}
          </div>
          <div className="space-y-1 max-h-[38vh] overflow-auto">
            {(data.files || []).map((fl) => (
              <div key={fl.path} className="group flex items-center gap-2.5 px-3 py-2 rounded-lg bg-[var(--surface-2)] text-sm">
                {fl.ok ? <CheckCircle2 size={14} className="text-success shrink-0" /> : <XCircle size={14} className="text-error shrink-0" />}
                <span className="flex-1 truncate font-mono text-xs">{fl.path}</span>
                <span className="text-xs text-[var(--faint)]">{kb(fl.size)} KB</span>
                <button onClick={() => dlFile(fl.path)} title={t('pcm.dlfile', 'Download this file')} className="text-[var(--faint)] hover:text-[var(--primary-2)] shrink-0"><Download size={13} /></button>
              </div>
            ))}
          </div>
          {data.manifest && <div><div className="text-xs font-semibold text-[var(--faint)] uppercase mb-1.5">{t('pcm.manifest', 'plugin.json (never executed)')}</div>
            <pre className="text-xs bg-[var(--surface-2)] rounded-lg p-3 max-h-48 overflow-auto">{JSON.stringify(data.manifest, null, 2)}</pre></div>}
        </div>
      ) : null}
    </Modal>
  );
}

// Admin: provision a hosted repo for free (no Stripe), optionally for another user.
// The plans the pricing page sells. They were seeded once and only reachable through SQL
// after that — and a price nobody can change without a database client is a price that
// never changes.
//
// Inactive plans are listed too: hiding a plan is the usual way to retire one, so the
// editor is exactly where you go looking for it. Each row carries its live subscription
// count, because that single fact decides whether a plan can be deleted or only retired.
// Reaching users by email, from inside the tool that knows who they are.
//
// It exists because the alternative is exporting addresses into a mail client, which is
// how a customer list ends up in a To: field. Every message here is sent as ONE email per
// recipient — nobody learns who else was written to.
//
// Audiences are queries evaluated at send time, not saved lists, so "everyone on a hosting
// plan" means whoever is subscribed when you press the button.
// Everything that happened on the site, in one list.
//
// It stores nothing of its own: the endpoint reads the tables that already record each
// kind of event and merges them. That is why the window is a fixed number of days rather
// than infinite scrollback — the merge happens in memory, so it is bounded on purpose.
const HIST_TONE = {
  staff: 'text-[var(--primary-2)]', repo: 'text-success', catalog: 'text-warning',
  blog: 'text-[var(--primary)]', docs: 'text-[var(--primary)]', project: 'text-[var(--primary-2)]',
  payment: 'text-success', auth: 'text-[var(--muted)]',
};
const HIST_ICON = {
  staff: Shield, repo: FolderGit2, catalog: Package, blog: Newspaper,
  docs: BookOpen, project: Layers, payment: Receipt, auth: KeyRound,
};

function AdminHistory() {
  const { t } = useI18n(); const toast = useToast();
  // The rank is read here rather than passed in: the server enforces it anyway (403), and a
  // prop threaded through for a single input is a prop that drifts from the guard.
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'SUPERADMIN';
  const [days, setDays] = useState(30);
  const [sources, setSources] = useState([]);     // [] = all
  const [q, setQ] = useState(''); const [qApplied, setQApplied] = useState('');
  const [take, setTake] = useState(60);
  const [open, setOpen] = useState(null);        // expanded row key
  const [panel, setPanel] = useState('');        // '' | 'retention' | 'verify'
  const [retention, setRetention] = useState(null);
  const [imported, setImported] = useState(null); // a verified (or rejected) export file
  const [busy, setBusy] = useState(false);
  const query = new URLSearchParams({ days: String(days), take: String(take), ...(sources.length ? { sources: sources.join(',') } : {}), ...(qApplied ? { q: qApplied } : {}) }).toString();
  const { data, loading } = useAsync(() => api.get(`/admin/history?${query}`), [query]);
  const entries = data?.entries || [];
  const all = data?.sources || [];
  const toggle = (k) => { setTake(60); setSources((v) => (v.includes(k) ? v.filter((x) => x !== k) : [...v, k])); };
  const when = (at) => new Date(at).toLocaleString();
  const saveRetention = async (source, raw) => {
    const n = Math.max(0, Math.min(3650, Math.round(Number(raw) || 0)));
    try {
      await api.put('/admin/history/retention', { source, days: n });
      setRetention(await api.get('/admin/history/retention'));
      toast.success(n === 0 ? t('hist.ret.kept', 'Kept until something else removes it.') : t('hist.ret.saved', 'Kept for {n} days.').replace('{n}', String(n)));
    } catch (x) {
      toast.error(x?.status === 403 ? t('hist.ret.rank', 'Only a superadmin can change a retention window.') : t('common.failed', 'Failed.'));
    }
  };

  // Downloaded through fetch, like the backup bundle and for the same reason: the
  // signature is a response header, and a plain link would save the file while discarding
  // the only thing that lets anyone check it later.
  const exportHistory = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/history/export?${new URLSearchParams({ days: String(days), ...(sources.length ? { sources: sources.join(',') } : {}), ...(qApplied ? { q: qApplied } : {}) })}`, { credentials: 'include' });
      if (!res.ok) throw new Error('export');
      const sig = res.headers.get('X-History-Signature') || '';
      const text = await res.text();
      const name = (res.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/)?.[1] || 'history.json';
      const dl = (blob, fname) => { const u = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = u; a.download = fname; a.click(); URL.revokeObjectURL(u); };
      dl(new Blob([text], { type: 'application/json' }), name);
      if (sig) dl(new Blob([sig], { type: 'text/plain' }), `${name}.sig.b64`);
      toast.success(t('hist.exported', 'Downloaded {n} — the signature was saved next to it.').replace('{n}', name));
    } catch { toast.error(t('common.failed', 'Failed.')); } finally { setBusy(false); }
  };

  // Verification happens HERE, in the browser, with the published public key — the file
  // is never uploaded. An import that has to be sent back to the server to be read is not
  // an independent check of anything: it asks the thing you are auditing whether its own
  // record is genuine.
  const verifyFile = async (jsonFile, sigFile) => {
    setBusy(true);
    try {
      const [bytes, sigB64] = await Promise.all([jsonFile.arrayBuffer(), sigFile ? sigFile.text() : Promise.resolve('')]);
      const { publicKey } = await api.get('/admin/history/pubkey');
      let valid = null;
      if (sigB64.trim()) {
        // Web Crypto wants raw key material, so the PEM's base64 body is decoded out of it.
        const der = Uint8Array.from(atob(publicKey.replace(/-----[^-]+-----|\s/g, '')), (c) => c.charCodeAt(0));
        const key = await crypto.subtle.importKey('spki', der, { name: 'Ed25519' }, false, ['verify']);
        const sig = Uint8Array.from(atob(sigB64.trim()), (c) => c.charCodeAt(0));
        valid = await crypto.subtle.verify({ name: 'Ed25519' }, key, sig, bytes);
      }
      const doc = JSON.parse(new TextDecoder().decode(bytes));
      setImported({ doc, valid, name: jsonFile.name });
    } catch (e) {
      toast.error(t('hist.import.bad', 'Could not read that file — is it a history export?'));
      setImported(null);
    } finally { setBusy(false); }
  };

  return (
    <div>
      <h2 className="font-semibold mb-1 flex items-center gap-2"><History size={16} className="text-[var(--primary-2)]" /> {t('hist.title', 'Site history')}</h2>
      <p className="text-sm text-[var(--muted)] mb-3">
        {t('hist.desc', 'Every recorded event, staff and user alike, merged from the logs the site already keeps — nothing here is stored twice. Filter by source, search any text, or widen the window.')}
      </p>

      <div className="flex flex-wrap gap-2 items-center mb-3">
        <div className="relative flex-1 min-w-[200px]"><Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--faint)]" />
          <Input className="!pl-8 !py-1.5 !text-sm" placeholder={t('hist.search', 'Search action, detail, person…')} value={q}
            onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (setTake(60), setQApplied(q))} /></div>
        <Button size="sm" variant="primary" onClick={() => { setTake(60); setQApplied(q); }}><Search size={14} /> {t('common.search', 'Search')}</Button>
        <div className="flex rounded-lg border border-[var(--line)] overflow-hidden">
          {[7, 30, 90, 365].map((d) => (
            <button key={d} onClick={() => { setTake(60); setDays(d); }}
              className={`px-2.5 py-1 text-xs ${days === d ? 'bg-[var(--surface-2)] text-[var(--text)] font-medium' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}>
              {d >= 365 ? t('hist.1y', '1 y') : `${d} ${t('hist.d', 'd')}`}
            </button>
          ))}
        </div>
        <Button size="sm" disabled={busy} onClick={exportHistory}><Download size={13} /> {t('hist.export', 'Export')}</Button>
        <Button size="sm" variant={panel === 'verify' ? 'primary' : 'ghost'} onClick={() => setPanel(panel === 'verify' ? '' : 'verify')}>
          <ShieldCheck size={13} /> {t('hist.verify', 'Open an export')}
        </Button>
        <Button size="sm" variant={panel === 'retention' ? 'primary' : 'ghost'} onClick={async () => {
          if (panel === 'retention') return setPanel('');
          if (!retention) { try { setRetention(await api.get('/admin/history/retention')); } catch { toast.error(t('common.failed', 'Failed.')); return; } }
          setPanel('retention');
        }}>
          <Clock size={13} /> {t('hist.retention', 'How long is this kept?')}
        </Button>
      </div>

      {/* Reading an export back. It is verified in the browser against the published
          public key and displayed READ-ONLY — never merged into the live history, which
          would corrupt the very record it is supposed to document. */}
      {panel === 'verify' && (
        <Card className="p-3 mb-3">
          <div className="text-xs text-[var(--muted)] mb-2">
            {t('hist.verify.s', 'Pick an exported .json and its .sig.b64. The file is checked here, in your browser, against the published key — it is never uploaded, and nothing is written back into the history.')}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="btn btn-sm cursor-pointer">
              <Upload size={13} /> {t('hist.verify.pick', 'Choose export + signature')}
              <input type="file" multiple accept=".json,.b64,text/plain,application/json" className="hidden"
                onChange={(e) => {
                  const files = [...(e.target.files || [])];
                  const json = files.find((f) => f.name.endsWith('.json'));
                  const sig = files.find((f) => f.name.endsWith('.b64') || f.name.endsWith('.sig'));
                  if (json) verifyFile(json, sig);
                  e.target.value = '';
                }} />
            </label>
            {imported && <Button size="sm" variant="ghost" onClick={() => setImported(null)}>{t('common.close', 'Close')}</Button>}
          </div>
          {imported && (
            <div className="mt-3">
              <div className={`text-xs font-semibold flex items-center gap-1.5 ${imported.valid === true ? 'text-success' : imported.valid === false ? 'text-error' : 'text-warning'}`}>
                {imported.valid === true ? <><ShieldCheck size={13} /> {t('hist.sig.ok', 'Signature valid — this file is exactly what the server produced.')}</>
                  : imported.valid === false ? <><AlertTriangle size={13} /> {t('hist.sig.bad', 'Signature does NOT match. Treat the contents as unverified.')}</>
                  : <><AlertTriangle size={13} /> {t('hist.sig.none', 'No signature file given — contents shown unverified.')}</>}
              </div>
              <div className="text-[11px] text-[var(--faint)] mt-1">
                {imported.name} · {t('hist.imported.meta', 'exported {d} · {n} entries{tr}')
                  .replace('{d}', new Date(imported.doc.exportedAt).toLocaleString())
                  .replace('{n}', String(imported.doc.count ?? (imported.doc.entries || []).length))
                  .replace('{tr}', imported.doc.truncated ? ` · ${t('hist.truncated', 'truncated')}` : '')}
              </div>
              <div className="mt-2 max-h-72 overflow-y-auto rounded-lg border border-[var(--line)]">
                {(imported.doc.entries || []).map((e, i) => (
                  <div key={i} className="px-3 py-1.5 border-b border-[var(--line)] last:border-0 flex items-baseline gap-2 text-xs">
                    <span className="text-[10px] uppercase tracking-wider text-[var(--faint)] w-16 shrink-0">{e.source}</span>
                    <span className="font-medium shrink-0">{e.action}</span>
                    <span className="text-[var(--muted)] truncate flex-1">{e.detail}</span>
                    <span className="text-[10px] text-[var(--faint)] shrink-0">{new Date(e.at).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Retention, told honestly: this view keeps nothing, so it reports the window each
          SOURCE actually has and names who owns it. A single slider here would either do
          nothing or delete another subsystem's data behind its back. */}
      {panel === 'retention' && retention && (
        <Card className="p-3 mb-3">
          <div className="text-xs text-[var(--muted)] mb-2">
            {t('hist.retention.s', 'This view stores nothing of its own — every row is kept for as long as the subsystem that records it keeps it. Change a window where it lives.')}
          </div>
          <div className="divide-y divide-[var(--line)]">
            {retention.sources.map((r) => (
              <div key={r.source} className="flex items-center gap-3 py-1.5 text-xs">
                <span className="w-24 shrink-0 font-medium">{t(`hist.src.${r.source}`, r.source)}</span>
                <span className="w-28 shrink-0 tabular-nums">
                  {r.days > 0 ? t('hist.ret.days', '{n} days').replace('{n}', String(r.days)) : t('hist.ret.keep', 'kept')}
                </span>
                <span className="text-[var(--faint)] truncate flex-1">{r.where}</span>
                {/* Editable in place, for a SUPERADMIN, and only where a setting genuinely
                    owns the window. Writing goes to THAT setting — there is still no
                    "history retention" of our own that could disagree with analytics or with
                    the audit chain. Shortening one destroys evidence, so the people most
                    likely to want it are the ones being audited: hence the rank. */}
                {r.configurable && isSuperAdmin ? (
                  <span className="flex items-center gap-1 shrink-0">
                    <Input type="number" min="0" max="3650" defaultValue={r.days} className="!w-20 !py-1 !text-xs"
                      onKeyDown={(ev) => { if (ev.key === 'Enter') saveRetention(r.source, ev.target.value); }}
                      onBlur={(ev) => { if (Number(ev.target.value) !== r.days) saveRetention(r.source, ev.target.value); }} />
                    <span className="text-[10px] text-[var(--faint)]">{t('hist.ret.d', 'days · 0 = keep')}</span>
                  </span>
                ) : r.configurable
                  ? <Badge tone="primary">{t('hist.ret.cfg', 'configurable')}</Badge>
                  : <Badge>{t('hist.ret.fixed', 'fixed')}</Badge>}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Source chips. All off = all on, which is the reading people expect from an
          empty filter and saves a redundant "All" chip. */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {all.map((src) => {
          const Icon = HIST_ICON[src.key] || Activity; const on = sources.includes(src.key);
          return (
            <button key={src.key} onClick={() => toggle(src.key)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border transition ${on ? 'border-[var(--primary)] bg-[var(--primary)]/12 text-[var(--primary-2)]' : 'border-[var(--line)] text-[var(--muted)] hover:text-[var(--text)]'}`}>
              <Icon size={12} /> {t(`hist.src.${src.key}`, src.label)}
            </button>
          );
        })}
        {sources.length > 0 && <button onClick={() => setSources([])} className="text-xs text-[var(--faint)] underline px-1">{t('hist.clear', 'clear')}</button>}
      </div>

      {loading && !entries.length ? <Loading /> : !entries.length ? (
        <EmptyState icon={History} title={t('hist.none.t', 'Nothing in this window')}
          sub={t('hist.none.s', 'Try a longer window or fewer filters — the range is a window, not the whole history.')} />
      ) : (
        <>
          <Card className="p-0 overflow-hidden">
            {entries.map((e, i) => {
              const Icon = HIST_ICON[e.source] || Activity;
              const key = `${e.source}-${e.at}-${i}`;
              return (
                <div key={key} className="border-b border-[var(--line)] last:border-0">
                {/* The row is the control. The detail used to hide behind a 10px lowercase
                    source label at the far right — a target nobody finds, opening a fold that
                    pushed the rest of the list down. Clicking the row is what everyone tries
                    first, and a modal leaves the list where it was. Links inside stop the
                    click, so "open the account" still means that. */}
                <div role="button" tabIndex={0} onClick={() => setOpen(key)}
                  onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); setOpen(key); } }}
                  className="flex items-start gap-3 px-4 py-2.5 cursor-pointer hover:bg-[var(--surface-2)] transition-colors">
                  <Icon size={14} className={`mt-0.5 shrink-0 ${HIST_TONE[e.source] || ''}`} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm flex flex-wrap items-baseline gap-x-2">
                      <span className="font-medium">{e.action}</span>
                      {e.detail && <span className="text-[var(--muted)] break-all">{e.detail}</span>}
                    </div>
                    <div className="text-[11px] text-[var(--faint)] flex flex-wrap items-center gap-x-2">
                      {/* Either a real account (clickable) or the display label the repo
                          layer recorded — never a bare id pretending to be a name. */}
                      {e.actor
                        ? <Link to={`/u/${e.actor.id}`} className="hover:text-[var(--text)] underline decoration-dotted">{e.actor.displayName}</Link>
                        : e.actorName ? <span>{e.actorName}</span> : <span className="italic">{t('hist.system', 'system')}</span>}
                      <span>·</span>
                      <span>{when(e.at)}</span>
                      {e.ip && <><span>·</span><span className="font-mono">{e.ip}</span></>}
                      {e.link && <><span>·</span><Link to={e.link} className="hover:text-[var(--text)] underline decoration-dotted">{t('hist.open', 'open')}</Link></>}
                    </div>
                  </div>
                  <span className="text-[10px] text-[var(--faint)] uppercase tracking-wider shrink-0">{e.source}</span>
                </div>

                {/* The whole row, unabridged, in a modal. The list shows what fits; this
                    shows what was recorded — ids included, because "settings" with no repo id
                    is a fact you cannot follow up, and copying an id out of here is how the
                    next step (User search, the repo page) actually starts. */}
                {open === key && (
                  <Modal open onClose={() => setOpen(null)} width="max-w-xl"
                    icon={HIST_ICON[e.source] || Activity}
                    title={e.action}>
                    <div className="space-y-3">
                      {e.detail && <div className="text-[13px] break-all whitespace-pre-wrap">{e.detail}</div>}
                      <div className="grid sm:grid-cols-2 gap-x-4 gap-y-1">
                        {[
                          ['when', new Date(e.at).toLocaleString()],
                          ['source', e.source],
                          ['action', e.action],
                          ...(e.actor ? [
                            ['who', `${e.actor.displayName} · ${e.actor.email || ''}`],
                            ['role', e.actor.role || '—'],
                            ['account id', e.actor.id],
                            ...(e.actor.status && e.actor.status !== 'active' ? [['account status', e.actor.status]] : []),
                          ] : e.actorName ? [['who', `${e.actorName} ${t('hist.label', '(recorded label, not an account)')}`]] : [['who', t('hist.system', 'system')]]),
                          ...(e.ip ? [['ip', e.ip]] : []),
                          ...Object.entries(e.meta || {}).filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => [k, String(v)]),
                        ].map(([k, v]) => (
                          <div key={k} className="flex items-baseline gap-2 min-w-0">
                            <span className="text-[10px] uppercase tracking-wider text-[var(--faint)] w-24 shrink-0">{k}</span>
                            <button onClick={() => { copyText(String(v)); toast.success(t('common.copied', 'Copied.')); }}
                              className="text-[12px] font-mono break-all text-left hover:text-[var(--primary-2)] min-w-0"
                              title={t('hist.copy', 'Copy')}>{String(v)}</button>
                          </div>
                        ))}
                      </div>
                      {e.link && <Link to={e.link} className="inline-block text-[12px] text-[var(--primary-2)] hover:underline">{t('hist.open', 'open')}</Link>}
                    </div>
                  </Modal>
                )}
                </div>
              );
            })}
          </Card>
          <div className="flex items-center justify-between mt-3 text-xs text-[var(--faint)]">
            <span>{t('hist.count', 'Showing {n} of {tot} in the last {d} days').replace('{n}', String(entries.length)).replace('{tot}', String(data?.total ?? 0)).replace('{d}', String(days))}</span>
            {data?.hasMore && <Button size="sm" variant="ghost" onClick={() => setTake((v) => v + 60)}>{t('hist.more', 'Show more')}</Button>}
          </div>
        </>
      )}
    </div>
  );
}

// Starting points, not finished emails — every one is meant to be edited before it goes.
// They exist because the blank page is where a broadcast goes wrong: the price-change
// template says the four things the Payments policy promises, in the order the policy
// promises them, so nobody has to remember what those are at 11pm.
const HTTP_URL_RE = /^https?:\/\//i;
const MAIL_TEMPLATES = [
  {
    id: 'price', label: 'Price change', audience: 'hosting',
    subject: 'A change to your {plan} price',
    cta: { label: 'Manage your subscription', url: '/dashboard' },
    body: `Hello,

The monthly price of **{plan}** hosting is changing.

| | Price |
|---|---|
| Today | **$X.XX / month** |
| From {date} | **$Y.YY / month** |

The new price applies from your **next renewal on or after {date}**. It never applies to a period you have already paid for, and never mid-term on a prepaid plan.

If you would rather not continue at the new price, cancel before that renewal — your service runs to the end of the period you have paid.`,
  },
  {
    id: 'maintenance', label: 'Planned maintenance', audience: 'hosting',
    subject: 'Planned maintenance on {date}',
    cta: null,
    body: `Hello,

We will be taking hosting offline for maintenance on **{date}**, starting at **HH:MM UTC**.

Expected downtime is about **X minutes**. Your files and settings are not affected — repositories will simply be unreachable while it runs.

Nothing is required from you.`,
  },
  {
    id: 'incident', label: 'Incident notice', audience: 'all',
    subject: 'What happened on {date}',
    cta: null,
    body: `Hello,

On **{date}** there was a problem with X, lasting about Y.

**What was affected.** …

**What we did.** …

**What we are changing so it does not happen again.** …

Sorry for the disruption.`,
  },
  {
    id: 'feature', label: 'Something new', audience: 'creators',
    subject: 'New: X',
    cta: { label: 'Take a look', url: '/' },
    body: `Hello,

We have added **X**.

- what it does
- why it might matter to you

It is available now — nothing to enable.`,
  },
  {
    id: 'winback', label: 'Win-back', audience: 'lapsed',
    subject: 'Your hosting has been idle',
    cta: { label: 'Start again', url: '/hosting' },
    body: `Hello,

Your hosting with us ended a while ago, and we wanted to say what has changed since.

- …
- …

Everything you had is still yours; picking it back up takes a couple of minutes.`,
  },
];

function AdminMail() {
  const { t } = useI18n(); const toast = useToast(); const dialog = useDialog(); const { user: me } = useAuth();
  const plans = useAsync(() => api.get('/admin/hosting/plans'), []);
  const [audience, setAudience] = useState('hosting');
  const [planId, setPlanId] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [count, setCount] = useState(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);   // { html, preheader }
  const [wide, setWide] = useState(true);         // desktop vs phone width
  // Independent of the dashboard's own theme on purpose: the email is read in the
  // recipient's client, and "how does this look to someone on dark mode" is a question
  // you have to be able to ask without changing your own settings to find out.
  const [scheme, setScheme] = useState('light');  // light | dark
  const [ctaLabel, setCtaLabel] = useState('');
  const [ctaUrl, setCtaUrl] = useState('');

  // The recipient count is refreshed whenever the audience changes, because the number is
  // the last chance to notice that "everyone" is larger than you pictured.
  useEffect(() => {
    if (audience === 'user') { setCount(null); return; }
    let alive = true;
    const q = new URLSearchParams({ audience, ...(planId ? { planId } : {}) });
    api.get(`/admin/mail/audience?${q}`)
      .then((r) => { if (alive) setCount(r.count); })
      .catch(() => { if (alive) setCount(null); });
    return () => { alive = false; };
  }, [audience, planId]);

  // Debounced: the preview is a server round-trip because it must come from the SAME
  // template the send uses, and re-rendering on every keystroke would be a request per
  // character for a panel nobody is reading mid-word.
  useEffect(() => {
    if (!subject.trim() && !body.trim()) { setPreview(null); return; }
    const id = setTimeout(() => {
      api.post('/admin/mail/preview', { subject, body, scheme, cta: ctaLabel.trim() && ctaUrl.trim() ? { label: ctaLabel.trim(), url: ctaUrl.trim() } : null })
        .then(setPreview)
        .catch(() => setPreview(null));
    }, 400);
    return () => clearTimeout(id);
  }, [subject, body, scheme, ctaLabel, ctaUrl]);

  const send = async (testOnly) => {
    if (!subject.trim() || !body.trim()) return toast.error(t('adm.mail.empty', 'Subject and message are required.'));
    if (!testOnly && !await dialog.confirm({
      title: t('adm.mail.confirm.t', 'Send this email?'),
      // The count is in the CONFIRMATION, not just on the form: it is the number that
      // matters and the last moment it can be reconsidered.
      message: t('adm.mail.confirm.m', 'It will be sent to {n} recipient(s), one message each. This cannot be recalled.').replace('{n}', count ?? '?'),
      okLabel: t('adm.mail.send', 'Send'),
    })) return;
    setBusy(true);
    try {
      const r = await api.post('/admin/mail/send', {
        audience, planId: planId || undefined, subject, body, testOnly,
        cta: ctaLabel.trim() && ctaUrl.trim() ? { label: ctaLabel.trim(), url: ctaUrl.trim() } : null,
      });
      toast.success(testOnly
        ? t('adm.mail.tested2', 'Test sent to {email}.').replace('{email}', me?.email || '')
        : t('adm.mail.sent', 'Sent to {n} recipient(s).').replace('{n}', r.sent) + (r.failed ? ` · ${r.failed} failed` : ''));
    } catch (x) {
      toast.error(x.data?.error === 'email_disabled' ? t('adm.mail.off', 'No mail backend is configured.')
        : x.data?.error === 'no_recipients' ? t('adm.mail.norecip', 'That audience is empty.')
        // Not "sent to 0" — nothing went out, and the mail server is why.
        // The server's own words, not a paraphrase. "Rejected every message" sent the
        // admin looking at SMTP settings that were fine; the actual line said the
        // recipient's DOMAIN did not exist — a one-glance fix.
        : x.data?.error === 'all_failed'
          ? t('adm.mail.allfailed', 'Nothing was sent — {reason}')
              .replace('{reason}', x.data?.reason ? `${x.data.email || ''}: ${x.data.reason}` : t('adm.mail.allfailed.generic', 'the mail server rejected every message.'))
        : t('common.failed', 'Failed.'));
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-1"><Mail size={15} className="text-[var(--primary-2)]" /> <span className="font-semibold text-sm">{t('adm.mail.title', 'Email users')}</span></div>
        <p className="text-xs text-[var(--muted)] mb-3">
          {t('adm.mail.sub', 'One message per recipient — nobody sees who else received it. Markdown is supported.')}
        </p>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label={t('adm.mail.f.audience', 'Audience')} hint={count == null ? undefined : t('adm.mail.f.count', '{n} recipient(s)').replace('{n}', count)}>
            <Select value={audience} onChange={(e) => setAudience(e.target.value)}>
              <option value="hosting">{t('adm.mail.aud.hosting', 'Hosting subscribers')}</option>
              <option value="all">{t('adm.mail.aud.all', 'Every account')}</option>
              <option value="verified">{t('adm.mail.aud.verified', 'Verified emails only')}</option>
              <option value="paid">{t('adm.mail.aud.paid', 'Anyone who has ever paid')}</option>
              <option value="lapsed">{t('adm.mail.aud.lapsed', 'Lapsed customers (paid before, nothing live now)')}</option>
              <option value="freehost">{t('adm.mail.aud.freehost', 'Free-tier hosts')}</option>
              <option value="creators">{t('adm.mail.aud.creators', 'Creators (published a repo or an item)')}</option>
              <option value="staff">{t('adm.mail.aud.staff', 'Staff only')}</option>
            </Select>
          </Field>
          {audience === 'hosting' && (
            <Field label={t('adm.mail.f.plan', 'Limit to one plan')} hint={t('adm.mail.f.plan.h', 'Leave on "any" to reach every subscriber.')}>
              <Select value={planId} onChange={(e) => setPlanId(e.target.value)}>
                <option value="">{t('adm.mail.anyplan', 'Any plan')}</option>
                {(plans.data?.plans || []).map((pl) => <option key={pl.id} value={pl.id}>{pl.name}</option>)}
              </Select>
            </Field>
          )}
        </div>
        {/* Templates fill the form and then get out of the way — they set the audience
            too, because "who is this for" is part of the template rather than a separate
            decision made afterwards and got wrong. */}
        <div className="mt-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-1.5">{t('adm.mail.tpl', 'Start from a template')}</div>
          <div className="flex flex-wrap gap-1.5">
            {MAIL_TEMPLATES.map((tpl) => (
              <button key={tpl.id}
                onClick={() => {
                  setSubject(tpl.subject); setBody(tpl.body); setAudience(tpl.audience);
                  setCtaLabel(tpl.cta?.label || '');
                  setCtaUrl(tpl.cta ? new URL(tpl.cta.url, window.location.origin).href : '');
                }}
                className="px-2.5 py-1 rounded-full text-xs border border-[var(--line)] text-[var(--muted)] hover:text-[var(--text)] hover:border-[var(--primary)] transition">
                {t(`adm.mail.tpl.${tpl.id}`, tpl.label)}
              </button>
            ))}
            {(subject || body) && (
              <button onClick={() => { setSubject(''); setBody(''); setCtaLabel(''); setCtaUrl(''); }}
                className="px-2.5 py-1 rounded-full text-xs text-[var(--faint)] underline">{t('adm.mail.tpl.clear', 'clear')}</button>
            )}
          </div>
          <p className="text-[11px] text-[var(--faint)] mt-1">{t('adm.mail.tpl.note', 'A starting point, not a finished email — the placeholders are yours to replace.')}</p>
        </div>

        <div className="mt-3 space-y-3">
          <Field label={t('adm.mail.f.subject', 'Subject')}><Input value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>
          <Field label={t('adm.mail.f.body', 'Message (markdown)')}>
            <Textarea rows={10} value={body} onChange={(e) => setBody(e.target.value)}
              placeholder={t('adm.mail.f.body.ph', 'What changed, when it takes effect, and what they can do about it.')} />
          </Field>
          {/* Optional button. Both halves or neither: a label with no link renders
              nothing, and a link with no label is not a button. */}
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label={t('adm.mail.f.ctalabel', 'Button label (optional)')}>
              <Input value={ctaLabel} onChange={(e) => setCtaLabel(e.target.value)} maxLength={60}
                placeholder={t('adm.mail.f.ctalabel.ph', 'e.g. Manage your subscription')} />
            </Field>
            <Field label={t('adm.mail.f.ctaurl', 'Button link')}
              hint={ctaLabel.trim() && !HTTP_URL_RE.test(ctaUrl.trim()) ? t('adm.mail.f.ctaurl.h', 'Needs a full https:// address.') : undefined}>
              <Input value={ctaUrl} onChange={(e) => setCtaUrl(e.target.value)} maxLength={500} placeholder="https://bettercommunity.ch/…" />
            </Field>
          </div>
        </div>
        {/* The preview. In an iframe with `sandbox` and no allow-scripts: the document is
            a full <html> with its own <head>, so it cannot be dropped into the page, and
            it is admin-authored HTML that has no business running anything here. srcdoc
            rather than a blob URL so there is nothing to revoke and nothing to leak. */}
        {preview && (
          <div className="mt-4">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <span className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] flex items-center gap-1.5">
                <Eye size={12} /> {t('adm.mail.preview', 'Preview')}
              </span>
              <div className="flex items-center gap-2">
                {/* Forced SERVER-side, not by a class on the iframe: inside an iframe the
                    email's own prefers-color-scheme query follows the OS, so a toggle here
                    could otherwise only ever show whichever mode the admin is already in.
                    The server emits the same declarations either way, so the preview is
                    still the real thing. */}
                <div className="flex rounded-lg border border-[var(--line)] overflow-hidden">
                  <button onClick={() => setScheme('light')} className={`px-2 py-1 text-xs ${scheme === 'light' ? 'bg-[var(--surface-2)] text-[var(--text)]' : 'text-[var(--muted)]'}`} title={t('adm.mail.light', 'Light')}><Sun size={12} /></button>
                  <button onClick={() => setScheme('dark')} className={`px-2 py-1 text-xs ${scheme === 'dark' ? 'bg-[var(--surface-2)] text-[var(--text)]' : 'text-[var(--muted)]'}`} title={t('adm.mail.dark', 'Dark')}><Moon size={12} /></button>
                </div>
                <div className="flex rounded-lg border border-[var(--line)] overflow-hidden">
                  <button onClick={() => setWide(true)} className={`px-2 py-1 text-xs ${wide ? 'bg-[var(--surface-2)] text-[var(--text)]' : 'text-[var(--muted)]'}`}><MonitorIcon size={12} /></button>
                  <button onClick={() => setWide(false)} className={`px-2 py-1 text-xs ${!wide ? 'bg-[var(--surface-2)] text-[var(--text)]' : 'text-[var(--muted)]'}`}><Smartphone size={12} /></button>
                </div>
              </div>
            </div>
            {/* The inbox line, shown as the inbox shows it: subject then preheader. It is
                derived from the body rather than typed, so it is exactly the part of the
                email an author never thinks to check. */}
            <div className="rounded-t-xl border border-[var(--line)] border-b-0 px-3 py-2 bg-[var(--surface-2)]/40">
              <div className="text-sm font-medium truncate">{subject || t('adm.mail.nosubject', '(no subject)')}</div>
              <div className="text-xs text-[var(--faint)] truncate">{preview.preheader || '—'}</div>
            </div>
            {/* The backdrop follows the pinned scheme too, or a dark email floats on a
                white page and reads as broken rather than as dark. */}
            <div className={`rounded-b-xl border border-[var(--line)] overflow-hidden flex justify-center ${scheme === 'dark' ? 'bg-[#0a0907]' : 'bg-white'}`}>
              <iframe
                title="mail-preview"
                sandbox=""
                srcDoc={preview.html}
                className="w-full"
                style={{ maxWidth: wide ? '100%' : 380, height: 520, border: 0, display: 'block' }}
              />
            </div>
            <p className="text-[11px] text-[var(--faint)] mt-1">
              {t('adm.mail.preview.note', 'Rendered by the same template the send uses. Real clients (Gmail, Outlook) strip some CSS — send yourself a test before a broadcast.')}
            </p>
          </div>
        )}

        <div className="flex gap-2 mt-4">
          {/* Test first, deliberately the LEFT button: reading your own email is the only
              proof that the markdown, the links and the tone survived. */}
          <Button size="sm" disabled={busy} onClick={() => send(true)}>{t('adm.mail.test', 'Send a test to me')}</Button>
          <Button size="sm" variant="primary" disabled={busy || !subject.trim() || !body.trim()} onClick={() => send(false)}>
            {t('adm.mail.send', 'Send')}{count != null ? ` · ${count}` : ''}
          </Button>
        </div>
      </Card>
    </div>
  );
}

function AdminHostingPlans() {
  const { t } = useI18n(); const toast = useToast(); const dialog = useDialog();
  const data = useAsync(() => api.get('/admin/hosting/plans'), []);
  // Every write here goes through the undo window the rest of the dashboard uses: the
  // request is held for six seconds and only then sent, so "undo" means the change never
  // reached the server at all. That matters more on this tab than most — these rows are
  // prices, and a mistyped one is visible on the pricing page the moment it lands.
  //
  // NOT applied to a SCHEDULED change: that one emails every subscriber as it is created,
  // and an email cannot be recalled six seconds later. It confirms up front instead, and
  // the row's own "cancel" is the way back.
  const undoable = useUndoableSave(() => data.reload());
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState(null);   // the row being edited, or a new one
  const [original, setOriginal] = useState(null); // the same row BEFORE the edit

  // priceMonthlyCents starts EMPTY, not 0. Empty means "use the Hosting settings rate";
  // zero would mean "free", and a new plan defaulting to free is the wrong accident.
  const blank = { name: '', storageGB: 5, uploadLimitKbps: 1024, cpuShare: 0.25, priceMonthlyCents: '', active: true };
  // Default notice period. 30 days is what the Payments policy describes, and a default
  // is what makes "give notice" the easy path rather than the conscientious one.
  const in30Days = () => { const d = new Date(); d.setDate(d.getDate() + 30); return d.toISOString().slice(0, 10); };
  // Local date, not toISOString(): the ISO form is UTC, so west of Greenwich "today"
  // renders as yesterday and the field would open on a date its own `min` rejects.
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const [effective, setEffective] = useState('');   // '' = change the price with nobody told
  const [applyExisting, setApplyExisting] = useState(false); // false = grandfather
  // "The price moved" is the trigger for everything below, so it is computed once and in
  // cents — comparing the raw strings would call "500" and "500 " a change.
  const [auto, setAuto] = useState(null);   // what the settings would charge for these specs
  const money = (c) => `$${(c / 100).toFixed(2)}`;
  const mbps = (k) => `${(k / 1024).toFixed(1)} Mbps`;
  const priceMoved = !!draft?.id && original != null
    && draft.priceMonthlyCents !== '' && draft.priceMonthlyCents != null
    && Number(draft.priceMonthlyCents) !== Number(original.priceMonthlyCents);

  const save = async () => {
    // EVERYTHING goes through the undo window now, scheduling included.
    //
    // It used to take the direct path with a comment explaining why: scheduling emails
    // every subscriber the moment it is created, and an email cannot be recalled six
    // seconds later. But that reasoning had it backwards — the fix is not to skip the
    // window, it is to not send the mail until the window closes. The PATCH is what
    // triggers the announcement, so deferring the PATCH defers the announcement, and
    // Cancel means no price was staged and nobody was written to.
    return saveDeferred();
  };

  const cancelPending = async (pl) => {
    if (!await dialog.confirm({
      title: t('adm.plans.pending.t', 'Cancel the announced change?'),
      message: t('adm.plans.pending.m', 'The price never moved, so there is nothing to undo — but everyone who was told it would change gets a second email saying it will not.'),
      okLabel: t('adm.plans.pending.ok', 'Cancel it'),
    })) return;
    try { const r = await api.del(`/admin/hosting/plans/${pl.id}/pending-price`); data.reload(); toast.success(t('adm.plans.pending.done', 'Cancelled — {n} told.').replace('{n}', r.notified ?? 0)); }
    catch { toast.error(t('common.failed', 'Failed.')); }
  };

  // The deferred path: build the request, show the toast, and only fire on commit.
  const saveDeferred = () => {
    const body = {
      name: draft.name, storageGB: Number(draft.storageGB), uploadLimitKbps: Number(draft.uploadLimitKbps),
      cpuShare: Number(draft.cpuShare), active: !!draft.active,
      priceMonthlyCents: draft.priceMonthlyCents === '' || draft.priceMonthlyCents == null
        ? null : Number(draft.priceMonthlyCents),
    };
    const id = draft.id;
    const label = draft.name;
    // A date only means something on an EXISTING plan whose price actually moved. Sent
    // otherwise it would stage a change from a price to itself and mail everyone about
    // nothing.
    const moved = !!id && original != null
      && body.priceMonthlyCents != null
      && Number(body.priceMonthlyCents) !== Number(original.priceMonthlyCents);
    const scheduling = !!(effective && moved);
    const payload = scheduling
      ? { ...body, effectiveAt: new Date(`${effective}T00:00:00`).toISOString(), applyToExisting: applyExisting }
      : body;
    const whenLabel = effective;
    const toExisting = applyExisting;
    setDraft(null); setEffective(''); setApplyExisting(false);
    undoable(
      async () => {
        const r = id ? await api.patch(`/admin/hosting/plans/${id}`, payload) : await api.post('/admin/hosting/plans', payload);
        // The count of who was actually written to is only known once the request has
        // run, so it is reported here rather than promised in the toast beforehand.
        if (scheduling) {
          toast.success(toExisting
            ? t('adm.plans.scheduled', 'Change scheduled for {d} — {n} subscriber(s) notified.').replace('{d}', whenLabel).replace('{n}', r?.notified ?? 0)
            : t('adm.plans.schedulednew', 'Scheduled for {d} — new buyers only, so nobody was emailed.').replace('{d}', whenLabel));
        }
      },
      scheduling
        // Says what is about to happen, including that mail has NOT gone out yet — the
        // reason Cancel is still meaningful at this point.
        ? t('adm.plans.schedundo', 'Scheduling “{n}” for {d}. Subscribers are emailed when this window closes.').replace('{n}', label).replace('{d}', whenLabel)
        : id ? t('adm.plans.savedundo', 'Saved “{n}”.').replace('{n}', label)
             : t('adm.plans.createdundo', 'Created “{n}”.').replace('{n}', label),
      // Longer than the usual six seconds: this one sends mail to real people, and the
      // moment to change your mind should outlast the moment you notice you should.
      { duration: 12000 },
    );
  };

  const remove = async (pl) => {
    if (!await dialog.confirm({
      title: t('adm.plans.del.t', 'Delete this plan?'),
      message: t('adm.plans.del.m', 'Only possible while nobody is subscribed to it. To retire a plan people already bought, switch it off instead — that hides it from the pricing page and leaves their terms untouched.'),
      okLabel: t('common.delete', 'Delete'), danger: true,
    })) return;
    undoable(
      () => api.del(`/admin/hosting/plans/${pl.id}`),
      t('adm.plans.deletedundo', 'Deleted “{n}”.').replace('{n}', pl.name),
      {
        errorFor: (x) => (x?.data?.error === 'plan_in_use'
          ? t('adm.plans.inuse', 'In use by {n} subscription(s) — switch it off instead.').replace('{n}', x.data.subscriptions)
          : null),
      },
    );
  };

  // Ask the server what these specs cost, so the placeholder shows the real number instead
  // of a promise. Re-asked whenever a spec changes, because that is what the price follows.
  useEffect(() => {
    if (!draft) { setAuto(null); return; }
    const q = new URLSearchParams({ storageGB: draft.storageGB || 0, uploadLimitKbps: draft.uploadLimitKbps || 0, cpuShare: draft.cpuShare || 0 });
    let alive = true;
    api.get(`/admin/hosting/plans/auto-price?${q}`)
      .then((r) => { if (alive) setAuto(r.priceMonthlyCents); })
      .catch(() => { if (alive) setAuto(null); });
    return () => { alive = false; };
  }, [draft?.storageGB, draft?.uploadLimitKbps, draft?.cpuShare, !!draft]);

  if (data.loading) return <Loading />;
  const plans = data.data?.plans || [];

  return (
    <div className="space-y-4">
      <Card className="p-4 flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm">{t('adm.plans.title', 'Hosting plans')}</div>
          <p className="text-xs text-[var(--muted)]">
            {t('adm.plans.sub', 'What the pricing page offers. Editing a price never reprices an existing subscription — it changes what new buyers see.')}
          </p>
        </div>
        <Button size="sm" variant="primary" onClick={() => { setDraft({ ...blank }); setOriginal(null); setEffective(''); }}><Plus size={14} /> {t('adm.plans.new', 'New plan')}</Button>
      </Card>

      {draft && (
        <Card className="p-4 space-y-3">
          <div className="text-sm font-semibold">{draft.id ? t('adm.plans.edit', 'Edit plan') : t('adm.plans.new', 'New plan')}</div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <Field label={t('adm.plans.f.name', 'Name')}><Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
            <Field label={t('adm.plans.f.storage', 'Storage (GB)')}><Input type="number" min="0" value={draft.storageGB} onChange={(e) => setDraft({ ...draft, storageGB: e.target.value })} /></Field>
            <Field label={t('adm.plans.f.upload', 'Upload cap (kbps)')} hint={mbps(Number(draft.uploadLimitKbps) || 0)}><Input type="number" min="0" value={draft.uploadLimitKbps} onChange={(e) => setDraft({ ...draft, uploadLimitKbps: e.target.value })} /></Field>
            <Field label={t('adm.plans.f.cpu', 'CPU share')}><Input type="number" step="0.05" min="0" value={draft.cpuShare} onChange={(e) => setDraft({ ...draft, cpuShare: e.target.value })} /></Field>
            {/* Cents, not dollars: money in floats is how a $9.99 plan quietly becomes
                $9.98999. The hint shows what the buyer will read. */}
            <Field
              label={t('adm.plans.f.price', 'Price (cents / month)')}
              hint={draft.priceMonthlyCents === '' || draft.priceMonthlyCents == null
                ? (auto == null ? t('adm.plans.f.priceauto', 'Leave empty to use the Hosting settings rate.') : t('adm.plans.f.priceautoval', 'Empty → {p}/mo from Hosting settings.').replace('{p}', money(auto)))
                : money(Number(draft.priceMonthlyCents) || 0)}
            >
              <Input type="number" min="0" value={draft.priceMonthlyCents ?? ''}
                placeholder={auto == null ? t('adm.plans.f.priceph', 'auto') : `${t('adm.plans.f.priceph', 'auto')} · ${money(auto)}`}
                onChange={(e) => setDraft({ ...draft, priceMonthlyCents: e.target.value })} />
            </Field>
            <Field label={t('adm.plans.f.active', 'Shown on the pricing page')}>
              <Select value={draft.active ? 'yes' : 'no'} onChange={(e) => setDraft({ ...draft, active: e.target.value === 'yes' })}>
                <option value="yes">{t('common.yes', 'Yes')}</option>
                <option value="no">{t('common.no', 'No')}</option>
              </Select>
            </Field>
          </div>

          {/* Appears only once the price has actually been changed on an EXISTING plan —
              the only situation where "when does this start" is a real question. A new
              plan has no subscribers to notify, and a correction to a plan nobody holds
              should just take effect. */}
          {priceMoved && (
            <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)]/40 p-3 space-y-2">
              <div className="text-sm font-medium flex items-center gap-2">
                <Calendar size={14} className="text-[var(--primary-2)]" /> {t('adm.plans.eff.t', 'When does the new price start?')}
              </div>
              <p className="text-xs text-[var(--muted)]">
                {t('adm.plans.eff.s', 'Pick a date and every current subscriber is emailed now; the price changes on that day and applies from their next renewal. Leave it empty to change the price immediately — right for a correction, wrong for a rise on a plan people are paying for.')}
              </p>
              {/* Who it hits. Two radio-style choices rather than a checkbox, because
                  "leave existing customers alone" is a real, deliberate answer and not
                  simply the absence of the other one. Grandfathering is first and is the
                  default: it is what the payment model already does, since every Stripe
                  subscription is pinned to the price it was bought at. */}
              <div className="grid sm:grid-cols-2 gap-2">
                {[[false, t('adm.plans.who.new', 'New buyers only'), t('adm.plans.who.new.s', 'Everyone already subscribed keeps the price they signed up at, for as long as they stay. Nobody is emailed — nothing changes for them.')],
                  [true, t('adm.plans.who.all', 'Existing subscribers too'), t('adm.plans.who.all.s', 'Their Stripe subscription moves to the new amount on that date, starting at their next renewal — never mid-term. Every one of them is emailed now.')]].map(([val, label, sub]) => (
                  <button key={String(val)} onClick={() => setApplyExisting(val)}
                    className={`text-left rounded-lg border p-2.5 transition ${applyExisting === val ? 'border-[var(--primary)] bg-[var(--primary)]/10' : 'border-[var(--line)] hover:border-[var(--line-strong)]'}`}>
                    <div className="text-xs font-semibold flex items-center gap-1.5">
                      {applyExisting === val ? <Check size={12} className="text-[var(--primary-2)]" /> : <span className="w-3" />}
                      {label}
                    </div>
                    <div className="text-[11px] text-[var(--muted)] mt-0.5">{sub}</div>
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {/* min is TODAY, not tomorrow. "Now" is a legitimate answer — a correction,
                    or a rise the customers have already been told about elsewhere — and
                    forbidding it only pushed admins onto the empty-date path, which is the
                    one that tells nobody. */}
                <Input type="date" className="!w-44" value={effective} min={today()}
                  onChange={(e) => setEffective(e.target.value)} />
                <Button size="sm" variant={effective === today() ? 'primary' : 'ghost'} onClick={() => setEffective(today())}>
                  {t('adm.plans.eff.today', 'Today')}
                </Button>
                <Button size="sm" variant={effective && effective !== today() ? 'primary' : 'ghost'} onClick={() => setEffective(in30Days())}>
                  {t('adm.plans.eff.30', '30 days from now')}
                </Button>
                {!effective && <span className="text-xs text-warning">{t('adm.plans.eff.warn', 'No date: the price changes on save, with nobody told.')}</span>}
              </div>
              {effective === today() && (
                <p className="text-xs text-[var(--muted)]">
                  {applyExisting
                    ? t('adm.plans.eff.todaymsg.all', 'Saving puts the new price in force straight away. Everyone subscribed moves to it at their NEXT renewal — never mid-term — and is emailed now.')
                    : t('adm.plans.eff.todaymsg.new', 'Saving puts the new price in force straight away, for new buyers. Everyone already subscribed keeps what they pay, and nobody is emailed.')}
                </p>
              )}
            </div>
          )}
          <div className="flex gap-2">
            <Button size="sm" variant="primary" disabled={busy || !draft.name} onClick={save}>{t('common.save', 'Save')}</Button>
            <Button size="sm" disabled={busy} onClick={() => { setDraft(null); setEffective(''); }}>{t('common.cancel', 'Cancel')}</Button>
          </div>
        </Card>
      )}

      {!plans.length ? <EmptyState icon={HardDrive} title={t('adm.plans.none', 'No plans')} sub={t('adm.plans.nonesub', 'Nothing is on sale — the pricing page will be empty.')} /> : (
        <Card className="p-0 overflow-hidden">
          {plans.map((pl) => (
            <div key={pl.id} className={`flex items-center gap-3 px-4 py-3 border-b border-[var(--line)] last:border-0 ${pl.active ? '' : 'opacity-60'}`}>
              <HardDrive size={15} className="text-[var(--primary-2)] shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate flex items-center gap-2">
                  {pl.name}
                  {!pl.active && <Badge>{t('adm.plans.hidden', 'hidden')}</Badge>}
                  {pl.priceMonthlyCents === 0 && <Badge tone="success">{t('adm.plans.free', 'free')}</Badge>}
                </div>
                <div className="text-[11px] text-[var(--faint)] font-mono">
                  {pl.storageGB} GB · {mbps(pl.uploadLimitKbps)} · CPU {pl.cpuShare} · {money(pl.priceMonthlyCents)}/mo
                </div>
                {/* A change that has been PROMISED to customers is not an editor detail —
                    it is a commitment with a date on it, so it belongs on the row. */}
                {pl.pendingPriceCents != null && (
                  <div className="text-[11px] text-[var(--primary-2)] flex items-center gap-1.5 mt-0.5">
                    <Calendar size={11} />
                    {(pl.pendingApplyExisting
                      ? t('adm.plans.pending', '{p}/mo from {d} · {n} notified')
                      : t('adm.plans.pendingnew', '{p}/mo from {d} · new buyers only'))
                      .replace('{p}', money(pl.pendingPriceCents))
                      .replace('{d}', String(pl.pendingPriceAt || '').slice(0, 10))
                      .replace('{n}', String(pl.pendingNoticeCount ?? 0))}
                    <button className="underline hover:text-[var(--text)]" onClick={() => cancelPending(pl)}>
                      {t('adm.plans.pending.cancel', 'cancel')}
                    </button>
                  </div>
                )}
              </div>
              <div className="text-[11px] text-[var(--faint)] shrink-0">
                {(pl._count?.subscriptions ?? 0)} {t('adm.plans.subs', 'sub(s)')}
              </div>
              <Button size="sm" variant="ghost" onClick={() => { setDraft({ ...pl }); setOriginal(pl); setEffective(today()); }}><SettingsIcon size={13} /></Button>
              <Button size="sm" variant="ghost" className="!text-error" onClick={() => remove(pl)}><Trash2 size={13} /></Button>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

function AdminFreeHost() {
  const toast = useToast(); const { t } = useI18n();
  const plans = useAsync(() => api.get('/hosting/plans'), []);
  const [f, setF] = useState({ name: '', ownerEmail: '', planId: '', storageGB: 10, uploadMbps: 8, listed: false, mode: 'multi' });
  const [custom, setCustom] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (f.name.length < 2) return toast.error(t('fh.namereq', 'Repo name is required.'));
    setBusy(true);
    try {
      const body = { name: f.name, listed: f.listed, mode: f.mode };
      if (f.ownerEmail) body.ownerEmail = f.ownerEmail;
      if (custom) { body.storageGB = Number(f.storageGB); body.uploadMbps = Number(f.uploadMbps); }
      else if (f.planId) body.planId = f.planId;
      await api.post('/admin/repos/host', body);
      toast.success((f.mode === 'multi' ? t('fh.provmulti', 'Multi-repo pool "{name}" provisioned.') : t('fh.provsingle', 'Hosted repo "{name}" provisioned. See it under Server repos.')).replace('{name}', f.name));
      setF({ name: '', ownerEmail: '', planId: '', storageGB: 10, uploadMbps: 8, listed: false, mode: 'multi' });
    } catch (x) { toast.error(x.data?.error === 'user_not_found' ? t('fh.usernotfound', 'No user with that email.') : x.data?.error || t('common.failed', 'Failed.')); } finally { setBusy(false); }
  };
  return (
    <div>
      <h2 className="font-semibold mb-1 flex items-center gap-2"><Rocket size={16} className="text-[var(--primary-2)]" /> {t('fh.title2', 'Free hosting (storage pool)')}</h2>
      <p className="text-sm text-[var(--muted)] mb-4">{t('fh.sub2', 'Provisions a storage pool directly — no payment — that the owner fills with repos and catalogs. Leave the email blank to host it under your own account.')}</p>
      <Card className="p-5 space-y-3">
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label={t('fh.poolname', 'Pool name')}><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="official-server-repo" /></Field>
          <Field label={t('fh.owneremail', 'Owner email (optional)')}><Input value={f.ownerEmail} onChange={(e) => setF({ ...f, ownerEmail: e.target.value })} placeholder="you@…" /></Field>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <button onClick={() => setCustom(false)} className={`px-3 py-1.5 rounded-lg border ${!custom ? 'border-[var(--primary)] bg-orange-500/10' : 'border-[var(--line)] text-[var(--muted)]'}`}>{t('fh.useplan', 'Use a plan')}</button>
          <button onClick={() => setCustom(true)} className={`px-3 py-1.5 rounded-lg border ${custom ? 'border-[var(--primary)] bg-orange-500/10' : 'border-[var(--line)] text-[var(--muted)]'}`}>{t('fh.customsize', 'Custom size')}</button>
        </div>
        {custom ? (
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label={t('fh.storage', 'Storage (GB)')}><Input type="number" value={f.storageGB} onChange={(e) => setF({ ...f, storageGB: e.target.value })} /></Field>
            <Field label={t('fh.upload', 'Upload (Mbps)')}><Input type="number" value={f.uploadMbps} onChange={(e) => setF({ ...f, uploadMbps: e.target.value })} /></Field>
          </div>
        ) : (
          <Field label={t('fh.plan', 'Plan')}><Select value={f.planId} onChange={(e) => setF({ ...f, planId: e.target.value })}>
            <option value="">{t('fh.selectplan', 'Select a plan…')}</option>
            {(plans.data?.plans || []).map((pl) => <option key={pl.id} value={pl.id}>{pl.name} — {pl.storageGB}GB</option>)}
          </Select></Field>
        )}
        <label className="flex items-center gap-2 text-sm text-[var(--muted)]"><input type="checkbox" checked={f.listed} onChange={(e) => setF({ ...f, listed: e.target.checked })} /> {t('fh.listpub', 'List publicly once verified')}</label>
        <div className="flex justify-end"><Button variant="primary" disabled={busy} onClick={submit}>{busy ? <Spinner /> : <><Rocket size={15} /> {t('fh.provision', 'Provision (free)')}</>}</Button></div>
      </Card>
    </div>
  );
}

// The rail's own key list (allKeys, below) gained 'developers' and this table did not, so
// selecting that project read PROJ_META['developers'] → undefined → `M.icon` threw and the
// whole tab rendered as the error boundary.
const PROJ_META = { community: { icon: Package, name: 'Community' }, bmm: { icon: Boxes, name: 'BMM' }, bsm: { icon: Music2, name: 'BSM' }, installer: { icon: Download, name: 'Installer' }, developers: { icon: Code2, name: 'Developers' } };
// …and a fallback, because a hardcoded table that has to cover a list maintained somewhere
// else will fall behind it again. Missing metadata should cost a generic icon, not the page.
const projMeta = (key) => PROJ_META[key] || { icon: Package, name: key };
// Admin: host platform assets — app installers (BMM/BSM/BI), auto-update manifests, and the
// JSON configs (links.json / contributors.json) served at stable /api/assets/<key> URLs the
// apps point at (BCWEB-first, GitHub + local as fallbacks).
const ASSET_SLOTS = [
  { key: 'bmm-installer', kind: 'file', label: 'BMM installer' },
  { key: 'bsm-installer', kind: 'file', label: 'BSM installer' },
  { key: 'bi-installer', kind: 'file', label: 'BetterInstaller' },
  { key: 'bmm-update-manifest', kind: 'json', label: 'BMM update manifest' },
  // The two files BetterInstaller's updater reads. installer.toml lists these exact URLs as
  // mirrors, so filling both slots is what stops GitHub being a single point of failure for
  // updating BMM. Upload Release/update.json and Release/bmm.bpkg from a release build.
  { key: 'bmm-update-json', kind: 'json', label: 'BMM update.json (BetterInstaller)' },
  { key: 'bmm-bpkg', kind: 'file', label: 'BMM package (.bpkg)' },
  { key: 'links.json', kind: 'json', label: 'links.json' },
  { key: 'contributors.json', kind: 'json', label: 'contributors.json' },
];
function AdminAssets() {
  const toast = useToast(); const dialog = useDialog(); const { t } = useI18n();
  const { data, loading, reload } = useAsync(() => api.get('/admin/assets'), []);
  const assetsAll = data?.assets || [];
  const [newKey, setNewKey] = useState(''); const [newKind, setNewKind] = useState('file');
  const [editJson, setEditJson] = useState({}); // { [key]: draftString }
  const [busy, setBusy] = useState('');
  const fileRefs = useRef({});
  // A brand-new key has no hidden <input> yet — those exist only for ASSET_SLOTS and for assets
  // that already exist. createNew used to click fileRefs.current[key], which is undefined for a
  // custom key, so `?.click()` silently did nothing: the picker never opened and the field was
  // cleared, making it look as though a custom key was refused. One dedicated input fixes it.
  const newFileRef = useRef(null);
  const [pendingKey, setPendingKey] = useState('');
  // assetsAll, not the filtered list: a key whose delete is still inside the undo window has NOT
  // left the server yet, so offering to create it again would race the pending DELETE.
  const has = (k) => assetsAll.some((a) => a.key === k);
  const publicUrl = (k) => `${location.origin}/api/assets/${k}`;

  const saveJson = async (key, label) => {
    let parsed; try { parsed = JSON.parse(editJson[key] ?? '{}'); } catch { return toast.error(t('assets.badjson', 'Invalid JSON.')); }
    setBusy(key);
    try { await api.put(`/admin/assets/json/${encodeURIComponent(key)}`, { label, json: parsed }); toast.success(t('assets.saved', 'Saved.')); setEditJson((s) => { const n = { ...s }; delete n[key]; return n; }); reload(); }
    catch (x) { toast.error(x.data?.error || t('common.failed', 'Failed.')); } finally { setBusy(''); }
  };
  const pickFile = async (key, label, file) => {
    if (!file) return;
    setBusy(key);
    try {
      const meta = await uploadAsset(key, file);
      await api.put(`/admin/assets/file/${encodeURIComponent(key)}`, { ...meta, label });
      toast.success(t('assets.uploaded', 'Uploaded “{n}”.').replace('{n}', file.name)); reload();
    } catch (x) { toast.error(x.data?.error || t('assets.uploadfail', 'Upload failed.')); } finally { setBusy(''); }
  };
  // Delete through the shared undo window rather than a confirm dialog — useUndoableDelete is
  // what the rest of this page uses, so the asset list behaves like every other admin list: the
  // row goes immediately, the DELETE only fires when the window closes, and Undo means the
  // server was never touched.
  const undo = useUndoableDelete(reload);
  const assets = assetsAll.filter((a) => !undo.pending.has(a.key));
  const del = (a) => undo.del(a.key, () => api.del(`/admin/assets/${encodeURIComponent(a.key)}`),
    t('assets.deleted', 'Deleted “{k}”.').replace('{k}', a.key));

  const createNew = async () => {
    const key = newKey.trim();
    if (!/^[a-zA-Z0-9._-]{1,64}$/.test(key)) return toast.error(t('assets.badkey', 'Key: letters, numbers, . _ - only.'));
    if (has(key)) return toast.error(t('assets.exists', 'That key already exists.'));
    if (newKind === 'json') { setEditJson((s) => ({ ...s, [key]: '{\n  \n}' })); await api.put(`/admin/assets/json/${encodeURIComponent(key)}`, { json: {} }).then(reload).catch(() => {}); }
    else { setPendingKey(key); newFileRef.current?.click(); return; }   // keep newKey until the file lands
    setNewKey('');
  };

  if (loading) return <Loading />;
  return (
    <div>
      <h2 className="font-semibold mb-1 flex items-center gap-2"><Download size={16} className="text-[var(--primary-2)]" /> {t('assets.title', 'Downloads & assets')}</h2>
      <p className="text-sm text-[var(--muted)] mb-4">{t('assets.sub', 'Host app installers, auto-update manifests and the JSON configs (links.json, contributors.json) at stable /api/assets/<key> URLs. The apps read BCWEB first, then GitHub, then their bundled copy.')}</p>

      {/* Quick-create the standard slots that don't exist yet. */}
      <div className="flex flex-wrap gap-2 mb-4">
        {ASSET_SLOTS.filter((sl) => !has(sl.key)).map((sl) => (
          // bg-[var(--surface-2)]: these had a dashed border and NO background, so with
          // "Translucent surfaces" on they sat straight on the animated page backdrop and the
          // label became unreadable. A themed surface token is the fix — it follows the glass
          // setting like every other surface instead of ignoring it (never hardcode a
          // translucent/solid background here; that's what broke .input once).
          <button key={sl.key} onClick={() => { setNewKey(sl.key); setNewKind(sl.kind); }} className="text-xs px-2.5 py-1 rounded-lg border border-dashed border-[var(--line)] bg-[var(--surface-2)] text-[var(--muted)] hover:border-[var(--primary-2)] hover:text-[var(--text)]">
            <Plus size={11} className="inline mr-1" />{sl.label}
          </button>
        ))}
      </div>

      {/* New asset. */}
      <Card className="p-3 mb-4 flex flex-wrap items-end gap-2">
        <Field label={t('assets.key', 'Key (public slug)')}><Input value={newKey} onChange={(e) => setNewKey(e.target.value)} placeholder="bmm-installer" className="!w-56" /></Field>
        <Field label={t('assets.kind', 'Type')}><Select value={newKind} onChange={(e) => setNewKind(e.target.value)} className="!w-auto"><option value="file">{t('assets.file', 'File')}</option><option value="json">{t('assets.json', 'JSON')}</option></Select></Field>
        <Button variant="primary" onClick={createNew}><Plus size={14} /> {t('assets.create', 'Create / upload')}</Button>
        {ASSET_SLOTS.map((sl) => <input key={sl.key} ref={(el) => (fileRefs.current[sl.key] = el)} type="file" className="hidden" onChange={(e) => { pickFile(sl.key, sl.label, e.target.files?.[0]); e.target.value = ''; }} />)}
        {/* The one input a custom key uses. Cleared and reset after the pick either way, so
            choosing the same file twice in a row still fires a change event. */}
        <input ref={newFileRef} type="file" className="hidden" onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f && pendingKey) { pickFile(pendingKey, '', f); setNewKey(''); }
          setPendingKey('');
        }} />
      </Card>

      {assets.length === 0 ? <EmptyState icon={Download} title={t('assets.none', 'No assets yet')} sub={t('assets.none.s', 'Create one above or pick a standard slot.')} /> : (
        <div className="space-y-2.5">
          {assets.map((a) => (
            <Card key={a.key} className="p-3.5">
              <div className="flex items-center gap-2 flex-wrap mb-2">
                {a.kind === 'json' ? <FileJson size={15} className="text-info" /> : <Package size={15} className="text-[var(--primary-2)]" />}
                <span className="font-mono text-sm font-medium">{a.key}</span>
                {a.label && <span className="text-xs text-[var(--faint)]">{a.label}</span>}
                <Badge tone="">{a.kind}</Badge>
                {a.version && <Badge tone="primary">v{a.version}</Badge>}
                <div className="flex-1" />
                <button onClick={() => { navigator.clipboard?.writeText(publicUrl(a.key)); toast.success(t('common.copied', 'Copied.')); }} className="text-[11px] font-mono text-[var(--faint)] hover:text-[var(--primary-2)] inline-flex items-center gap-1" title={publicUrl(a.key)}><Copy size={11} /> {t('assets.copyurl', 'Copy URL')}</button>
                <button onClick={() => del(a)} className="p-1.5 rounded-lg text-error hover:bg-error-bg"><Trash2 size={13} /></button>
              </div>
              {a.kind === 'file' ? (
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-[var(--muted)]">{a.filename || '—'} {a.size > 0 && <span className="text-[var(--faint)]">· {(a.size / 1048576).toFixed(1)} MB</span>}</span>
                  <a href={publicUrl(a.key)} target="_blank" rel="noreferrer"><Button size="sm" variant="ghost"><Download size={13} /> {t('assets.download', 'Download')}</Button></a>
                  <input ref={(el) => (fileRefs.current[a.key] = el)} type="file" className="hidden" onChange={(e) => { pickFile(a.key, a.label, e.target.files?.[0]); e.target.value = ''; }} />
                  <Button size="sm" variant="default" disabled={busy === a.key} onClick={() => fileRefs.current[a.key]?.click()}><UploadIcon size={13} /> {busy === a.key ? t('assets.uploading', 'Uploading…') : t('assets.replace', 'Replace file')}</Button>
                </div>
              ) : (
                <div>
                  {editJson[a.key] != null ? (
                    <div className="space-y-2">
                      {/* These are the files the apps actually read (links.json, update.json).
                          A plain textarea let a stray comma ship silently; JsonEditor colours
                          the syntax and says valid/invalid as you type. */}
                      <JsonEditor value={editJson[a.key]} onChange={(v) => setEditJson((s) => ({ ...s, [a.key]: v }))} minH={220} />
                      <div className="flex gap-2">
                        <Button size="sm" variant="primary" disabled={busy === a.key} onClick={() => saveJson(a.key, a.label)}><Save size={13} /> {t('common.save', 'Save')}</Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditJson((s) => { const n = { ...s }; delete n[a.key]; return n; })}>{t('common.cancel', 'Cancel')}</Button>
                      </div>
                    </div>
                  ) : (
                    <Button size="sm" variant="default" onClick={() => setEditJson((s) => ({ ...s, [a.key]: JSON.stringify(a.json ?? {}, null, 2) }))}><FileText size={13} /> {t('assets.editjson', 'Edit JSON')}</Button>
                  )}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function AdminProjects() {
  const toast = useToast(); const { t } = useI18n();
  const { data, reload } = useAsync(() => api.get('/projects'), []);
  // Showcase ("Other projects") are configurable here too — added automatically.
  const show = useAsync(() => api.get('/admin/showcase'), []);
  const adminMeta = useAsync(() => api.get('/admin/projects'), []);
  const [scheduling, setScheduling] = useState(false);
  const [active, setActive] = useState('bmm');
  const [text, setText] = useState('');
  const [progUrl, setProgUrl] = useState('');
  const [editMode, setEditMode] = useState('form'); // 'form' (visual) | 'json' (raw)
  const projects = data?.projects || {};
  const showcase = show.data?.projects || [];
  // Manage vs. content-only: a per-project grantee edits config/progress only. The reserved
  // cards (home-news, blog tab, visibility, schedule, cache flush) show for managers only —
  // matching what the server accepts. adminMeta/show return canManage:false for grantees and
  // already scope their lists to the granted projects.
  const canMngProjects = !!adminMeta.data?.canManage;
  const canMngShowcase = !!show.data?.canManage;
  const allKeys = ['community', 'bmm', 'bsm', 'installer', 'developers'];
  const keys = canMngProjects ? allKeys : allKeys.filter((k) => (adminMeta.data?.projects || []).some((p) => p.key === k));
  const isShowcase = active.startsWith('sc:');
  const activeManageable = isShowcase ? canMngShowcase : canMngProjects;
  // Keep `active` on something the viewer may actually edit (a grantee's default 'bmm' might
  // not be theirs). Runs once the scoped lists arrive.
  useEffect(() => {
    if (isShowcase) { if (!showcase.some((s) => `sc:${s.id}` === active)) { if (keys[0]) setActive(keys[0]); else if (showcase[0]) setActive(`sc:${showcase[0].id}`); } return; }
    if (!keys.includes(active)) { if (keys[0]) setActive(keys[0]); else if (showcase[0]) setActive(`sc:${showcase[0].id}`); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminMeta.data, show.data]);
  // Collapse the showcase chips into a picker when the rail can't hold everything on one line.
  // Measured, not guessed at a count: a hidden nowrap copy gives the natural width, compared to
  // the rail's real width via a ResizeObserver, so it reflows with the viewport (phone → menu,
  // wide desktop → chips). The built-in four always stay chips.
  const railRef = useRef(null);
  const railMeasureRef = useRef(null);
  const [railFits, setRailFits] = useState(true);
  useEffect(() => {
    const wrap = railRef.current, measure = railMeasureRef.current;
    if (!wrap || !measure) return undefined;
    const compute = () => {
      const avail = wrap.getBoundingClientRect().width;
      const need = measure.scrollWidth;
      if (avail) setRailFits(need <= avail + 1);
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [showcase.length, showcase.map((s) => s.name).join('|')]);
  const activeShow = isShowcase ? showcase.find((s) => s.id === active.slice(3)) : null;
  const activeMeta = !isShowcase ? adminMeta.data?.projects.find((p) => p.key === active) : null;
  useEffect(() => {
    if (isShowcase) { if (activeShow) { setText(JSON.stringify(activeShow.config || {}, null, 2)); setProgUrl(activeShow.config?.progressSource || ''); } return; }
    if (projects[active]) { setText(JSON.stringify(projects[active], null, 2)); setProgUrl(projects[active].progressSource || ''); }
  }, [data, show.data, active]);
  const putConfig = async (cfg) => {
    if (isShowcase) await api.put(`/admin/showcase/${activeShow.id}`, { config: cfg });
    else await api.put(`/projects/${active}`, { config: cfg });
  };
  const undoSaveSrc = useUndoableSave(() => { reload(); show.reload?.(); });
  const saveSource = () => {
    // Parse BEFORE deferring so bad JSON is reported straight away — it used to be inside the
    // same try as the request, which reported a syntax error as "Save failed".
    let cfg;
    try { cfg = JSON.parse(text || '{}'); }
    catch { return toast.error(t('ap.badjson', 'Config JSON is invalid.')); }
    if (progUrl.trim()) cfg.progressSource = progUrl.trim(); else delete cfg.progressSource;
    undoSaveSrc(async () => { await putConfig(cfg); setText(JSON.stringify(cfg, null, 2)); },
      t('ap.srcsaved', 'Progress source saved.'),
      { errorFor: (x) => x.data?.error || t('common.savefail', 'Save failed.') });
  };
  // A change on GitHub (progress.json, release notes…) can sit in the server's
  // 5-min proxy cache — this makes it visible on the site immediately.
  const flushCache = async () => {
    try { const r = await api.post('/admin/projects/flush-cache'); toast.success(t('ap.cacheflushed', 'Site caches refreshed ({n} entries) — repo changes are live now.').replace('{n}', r.flushed)); }
    catch { toast.error(t('common.failed', 'Failed.')); }
  };
  const previewSource = async () => {
    try { const r = await api.get(`/projects/${active}/progress`); const n = (r.progress?.categories || []).reduce((a, c) => a + (c.items?.length || 0), 0); toast.success(t('ap.fetched', 'Fetched progress.json ({n} items).').replace('{n}', n)); }
    catch (x) { toast.error(x.data?.error || x.data?.detail || t('ap.fetchfail', 'Fetch failed.')); }
  };
  let valid = true; try { JSON.parse(text || '{}'); } catch { valid = false; }
  const format = () => { try { setText(JSON.stringify(JSON.parse(text), null, 2)); } catch { toast.error(t('common.invalidjson', 'Invalid JSON.')); } };
  const undoSaveCfg = useUndoableSave(() => { reload(); show.reload?.(); });
  const save = () => {
    if (!valid) return toast.error(t('common.invalidjson', 'Invalid JSON.'));
    // Parsed once, up front: the text area stays editable during the window and this must
    // write what was on screen at click time. Same for the project name in the message.
    const cfg = JSON.parse(text);
    const label = isShowcase ? activeShow?.name : projMeta(active).name;
    undoSaveCfg(() => putConfig(cfg),
      t('ap.saved', '{name} saved.').replace('{name}', label),
      { errorFor: (x) => x.data?.error || t('common.savefail', 'Save failed.') });
  };
  const hint = (label, val) => <div><div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--faint)]">{label}</div><code className="text-[11px] text-[var(--muted)]">{val}</code></div>;
  const taRef = useRef(null); const gutRef = useRef(null); const ovRef = useRef(null);
  const lineCount = (text.match(/\n/g) || []).length + 1;
  const M = isShowcase ? { icon: Sparkles, name: activeShow?.name || 'Project' } : projMeta(active);
  // Per-blog toggle: this project/page's posts always show on /blog, but only
  // surface in the home page's unified "Latest news" when this is on.
  const showOnHomeNews = isShowcase ? (activeShow?.showOnHomeNews !== false) : (data?.homeNews?.[active] !== false);
  const toggleHomeNews = async () => {
    try {
      if (isShowcase) await api.put(`/admin/showcase/${activeShow.id}`, { showOnHomeNews: !showOnHomeNews });
      else await api.put(`/admin/projects/${active}/home-news`, { show: !showOnHomeNews });
      toast.success((!showOnHomeNews ? t('ap.homenews.on', '{name} will now show in home Latest news.') : t('ap.homenews.off', '{name} no longer shows in home Latest news.')).replace('{name}', M.name));
      reload(); show.reload?.();
    } catch { toast.error(t('common.failed', 'Failed.')); }
  };
  // Opt-in "Blog" tab on the project's own page, showing only this project's posts.
  const showBlogTab = isShowcase ? (activeShow?.showBlogTab === true) : (data?.blogTab?.[active] === true);
  const toggleBlogTab = async () => {
    try {
      if (isShowcase) await api.put(`/admin/showcase/${activeShow.id}`, { showBlogTab: !showBlogTab });
      else await api.put(`/admin/projects/${active}/blog-tab`, { show: !showBlogTab });
      toast.success((!showBlogTab ? t('ap.blogtab.on', '{name} now shows a Blog tab.') : t('ap.blogtab.off', '{name} no longer shows a Blog tab.')).replace('{name}', M.name));
      reload(); show.reload?.();
    } catch { toast.error(t('common.failed', 'Failed.')); }
  };
  // Visibility gate — every fixed project except 'community' (which is always public).
  const undoSaveVis = useUndoableSave(() => adminMeta.reload?.());
  const saveVisibility = (visibility, whitelist) => {
    // `active` is the selected project and can change during the window — pin it.
    const id = active;
    undoSaveVis(() => api.put(`/admin/projects/${id}/visibility`, { visibility, whitelist }),
      t('ap.vissaved', 'Visibility saved.'));
  };
  return (
    <div className="mt-10">
      {/* Header row keeps the "Refresh caches" action OUT of the wrapping chooser below —
          with many showcase projects an ml-auto button in a flex-wrap row orphaned itself. */}
      <div className="flex items-start justify-between gap-3 flex-wrap mb-1">
        <h2 className="font-semibold flex items-center gap-2"><Settings2 size={16} className="text-[var(--primary-2)]" /> {t('ap.title', 'Projects config')}</h2>
        {canMngProjects && <Button size="sm" variant="ghost" onClick={flushCache} title="Repo changes (progress.json, release notes, links) can sit in a 5-min cache — this applies them now.">
          <RefreshCw size={13} /> {t('ap.refreshcaches', 'Refresh site caches')}
        </Button>}
      </div>
      <p className="text-sm text-[var(--muted)] mb-4">{t('ap.sub', 'Configure downloads, links, contributors & messages, the progress tracker, legal docs, and the GitHub release-notes source — per project.')}</p>
      {/* Project chooser — a self-contained rail that wraps cleanly (and gives the chips a
          subtle surface so they aren't see-through under Translucent surfaces). The built-in
          projects and the showcase ones share one grid; a labelled divider separates them
          without the fragile inline ml-auto / orphaned w-px of the old flex row. */}
      {(() => {
        const chip = (on) => `flex items-center gap-2 px-3.5 py-2 rounded-xl border text-sm transition press-sm ${on ? 'border-[var(--primary)] bg-[var(--surface-2)] text-[var(--text)] font-medium' : 'border-[var(--line)] bg-[var(--surface-2)]/40 text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]'}`;
        // Chips while they fit on one line; a picker once they don't (measured above). The
        // built-in four stay chips, since that set is fixed and worth having one click away.
        const asMenu = !railFits && showcase.length > 0;
        const scIcon = (s) => <ShowcaseIcon icon={s.icon} size={14} fallback={<Sparkles size={14} />} />;
        return (
          <div ref={railRef} className="seg-rail !flex-wrap gap-2 p-2 rounded-2xl mb-4">
            {/* Hidden nowrap copy — the source of truth for the natural (unwrapped) width. */}
            <div ref={railMeasureRef} aria-hidden className="absolute -z-10 opacity-0 pointer-events-none flex gap-2 whitespace-nowrap" style={{ left: -9999, top: -9999 }}>
              {keys.map((k) => <span key={k} className={chip(false)}><AppLogo pkey={k} size={16} fallback={projMeta(k).icon} /> {projMeta(k).name}</span>)}
              {showcase.length > 0 && <span className="px-1.5" />}
              {showcase.map((s) => <span key={s.id} className={chip(false)}>{scIcon(s)} <span className="max-w-[160px]">{s.name}</span></span>)}
            </div>
            {keys.map((k) => { const Pm = projMeta(k); return (
              <button key={k} onClick={() => setActive(k)} className={chip(active === k)}>
                <AppLogo pkey={k} size={16} fallback={Pm.icon} /> {Pm.name}
              </button>); })}
            {showcase.length > 0 && <span className="self-center text-[10px] uppercase tracking-wider text-[var(--faint)] px-1.5">{t('ap.showcase', 'Other')}</span>}
            {asMenu ? (
              <Dropdown className="self-center min-w-[13rem]" value={isShowcase ? active : ''}
                placeholder={t('ap.pickother', 'Pick a project…')} onChange={setActive}
                options={showcase.map((s) => ({ value: `sc:${s.id}`, label: s.name, icon: scIcon(s) }))} />
            ) : showcase.map((s) => (
              <button key={s.id} onClick={() => setActive(`sc:${s.id}`)} className={chip(active === `sc:${s.id}`)}>
                {scIcon(s)} <span className="truncate max-w-[160px]">{s.name}</span>
              </button>
            ))}
          </div>
        );
      })()}
      {/* Progress tracker source: pull the project's progress.json from a URL. */}
      <Card className="p-4 mb-4">
        <div className="flex items-center gap-2 mb-2"><TrendingUp size={15} className="text-[var(--primary-2)]" /><span className="font-medium text-sm">{t('ap.progsrc', 'Progress tracker source')}</span></div>
        <p className="text-xs text-[var(--muted)] mb-3">A raw URL to a <code>progress.json</code> ({'{ lastUpdate, art, code, categories:[{ name, items:[{ label, status, percent }] }] }'}). Rendered live on the project page; leave empty to use the inline <code>progress</code> in the config below.</p>
        <div className="flex flex-col sm:flex-row gap-2">
          <Input className="flex-1" value={progUrl} onChange={(e) => setProgUrl(e.target.value)} placeholder="https://raw.githubusercontent.com/…/progress.json" />
          <div className="flex gap-2">
            <Button variant="ghost" onClick={previewSource} disabled={!progUrl.trim()}><Globe size={14} /> {t('ap.test', 'Test')}</Button>
            <Button variant="primary" onClick={saveSource}><CheckCircle2 size={14} /> {t('ap.savesource', 'Save source')}</Button>
          </div>
        </div>
      </Card>
      {activeManageable && <Card className="p-4 mb-4 flex items-center gap-3">
        <Newspaper size={15} className="text-[var(--primary-2)] shrink-0" />
        <div className="flex-1"><span className="font-medium text-sm">{t('ap.homenews', 'Show in home "Latest news"')}</span><p className="text-xs text-[var(--muted)]">{t('ap.homenews.d', "{name}'s posts always appear on /blog regardless of this — this only controls the home page feed.").replace('{name}', M.name)}</p></div>
        <button onClick={toggleHomeNews} className={`relative w-10 h-6 rounded-full transition shrink-0 ${showOnHomeNews ? 'bg-[var(--primary)]' : 'bg-[var(--surface-2)] border border-[var(--line)]'}`}>
          <span className={`absolute left-0.5 top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${showOnHomeNews ? 'translate-x-[18px]' : 'translate-x-0'}`} />
        </button>
      </Card>}
      {activeManageable && <Card className="p-4 mb-4 flex items-center gap-3">
        <PenSquare size={15} className="text-[var(--primary-2)] shrink-0" />
        <div className="flex-1"><span className="font-medium text-sm">Show "Blog" tab on the project page</span><p className="text-xs text-[var(--muted)]">Adds a Blog tab to {M.name}'s own page, showing only {M.name}'s posts.</p></div>
        <button onClick={toggleBlogTab} className={`relative w-10 h-6 rounded-full transition shrink-0 ${showBlogTab ? 'bg-[var(--primary)]' : 'bg-[var(--surface-2)] border border-[var(--line)]'}`}>
          <span className={`absolute left-0.5 top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${showBlogTab ? 'translate-x-[18px]' : 'translate-x-0'}`} />
        </button>
      </Card>}
      {/* Visibility: every fixed project except 'community', which is always public. */}
      {canMngProjects && !isShowcase && active !== 'community' && activeMeta && (
        <Card className="p-4 mb-4">
          <VisibilitySection visibility={activeMeta.visibility} whitelist={activeMeta.visibilityWhitelist}
            onVisibility={(v) => saveVisibility(v, activeMeta.visibilityWhitelist)}
            onAddWhitelist={(e) => saveVisibility('whitelist', [...(activeMeta.visibilityWhitelist || []), e])}
            onRemoveWhitelist={(e) => saveVisibility('whitelist', (activeMeta.visibilityWhitelist || []).filter((a) => !(a.type === e.type && a.id === e.id)))} />
        </Card>
      )}
      {/* Existing scheduled update (a single staged content swap per page) — visible
          here with Edit (reopens the form pre-filled) + Cancel (clears the schedule). */}
      {(() => {
        const sched = isShowcase ? activeShow : activeMeta;
        if (!activeManageable || !sched?.scheduledAt) return null;
        const when = new Date(sched.scheduledAt);
        const due = when.getTime() <= Date.now();
        const nx = sched.scheduledNext || {};
        const parts = [nx.name && `name → “${nx.name}”`, nx.short && `short → “${nx.short}”`, nx.config && t('apj.configchanges', 'config changes')].filter(Boolean);
        const cancelSchedule = async () => {
          try {
            if (isShowcase) await api.put(`/admin/showcase/${activeShow.id}/schedule`, { at: null });
            else await api.put(`/admin/projects/${active}/schedule`, { at: null });
            toast.success(t('apj.schedcancelled', 'Scheduled update cancelled.')); reload(); show.reload?.(); adminMeta.reload?.();
          } catch { toast.error(t('apj.cannotcancel', 'Could not cancel.')); }
        };
        return (
          <div className={`mb-3 rounded-xl border px-3.5 py-2.5 flex items-start gap-2.5 ${due ? 'border-success-border bg-success-bg' : 'border-[var(--primary)]/40 bg-[var(--primary)]/8'}`}>
            <Clock size={16} className={`shrink-0 mt-0.5 ${due ? 'text-success' : 'text-[var(--primary-2)]'}`} />
            <div className="flex-1 min-w-0 text-sm">
              <div className="font-medium">{due ? t('apj.scheddue', 'Scheduled update is due') : t('apj.schedpending', 'Scheduled update pending')} <span className="font-normal text-[var(--muted)]">· {when.toLocaleString()}</span></div>
              <div className="text-xs text-[var(--faint)]">{parts.length ? t('apj.willapply', 'Will apply: {p}.').replace('{p}', parts.join(', ')) : t('apj.stagedupdate', 'A staged content update.')}{due ? t('apj.appliesnext', ' It applies on the next public view of the page.') : ''}</div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <Button size="sm" variant="ghost" onClick={() => { if (nx.config) setText(JSON.stringify(nx.config, null, 2)); setScheduling(true); }} title={t('apj.loadstaged', 'Load the staged content into the editor and reschedule')}><PenSquare size={13} /> {t('sh.editbtn', 'Edit')}</Button>
              <Button size="sm" variant="ghost" className="!text-error" onClick={cancelSchedule}><X size={13} /> {t('su.cancel', 'Cancel')}</Button>
            </div>
          </div>
        );
      })()}
      {activeManageable && <div className="flex justify-end mb-4">
        <Button size="sm" variant="ghost" onClick={() => setScheduling(true)} title={t('apj.stagefuture', 'Stage a future content swap for this page')}><Clock size={13} /> {(isShowcase ? activeShow : activeMeta)?.scheduledAt ? t('apj.reschedule', 'Reschedule') : t('sh.schedtip', 'Schedule an update')}</Button>
      </div>}
      <div className="rounded-2xl overflow-hidden border border-[var(--line)]" style={{ boxShadow: 'var(--shadow)' }}>
        <div className="flex items-center justify-between gap-2 px-4 py-2.5 code-chrome flex-wrap">
          <div className="flex items-center gap-2 text-sm font-medium text-[var(--text)]"><M.icon size={15} className="text-orange-400" /> {M.name}</div>
          <div className="flex items-center gap-2">
            {/* Visual form is the default; raw JSON stays as an advanced escape hatch. */}
            <div className="inline-flex rounded-lg border border-[var(--line)] p-0.5 text-xs">
              {[['form', t('su.visual', 'Visual')], ['json', 'JSON']].map(([m, label]) => (
                <button key={m} type="button" onClick={() => setEditMode(m)} disabled={m === 'form' && !valid}
                  className={`px-2.5 py-1 rounded-md ${editMode === m ? 'bg-[var(--surface-2)] text-[var(--text)]' : 'text-[var(--muted)]'} ${m === 'form' && !valid ? 'opacity-40 cursor-not-allowed' : ''}`}>{label}</button>
              ))}
            </div>
            {editMode === 'json' && <Badge tone={valid ? 'green' : 'red'}>{valid ? t('apj.validjson', 'valid JSON') : t('apj.invalidjson', 'invalid JSON')}</Badge>}
            {editMode === 'json' && <Button size="sm" variant="ghost" onClick={format}>{t('apj.format', 'Format')}</Button>}
            <Button size="sm" variant="primary" disabled={!valid} onClick={save}>{t('common.save', 'Save')}</Button>
          </div>
        </div>
        {editMode === 'form' ? (
          valid
            ? <div className="p-3 bg-[var(--bg-solid)] max-h-[70vh] overflow-auto">
                <ProjectConfigEditor value={JSON.parse(text || '{}')} onChange={(cfg) => setText(JSON.stringify(cfg, null, 2))}
                  slug={isShowcase ? activeShow?.slug : active} isShowcase={isShowcase} />
              </div>
            : <div className="p-6 text-sm text-[var(--muted)] bg-[var(--bg-solid)]">The raw JSON is currently invalid — switch to the JSON tab to fix it, then come back.</div>
        ) : (
          <>
            <div className="code-editor flex" style={{ height: 460 }}>
              <pre ref={gutRef} className="code-gutter" aria-hidden="true">{Array.from({ length: lineCount }, (_, i) => i + 1).join('\n')}</pre>
              {/* Prism paints the <pre>; the textarea above it keeps only its caret. Both share
                  .code-area's metrics (see index.css) so the caret tracks the glyphs. */}
              <div className="code-wrap">
                <pre ref={ovRef} className="code-overlay" aria-hidden="true"
                     dangerouslySetInnerHTML={{ __html: highlightJson(text) }} />
                <textarea ref={taRef} className="code-area is-highlighted" value={text} spellCheck={false}
                  onChange={(e) => setText(e.target.value)}
                  onScroll={() => {
                    if (gutRef.current && taRef.current) gutRef.current.scrollTop = taRef.current.scrollTop;
                    if (ovRef.current && taRef.current) { ovRef.current.scrollTop = taRef.current.scrollTop; ovRef.current.scrollLeft = taRef.current.scrollLeft; }
                  }} />
              </div>
            </div>
            <div className="grid sm:grid-cols-3 gap-3 px-4 py-3 code-chrome">
              {hint('releaseNotes', '{ owner, repo, branch, path }')}
              {hint('contributors / messages', '[{ name, role, pfp, links }]')}
              {hint('progress / downloads', '[{ title, status, percent }] · [{ label, url, primary }]')}
            </div>
          </>
        )}
      </div>
      {scheduling && (() => {
        let cfg = {}; try { cfg = JSON.parse(text || '{}'); } catch { /* editor currently has invalid JSON — schedule form starts from {} */ }
        const existing = isShowcase ? activeShow : activeMeta;
        return (
          <ScheduleUpdateModal title={`Schedule an update — ${M.name}`} includeNameShort={isShowcase} existing={existing}
            slug={isShowcase ? activeShow?.slug : active} isShowcase={isShowcase}
            current={isShowcase ? { name: activeShow?.name, short: activeShow?.short, config: cfg } : { config: cfg }}
            onClose={() => setScheduling(false)}
            onSave={async (at, next) => {
              if (isShowcase) await api.put(`/admin/showcase/${activeShow.id}/schedule`, { at, next });
              else await api.put(`/admin/projects/${active}/schedule`, { at, next });
              reload(); show.reload?.(); adminMeta.reload?.();
            }} />
        );
      })()}
    </div>
  );
}

// Real brand icons from simpleicons.org CDN (browsers/OS) or the site favicon
// (referrers), with a Lucide fallback if the image fails.
function BrandImg({ slug, favicon, size = 15, fallback: Fb = Globe }) {
  const [ok, setOk] = useState(true);
  const src = slug ? `https://cdn.simpleicons.org/${slug}` : favicon;
  if (src && ok) return <img src={src} width={size} height={size} onError={() => setOk(false)} className="inline-block object-contain rounded-[3px] shrink-0" alt="" style={{ width: size, height: size }} />;
  return <Fb size={size} className="text-[var(--faint)] shrink-0" />;
}
const BROWSER_SLUG = { Chrome: 'googlechrome/4285F4', Firefox: 'firefoxbrowser/FF7139', Safari: 'safari/1B88CA', Edge: 'microsoftedge/0078D7', Opera: 'opera/FF1B2D' };
// NOTE: SimpleIcons removed the Windows/Microsoft brand marks, so there's no valid CDN
// slug for Windows — it's rendered with a Lucide Monitor glyph instead (see OS iconOf).
const OS_SLUG = {
  Windows: null, macOS: 'apple/A2AAAD', iOS: 'apple/A2AAAD', Android: 'android/3DDC84',
  Linux: 'linux/FCC624', Ubuntu: 'ubuntu/E95420', Fedora: 'fedora/51A2DA', Debian: 'debian/A81D33',
  Kali: 'kalilinux/557C94', Arch: 'archlinux/1793D1', Manjaro: 'manjaro/35BF5C',
  'Linux Mint': 'linuxmint/87CF3E', SteamOS: 'steamdeck/1A9FFF', ChromeOS: 'googlechrome/4285F4',
};

function Breakdown({ title, rows, iconOf }) {
  const { t } = useI18n();
  const max = Math.max(1, ...rows.map((r) => r.count)); const tot = rows.reduce((a, r) => a + r.count, 0) || 1;
  return (
    <Card className="p-5">
      <div className="text-xs font-semibold text-[var(--faint)] uppercase mb-3">{title}</div>
      <div className="space-y-2.5">
        {rows.length ? rows.map((r) => (
          <div key={r.label} className="flex items-center gap-3 text-sm">
            <span className="text-[var(--muted)] w-28 shrink-0 flex items-center gap-2 capitalize truncate">{iconOf ? iconOf(r.label) : null}{r.label}</span>
            <div className="flex-1 h-2 rounded-full bg-[var(--surface-2)] overflow-hidden"><div className="h-full bg-gradient-to-r from-brand to-brand-2" style={{ width: `${(r.count / max) * 100}%` }} /></div>
            <span className="w-12 text-right font-medium">{Math.round((r.count / tot) * 100)}%</span>
          </div>
        )) : <div className="text-sm text-[var(--faint)]">{t('an.nodata', 'No data yet.')}</div>}
      </div>
    </Card>
  );
}

const refHost = (r) => { try { return new URL(r).hostname.replace(/^www\./, ''); } catch { return r || 'direct'; } };

const fmtBytes = (n) => {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let v = n, i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
};

// Admin: contact-form inbox. Messages are stored server-side (and forwarded to
// Discord if a webhook is configured).
function AdminMessages() {
  const toast = useToast(); const { t } = useI18n();
  const { data, loading, reload } = useAsync(() => api.get('/admin/contact'), []);
  const undo = useUndoableDelete(reload);
  const msgs = (data?.messages || []).filter((m) => !undo.pending.has(m.id));
  const markRead = async (m) => { if (m.readAt) return; try { await api.post(`/admin/contact/${m.id}/read`); reload(); } catch {} };
  const del = (m) => undo.del(m.id, () => api.del(`/admin/contact/${m.id}`), t('common.deleted', 'Deleted.'));
  if (loading) return <Loading />;
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold flex items-center gap-2"><Mail size={16} className="text-[var(--primary-2)]" /> {t('am.title', 'Contact messages')} {data?.unread > 0 && <Badge tone="amber">{t('am.new', '{n} new').replace('{n}', data.unread)}</Badge>}</h2>
        <Button size="sm" variant="ghost" onClick={reload}><RefreshCw size={14} /> {t('am.refresh', 'Refresh')}</Button>
      </div>
      {msgs.length ? <div className="space-y-2">
        {msgs.map((m) => (
          <Card key={m.id} className={`p-4 ${m.readAt ? '' : 'border-[var(--ring)] bg-orange-500/[0.03]'}`} onMouseEnter={() => markRead(m)}>
            <div className="flex items-start gap-3">
              <span className="grid place-items-center w-9 h-9 rounded-lg bg-[var(--surface-2)] shrink-0"><MessageSquare size={15} className="text-[var(--primary-2)]" /></span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium">{m.name}</span>
                  <a href={`mailto:${m.email}`} className="text-xs text-[var(--primary-2)] hover:underline">{m.email}</a>
                  {m.user && <Badge tone="primary"><Users size={9} /> {m.user.displayName}</Badge>}
                  {!m.readAt && <Badge tone="amber">{t('am.newbadge', 'new')}</Badge>}
                  <span className="text-xs text-[var(--faint)] ml-auto">{new Date(m.createdAt).toLocaleString()}</span>
                </div>
                <div className="text-sm text-[var(--muted)] mt-1.5 break-words prose-sm"><Markdown>{m.body}</Markdown></div>
                <div className="flex items-center gap-2 mt-2.5">
                  <a href={`mailto:${m.email}?subject=${encodeURIComponent(t('am.replysubj', 'Re: your message to BetterCommunity'))}`}><Button size="sm"><Send size={13} /> {t('am.reply', 'Reply')}</Button></a>
                  <Button size="sm" variant="ghost" onClick={() => del(m)}><Trash2 size={13} /> {t('am.delete', 'Delete')}</Button>
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div> : <EmptyState icon={Mail} title={t('am.none.t', 'No messages')} sub={t('am.none.s', 'Contact-form submissions will appear here.')} />}
    </div>
  );
}

// Admin: configure the Discord bot + see its live status (heartbeat).
// A tidy add/remove list of Discord channel IDs (replaces a raw textarea).
function ChannelIdList({ ids, onChange, placeholder }) {
  const [draft, setDraft] = useState('');
  const list = Array.isArray(ids) ? ids : [];
  const add = () => { const v = draft.trim(); if (!v) return; if (!list.includes(v)) onChange([...list, v]); setDraft(''); };
  return (
    <div className="space-y-1.5">
      {list.length > 0 && <div className="flex flex-wrap gap-1.5">
        {list.map((id) => (
          <span key={id} className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-lg bg-[var(--surface-2)] border border-[var(--line)] text-xs font-mono">
            {id}<button onClick={() => onChange(list.filter((x) => x !== id))} className="text-[var(--faint)] hover:text-error"><X size={12} /></button>
          </span>
        ))}
      </div>}
      <div className="flex gap-2">
        <Input className="font-mono text-xs" value={draft} onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ''))} placeholder={placeholder} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
        <Button size="sm" onClick={add}><Plus size={14} /></Button>
      </div>
    </div>
  );
}

// Moderation: full submission review (details, metadata, download, plugin validation,
// plus mod-only internal tags & a short comment thread for other moderators).
function SubmissionReview({ sub, onClose, onApprove, onReject, reload }) {
  const toast = useToast(); const { t } = useI18n();
  const it = sub.item || {}; const meta = it.meta || {};
  const dl = meta.download_url || meta.downloadUrl || null;
  const [tags, setTags] = useState(sub.tags || []);
  const [tagInput, setTagInput] = useState('');
  const [comments, setComments] = useState(sub.comments || []);
  const [commentInput, setCommentInput] = useState('');
  const [busy, setBusy] = useState(false);
  // Examine the submitted payload in detail (zip entries + inline text) before approving.
  const [insp, setInsp] = useState(null); // { loading } | { data } | { error }
  const [openEntry, setOpenEntry] = useState(null);
  const examine = async () => {
    if (insp?.data) { setInsp(null); return; }
    setInsp({ loading: true }); setOpenEntry(null);
    try { const r = await api.get(`/admin/catalog/${it.id}/inspect`); setInsp({ data: r }); }
    catch (x) { setInsp({ error: x.data?.error || 'read_failed' }); }
  };
  const dlEntry = (path) => window.open(`/api/admin/catalog/${it.id}/entry?path=${encodeURIComponent(path)}`, '_blank');
  const dlWhole = async () => { try { const r = await api.get(`/admin/catalog/${it.id}/file`); if (r.url) window.open(r.url, '_blank'); } catch { toast.error(t('common.failed', 'Failed.')); } };
  const rows = [
    [t('sr.kind', 'Kind'), it.kind], [t('sr.version', 'Version'), it.version && `v${it.version}`], [t('sr.project', 'Project'), it.project?.key?.toUpperCase()],
    [t('sr.author', 'Author'), `${it.owner?.displayName || '—'}${it.owner?.email ? ` · ${it.owner.email}` : ''}`], [t('sr.slug', 'Slug'), it.slug], [t('sr.subtype', 'Submission type'), sub.type],
  ].filter(([, v]) => v);

  const undoSaveTags = useUndoableSave(reload);
  const saveTags = (next) => {
    // This one was ALREADY optimistic — it set the chips before the PUT. That makes the undo
    // path the interesting half: on cancel the previous tags have to come back, or the UI
    // would keep a change the server never received.
    const prev = tags;
    setTags(next);
    undoSaveTags(() => api.put(`/mod/submissions/${sub.id}/tags`, { tags: next }),
      t('common.saved', 'Saved.'), { onCancel: () => setTags(prev) });
  };
  const addTag = () => { const x = tagInput.trim(); if (x && !tags.includes(x)) saveTags([...tags, x]); setTagInput(''); };
  const removeTag = (x) => saveTags(tags.filter((tg) => tg !== x));

  const addComment = async () => {
    const body = commentInput.trim();
    if (!body) return;
    setBusy(true);
    try { const r = await api.post(`/mod/submissions/${sub.id}/comments`, { body }); setComments((c) => [...c, r.comment]); setCommentInput(''); reload?.(); }
    catch { toast.error(t('common.failed', 'Failed.')); } finally { setBusy(false); }
  };
  const removeComment = async (cid) => {
    try { await api.del(`/mod/submissions/${sub.id}/comments/${cid}`); setComments((c) => c.filter((x) => x.id !== cid)); reload?.(); } catch { toast.error(t('common.failed', 'Failed.')); }
  };

  return (
    <Modal open onClose={onClose} title={t('sr.title', 'Review — {n}').replace('{n}', it.name)} icon={Eye} width="max-w-2xl"
      footer={<><Button variant="ghost" onClick={onClose}>{t('su.close', 'Close')}</Button><Button onClick={onReject}><XCircle size={15} /> {t('sr.reject', 'Reject')}</Button><Button variant="primary" onClick={onApprove}><CheckCircle2 size={15} /> {t('sr.approve', 'Approve')}</Button></>}>
      <div className="grid sm:grid-cols-2 gap-x-4 gap-y-2.5 text-sm mb-4">
        {rows.map(([k, v]) => <div key={k} className="min-w-0"><span className="text-[var(--faint)] text-xs">{k}</span><div className="font-medium truncate">{v}</div></div>)}
      </div>
      {it.description && <div className="mb-4"><div className="text-xs text-[var(--faint)] uppercase font-semibold mb-1">{t('cc.description', 'Description')}</div><p className="text-sm text-[var(--muted)] whitespace-pre-wrap">{it.description}</p></div>}
      {it.tags?.length > 0 && <div className="flex flex-wrap gap-1.5 mb-4">{it.tags.map((tg) => <Badge key={tg}><Tag size={10} /> {tg}</Badge>)}</div>}

      <div className="mb-4 p-3 rounded-lg bg-[var(--surface-2)] border border-[var(--line)]">
        <div className="text-xs font-semibold text-[var(--faint)] uppercase mb-1.5 flex items-center gap-1.5"><Tag size={11} /> {t('sr.modtags', 'Internal mod tags')} <span className="normal-case font-normal">{t('sr.modtagsnote', '(never shown to the author)')}</span></div>
        <div className="flex gap-1.5 mb-2">
          <Input value={tagInput} onChange={(e) => setTagInput(e.target.value)} placeholder={t('sr.tagph', 'e.g. priority, needs-rework…')} onKeyDown={(e) => e.key === 'Enter' && addTag()} />
          <Button size="sm" onClick={addTag}><Plus size={13} /></Button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {tags.length ? tags.map((tg) => <span key={tg} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-warning-bg border border-warning-border text-xs text-warning">{tg}<button onClick={() => removeTag(tg)} className="hover:text-error"><X size={10} /></button></span>) : <span className="text-xs text-[var(--faint)]">{t('sr.none', 'None')}</span>}
        </div>
      </div>

      <div className="mb-4">
        <div className="text-xs font-semibold text-[var(--faint)] uppercase mb-1.5 flex items-center gap-1.5"><MessageSquare size={11} /> {t('sr.modcomments', 'Mod comments')} <span className="normal-case font-normal">{t('sr.modcommentsnote', '(internal, 200 char max)')}</span></div>
        <div className="space-y-1.5 mb-2 max-h-40 overflow-auto">
          {comments.length ? comments.map((c) => (
            <div key={c.id} className="flex items-start gap-2 text-sm bg-[var(--surface-2)] rounded-lg px-3 py-2">
              <div className="flex-1 min-w-0"><span className="font-medium">{c.author?.displayName || '—'}</span> <span className="text-[var(--muted)]">{c.body}</span></div>
              <button onClick={() => removeComment(c.id)} className="text-[var(--faint)] hover:text-error shrink-0"><X size={12} /></button>
            </div>
          )) : <div className="text-xs text-[var(--faint)]">{t('sr.nocomments', 'No comments yet.')}</div>}
        </div>
        <div className="flex gap-1.5">
          <Input value={commentInput} onChange={(e) => setCommentInput(e.target.value.slice(0, 200))} placeholder={t('sr.commentph', 'Leave a note for other moderators…')} onKeyDown={(e) => e.key === 'Enter' && addComment()} />
          <Button size="sm" disabled={busy} onClick={addComment}>{busy ? <Spinner /> : <Send size={13} />}</Button>
        </div>
        <div className="text-[10px] text-[var(--faint)] mt-1 text-right">{commentInput.length}/200</div>
      </div>

      {/* Examine the payload content in detail (zip entries + inline text) + download it. */}
      <div className="mb-4 rounded-lg bg-[var(--surface-2)] border border-[var(--line)] p-3">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="text-xs font-semibold text-[var(--faint)] uppercase flex items-center gap-1.5"><Eye size={11} /> {t('sr.examine.t', 'Content review')}</div>
          <div className="flex-1" />
          <Button size="sm" variant="ghost" onClick={examine}><FileText size={13} /> {insp?.data ? t('sr.examine.hide', 'Hide') : t('sr.examine', 'Examine content')}</Button>
          <Button size="sm" variant="ghost" onClick={dlWhole}><Download size={13} /> {t('sr.download', 'Download')}</Button>
        </div>
        {insp && <div className="mt-2 pt-2 border-t border-[var(--line)] text-xs">
          {insp.loading ? <Loading /> : insp.error ? <p className="text-error">{insp.error}</p> : insp.data ? (
            insp.data.type === 'zip' ? <div className="space-y-1">
              {insp.data.entries.map((e) => (
                <div key={e.name}>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setOpenEntry(openEntry === e.name ? null : (e.text != null ? e.name : null))} className={`flex-1 min-w-0 truncate text-left font-mono ${e.text != null ? 'hover:text-[var(--primary)]' : 'cursor-default'}`}>{e.text != null && <ChevronDown size={11} className={`inline mr-1 transition-transform ${openEntry === e.name ? '' : '-rotate-90'}`} />}{e.name}</button>
                    <span className="text-[var(--faint)] tabular-nums">{fmtBytes(e.size)}</span>
                    <button onClick={() => dlEntry(e.name)} className="text-[var(--faint)] hover:text-[var(--primary)]"><Download size={11} /></button>
                  </div>
                  {openEntry === e.name && e.text != null && <pre className="mt-1 mb-2 p-2 rounded bg-[var(--bg)] border border-[var(--line)] overflow-auto max-h-72 whitespace-pre-wrap break-words text-[11px] leading-relaxed">{e.text}</pre>}
                </div>
              ))}
            </div> : (insp.data.text != null
              ? <pre className="p-2 rounded bg-[var(--bg)] border border-[var(--line)] overflow-auto max-h-72 whitespace-pre-wrap break-words text-[11px] leading-relaxed">{insp.data.text}</pre>
              : <p className="text-[var(--faint)]">{t('sr.binary', 'Binary file — download to inspect.')} ({fmtBytes(insp.data.size)})</p>)
          ) : null}
        </div>}
        {dl && <div className="mt-2 flex items-center gap-2 text-[11px]"><Download size={12} className="text-[var(--primary-2)] shrink-0" /><a href={dl} target="_blank" rel="noreferrer" className="text-[var(--primary-2)] break-all hover:underline">{dl}</a></div>}
      </div>
      {meta.validation && <div className="mb-4"><div className="text-xs font-semibold text-[var(--faint)] uppercase mb-1.5 flex items-center gap-2">{t('sr.pluginval', 'Plugin validation')} {meta.validation.valid ? <Badge tone="green"><CheckCircle2 size={10} /> {t('sr.valid', 'valid')}</Badge> : <Badge tone="red"><XCircle size={10} /> {t('sr.invalid', 'invalid')}</Badge>}</div><pre className="text-xs bg-[var(--surface-2)] rounded-lg p-3 max-h-40 overflow-auto">{JSON.stringify(meta.validation, null, 2)}</pre></div>}
      {Object.keys(meta).length > 0 && <div><div className="text-xs font-semibold text-[var(--faint)] uppercase mb-1.5">{t('sr.fullmeta', 'Full metadata (review before approving)')}</div><pre className="text-xs bg-[var(--surface-2)] rounded-lg p-3 max-h-56 overflow-auto">{JSON.stringify(meta, null, 2)}</pre></div>}
    </Modal>
  );
}

// Admin: generate + manage promo codes (discount / free hosting / free boost).
function AdminKofi() {
  const toast = useToast(); const { t } = useI18n();
  const { data, loading, reload } = useAsync(() => api.get('/admin/kofi/settings'), []);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [grantBusy, setGrantBusy] = useState(false);
  const save = async () => {
    if (!token.trim()) return;
    setBusy(true);
    try { await api.put('/admin/kofi/settings', { token: token.trim() }); toast.success(t('common.saved', 'Saved.')); setToken(''); reload(); }
    catch { toast.error(t('common.failed', 'Failed.')); } finally { setBusy(false); }
  };
  const grant = async () => {
    if (!email.trim()) return;
    setGrantBusy(true);
    try { const r = await api.post('/admin/kofi/grant', { email: email.trim() }); toast.success(t('kf.granted', 'Granted — code {c}.').replace('{c}', r.code)); setEmail(''); }
    catch (x) { toast.error(x.data?.error === 'no_matching_account' ? t('kf.noaccount', 'No account with that email.') : x.data?.error === 'already_granted' ? t('kf.alreadygranted', 'Already granted for this account.') : t('common.failed', 'Failed.')); }
    finally { setGrantBusy(false); }
  };
  if (loading) return <Loading />;
  return (
    <>
      <Card className="p-4 mb-4">
        <div className="flex items-center gap-2 mb-1 text-sm font-semibold"><KofiIcon size={16} className="text-[var(--primary-2)]" /> {t('kf.title', 'Ko-fi donor rewards')}</div>
        <p className="text-xs text-[var(--muted)] mb-3" dangerouslySetInnerHTML={{ __html: t('kf.sub', "A donor whose Ko-fi email matches their BetterCommunity account automatically gets a one-time {off}% hosting discount code (valid on {min}+ month plans). Paste this webhook URL + a secret token into Ko-fi's <b>Settings → Webhooks</b>, using the same token below.").replace('{off}', data?.percentOff ?? 25).replace('{min}', data?.minMonths ?? 12) }} />
        <div className="flex items-center gap-2 mb-3 text-xs">
          <code className="flex-1 bg-[var(--surface-2)] rounded-lg px-2.5 py-1.5 truncate">{data?.webhookUrl}</code>
          <Button size="sm" onClick={() => { navigator.clipboard?.writeText(data?.webhookUrl || ''); toast.success(t('common.copied', 'Copied.')); }}><Copy size={12} /></Button>
        </div>
        {data?.fromEnv ? (
          <div className="mb-4 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 text-xs text-[var(--muted)] flex items-center gap-2"><Lock size={13} className="text-[var(--primary-2)] shrink-0" /> {t('kf.tokenenv', 'The verification token is set via the KOFI_WEBHOOK_TOKEN environment variable and is managed outside the dashboard.')}</div>
        ) : (
          <div className="grid sm:grid-cols-[1fr_auto] gap-2 mb-4">
            <Input value={token} onChange={(e) => setToken(e.target.value)} placeholder={data?.configured ? t('kf.tokenset', 'Token configured — enter a new one to replace it') : t('kf.tokenph', 'Ko-fi verification token')} />
            <Button variant="primary" disabled={busy} onClick={save}>{busy ? <Spinner /> : t('kf.savetoken', 'Save token')}</Button>
          </div>
        )}
        {data?.configured && <Badge tone="green" className="mb-3"><CheckCircle2 size={11} /> {data?.fromEnv ? t('kf.configuredenv', 'Configured via env') : t('kf.configured', 'Webhook configured')}</Badge>}
        <div className="pt-3 border-t border-[var(--line)]">
          <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-1.5">{t('kf.manualgrant', 'Manual grant')}</div>
          <p className="text-xs text-[var(--muted)] mb-2">{t('kf.manualsub', 'For a donation you verified by hand (e.g. before the webhook was set up).')}</p>
          <div className="grid sm:grid-cols-[1fr_auto] gap-2">
            <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="donor@email.com" />
            <Button disabled={grantBusy} onClick={grant}>{grantBusy ? <Spinner /> : t('kf.grantcode', 'Grant 25% code')}</Button>
          </div>
        </div>
      </Card>
      <AdminKofiGoal />
    </>
  );
}

// Admin: set/clear the public funding-goal target shown on the homepage widget.
// The running total + tip count are read-only here (derived from logged webhook
// events) — only the target amount/currency/title are editable.
function AdminKofiGoal() {
  const toast = useToast(); const dialog = useDialog(); const { t } = useI18n();
  const { data, loading, reload } = useAsync(() => api.get('/admin/kofi/goal'), []);
  const [f, setF] = useState({ title: '', targetAmount: '', currency: 'USD' });
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data?.goal) setF({ title: data.goal.title || '', targetAmount: String(data.goal.targetAmount ?? ''), currency: data.goal.currency || 'USD' }); }, [data]);
  const undoSave = useUndoableSave(reload);
  const save = () => {
    const amt = Number(f.targetAmount);
    if (!(amt > 0)) return toast.error(t('kg.amt.req', 'Target amount must be greater than 0.'));
    setBusy(true);
    undoSave(() => api.put('/admin/kofi/goal', { title: f.title.trim(), targetAmount: amt, currency: f.currency.trim() || 'USD' }),
      t('kg.saved', 'Goal saved — now visible on the homepage.'),
      { onSettled: () => setBusy(false) });
  };
  const clear = async () => {
    if (!(await dialog.confirm({ title: t('kg.rm.t', 'Remove funding goal'), message: t('kg.rm.m', 'The public widget will disappear from the homepage. The running total/tip count keep accumulating in the background.'), okLabel: t('kg.rm.ok', 'Remove') }))) return;
    try { await api.del('/admin/kofi/goal'); toast.success(t('common.removed', 'Removed.')); setF({ title: '', targetAmount: '', currency: 'USD' }); reload(); }
    catch { toast.error(t('common.failed', 'Failed.')); }
  };
  if (loading) return <Loading />;
  const pct = data?.goal ? Math.min(100, Math.round((data.totalAmount / data.goal.targetAmount) * 100)) : 0;
  return (
    <Card className="p-4 mb-4">
      <div className="flex items-center gap-2 mb-1 text-sm font-semibold"><Target size={16} className="text-[var(--primary-2)]" /> {t('kg.title', 'Funding goal (public widget)')}</div>
      <p className="text-xs text-[var(--muted)] mb-3">{t('kg.sub', 'Shown on the homepage with the running total raised + number of tips, sourced from Ko-fi webhook events. Set a target to turn it on.')}</p>
      <div className="rounded-xl bg-[var(--surface-2)] p-3 mb-3 flex items-center gap-4 text-sm">
        <div><span className="text-[var(--faint)]">{t('kg.raised', 'Raised so far:')}</span> <b>{(data?.totalAmount || 0).toFixed(2)} {f.currency || 'USD'}</b></div>
        <div><span className="text-[var(--faint)]">{t('kg.tips', 'Tips:')}</span> <b>{data?.tipCount ?? 0}</b></div>
      </div>
      <div className="grid sm:grid-cols-[1fr_auto_auto] gap-2 mb-2">
        <Field label={t('kg.f.title', 'Title (optional)')}><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder={t('kg.f.title.ph', 'Help us cover server costs')} /></Field>
        <Field label={t('kg.f.target', 'Target')}><Input type="number" min="1" value={f.targetAmount} onChange={(e) => setF({ ...f, targetAmount: e.target.value })} placeholder="500" className="w-28" /></Field>
        <Field label={t('kg.f.currency', 'Currency')}><Input value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase() })} placeholder="USD" className="w-20" /></Field>
      </div>
      {data?.goal && (
        <div className="mb-3">
          <div className="h-2 rounded-full bg-[var(--surface-2)] overflow-hidden"><div className="h-full rounded-full bg-gradient-to-r from-brand to-brand-2" style={{ width: `${pct}%` }} /></div>
          <div className="text-xs text-[var(--faint)] mt-1">{t('kg.pct', '{p}% of {a} {c} goal — live on the homepage').replace('{p}', pct).replace('{a}', data.goal.targetAmount).replace('{c}', data.goal.currency)}</div>
        </div>
      )}
      <div className="flex gap-2">
        <Button variant="primary" disabled={busy} onClick={save}>{busy ? <Spinner /> : data?.goal ? t('kg.update', 'Update goal') : t('kg.publish', 'Publish goal')}</Button>
        {data?.goal && <Button variant="ghost" className="!text-error" onClick={clear}>{t('kg.remove', 'Remove')}</Button>}
      </div>
    </Card>
  );
}

// Admin: generate + manage promo codes (discount / free hosting / free boost).
function AdminPromo() {
  const toast = useToast(); const { t } = useI18n();
  const { data, loading, reload } = useAsync(() => api.get('/admin/promo'), []);
  const [f, setF] = useState({ kind: 'discount', code: '', percentOff: 20, freeMonths: 0, minMonths: 0, storageGB: 10, uploadMbps: 8, hostMonths: 0, boostDays: 7, maxRedemptions: '', perUserLimit: 1, stackable: false, assignType: 'email', assignInput: '', assignedTokens: [], note: '' });
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const undo = useUndoableDelete(reload);
  const codes = (data?.codes || []).filter((c) => !undo.pending.has(c.id));
  const addToken = () => setF((s) => {
    const val = s.assignInput.trim(); if (!val) return s;
    const norm = s.assignType === 'email' ? val.toLowerCase() : val;
    const tok = `${s.assignType}:${norm}`;
    return s.assignedTokens.includes(tok) ? { ...s, assignInput: '' } : { ...s, assignedTokens: [...s.assignedTokens, tok], assignInput: '' };
  });
  const removeToken = (tok) => setF((s) => ({ ...s, assignedTokens: s.assignedTokens.filter((x) => x !== tok) }));
  const create = async () => {
    const body = { kind: f.kind, code: f.code.trim() || undefined, perUserLimit: Number(f.perUserLimit) || 1, stackable: !!f.stackable, ...(f.assignedTokens.length ? { assignedTokens: f.assignedTokens } : {}), note: f.note || undefined, maxRedemptions: f.maxRedemptions ? Number(f.maxRedemptions) : null };
    if (f.kind === 'discount') { if (Number(f.percentOff)) body.percentOff = Number(f.percentOff); if (Number(f.freeMonths)) body.freeMonths = Number(f.freeMonths); if (Number(f.minMonths)) body.minMonths = Number(f.minMonths); }
    if (f.kind === 'free_hosting' || f.kind === 'free_pool') { body.storageGB = Number(f.storageGB); if (Number(f.uploadMbps)) body.uploadMbps = Number(f.uploadMbps); if (Number(f.hostMonths)) body.hostMonths = Number(f.hostMonths); }
    if (f.kind === 'free_boost') body.boostDays = Number(f.boostDays);
    try { const r = await api.post('/admin/promo', body); toast.success(t('pc.created', 'Code {code} created.').replace('{code}', r.code.code)); setF((s) => ({ ...s, code: '', assignedTokens: [], assignInput: '' })); reload(); }
    catch (x) { toast.error(x.data?.error === 'discount_needs_value' ? t('pc.err.discount', 'Set a % off or free months.') : x.data?.error === 'code_exists' ? t('pc.err.exists', 'That code already exists.') : x.data?.error === 'hosting_needs_storage' ? t('pc.err.storage', 'Set the storage GB.') : x.data?.error === 'boost_needs_days' ? t('pc.err.boost', 'Set the boost days.') : t('common.failed', 'Failed.')); }
  };
  const toggle = async (c) => { try { await api.patch(`/admin/promo/${c.id}`, { active: !c.active }); reload(); } catch { toast.error(t('common.failed', 'Failed.')); } };
  const toggleStack = async (c) => { try { await api.patch(`/admin/promo/${c.id}`, { stackable: !c.stackable }); reload(); } catch { toast.error(t('common.failed', 'Failed.')); } };
  const del = (c) => undo.del(c.id, () => api.del(`/admin/promo/${c.id}`), t('common.deleted', 'Deleted.'));
  const [openId, setOpenId] = useState(null);
  const [reds, setReds] = useState({});
  const viewReds = async (c) => {
    if (openId === c.id) { setOpenId(null); return; }
    setOpenId(c.id);
    if (!reds[c.id]) { try { const r = await api.get(`/admin/promo/${c.id}/redemptions`); setReds((s) => ({ ...s, [c.id]: r.redemptions })); } catch { toast.error(t('common.loadfail', 'Failed to load.')); } }
  };
  const desc = (c) => c.kind === 'discount' ? [c.percentOff && t('pc.d.off', '{n}% off').replace('{n}', c.percentOff), c.freeMonths && t('pc.d.mofree', '{n} mo free').replace('{n}', c.freeMonths), c.minMonths && t('pc.d.minterm', '{n}mo+ term only').replace('{n}', c.minMonths)].filter(Boolean).join(' + ')
    : (c.kind === 'free_hosting' || c.kind === 'free_pool') ? `${c.storageGB}GB${c.uploadMbps ? ` · ${c.uploadMbps}Mbps` : ''}${c.hostMonths ? ` · ${c.hostMonths}mo` : ` · ${t('pc.d.forever', 'forever')}`}`
    : t('pc.d.boost', 'boost {n} days').replace('{n}', c.boostDays);
  return (
    <div>
      <h2 className="font-semibold mb-1 flex items-center gap-2"><Ticket size={16} className="text-[var(--primary-2)]" /> {t('pc.title', 'Promo codes')}</h2>
      <p className="text-xs text-[var(--muted)] mb-3">{t('pc.sub', 'Single-use / limited discount, free-hosting and boost codes — separate from the site-wide Promotions above.')}</p>
      <Card className="p-4 mb-4">
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label={t('pc.f.type', 'Type')}><Dropdown className="w-full" value={f.kind} onChange={(v) => set('kind', v)} options={[{ value: 'discount', label: t('pc.t.discount', 'Discount (% off / months free)') }, { value: 'free_hosting', label: t('pc.t.hosting', 'Free hosting (one repo)') }, { value: 'free_pool', label: t('pc.t.pool', 'Free storage pool') }, { value: 'free_boost', label: t('pc.t.boost', 'Free boost') }]} /></Field>
          <Field label={t('pc.f.code', 'Code (blank = auto-generate)')}><Input value={f.code} onChange={(e) => set('code', e.target.value)} placeholder="AUTO" /></Field>
          {f.kind === 'discount' && <><Field label={t('pc.f.pctoff', '% off')}><Input type="number" value={f.percentOff} onChange={(e) => set('percentOff', e.target.value)} /></Field><Field label={t('pc.f.freemonths', 'First months free')}><Input type="number" value={f.freeMonths} onChange={(e) => set('freeMonths', e.target.value)} /></Field><Field label={t('pc.f.minterm', 'Min. term months (0 = any)')}><Input type="number" value={f.minMonths} onChange={(e) => set('minMonths', e.target.value)} /></Field></>}
          {(f.kind === 'free_hosting' || f.kind === 'free_pool') && <><Field label={t('pc.f.storage', 'Storage GB')}><Input type="number" value={f.storageGB} onChange={(e) => set('storageGB', e.target.value)} /></Field><Field label={t('pc.f.upload', 'Upload Mbps')}><Input type="number" value={f.uploadMbps} onChange={(e) => set('uploadMbps', e.target.value)} /></Field><Field label={t('pc.f.duration', 'Duration (months, 0 = forever)')}><Input type="number" value={f.hostMonths} onChange={(e) => set('hostMonths', e.target.value)} /></Field></>}
          {f.kind === 'free_boost' && <Field label={t('pc.f.boostdays', 'Boost days')}><Input type="number" value={f.boostDays} onChange={(e) => set('boostDays', e.target.value)} /></Field>}
          <Field label={t('pc.f.maxred', 'Max redemptions (blank = ∞)')}><Input type="number" value={f.maxRedemptions} onChange={(e) => set('maxRedemptions', e.target.value)} placeholder="∞" /></Field>
          <Field label={t('pc.f.peruser', 'Per-user limit')}><Input type="number" value={f.perUserLimit} onChange={(e) => set('perUserLimit', e.target.value)} /></Field>
          <Field label={t('pc.f.note', 'Note (internal)')}><Input value={f.note} onChange={(e) => set('note', e.target.value)} placeholder={t('pc.f.note.ph', 'e.g. launch promo')} /></Field>
        </div>
        <label className="flex items-center gap-2 text-sm text-[var(--muted)] mt-3 cursor-pointer w-fit" title={t('pc.f.stackable.h', 'Allow this code to be combined with OTHER stackable codes in one cart. Non-stackable codes must be used alone.')}>
          <input type="checkbox" checked={f.stackable} onChange={(e) => set('stackable', e.target.checked)} /> {t('pc.f.stackable', 'Stackable — can be combined with other stackable codes')}
        </label>
        <div className="mt-3">
          <Field label={t('pc.f.assign', 'Assign to specific people (gift code)')} hint={t('pc.f.assign.h2', 'If set, ONLY people matching one of these identifiers can redeem. No linked account required — it unlocks the moment that email / Discord id / creator id / BCWEB id belongs to the signed-in account. Leave empty for anyone.')}>
            <div className="flex flex-col sm:flex-row gap-2">
              <Select className="sm:!w-44" value={f.assignType} onChange={(e) => set('assignType', e.target.value)}>
                <option value="email">{t('pc.assign.email', 'Email')}</option>
                <option value="discord">{t('pc.assign.discord', 'Discord id')}</option>
                <option value="creator">{t('pc.assign.creator', 'BMM creator id')}</option>
                <option value="bcid">{t('pc.assign.bcid', 'BCWEB user id')}</option>
              </Select>
              <Input value={f.assignInput} onChange={(e) => set('assignInput', e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addToken())} placeholder={f.assignType === 'email' ? 'user@email.com' : f.assignType === 'discord' ? '123456789012345678' : f.assignType === 'creator' ? 'creator-id' : 'bcweb-user-id'} />
              <Button type="button" onClick={addToken}><Plus size={13} /> {t('pc.assign.add', 'Add')}</Button>
            </div>
            {f.assignedTokens.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {f.assignedTokens.map((tok) => { const [ty, ...rest] = tok.split(':'); const val = rest.join(':'); return (
                  <span key={tok} className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-[var(--surface-2)] border border-[var(--line)] text-xs">
                    <span className="text-[10px] font-bold uppercase text-[var(--primary-2)]">{ty}</span><span className="font-mono truncate max-w-[14rem]">{val}</span>
                    <button type="button" onClick={() => removeToken(tok)} className="text-[var(--faint)] hover:text-error"><X size={11} /></button>
                  </span>
                ); })}
              </div>
            )}
          </Field>
        </div>
        <div className="flex justify-end mt-3"><Button variant="primary" onClick={create}><Plus size={15} /> {t('pc.create', 'Create code')}</Button></div>
      </Card>
      {loading ? <Loading /> : codes.length ? <div className="space-y-2">
        {codes.map((c) => (
          <Card key={c.id} className="p-4">
            <div className="flex items-center gap-3">
              <Ticket size={18} className={c.active ? 'text-[var(--primary-2)]' : 'text-[var(--faint)]'} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap"><code className="font-mono font-semibold">{c.code}</code><button onClick={() => { navigator.clipboard?.writeText(c.code); toast.success(t('common.copied', 'Copied.')); }} className="text-[var(--faint)] hover:text-[var(--primary-2)]"><Copy size={13} /></button>{!c.active && <Badge>{t('pc.disabled', 'Disabled')}</Badge>}{c.stackable && <Badge tone="green"><Layers size={9} /> {t('pc.stackable', 'stackable')}</Badge>}{((c.assignedUserIds?.length || 0) + (c.assignedTokens?.length || 0)) > 0 && <Badge tone="primary"><Gift size={9} /> {t('pc.gift', 'gift · {n}').replace('{n}', (c.assignedUserIds?.length || 0) + (c.assignedTokens?.length || 0))}</Badge>}</div>
                <div className="text-xs text-[var(--muted)] mt-0.5"><Badge tone="primary">{c.kind.replace('_', ' ')}</Badge> {desc(c)}{c.expiresAt ? ` · exp ${new Date(c.expiresAt).toLocaleDateString()}` : ''}{c.note ? ` · ${c.note}` : ''}</div>
              </div>
              <button onClick={() => viewReds(c)} className={`text-xs px-2.5 py-1.5 rounded-lg border ${openId === c.id ? 'border-[var(--primary)] text-[var(--text)]' : 'border-[var(--line)] text-[var(--muted)] hover:text-[var(--text)]'}`}><Users size={12} className="inline mr-1" />{c.redeemedCount}{c.maxRedemptions ? `/${c.maxRedemptions}` : ''} {t('pc.used', 'used')}</button>
              <Button size="sm" variant="ghost" onClick={() => toggleStack(c)} title={t('pc.f.stackable.h', 'Allow this code to be combined with OTHER stackable codes in one cart. Non-stackable codes must be used alone.')}><Layers size={13} /> {c.stackable ? t('pc.unstack', 'Unstack') : t('pc.stack', 'Stack')}</Button>
              <Button size="sm" onClick={() => toggle(c)}>{c.active ? t('pc.disable', 'Disable') : t('pc.enable', 'Enable')}</Button>
              <Button size="sm" className="!text-error" onClick={() => del(c)}><Trash2 size={14} /></Button>
            </div>
            {openId === c.id && (
              <div className="mt-3 pt-3 border-t border-[var(--line)]">
                {!reds[c.id] ? <div className="text-xs text-[var(--muted)] flex items-center gap-2"><Spinner /> {t('common.loading', 'Loading…')}</div>
                  : reds[c.id].length ? <div className="space-y-1.5">
                    {reds[c.id].map((r) => (
                      <div key={r.id} className="flex items-center gap-2.5 text-sm">
                        <Users size={13} className="text-[var(--faint)] shrink-0" />
                        <span className="font-medium">{r.user?.displayName}</span>
                        <span className="text-xs text-[var(--faint)] truncate">{r.user?.email}</span>
                        <span className="text-xs text-[var(--muted)] flex-1 truncate">· {r.detail}</span>
                        <span className="text-[11px] text-[var(--faint)] shrink-0">{new Date(r.createdAt).toLocaleString()}</span>
                      </div>
                    ))}
                  </div> : <div className="text-xs text-[var(--faint)]">{t('pc.noreds', 'No redemptions yet.')}</div>}
              </div>
            )}
          </Card>
        ))}
      </div> : <EmptyState icon={Ticket} title={t('pc.none.t', 'No promo codes yet')} sub={t('pc.none.s', 'Create one above — discount, free hosting, or a free boost.')} />}
    </div>
  );
}

// Admin: site-wide promo CAMPAIGNS (auto-applied discount + announcement badge) —
// distinct from the code-based promo codes above. One resolver picks the campaign
// live right now; its % is applied at checkout and its badge shows across the site.
function AdminCampaigns() {
  const toast = useToast(); const { t } = useI18n();
  const { data, loading, reload } = useAsync(() => api.get('/admin/campaigns'), []);
  const toLocal = (d) => { const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
  const blank = () => ({ name: '', kind: 'custom', percentOff: 20, appliesTo: 'all', startsAt: toLocal(new Date()), endsAt: toLocal(new Date(Date.now() + 3 * 864e5)), badgeMessageEn: '', badgeMessageFr: '', badgeColor: '', badgeLink: '', badgeEnabled: true });
  const [f, setF] = useState(blank);
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const undo = useUndoableDelete(reload);
  const list = (data?.campaigns || []).filter((c) => !undo.pending.has(c.id));
  // Quick presets the admin can then tweak.
  const presetRandom = () => setF((s) => ({ ...s, name: 'Flash sale', kind: 'flash', percentOff: 10 + Math.floor(Math.random() * 41), appliesTo: 'all', startsAt: toLocal(new Date()), endsAt: toLocal(new Date(Date.now() + 2 * 864e5)), badgeMessageEn: 'Flash sale — limited time!', badgeMessageFr: 'Vente flash — durée limitée !' }));
  const presetBlackFriday = () => setF((s) => ({ ...s, name: 'Black Friday', kind: 'black_friday', percentOff: 30, appliesTo: 'all', badgeMessageEn: 'Black Friday — 30% off!', badgeMessageFr: 'Black Friday — 30% de remise !', badgeColor: '#111111' }));
  const create = async () => {
    if (!f.name.trim()) return toast.error(t('cmp.err.name', 'Name is required.'));
    const body = {
      name: f.name.trim(), kind: f.kind, percentOff: Number(f.percentOff), appliesTo: f.appliesTo,
      startsAt: new Date(f.startsAt).toISOString(), endsAt: new Date(f.endsAt).toISOString(),
      badgeEnabled: !!f.badgeEnabled, badgeMessageEn: f.badgeMessageEn || '', badgeMessageFr: f.badgeMessageFr || '',
      badgeColor: f.badgeColor.trim() || '', badgeLink: f.badgeLink.trim() || '',
    };
    try { await api.post('/admin/campaigns', body); toast.success(t('cmp.created', 'Campaign created.')); setF(blank()); reload(); }
    catch (x) { toast.error(x.data?.error === 'end_before_start' ? t('cmp.err.dates', 'End must be after start.') : x.data?.error === 'bad_color' ? t('cmp.err.color', 'Color must be a hex like #f97316.') : x.data?.error === 'bad_link' ? t('cmp.err.link', 'Link must be an internal /path or an https:// URL.') : t('common.failed', 'Failed.')); }
  };
  const toggle = async (c) => { try { await api.patch(`/admin/campaigns/${c.id}`, { active: !c.active }); reload(); } catch { toast.error(t('common.failed', 'Failed.')); } };
  const del = (c) => undo.del(c.id, () => api.del(`/admin/campaigns/${c.id}`), t('common.deleted', 'Deleted.'));
  const status = (c) => {
    const now = Date.now(), s = new Date(c.startsAt).getTime(), e = new Date(c.endsAt).getTime();
    if (!c.active) return { label: t('cmp.st.off', 'Disabled'), tone: undefined };
    if (now < s) return { label: t('cmp.st.scheduled', 'Scheduled'), tone: 'primary' };
    if (now > e) return { label: t('cmp.st.ended', 'Ended'), tone: undefined };
    return { label: t('cmp.st.live', 'Live now'), tone: 'green' };
  };
  return (
    <div>
      <h2 className="font-semibold mb-1 flex items-center gap-2"><Megaphone size={16} className="text-[var(--primary-2)]" /> {t('cmp.title', 'Promotions (campaigns)')}</h2>
      <p className="text-xs text-[var(--muted)] mb-3">{t('cmp.sub', 'A site-wide, time-boxed sale: auto-applies its % at checkout and shows an announcement badge across the whole site. One campaign is live at a time (the most recently started wins).')}</p>
      <Card className="p-4 mb-4">
        <div className="flex flex-wrap gap-2 mb-3">
          <Button size="sm" onClick={presetRandom}><Sparkles size={13} /> {t('cmp.preset.random', 'Random flash sale')}</Button>
          <Button size="sm" onClick={presetBlackFriday}><Tag size={13} /> {t('cmp.preset.bf', 'Black Friday')}</Button>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label={t('cmp.f.name', 'Name (internal)')}><Input value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="Black Friday 2026" /></Field>
          <Field label={t('cmp.f.kind', 'Kind')}><Dropdown className="w-full" value={f.kind} onChange={(v) => set('kind', v)} options={[{ value: 'custom', label: t('cmp.k.custom', 'Custom') }, { value: 'black_friday', label: 'Black Friday' }, { value: 'new_year', label: t('cmp.k.ny', 'New Year') }, { value: 'flash', label: t('cmp.k.flash', 'Flash sale') }]} /></Field>
          <Field label={t('cmp.f.pct', '% off')}><Input type="number" value={f.percentOff} onChange={(e) => set('percentOff', e.target.value)} /></Field>
          <Field label={t('cmp.f.applies', 'Applies to')}><Dropdown className="w-full" value={f.appliesTo} onChange={(v) => set('appliesTo', v)} options={[{ value: 'all', label: t('cmp.a.all', 'All one-time purchases') }, { value: 'hosting', label: t('cmp.a.hosting', 'Hosting only') }, { value: 'boost', label: t('cmp.a.boost', 'Boost only') }, { value: 'myo', label: t('cmp.a.myo', 'Consultations only') }]} /></Field>
          {/* Said here rather than discovered at the till. Recurring charges — catalog
              hosting, pool consolidation — cannot take a percentage off their unit price
              without the sale outliving the campaign, so they are never discounted. */}
          <div className="text-[11px] text-[var(--faint)] -mt-1">{t('cmp.a.note', 'One-time payments only. Recurring subscriptions (catalog hosting, consolidated pools) are never discounted — a sale would outlive the campaign.')}</div>
          <Field label={t('cmp.f.start', 'Starts')}><Input type="datetime-local" value={f.startsAt} onChange={(e) => set('startsAt', e.target.value)} /></Field>
          <Field label={t('cmp.f.end', 'Ends')}><Input type="datetime-local" value={f.endsAt} onChange={(e) => set('endsAt', e.target.value)} /></Field>
          <Field label={t('cmp.f.msgen', 'Badge message (EN)')}><Input value={f.badgeMessageEn} onChange={(e) => set('badgeMessageEn', e.target.value)} placeholder="Black Friday — 30% off!" /></Field>
          <Field label={t('cmp.f.msgfr', 'Badge message (FR)')}><Input value={f.badgeMessageFr} onChange={(e) => set('badgeMessageFr', e.target.value)} placeholder="Black Friday — 30% !" /></Field>
          <Field label={t('cmp.f.color', 'Badge color (hex, blank = brand)')}><Input value={f.badgeColor} onChange={(e) => set('badgeColor', e.target.value)} placeholder="#f97316" /></Field>
          <Field label={t('cmp.f.link', 'Badge link (optional)')} hint={t('cmp.f.link.h', 'Where clicking the badge goes: an internal path like /blog/black-friday, or a full https:// URL.')}><Input value={f.badgeLink} onChange={(e) => set('badgeLink', e.target.value)} placeholder="/blog/… or https://…" /></Field>
        </div>
        <label className="flex items-center gap-2 text-sm text-[var(--muted)] mt-3 cursor-pointer w-fit">
          <input type="checkbox" checked={f.badgeEnabled} onChange={(e) => set('badgeEnabled', e.target.checked)} /> {t('cmp.f.badge', 'Show the announcement badge across the site')}
        </label>
        <div className="flex justify-end mt-3"><Button variant="primary" onClick={create}><Plus size={15} /> {t('cmp.create', 'Create campaign')}</Button></div>
      </Card>
      {loading ? <Loading /> : list.length ? <div className="space-y-2">
        {list.map((c) => { const st = status(c); return (
          <Card key={c.id} className="p-4">
            <div className="flex items-center gap-3 flex-wrap">
              <Megaphone size={18} className={st.label === t('cmp.st.live', 'Live now') ? 'text-[var(--primary-2)]' : 'text-[var(--faint)]'} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap"><span className="font-semibold">{c.name}</span><Badge tone={st.tone}>{st.label}</Badge><Badge tone="primary">−{c.percentOff}%</Badge>{c.badgeEnabled && <Badge><Megaphone size={9} /> {t('cmp.badgeon', 'badge')}</Badge>}</div>
                <div className="text-xs text-[var(--muted)] mt-0.5">{c.kind.replace('_', ' ')} · {c.appliesTo} · {new Date(c.startsAt).toLocaleString()} → {new Date(c.endsAt).toLocaleString()}{(c.badgeMessageFr || c.badgeMessageEn) ? ` · "${c.badgeMessageFr || c.badgeMessageEn}"` : ''}</div>
              </div>
              <Button size="sm" onClick={() => toggle(c)}>{c.active ? t('cmp.disable', 'Disable') : t('cmp.enable', 'Enable')}</Button>
              <Button size="sm" className="!text-error" onClick={() => del(c)}><Trash2 size={14} /></Button>
            </div>
          </Card>
        ); })}
      </div> : <EmptyState icon={Megaphone} title={t('cmp.none.t', 'No campaigns yet')} sub={t('cmp.none.s', 'Create one above — a Black Friday sale, a flash sale, anything.')} />}
    </div>
  );
}

// Admin: site EVENTS (New Year, national holidays…). One event is live at a time; while
// live it plays a full-screen fireworks effect (flag-forming burst for a national
// holiday) and shows a custom announcement. Effect runtime + notifications land in
// later phases; this panel owns the schedule + content + one-at-a-time enforcement.
function AdminEvents() {
  const toast = useToast(); const { t } = useI18n();
  const { data, loading, reload } = useAsync(() => api.get('/admin/events'), []);
  const toLocal = (d) => { const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
  const blank = () => ({ name: '', kind: 'custom', countryCode: '', startsAt: toLocal(new Date()), endsAt: toLocal(new Date(Date.now() + 2 * 864e5)), titleEn: '', titleFr: '', messageEn: '', messageFr: '', notifyDaysBefore: 3, eventCode: '', fxDensity: 4, fxSize: 5, fxFlagDrops: 2, badgeIcon: 'sparkles', linkUrl: '', promoPercent: 0 });
  const [f, setF] = useState(blank);
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const undo = useUndoableDelete(reload);
  const list = (data?.events || []).filter((e) => !undo.pending.has(e.id));
  // The copy is the first thing anyone reads, and "Fireworks on us" described the effect
  // playing behind it rather than saying anything. These greet the reader instead.
  const presetNY = () => setF((s) => ({ ...s, name: 'New Year', kind: 'new_year', countryCode: '', badgeIcon: 'party', effect: 'fireworks', titleEn: 'Happy New Year!', titleFr: 'Bonne année !', messageEn: 'Thank you for being part of this one. Here is to the next.', messageFr: 'Merci d\'avoir fait partie de cette année. À la prochaine.' }));
  const presetHoliday = () => setF((s) => ({ ...s, name: 'National day', kind: 'national_holiday', countryCode: s.countryCode || 'FR', badgeIcon: 'flag', effect: 'fireworks', titleEn: 'National day', titleFr: 'Fête nationale', messageEn: 'Look up — the colours are out tonight.', messageFr: 'Levez les yeux — les couleurs sont de sortie ce soir.' }));
  const create = async () => {
    if (!f.name.trim()) return toast.error(t('ev.err.name', 'Name is required.'));
    const body = {
      name: f.name.trim(), kind: f.kind, startsAt: new Date(f.startsAt).toISOString(), endsAt: new Date(f.endsAt).toISOString(),
      titleEn: f.titleEn || '', titleFr: f.titleFr || '', messageEn: f.messageEn || '', messageFr: f.messageFr || '',
      notifyDaysBefore: Number(f.notifyDaysBefore) || 0, eventCode: f.eventCode.trim() || '',
      fxDensity: Number(f.fxDensity) || 4, fxSize: Number(f.fxSize) || 5, fxFlagDrops: f.fxFlagDrops === '' || f.fxFlagDrops == null ? 2 : Math.max(0, Number(f.fxFlagDrops) || 0), badgeIcon: f.badgeIcon, linkUrl: (f.linkUrl || '').trim(), promoPercent: Number(f.promoPercent) || 0,
      ...(f.kind === 'national_holiday' ? { countryCode: f.countryCode.trim().toUpperCase() } : {}),
    };
    try { await api.post('/admin/events', body); toast.success(t('ev.created', 'Event created.')); setF(blank()); reload(); }
    catch (x) {
      const e = x.data?.error;
      toast.error(e === 'end_before_start' ? t('ev.err.dates', 'End must be after start.')
        : e === 'country_required' ? t('ev.err.country', 'Pick a country (2-letter code) for a national holiday.')
        : e === 'overlap' ? t('ev.err.overlap', 'Overlaps the active event "{n}" — only one event runs at a time.').replace('{n}', x.data?.with || '')
        : t('common.failed', 'Failed.'));
    }
  };
  const toggle = async (e) => { try { await api.patch(`/admin/events/${e.id}`, { active: !e.active }); reload(); } catch (x) { toast.error(x.data?.error === 'overlap' ? t('ev.err.overlap2', 'Another event is active in that window.') : t('common.failed', 'Failed.')); } };
  const del = (e) => undo.del(e.id, () => api.del(`/admin/events/${e.id}`), t('common.deleted', 'Deleted.'));
  const status = (e) => {
    const now = Date.now(), s = new Date(e.startsAt).getTime(), en = new Date(e.endsAt).getTime();
    if (!e.active) return { label: t('ev.st.off', 'Disabled'), tone: undefined };
    if (now < s) return { label: t('ev.st.scheduled', 'Scheduled'), tone: 'primary' };
    if (now > en) return { label: t('ev.st.ended', 'Ended'), tone: undefined };
    return { label: t('ev.st.live', 'Live now'), tone: 'green' };
  };
  return (
    <div>
      <h2 className="font-semibold mb-1 flex items-center gap-2"><Sparkles size={16} className="text-[var(--primary-2)]" /> {t('ev.title', 'Events')}</h2>
      <p className="text-xs text-[var(--muted)] mb-3">{t('ev.sub', 'One event runs at a time. While live it plays a fireworks effect (a national holiday forms the country flag) and shows your announcement. Notifications + the event promo/code arrive in the next phases.')}</p>
      <Card className="p-4 mb-4">
        <div className="flex flex-wrap gap-2 mb-3">
          <Button size="sm" onClick={presetNY}><Sparkles size={13} /> {t('ev.preset.ny', 'New Year')}</Button>
          <Button size="sm" onClick={presetHoliday}><Flag size={13} /> {t('ev.preset.holiday', 'National holiday')}</Button>
        </div>
        {/* Grouped by intent. This was one flat two-column grid of every field in no
            particular order — the schedule, the badge copy, the effect tuning and the promo
            code interleaved — so setting an event up meant hunting for the next field
            instead of working down a form. */}
        <div className="mb-4">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--faint)] mb-2 pb-1 border-b border-[var(--line)]">{t('ev.g.event', 'The event')}</div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <Field label={t('ev.f.name', 'Name (internal)')}><Input value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="New Year 2027" /></Field>
          <Field label={t('ev.f.kind', 'Kind')}><Dropdown className="w-full" value={f.kind} onChange={(v) => set('kind', v)} options={[{ value: 'custom', label: t('ev.k.custom', 'Custom') }, { value: 'new_year', label: t('ev.k.ny', 'New Year') }, { value: 'national_holiday', label: t('ev.k.holiday', 'National holiday') }]} /></Field>
          {f.kind === 'national_holiday' && <Field label={t('ev.f.country', 'Country code (ISO, e.g. FR, US)')}><Input value={f.countryCode} onChange={(e) => set('countryCode', e.target.value.toUpperCase().slice(0, 2))} placeholder="FR" /></Field>}
          <Field label={t('ev.f.start', 'Starts')}><Input type="datetime-local" value={f.startsAt} onChange={(e) => set('startsAt', e.target.value)} /></Field>
          <Field label={t('ev.f.end', 'Ends')}><Input type="datetime-local" value={f.endsAt} onChange={(e) => set('endsAt', e.target.value)} /></Field>
          <Field label={t('ev.f.notify', 'Notify users (days before)')}><Input type="number" value={f.notifyDaysBefore} onChange={(e) => set('notifyDaysBefore', e.target.value)} /></Field>
          </div>
        </div>
        <div className="mb-4">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--faint)] mb-2 pb-1 border-b border-[var(--line)]">{t('ev.g.badge', 'Announcement badge')}</div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <Field label={t('ev.f.icon', 'Announcement icon (no emoji)')}><Select value={f.badgeIcon} onChange={(e) => set('badgeIcon', e.target.value)}><option value="sparkles">Sparkles</option><option value="party">Party</option><option value="flag">Flag</option><option value="gift">Gift</option><option value="star">Star</option><option value="rocket">Rocket</option><option value="calendar">Calendar</option><option value="bell">Bell</option></Select></Field>
          <Field label={t('ev.f.titleen', 'Title (EN)')}><Input value={f.titleEn} onChange={(e) => set('titleEn', e.target.value)} placeholder="Happy New Year!" /></Field>
          <Field label={t('ev.f.titlefr', 'Title (FR)')}><Input value={f.titleFr} onChange={(e) => set('titleFr', e.target.value)} placeholder="Bonne année !" /></Field>
          <Field label={t('ev.f.msgen', 'Message (EN)')}><Input value={f.messageEn} onChange={(e) => set('messageEn', e.target.value)} /></Field>
          <Field label={t('ev.f.msgfr', 'Message (FR)')}><Input value={f.messageFr} onChange={(e) => set('messageFr', e.target.value)} /></Field>
          <Field label={t('ev.f.link', 'Badge link (path or URL, optional)')} hint={t('ev.f.link.h', 'Where the announcement badge sends the user. e.g. /hosting or https://…')}><Input value={f.linkUrl} onChange={(e) => set('linkUrl', e.target.value)} placeholder="/hosting" /></Field>
          </div>
        </div>
        <div className="mb-4">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--faint)] mb-2 pb-1 border-b border-[var(--line)]">{t('ev.g.fx', 'Fireworks')}</div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <Field label={t('ev.f.effect', 'Fireworks')} hint={t('ev.f.effect.h', 'New Year and national days play them by default — this is how you run one quietly.')}>
            <Dropdown className="w-full" value={f.effect || ''} onChange={(v) => set('effect', v)} options={[
              { value: '', label: t('ev.fx.auto', 'Automatic (on for New Year / national day)') },
              { value: 'fireworks', label: t('ev.fx.on', 'Always on') },
              { value: 'none', label: t('ev.fx.off', 'Off') },
            ]} />
          </Field>
          <Field label={t('ev.f.density', 'Fireworks amount (1–10)')} hint={t('ev.f.density.h', 'How many at once. Lower = calmer / less intrusive.')}><Input type="number" min="1" max="10" value={f.fxDensity} onChange={(e) => set('fxDensity', e.target.value)} /></Field>
          <Field label={t('ev.f.size', 'Fireworks size (1–10)')}><Input type="number" min="1" max="10" value={f.fxSize} onChange={(e) => set('fxSize', e.target.value)} /></Field>
          <Field label={t('ev.f.flagdrops', 'Flag drops (times the flag forms, random)')} hint={t('ev.f.flagdrops.h', 'Each one appears somewhere new. Only one flag is ever in the sky at a time, so a show fits about three — ask for more and the extras wait for the next run.')}><Input type="number" min="0" max="20" value={f.fxFlagDrops} onChange={(e) => set('fxFlagDrops', e.target.value)} /></Field>
          </div>
        </div>
        <div className="mb-4">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--faint)] mb-2 pb-1 border-b border-[var(--line)]">{t('ev.g.promo', 'Promotion')}</div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <Field label={t('ev.f.promo', 'Event discount % (0 = none)')} hint={t('ev.f.promo.h', 'Creates a site-wide discount + badge for the event window, and (with a code below) an event-only code carrying this %.')}><Input type="number" min="0" max="100" value={f.promoPercent} onChange={(e) => set('promoPercent', e.target.value)} /></Field>
          <Field label={t('ev.f.code', 'Event-only promo code (optional)')} hint={t('ev.f.code.h', 'A code valid ONLY during the event window, broadcast to users in the event notification.')}><Input value={f.eventCode} onChange={(e) => set('eventCode', e.target.value.toUpperCase())} placeholder="NY2027" /></Field>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 mt-3">
          <Button variant="ghost" onClick={() => window.dispatchEvent(new CustomEvent('bcw:fx-preview', { detail: { effect: 'fireworks', kind: f.kind, countryCode: (f.countryCode || '').trim().toUpperCase(), fxDensity: Number(f.fxDensity) || 4, fxSize: Number(f.fxSize) || 5, fxFlagDrops: f.fxFlagDrops === '' || f.fxFlagDrops == null ? 2 : Math.max(0, Number(f.fxFlagDrops) || 0) } }))}
            title={t('ev.preview.h', 'Plays the fireworks now with the current density / flag-drops (ignores reduce-motion) so you can tune it.')}><Sparkles size={15} /> {t('ev.preview', 'Preview effect')}</Button>
          <Button variant="primary" onClick={create}><Plus size={15} /> {t('ev.create', 'Create event')}</Button>
        </div>
      </Card>
      {loading ? <Loading /> : list.length ? <div className="space-y-2">
        {list.map((e) => { const st = status(e); return (
          <Card key={e.id} className="p-4">
            <div className="flex items-center gap-3 flex-wrap">
              <Sparkles size={18} className={st.tone === 'green' ? 'text-[var(--primary-2)]' : 'text-[var(--faint)]'} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap"><span className="font-semibold">{e.name}</span><Badge tone={st.tone}>{st.label}</Badge><Badge tone="primary">{e.kind.replace('_', ' ')}</Badge>{e.countryCode && <Badge>{e.countryCode}</Badge>}{e.promoPercent > 0 && <Badge tone="primary">−{e.promoPercent}%</Badge>}{e.eventCode && <Badge tone="green"><Ticket size={9} /> {e.eventCode}</Badge>}</div>
                <div className="text-xs text-[var(--muted)] mt-0.5">{e.effect} · fx {e.fxDensity}/10 · {e.fxFlagDrops} {t('ev.flags', 'flag drops')} · {new Date(e.startsAt).toLocaleString()} → {new Date(e.endsAt).toLocaleString()}{e.notifyDaysBefore ? ` · ${t('ev.notifd', 'notify {n}d before').replace('{n}', e.notifyDaysBefore)}` : ''}{(e.titleFr || e.titleEn) ? ` · "${e.titleFr || e.titleEn}"` : ''}</div>
              </div>
              <Button size="sm" onClick={() => toggle(e)}>{e.active ? t('ev.disable', 'Disable') : t('ev.enable', 'Enable')}</Button>
              <Button size="sm" className="!text-error" onClick={() => del(e)}><Trash2 size={14} /></Button>
            </div>
          </Card>
        ); })}
      </div> : <EmptyState icon={Sparkles} title={t('ev.none.t', 'No events yet')} sub={t('ev.none.s', 'Create one above — New Year, a national holiday, anything.')} />}
    </div>
  );
}

// Admin: OAuth/OIDC clients — register a service to "Sign in with BetterCommunity".
// BCWEB is the identity provider; discovery lives at /.well-known/openid-configuration.
// The SSO tab, in two halves.
//
// "Clients" is the registry — who may ask us to sign people in. "People" is the
// consequence — who actually said yes, and to what. The registry alone answers none of the
// questions that come up in practice ("is anyone still using this app?", "cut this person's
// access"), which is why the second half exists.
// What each scope unlocks, in the words a consent screen would use — the tooltip on the
// picker. A scope name is precise and says nothing to somebody deciding whether to grant it.
const SSO_SCOPE_HELP = {
  openid: 'Sign-in / identity (required)',
  profile: 'Display name and avatar',
  email: 'E-mail address',
  items: 'Their catalog items',
  repos: 'Their hosted Server-Repos',
  pools: 'Their storage pools',
  catalogs: 'The catalogs they own, unpublished included',
  payments: 'Invoices — amounts and dates, never a card number',
  polls: 'Polls open to them and how they answered',
  favorites: 'Repos and catalogs they starred',
  transfers: 'Ownership transfers offered to or by them',
  notifications: 'Read their notifications (read-only)',
  badges: 'Badges they have earned',
  stats: 'Download and view counts for what they own, aggregated',
};

function AdminSso() {
  const { t } = useI18n();
  const [view, setView] = useState('clients');
  return (
    <div>
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <h2 className="font-semibold flex items-center gap-2 mr-2"><Shield size={16} className="text-[var(--primary-2)]" /> {t('sso.title', 'SSO')}</h2>
        <div className="inline-flex rounded-[12px] bg-[var(--surface-2)] p-0.5">
          {[['clients', t('sso.tab.clients', 'Apps')], ['people', t('sso.tab.people', 'People')], ['webhooks', t('sso.tab.webhooks', 'Webhooks')]].map(([k, l]) => (
            <button key={k} onClick={() => setView(k)}
              className={`px-3 py-1.5 rounded-[10px] text-sm ${view === k ? 'bg-[var(--bg-solid)] font-medium shadow-sm' : 'text-[var(--muted)]'}`}>{l}</button>
          ))}
        </div>
      </div>
      {view === 'clients' ? <AdminOAuthClients /> : view === 'people' ? <AdminSsoPeople /> : <AdminWebhooks />}
    </div>
  );
}

// Every webhook on the platform, and the state of the delivery queue.
//
// GET /admin/webhooks has existed since webhooks shipped and nothing called it — the
// data was collected, ordered worst-first, and shown to nobody. It belongs here rather
// than in its own tab: an OAuth app and a webhook are the same question ("what is
// plugged into this platform, on whose behalf"), and a third top-level tab for one table
// is how the admin nav got crowded enough to need reorganising in the first place.
/**
 * One step and everything under it.
 *
 * The panel used to say "12 steps" and list the risky verbs, which answers "should I be
 * nervous" and not "what does this actually do" — and the second question is the one a
 * moderator has when the answer to the first is "a bit".
 *
 * Indentation carries the shape, because the shape IS the meaning: three actions in a row
 * and three inside a hundred-iteration loop are the same list and very different files.
 */
function BmmpaStep({ node, depth = 0, t }) {
  const params = node.params ? Object.entries(node.params) : [];
  return (
    <>
      <div className="border-l-2 border-[var(--line)] pl-2 py-0.5" style={{ marginLeft: depth * 14 }}>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[12px]">{node.type || node.kind}</span>
          {/* A glyph, not colour alone: a faint red word is easy to skim past on a light
              theme, and this is the thing not to skim. */}
          {node.note && <span className="text-[10px] font-bold text-[var(--danger)] border border-[var(--danger)] rounded px-1">!</span>}
          {node.refId && (node.refName
            ? <span className="text-[11px] text-[var(--muted)]">→ {node.refName}</span>
            : <span className="text-[11px] text-[var(--warning)]">→ {t('bmi.notIncluded', 'not in this file')}: <code>{node.refId}</code></span>)}
        </div>
        {params.length > 0 && (
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
            {params.map(([k, v]) => (
              <span key={k} className="text-[10px] text-[var(--muted)] break-all">
                <span className="text-[var(--faint)] mr-1">{k}</span>{v}
              </span>
            ))}
          </div>
        )}
      </div>
      {(node.children || []).map((c, i) => <BmmpaStep key={i} node={c} depth={depth + 1} t={t} />)}
    </>
  );
}

// Read a submitted BMM automation (.bmmpa) without running it.
//
// A preset arrives as a file whose contents nobody can see. The only way to know what it
// did was to import it into a real BMM — the commitment, made by the person deciding
// whether to allow it. This shows what it would do, from the document alone.
//
// Paste rather than upload, deliberately: the file is already on the moderator's machine,
// and an upload endpoint for arbitrary JSON is a thing to secure for no gain here.
function BmmpaInspector() {
  const { t } = useI18n(); const toast = useToast();
  // The API returns codes; the words are ours. An unknown code falls back to itself rather
  // than to a blank — a moderator seeing "app.frobnicate" learns something, a moderator
  // seeing nothing does not.
  const PERM = {
    command: t('bmi.p.command', 'Runs external programs'),
    script: t('bmi.p.script', 'Runs scripts (PowerShell / CMD / Bash / Python)'),
    deeplink: t('bmi.p.deeplink', 'Fires bmm:// deeplinks'),
    stopProcess: t('bmi.p.stop', 'Stops running programs'),
  };
  const REACH = {
    'custom.command': t('bmi.r.command', 'Runs an external program'),
    'custom.script': t('bmi.r.script', 'Runs a script'),
    'app.stop': t('bmi.r.stop', 'Stops a program'),
    'app.launch': t('bmi.r.launch', 'Launches an app'),
    'file.open': t('bmi.r.file', 'Opens a file or program'),
    'folder.open': t('bmi.r.folder', 'Opens a folder'),
    'open.url': t('bmi.r.url', 'Opens a URL'),
    restart: t('bmi.r.restart', 'Restarts BMM'),
    'task.run': t('bmi.r.task', 'Runs another scheduled task'),
  };
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [rep, setRep] = useState(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    let doc;
    // Parsed here first so a typo is answered instantly and locally, and so the server is
    // never asked to make sense of something that is not JSON at all.
    try { doc = JSON.parse(text); }
    catch { return toast.error(t('bmi.badjson', 'That is not valid JSON — paste the whole .bmmpa file.')); }
    setBusy(true); setRep(null);
    try { setRep(await api.post('/admin/inspect', { doc })); }
    catch (x) { toast.error(x?.data?.detail || t('common.failed', 'Failed.')); }
    finally { setBusy(false); }
  };

  if (!open) {
    return (
      <Button size="sm" className="mb-3" onClick={() => setOpen(true)}>
        <FileJson size={14} /> {t('bmi.openAny', 'Inspect a BMM file')}
      </Button>
    );
  }
  return (
    <Card className="p-4 mb-4">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="text-sm font-semibold flex items-center gap-2"><FileJson size={15} className="text-[var(--primary-2)]" /> {t('bmi.titleAny', 'Inspect a BMM file')}</div>
        <Button size="sm" variant="ghost" onClick={() => { setOpen(false); setRep(null); setText(''); }}>{t('common.close', 'Close')}</Button>
      </div>
      <p className="text-[12px] text-[var(--muted)] mb-2">
        {t('bmi.subAny', 'Paste any BMM file — automation, mod list, session replay, navbar config. It is read, never run: nothing is imported and nothing is fetched.')}
      </p>
      <Textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder='{"magic":"BMMPA","version":1,"tasks":[…]}' />
      <div className="flex gap-2 mt-2">
        <Button size="sm" variant="primary" disabled={busy || !text.trim()} onClick={run}>{busy ? <Spinner /> : t('bmi.read', 'Read it')}</Button>
      </div>

      {rep && (
        <div className="mt-3">
          {/* Not a format we know. The keys it DID see are in the message, because the next
              question is always "then what is this", and a refusal that does not say makes
              somebody open the file in a text editor to answer it. */}
          {rep.ok === false && (
            <div className="text-[12px] rounded-lg border border-[var(--warning)] text-[var(--warning)] p-2.5 mb-2">
              <div className="break-all">{rep.error}</div>
              {rep.hint && <div className="text-[var(--muted)] mt-1">{rep.hint}</div>}
            </div>
          )}

          {/* Everything that is not an automation: mod lists, replays, navbar configs. One
              renderer, because every reader returns the same summary shape — a per-format
              panel would be four screens to keep consistent instead of one. */}
          {rep.ok && rep.format && rep.format !== 'bmmpa' && (
            <div className="rounded-lg border border-[var(--line)] p-2.5 mb-2">
              <div className="flex items-baseline gap-2 flex-wrap">
                <b className="text-[13px]">{rep.title}</b>
                <span className="text-[11px] text-[var(--primary-2)]">{rep.format}</span>
              </div>
              <div className="mt-1.5 flex flex-col gap-0.5">
                {(rep.summary || []).map((r, i) => (
                  <div key={i} className={`text-[12px] break-all ${r.tone === 'warn' ? 'text-[var(--warning)]' : ''}`}>
                    <span className="text-[var(--faint)] mr-1.5">{r.label}</span>{r.value}
                  </div>
                ))}
              </div>
              {(rep.detail || []).length > 0 && (
                <details className="mt-2">
                  <summary className="text-[12px] cursor-pointer text-[var(--primary-2)]">{t('bmi.entries', 'Entries')} ({rep.detail.length})</summary>
                  <div className="mt-1.5 flex flex-col gap-0.5 max-h-64 overflow-auto">
                    {rep.detail.map((d, i) => (
                      <div key={i} className="text-[11px] break-all">
                        <span className="mr-1.5">{d.name}</span>
                        <span className="text-[var(--muted)]">{d.note}</span>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}

          {/* The verdict first. The question is "can I approve this", and an answer under a
              step list is an answer nobody reads. */}
          {rep.format === 'bmmpa' && (<>
          <div className={`text-[12px] rounded-lg border p-2.5 mb-2 ${rep.bmmpa.needsReview ? 'border-[var(--warning)] text-[var(--warning)]' : 'border-[var(--line)] text-[var(--muted)]'}`}>
            {rep.bmmpa.needsReview
              ? t('bmi.review', 'This file grants itself permissions or reaches outside BMM. Read it before approving.')
              : t('bmi.clean', 'Nothing here asks for a permission or touches anything outside BMM.')}
          </div>
          {/* What else is in the file, and what it names but does not carry. Both belong
              above the tasks: "12 automations" means something different when three of
              them call a fourth that is not here. */}
          {(rep.bmmpa.includes?.launchpacks > 0 || rep.bmmpa.includes?.modpacks > 0) && (
            <div className="text-[11px] text-[var(--muted)] mb-2">
              {t('bmi.alsoCarries', 'Also in this file:')}{' '}
              {[rep.bmmpa.includes.launchpacks && `${rep.bmmpa.includes.launchpacks} ${t('bmi.launchpacks', 'launch pack(s)')}`,
                rep.bmmpa.includes.modpacks && `${rep.bmmpa.includes.modpacks} ${t('bmi.modpacks', 'modpack(s)')}`].filter(Boolean).join(' · ')}
            </div>
          )}
          {rep.bmmpa.unresolved?.length > 0 && (
            <div className="text-[12px] text-[var(--warning)] rounded-lg border border-[var(--warning)] p-2 mb-2 break-all">
              {t('bmi.unresolved', 'Names {n} thing(s) it does not include — these import cleanly and fail on the user\'s machine:').replace('{n}', String(rep.bmmpa.unresolved.length))}{' '}
              {rep.bmmpa.unresolved.slice(0, 8).map((u) => `${u.kind}:${u.id}`).join('  ·  ')}
            </div>
          )}
          {rep.bmmpa.tasks.map((tk, i) => (
            <div key={i} className="rounded-lg border border-[var(--line)] p-2.5 mb-2">
              <div className="flex items-baseline gap-2 flex-wrap">
                <b className="text-[13px]">{tk.name}</b>
                <span className="text-[11px] text-[var(--primary-2)]">{tk.trigger}</span>
                <span className="text-[11px] text-[var(--muted)] ml-auto">{tk.stepCount} {t('bmi.steps', 'steps')}</span>
              </div>
              {tk.description && <div className="text-[12px] text-[var(--muted)] mt-1">{tk.description}</div>}
              {tk.perms.length > 0 && <div className="text-[12px] text-[var(--warning)] mt-1.5"><b>{t('bmi.asks', 'Grants itself:')}</b> {tk.perms.map((k) => PERM[k] || k).join(' · ')}</div>}
              {tk.reaching.length > 0 && <div className="text-[12px] text-[var(--warning)] mt-1"><b>{t('bmi.reaches', 'Reaches outside BMM:')}</b> {tk.reaching.map((k) => REACH[k] || k).join(' · ')}</div>}
              {tk.targets.length > 0 && <div className="text-[11px] text-[var(--muted)] mt-1 break-all"><b>{t('bmi.names', 'Names:')}</b> {tk.targets.join('  ·  ')}</div>}
              {tk.scripts.map((sc, j) => (
                <details key={j} className="mt-2">
                  <summary className="text-[12px] cursor-pointer text-[var(--primary-2)]">{t('bmi.script', 'Script')} — {sc.engine}</summary>
                  {/* whitespace-pre and its own scroll: reflowed code is code you cannot judge. */}
                  <pre className="mt-1.5 p-2 rounded-lg text-[11px] overflow-auto max-h-64 whitespace-pre" style={{ background: 'var(--bg-solid)', border: '1px solid var(--line)' }}>{sc.code}</pre>
                </details>
              ))}
              {tk.steps?.length > 0 && (
                <details className="mt-2" open>
                  <summary className="text-[12px] cursor-pointer text-[var(--primary-2)]">{t('bmi.tree', 'Every step, in order')}</summary>
                  <div className="mt-1.5 flex flex-col gap-0.5">
                    {tk.steps.map((n, j) => <BmmpaStep key={j} node={n} depth={0} t={t} />)}
                  </div>
                </details>
              )}
            </div>
          ))}
          </>)}
        </div>
      )}
    </Card>
  );
}

function AdminWebhooks() {
  const { t } = useI18n(); const toast = useToast();
  const { data, loading, reload } = useAsync(() => api.get('/admin/webhooks'), []);
  const events = useAsync(() => api.get('/v1/webhook-events'), []);
  const [form, setForm] = useState(null);
  const [secret, setSecret] = useState(null);
  const [busy, setBusy] = useState(false);

  // Creates through /me/webhooks — the endpoint that already exists — so the webhook is
  // owned by the admin making it. Deliberately NOT a new "create on someone's behalf"
  // route: that is a privilege nobody has today, and it would need a target user, a
  // notification to them, and an answer to who owns the secret. This is the same
  // self-serve creation, surfaced where an admin is already looking.
  const create = async () => {
    const picked = form.events;
    if (!/^https?:\/\//i.test(form.url.trim())) return toast.error(t('sso.wh.badurl', 'Enter an http(s) address.'));
    if (!picked.length) return toast.error(t('sso.wh.noev', 'Pick at least one event — one with none never fires.'));
    setBusy(true);
    try {
      const r = await api.post('/me/webhooks', { url: form.url.trim(), label: form.label.trim(), events: picked });
      setSecret(r.secret); setForm(null); reload();
    } catch (x) {
      toast.error(x?.data?.error === 'https_required' ? t('sso.wh.https', 'https is required, except on localhost.')
        : x?.data?.error === 'too_many' ? t('sso.wh.toomany', 'You already have the maximum number of webhooks.')
        : t('common.failed', 'Failed.'));
    } finally { setBusy(false); }
  };

  if (loading) return <Spinner />;
  const rows = data?.endpoints || [];
  const q = data?.queue || {};
  const evList = Object.entries(events.data?.events || {});
  return (
    <div>
      {secret && (
        <div className="rounded-lg border border-[var(--primary)] bg-[var(--primary)]/5 p-3 mb-3">
          {/* Shown once by the API and never retrievable — so it gets its own panel rather
              than a toast that scrolls away while you look for somewhere to paste it. */}
          <div className="text-[12px] font-semibold text-[var(--primary-2)] mb-1.5">{t('sso.wh.secret', 'Copy the signing secret now — it is shown once and never again.')}</div>
          <div className="flex items-center gap-2 text-[12px]">
            <code className="font-mono break-all flex-1">{secret}</code>
            <Button size="sm" variant="ghost" onClick={() => { copyText(secret); toast.success(t('common.copied', 'Copied.')); }}><Copy size={13} /></Button>
          </div>
          <Button size="sm" className="mt-2" onClick={() => setSecret(null)}>{t('dev.secret.done', 'I have saved it')}</Button>
        </div>
      )}

      {form ? (
        <div className="rounded-lg border border-[var(--line)] p-3 space-y-2.5 mb-3">
          <Field label={t('sso.wh.url', 'Where to send it')} hint={t('sso.wh.url.h', 'https only, except http://localhost while you are developing. The payload is signed, and sending a signed payload in clear undoes the point of signing it.')}>
            <Input value={form.url} onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))} placeholder="https://example.com/hooks/bcweb" />
          </Field>
          <Field label={t('sso.wh.label', 'Label')} hint={t('sso.wh.label.h', 'For you — it appears in this list and nowhere else.')}>
            <Input value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} placeholder={t('sso.wh.label.ph', 'Deploy notifier')} />
          </Field>
          <Field label={t('sso.wh.events', 'What to send')}>
            <div className="space-y-1 max-h-56 overflow-y-auto">
              {evList.length === 0 && <div className="text-[11px] text-[var(--muted)]">{t('common.loading', 'Loading…')}</div>}
              {evList.map(([ev, desc]) => (
                <label key={ev} className="flex items-start gap-2 text-[12px]">
                  <input type="checkbox" className="mt-0.5" checked={form.events.includes(ev)}
                    onChange={(e) => setForm((f) => ({ ...f, events: e.target.checked ? [...f.events, ev] : f.events.filter((x) => x !== ev) }))} />
                  <span><code className="font-mono text-[var(--primary-2)]">{ev}</code>{desc ? <> — <span className="text-[var(--muted)]">{String(desc)}</span></> : null}</span>
                </label>
              ))}
            </div>
          </Field>
          <div className="flex gap-2">
            <Button size="sm" variant="primary" disabled={busy} onClick={create}>{busy ? <Spinner /> : t('sso.wh.create', 'Create it')}</Button>
            <Button size="sm" onClick={() => setForm(null)}>{t('common.cancel', 'Cancel')}</Button>
          </div>
        </div>
      ) : (
        <Button size="sm" className="mb-3" onClick={() => setForm({ url: '', label: '', events: [] })}>
          <Plus size={13} /> {t('sso.wh.new', 'New webhook')}
        </Button>
      )}
      {/* The queue first: a backlog or a week of failures is a platform problem, while the
          table below is a list of other people's problems. */}
      <div className="flex flex-wrap gap-2 mb-3">
        {[
          [t('sso.wh.endpoints', 'Endpoints'), rows.length, false],
          [t('sso.wh.pending', 'Queued'), q.pending ?? 0, false],
          [t('sso.wh.failed', 'Failed (7 days)'), q.failedLast7d ?? 0, (q.failedLast7d || 0) > 0],
        ].map(([label, value, warn]) => (
          <div key={label} className="rounded-[12px] border border-[var(--line)] px-3 py-2 min-w-[120px]"
               style={{ background: 'var(--surface-1)' }}>
            <div className="text-[11px] text-[var(--muted)]">{label}</div>
            <div className={`text-[18px] font-semibold ${warn ? 'text-[var(--warning)]' : ''}`}>{value}</div>
          </div>
        ))}
      </div>
      {!rows.length ? (
        <EmptyState icon={Rss} title={t('sso.wh.none', 'No webhooks yet')}
                    sub={t('sso.wh.none.s', 'Developers create these from /dev/config. They appear here as soon as one exists.')} />
      ) : (
        <div className="divide-y divide-[var(--line)]">
          {rows.map((e) => (
            <div key={e.id} className="py-2.5 flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium flex items-center gap-1.5 flex-wrap">
                  <span className={e.enabled ? '' : 'text-[var(--faint)]'}>{e.label || t('sso.wh.unlabelled', '(no label)')}</span>
                  {!e.enabled && <Badge tone="red">{t('sso.wh.off', 'disabled')}</Badge>}
                  {/* Ordered failures-first by the API, so the ones worth acting on are at
                      the top; the badge says why they are there. */}
                  {e.failures > 0 && <Badge tone="amber">{t('sso.wh.fails', '{n} failures').replace('{n}', String(e.failures))}</Badge>}
                </div>
                <div className="text-[11px] text-[var(--faint)] font-mono break-all">{e.url}</div>
                <div className="text-[11px] text-[var(--muted)] mt-0.5">
                  {(e.events || []).join(' · ') || t('sso.wh.noevents', 'no events — it will never fire')}
                </div>
                {e.disabledReason && <div className="text-[11px] text-error mt-0.5">{e.disabledReason}</div>}
              </div>
              <div className="text-right shrink-0 text-[11px] text-[var(--muted)]">
                <div>{e.user?.displayName || e.user?.email || '—'}</div>
                <div className="text-[var(--faint)]">
                  {e.lastAt ? `${t('sso.wh.last', 'last')} ${new Date(e.lastAt).toLocaleDateString()}${e.lastStatus ? ` · ${e.lastStatus}` : ''}` : t('sso.wh.never', 'never fired')}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Who granted what, to which app. One row per (person, app).
function AdminSsoPeople() {
  const { t } = useI18n(); const toast = useToast(); const dialog = useDialog();
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const { data, loading, reload } = useAsync(() => api.get(`/admin/sso/grants?q=${encodeURIComponent(term)}`), [term]);
  const grants = data?.grants || [];

  const revoke = async (g) => {
    if (!await dialog.confirm({
      title: t('ud.sso.revoke.t', 'Cut this connection?'),
      message: t('ud.sso.revoke.m', '“{n}” loses its access immediately, and its live sessions for this account are revoked too. Signing in there again will ask this person for permission afresh — they are notified, so an unexplained re-prompt does not read as a bug in that app.').replace('{n}', g.client.name),
      okLabel: t('ud.sso.revoke.ok', 'Cut it'), danger: true,
    })) return;
    try { await api.del(`/admin/sso/grants/${g.userId}/${g.clientId}`); toast.success(t('ud.sso.revoked', 'Connection removed.')); reload(); }
    catch { toast.error(t('common.failed', 'Failed.')); }
  };

  return (
    <Card className="p-4">
      <p className="text-[12px] text-[var(--muted)] mb-3">
        {t('sso.people.sub', 'Every permission someone has given an app to sign them in with their BetterCommunity account. Cutting one revokes its live sessions too — a consent removed on its own would leave the app working until its tokens expired.')}
      </p>
      <form className="flex gap-2 mb-3" onSubmit={(e) => { e.preventDefault(); setTerm(q.trim()); }}>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('sso.people.search', 'Person or app…')} />
        <Button type="submit"><Search size={14} /></Button>
      </form>
      {loading ? <Spinner /> : !grants.length ? (
        <EmptyState icon={Shield} title={t('sso.people.none', 'Nobody has connected an app yet.')}
          sub={t('sso.people.none.s', 'Rows appear here the first time someone signs in to an outside app with their account.')} />
      ) : (
        <div className="divide-y divide-[var(--line)]">
          {grants.map((g) => (
            <div key={`${g.userId}|${g.clientId}`} className="py-2 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm truncate">
                  {g.user ? g.user.displayName : t('sso.people.gone', '(deleted account)')}
                  <span className="text-[var(--faint)]"> → </span>
                  <span className={g.client.active ? '' : 'text-[var(--faint)] line-through'}>{g.client.name}</span>
                </div>
                <div className="text-[11px] text-[var(--faint)] truncate">
                  {g.user?.email} · {g.scope} · {t('sso.people.granted', 'granted {d}').replace('{d}', new Date(g.grantedAt).toLocaleDateString())}
                </div>
              </div>
              {g.activeTokens > 0 && <Badge tone="green">{t('ud.sso.live', '{n} live').replace('{n}', String(g.activeTokens))}</Badge>}
              <Button size="sm" variant="ghost" onClick={() => revoke(g)} title={t('ud.sso.revoke.ok', 'Cut it')}><Ban size={13} className="text-[var(--error)]" /></Button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function AdminOAuthClients() {
  const toast = useToast(); const { t } = useI18n();
  const { data, loading, reload } = useAsync(() => api.get('/admin/oauth-clients'), []);
  const [f, setF] = useState({ name: '', confidential: true, redirectUris: '', scopes: ['openid', 'profile', 'email'] });
  // From the provider's own discovery document rather than a copy. The list here was five
  // names while the provider serves fourteen — so nine scopes could not be granted from this
  // screen, and nothing said so.
  const [ssoScopes, setSsoScopes] = useState(['openid', 'profile', 'email']);
  useEffect(() => {
    fetch('/api/.well-known/openid-configuration').then((r) => r.json())
      .then((d) => { if (Array.isArray(d?.scopes_supported) && d.scopes_supported.length) setSsoScopes(d.scopes_supported); })
      .catch(() => { /* keep the safe default */ });
  }, []);
  const [created, setCreated] = useState(null); // { id, secret } — shown once
  const undo = useUndoableDelete(reload);
  const list = (data?.clients || []).filter((c) => !undo.pending.has(c.id));
  const toggleScope = (s) => setF((st) => ({ ...st, scopes: st.scopes.includes(s) ? st.scopes.filter((x) => x !== s) : [...st.scopes, s] }));
  const copy = (v) => { navigator.clipboard?.writeText(v); toast.success(t('common.copied', 'Copied.')); };
  const create = async () => {
    const uris = f.redirectUris.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
    if (!f.name.trim()) return toast.error(t('oc.err.name', 'Name is required.'));
    if (!uris.length) return toast.error(t('oc.err.uris', 'Add at least one redirect URI.'));
    try {
      const r = await api.post('/admin/oauth-clients', { name: f.name.trim(), confidential: f.confidential, redirectUris: uris, scopes: f.scopes.length ? f.scopes : undefined });
      setCreated({ id: r.client.id, secret: r.clientSecret });
      setF({ name: '', confidential: true, redirectUris: '', scopes: ['openid', 'profile', 'email'] });
      reload();
    } catch (x) { toast.error(x.data?.error === 'invalid_input' ? t('oc.err.input', 'Check the fields — redirect URIs must be valid absolute URLs.') : t('common.failed', 'Failed.')); }
  };
  const toggle = async (c) => { try { await api.patch(`/admin/oauth-clients/${c.id}`, { active: !c.active }); reload(); } catch { toast.error(t('common.failed', 'Failed.')); } };
  const del = (c) => undo.del(c.id, () => api.del(`/admin/oauth-clients/${c.id}`), t('common.deleted', 'Deleted.'));
  const rotate = async (c) => { try { const r = await api.post(`/admin/oauth-clients/${c.id}/rotate`); setCreated({ id: c.id, secret: r.clientSecret }); } catch { toast.error(t('common.failed', 'Failed.')); } };
  return (
    <div>
      <h2 className="font-semibold mb-1 flex items-center gap-2"><Shield size={16} className="text-[var(--primary-2)]" /> {t('oc.title', 'SSO — OAuth / OpenID Connect clients')}</h2>
      <p className="text-xs text-[var(--muted)] mb-3">{t('oc.sub', 'Register another service to “Sign in with BetterCommunity”. It discovers everything at')} <code className="text-[11px]">/.well-known/openid-configuration</code>.</p>
      {created && (
        <Card className="p-4 mb-4 border-[var(--primary)]">
          <div className="text-sm font-semibold text-[var(--primary-2)] mb-2">{t('oc.created', 'Client ready — copy the secret now, it is shown only once.')}</div>
          <div className="flex items-center gap-2 text-sm mb-1"><span className="text-[var(--muted)] w-24">client_id</span><code className="font-mono break-anywhere flex-1">{created.id}</code><button onClick={() => copy(created.id)} className="text-[var(--faint)] hover:text-[var(--primary-2)]"><Copy size={13} /></button></div>
          {created.secret
            ? <div className="flex items-center gap-2 text-sm"><span className="text-[var(--muted)] w-24">client_secret</span><code className="font-mono break-anywhere flex-1">{created.secret}</code><button onClick={() => copy(created.secret)} className="text-[var(--faint)] hover:text-[var(--primary-2)]"><Copy size={13} /></button></div>
            : <div className="text-xs text-[var(--muted)]">{t('oc.public', 'Public client — no secret; it must use PKCE.')}</div>}
          <div className="flex justify-end mt-3"><Button size="sm" onClick={() => setCreated(null)}>{t('common.done', 'Done')}</Button></div>
        </Card>
      )}
      <Card className="p-4 mb-4">
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label={t('oc.f.name', 'Client name')}><Input value={f.name} onChange={(e) => setF((s) => ({ ...s, name: e.target.value }))} placeholder="My service" /></Field>
          <Field label={t('oc.f.type', 'Type')}><Select value={f.confidential ? 'conf' : 'pub'} onChange={(e) => setF((s) => ({ ...s, confidential: e.target.value === 'conf' }))}><option value="conf">{t('oc.t.conf', 'Confidential (server, has a secret)')}</option><option value="pub">{t('oc.t.pub', 'Public (SPA/mobile, PKCE only)')}</option></Select></Field>
        </div>
        <div className="mt-3"><Field label={t('oc.f.uris', 'Redirect URIs (one per line)')} hint={t('oc.f.uris.h', 'Absolute URLs the login flow may return to, e.g. https://app.example.com/callback')}><textarea className="input" rows={2} value={f.redirectUris} onChange={(e) => setF((s) => ({ ...s, redirectUris: e.target.value }))} placeholder="https://app.example.com/callback" /></Field></div>
        <div className="mt-3">
          <div className="text-sm text-[var(--muted)] mb-1.5">{t('oc.f.scopes', 'Scopes')}</div>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {ssoScopes.map((sc) => (
              <label key={sc} className="flex items-center gap-1.5 text-sm cursor-pointer" title={SSO_SCOPE_HELP[sc] || sc}>
                <input type="checkbox" checked={f.scopes.includes(sc)} disabled={sc === 'openid'} onChange={() => toggleScope(sc)} /> {sc}
              </label>
            ))}
          </div>
        </div>
        <div className="flex justify-end mt-3"><Button variant="primary" onClick={create}><Plus size={15} /> {t('oc.create', 'Create client')}</Button></div>
      </Card>
      {loading ? <Loading /> : list.length ? <div className="space-y-2">
        {list.map((c) => (
          <Card key={c.id} className="p-4">
            <div className="flex items-center gap-3 flex-wrap">
              <Shield size={18} className={c.active ? 'text-[var(--primary-2)]' : 'text-[var(--faint)]'} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap"><span className="font-semibold">{c.name}</span>{!c.active && <Badge>{t('oc.disabled', 'Disabled')}</Badge>}<Badge tone="primary">{c.confidential ? t('oc.conf', 'confidential') : t('oc.pub', 'public')}</Badge>{c.scopes.map((s) => <Badge key={s}>{s}</Badge>)}</div>
                <div className="text-xs text-[var(--muted)] mt-0.5 flex items-center gap-1.5"><code className="font-mono break-anywhere">{c.id}</code><button onClick={() => copy(c.id)} className="text-[var(--faint)] hover:text-[var(--primary-2)]"><Copy size={12} /></button> · {c.redirectUris.join(', ')}</div>
              </div>
              {c.confidential && <Button size="sm" variant="ghost" onClick={() => rotate(c)}>{t('oc.rotate', 'Rotate secret')}</Button>}
              <Button size="sm" onClick={() => toggle(c)}>{c.active ? t('oc.disable', 'Disable') : t('oc.enable', 'Enable')}</Button>
              <Button size="sm" className="!text-error" onClick={() => del(c)}><Trash2 size={14} /></Button>
            </div>
          </Card>
        ))}
      </div> : <EmptyState icon={Shield} title={t('oc.none.t', 'No OAuth clients yet')} sub={t('oc.none.s', 'Register a service above to let it sign users in with BetterCommunity.')} />}
    </div>
  );
}

// Editor for the bot's gated-role rules. Each rule = one Discord role granted to
// members meeting its own requirements (Discord link / BCWEB account / BMM
// creator id). Add as many as you like.
function GatingRules({ rules, onChange }) {
  const { t } = useI18n();
  const upd = (i, patch) => onChange(rules.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const add = () => onChange([...rules, { roleId: '', label: '', requireDiscord: true, requireBcweb: true, requireBmm: false }]);
  const rm = (i) => onChange(rules.filter((_, k) => k !== i));
  const Chk = ({ on, onToggle, children }) => (
    <label className="flex items-center gap-1.5 text-xs cursor-pointer"><input type="checkbox" checked={!!on} onChange={(e) => onToggle(e.target.checked)} /> {children}</label>
  );
  return (
    <div className="space-y-2">
      {rules.length === 0 && <div className="text-xs text-[var(--faint)] py-1">{t('db.gr.none', 'No role rules yet — add one to start gating.')}</div>}
      {rules.map((r, i) => (
        <div key={i} className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-2.5 space-y-2">
          <div className="grid grid-cols-[1fr_1fr_auto] gap-2 items-end">
            <Field label={t('db.gr.roleid', 'Role ID')}><Input value={r.roleId || ''} onChange={(e) => upd(i, { roleId: e.target.value.trim() })} placeholder="123456789012345678" /></Field>
            <Field label={t('db.gr.label', 'Label (for messages)')}><Input value={r.label || ''} onChange={(e) => upd(i, { label: e.target.value })} placeholder={t('db.gr.labelph', 'Verified / Creator…')} /></Field>
            <Button size="sm" variant="ghost" className="!text-error mb-0.5" onClick={() => rm(i)} title={t('db.gr.remove', 'Remove rule')}><Trash2 size={14} /></Button>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <Chk on={r.requireDiscord} onToggle={(v) => upd(i, { requireDiscord: v })}>{t('db.gr.reqdiscord', 'Requires linked Discord')}</Chk>
            <Chk on={r.requireBcweb} onToggle={(v) => upd(i, { requireBcweb: v })}>{t('db.gr.reqbcweb', 'Requires BCWEB account')}</Chk>
            <Chk on={r.requireBmm} onToggle={(v) => upd(i, { requireBmm: v })}>{t('db.gr.reqbmm', 'Requires BMM creator id')}</Chk>
          </div>
        </div>
      ))}
      <Button size="sm" variant="ghost" onClick={add}><Plus size={13} /> {t('db.gr.add', 'Add role rule')}</Button>
    </div>
  );
}

// Blog "sources" a route can subscribe to — mirrors the source keys the API tags
// each post with (project key, or 'showcase' for Other-projects pages, or '*'=all).
const BLOG_SOURCES = [['*', 'All blogs'], ['bmm', 'BMM'], ['bsm', 'BSM'], ['community', 'Community'], ['installer', 'Installer'], ['developers', 'Developers'], ['showcase', 'Other projects']];

// Per-route editor for blog announcements: each route = a channel (in any server)
// + which blogs to post there. A channel id is globally unique, so routing works
// across every server the bot is in.
const BLOG_SOURCE_KEY = { '*': 'db.src.all', bmm: 'db.src.bmm', bsm: 'db.src.bsm', community: 'db.src.community', installer: 'db.src.installer', showcase: 'db.src.showcase' };
// Editable list of Discord channel ids (add / remove rows). Empty strings are kept
// while editing and filtered out server-side, so a trailing blank row is harmless.
function MultiChannelInput({ value, onChange, placeholder }) {
  const { t } = useI18n();
  const ids = Array.isArray(value) ? value : (value ? [value] : []);
  const list = ids.length ? ids : [''];
  return (
    <div className="space-y-1.5">
      {list.map((id, i) => (
        <div key={i} className="flex gap-1.5">
          <Input value={id} onChange={(e) => onChange(list.map((x, k) => (k === i ? e.target.value : x)))} placeholder={placeholder} />
          {list.length > 1 && <Button size="sm" variant="ghost" onClick={() => onChange(list.filter((_, k) => k !== i))}><Trash2 size={13} /></Button>}
        </div>
      ))}
      <button type="button" onClick={() => onChange([...list, ''])} className="text-xs text-[var(--primary-2)] hover:underline flex items-center gap-1"><Plus size={12} /> {t('db.f.addchan', 'Add another channel')}</button>
    </div>
  );
}

function BlogRoutes({ routes, onChange, guildList }) {
  const { t } = useI18n();
  const set = (i, patch) => onChange(routes.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const toggleSource = (i, key) => {
    const cur = routes[i].sources || ['*'];
    let next;
    if (key === '*') next = ['*'];
    else { next = cur.includes('*') ? [key] : cur.includes(key) ? cur.filter((s) => s !== key) : [...cur, key]; if (!next.length) next = ['*']; }
    set(i, { sources: next });
  };
  return (
    <div className="space-y-2">
      {routes.length === 0 && <div className="text-xs text-[var(--faint)]">{t('db.routes.none', 'No routes — add one. Each route posts the chosen blogs to a channel (in any server the bot is in).')}</div>}
      {routes.map((r, i) => {
        const guild = guildList.find((gg) => gg.id === r.guildId);
        return (
          <div key={i} className="rounded-lg border border-[var(--line)] p-2.5 space-y-2 relative">
            <button onClick={() => onChange(routes.filter((_, k) => k !== i))} className="absolute top-2 right-2 text-[var(--faint)] hover:text-error"><Trash2 size={13} /></button>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--faint)]">{t('db.routes.routen', 'Route {n}').replace('{n}', i + 1)}{guild ? ` · ${guild.name}` : ''}</div>
            <Input value={r.channelId || ''} onChange={(e) => set(i, { channelId: e.target.value })} placeholder={t('db.routes.chanph', 'Channel ID (in any server the bot is in)')} />
            {guildList.length > 0 && (
              <Select className="!py-2" value={r.guildId || ''} onChange={(e) => set(i, { guildId: e.target.value })}>
                <option value="">{t('db.routes.serveropt', 'Server (optional — for your reference)')}</option>
                {guildList.map((gg) => <option key={gg.id} value={gg.id}>{gg.name}</option>)}
              </Select>
            )}
            <div className="flex flex-wrap gap-1.5">
              {BLOG_SOURCES.map(([key, label]) => {
                const on = (r.sources || ['*']).includes(key);
                return (
                  <button key={key} type="button" onClick={() => toggleSource(i, key)}
                    className={`px-2 py-0.5 rounded-md text-[11px] border transition ${on ? 'bg-[var(--primary)]/15 border-[var(--primary)]/40 text-[var(--primary-2)]' : 'border-[var(--line)] text-[var(--muted)] hover:text-[var(--text)]'}`}>
                    {t(BLOG_SOURCE_KEY[key] || '', label)}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
      <Button size="sm" variant="ghost" onClick={() => onChange([...routes, { channelId: '', guildId: '', sources: ['*'] }])}><Plus size={13} /> {t('db.routes.add', 'Add route')}</Button>
    </div>
  );
}

// A styled on/off switch — the classic bot-dashboard module toggle.
function BotSwitch({ checked, onChange, disabled }) {
  return (
    <button type="button" role="switch" aria-checked={!!checked} disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition shrink-0 ${checked ? 'bg-success' : 'bg-[var(--surface-2)] border border-[var(--line)]'} ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}>
      <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
    </button>
  );
}

// One server in the dashboard's server picker (avatar + name + member count),
// MEE6/Dyno-style. `dot` shows a green marker when that server has custom config.
function ServerBubble({ name, icon, sub, active, dot, onClick }) {
  const initial = (name || '?').slice(0, 2).toUpperCase();
  return (
    <button onClick={onClick} title={name}
      className={`relative flex items-center gap-2.5 px-3 py-2 rounded-xl border text-left transition shrink-0 w-[180px] ${active ? 'border-[var(--primary)] bg-[var(--primary)]/10' : 'border-[var(--line)] hover:border-[var(--line-strong)] hover:bg-[var(--surface-2)]/50'}`}>
      {icon ? <img src={icon} alt="" className="w-9 h-9 rounded-full shrink-0" />
        : <span className="w-9 h-9 rounded-full shrink-0 grid place-items-center text-xs font-bold bg-gradient-to-br from-brand to-brand-2 text-white">{initial}</span>}
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium truncate">{name}</div>
        {sub && <div className="text-[10px] text-[var(--faint)] truncate">{sub}</div>}
      </div>
      {dot && <span className="w-2 h-2 rounded-full bg-success shrink-0" title="Custom config" />}
    </button>
  );
}

// A feature "module" card: header (icon + title + master switch) over a settings
// body that dims when the module is off. The heart of the bot-dashboard layout.
function ModuleCard({ icon: I, title, desc, enabled, onToggle, action, children }) {
  const off = enabled === false;
  return (
    <Card className={`p-0 overflow-hidden self-start transition ${off ? 'opacity-75' : ''}`}>
      <div className="flex items-start gap-3 p-4">
        <span className={`grid place-items-center w-9 h-9 rounded-lg shrink-0 border ${off ? 'bg-[var(--surface-2)] border-[var(--line)]' : 'bg-[var(--primary)]/10 border-[var(--primary)]/20'}`}><I size={17} className={off ? 'text-[var(--faint)]' : 'text-[var(--primary-2)]'} /></span>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm">{title}</div>
          {desc && <div className="text-[11px] text-[var(--faint)] mt-0.5 leading-snug">{desc}</div>}
        </div>
        {action}
        {onToggle && <BotSwitch checked={!!enabled} onChange={onToggle} />}
      </div>
      {/* When the module is toggled off, its config collapses to keep the tab tidy —
          the values persist and reappear on enable (no greyed-out sprawl). */}
      {children && !off && <div className="px-4 pb-4 space-y-2.5 border-t border-[var(--line)] pt-3">{children}</div>}
    </Card>
  );
}

// Live bot console logs (shipped in the heartbeat) — the fastest way to see WHY the
// bot did or didn't do something (e.g. a payment channel not found / no permission).
function BotLogsCard() {
  const { t } = useI18n();
  const [logs, setLogs] = useState(null);
  const [at, setAt] = useState(null);
  const [open, setOpen] = useState(false);
  const load = () => api.get('/admin/bot/logs').then((r) => { setLogs(r.logs || []); setAt(r.at); }).catch(() => {});
  useEffect(() => { if (!open) return; load(); const id = setInterval(load, 5000); return () => clearInterval(id); }, [open]);
  const color = (lv) => lv === 'error' ? 'text-error' : lv === 'warn' ? 'text-warning' : 'text-[var(--muted)]';
  return (
    <Card className="p-4 mb-4">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center justify-between gap-2 text-left">
        <span className="font-medium text-sm flex items-center gap-2"><FileText size={14} className="text-[var(--primary-2)]" /> {t('db.logs', 'Live bot logs')}{at && <span className="text-[11px] text-[var(--faint)] font-normal">· {t('db.logs.updated', 'updated {t}').replace('{t}', new Date(at).toLocaleTimeString())}</span>}</span>
        <ChevronDown size={16} className={`text-[var(--faint)] transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="mt-3">
          {logs == null ? <div className="text-xs text-[var(--muted)] flex items-center gap-2"><Spinner /> {t('common.loading', 'Loading…')}</div>
            : logs.length === 0 ? <div className="text-xs text-[var(--faint)]">{t('db.logs.none', 'No logs yet — the bot pushes them on its heartbeat (≤60s). If empty, the bot may be offline.')}</div>
            : <div className="rounded-lg bg-[#0b1220] border border-[var(--line)] p-2.5 max-h-72 overflow-auto font-mono text-[11px] leading-relaxed">
                {logs.map((l, i) => (
                  <div key={i} className="whitespace-pre-wrap break-words"><span className="text-[var(--faint)]">{new Date(l.t).toLocaleTimeString()} </span><span className={color(l.level)}>{l.msg}</span></div>
                ))}
              </div>}
          <p className="text-[11px] text-[var(--faint)] mt-1.5">{t('db.logs.note', 'Auto-refreshes every 5s while open. Use “Send test message” above and watch here to see whether a payment posts.')}</p>
        </div>
      )}
    </Card>
  );
}

// Bot message variables — the bot substitutes these when it sends. {code} only resolves
// when a gift is attached. Kept in sync with the bot's substitution (apps/bot).
const BOT_VARS_BASE = [
  { v: '{user}', d: 'Mention the recipient (@Name)' },
  { v: '{username}', d: "The recipient's username" },
  { v: '{server}', d: 'The server name' },
];
const DM_VARS = [...BOT_VARS_BASE, { v: '{code}', d: 'The gift code (only if a gift is attached)' }];
const GIVEAWAY_VARS = [...BOT_VARS_BASE, { v: '{prize}', d: 'The giveaway prize' }, { v: '{code}', d: 'The gift code (only if a gift is attached)' }];

// Substitute variables with sample values for the live preview.
function previewBotMsg(tpl, { code } = {}) {
  return String(tpl || '').replace(/\{user\}/g, '@Alex').replace(/\{username\}/g, 'Alex')
    .replace(/\{server\}/g, 'BetterCommunity').replace(/\{prize\}/g, '1 month of hosting').replace(/\{code\}/g, code || 'BC-7K2M-9XQ4');
}

// A message editor with an insert-at-cursor variable palette + a live preview. `giftCode`
// undefined = no gift line in the preview; '' or a value = show a gift-code chip.
function MessageField({ label, hint, value, onChange, vars, placeholder, giftCode }) {
  const { t } = useI18n();
  const ref = useRef(null);
  const insert = (token) => {
    const el = ref.current;
    if (!el) return onChange(`${value || ''}${token}`);
    const s = el.selectionStart ?? (value || '').length, e = el.selectionEnd ?? (value || '').length;
    const next = (value || '').slice(0, s) + token + (value || '').slice(e);
    onChange(next);
    requestAnimationFrame(() => { try { el.focus(); el.selectionStart = el.selectionEnd = s + token.length; } catch {} });
  };
  return (
    <Field label={label} hint={hint}>
      <Textarea ref={ref} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
      <div className="flex flex-wrap items-center gap-1.5 mt-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--faint)]">{t('botvar.insert', 'Insert')}:</span>
        {vars.map((vr) => (
          <button key={vr.v} type="button" onClick={() => insert(vr.v)} title={vr.d}
            className="press-sm text-[11px] font-mono px-1.5 py-0.5 rounded-md border border-[var(--line)] bg-[var(--surface-2)] text-[var(--primary-2)] hover:border-[var(--ring)] transition-colors">{vr.v}</button>
        ))}
      </div>
      <div className="mt-2 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-2.5">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--faint)] mb-1 flex items-center gap-1"><Eye size={10} /> {t('botvar.preview', 'Preview')}</div>
        <div className="text-sm whitespace-pre-wrap break-words">
          {(value || '').trim() ? previewBotMsg(value) : <span className="text-[var(--faint)]">{t('botvar.empty', '(the message the recipient will see)')}</span>}
          {giftCode !== undefined && <div className="mt-1.5"><Badge tone="primary"><Gift size={9} /> {giftCode || 'BC-7K2M-9XQ4'}</Badge></div>}
        </div>
      </div>
    </Field>
  );
}

// Admin: DM a Discord user — plain message and/or a one-off gift promo code minted
// against their linked account. The bot delivers it within ~30s.
function BotDMCard() {
  const { t } = useI18n(); const toast = useToast();
  const [open, setOpen] = useState(false);
  const [discordId, setDiscordId] = useState('');
  const [message, setMessage] = useState('');
  const [picker, setPicker] = useState(false);
  const [mq, setMq] = useState(''); const [mqDeb, setMqDeb] = useState('');
  useEffect(() => { const id = setTimeout(() => setMqDeb(mq), 300); return () => clearTimeout(id); }, [mq]);
  const members = useAsync(() => (picker ? api.get(`/admin/bot/members?take=8${mqDeb ? `&q=${encodeURIComponent(mqDeb)}` : ''}`) : Promise.resolve({ members: [] })), [picker, mqDeb]);
  const [withGift, setWithGift] = useState(false);
  const [gift, setGift] = useState({ kind: 'discount', percentOff: 20, freeMonths: 0, storageGB: 10, uploadMbps: 8, hostMonths: 0, boostDays: 7 });
  const [busy, setBusy] = useState(false);
  const send = async () => {
    if (!discordId.trim()) return toast.error(t('dm.needid', 'Enter a Discord user id.'));
    setBusy(true);
    try {
      const body = { discordId: discordId.trim(), message };
      if (withGift) {
        const g = { kind: gift.kind };
        if (gift.kind === 'discount') { if (Number(gift.percentOff)) g.percentOff = Number(gift.percentOff); if (Number(gift.freeMonths)) g.freeMonths = Number(gift.freeMonths); }
        if (gift.kind === 'free_hosting' || gift.kind === 'free_pool') { g.storageGB = Number(gift.storageGB); if (Number(gift.uploadMbps)) g.uploadMbps = Number(gift.uploadMbps); if (Number(gift.hostMonths)) g.hostMonths = Number(gift.hostMonths); }
        if (gift.kind === 'free_boost') g.boostDays = Number(gift.boostDays);
        body.gift = g;
      }
      const r = await api.post('/admin/bot/dm', body);
      toast.success(r.giftCode ? t('dm.sentgift', 'Queued — DM + gift code {c} on its way.').replace('{c}', r.giftCode) : t('dm.sent', 'Queued — the bot DMs it within ~30s.'));
      setMessage(''); setDiscordId('');
    } catch (x) {
      const e = x.data?.error;
      toast.error(e === 'no_linked_account' ? t('dm.nolink', 'That Discord user has no linked BetterCommunity account — a gift code needs one.')
        : e === 'empty_message' ? t('dm.empty', 'Add a message or a gift.')
        : e === 'discount_needs_value' ? t('pc.err.discount', 'Set a % off or free months.')
        : e === 'hosting_needs_storage' ? t('pc.err.storage', 'Set the storage GB.')
        : e === 'boost_needs_days' ? t('pc.err.boost', 'Set the boost days.') : t('common.failed', 'Failed.'));
    } finally { setBusy(false); }
  };
  return (
    <Card className="p-4 mb-4">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center justify-between gap-2 text-left">
        <span className="font-medium text-sm flex items-center gap-2"><Mail size={14} className="text-[var(--primary-2)]" /> {t('dm.title', 'Direct message / gift')}</span>
        <ChevronDown size={16} className={`text-[var(--faint)] transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          <p className="text-[11px] text-[var(--faint)]">{t('dm.note', 'The bot DMs the user directly. A gift mints a one-time promo code reserved for their account and appends it to the message. Requires the user shares a server with the bot and has DMs open.')}</p>
          <Field label={t('dm.userid', 'Discord user id')} hint={t('dm.userid.h', 'Enable Developer Mode in Discord → right-click a user → Copy User ID.')}>
            <div className="flex gap-2">
              <Input value={discordId} onChange={(e) => setDiscordId(e.target.value)} placeholder="123456789012345678" />
              <Button type="button" onClick={() => setPicker((v) => !v)} title={t('dm.pick', 'Pick from members')} className={picker ? '!border-[var(--primary)]' : ''}><Users size={14} /> {t('dm.pick', 'Members')}</Button>
            </div>
          </Field>
          {/* Member picker — search the tracked Discord members and click one to fill the id. */}
          {picker && (
            <div className="rounded-lg border border-[var(--line)] p-2 -mt-1">
              <Input value={mq} onChange={(e) => setMq(e.target.value)} placeholder={t('dm.searchmem', 'Search name or id…')} className="!py-1.5 !text-sm mb-2" />
              {members.loading ? <div className="py-2"><Loading /></div> : (members.data?.members || []).length ? (
                <div className="max-h-52 overflow-auto divide-y divide-[var(--line)]">
                  {members.data.members.map((m) => (
                    <button key={m.discordId} type="button" onClick={() => { setDiscordId(m.discordId); setPicker(false); }}
                      className="w-full flex items-center gap-2 px-1.5 py-1.5 text-left text-sm hover:bg-[var(--surface-2)] rounded">
                      <span className="grid place-items-center w-7 h-7 rounded-full bg-[var(--surface-2)] text-[var(--faint)] shrink-0 text-xs font-bold">{(m.username || '?').slice(0, 2).toUpperCase()}</span>
                      <span className="flex-1 min-w-0"><span className="font-medium truncate block">{m.username || t('dm.unknownuser', 'unknown')}</span><span className="text-[11px] text-[var(--faint)] font-mono">{m.discordId}</span></span>
                      {m.linkedUser ? <Badge tone="green"><CheckCircle2 size={9} /> {t('dm.linked', 'linked')}</Badge> : <Badge>{t('dm.unlinked', 'unlinked')}</Badge>}
                    </button>
                  ))}
                </div>
              ) : <div className="text-xs text-[var(--faint)] px-1.5 py-2">{t('dm.nomembers', 'No members found. The bot populates this once it’s connected and has scanned the server.')}</div>}
            </div>
          )}
          <MessageField label={t('dm.message', 'Message')} value={message} onChange={setMessage} vars={DM_VARS}
            placeholder={t('dm.message.ph', 'Thanks for being awesome, {user}! Here’s a little something…')} giftCode={withGift ? '' : undefined} />
          <label className="flex items-center gap-2 text-sm text-[var(--muted)] cursor-pointer w-fit"><input type="checkbox" checked={withGift} onChange={(e) => setWithGift(e.target.checked)} /> <Gift size={13} className="text-[var(--primary-2)]" /> {t('dm.attachgift', 'Attach a gift promo code')}</label>
          {withGift && (
            <div className="rounded-lg border border-[var(--line)] p-3 grid sm:grid-cols-2 gap-3">
              <Field label={t('pc.f.type', 'Type')}><Dropdown className="w-full" value={gift.kind} onChange={(v) => setGift({ ...gift, kind: v })} options={[{ value: 'discount', label: t('pc.t.discount', 'Discount (% off / months free)') }, { value: 'free_hosting', label: t('pc.t.hosting', 'Free hosting (one repo)') }, { value: 'free_pool', label: t('pc.t.pool', 'Free storage pool') }, { value: 'free_boost', label: t('pc.t.boost', 'Free boost') }]} /></Field>
              {gift.kind === 'discount' && <><Field label={t('pc.f.pctoff', '% off')}><Input type="number" value={gift.percentOff} onChange={(e) => setGift({ ...gift, percentOff: e.target.value })} /></Field><Field label={t('pc.f.freemonths', 'First months free')}><Input type="number" value={gift.freeMonths} onChange={(e) => setGift({ ...gift, freeMonths: e.target.value })} /></Field></>}
              {(gift.kind === 'free_hosting' || gift.kind === 'free_pool') && <><Field label={t('pc.f.storage', 'Storage GB')}><Input type="number" value={gift.storageGB} onChange={(e) => setGift({ ...gift, storageGB: e.target.value })} /></Field><Field label={t('pc.f.duration', 'Duration (months, 0 = forever)')}><Input type="number" value={gift.hostMonths} onChange={(e) => setGift({ ...gift, hostMonths: e.target.value })} /></Field></>}
              {gift.kind === 'free_boost' && <Field label={t('pc.f.boostdays', 'Boost days')}><Input type="number" value={gift.boostDays} onChange={(e) => setGift({ ...gift, boostDays: e.target.value })} /></Field>}
            </div>
          )}
          <div className="flex justify-end"><Button variant="primary" disabled={busy} onClick={send}>{busy ? <Spinner /> : <><Send size={14} /> {t('dm.send', 'Send')}</>}</Button></div>
        </div>
      )}
    </Card>
  );
}

// Admin: create & manage Discord giveaways — the bot posts an Enter button, collects
// entries, and draws winners at the end (DMing a gift code to each if configured).
function BotGiveawaysCard() {
  const { t } = useI18n(); const toast = useToast(); const dialog = useDialog();
  const [open, setOpen] = useState(false);
  const { data, loading, reload } = useAsync(() => api.get('/admin/bot/giveaways'), []);
  const [f, setF] = useState({ prize: '', channelId: '', durationMinutes: 60, winnersCount: 1, reqLinked: false, reqCreator: false, withGift: false, winnerMessage: 'Congrats {user} — you won {prize}! 🎉 Thanks for entering.', gift: { kind: 'discount', percentOff: 20, freeMonths: 0, storageGB: 10, boostDays: 7 } });
  const [busy, setBusy] = useState(false);
  const undo = useUndoableDelete(reload);
  const giveaways = (data?.giveaways || []).filter((g) => !undo.pending.has(g.id));
  const create = async () => {
    if (!f.prize.trim() || !f.channelId.trim()) return toast.error(t('gw.needfields', 'Prize and channel id are required.'));
    setBusy(true);
    try {
      const body = { prize: f.prize.trim(), channelId: f.channelId.trim(), durationMinutes: Number(f.durationMinutes) || 60, winnersCount: Number(f.winnersCount) || 1 };
      if (f.winnerMessage.trim()) body.winnerMessage = f.winnerMessage.trim();
      if (f.reqLinked || f.reqCreator) body.requirements = { linked: !!(f.reqLinked || f.reqCreator), creator: !!f.reqCreator };
      if (f.withGift) { const g = { kind: f.gift.kind }; if (f.gift.kind === 'discount') { if (Number(f.gift.percentOff)) g.percentOff = Number(f.gift.percentOff); if (Number(f.gift.freeMonths)) g.freeMonths = Number(f.gift.freeMonths); } if (f.gift.kind === 'free_hosting' || f.gift.kind === 'free_pool') g.storageGB = Number(f.gift.storageGB); if (f.gift.kind === 'free_boost') g.boostDays = Number(f.gift.boostDays); body.gift = g; }
      await api.post('/admin/bot/giveaways', body);
      toast.success(t('gw.created', 'Giveaway created — the bot posts it within ~30s.')); setF({ ...f, prize: '' }); reload();
    } catch { toast.error(t('common.failed', 'Failed.')); } finally { setBusy(false); }
  };
  const end = async (g) => { if (!(await dialog.confirm({ title: t('gw.end.t', 'Draw now?'), message: t('gw.end.m', 'End this giveaway now and draw the winners?'), okLabel: t('gw.end.ok', 'Draw now') }))) return; try { await api.post(`/admin/bot/giveaways/${g.id}/end`); toast.success(t('gw.ending', 'Drawing — winners announced within ~30s.')); reload(); } catch { toast.error(t('common.failed', 'Failed.')); } };
  const del = (g) => undo.del(g.id, () => api.del(`/admin/bot/giveaways/${g.id}`), t('common.deleted', 'Deleted.'));
  return (
    <Card className="p-4 mb-4">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center justify-between gap-2 text-left">
        <span className="font-medium text-sm flex items-center gap-2"><Gift size={14} className="text-[var(--primary-2)]" /> {t('gw.title', 'Giveaways')}{giveaways.some((g) => g.status === 'active') && <Badge tone="green">{giveaways.filter((g) => g.status === 'active').length}</Badge>}</span>
        <ChevronDown size={16} className={`text-[var(--faint)] transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          <p className="text-[11px] text-[var(--faint)]">{t('gw.note', 'Also available as /giveaway (Manage-Server perm). The bot posts an “Enter” button; winners are drawn at the end and DMed a gift code if you attach one.')}</p>
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label={t('gw.prize', 'Prize')}><Input value={f.prize} onChange={(e) => setF({ ...f, prize: e.target.value })} placeholder={t('gw.prize.ph', 'e.g. 1 month of hosting')} /></Field>
            <Field label={t('gw.channel', 'Channel id')} hint={t('db.f.chanid', 'Channel ID')}><Input value={f.channelId} onChange={(e) => setF({ ...f, channelId: e.target.value })} placeholder="123456789012345678" /></Field>
            <Field label={t('gw.duration', 'Duration (minutes)')}><Input type="number" value={f.durationMinutes} onChange={(e) => setF({ ...f, durationMinutes: e.target.value })} /></Field>
            <Field label={t('gw.winners', 'Winners')}><Input type="number" value={f.winnersCount} onChange={(e) => setF({ ...f, winnersCount: e.target.value })} /></Field>
          </div>
          {/* Entry requirements — gate who can enter (enforced server-side on Enter). */}
          <div className="rounded-lg border border-[var(--line)] p-3 space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--faint)] flex items-center gap-1.5"><Lock size={11} /> {t('gw.reqs', 'Entry requirements')}</div>
            <label className="flex items-center gap-2 text-sm text-[var(--muted)] cursor-pointer w-fit"><input type="checkbox" checked={f.reqLinked || f.reqCreator} disabled={f.reqCreator} onChange={(e) => setF({ ...f, reqLinked: e.target.checked })} /> {t('gw.req.linked', 'Require a linked BetterCommunity account (Discord ⇄ BCWEB)')}</label>
            <label className="flex items-center gap-2 text-sm text-[var(--muted)] cursor-pointer w-fit"><input type="checkbox" checked={f.reqCreator} onChange={(e) => setF({ ...f, reqCreator: e.target.checked, reqLinked: e.target.checked ? true : f.reqLinked })} /> {t('gw.req.creator', 'Require a linked BMM creator id')}</label>
            <div className="text-[11px] text-[var(--faint)]">{t('gw.req.note', 'Entrants without the required link get a helpful DM/notice pointing them to link — they can enter once linked.')}</div>
          </div>
          {/* Winner DM — customizable, English by default, with insert-at-cursor variables
              + a live preview. The bot substitutes {user}/{prize}/{code} when it sends. */}
          <MessageField label={t('gw.winnermsg', 'Winner DM message')} hint={t('gw.winnermsg.h', 'DMed to each winner when the giveaway ends.')}
            value={f.winnerMessage} onChange={(v) => setF({ ...f, winnerMessage: v })} vars={GIVEAWAY_VARS}
            placeholder={t('gw.winnermsg.ph', 'Congrats {user} — you won {prize}! 🎉')} giftCode={f.withGift ? '' : undefined} />
          <label className="flex items-center gap-2 text-sm text-[var(--muted)] cursor-pointer w-fit"><input type="checkbox" checked={f.withGift} onChange={(e) => setF({ ...f, withGift: e.target.checked })} /> <Gift size={13} className="text-[var(--primary-2)]" /> {t('gw.attachgift', 'DM each winner a gift code')}</label>
          {f.withGift && (
            <div className="rounded-lg border border-[var(--line)] p-3 grid sm:grid-cols-2 gap-3">
              <Field label={t('pc.f.type', 'Type')}><Dropdown className="w-full" value={f.gift.kind} onChange={(v) => setF({ ...f, gift: { ...f.gift, kind: v } })} options={[{ value: 'discount', label: t('pc.t.discount', 'Discount (% off / months free)') }, { value: 'free_hosting', label: t('pc.t.hosting', 'Free hosting (one repo)') }, { value: 'free_pool', label: t('pc.t.pool', 'Free storage pool') }, { value: 'free_boost', label: t('pc.t.boost', 'Free boost') }]} /></Field>
              {f.gift.kind === 'discount' && <><Field label={t('pc.f.pctoff', '% off')}><Input type="number" value={f.gift.percentOff} onChange={(e) => setF({ ...f, gift: { ...f.gift, percentOff: e.target.value } })} /></Field><Field label={t('pc.f.freemonths', 'First months free')}><Input type="number" value={f.gift.freeMonths} onChange={(e) => setF({ ...f, gift: { ...f.gift, freeMonths: e.target.value } })} /></Field></>}
              {(f.gift.kind === 'free_hosting' || f.gift.kind === 'free_pool') && <Field label={t('pc.f.storage', 'Storage GB')}><Input type="number" value={f.gift.storageGB} onChange={(e) => setF({ ...f, gift: { ...f.gift, storageGB: e.target.value } })} /></Field>}
              {f.gift.kind === 'free_boost' && <Field label={t('pc.f.boostdays', 'Boost days')}><Input type="number" value={f.gift.boostDays} onChange={(e) => setF({ ...f, gift: { ...f.gift, boostDays: e.target.value } })} /></Field>}
            </div>
          )}
          <div className="flex justify-end"><Button variant="primary" disabled={busy} onClick={create}>{busy ? <Spinner /> : <><Plus size={14} /> {t('gw.create', 'Create giveaway')}</>}</Button></div>

          {loading ? <Loading /> : giveaways.length ? <div className="space-y-2 pt-1">
            {giveaways.map((g) => (
              <div key={g.id} className="flex items-center gap-3 text-sm rounded-lg bg-[var(--surface-2)] px-3 py-2">
                <Gift size={14} className={g.status === 'active' ? 'text-success shrink-0' : 'text-[var(--faint)] shrink-0'} />
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{g.prize} {g.hasGift && <Badge tone="primary"><Gift size={9} /> {t('gw.gift', 'gift')}</Badge>} {g.requirements?.creator ? <Badge tone="amber"><Lock size={9} /> {t('gw.badge.creator', 'creator id')}</Badge> : g.requirements?.linked ? <Badge tone="amber"><Lock size={9} /> {t('gw.badge.linked', 'linked')}</Badge> : null}</div>
                  <div className="text-[11px] text-[var(--faint)]">{g.status === 'active' ? t('gw.endsat', 'ends {d}').replace('{d}', new Date(g.endsAt).toLocaleString()) : t('gw.ended', 'ended · {n} winner(s)').replace('{n}', g.winnerIds?.length || 0)} · {t('gw.entries', '{n} entries').replace('{n}', g.entryCount)}</div>
                </div>
                {g.status === 'active' && <Button size="sm" variant="ghost" onClick={() => end(g)}>{t('gw.drawbtn', 'Draw now')}</Button>}
                <Button size="sm" variant="ghost" className="!text-error" onClick={() => del(g)}><Trash2 size={13} /></Button>
              </div>
            ))}
          </div> : <div className="text-xs text-[var(--faint)]">{t('gw.none', 'No giveaways yet.')}</div>}
        </div>
      )}
    </Card>
  );
}

// Diagnostic under the Payments module: shows whether Payment rows even exist, so
// "the bot doesn't post real payments" can be told apart from "no payments recorded
// at all" (= the Stripe webhook isn't reaching the API).
function PaymentsDiag() {
  const { t } = useI18n();
  const { data } = useAsync(() => api.get('/admin/bot/payments/status').catch(() => null), []);
  if (!data) return null;
  const fdate = (d) => d ? new Date(d).toLocaleString() : '—';
  return (
    <div className="mt-2 pt-2 border-t border-[var(--line)] text-[11px] space-y-1">
      <div className="flex items-center gap-3 text-[var(--muted)] flex-wrap">
        <span><b className="text-[var(--text)] tabular-nums">{data.totalPayments}</b> {t('db.pay.diag.total', 'payments recorded')}</span>
        <span><b className="text-[var(--text)] tabular-nums">{data.announced}</b> {t('db.pay.diag.announced', 'announced')}</span>
        <span><b className="text-[var(--text)] tabular-nums">{data.refundEvents}</b> {t('db.pay.diag.refunds', 'refund events')}</span>
        {data.lastPaymentAt && <span>{t('db.pay.diag.last', 'last')}: {fdate(data.lastPaymentAt)}</span>}
      </div>
      <div className="flex items-center gap-2 flex-wrap text-[var(--faint)]">
        <span className={data.stripeKey ? 'text-success' : 'text-error'}>{data.stripeKey ? '✓' : '✗'} {t('db.pay.diag.key', 'Stripe key')}</span>
        <span className={data.webhookSecret ? 'text-success' : 'text-error'}>{data.webhookSecret ? '✓' : '✗'} {t('db.pay.diag.whsecret', 'Webhook secret')}</span>
      </div>
      {!data.webhookSecret && (
        <div className="flex items-start gap-1.5 text-error">
          <AlertTriangle size={12} className="shrink-0 mt-0.5" />
          <span>{t('db.pay.diag.nowh', 'STRIPE_WEBHOOK_SECRET is not set — the webhook endpoint returns 503, so no checkout is ever recorded or provisioned (and nothing can be announced). Set it in compose .env.')}</span>
        </div>
      )}
      {data.webhookSecret && data.webhookHint && (
        <div className="flex items-start gap-1.5 text-warning">
          <AlertTriangle size={12} className="shrink-0 mt-0.5" />
          <span>{t('db.pay.diag.hint2', 'No payments recorded yet. Stripe events aren’t reaching the API. Forward them to the API container (port 3000, not Stripe’s sample :4242): stripe listen --forward-to http://localhost:3000/hosting/webhook — and use the printed whsec_… as STRIPE_WEBHOOK_SECRET.')}</span>
        </div>
      )}
    </div>
  );
}

function AdminBot() {
  const toast = useToast();
  const { t } = useI18n();
  const { data, loading, reload } = useAsync(() => api.get('/admin/bot/config'), []);
  const [cfg, setCfg] = useState(null);
  const [previewNonce, setPreviewNonce] = useState(0);
  const [tokenInput, setTokenInput] = useState('');
  const [scope, setScope] = useState(''); // '' = global defaults, else a guild id (per-server config)
  useEffect(() => { if (data?.config) setCfg(data.config); }, [data]);
  if (loading || !cfg) return <Loading />;
  const status = data?.status;
  const online = status?.online && status?.at && (Date.now() - new Date(status.at).getTime() < 180000);
  // When the bot is OFFLINE, ping/uptime are stale — showing them as live numbers
  // reads as a contradiction next to the "Offline" pill. Compute an honest "last seen"
  // instead, and only surface the live metrics while genuinely online.
  const lastSeen = (() => {
    if (!status?.at) return null;
    const m = Math.round((Date.now() - new Date(status.at).getTime()) / 60000);
    return m < 1 ? t('db.justnow', 'just now') : m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h` : `${Math.floor(m / 1440)}d`;
  })();
  // set a nested field: set('welcome.channelId', v)
  const set = (path, val) => setCfg((c) => {
    const next = structuredClone(c); const keys = path.split('.'); let o = next;
    for (let i = 0; i < keys.length - 1; i++) o = (o[keys[i]] ??= {});
    o[keys[keys.length - 1]] = val; return next;
  });
  const undoSave = useUndoableSave(reload);
  const save = () => undoSave(() => api.put('/admin/bot/config', { config: cfg }),
    t('db.saved', 'Bot config saved.'), { errorFor: () => t('db.savefail', 'Save failed.') });
  const botDisabled = cfg.enabled === false;
  // DELIBERATELY NOT behind the undo window. The undo window is a convenience for edits you
  // might regret, not a safety mechanism — and for this action a six-second "maybe" is worse
  // than a plain yes: you want to know, at the moment you click, that it has taken effect.
  const saveToken = async () => {
    if (!tokenInput.trim()) return toast.error(t('db.token.entered', 'Enter a token.'));
    try { await api.put('/admin/bot/token', { token: tokenInput.trim() }); toast.success(t('db.token.tsaved', 'Token saved — the bot will connect within ~20s.')); setTokenInput(''); reload(); }
    catch (x) { toast.error(x.data?.error === 'bot_enabled' ? t('db.token.offfirst', 'Disable the bot first to change its token.') : x.data?.error === 'token_from_env' ? t('db.token.fromenv', 'Token is set via env — can’t change it here.') : t('db.token.failed', 'Failed.')); }
  };
  const clearToken = async () => {
    try { await api.put('/admin/bot/token', { token: null }); toast.success(t('db.token.cleared', 'Token cleared.')); reload(); }
    catch (x) { toast.error(x.data?.error === 'bot_enabled' ? t('db.token.offfirst', 'Disable the bot first.') : t('db.token.failed', 'Failed.')); }
  };
  const g = (path) => path.split('.').reduce((o, k) => o?.[k], cfg) ?? '';
  const guildList = status?.guildList || [];
  // Blog announcement routes: the new list, or the legacy single channel as one all-sources route.
  const blogRoutes = (cfg.blog?.routes?.length ? cfg.blog.routes : (cfg.blog?.channelId ? [{ channelId: cfg.blog.channelId, sources: ['*'] }] : []));
  // Welcome preview: substitute the message variables with sample values.
  const previewMsg = (tpl) => (tpl || '').replace(/\{user\}/g, '@NewMember').replace(/\{username\}/g, 'NewMember').replace(/\{servername\}/g, 'BetterCommunity').replace(/\{joinnumber\}/g, '1,024').replace(/\{joindate\}/g, new Date().toDateString());

  // ── Per-server scope ─────────────────────────────────────────────────────
  // The four per-server features (moderation / welcome / join-to-create / gating)
  // are edited under a "scope": '' = the Global defaults (top-level cfg, applied to
  // every server without its own config), or a guild id = that server's override in
  // cfg.guilds[id]. Blog/alerts/kofi/limits/token stay global.
  const scopeObj = scope ? (cfg.guilds?.[scope] || {}) : cfg;   // where the 4 features live for the current scope
  const base = scope ? `guilds.${scope}.` : '';
  const isCustomized = scope ? !!cfg.guilds?.[scope] : true;
  const sg = (p) => (base + p).split('.').reduce((o, k) => o?.[k], cfg) ?? '';
  const sset = (p, v) => set(base + p, v);
  const customizeServer = () => set(`guilds.${scope}`, {
    moderation: structuredClone(cfg.moderation || {}),
    welcome: structuredClone(cfg.welcome || {}),
    joinToCreate: structuredClone(cfg.joinToCreate || {}),
    gating: structuredClone(cfg.gating || {}),
  });
  const resetServer = () => setCfg((c) => { const next = structuredClone(c); if (next.guilds) delete next.guilds[scope]; return next; });
  const jtcLobbies = scopeObj.joinToCreate?.lobbies || (scopeObj.joinToCreate?.lobbyChannelId ? [{ lobbyChannelId: scopeObj.joinToCreate.lobbyChannelId, categoryId: scopeObj.joinToCreate.categoryId, tempCategoryName: scopeObj.joinToCreate.tempCategoryName }] : []);
  const purgeChans = scopeObj.moderation?.purgeChannelIds || (scopeObj.moderation?.purgeChannelId ? [scopeObj.moderation.purgeChannelId] : []);
  const scopeName = scope ? (guildList.find((gg) => gg.id === scope)?.name || scope) : t('db.scope.global', 'Global defaults');

  const SectionTitle = ({ icon: I, title, sub }) => (
    <div className="flex items-center gap-2.5 mt-6 mb-3">
      <span className="grid place-items-center w-8 h-8 rounded-lg bg-[var(--primary)]/10 border border-[var(--primary)]/20 shrink-0"><I size={15} className="text-[var(--primary-2)]" /></span>
      <div><div className="font-semibold text-sm">{title}</div>{sub && <div className="text-[11px] text-[var(--faint)]">{sub}</div>}</div>
    </div>
  );

  return (
    <div>
      {/* ── Header ── a defined solid rounded toolbar (its own Card surface) so the
          page's background art never bleeds around the title / Save button. */}
      <div className="sticky top-0 z-20 mb-4">
        <Card className="flex items-center justify-between flex-wrap gap-2 px-4 py-2.5">
          <h2 className="font-semibold flex items-center gap-2 text-base"><DiscordIcon size={18} className="text-[#5865F2]" /> {t('db.title', 'Discord bot')}</h2>
          <div className="flex items-center gap-2.5">
            <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border ${online ? 'text-success border-success-border bg-success-bg' : 'text-[var(--faint)] border-[var(--line)]'}`}><span className={`w-2 h-2 rounded-full ${online ? 'bg-success animate-pulse' : 'bg-[var(--line-strong)]'}`} /> {online ? t('db.online', 'Online') : t('db.offline', 'Offline')}</span>
            <Button size="sm" variant="primary" onClick={save}><CheckCircle2 size={14} /> {t('db.save', 'Save changes')}</Button>
          </div>
        </Card>
      </div>

      {/* connection error (e.g. privileged intents disabled) — actionable message */}
      {data?.error && (
        <div className="mb-4 rounded-xl border border-error-border bg-error/[0.07] p-3 flex items-start gap-2.5">
          <AlertTriangle size={16} className="text-error shrink-0 mt-0.5" />
          <div className="min-w-0"><div className="text-sm font-medium text-error">{t('db.cantconnect', 'Bot can’t connect')}</div><div className="text-xs text-error mt-0.5 break-words">{data.error}</div></div>
        </div>
      )}

      {/* Master switch + live stats in one hero row */}
      <Card className="p-4 mb-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <label className="flex items-center gap-3 cursor-pointer">
            <span className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${cfg.enabled !== false ? 'bg-success' : 'bg-[var(--surface-2)] border border-[var(--line)]'}`}>
              <input type="checkbox" className="sr-only" checked={cfg.enabled !== false} onChange={(e) => set('enabled', e.target.checked)} />
              <span className={`inline-block h-4 w-4 rounded-full bg-white transition ${cfg.enabled !== false ? 'translate-x-6' : 'translate-x-1'}`} />
            </span>
            <span className="text-sm font-medium">{cfg.enabled !== false ? t('db.enabled', 'Bot enabled') : t('db.disabled', 'Bot disabled')} <span className="text-[var(--faint)] font-normal">· {t('db.master', 'master switch')}</span></span>
          </label>
          <div className="flex items-center gap-4 text-xs text-[var(--muted)] flex-wrap">
            <span><b className="text-[var(--text)]">{status?.guilds ?? '—'}</b> {t('db.servers', 'servers')}</span>
            <span><b className="text-[var(--text)]">{status?.users ?? '—'}</b> {t('db.users', 'users')}</span>
            <span><b className="text-[var(--text)]">{status?.tempChannels ?? 0}</b> {t('db.tempvoice', 'temp voice')}</span>
            {online ? <>
              <span><b className="text-[var(--text)]">{status?.ping != null ? `${status.ping}ms` : '—'}</b> {t('db.ping', 'ping')}</span>
              <span><b className="text-[var(--text)]">{status?.uptimeSec != null ? `${Math.floor(status.uptimeSec / 3600)}h ${Math.floor((status.uptimeSec % 3600) / 60)}m` : '—'}</b> {t('db.uptime', 'uptime')}</span>
            </> : (
              <span className="flex items-center gap-1 text-[var(--faint)]"><Clock size={11} /> {lastSeen ? t('db.lastseen', 'last seen {t} ago').replace('{t}', lastSeen) : t('db.neverseen', 'never connected')}</span>
            )}
          </div>
        </div>
        {(status?.mod && (status.mod.kicks || status.mod.timeouts || status.mod.purged)) ? (
          <div className="flex items-center gap-4 text-[11px] text-[var(--faint)] mt-2.5 pt-2.5 border-t border-[var(--line)]">
            <span>{status.mod.kicks ?? 0} {t('db.kicked', 'kicked')}</span><span>{status.mod.timeouts ?? 0} {t('db.timedout', 'timed out')}</span><span>{status.mod.purged ?? 0} {t('db.purged', 'purged')}</span><span className="text-[var(--faint)]">{t('db.session', '(this session)')}</span>
          </div>
        ) : null}
      </Card>

      {/* Token + member DB usage, side by side */}
      <div className="grid md:grid-cols-2 gap-4 mb-2">
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-1.5">
            <Lock size={15} className="text-[var(--primary-2)]" /><span className="font-medium text-sm">{t('db.token', 'Bot token')}</span>
            {data?.hasToken ? <Badge tone="green"><CheckCircle2 size={10} /> {t('db.set', 'Set')}</Badge> : <Badge tone="amber">{t('db.notset', 'Not set')}</Badge>}
          </div>
          {data?.tokenFromEnv ? (
            <p className="text-xs text-[var(--muted)]">{t('db.token.env', 'The token is provided via the DISCORD_TOKEN environment variable and is managed outside the dashboard.')}</p>
          ) : botDisabled ? (
            <>
              <p className="text-xs text-[var(--muted)] mb-2">{t('db.token.paste', 'Paste your Discord bot token — it’s stored server-side and the bot connects automatically within ~20s. The token is never shown again.')}</p>
              <div className="flex gap-2">
                <Input type="password" value={tokenInput} onChange={(e) => setTokenInput(e.target.value)} placeholder={data?.hasToken ? t('db.token.new', 'New token…') : t('db.token.ph', 'Bot token…')} onKeyDown={(e) => e.key === 'Enter' && saveToken()} />
                <Button variant="primary" onClick={saveToken}>{data?.hasToken ? t('db.token.change', 'Change') : t('db.token.settoken', 'Set token')}</Button>
                {data?.hasToken && <Button className="!text-error" onClick={clearToken}>{t('db.token.clear', 'Clear')}</Button>}
              </div>
            </>
          ) : (
            <p className="text-xs text-warning flex items-center gap-1.5"><Bell size={12} /> {t('db.token.needoff', 'Turn the bot off (master switch) and Save to change the token.')}</p>
          )}
          {!online && !data?.hasToken && <div className="text-[11px] text-[var(--muted)] mt-2 flex items-center gap-1.5"><Bell size={12} /> {t('db.token.none', 'No token set — add one (or set DISCORD_TOKEN in compose .env) to bring the bot online.')}</div>}
        </Card>

        {data?.storage && (
          <Card className="p-4">
            <div className="flex items-center justify-between mb-1.5"><span className="font-medium text-sm flex items-center gap-2"><HardDrive size={14} className="text-[var(--primary-2)]" /> {t('db.memberdb', 'Member database')}</span>
              <span className="text-xs text-[var(--muted)]">{data.storage.memberCount} {t('db.tracked', 'tracked')}</span></div>
            {(() => { const capMB = cfg.limits?.storageMB || 0; const usedMB = data.storage.usedBytes / (1024 * 1024); const pct = capMB ? Math.min(100, (usedMB / capMB) * 100) : 0; return (
              <>
                <div className="h-1.5 rounded-full bg-[var(--surface-2)] overflow-hidden"><div className={`h-full ${pct > 90 ? 'bg-error' : 'bg-gradient-to-r from-brand to-brand-2'}`} style={{ width: `${pct}%` }} /></div>
                <div className="text-xs text-[var(--faint)] mt-1.5">{usedMB.toFixed(1)} MB {capMB ? t('db.mbcap', '/ {c} MB max').replace('{c}', capMB) : t('db.nocap', '(no cap set)')} {t('db.dbnote', '— oldest inactive members are pruned once over.')}</div>
              </>
            ); })()}
          </Card>
        )}
      </div>

      <BotLogsCard />
      <BotDMCard />
      <BotGiveawaysCard />

      {/* ═══════════ GLOBAL — cross-server ═══════════ */}
      <SectionTitle icon={Globe} title={t('db.sec.global', 'Global — applies across every server')} sub={t('db.sec.global.sub', 'Announcements route by channel (works in any server); limits are shared.')} />
      {/* Masonry columns (not a 2-col grid): the expanded Payments card is much
          taller than the collapsed ones, so a grid left a big empty gap beside it.
          Columns let the short cards pack tight regardless of neighbour height. */}
      <div className="columns-1 md:columns-2 gap-4 [&>*]:mb-4 [&>*]:break-inside-avoid">
        <ModuleCard icon={Newspaper} title={t('db.mod.blog', 'Blog announcements')} desc={t('db.mod.blog.d', 'Post new blog posts to any channel — filter each route by project.')} enabled={!!cfg.blog?.enabled} onToggle={(v) => set('blog.enabled', v)}>
          <BlogRoutes routes={blogRoutes} onChange={(r) => set('blog.routes', r)} guildList={guildList} />
        </ModuleCard>

        <ModuleCard icon={AlertTriangle} title={t('db.mod.alerts', 'Alerts')} desc={t('db.mod.alerts.d', 'Post alerts as they fire — performance in one channel, incidents in another.')} enabled={!!cfg.alerts?.enabled} onToggle={(v) => set('alerts.enabled', v)}>
          <Field label={t('db.f.alertch', 'Performance channel id')} hint={t('db.f.alertch.h', 'CPU, memory, disk, Web Vitals and storage — the "is it slow?" alerts.')}>
            <Input value={g('alerts.channelId')} onChange={(e) => set('alerts.channelId', e.target.value)} placeholder={t('db.f.chanid', 'Channel ID')} />
          </Field>
          {/* Optional on purpose. Left empty, incidents keep going to the performance
              channel — which is what every existing configuration already does, so adding
              this field cannot change anyone's setup by being present. */}
          <Field label={t('db.f.alertch2', 'Incidents channel id (optional)')} hint={t('db.f.alertch2.h', 'A service going unreachable, error bursts, and any future alert type. Leave empty to send everything to the performance channel.')}>
            <Input value={g('alerts.generalChannelId')} onChange={(e) => set('alerts.generalChannelId', e.target.value)} placeholder={t('db.f.chanid', 'Channel ID')} />
          </Field>
        </ModuleCard>

        <ModuleCard icon={Heart} title={t('db.mod.kofi', 'Ko-fi tips')} desc={t('db.mod.kofi.d', 'Thank supporters automatically with a running total.')} enabled={!!cfg.kofi?.enabled} onToggle={(v) => set('kofi.enabled', v)}>
          <Field label={t('db.f.tipsch', 'Tips channel id')} hint={t('db.f.tipsch.h', 'Each new tip is posted as a thank-you embed. Old tips are never re-posted.')}>
            <Input value={g('kofi.channelId')} onChange={(e) => set('kofi.channelId', e.target.value)} placeholder={t('db.f.chanid', 'Channel ID')} />
          </Field>
        </ModuleCard>

        <ModuleCard icon={Receipt} title={t('db.mod.pay', 'Payments & refunds')} desc={t('db.mod.pay.d', 'Post each successful Stripe payment and each refund to the chosen channels.')} enabled={!!cfg.payments?.enabled} onToggle={(v) => set('payments.enabled', v)}>
          <Field label={t('db.f.paych', 'Payments channels')} hint={t('db.f.paych.h', 'Every successful payment (hosting, boost…) is posted to each of these channels.')}>
            <MultiChannelInput value={cfg.payments?.channelIds?.length ? cfg.payments.channelIds : (cfg.payments?.channelId ? [cfg.payments.channelId] : [])} onChange={(v) => set('payments.channelIds', v)} placeholder={t('db.f.chanid', 'Channel ID')} />
          </Field>
          <Field label={t('db.f.refundch', 'Refunds channels')} hint={t('db.f.refundch.h', 'Refunds are posted to each of these. Empty = use the payments channels.')}>
            <MultiChannelInput value={cfg.payments?.refundChannelIds?.length ? cfg.payments.refundChannelIds : (cfg.payments?.refundChannelId ? [cfg.payments.refundChannelId] : [])} onChange={(v) => set('payments.refundChannelIds', v)} placeholder={t('db.f.chanid', 'Channel ID')} />
          </Field>
          <div className="pt-1">
            <Button size="sm" onClick={async () => { try { await api.post('/admin/bot/payments/test'); toast.success(t('db.pay.testsent', 'Test queued — the bot posts it within ~2 min. Check the channel (and the bot logs if nothing shows).')); } catch { toast.error(t('common.failed', 'Failed.')); } }}><Bell size={13} /> {t('db.pay.test', 'Send test message')}</Button>
            <p className="text-[11px] text-[var(--faint)] mt-1.5">{t('db.pay.testnote', 'Posts a sample embed to the channels above so you can verify the bot can post there — no real payment needed. Save your channel ids first. Note: only NEW payments are announced after you enable this module (existing ones are skipped).')}</p>
            <PaymentsDiag />
          </div>
        </ModuleCard>

        <ModuleCard icon={Sliders} title={t('db.mod.limits', 'Limits')}>
          <div className="grid grid-cols-2 gap-2">
            <Field label={t('db.f.maxtemp', 'Max temp channels')}><Input type="number" value={g('limits.maxTempChannels')} onChange={(e) => set('limits.maxTempChannels', Number(e.target.value))} /></Field>
            <Field label={t('db.f.dbcap', 'Member DB cap (MB)')} hint={t('db.f.dbcap.h', 'Oldest inactive members are pruned once over.')}><Input type="number" value={g('limits.storageMB')} onChange={(e) => set('limits.storageMB', Number(e.target.value))} /></Field>
          </div>
        </ModuleCard>
      </div>

      {/* ═══════════ PER-SERVER ═══════════ */}
      <SectionTitle icon={Server} title={t('db.sec.perserver', 'Per-server configuration')} sub={t('db.sec.perserver.sub', 'Moderation, welcome, join-to-create and gated roles — set independently for each server the bot is in.')} />
      {/* Scope selector — a bot-dashboard server picker (avatars + custom-config dot) */}
      <div className="flex gap-2 mb-3 overflow-x-auto no-scrollbar pb-1">
        <ServerBubble name={t('db.scope.global', 'Global defaults')} sub={t('db.scope.everyserver', 'every server')} active={scope === ''} onClick={() => setScope('')} />
        {guildList.map((gg) => (
          <ServerBubble key={gg.id} name={gg.name} icon={gg.icon} sub={gg.members != null ? t('db.scope.members', '{n} members').replace('{n}', gg.members) : t('db.scope.server', 'server')}
            active={scope === gg.id} dot={!!cfg.guilds?.[gg.id]} onClick={() => setScope(gg.id)} />
        ))}
      </div>
      {guildList.length === 0 && (
        <div className="text-xs text-[var(--muted)] mb-3 flex items-center gap-1.5 rounded-lg border border-[var(--line)] bg-[var(--surface-2)]/40 p-3">
          <Bell size={13} /> {t('db.scope.noservers', 'No servers detected yet. Bring the bot online (token above) and add it to your Discord servers — they’ll appear here to configure individually. Until then, edit the Global defaults which apply to every server.')}
        </div>
      )}

      {/* Scope banner */}
      <div className="flex items-center justify-between gap-2 flex-wrap mb-3 rounded-lg border border-[var(--line)] bg-[var(--surface-2)]/40 px-3 py-2">
        <div className="text-xs text-[var(--muted)] flex items-center gap-1.5 min-w-0">
          {scope ? <Server size={13} className="text-[var(--primary-2)] shrink-0" /> : <Globe size={13} className="text-[var(--primary-2)] shrink-0" />}
          <span className="truncate">{t('db.scope.editing', 'Editing')} <b className="text-[var(--text)]">{scopeName}</b>{scope ? (isCustomized ? '' : t('db.scope.usingdefaults', ' — currently using the global defaults')) : t('db.scope.appliedto', ' — applied to any server without its own config')}</span>
        </div>
        {scope && (isCustomized
          ? <Button size="sm" variant="ghost" className="!text-error" onClick={resetServer}><Trash2 size={13} /> {t('db.scope.reset', 'Reset to defaults')}</Button>
          : <Button size="sm" variant="primary" onClick={customizeServer}><Plus size={13} /> {t('db.scope.customize', 'Customize this server')}</Button>)}
      </div>

      {scope && !isCustomized ? (
        <div className="text-sm text-[var(--faint)] rounded-xl border border-dashed border-[var(--line)] p-6 text-center">
          <Server size={22} className="mx-auto mb-2 opacity-50" />
          {t('db.scope.prompt', 'This server uses the Global defaults. Click "Customize this server" above to give it its own moderation, welcome, join-to-create and gating settings.')}
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-4 items-start">
          {/* Moderation */}
          <ModuleCard icon={Shield} title={t('db.mod.moderation', 'Moderation')} desc={t('db.mod.moderation.d', 'Auto-kick + purge in no-post channels; anti-selfbot timeout.')} enabled={!!scopeObj.moderation?.enabled} onToggle={(v) => sset('moderation.enabled', v)}>
            <label className="flex items-center justify-between gap-2 text-sm"><span>{t('db.f.antiselfbot', 'Anti-selfbot filter')} <span className="text-[var(--faint)]">{t('db.f.antiselfbot.sub', '(mass-mention timeout)')}</span></span><BotSwitch checked={!!scopeObj.moderation?.antiSelfbot} onChange={(v) => sset('moderation.antiSelfbot', v)} /></label>
            <Field label={t('db.f.nopost', 'No-post channels')} hint={t('db.f.nopost.h', 'Posting here kicks the user + purges their messages. A channel id is unique to its server.')}>
              <ChannelIdList ids={purgeChans} onChange={(v) => sset('moderation.purgeChannelIds', v)} placeholder={t('db.f.chanph', 'Channel ID — press Enter')} />
            </Field>
          </ModuleCard>

          {/* Join-to-create */}
          <ModuleCard icon={Mic} title={t('db.mod.jtc', 'Join-to-create voice')} desc={t('db.mod.jtc.d', 'Joining a lobby spawns a personal temp voice room.')} enabled={!!scopeObj.joinToCreate?.enabled} onToggle={(v) => sset('joinToCreate.enabled', v)}
            action={<Button size="sm" variant="ghost" onClick={() => sset('joinToCreate.lobbies', [...jtcLobbies, { lobbyChannelId: '', categoryId: '', tempCategoryName: 'Temp Voice' }])}><Plus size={13} /> {t('db.jtc.addlobby', 'Lobby')}</Button>}>
            {jtcLobbies.length === 0 && <div className="text-xs text-[var(--faint)]">{t('db.jtc.nolobbies', 'No lobbies — add one. Joining that voice channel spawns a temp room in its category.')}</div>}
            {jtcLobbies.map((lb, i) => (
              <div key={i} className="rounded-lg border border-[var(--line)] p-2.5 space-y-2 relative">
                <button onClick={() => sset('joinToCreate.lobbies', jtcLobbies.filter((_, k) => k !== i))} className="absolute top-2 right-2 text-[var(--faint)] hover:text-error"><Trash2 size={13} /></button>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--faint)]">{t('db.jtc.lobbyn', 'Lobby {n}').replace('{n}', i + 1)}</div>
                <Input value={lb.lobbyChannelId || ''} onChange={(e) => sset('joinToCreate.lobbies', jtcLobbies.map((x, k) => k === i ? { ...x, lobbyChannelId: e.target.value } : x))} placeholder={t('db.jtc.lobbych', 'Lobby voice channel ID')} />
                <div className="grid grid-cols-2 gap-2">
                  <Input value={lb.categoryId || ''} onChange={(e) => sset('joinToCreate.lobbies', jtcLobbies.map((x, k) => k === i ? { ...x, categoryId: e.target.value } : x))} placeholder={t('db.jtc.catid', 'Category id (auto if empty)')} />
                  <Input value={lb.tempCategoryName || ''} onChange={(e) => sset('joinToCreate.lobbies', jtcLobbies.map((x, k) => k === i ? { ...x, tempCategoryName: e.target.value } : x))} placeholder={t('db.jtc.tempcat', 'Temp category name')} />
                </div>
              </div>
            ))}
          </ModuleCard>

          {/* Welcome / bye */}
          <ModuleCard icon={Sparkles} title={t('db.mod.welcome', 'Welcome / bye')} desc={t('db.mod.welcome.d', 'Animated banner + message when members join or leave.')} enabled={!!scopeObj.welcome?.enabled} onToggle={(v) => sset('welcome.enabled', v)}>
            <Field label={t('db.f.welcomech', 'Welcome channel id')}><Input value={sg('welcome.channelId')} onChange={(e) => sset('welcome.channelId', e.target.value)} placeholder={t('db.f.chanid', 'Channel ID')} /></Field>
            <Field label={t('db.f.joinmsg', 'Join message')} hint="{user} {username} {servername} {joinnumber} {joindate}"><Input value={sg('welcome.joinMessage')} onChange={(e) => sset('welcome.joinMessage', e.target.value)} /></Field>
            <Field label={t('db.f.leavemsg', 'Leave message')}><Input value={sg('welcome.leaveMessage')} onChange={(e) => sset('welcome.leaveMessage', e.target.value)} /></Field>
            {/* Background style for the banner. */}
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--faint)] mb-1.5">{t('db.f.bg', 'Banner background')}</div>
              <div className="flex flex-wrap gap-1.5">
                {[['dark', '#0e0c09'], ['midnight', '#0a0f1e'], ['plum', '#140a1e'], ['forest', '#08160f'], ['rose', '#1a0a12'], ['slate', '#0f1115']].map(([k, col]) => (
                  <button key={k} onClick={() => { sset('welcome.gifBg', k); setPreviewNonce((n) => n + 1); }} title={k}
                    className={`w-8 h-8 rounded-lg border-2 transition ${(sg('welcome.gifBg') || 'dark') === k ? 'border-[var(--primary)] scale-105' : 'border-[var(--line)] hover:border-[var(--line-strong)]'}`} style={{ background: col }} />
                ))}
              </div>
            </div>
            {/* Discord-style preview — a chat message from the bot; the FRAME follows the app
                theme (was hard-dark), the banner PNG itself keeps its chosen background. */}
            <div className="rounded-lg border border-[var(--line)] overflow-hidden bg-[var(--surface-2)]">
              <div className="flex items-center justify-between px-3 pt-2">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--faint)]">{t('db.preview2', 'Preview · as it appears in Discord')}</div>
                <button onClick={() => setPreviewNonce((n) => n + 1)} className="text-[10px] text-[var(--primary-2)] hover:underline flex items-center gap-1"><RefreshCw size={10} /> {t('db.refresh', 'Refresh')}</button>
              </div>
              <div className="p-3 flex items-start gap-2.5">
                <img src="/logo.png" alt="" className="w-9 h-9 rounded-full shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 text-sm"><span className="font-semibold text-[var(--text)]">{scopeName || 'BetterCommunity'}</span><span className="text-[9px] font-bold px-1 py-0.5 rounded bg-[var(--primary)] text-white uppercase">Bot</span><span className="text-[10px] text-[var(--faint)]">{t('db.today', 'Today')}</span></div>
                  <div className="text-sm text-[var(--muted)] mt-0.5">{previewMsg(sg('welcome.joinMessage')) || '—'}</div>
                  <img alt="Welcome banner preview" className="mt-1.5 w-full max-w-md rounded-lg block border border-[var(--line)]"
                    src={`/api/admin/bot/welcome-preview.png?server=${encodeURIComponent(scopeName)}&members=${status?.users || 1024}&username=NewMember&bg=${sg('welcome.gifBg') || 'dark'}&_=${previewNonce}`}
                    onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                </div>
              </div>
            </div>
          </ModuleCard>

          {/* Gated access */}
          <ModuleCard icon={KeyRound} title={t('db.mod.gating', 'Gated access')} desc={t('db.mod.gating.d', 'Grant roles automatically to members who link their account.')} enabled={!!scopeObj.gating?.enabled} onToggle={(v) => sset('gating.enabled', v)}>
            <p className="text-xs text-[var(--muted)]">{t('db.gating.desc', 'Each rule grants ONE Discord role to members who meet its requirements. Re-checked every ~5 min (granting AND removing); members can run /refreshroles to sync instantly after linking on the site.')}</p>
            <GatingRules rules={Array.isArray(scopeObj.gating?.rules) ? scopeObj.gating.rules : []} onChange={(rules) => sset('gating.rules', rules)} />
          </ModuleCard>
        </div>
      )}

      <AdminBotMembers />
    </div>
  );
}

// The bot's "member database" — DiscordActivity rows, paginated + searchable —
// with the linked BCWEB account shown when there is one.
function AdminBotMembers() {
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const [link, setLink] = useState(''); // '' | 'linked' | 'unlinked'
  const [rows, setRows] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [counts, setCounts] = useState(null); // { all, linked, unlinked }
  const [busy, setBusy] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const load = async (append = false, linkOverride) => {
    setBusy(true);
    const lk = linkOverride !== undefined ? linkOverride : link;
    try {
      const skip = append ? (rows?.length || 0) : 0;
      const { members, hasMore: more, counts: c } = await api.get(`/admin/bot/members?q=${encodeURIComponent(q)}&skip=${skip}&take=30${lk ? `&link=${lk}` : ''}`);
      setRows(append ? [...(rows || []), ...members] : members); setHasMore(more); if (c) setCounts(c);
    } catch { if (!append) setRows([]); } finally { setBusy(false); }
  };
  useEffect(() => { load(false); /* eslint-disable-next-line */ }, []);
  const pickLink = (v) => { setLink(v); load(false, v); };
  const since = (d) => d ? new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
  const tabs = [['', t('bm.all', 'All'), counts?.all], ['linked', t('bm.linked', 'Linked'), counts?.linked], ['unlinked', t('bm.notlinked', 'Not linked'), counts?.unlinked]];
  return (
    <div className="mt-6">
      <button onClick={() => setCollapsed((x) => !x)} className="w-full flex items-center gap-2 mb-1 text-left">
        <Users size={16} className="text-[var(--primary-2)]" />
        <h2 className="font-semibold flex-1">{t('bm.title', 'Members')}{counts ? <span className="text-sm font-normal text-[var(--faint)]"> · {t('bm.count', '{a} total · {l} linked').replace('{a}', counts.all).replace('{l}', counts.linked)}</span> : null}</h2>
        <ChevronDown size={16} className={`text-[var(--faint)] transition-transform ${collapsed ? '-rotate-90' : ''}`} />
      </button>
      <p className="text-sm text-[var(--muted)] mb-3">{t('bm.desc', 'The full roster — the bot scans every member on startup. Shows join date, last message/voice activity, and whether the member has linked a BCWEB account.')}</p>
      {!collapsed && <>
        <div className="flex rounded-lg border border-[var(--line)] overflow-hidden w-fit mb-3">
          {tabs.map(([v, label, n]) => (
            <button key={v} onClick={() => pickLink(v)} className={`px-3 py-1.5 text-xs flex items-center gap-1.5 ${link === v ? 'bg-[var(--surface-2)] text-[var(--text)] font-medium' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}>
              {v === 'linked' ? <CheckCircle2 size={12} className="text-success" /> : v === 'unlinked' ? <XCircle size={12} className="text-[var(--faint)]" /> : null}
              {label}{n != null && <span className="text-[var(--faint)]">{n}</span>}
            </button>
          ))}
        </div>
        <div className="flex gap-2 mb-3">
          <div className="relative flex-1"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--faint)]" />
            <Input className="!pl-9" placeholder={t('bm.search', 'Search by Discord id or username…')} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load(false)} /></div>
          <Button variant="primary" disabled={busy} onClick={() => load(false)}>{busy ? <Spinner /> : <><Search size={15} /> {t('bm.searchbtn', 'Search')}</>}</Button>
        </div>
        {rows === null ? <Loading /> : rows.length ? <div className="space-y-1.5">
          {rows.map((m) => (
            <Card key={m.discordId} className="p-3 flex items-center gap-3">
              {m.avatar ? <img src={m.avatar} alt="" className="w-9 h-9 rounded-full shrink-0" /> : <div className="w-9 h-9 rounded-full bg-[var(--surface-2)] grid place-items-center shrink-0"><DiscordIcon size={16} className="text-[#5865F2]" /></div>}
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate flex items-center gap-2">{m.username || m.discordId}
                  {m.linkedUser
                    ? <Badge tone="green"><CheckCircle2 size={11} /> {m.linkedUser.displayName}</Badge>
                    : <Badge><XCircle size={11} /> {t('bm.notlinked', 'Not linked')}</Badge>}
                </div>
                <div className="text-xs text-[var(--faint)] truncate">{t('bm.joined', 'joined')} {since(m.guildJoinedAt)} · {t('bm.lastmsg', 'last message')} {since(m.lastMessageAt)} · {t('bm.lastvoice', 'last voice')} {since(m.lastVoiceJoinAt)} · id {m.discordId}</div>
              </div>
            </Card>
          ))}
          {hasMore && <div className="text-center pt-1"><Button variant="ghost" disabled={busy} onClick={() => load(true)}>{busy ? <Spinner /> : t('bm.loadmore', 'Load more')}</Button></div>}
        </div> : <EmptyState icon={Users} title={link === 'linked' ? t('bm.none.linked', 'No linked members') : link === 'unlinked' ? t('bm.none.unlinked', 'No unlinked members') : t('bm.none', 'No members tracked yet')} sub={link ? t('bm.trother', 'Try another filter.') : t('bm.none.sub', "They'll appear here once the bot scans the server (on startup).")} />}
      </>}
    </div>
  );
}

// Admin: real object-storage usage broken down by area + hosting allocation +
// pending 72h deletions. All figures are live (listed from object storage / DB).
const LEDGER_ICON = {
  hosting: Server, submissionsPending: Upload, submissionsPublished: CheckCircle2,
  blog: Newspaper, otherProjects: Sparkles, database: TrendingUp, other: AlertTriangle,
  promoCodes: Ticket, messages: Mail, margin: Lock, backups: History,
};
// One row of the capacity ledger: a bar when we know a real allocation/cap to
// measure against, otherwise just the count/bytes we do have — every category
// that can occupy real disk space gets a place here, never invented numbers.
function LedgerRow({ row }) {
  const I = LEDGER_ICON[row.key] || HardDrive;
  const hasBar = row.allocatedBytes != null && row.allocatedBytes > 0;
  const pct = hasBar ? Math.min(100, ((row.usedBytes || 0) / row.allocatedBytes) * 100) : 0;
  return (
    <div className="py-2.5 first:pt-0 last:pb-0">
      <div className="flex items-center justify-between gap-2 text-sm mb-1">
        <span className="flex items-center gap-2 text-[var(--muted)] min-w-0"><I size={14} className="text-[var(--primary-2)] shrink-0" /> <span className="truncate">{row.label}</span></span>
        <span className="text-xs font-medium tabular-nums shrink-0">
          {row.usedBytes != null ? fmtBytes(row.usedBytes) : (row.count != null ? `${row.count}` : '—')}
          {hasBar && <span className="text-[var(--faint)]"> / {fmtBytes(row.allocatedBytes)}</span>}
          {row.count != null && row.usedBytes != null && <span className="text-[var(--faint)]"> · {row.count}</span>}
        </span>
      </div>
      {hasBar && <div className="h-1.5 rounded-full bg-[var(--surface-2)] overflow-hidden"><div className={`h-full ${pct >= 90 ? 'bg-error' : 'bg-gradient-to-r from-brand to-brand-2'}`} style={{ width: `${pct}%` }} /></div>}
      {row.note && <div className="text-[10px] text-[var(--faint)] mt-0.5">{row.note}</div>}
    </div>
  );
}

function AdminStorage() {
  const toast = useToast(); const { t } = useI18n();
  const { data, loading, reload } = useAsync(() => api.get('/admin/storage'), []);
  const [repoQ, setRepoQ] = useState('');   // search: hosted repos
  const [pendQ, setPendQ] = useState('');   // search: pending deletions
  const cancelRepoDeletion = async (r) => { try { await api.post(`/admin/repos/${r.id}/delete/cancel`); toast.success(t('as.backonline', '"{n}" is back online.').replace('{n}', r.name)); reload(); } catch { toast.error(t('common.failed', 'Failed.')); } };
  if (loading) return <Loading />;
  const d = data || {};
  const rq = repoQ.trim().toLowerCase();
  const filteredRepos = (d.topRepos || []).filter((r) => !rq || r.name?.toLowerCase().includes(rq) || r.owner?.toLowerCase().includes(rq));
  const pq = pendQ.trim().toLowerCase();
  const pendItems = (d.pending?.items || []).filter((i) => !pq || i.name?.toLowerCase().includes(pq) || i.kind?.toLowerCase().includes(pq));
  const pendRepos = (d.pending?.repos || []).filter((r) => !pq || r.name?.toLowerCase().includes(pq) || r.owner?.toLowerCase().includes(pq));
  const areas = d.areas || [];
  const total = d.totals?.bytes || 0;
  const colors = ['bg-orange-500', 'bg-warning', 'bg-info', 'bg-error'];
  const AREA_ICON = { repos: Server, catalog: Package, blog: Newspaper, other: AlertTriangle };
  const pending = (d.pending?.items?.length || 0) + (d.pending?.repos?.length || 0);
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold flex items-center gap-2"><HardDrive size={16} className="text-[var(--primary-2)]" /> {t('as.title', 'Storage')}</h2>
        <Button size="sm" variant="ghost" onClick={reload}><RefreshCw size={14} /> {t('as.refresh', 'Refresh')}</Button>
      </div>

      {/* Headline = grand total across ALL storage tiers (object storage + database +
          backups + telemetry), not just the object bucket — with each tier's real size
          and WHERE it physically lives (local vs. another server). */}
      {(() => {
        const tiers = d.tiers || [];
        const grand = d.grandTotalBytes || 0;
        const objTier = tiers.find((x) => x.key === 'object');
        const TIER_COLOR = { object: 'bg-orange-500', database: 'bg-info', backups: 'bg-violet-400', telemetry: 'bg-success' };
        const locBadge = (x) => x.location === 'remote' ? <Badge tone="amber">{t('as.remote', 'remote')}</Badge>
          : x.location === 'local' ? <Badge tone="green">{t('as.local', 'local')}</Badge>
          : x.available === false ? <Badge tone="red">{t('as.offline', 'offline')}</Badge>
          : <Badge>{t('as.external', 'external')}</Badge>;
        return (
          <div className="grid sm:grid-cols-[1.7fr_1fr] gap-3 mb-4">
            <Card className="p-5">
              <div className="flex items-baseline gap-2 flex-wrap">
                <div className="text-3xl font-bold">{fmtBytes(grand)}</div>
                <div className="text-xs text-[var(--muted)]">{t('as.alltiers', 'total across all storage tiers')}</div>
              </div>
              <div className="h-3 rounded-full overflow-hidden flex bg-[var(--surface-2)] mt-3">
                {tiers.filter((x) => x.bytes > 0).map((x) => <div key={x.key} className={TIER_COLOR[x.key] || 'bg-[var(--faint)]'} style={{ width: `${grand ? (x.bytes / grand * 100) : 0}%` }} title={`${x.label}: ${fmtBytes(x.bytes)}`} />)}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3 text-xs">
                {tiers.map((x) => <span key={x.key} className="flex items-center gap-1.5"><span className={`w-2.5 h-2.5 rounded-sm ${TIER_COLOR[x.key] || 'bg-[var(--faint)]'}`} />{x.label} · <b>{x.bytes != null ? fmtBytes(x.bytes) : '—'}</b>{x.key === 'object' && x.count != null ? ` (${x.count})` : ''}</span>)}
              </div>
              <div className="text-[11px] text-[var(--faint)] mt-2">{t('as.objsub', 'Object storage alone: {b} across {n} objects.').replace('{b}', fmtBytes(objTier?.bytes || total)).replace('{n}', objTier?.count ?? (d.totals?.count || 0))}</div>
            </Card>
            <Card className="p-5">
              <div className="flex items-center gap-2 text-xs text-[var(--faint)] mb-2"><Globe size={13} /> {t('as.locations', 'Storage locations')}</div>
              <div className="space-y-2">
                {tiers.map((x) => (
                  <div key={x.key} className="flex items-center gap-2 text-xs">
                    <span className={`w-2 h-2 rounded-sm shrink-0 ${TIER_COLOR[x.key] || 'bg-[var(--faint)]'}`} />
                    <span className="flex-1 min-w-0 truncate" title={x.host || ''}>{x.label}{x.host ? <span className="text-[var(--faint)]"> · {x.host}</span> : ''}</span>
                    {locBadge(x)}
                  </div>
                ))}
              </div>
              <div className="text-[11px] text-[var(--faint)] mt-2.5">{t('as.locnote', '“Total capacity” below meters this host’s disk. A tier on another server (object storage, telemetry, a managed DB) is metered by its own usage & limit instead.')}</div>
            </Card>
          </div>
        );
      })()}

      {/* Hosting capacity vs the Total capacity configured in Hosting settings */}
      {d.capacity && (() => {
        const cap = d.capacity;
        const pct = cap.usableGB ? Math.min(100, (cap.allocatedGB / cap.usableGB) * 100) : 0;
        const near = pct >= 80;
        return (
          <Card className={`p-5 mb-4 ${near ? 'border-error-border' : ''}`}>
            <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
              <div className="text-sm font-medium flex items-center gap-2"><HardDrive size={15} className="text-[var(--primary-2)]" /> {t('as.totalcap', 'Total capacity')}</div>
              <div className="text-xs text-[var(--muted)]"><b className="text-[var(--text)]">{cap.allocatedGB.toFixed(1)}</b> / {cap.usableGB.toFixed(0)} {t('as.gballocated', 'GB allocated')} <span className="text-[var(--faint)]">· {t('as.totalreserved', 'total {t} GB, {r} reserved').replace('{t}', cap.totalGB).replace('{r}', cap.reservedGB)}</span></div>
            </div>
            <div className="h-3 rounded-full bg-[var(--surface-2)] overflow-hidden">
              <div className={`h-full transition-all ${near ? 'bg-gradient-to-r from-red-500 to-brand' : 'bg-gradient-to-r from-brand to-brand-2'}`} style={{ width: `${pct}%` }} />
            </div>
            <div className={`text-xs mt-2 ${near ? 'text-error' : 'text-[var(--muted)]'}`}>{t('as.usableallocated', '{p}% of usable capacity allocated · {f} GB free').replace('{p}', Math.round(pct)).replace('{f}', cap.freeGB.toFixed(1))}{near ? t('as.pricesrise', ' — prices rise near the limit.') : ''}</div>
            <div className="text-[11px] text-[var(--faint)] mt-1.5">{t('as.hostingquotas', '{h} GB hosting quotas + {s} GB approved submissions').replace('{h}', cap.hostingAllocatedGB?.toFixed(1)).replace('{s}', cap.submissionsPublishedGB?.toFixed(2))}{cap.diskFreeGB != null && <> · {t('as.realdiskfree', 'real disk free:')} <b className="text-[var(--text)]">{cap.diskFreeGB.toFixed(0)} GB</b> / {t('as.gbtotal', '{n} GB total').replace('{n}', cap.diskTotalGB.toFixed(0))}</>}</div>
            {d.remoteTiers && <div className="text-[11px] text-warning mt-1.5">{t('as.caplocnote', 'Object storage and/or telemetry run on another server — those bytes don’t consume this disk; each is metered by its own usage & limit (see Storage locations above).')}</div>}
          </Card>
        );
      })()}

      {/* Full per-purpose ledger — every category that draws real disk space,
          each with its own allocation/usage, so "where did the space go" is
          always answerable instead of one opaque "Total capacity" number. */}
      {d.ledger && (
        <Card className="p-5 mb-4">
          <div className="text-sm font-medium mb-1 flex items-center gap-2"><Sliders size={15} className="text-[var(--primary-2)]" /> {t('as.capbypurpose', 'Capacity by purpose')}</div>
          <div className="text-[11px] text-[var(--faint)] mb-2">{t('as.capbypurposesub', 'Real usage per category — approved submissions move out of the temp margin and into their own permanent bucket once approved.')}</div>
          <div className="divide-y divide-[var(--line)]">
            {d.ledger.map((row) => <LedgerRow key={row.key} row={row} />)}
          </div>
        </Card>
      )}

      <div className="grid sm:grid-cols-3 gap-3 mb-4">
        {areas.map((a) => { const I = AREA_ICON[a.key] || HardDrive; return (
          <Card key={a.key} className="p-4">
            <div className="flex items-center gap-2 text-sm text-[var(--muted)]"><I size={15} className="text-[var(--primary-2)]" /> {a.label}</div>
            <div className="text-2xl font-bold mt-2">{fmtBytes(a.bytes)}</div>
            <div className="text-xs text-[var(--faint)] mt-0.5">{t('as.objects', '{n} objects').replace('{n}', a.count)} · <code>{a.prefix}</code></div>
          </Card>); })}
      </div>

      <Card className="p-4 mb-4">
        <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
          <div className="text-sm font-medium">{t('as.hostedrepos', 'Hosted repos')} <span className="text-[var(--faint)] font-normal">({(d.topRepos || []).length})</span></div>
          {(d.topRepos || []).length > 2 && (
            <div className="relative w-full sm:w-56"><Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--faint)]" />
              <Input className="!pl-8 !py-1.5 !text-sm" placeholder={t('as.searchnameowner', 'Search name or owner…')} value={repoQ} onChange={(e) => setRepoQ(e.target.value)} /></div>
          )}
        </div>
        <div className="grid grid-cols-3 gap-3 text-center mb-3">
          <div><div className="text-xl font-bold">{d.db?.hostedRepos || 0}</div><div className="text-xs text-[var(--muted)]">{t('as.repos', 'repos')}</div></div>
          <div><div className="text-xl font-bold">{fmtBytes(d.db?.repoUsedBytes || 0)}</div><div className="text-xs text-[var(--muted)]">{t('as.used', 'used')}</div></div>
          <div><div className="text-xl font-bold">{fmtBytes(d.db?.repoAllocatedBytes || 0)}</div><div className="text-xs text-[var(--muted)]">{t('as.allocatedquota', 'allocated (quota)')}</div></div>
        </div>
        {filteredRepos.length > 0 ? <div className="space-y-1.5 border-t border-[var(--line)] pt-3 max-h-72 overflow-auto">
          {filteredRepos.map((r) => <div key={r.id} className="flex items-center gap-2 text-sm"><Server size={13} className="text-[var(--faint)] shrink-0" /><span className="flex-1 truncate">{r.name} <span className="text-[var(--faint)]">· {r.owner}</span></span><span className="text-xs text-[var(--muted)] tabular-nums">{fmtBytes(r.used)} / {fmtBytes(r.quota)}</span></div>)}
        </div> : <div className="text-sm text-[var(--muted)] border-t border-[var(--line)] pt-3">{rq ? t('as.norepomatch', 'No repos match your search.') : t('as.nohosted', 'No hosted repos.')}</div>}
      </Card>

      <Card className="p-4">
        <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
          <div className="text-sm font-medium flex items-center gap-2"><Trash2 size={14} className="text-error" /> {t('as.pendingdel', 'Pending deletions (72h grace)')}{pending > 0 && <Badge tone="red">{pending}</Badge>}</div>
          {pending > 2 && (
            <div className="relative w-full sm:w-56"><Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--faint)]" />
              <Input className="!pl-8 !py-1.5 !text-sm" placeholder={t('as.searchnameownerkind', 'Search name, owner or kind…')} value={pendQ} onChange={(e) => setPendQ(e.target.value)} /></div>
          )}
        </div>
        {pending ? ((pendItems.length + pendRepos.length) ? <div className="space-y-1.5 max-h-72 overflow-auto">
          {pendItems.map((i) => { const I = KIND_ICON[i.kind] || Package; return <div key={i.id} className="flex items-center gap-2 text-sm"><I size={14} className="text-[var(--faint)] shrink-0" /><Badge>{i.kind}</Badge><span className="flex-1 truncate">{i.name}</span><span className="text-xs text-error">{t('as.in', 'in')} {fmtRemaining(i.deleteAt)}</span></div>; })}
          {pendRepos.map((r) => <div key={r.id} className="flex items-center gap-2 text-sm"><Server size={14} className="text-[var(--faint)] shrink-0" /><Badge>{t('as.repo', 'repo')}</Badge><span className="flex-1 truncate">{r.name} <span className="text-[var(--faint)]">· {r.owner}</span></span><span className="text-xs text-error">{t('as.in', 'in')} {fmtRemaining(r.deleteAt)}</span><Button size="sm" variant="ghost" onClick={() => cancelRepoDeletion(r)}>{t('su.cancel', 'Cancel')}</Button></div>)}
        </div> : <div className="text-sm text-[var(--muted)]">{t('as.nopendmatch', 'No pending deletions match your search.')}</div>) : <div className="text-sm text-[var(--muted)]">{t('as.nothingdel', 'Nothing scheduled for deletion.')}</div>}
      </Card>

      {d.telemetryExternal && <p className="text-xs text-[var(--faint)] mt-3">{t('as.telemreplays', 'Telemetry replays (rrweb) are stored by the separate BMM telemetry service and are not counted here.')}</p>}
    </div>
  );
}

// Page-journey funnel: readable HTML rows (from → to, bar ∝ count) instead of the
// old scaled SVG sankey whose labels shrank to unreadable in narrow columns.
function Sankey({ flows }) {
  if (!flows.length) return <div className="text-sm text-[var(--faint)] py-6 text-center">No journeys yet — needs visitors viewing multiple pages.</div>;
  const top = flows.slice(0, 10);
  const max = Math.max(1, ...top.map((f) => f.count));
  const chip = (v) => <span className="font-mono text-xs px-2 py-1 rounded-md bg-[var(--surface-2)] border border-[var(--line)] truncate max-w-[38%]" title={v}>{v}</span>;
  return (
    <div className="space-y-1.5">
      {top.map((f, i) => (
        <div key={i} className="relative flex items-center gap-2 px-2.5 py-2 rounded-lg overflow-hidden">
          <div className="absolute inset-y-0 left-0 bg-orange-500/10 rounded-lg" style={{ width: `${Math.max(6, (f.count / max) * 100)}%` }} />
          <div className="relative flex items-center gap-2 flex-1 min-w-0">
            {chip(f.from)}
            <ArrowRight size={13} className="text-[var(--primary-2)] shrink-0" />
            {chip(f.to)}
          </div>
          <span className="relative text-sm font-semibold tabular-nums shrink-0">{f.count}</span>
        </div>
      ))}
    </div>
  );
}

// A clean SVG area + line traffic chart (views area, visitors dashed line) — Rybbit-style.
// `compare` (hourly view only): same-hour-yesterday counts + %, from the API.
function TrafficChart({ series, gran = 'day', onZoom, compare }) {
  const [hover, setHover] = useState(null);
  const [wrapRef, W] = useElementWidth(800);
  // Ctrl + wheel zooms between daily and hourly. A native non-passive listener is
  // used so preventDefault() actually stops the page from scrolling while zooming.
  useEffect(() => {
    const el = wrapRef.current; if (!el || !onZoom) return;
    const onWheel = (e) => { if (!e.ctrlKey) return; e.preventDefault(); onZoom(e.deltaY < 0 ? 'in' : 'out'); };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [onZoom]);
  const fmt = (d) => gran === 'hour'
    ? new Date(d).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const fmtFull = (d) => gran === 'hour'
    ? new Date(d).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : new Date(d).toLocaleDateString();
  if (!series.length) return <div ref={wrapRef} className="text-sm text-[var(--faint)] py-8 text-center">No data yet — visits appear once visitors accept analytics cookies.</div>;
  const H = 170, padL = 30, padR = 6, padY = 6, n = series.length;
  const max = Math.max(1, ...series.map((s) => Math.max(s.count, s.visitors || 0)));
  const x = (i) => padL + (n <= 1 ? (W - padL - padR) / 2 : (i / (n - 1)) * (W - padL - padR));
  const y = (v) => H - padY - (v / max) * (H - padY * 2);
  const linePath = (key) => smoothPath(series.map((s, i) => ({ x: x(i), y: y(s[key] || 0) })));
  const area = `${linePath('count')} L ${x(n - 1).toFixed(1)} ${H - padY} L ${x(0).toFixed(1)} ${H - padY} Z`;
  const labelEvery = Math.ceil(n / 8);
  // Y-axis gridlines at 0 / ¼ / ½ / ¾ / max — finer scale so the exact height of
  // each point is readable, not just "somewhere between zero and the peak".
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => ({ v: Math.round(max * f), py: y(max * f) }));
  const last = series[n - 1];
  return (
    <div className="relative" ref={wrapRef}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 170 }} preserveAspectRatio="none"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); const i = Math.round(((e.clientX - r.left) / r.width) * (n - 1)); if (series[i]) setHover({ i, s: series[i], px: e.clientX - r.left }); }}>
        <defs><linearGradient id="viewsGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--primary)" stopOpacity="0.32" /><stop offset="100%" stopColor="var(--primary)" stopOpacity="0" /></linearGradient></defs>
        {yTicks.map((tk) => (
          <g key={tk.v}>
            <line x1={padL} y1={tk.py} x2={W - padR} y2={tk.py} stroke="var(--line)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            <text x={padL - 6} y={tk.py} textAnchor="end" dominantBaseline="middle" fontSize="9" fill="var(--faint)">{tk.v}</text>
          </g>
        ))}
        <path d={area} fill="url(#viewsGrad)" />
        <path d={linePath('count')} fill="none" stroke="var(--primary)" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
        <path d={linePath('visitors')} fill="none" stroke="#38bdf8" strokeWidth="1.5" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
        {/* the latest point stays marked even without hovering, so the line doesn't just trail off */}
        {!hover && <circle cx={x(n - 1)} cy={y(last.count)} r="3" fill="var(--primary)" />}
        {hover && <line x1={x(hover.i)} y1={padY} x2={x(hover.i)} y2={H - padY} stroke="var(--line-strong)" strokeWidth="1" vectorEffect="non-scaling-stroke" />}
        {hover && <circle cx={x(hover.i)} cy={y(hover.s.count)} r="3.5" fill="var(--primary)" />}
        {hover && <circle cx={x(hover.i)} cy={y(hover.s.visitors || 0)} r="3" fill="#38bdf8" />}
      </svg>
      <div className="flex justify-between text-[10px] text-[var(--faint)] mt-1" style={{ paddingLeft: `${(padL / W) * 100}%`, paddingRight: `${(padR / W) * 100}%` }}>
        {series.filter((_, i) => i % labelEvery === 0).map((s) => <span key={s.day}>{fmt(s.day)}</span>)}
      </div>
      {/* tooltip follows the cursor horizontally instead of sitting fixed at top-center */}
      {hover && (() => {
        const cmp = compare?.[hover.i];
        return (
          <div className="absolute top-1 text-[11px] px-2.5 py-1.5 rounded-md bg-[var(--bg-solid)] border border-[var(--line)] shadow pointer-events-none whitespace-nowrap"
            style={{ left: `${Math.min(Math.max(hover.px, 90), (wrapRef.current?.clientWidth || W) - 90)}px`, transform: 'translateX(-50%)' }}>
            {cmp && (
              <div className={`font-semibold flex items-center gap-1 mb-1 pb-1 border-b border-[var(--line)] ${cmp.pct > 0 ? 'text-success' : cmp.pct < 0 ? 'text-error' : 'text-[var(--faint)]'}`}>
                {cmp.pct > 0 ? <ArrowUpRight size={11} /> : cmp.pct < 0 ? <ArrowUpRight size={11} className="rotate-90" /> : null}
                {cmp.pct > 0 ? '+' : ''}{cmp.pct}% <span className="font-normal text-[var(--faint)]">vs same hour yesterday</span>
              </div>
            )}
            <div>{fmtFull(hover.s.day)} <b>{hover.s.count}</b> views · <b className="text-info">{hover.s.visitors || 0}</b> visitors</div>
            {cmp && <div className="text-[var(--faint)]">{fmtFull(cmp.prevHour)} <b>{cmp.prevCount}</b> views</div>}
          </div>
        );
      })()}
    </div>
  );
}

// ISO alpha-2 → localized country name (built-in, no data table).
const countryName = (cc) => { try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(String(cc).toUpperCase()) || cc; } catch { return cc; } };
const flagUrl = (cc, size = '24x18') => `https://flagcdn.com/${size}/${String(cc).toLowerCase()}.png`;
const Flag = ({ cc, className = 'w-4 h-3' }) => cc
  ? <img src={flagUrl(cc)} alt="" className={`${className} rounded-[2px] object-cover shrink-0`} onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
  : <Globe size={13} className="text-[var(--faint)] shrink-0" />;

// Tiny inline area sparkline for KPI-card backgrounds. `data` = array of numbers.
function Sparkline({ data, className = '', stroke = 'var(--primary)' }) {
  if (!data || data.length < 2) return null;
  const W = 120, H = 40, max = Math.max(1, ...data), n = data.length;
  const x = (i) => (i / (n - 1)) * W;
  const y = (v) => H - (v / max) * (H - 3) - 1.5;
  const line = smoothPath(data.map((v, i) => ({ x: x(i), y: y(v) })));
  const area = `${line} L ${W} ${H} L 0 ${H} Z`;
  const gid = `spk-${Math.random().toString(36).slice(2, 8)}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={className} aria-hidden>
      <defs><linearGradient id={gid} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={stroke} stopOpacity="0.28" /><stop offset="100%" stopColor={stroke} stopOpacity="0" /></linearGradient></defs>
      <path d={area} fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke={stroke} strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" opacity="0.9" />
    </svg>
  );
}

// Geo panel with Countries / Regions / Cities / Map tabs. Regions & cities carry their
// country so the right flag shows next to a subdivision/city name.
function GeoPanel({ countries, regions, cities, days, hours }) {
  const { t } = useI18n();
  const [tab, setTab] = useState('countries');
  const tabs = [['countries', t('an.geo.countries', 'Countries'), Globe2], ['regions', t('an.geo.regions', 'Regions'), MapPin], ['cities', t('an.geo.cities', 'Cities'), Building2], ['map', t('an.geo.map', 'Map'), MapIcon]];
  const list = tab === 'countries' ? countries : tab === 'regions' ? regions : cities;
  const tot = (list || []).reduce((a, r) => a + r.count, 0) || 1;
  const max = Math.max(1, ...(list || []).map((r) => r.count));
  return (
    <Card className="p-5">
      <div className="flex items-center gap-1 mb-3 border-b border-[var(--line)] -mx-1 px-1">
        {tabs.map(([id, label, Icon]) => (
          <button key={id} onClick={() => setTab(id)} className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium border-b-2 -mb-px transition ${tab === id ? 'border-[var(--primary)] text-[var(--text)]' : 'border-transparent text-[var(--muted)] hover:text-[var(--text)]'}`}><Icon size={13} /> {label}</button>
        ))}
      </div>
      {tab === 'map' ? <GeoMap days={days} hours={hours} height={340} />
        : (list && list.length) ? (
          <div className="space-y-2.5 max-h-[340px] overflow-auto pr-1">
            {list.map((r, i) => (
              <div key={`${r.label}-${i}`} className="flex items-center gap-3 text-sm">
                <span className="text-[var(--muted)] w-40 shrink-0 flex items-center gap-2 truncate">
                  <Flag cc={r.country || r.label} />
                  <span className="truncate">{tab === 'countries' ? countryName(r.label) : r.label}{tab === 'cities' && r.region ? <span className="text-[var(--faint)]"> · {r.region}</span> : null}</span>
                </span>
                <div className="flex-1 h-2 rounded-full bg-[var(--surface-2)] overflow-hidden"><div className="h-full bg-gradient-to-r from-brand to-brand-2" style={{ width: `${(r.count / max) * 100}%` }} /></div>
                <span className="w-12 text-right font-medium">{Math.round((r.count / tot) * 100)}%</span>
              </div>
            ))}
          </div>
        ) : <div className="text-sm text-[var(--faint)] py-4">{t('an.geo.none', 'No data yet — needs geo-located visits.')}</div>}
    </Card>
  );
}

// ── Web Vitals (real-user performance) ─────────────────────────────────────────
const VITAL_META = {
  LCP:  { label: 'Largest Contentful Paint', unit: 'ms', good: 2500, poor: 4000, fmt: (v) => v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms` },
  CLS:  { label: 'Cumulative Layout Shift', unit: '', good: 0.1, poor: 0.25, fmt: (v) => v.toFixed(3) },
  INP:  { label: 'Interaction to Next Paint', unit: 'ms', good: 200, poor: 500, fmt: (v) => `${Math.round(v)} ms` },
  FCP:  { label: 'First Contentful Paint', unit: 'ms', good: 1800, poor: 3000, fmt: (v) => v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms` },
  TTFB: { label: 'Time to First Byte', unit: 'ms', good: 800, poor: 1800, fmt: (v) => `${Math.round(v)} ms` },
};
const vitalRating = (m, v) => v == null ? null : v <= VITAL_META[m].good ? 'good' : v <= VITAL_META[m].poor ? 'ni' : 'poor';
const vitalColor = (r) => r === 'good' ? 'text-success' : r === 'ni' ? 'text-warning' : r === 'poor' ? 'text-error' : 'text-[var(--faint)]';
const RATING_ORDER = { poor: 3, ni: 2, good: 1 };
const RATING_DOT = { good: 'bg-success', ni: 'bg-warning', poor: 'bg-error' };
// A page's overall health = its worst-rated metric (one slow metric drags the page).
const pageRating = (pg) => {
  let worst = null;
  for (const [m, v] of [['LCP', pg.lcp], ['CLS', pg.cls], ['INP', pg.inp], ['FCP', pg.fcp], ['TTFB', pg.ttfb]]) {
    const r = vitalRating(m, v); if (r && (!worst || RATING_ORDER[r] > RATING_ORDER[worst])) worst = r;
  }
  return worst;
};

// Web Vitals own time-range presets (independent of the Site-analytics range).
const WV_RANGES = [['24h', { hours: 24 }], ['7d', { days: 7 }], ['30d', { days: 30 }], ['90d', { days: 90 }]];
// Metric value as a tinted rating chip (good / needs-improvement / poor).
function vitalChip(m, v) {
  const r = vitalRating(m, v);
  const tint = r === 'good' ? 'bg-success-bg text-success' : r === 'ni' ? 'bg-warning-bg text-warning' : r === 'poor' ? 'bg-error-bg text-error' : 'text-[var(--faint)]';
  return <span className={`inline-block px-2 py-0.5 rounded-md text-xs tabular-nums ${tint}`}>{v == null ? '—' : VITAL_META[m].fmt(v)}</span>;
}
const WV_DIMS = [['pages', 'an.wv.d.pages', 'Pages', Gauge], ['countries', 'an.wv.d.countries', 'Countries', MapPin], ['devices', 'an.wv.d.devices', 'Devices', Monitor], ['browsers', 'an.wv.d.browsers', 'Browsers', Globe2], ['oses', 'an.wv.d.oses', 'OS', Cpu]];
const WV_METRIC_COLS = ['lcp', 'cls', 'inp', 'fcp', 'ttfb'];

// A sortable Web-Vitals breakdown table (Rybbit-style): click any column header to sort.
function VitalsBreakdownTable({ rows, dim }) {
  const { t } = useI18n();
  const [sortCol, setSortCol] = useState('samples');
  const [dir, setDir] = useState('desc');
  const isCountry = dim === 'countries';
  const click = (col) => { if (sortCol === col) setDir((d) => (d === 'asc' ? 'desc' : 'asc')); else { setSortCol(col); setDir(col === 'key' ? 'asc' : 'desc'); } };
  const sorted = [...rows].sort((a, b) => {
    let av, bv;
    if (sortCol === 'key') { av = String(a.key ?? ''); bv = String(b.key ?? ''); return dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av); }
    av = a[sortCol]; bv = b[sortCol]; // nulls last regardless of dir
    if (av == null && bv == null) return 0; if (av == null) return 1; if (bv == null) return -1;
    return dir === 'asc' ? av - bv : bv - av;
  });
  const maxN = Math.max(...rows.map((x) => x.samples || 0), 1);
  const Arrow = ({ col }) => sortCol === col ? <ChevronDown size={11} className={`inline transition-transform ${dir === 'asc' ? 'rotate-180' : ''}`} /> : <ChevronDown size={11} className="inline opacity-20" />;
  const Th = ({ col, label, align = 'right' }) => <th onClick={() => click(col)} className={`py-2 px-2 font-semibold cursor-pointer select-none hover:text-[var(--text)] text-${align}`}>{label} <Arrow col={col} /></th>;
  if (!rows.length) return <div className="text-sm text-[var(--faint)] py-6 text-center">{t('an.wv.noseg', 'No data for this segment yet.')}</div>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm min-w-[620px]">
        <thead><tr className="text-[11px] uppercase text-[var(--faint)] text-left border-b border-[var(--line)]">
          <Th col="key" label={t(WV_DIMS.find((d) => d[0] === dim)?.[1], dim)} align="left" />
          <Th col="lcp" label="LCP" /><Th col="cls" label="CLS" /><Th col="inp" label="INP" /><Th col="fcp" label="FCP" /><Th col="ttfb" label="TTFB" />
          <Th col="samples" label={t('an.wv.samplesCol', 'Samples')} />
        </tr></thead>
        <tbody>
          {sorted.map((r) => { const rate = pageRating(r); const label = r.key ?? '—'; return (
            <tr key={label} className="border-b border-[var(--line)]/60 hover:bg-[var(--surface-2)]/30">
              <td className="py-2 px-2 relative">
                <span className={`absolute left-0 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full ${rate ? RATING_DOT[rate] : 'bg-[var(--line-strong)]'}`} />
                <span className="inline-flex items-center gap-1.5 pl-3.5 align-middle text-xs text-[var(--muted)] truncate max-w-[240px]" title={label}>
                  {isCountry && label !== '—' && <Flag cc={label} className="w-4 h-3 shrink-0" />}<span className={dim === 'pages' ? 'font-mono' : ''}>{label}</span>
                </span>
              </td>
              <td className="py-2 px-2 text-right">{vitalChip('LCP', r.lcp)}</td>
              <td className="py-2 px-2 text-right">{vitalChip('CLS', r.cls)}</td>
              <td className="py-2 px-2 text-right">{vitalChip('INP', r.inp)}</td>
              <td className="py-2 px-2 text-right">{vitalChip('FCP', r.fcp)}</td>
              <td className="py-2 px-2 text-right">{vitalChip('TTFB', r.ttfb)}</td>
              <td className="py-2 px-2 text-right">
                <div className="flex items-center justify-end gap-2">
                  <div className="h-1 w-10 rounded-full bg-[var(--surface-2)] overflow-hidden hidden md:block"><div className="h-full bg-[var(--primary)]/70" style={{ width: `${Math.round((r.samples || 0) / maxN * 100)}%` }} /></div>
                  <span className="text-[var(--faint)] tabular-nums text-xs w-8 text-right">{r.samples}</span>
                </div>
              </td>
            </tr>
          ); })}
        </tbody>
      </table>
    </div>
  );
}

// Below this many samples a metric gets NO verdict — no colour, no "% good" bar.
//
// The panel used to rate whatever it had. Two clicks on a developer's machine became
// "INP 389 ms · 50% good" in amber, which reads as a finding about the site when it is
// a finding about the sample: at n=2, "P99" is just the worse of the two, and one slow
// click is 50%. 20 is the smallest population where a share is worth printing — it is
// also what the Web-Vitals ALERT threshold already assumes (`vitalsMinSamples`), so the
// panel was the one place holding itself to a lower standard than the alerting.
const WV_MIN_SAMPLES = 20;

function WebVitals() {
  const { t } = useI18n();
  const [pct, setPct] = useState('p75');
  const [range, setRange] = useState('7d');
  const [dim, setDim] = useState('pages');          // which breakdown tab
  const [pathFilter, setPathFilter] = useState(''); // Rybbit-style path filter (applied)
  const [filterInput, setFilterInput] = useState('');
  const rq = Object.fromEntries(WV_RANGES)[range] || { days: 7 };
  const days = rq.days; const hours = rq.hours;
  const qs = `${rq.hours ? `hours=${rq.hours}` : `days=${rq.days}`}${pathFilter ? `&path=${encodeURIComponent(pathFilter)}` : ''}`;
  const { data, loading } = useAsync(() => api.get(`/admin/analytics/vitals?${qs}`), [qs]);
  const metrics = data?.metrics || [];
  const rows = data?.[dim] || [];
  const exportCsv = () => {
    const esc = csvCell; const lines = [];
    lines.push(['scope', 'metric', 'p50', 'p75', 'p90', 'p99', 'samples', 'good_share_pct'].join(','));
    for (const m of metrics) lines.push(['overall', m.metric, m.p50, m.p75, m.p90, m.p99, m.n, m.goodShare].map(esc).join(','));
    for (const [k] of WV_DIMS) { lines.push(''); lines.push([k, 'LCP', 'CLS', 'INP', 'FCP', 'TTFB', 'samples'].join(','));
      for (const r of (data?.[k] || [])) lines.push([r.key ?? r.path, r.lcp, r.cls, r.inp, r.fcp, r.ttfb, r.samples].map(esc).join(',')); }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `web-vitals-${hours ? `${hours}h` : `${days}d`}-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };
  return (
    <Card className="p-5 mb-4">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="text-sm font-semibold flex items-center gap-2"><Activity size={15} /> Web Vitals <span className="text-[11px] font-normal text-[var(--faint)]">{t('an.wv.sub', 'real-user performance')}</span></div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex rounded-lg border border-[var(--line)] overflow-hidden">
            {WV_RANGES.map(([k]) => <button key={k} onClick={() => setRange(k)} className={`px-2.5 py-1 text-xs uppercase ${range === k ? 'bg-[var(--surface-2)] text-[var(--text)] font-medium' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}>{k}</button>)}
          </div>
          <button onClick={exportCsv} disabled={!metrics.some((m) => m.n)} className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg border border-[var(--line)] text-[var(--muted)] hover:text-[var(--text)] hover:border-[var(--line-strong)] disabled:opacity-40 disabled:cursor-not-allowed transition"><Download size={13} /> {t('an.wv.export', 'Export CSV')}</button>
          <div className="flex rounded-lg border border-[var(--line)] overflow-hidden">
            {['p50', 'p75', 'p90', 'p99'].map((p) => <button key={p} onClick={() => setPct(p)} className={`px-2.5 py-1 text-xs uppercase ${pct === p ? 'bg-[var(--surface-2)] text-[var(--text)] font-medium' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}>{p}</button>)}
          </div>
        </div>
      </div>
      {/* Path filter (à la Rybbit "Filtre"). Narrows every KPI + breakdown to a page. */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-[200px]"><Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--faint)]" />
          <Input className="!pl-8 !py-1.5 text-sm" placeholder={t('an.wv.filterph', 'Filter by page path (e.g. /catalog)…')} value={filterInput} onChange={(e) => setFilterInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && setPathFilter(filterInput.trim())} /></div>
        <Button size="sm" variant="ghost" onClick={() => setPathFilter(filterInput.trim())}><Search size={14} /> {t('ev.filter', 'Filter')}</Button>
        {pathFilter && <button onClick={() => { setPathFilter(''); setFilterInput(''); }} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs bg-[var(--primary)]/12 text-[var(--primary-2)] border border-[var(--primary)]/30"><span className="font-mono">{pathFilter}</span> <X size={12} /></button>}
      </div>
      {loading ? <div className="h-24 grid place-items-center"><Spinner /></div> : !metrics.some((m) => m.n) ? (
        <div className="text-sm text-[var(--faint)] py-6 text-center">{t('an.wv.none', 'No performance samples yet — collected from real visits (needs analytics consent).')}</div>
      ) : <>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-4">
          {metrics.map((m) => { const v = m[pct];
            // The value is still shown — it is the only measurement there is. What is
            // withheld is the JUDGEMENT drawn from it.
            const thin = (m.n || 0) < WV_MIN_SAMPLES;
            const r = thin ? null : vitalRating(m.metric, v);
            const tr = (data?.trend || []).filter((x) => x.metric === m.metric).map((x) => x.p75).filter((x) => x != null);
            const stroke = r === 'good' ? '#34d399' : r === 'ni' ? '#f59e0b' : r === 'poor' ? '#f87171' : 'var(--primary)';
            return (
            <div key={m.metric} className="rounded-xl border border-[var(--line)] p-3 relative overflow-hidden">
              {tr.length > 1 && <Sparkline data={tr} stroke={stroke} className="absolute inset-x-0 bottom-0 h-7 w-full opacity-50 pointer-events-none" />}
              <div className="relative">
                <div className="text-[11px] text-[var(--muted)] flex items-center gap-1" title={VITAL_META[m.metric].label}>{m.metric}{!thin && m.goodShare != null && <span className="ml-auto text-[10px] text-[var(--faint)]">{m.goodShare}% {t('an.wv.good', 'good')}</span>}</div>
                <div className={`text-xl font-bold mt-1 ${r ? vitalColor(r) : ''}`}>{v == null ? '—' : VITAL_META[m.metric].fmt(v)}</div>
                {!thin && m.goodShare != null && <div className="h-1 rounded-full bg-[var(--surface-2)] overflow-hidden mt-1.5 mb-0.5"><div className="h-full" style={{ width: `${m.goodShare}%`, background: m.goodShare >= 75 ? '#34d399' : m.goodShare >= 50 ? '#f59e0b' : '#f87171' }} /></div>}
                <div className="text-[10px] text-[var(--faint)]">
                  {m.n} {t('an.wv.samples', 'samples')}
                  {thin && (m.n || 0) > 0
                    ? <> · <span className="text-warning">{t('an.wv.thin', 'too few to rate')}</span></>
                    : <> · {t('an.wv.goodle', 'good ≤')} {VITAL_META[m.metric].fmt(VITAL_META[m.metric].good)}</>}
                </div>
              </div>
            </div>
          ); })}
        </div>
        {/* Dimension tabs (Rybbit: Pages / Pays / Appareils / Navigateurs / OS). Each is a
            sortable p75 table — click a column header to sort. */}
        <div className="flex items-center justify-between flex-wrap gap-2 mb-2 border-b border-[var(--line)]">
          <div className="flex gap-1 overflow-x-auto no-scrollbar">
            {WV_DIMS.map(([k, key, fb, Icon]) => <button key={k} onClick={() => setDim(k)} className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 -mb-px whitespace-nowrap ${dim === k ? 'border-[var(--primary)] text-[var(--text)] font-medium' : 'border-transparent text-[var(--muted)] hover:text-[var(--text)]'}`}><Icon size={13} /> {t(key, fb)}</button>)}
          </div>
          <div className="hidden sm:flex items-center gap-2.5 text-[10px] text-[var(--faint)] pb-1.5">
            {[['good', t('an.wv.leg.good', 'Good')], ['ni', t('an.wv.leg.ni', 'Needs work')], ['poor', t('an.wv.leg.poor', 'Poor')]].map(([r, lbl]) =>
              <span key={r} className="inline-flex items-center gap-1"><span className={`w-2 h-2 rounded-full ${RATING_DOT[r]}`} /> {lbl}</span>)}
          </div>
        </div>
        <div className="pt-1"><VitalsBreakdownTable rows={dim === 'pages' ? rows.map((r) => ({ ...r, key: r.path })) : rows} dim={dim} /></div>
        <p className="text-[11px] text-[var(--faint)] mt-3">{t('an.wv.note2', 'p75 (75th percentile) of each metric — the value 75% of real visits are faster than. Green ≤ good, amber ≤ needs improvement, red above. Click a column header to sort; switch tabs for country / device / browser / OS.')}</p>
      </>}
    </Card>
  );
}

// Live/recent visitor sessions (Rybbit-style). Auto-refreshes so "in progress" sessions
// update; each row expands to its page-by-page timeline. Built from the pageview stream.
const fmtDur = (s) => s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
const fmtAgo = (d) => { const s = Math.round((Date.now() - new Date(d).getTime()) / 1000); return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`; };

// Anonymous per-session identity (never the real account): a stable "Colour Animal"
// nickname + a Boring-Avatar, both seeded by the daily-rotating visitor hash — the same
// privacy-friendly style as the BMM telemetry dashboard.
const NICK_ADJ = ['Lavender', 'Tan', 'Violet', 'Lime', 'Sapphire', 'Emerald', 'Peach', 'Gray', 'Amethyst', 'Beige', 'Teal', 'Tomato', 'Apricot', 'Aquamarine', 'Salmon', 'Crimson', 'Indigo', 'Olive', 'Coral', 'Azure', 'Maroon', 'Cyan', 'Magenta', 'Amber'];
const NICK_ANIMAL = ['Chimpanzee', 'Tiglon', 'Koi', 'Lynx', 'Anteater', 'Krill', 'Vole', 'Giraffe', 'Canid', 'Urial', 'Zebra', 'Herring', 'Viper', 'Scallop', 'Bison', 'Marten', 'Barracuda', 'Reptile', 'Rook', 'Gayal', 'Otter', 'Falcon', 'Heron', 'Ibex'];
const hashSeed = (seed) => { let h = 0; const s = String(seed || ''); for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };
function fakeNick(seed) { const h = hashSeed(seed); return `${NICK_ADJ[h % NICK_ADJ.length]} ${NICK_ANIMAL[(h >> 5) % NICK_ANIMAL.length]}`; }

// One row in a session's activity timeline — a pageview or an in-page interaction
// (click / copy / field edit / submit / modal), each with its own icon, tint and a
// human label, connected by a vertical rail so it reads like a session replay.
const EVENT_META = {
  page:        { Icon: Eye,                tint: 'text-[var(--primary-2)]', dot: 'bg-[var(--primary-2)]', key: 'an.evPage',   fb: 'Viewed' },
  click:       { Icon: MousePointerClick,  tint: 'text-info',            dot: 'bg-info',            key: 'an.evClick',  fb: 'Clicked' },
  copy:        { Icon: Copy,               tint: 'text-success',        dot: 'bg-success',        key: 'an.evCopy',   fb: 'Copied' },
  input:       { Icon: PenSquare,          tint: 'text-warning',          dot: 'bg-warning',          key: 'an.evInput',  fb: 'Edited' },
  submit:      { Icon: Send,               tint: 'text-violet-400',         dot: 'bg-violet-400',         key: 'an.evSubmit', fb: 'Submitted' },
  modal_open:  { Icon: PanelTop,           tint: 'text-fuchsia-400',        dot: 'bg-fuchsia-400',        key: 'an.evModal',  fb: 'Opened modal' },
  modal_close: { Icon: X,                  tint: 'text-[var(--faint)]',     dot: 'bg-[var(--faint)]',     key: 'an.evModalX', fb: 'Closed modal' },
};
function SessionEventRow({ e, idx, t }) {
  const m = EVENT_META[e.kind] || EVENT_META.click;
  const verb = t(m.key, m.fb);
  const isPage = e.kind === 'page';
  return (
    <div className="flex items-start gap-2.5 text-xs relative pb-2 last:pb-0">
      {/* vertical rail connecting the timeline dots */}
      <span className="absolute left-[9px] top-4 bottom-0 w-px bg-[var(--line)]" aria-hidden />
      <span className={`relative shrink-0 mt-0.5 w-[18px] h-[18px] rounded-full grid place-items-center ${m.tint}`}>
        <span className={`absolute inset-0 rounded-full opacity-15 ${m.dot}`} />
        <m.Icon size={11} className="relative" />
      </span>
      <div className="flex-1 min-w-0 flex items-baseline gap-1.5">
        {isPage ? (
          <span className="font-mono text-[var(--muted)] truncate">{e.path}</span>
        ) : (
          <>
            <span className="text-[var(--faint)] shrink-0">{verb}</span>
            {e.label && <span className="font-medium text-[var(--fg)] truncate">{e.label}</span>}
            <span className="font-mono text-[10px] text-[var(--faint)]/70 truncate">· {e.path}</span>
          </>
        )}
      </div>
      <span className="text-[var(--faint)] shrink-0 tabular-nums mt-px">{new Date(e.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
    </div>
  );
}
function SessionRow({ s }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const geo = [s.city, s.country].filter(Boolean).join(', ');
  const nick = fakeNick(s.visitor);
  return (
    <div className="rounded-xl border border-[var(--line)] overflow-hidden">
      <button onClick={() => setOpen((x) => !x)} className="w-full flex items-center gap-3 p-3 text-left hover:bg-[var(--surface-2)]/50">
        <span className="relative shrink-0">
          <Avatar seed={s.visitor} {...seededAvatar(s.visitor)} size={30} />
          {s.country && <span className="absolute -bottom-1 -right-1 rounded-[2px] overflow-hidden ring-1 ring-[var(--bg-solid)]"><Flag cc={s.country} className="w-3.5 h-2.5" /></span>}
        </span>
        <div className="flex items-center gap-1.5 shrink-0">
          <BrandImg slug={BROWSER_SLUG[s.browser]} size={14} />
          {OS_SLUG[s.os] ? <BrandImg slug={OS_SLUG[s.os]} size={14} fallback={Monitor} /> : <Monitor size={14} className="text-[var(--faint)]" />}
          {s.device === 'mobile' ? <Zap size={13} className="text-[var(--faint)]" /> : null}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm truncate flex items-center gap-1.5">
            <span className="font-medium">{nick}</span>
            <span className="font-mono text-xs text-[var(--faint)] truncate">{s.entry}</span>
            {s.exit !== s.entry && <><ArrowRight size={11} className="text-[var(--faint)] shrink-0" /><span className="font-mono text-xs text-[var(--faint)] truncate">{s.exit}</span></>}
          </div>
          <div className="text-[11px] text-[var(--faint)] truncate">{geo || t('an.unknown', 'Unknown')} · {refHost(s.ref)}</div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-xs flex items-center gap-1.5 justify-end">
            {s.live && <span className="inline-flex items-center gap-1 text-success"><span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" /> {t('an.liveLabel', 'live')}</span>}
            <span className="text-[var(--muted)]">{s.pages} {t('an.pg', 'pg')} · {fmtDur(s.durationSec)}</span>
          </div>
          <div className="text-[11px] text-[var(--faint)]">{t('an.ago', '{n} ago').replace('{n}', fmtAgo(s.end))}</div>
        </div>
        <ChevronDown size={15} className={`text-[var(--faint)] transition-transform shrink-0 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="border-t border-[var(--line)] bg-[var(--surface)]/40 px-3 py-2">
          {s.events.map((e, i) => <SessionEventRow key={i} e={e} idx={i} t={t} />)}
        </div>
      )}
    </div>
  );
}
// ISO alpha-2 → the Natural-Earth country name used in world.json, when it differs from
// the Intl.DisplayNames name. Everything else matches the Intl name directly.
const GEO_NAME_ALIAS = {
  US: 'United States', GB: 'United Kingdom', RU: 'Russia', CZ: 'Czech Rep.', KR: 'Korea',
  KP: 'Dem. Rep. Korea', BA: 'Bosnia and Herz.', MK: 'Macedonia', CI: "Côte d'Ivoire",
  SZ: 'Swaziland', CD: 'Dem. Rep. Congo', CG: 'Congo', CF: 'Central African Rep.',
  SS: 'S. Sudan', DO: 'Dominican Rep.', LA: 'Laos', SY: 'Syria', MD: 'Moldova',
  TZ: 'Tanzania', VN: 'Vietnam', BN: 'Brunei', IR: 'Iran', VE: 'Venezuela', BO: 'Bolivia',
  TW: 'Taiwan', EH: 'W. Sahara', AE: 'United Arab Emirates', GN: 'Guinea', TR: 'Turkey',
};
const geoName = (cc) => GEO_NAME_ALIAS[String(cc).toUpperCase()] || countryName(cc);

// Interactive analytics map with a 2D (mercator) / 3D (globe) toggle — same approach as
// the BMM telemetry dashboard: MapLibre GL + a keyless CARTO dark basemap. Renders EITHER
// a country choropleth (`choropleth`=[{cc,count}], shades world.json countries by traffic)
// OR markers (`points`=[{lat,lng,color,size,title,avatarSeed}]; avatarSeed → a Boring-Avatar
// pin). maplibre + world.json are lazy-loaded.
// Small hover-card body shared by the map tooltips: area name, count, share %, and the
// ▲/▼ change vs the previous equal period.
function GeoHoverCard({ info }) {
  return (
    <div className="flex items-center gap-1.5 whitespace-nowrap">
      {info.cc && <Flag cc={info.cc} />}
      <b>{info.label}</b>
      <span className="text-[var(--muted)]">{info.count} · {info.share}%</span>
      {info.delta != null && <span className={info.delta > 0 ? 'text-success' : info.delta < 0 ? 'text-error' : 'text-[var(--faint)]'}>{info.delta > 0 ? '▲' : info.delta < 0 ? '▼' : ''}{Math.abs(info.delta)}%</span>}
    </div>
  );
}

function AnalyticsMap({ points, choropleth, infoByName, height = 420 }) {
  const { t } = useI18n();
  const boxRef = useRef(null);
  const mapRef = useRef(null);
  const mlRef = useRef(null);
  const markersRef = useRef([]);
  const infoRef = useRef({});
  const [mode, setMode] = useState('globe'); // 'globe' | '2d'
  const [ready, setReady] = useState(false);
  const [hover, setHover] = useState(null); // { info, x, y }
  useEffect(() => { infoRef.current = infoByName || {}; }, [infoByName]);
  const ptSig = (points || []).map((p) => `${p.lat},${p.lng},${p.color},${p.avatarSeed || ''}`).join('|');
  const chSig = (choropleth || []).map((c) => `${c.cc}:${c.count}`).join('|');
  const stablePts = useMemo(() => points || [], [ptSig]); // eslint-disable-line
  const empty = choropleth ? (!choropleth.length && !stablePts.length) : !stablePts.length;

  useEffect(() => {
    let disposed = false;
    (async () => {
      let maplibregl, worldGeo = null;
      try {
        const [mod] = await Promise.all([import('maplibre-gl'), import('maplibre-gl/dist/maplibre-gl.css')]);
        maplibregl = mod.default;
        if (choropleth) worldGeo = await fetch('/world.json').then((r) => r.json()).catch(() => null);
      } catch { return; }
      if (disposed || !boxRef.current || mapRef.current) return;
      mlRef.current = maplibregl;
      const STYLE = { version: 8, sources: { base: { type: 'raster', tiles: ['https://basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap © CARTO' } }, layers: [{ id: 'base', type: 'raster', source: 'base' }] };
      const map = new maplibregl.Map({ container: boxRef.current, style: STYLE, center: [10, 25], zoom: 1.3, attributionControl: false, maxPitch: 0, trackResize: true, projection: { type: mode === 'globe' ? 'globe' : 'mercator' } });
      mapRef.current = map;
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
      map.on('error', () => {});
      map.on('load', () => {
        if (disposed) return;
        try { map.setProjection({ type: mode === 'globe' ? 'globe' : 'mercator' }); } catch {}
        if (worldGeo) {
          try {
            map.addSource('countries', { type: 'geojson', data: worldGeo });
            map.addLayer({ id: 'country-fill', type: 'fill', source: 'countries', paint: { 'fill-color': 'rgba(52,211,153,0.06)', 'fill-outline-color': 'rgba(255,255,255,0.18)' } });
            // Hover a country → show its count / share / vs-previous card.
            map.on('mousemove', 'country-fill', (e) => {
              const name = e.features?.[0]?.properties?.name;
              const info = infoRef.current[name];
              if (info) { map.getCanvas().style.cursor = 'default'; setHover({ info, x: e.point.x, y: e.point.y }); }
              else setHover(null);
            });
            map.on('mouseleave', 'country-fill', () => { map.getCanvas().style.cursor = ''; setHover(null); });
          } catch {}
        }
        try { map.resize(); } catch {}
        setReady(true);
      });
    })();
    return () => {
      disposed = true;
      markersRef.current.forEach((m) => { try { m.root?.unmount(); } catch {} try { m.marker.remove(); } catch {} });
      markersRef.current = [];
      try { mapRef.current?.remove(); } catch {} mapRef.current = null;
    };
    // eslint-disable-next-line
  }, []);

  useEffect(() => { const map = mapRef.current; if (map) { try { map.setProjection({ type: mode === 'globe' ? 'globe' : 'mercator' }); } catch {} } }, [mode]);

  // Choropleth: recolour countries by traffic via a `match` expression on the name.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !choropleth || !map.getLayer('country-fill')) return;
    const max = Math.max(1, ...choropleth.map((c) => c.count));
    const seen = new Set(); const expr = ['match', ['get', 'name']];
    for (const c of choropleth) {
      const n = geoName(c.cc);
      if (!n || seen.has(n)) continue; seen.add(n);
      const a = (0.28 + 0.62 * Math.sqrt(c.count / max)).toFixed(3);
      expr.push(n, `rgba(52,211,153,${a})`);
    }
    expr.push('rgba(52,211,153,0.06)'); // subtle green wash on all other land (Rybbit look)
    try { map.setPaintProperty('country-fill', 'fill-color', seen.size ? expr : 'rgba(52,211,153,0.06)'); } catch {}
  }, [chSig, ready]); // eslint-disable-line

  // Markers (sessions): a Boring-Avatar pin when avatarSeed is set, else a coloured dot.
  useEffect(() => {
    const map = mapRef.current, maplibregl = mlRef.current;
    if (!map || !maplibregl || !ready) return; // markers render alongside a choropleth too
    markersRef.current.forEach((m) => { try { m.root?.unmount(); } catch {} try { m.marker.remove(); } catch {} });
    markersRef.current = [];
    for (const p of stablePts) {
      if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
      const el = document.createElement('div');
      if (p.title) el.title = p.title;
      let root = null;
      if (p.avatarSeed) {
        const sz = p.size || 26;
        el.style.cssText = `width:${sz}px;height:${sz}px;border-radius:50%;overflow:hidden;box-shadow:0 0 0 2px ${p.color || '#fff'},0 1px 6px rgba(0,0,0,.5);cursor:default;`;
        root = createRoot(el);
        root.render(<Avatar seed={p.avatarSeed} size={sz} />);
      } else {
        const sz = p.size || 12, c = p.color || '#f97316';
        el.style.cssText = `width:${sz}px;height:${sz}px;border-radius:50%;background:${c};box-shadow:0 0 8px ${c};border:1.5px solid rgba(255,255,255,.75);cursor:default;`;
      }
      if (p.info) {
        el.addEventListener('mouseenter', () => { try { const pt = map.project([p.lng, p.lat]); setHover({ info: p.info, x: pt.x, y: pt.y }); } catch {} });
        el.addEventListener('mouseleave', () => setHover(null));
      }
      const marker = new maplibregl.Marker({ element: el }).setLngLat([p.lng, p.lat]).addTo(map);
      markersRef.current.push({ marker, root });
    }
  }, [ptSig, ready]); // eslint-disable-line

  return (
    <div className="relative">
      <div ref={boxRef} className="w-full rounded-lg overflow-hidden" style={{ height, background: '#05070d' }} />
      <div className="absolute top-2 right-2 z-10 flex rounded-lg border border-[var(--line)] overflow-hidden bg-[var(--bg-solid)]/80 backdrop-blur">
        {[['2d', '2D'], ['globe', '3D']].map(([v, l]) => (
          <button key={v} onClick={() => setMode(v)} className={`px-2.5 py-1 text-xs ${mode === v ? 'bg-[var(--surface-2)] text-[var(--text)] font-medium' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}>{l}</button>
        ))}
      </div>
      {hover && <div className="absolute z-20 text-[11px] px-2 py-1 rounded-md bg-[var(--bg-solid)] border border-[var(--line)] shadow pointer-events-none" style={{ left: Math.min(hover.x + 12, (boxRef.current?.clientWidth || 400) - 160), top: hover.y + 12 }}><GeoHoverCard info={hover.info} /></div>}
      {empty && <div className="absolute inset-0 grid place-items-center text-sm text-[var(--faint)] pointer-events-none">{t('an.map.none', 'No geo-located data yet.')}</div>}
    </div>
  );
}

// Aggregated geography map with a Country / Region toggle. Country → choropleth; Region →
// bubbles at each region's average coordinates. Every area's hover card shows its visit
// count, its share of all located traffic, and the change vs the previous equal period.
// Fetches /admin/analytics/geo. Reused by Geography→Map AND Sessions→Globe.
function GeoMap({ days, hours, height = 420 }) {
  const { t } = useI18n();
  const [level, setLevel] = useState('country'); // 'country' | 'region'
  const { data } = useAsync(() => api.get(`/admin/analytics/geo?${hours ? `hours=${hours}` : `days=${days || 30}`}`), [days, hours]);
  const total = data?.total || 0;
  const countries = data?.countries || [];
  const regions = data?.regions || [];
  const shareOf = (n) => total ? Math.round((n / total) * 1000) / 10 : 0;
  const deltaOf = (count, prev) => prev > 0 ? Math.round(((count - prev) / prev) * 100) : (count > 0 ? 100 : null);
  const infoByName = useMemo(() => {
    const m = {};
    for (const c of countries) m[geoName(c.cc)] = { cc: c.cc, label: countryName(c.cc), count: c.count, share: shareOf(c.count), delta: deltaOf(c.count, c.prev) };
    return m;
    // eslint-disable-next-line
  }, [data]);
  const rmax = Math.max(1, ...regions.map((r) => r.count));
  const cmax = Math.max(1, ...countries.map((c) => c.count));
  const regionBubbles = useMemo(() => regions.filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lng)).map((r) => ({
    lat: r.lat, lng: r.lng, size: 9 + Math.sqrt(r.count / rmax) * 26, color: 'rgba(52,211,153,.85)',
    info: { cc: r.cc, label: r.region, count: r.count, share: shareOf(r.count), delta: deltaOf(r.count, r.prev) },
  })), [data]); // eslint-disable-line
  // Country bubbles (a labelled dot per country at its avg coords) shown ON TOP of the
  // choropleth, so the data is always visible even where the fill is faint.
  const countryBubbles = useMemo(() => countries.filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lng)).map((c) => ({
    lat: c.lat, lng: c.lng, size: 10 + Math.sqrt(c.count / cmax) * 24, color: 'rgba(52,211,153,.9)',
    info: { cc: c.cc, label: countryName(c.cc), count: c.count, share: shareOf(c.count), delta: deltaOf(c.count, c.prev) },
  })), [data]); // eslint-disable-line
  return (
    <div>
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <div className="flex rounded-lg border border-[var(--line)] overflow-hidden text-xs">
          {[['country', t('an.geo.countries', 'Countries'), Globe2], ['region', t('an.geo.regions', 'Regions'), MapPin]].map(([v, label, I]) => (
            <button key={v} onClick={() => setLevel(v)} className={`px-3 py-1.5 flex items-center gap-1.5 ${level === v ? 'bg-[var(--surface-2)] text-[var(--text)] font-medium' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}><I size={12} /> {label}</button>
          ))}
        </div>
        <span className="text-[11px] text-[var(--faint)]">{t('an.geo.hint', 'Hover an area for its share of traffic + change vs the previous period.')}</span>
      </div>
      {level === 'country'
        ? <AnalyticsMap choropleth={countries} points={countryBubbles} infoByName={infoByName} height={height} />
        : <AnalyticsMap points={regionBubbles} height={height} />}
    </div>
  );
}

function SessionsPanel({ days, hours }) {
  const { t } = useI18n();
  const [data, setData] = useState(null);
  const [collapsed, setCollapsed] = useState(false);
  const [view, setView] = useState('list'); // 'list' | 'globe'
  const load = () => api.get('/admin/analytics/sessions?limit=40').then(setData).catch(() => setData({ sessions: [], liveCount: 0 }));
  useEffect(() => { load(); const id = setInterval(load, 15_000); return () => clearInterval(id); }, []);
  const sessions = data?.sessions || [];
  return (
    <Card className="p-5 mb-4">
      <button onClick={() => setCollapsed((x) => !x)} className="w-full flex items-center gap-2 mb-1 text-left">
        <Activity size={15} className="text-[var(--primary-2)]" />
        <h2 className="font-semibold flex-1 flex items-center gap-2">{t('an.sess.title', 'Sessions')}
          {data?.liveCount > 0 && <span className="inline-flex items-center gap-1.5 text-xs text-success"><span className="w-2 h-2 rounded-full bg-success animate-pulse" /> {data.liveCount} {t('an.liveLabel', 'live')}</span>}
        </h2>
        <span className="text-[11px] text-[var(--faint)] mr-1">{t('an.sess.autorefresh', 'auto-refresh 15s')}</span>
        <ChevronDown size={16} className={`text-[var(--faint)] transition-transform ${collapsed ? '-rotate-90' : ''}`} />
      </button>
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <p className="text-sm text-[var(--muted)]">{view === 'globe' ? t('an.sess.descGlobe2', 'Visitors aggregated by country/region — count, share of traffic, and change vs the previous period.') : t('an.sess.descList', 'Recent visitor sessions — click one to see its page-by-page journey. Live = active in the last 5 minutes.')}</p>
        <div className="flex rounded-lg border border-[var(--line)] overflow-hidden shrink-0">
          {[['list', t('an.sess.list', 'List'), LayoutDashboard], ['globe', t('an.sess.globe', 'Globe'), Globe2]].map(([v, label, I]) => (
            <button key={v} onClick={() => setView(v)} className={`px-3 py-1 text-xs flex items-center gap-1.5 ${view === v ? 'bg-[var(--surface-2)] text-[var(--text)] font-medium' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}><I size={12} /> {label}</button>
          ))}
        </div>
      </div>
      {!collapsed && (!data ? <div className="h-20 grid place-items-center"><Spinner /></div>
        : view === 'globe' ? <GeoMap days={days} hours={hours} height={460} />
        : sessions.length ? <div className="space-y-2 max-h-[520px] overflow-auto pr-1">{sessions.map((s) => <SessionRow key={s.visitor + s.start} s={s} />)}</div>
        : <div className="text-sm text-[var(--faint)] py-6 text-center">{t('an.sess.none', 'No sessions yet — needs visitors who accepted analytics cookies.')}</div>)}
    </Card>
  );
}

// Conversion goals: admin-defined targets (reach a page, click a button, submit a form…)
// with live completions + unique-visitor conversion rate over a chosen window.
const GOAL_KINDS = [
  ['pageview', 'goal.k.pageview', 'Page view', Eye], ['click', 'goal.k.click', 'Button click', MousePointerClick],
  ['submit', 'goal.k.submit', 'Form submit', Send], ['input', 'goal.k.input', 'Field change', PenSquare], ['copy', 'goal.k.copy', 'Copy', Copy],
  ['referrer', 'goal.k.referrer', 'From referrer', ArrowUpRight], ['country', 'goal.k.country', 'From country', Globe2],
  ['region', 'goal.k.region', 'From region', MapPin], ['city', 'goal.k.city', 'From city', Building2],
  ['device', 'goal.k.device', 'Device', Smartphone], ['os', 'goal.k.os', 'OS', Cpu], ['browser', 'goal.k.browser', 'Browser', Globe],
];
// Kinds that match a pageview attribute (referrer / geo / tech) rather than an interaction.
const GOAL_DIM = { referrer: ['goal.t.ref', 'Referrer contains', 'google, reddit, t.co…'], country: ['goal.t.country', 'Country code (2 letters)', 'US, FR, DE…'], region: ['goal.t.region', 'Region contains', 'California, Île-de-France…'], city: ['goal.t.city', 'City contains', 'Paris, Berlin…'], device: ['goal.t.device', 'Device', 'desktop / mobile / tablet'], os: ['goal.t.os', 'OS contains', 'Windows, macOS, Android…'], browser: ['goal.t.browser', 'Browser contains', 'Chrome, Firefox, Safari…'] };
function AdminGoals() {
  const { t } = useI18n(); const toast = useToast();
  const [range, setRange] = useState('30d');
  const rq = Object.fromEntries(WV_RANGES)[range] || { days: 30 };
  const qs = rq.hours ? `hours=${rq.hours}` : `days=${rq.days}`;
  const { data, loading, reload } = useAsync(() => api.get(`/admin/analytics/goals?${qs}`), [qs]);
  const goals = data?.goals || [];
  const [f, setF] = useState({ name: '', kind: 'pageview', path: '', label: '', target: '' });
  const [editId, setEditId] = useState(null); const [busy, setBusy] = useState(false);
  // Optimistic undo state: goals mid-add (temp client ids) and mid-delete (real ids
  // hidden during the undo window). The real POST/DELETE is deferred to the toast's
  // onCommit; onCancel just drops the optimistic change. Restores immediately either way.
  const [pendingAdd, setPendingAdd] = useState([]);
  const undo = useUndoableDelete(reload);
  const reset = () => { setF({ name: '', kind: 'pageview', path: '', label: '', target: '' }); setEditId(null); };
  // A sensible default name from what the goal targets, so the admin rarely has to type one.
  const autoName = () => {
    if (f.kind === 'pageview') return f.path.trim() ? t('goal.auto.visit', 'Visit {x}').replace('{x}', f.path.trim()) : t('goal.auto.anyvisit', 'Any page visit');
    const tgt = f.label.trim() || t('goal.auto.any', 'any');
    if (GOAL_DIM[f.kind]) { const lbl = GOAL_KINDS.find((k) => k[0] === f.kind); return `${t(lbl[1], lbl[2])}: ${tgt}`; }
    return { click: t('goal.auto.click', 'Click “{x}”'), submit: t('goal.auto.submit', 'Submit “{x}”'), input: t('goal.auto.input', 'Edit “{x}”'), copy: t('goal.auto.copy', 'Copy “{x}”') }[f.kind]?.replace('{x}', tgt) || tgt;
  };
  const undoSave = useUndoableSave(reload);
  const save = async () => {
    // Auto-name if the admin left it blank — one less field to think about.
    const name = f.name.trim() || autoName();
    const payload = { name, kind: f.kind, path: f.path.trim() || null, label: f.kind === 'pageview' ? null : (f.label.trim() || null), target: f.target === '' ? null : Math.max(0, Number(f.target) || 0) };
    // Editing used to be immediate on the grounds that it is not an add/remove. It is still a
    // save, though, and the site-wide rule is now that a save can be taken back — so it goes
    // through the same window. id captured, reset() deferred, as everywhere else.
    if (editId) {
      const id = editId;
      setBusy(true);
      undoSave(async () => { await api.patch(`/admin/analytics/goals/${id}`, payload); reset(); },
        t('goal.saved', 'Goal saved.'), { onSettled: () => setBusy(false) });
      return;
    }
    // Adding: show the new goal optimistically, defer the POST behind an undo window.
    const tmpId = 'tmp-' + Math.random().toString(36).slice(2);
    const draft = { id: tmpId, name, kind: payload.kind, path: payload.path, label: payload.label, target: payload.target, completions: 0, visitors: 0, rate: 0, progress: 0, _pending: true };
    setPendingAdd((a) => [draft, ...a]);
    reset();
    toast.action({
      tone: 'success', msg: t('goal.added', 'Goal added.'), cancelLabel: t('common.undo', 'Undo'),
      onCommit: async () => {
        try { await api.post('/admin/analytics/goals', payload); }
        catch { toast.error(t('common.failed', 'Failed.')); }
        finally { setPendingAdd((a) => a.filter((x) => x.id !== tmpId)); reload(); }
      },
      onCancel: () => setPendingAdd((a) => a.filter((x) => x.id !== tmpId)),
    });
  };
  const edit = (g) => { setEditId(g.id); setF({ name: g.name, kind: g.kind, path: g.path || '', label: g.label || '', target: g.target ?? '' }); };
  // Deleting: hide it and defer the DELETE behind an undo window — the undo replaces the old
  // confirm dialog. Uses the shared useUndoableDelete hook (this component predated it).
  const del = (g) => undo.del(g.id, () => api.del(`/admin/analytics/goals/${g.id}`), t('goal.deleted', 'Goal deleted.'));
  // Displayed list = optimistic adds on top, minus anything mid-delete.
  const shown = [...pendingAdd, ...goals.filter((g) => !undo.pending.has(g.id))];
  const kindLabel = (k) => { const x = GOAL_KINDS.find((g) => g[0] === k); return x ? t(x[1], x[2]) : k; };
  return (
    <div>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h2 className="font-semibold flex items-center gap-2"><Target size={16} className="text-[var(--primary-2)]" /> {t('goal.title', 'Goals')}</h2>
        <div className="flex rounded-lg border border-[var(--line)] overflow-hidden">
          {WV_RANGES.map(([k]) => <button key={k} onClick={() => setRange(k)} className={`px-2.5 py-1 text-xs uppercase ${range === k ? 'bg-[var(--surface-2)] text-[var(--text)] font-medium' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}>{k}</button>)}
        </div>
      </div>
      <p className="text-sm text-[var(--muted)] mb-4">{t('goal.sub', 'Define conversion goals and track how many visitors complete them. Completion = a matching event; the rate is unique goal visitors ÷ all visitors in the window.')}</p>

      <Card className="p-4 mb-5">
        <div className="text-sm font-semibold mb-3">{editId ? t('goal.editing', 'Edit goal') : t('goal.new', 'New goal')}</div>
        {/* Step 1 — pick what counts as a conversion (icon buttons, not a dropdown). */}
        <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--faint)] mb-2">{t('goal.step1', 'What counts as a conversion?')}</div>
        <div className="flex flex-wrap gap-2 mb-4">
          {GOAL_KINDS.map(([v, key, fb, Icon]) => <button key={v} type="button" onClick={() => setF((s) => ({ ...s, kind: v }))} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border transition ${f.kind === v ? 'border-[var(--primary)] bg-[var(--primary)]/12 text-[var(--text)]' : 'border-[var(--line)] text-[var(--muted)] hover:text-[var(--text)]'}`}><Icon size={14} /> {t(key, fb)}</button>)}
        </div>
        {/* Step 2 — a single contextual target field (+ optional page for interactions). */}
        <div className="grid sm:grid-cols-2 gap-3">
          {f.kind === 'pageview'
            ? <Field label={t('goal.t.page', 'Which page? (path contains)')}><Input value={f.path} onChange={(e) => setF({ ...f, path: e.target.value })} placeholder="/auth, /catalog…" /></Field>
            : GOAL_DIM[f.kind]
              ? <Field label={t(GOAL_DIM[f.kind][0], GOAL_DIM[f.kind][1])}><Input value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} placeholder={`${GOAL_DIM[f.kind][2]} ${t('goal.t.blankany', '(blank = any)')}`} /></Field>
              : <>
                  <Field label={t('goal.t.text', 'Which button / field? (text contains)')}><Input value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} placeholder={t('goal.t.textph', 'Sign up, Install… (blank = any)')} /></Field>
                  <Field label={t('goal.t.onpage', 'On page (optional)')}><Input value={f.path} onChange={(e) => setF({ ...f, path: e.target.value })} placeholder="/catalog…" /></Field>
                </>}
          <Field label={<span className="flex items-center gap-1.5">{t('goal.name', 'Goal name')} <span className="text-[10px] text-[var(--faint)] normal-case font-normal">{t('goal.name.auto', '(auto if blank)')}</span></span>}><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={autoName()} /></Field>
          <Field label={<span className="flex items-center gap-1.5">{t('goal.target', 'Target')} <span className="text-[10px] text-[var(--faint)] normal-case font-normal">{t('goal.target.hint', '(optional — e.g. 1000 completions)')}</span></span>}><Input type="number" min="0" value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} placeholder="1000" /></Field>
        </div>
        <div className="text-xs text-[var(--muted)] mt-3 flex items-start gap-1.5"><Target size={13} className="text-[var(--primary-2)] mt-0.5 shrink-0" /> <span>{t('goal.preview', 'Counts a conversion when a visitor:')} <b>{autoName().toLowerCase()}</b>.</span></div>
        <div className="flex justify-end gap-2 mt-3">
          {editId && <Button variant="ghost" onClick={reset}>{t('common.cancel', 'Cancel')}</Button>}
          <Button variant="primary" disabled={busy} onClick={save}>{busy ? <Spinner /> : (editId ? t('goal.savebtn', 'Save') : <><Plus size={15} /> {t('goal.addbtn', 'Add goal')}</>)}</Button>
        </div>
      </Card>

      {loading ? <Loading /> : shown.length ? <div className="space-y-2">
        {shown.map((g) => (
          <Card key={g.id} className={`p-4 ${g._pending ? 'opacity-60' : ''}`}>
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex-1 min-w-[160px]">
                <div className="font-medium flex items-center gap-2">{g.name} <Badge tone="">{kindLabel(g.kind)}</Badge></div>
                <div className="text-xs text-[var(--faint)] mt-0.5">{g.path ? <span className="font-mono">{g.path}</span> : t('goal.anypage', 'any page')}{g.label ? <> · “{g.label}”</> : ''}</div>
              </div>
              <div className="text-center px-3"><div className="text-lg font-bold tabular-nums">{g.completions}</div><div className="text-[10px] text-[var(--faint)] uppercase">{t('goal.completions', 'completions')}</div></div>
              <div className="text-center px-3"><div className="text-lg font-bold tabular-nums">{g.visitors}</div><div className="text-[10px] text-[var(--faint)] uppercase">{t('goal.visitors', 'visitors')}</div></div>
              <div className="text-center px-3 min-w-[90px]"><div className="text-lg font-bold tabular-nums text-[var(--primary-2)]">{g.rate}%</div><div className="text-[10px] text-[var(--faint)] uppercase">{t('goal.rate', 'conv. rate')}</div></div>
              <div className="flex gap-1">
                {g._pending
                  ? <span className="text-[10px] uppercase tracking-wide text-[var(--faint)] px-1.5 py-1">{t('goal.pending', 'saving…')}</span>
                  : <>
                      <button onClick={() => edit(g)} className="p-1.5 rounded-md text-[var(--faint)] hover:text-[var(--primary-2)] hover:bg-[var(--surface-2)]"><PenSquare size={15} /></button>
                      <button onClick={() => del(g)} className="p-1.5 rounded-md text-[var(--faint)] hover:text-error hover:bg-[var(--surface-2)]"><Trash2 size={15} /></button>
                    </>}
              </div>
            </div>
            <div className="h-1.5 rounded-full bg-[var(--surface-2)] overflow-hidden mt-3"><div className="h-full bg-gradient-to-r from-brand to-brand-2" style={{ width: `${Math.min(100, g.rate)}%` }} /></div>
            {g.target != null && <div className="mt-2">
              <div className="flex items-center justify-between text-[11px] text-[var(--faint)] mb-1"><span className="flex items-center gap-1"><Target size={11} /> {t('goal.targetprog', 'Target progress')}</span><span className="tabular-nums font-medium text-[var(--muted)]">{g.completions} / {g.target} ({g.progress ?? 0}%)</span></div>
              <div className="h-1.5 rounded-full bg-[var(--surface-2)] overflow-hidden"><div className="h-full bg-gradient-to-r from-sky-500 to-emerald-500" style={{ width: `${g.progress ?? 0}%` }} /></div>
            </div>}
          </Card>
        ))}
      </div> : <EmptyState icon={Target} title={t('goal.none', 'No goals yet')} sub={t('goal.none.s', 'Add your first conversion goal above.')} />}
      {data?.totalVisitors != null && <p className="text-[11px] text-[var(--faint)] mt-3">{t('goal.denom', 'Conversion rate is out of {n} unique visitors in this window.').replace('{n}', data.totalVisitors)}</p>}
    </div>
  );
}

// Client-error dashboard: uncaught errors + rejections grouped by message, with
// occurrences, distinct sessions, first/last seen, and an expandable stack trace.
function AdminErrors() {
  const { t } = useI18n(); const toast = useToast();
  const [q, setQ] = useState(''); const [qApplied, setQApplied] = useState('');
  const [range, setRange] = useState('7d'); const [open, setOpen] = useState(null);
  const [source, setSource] = useState(''); // '' = both · server = API 5xx · client = browser
  const rq = Object.fromEntries(WV_RANGES)[range] || { days: 7 };
  const qs = `${rq.hours ? `hours=${rq.hours}` : `days=${rq.days}`}${qApplied ? `&path=${encodeURIComponent(qApplied)}` : ''}${source ? `&source=${source}` : ''}`;
  const { data, loading, reload } = useAsync(() => api.get(`/admin/analytics/errors?${qs}`), [qs]);
  const errors = data?.errors || [];
  // The in-memory tail (survives a DB outage). We only surface it when it holds errors that
  // FAILED to persist — those are the previously-invisible ones, the 500s where the database
  // was the thing that broke, so neither the list below nor its own logger could record them.
  const recent = useAsync(() => api.get('/admin/analytics/errors/recent'), []);
  const unpersisted = (recent.data?.recent || []).filter((e) => e.persisted === false);
  const copy = (txt, msg) => { navigator.clipboard?.writeText(txt); toast.success(msg || t('er.copied', 'Copied.')); };
  const exportJson = () => {
    const blob = new Blob([JSON.stringify(errors, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `errors-${range}-${Date.now()}.json`; a.click(); URL.revokeObjectURL(a.href);
  };
  return (
    <div>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h2 className="font-semibold flex items-center gap-2"><AlertTriangle size={16} className="text-error" /> {t('er.title', 'Errors')} {data?.total ? <Badge tone="red">{data.total}</Badge> : null}</h2>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-[var(--line)] overflow-hidden">
            {WV_RANGES.map(([k]) => <button key={k} onClick={() => setRange(k)} className={`px-2.5 py-1 text-xs uppercase ${range === k ? 'bg-[var(--surface-2)] text-[var(--text)] font-medium' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}>{k}</button>)}
          </div>
          {errors.length > 0 && <Button size="sm" variant="ghost" onClick={exportJson}><Download size={13} /> {t('er.export', 'Export .json')}</Button>}
          <Button size="sm" variant="ghost" onClick={reload}><RefreshCw size={13} /></Button>
        </div>
      </div>
      <p className="text-sm text-[var(--muted)] mb-3">{t('er.sub', 'Server errors (API 5xx) and uncaught JavaScript errors from real visits, grouped by message. Repeated identical server errors collapse to one entry per minute — the occurrence count is per entry, not per request.')}</p>
      {unpersisted.length > 0 && (
        <div className="mb-4 rounded-lg border border-error-border bg-error-bg px-3 py-2.5">
          <div className="font-medium text-error flex items-center gap-2 text-sm"><AlertTriangle size={14} /> {t('er.dbdown.t', '{n} recent server error(s) could not be written to the database').replace('{n}', unpersisted.length)}</div>
          <div className="text-xs text-[var(--muted)] mt-1">{t('er.dbdown.s', 'The data layer itself may be failing — which is why these are not in the list below. This tail is kept in memory. Newest:')} <span className="font-mono text-[var(--text)]">{unpersisted[0].path}</span> — {unpersisted[0].message}</div>
        </div>
      )}
      <div className="flex flex-wrap gap-2 mb-4">
        <div className="relative flex-1 min-w-[220px]"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--faint)]" />
          <Input className="!pl-9" placeholder={t('er.pathph', 'Filter by page path…')} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && setQApplied(q.trim())} /></div>
        <Dropdown value={source} onChange={setSource} options={[
          { value: '', label: t('er.src.all', 'All sources') },
          { value: 'server', label: t('er.src.server', 'Server (API 5xx)') },
          { value: 'client', label: t('er.src.client', 'Browser') },
        ]} />
        <Button variant="primary" onClick={() => setQApplied(q.trim())}><Search size={15} /> {t('ev.filter', 'Filter')}</Button>
      </div>
      {loading ? <Loading /> : errors.length ? <div className="space-y-2">
        {errors.map((e, i) => { const isOpen = open === i; return (
          <Card key={i} className="overflow-hidden">
            <button onClick={() => setOpen(isOpen ? null : i)} className="w-full text-left p-4 flex items-start gap-3 hover:bg-[var(--surface-2)]/40 transition">
              <AlertTriangle size={16} className="text-error mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm text-error break-words">{e.message}</div>
                <div className="text-xs text-[var(--faint)] mt-1 flex items-center gap-3 flex-wrap">
                  {/* A server 5xx and a browser exception need very different responses —
                      say which one this is instead of leaving them indistinguishable. */}
                  <Badge tone={e.source === 'server' ? 'red' : ''}>{e.source === 'server' ? <><Server size={9} /> {t('er.src.server', 'Server (API 5xx)')}</> : <><Globe size={9} /> {t('er.src.client', 'Browser')}</>}</Badge>
                  {e.country ? <span className="inline-flex items-center gap-1"><Flag cc={e.country} className="w-4 h-3" /></span> : null}
                  {e.browser && <span>{e.browser}{e.os ? ` · ${e.os}` : ''}</span>}
                  <span className="font-mono truncate max-w-[220px]" title={e.path}>{e.path}</span>
                  <span>{t('er.last', 'last {t}').replace('{t}', fmtAgo(e.lastSeen))}</span>
                </div>
              </div>
              <div className="flex items-center gap-4 text-center shrink-0">
                <div><div className="font-bold tabular-nums">{e.occurrences}</div><div className="text-[10px] text-[var(--faint)] uppercase">{t('er.occ', 'occurrences')}</div></div>
                <div><div className="font-bold tabular-nums">{e.sessions}</div><div className="text-[10px] text-[var(--faint)] uppercase">{t('er.sess', 'sessions')}</div></div>
                <ChevronDown size={16} className={`text-[var(--faint)] transition-transform ${isOpen ? 'rotate-180' : ''}`} />
              </div>
            </button>
            {isOpen && <div className="px-4 pb-4 border-t border-[var(--line)] pt-3 space-y-3">
              <div className="text-xs text-[var(--muted)] flex items-center gap-2 flex-wrap">
                <span><b>{t('er.page', 'Page')}:</b> <span className="font-mono">{e.path}</span></span>
                <span><b>{t('er.firstseen', 'First seen')}:</b> {new Date(e.firstSeen).toLocaleString()}</span>
                <button onClick={() => copy(`${e.message}\n${e.path}\n\n${e.stack || ''}`, t('er.copiedlog', 'Error log copied.'))} className="inline-flex items-center gap-1 text-[var(--faint)] hover:text-[var(--primary)]"><Copy size={12} /> {t('er.copylog', 'Copy log')}</button>
              </div>
              {/* Which signed-in accounts hit this error (BC ids) — click one to copy, or copy all. */}
              {e.bcIds?.length > 0 && <div>
                <div className="text-[11px] uppercase tracking-wider text-[var(--faint)] font-semibold mb-1 flex items-center gap-1.5"><Fingerprint size={12} /> {t('er.affected', 'Affected accounts')} ({e.bcIds.length}) <button onClick={() => copy(e.bcIds.join('\n'), t('er.bcidscopied', 'BC ids copied.'))} className="normal-case font-normal text-[var(--faint)] hover:text-[var(--primary)] inline-flex items-center gap-1"><Copy size={11} /> {t('er.copyall', 'copy all')}</button></div>
                <div className="flex flex-wrap gap-1.5">{e.bcIds.map((b) => <button key={b} onClick={() => copy(b)} className="text-[11px] font-mono px-1.5 py-0.5 rounded border border-[var(--line)] text-[var(--muted)] hover:text-[var(--primary)] hover:border-[var(--primary)]">{b}</button>)}</div>
              </div>}
              {e.stack ? <div>
                <div className="text-[11px] uppercase tracking-wider text-[var(--faint)] font-semibold mb-1 flex items-center gap-1.5"><FileText size={12} /> {t('er.stack', 'Stack trace')} <button onClick={() => copy(e.stack, t('er.stackcopied', 'Stack copied.'))} className="normal-case font-normal text-[var(--faint)] hover:text-[var(--primary)] inline-flex items-center gap-1"><Copy size={11} /> {t('common.copy', 'copy')}</button></div>
                <pre className="text-[11px] font-mono bg-[var(--surface-2)] rounded-lg p-3 overflow-x-auto whitespace-pre text-[var(--muted)] max-h-72">{e.stack}</pre>
              </div> : <div className="text-xs text-[var(--faint)]">{t('er.nostack', 'No stack trace captured.')}</div>}
            </div>}
          </Card>
        ); })}
      </div> : <EmptyState icon={ShieldCheck} title={t('er.none', 'No errors')} sub={t('er.none.s', 'Nothing broke in this window.')} />}
    </div>
  );
}

function AdminAnalytics() {
  const [days, setDays] = useState(30);
  const [hours, setHours] = useState(null); // when set → hourly view (zoom-in)
  const [tab, setTab] = useState('overview'); // sub-tab: overview | sessions | geo | tech | perf
  const toast = useToast();
  const { t } = useI18n();
  const { data, loading } = useAsync(() => api.get(`/admin/analytics?${hours ? `hours=${hours}` : `days=${days}`}`), [days, hours]);
  // Open BMM telemetry via an SSO handoff: mint a short-lived token (this call is
  // admin-gated + 2FA-enforced) and hand it to the telemetry dashboard, so the
  // dashboard is reachable ONLY through an authenticated BCWEB admin.
  const openTelemetry = async () => {
    try { const { url } = await api.post('/admin/telemetry/token', {}); window.open(url, '_blank', 'noopener'); }
    catch (x) { toast.error(x.data?.error === 'no_telemetry_access' ? t('an.telemetry.noperm', 'You need the "telemetry" permission (Access & permissions) to open it.') : t('an.telemetry.err', 'Could not open telemetry — an admin account with 2FA is required.')); }
  };
  const gran = data?.granularity || (hours ? 'hour' : 'day');
  // Ctrl+wheel on the chart: zoom in → hourly (24h); zoom out → back to daily.
  const onZoom = (dir) => { if (dir === 'in') setHours(24); else setHours(null); };
  const top = data?.top || [], refs = data?.refs || [], series = data?.series || [];
  const devices = data?.devices || [], browsers = data?.browsers || [], oses = data?.oses || [], flows = data?.flows || [], countries = data?.countries || [];
  const regions = data?.regions || [], cities = data?.cities || [];
  // Per-bucket arrays for the KPI-card background sparklines.
  const viewsSpark = series.map((s) => s.count);
  const visitorsSpark = series.map((s) => s.visitors || 0);
  const ppsSpark = series.map((s) => (s.visitors ? +(s.count / s.visitors).toFixed(2) : 0));
  const maxTop = Math.max(1, ...top.map((t) => t.count));
  const maxRef = Math.max(1, ...refs.map((r) => r.count));
  const maxSeries = Math.max(1, ...series.map((s) => s.count));
  const maxFlow = Math.max(1, ...flows.map((f) => f.count));
  const ranges = [['24h', '24h'], [7, t('an.range.7d', '7 days')], [30, t('an.range.30d', '30 days')], [90, t('an.range.90d', '90 days')]];
  const activeRange = hours ? '24h' : days;
  const pickRange = (v) => { if (v === '24h') setHours(24); else { setHours(null); setDays(v); } };
  // Period-over-period delta chip (▲/▼ %); for bounce rate a DROP is good (lowerBetter).
  const deltaChip = (cur, prev, lowerBetter) => {
    if (prev == null || cur == null || Number(prev) === 0) return null;
    const pct = Math.round(((cur - prev) / prev) * 100);
    if (pct === 0) return <span className="text-[10px] text-[var(--faint)]">0%</span>;
    const up = pct > 0, good = lowerBetter ? !up : up;
    return <span className={`text-[10px] font-semibold tabular-nums ${good ? 'text-success' : 'text-error'}`} title={t('an.vsprev', 'vs previous period')}>{up ? '▲' : '▼'} {Math.abs(pct)}%</span>;
  };
  const kpi = (Icon, val, label, accent, delta, spark, sparkColor) => (
    <Card className="p-4 relative overflow-hidden">
      {spark && spark.length > 1 && <Sparkline data={spark} stroke={sparkColor || 'var(--primary)'} className="absolute inset-x-0 bottom-0 h-9 w-full opacity-70 pointer-events-none" />}
      <div className="relative">
        <div className="flex items-center justify-between gap-1"><Icon size={16} className={accent || 'text-[var(--primary-2)]'} />{delta}</div>
        <div className="text-2xl font-bold mt-2">{val}</div>
        <div className="text-[11px] text-[var(--muted)]">{label}</div>
      </div>
    </Card>
  );
  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h2 className="font-semibold flex items-center gap-2"><TrendingUp size={16} /> {t('an.title', 'Site analytics')}
          {data?.live > 0 && <span className="inline-flex items-center gap-1.5 text-xs text-success ml-1"><span className="w-2 h-2 rounded-full bg-success animate-pulse" /> {data.live} {t('an.live', 'live')}</span>}</h2>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-[var(--line)] overflow-hidden">
            {ranges.map(([d, l]) => <button key={d} onClick={() => pickRange(d)} className={`px-3 py-1.5 text-xs ${activeRange === d ? 'bg-[var(--surface-2)] text-[var(--text)] font-medium' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}>{l}</button>)}
          </div>
          <Button size="sm" onClick={openTelemetry}><Gauge size={14} /> {t('an.telemetry', 'BMM telemetry')}</Button>
        </div>
      </div>

      {/* KPI row (Rybbit-style) — always visible above the sub-tabs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 sm:gap-3 mb-4">
        {kpi(Users, data?.uniqueVisitors ?? '—', t('an.kpi.visitors', 'Unique visitors'), null, deltaChip(data?.uniqueVisitors, data?.prev?.uniqueVisitors), visitorsSpark, '#38bdf8')}
        {kpi(Package, data?.sessions ?? '—', t('an.kpi.sessions', 'Sessions'), null, deltaChip(data?.sessions, data?.prev?.sessions), visitorsSpark, '#38bdf8')}
        {kpi(Eye, data?.windowed ?? '—', t('an.kpi.pageviews', 'Pageviews'), null, deltaChip(data?.windowed, data?.prev?.pageviews), viewsSpark)}
        {kpi(TrendingUp, data?.viewsPerVisitor ?? '—', t('an.kpi.pps', 'Pages / session'), null, deltaChip(data?.viewsPerVisitor, data?.prev?.viewsPerVisitor), ppsSpark)}
        {kpi(ArrowUpRight, data?.bounceRate != null ? `${data.bounceRate}%` : '—', t('an.kpi.bounce', 'Bounce rate'), null, deltaChip(data?.bounceRate, data?.prev?.bounceRate, true), viewsSpark, '#f59e0b')}
        {kpi(Zap, data?.live ?? '—', t('an.kpi.live', 'Live (30 min)'), 'text-success')}
      </div>

      {/* Sub-tab bar — horizontal-scrolls on narrow screens so it never overflows. */}
      <div className="flex gap-1 mb-4 border-b border-[var(--line)] overflow-x-auto no-scrollbar -mx-1 px-1">
        {[['overview', t('an.tab.overview', 'Overview'), TrendingUp], ['sessions', t('an.tab.sessions', 'Sessions'), Activity], ['geo', t('an.tab.geo', 'Geography'), Globe2], ['tech', t('an.tab.tech', 'Tech'), Monitor], ['data', t('an.tab.data', 'Data'), Archive]].map(([id, label, I]) => (
          <button key={id} onClick={() => setTab(id)} className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition ${tab === id ? 'border-[var(--primary)] text-[var(--text)]' : 'border-transparent text-[var(--muted)] hover:text-[var(--text)]'}`}><I size={14} /> {label}</button>
        ))}
      </div>

      {tab === 'overview' && <>
        <Card className="p-4 sm:p-5 mb-4">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div className="text-xs font-semibold text-[var(--faint)] uppercase">{gran === 'hour' ? t('an.traffic.hour', 'Traffic per hour · last 24h') : t('an.traffic.day', 'Traffic per day')}</div>
            <div className="flex items-center gap-3 text-[11px] text-[var(--muted)]">
              <span className="hidden sm:flex items-center gap-1 text-[var(--faint)]"><Search size={11} /> {t('an.zoomhint', 'Ctrl + scroll to zoom')}</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-gradient-to-t from-brand to-brand-2" /> {t('an.views', 'Views')}</span><span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-info" /> {t('an.visitors', 'Visitors')}</span></div>
          </div>
          {loading ? <div className="h-40 grid place-items-center text-[var(--faint)] text-sm"><Spinner /></div> : <TrafficChart series={series} gran={gran} onZoom={onZoom} compare={data?.compare} />}
        </Card>
        <div className="grid md:grid-cols-2 gap-4">
          <Card className="p-4 sm:p-5">
            <div className="text-xs font-semibold text-[var(--faint)] uppercase mb-3">{t('an.toppages', 'Top pages')}</div>
            <div className="space-y-2.5">
              {top.length ? top.map((tp) => (
                <div key={tp.path} className="flex items-center gap-3 text-sm">
                  <span className="text-[var(--muted)] truncate w-28 sm:w-40 shrink-0">{tp.path}</span>
                  <div className="flex-1 h-2 rounded-full bg-[var(--surface-2)] overflow-hidden"><div className="h-full bg-gradient-to-r from-brand to-brand-2" style={{ width: `${(tp.count / maxTop) * 100}%` }} /></div>
                  <span className="w-10 text-right font-medium">{tp.count}</span>
                </div>
              )) : <div className="text-sm text-[var(--faint)]">{t('an.nopages', 'No page data yet.')}</div>}
            </div>
          </Card>
          <Card className="p-4 sm:p-5">
            <div className="text-xs font-semibold text-[var(--faint)] uppercase mb-3">{t('an.toprefs', 'Top referrers')}</div>
            <div className="space-y-2.5">
              {refs.length ? refs.map((r) => { const host = refHost(r.ref); return (
                <div key={r.ref} className="flex items-center gap-3 text-sm">
                  <span className="text-[var(--muted)] truncate w-28 sm:w-40 shrink-0 flex items-center gap-2"><BrandImg favicon={/\.[a-z]{2,}$/i.test(host) ? `https://icons.duckduckgo.com/ip3/${host}.ico` : null} /> {host}</span>
                  <div className="flex-1 h-2 rounded-full bg-[var(--surface-2)] overflow-hidden"><div className="h-full bg-gradient-to-r from-sky-500 to-cyan-400" style={{ width: `${(r.count / maxRef) * 100}%` }} /></div>
                  <span className="w-10 text-right font-medium">{r.count}</span>
                </div>); })
                : <div className="text-sm text-[var(--faint)]">{t('an.norefs', 'No referrers yet — most visits are direct.')}</div>}
            </div>
          </Card>
        </div>
      </>}

      {tab === 'sessions' && <SessionsPanel days={days} hours={hours} />}

      {tab === 'geo' && (
        <div className="grid lg:grid-cols-[1.2fr_1.4fr] gap-4">
          <GeoPanel countries={countries} regions={regions} cities={cities} days={days} hours={hours} />
          <Card className="p-4 sm:p-5">
            <div className="text-xs font-semibold text-[var(--faint)] uppercase mb-3 flex items-center gap-1.5"><ArrowRight size={13} /> {t('an.funnel', 'Funnel · page journeys')}</div>
            <Sankey flows={flows} />
          </Card>
        </div>
      )}

      {tab === 'tech' && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <Breakdown title={t('an.devices', 'Devices')} rows={devices} iconOf={(l) => { const I = { mobile: Zap, tablet: Package, desktop: Server }[l] || Server; return <I size={13} className="text-[var(--faint)]" />; }} />
          <Breakdown title={t('an.browsers', 'Browsers')} rows={browsers} iconOf={(l) => <BrandImg slug={BROWSER_SLUG[l]} />} />
          <Breakdown title={t('an.os', 'Operating systems')} rows={oses} iconOf={(l) => (OS_SLUG[l] ? <BrandImg slug={OS_SLUG[l]} fallback={Monitor} /> : <Monitor size={13} className="text-[var(--faint)] shrink-0" />)} />
        </div>
      )}

      {tab === 'data' && <RetentionCard />}

      <p className="text-[11px] text-[var(--faint)] mt-4">{t('an.geonote', 'Geo is resolved from the visitor IP (CDN country header, else an offline GeoIP lookup; local/private IPs get a sample location in dev). The privacy-friendly daily-rotating visitor hash can\'t track people across days.')}</p>
    </div>
  );
}

// Data-retention windows for the append-only analytics tables (mirrors the API
// sweeper in lib/retention.mjs). Shows each table's current pressure (row count +
// oldest-row age) next to its editable window; 0 keeps that table forever.
function RetentionCard() {
  const { t } = useI18n();
  const toast = useToast();
  const { data, loading, reload } = useAsync(() => api.get('/admin/analytics/retention'), []);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data?.config) setForm(data.config); }, [data]);
  if (loading || !form) return <Loading />;
  const ageDays = (iso) => (iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 864e5)) : null);
  const rows = [
    ['pageviewDays', t('an.ret.pageviews', 'Pageviews'), data.tables.pageview],
    ['interactionDays', t('an.ret.interactions', 'Interactions'), data.tables.interaction],
    ['vitalDays', t('an.ret.vitals', 'Web Vitals'), data.tables.vital],
    ['loginDays', t('an.ret.logins', 'Login attempts'), data.tables.login],
  ];
  const set = (k, v) => setForm((f) => ({ ...f, [k]: Math.max(0, Math.min(3650, Math.floor(Number(v) || 0))) }));
  // Deferred behind the undo window: the PUT is idempotent and the server still holds the
  // previous windows, so Undo just means the request never went out.
  const undoSave = useUndoableSave(reload);
  const save = () => {
    setBusy(true);
    undoSave(() => api.put('/admin/analytics/retention', form),
      t('an.ret.saved', 'Retention windows saved.'),
      { onSettled: () => setBusy(false), errorFor: () => t('an.ret.saveerr', 'Could not save the retention windows.') });
  };
  return (
    <Card className="p-5 max-w-2xl">
      <div className="flex items-center gap-2 mb-1"><Archive size={16} className="text-[var(--primary-2)]" /><h3 className="font-semibold">{t('an.ret.title', 'Data retention')}</h3></div>
      <p className="text-xs text-[var(--muted)] mb-4">{t('an.ret.desc', 'Automatically delete analytics rows older than each window. 0 = keep forever. Purged in batches by the background sweeper.')}</p>
      <div className="space-y-3">
        {rows.map(([key, label, stat]) => {
          const age = ageDays(stat?.oldest);
          return (
            <div key={key} className="flex items-center gap-3 flex-wrap">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">{label}</div>
                <div className="text-[11px] text-[var(--faint)]">
                  {(stat?.count ?? 0).toLocaleString()} {t('an.ret.rows', 'rows')}
                  {age != null ? ` · ${t('an.ret.oldest', 'oldest')} ${age}${t('an.ret.d', 'd')}` : ''}
                  {form[key] === 0 ? ` · ${t('an.ret.keepforever', 'kept forever')}` : ''}
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <Input type="number" min={0} max={3650} value={form[key]} onChange={(e) => set(key, e.target.value)} className="w-20 text-right" />
                <span className="text-xs text-[var(--faint)]">{t('an.ret.days', 'days')}</span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-3 mt-4">
        <Button variant="primary" onClick={save} disabled={busy}>{busy ? <Spinner /> : <><Save size={15} /> {t('an.ret.save', 'Save')}</>}</Button>
        <button onClick={() => setForm(data.defaults)} className="text-xs text-[var(--muted)] hover:text-[var(--text)]">{t('an.ret.reset', 'Reset to defaults')}</button>
      </div>
    </Card>
  );
}

// ── Shared: page visibility + scheduled-update controls, used by both the
// fixed-project editor (AdminProjects) and the showcase editor (ShowcaseEditModal). ──

// Whitelist entries ({type:"bcweb"|"discord"|"creator", id, label}) — same BC/
// Discord account search as PolicyAccountChips, plus a raw creator-id add (no
// search index for that one, it's an opaque BMM-generated id).
function PageWhitelistEditor({ items, onAdd, onRemove }) {
  const [q, setQ] = useState(''); const [results, setResults] = useState(null); const [busy, setBusy] = useState(false);
  const [creatorId, setCreatorId] = useState('');
  const search = async () => {
    if (!q.trim()) return setResults(null);
    setBusy(true);
    try { const { users } = await api.get(`/admin/users?q=${encodeURIComponent(q)}&take=8`); setResults(users); } catch { setResults([]); } finally { setBusy(false); }
  };
  const has = (type, id) => items.some((a) => a.type === type && a.id === id);
  const add = (entry) => { if (!has(entry.type, entry.id)) onAdd(entry); };
  const addCreator = () => { const id = creatorId.trim(); if (id && !has('creator', id)) { onAdd({ type: 'creator', id, label: id }); setCreatorId(''); } };
  return (
    <div>
      <div className="flex gap-1.5">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search BC account / Discord…" onKeyDown={(e) => e.key === 'Enter' && search()} />
        <Button size="sm" onClick={search}>{busy ? <Spinner /> : <Search size={13} />}</Button>
      </div>
      {results && (
        <div className="mt-1.5 space-y-1">
          {results.length ? results.map((u) => (
            <div key={u.id} className="flex items-center justify-between gap-2 px-2 py-1 rounded-md bg-[var(--surface-2)] border border-[var(--line)] text-[11px]">
              <span className="truncate">{u.displayName}{u.discord && <span className="text-[var(--faint)]"> · Discord: {u.discord.username || u.discord.id}</span>}</span>
              <span className="flex gap-1 shrink-0">
                <button onClick={() => add({ type: 'bcweb', id: u.id, label: u.displayName })} className="px-1.5 py-0.5 rounded border border-[var(--line)] hover:text-[var(--primary-2)] hover:border-[var(--primary-2)]">+ BC</button>
                {u.discord && <button onClick={() => add({ type: 'discord', id: u.discord.id, label: u.discord.username || u.discord.id })} className="px-1.5 py-0.5 rounded border border-[var(--line)] hover:text-[var(--primary-2)] hover:border-[var(--primary-2)]">+ Discord</button>}
              </span>
            </div>
          )) : <div className="text-[11px] text-[var(--faint)] px-1">No accounts found.</div>}
        </div>
      )}
      <div className="flex gap-1.5 mt-1.5">
        <Input value={creatorId} onChange={(e) => setCreatorId(e.target.value)} placeholder="Add by BMM creator id…" onKeyDown={(e) => e.key === 'Enter' && addCreator()} />
        <Button size="sm" onClick={addCreator}><Plus size={13} /></Button>
      </div>
      <div className="flex flex-wrap gap-1 mt-1.5">
        {items.length ? items.map((a) => (
          <span key={`${a.type}:${a.id}`} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-[var(--surface-2)] border border-[var(--line)] text-[11px]">
            <Users size={9} className="text-[var(--faint)]" /> {a.type === 'discord' ? 'Discord: ' : a.type === 'creator' ? 'Creator: ' : ''}{a.label || a.id}
            <button onClick={() => onRemove(a)} className="text-[var(--faint)] hover:text-error"><X size={10} /></button>
          </span>
        )) : <span className="text-[11px] text-[var(--faint)]">No entries — nobody can view.</span>}
      </div>
    </div>
  );
}

const VISIBILITY_OPTS = [
  { v: 'public', label: 'Public', desc: 'Anyone can view this page.' },
  { v: 'unlisted', label: 'Unlisted', desc: "Hidden from the topbar/projects grid, but viewable by anyone with the direct link." },
  { v: 'private', label: 'Private', desc: 'Nobody can view it (admin preview only, via the edit form).' },
  { v: 'whitelist', label: 'Whitelist', desc: 'Only the accounts listed below can view it.' },
];

function VisibilitySection({ visibility, whitelist, onVisibility, onAddWhitelist, onRemoveWhitelist }) {
  return (
    <div className="p-3 rounded-lg bg-[var(--surface-2)] border border-[var(--line)] space-y-2">
      <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] flex items-center gap-1.5">{visibility === 'public' ? <Eye size={12} /> : <EyeOff size={12} />} Visibility</div>
      <Select value={visibility} onChange={(e) => onVisibility(e.target.value)}>
        {VISIBILITY_OPTS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
      </Select>
      <div className="text-[11px] text-[var(--faint)]">{VISIBILITY_OPTS.find((o) => o.v === visibility)?.desc}</div>
      {visibility === 'whitelist' && <PageWhitelistEditor items={whitelist} onAdd={onAddWhitelist} onRemove={onRemoveWhitelist} />}
    </div>
  );
}

// A "project announcement": a countdown teaser (logo + markdown) shown instead
// of the real page until announceRevealAt — used to build hype for a not-yet-
// public project. Fully optional; the section collapses to just the checkbox
// when off.
function AnnouncementSection({ value, onChange }) {
  const set = (k) => (v) => onChange({ ...value, [k]: v });
  return (
    <div className="p-3 rounded-lg bg-[var(--surface-2)] border border-[var(--line)] space-y-2">
      <label className="flex items-center gap-2 text-sm cursor-pointer font-semibold"><input type="checkbox" checked={value.announceEnabled} onChange={(e) => set('announceEnabled')(e.target.checked)} /> <Megaphone size={13} className="text-[var(--primary-2)]" /> Project announcement (countdown teaser)</label>
      {value.announceEnabled && (
        <div className="space-y-2 pl-1">
          <Field label="Title"><Input value={value.announceTitle} onChange={(e) => set('announceTitle')(e.target.value)} placeholder="Something big is coming…" /></Field>
          <Field label="Logo URL (optional)"><Input value={value.announceLogo || ''} onChange={(e) => set('announceLogo')(e.target.value)} placeholder="https://example.com/logo.png" /></Field>
          <Field label="Markdown description"><Textarea rows={4} value={value.announceMarkdown} onChange={(e) => set('announceMarkdown')(e.target.value)} placeholder="Tell people what's coming — markdown supported." /></Field>
          {/* Optional CTA — points anywhere: an external URL, or an in-site
              /blog/<slug> or /docs/<slug> article. */}
          <div className="grid grid-cols-[130px_1fr] gap-2">
            <Field label="Button label"><Input value={value.announceButtonLabel || ''} onChange={(e) => set('announceButtonLabel')(e.target.value)} placeholder="Learn more" /></Field>
            <Field label="Button link (URL, or /blog/… /docs/…)"><Input value={value.announceButtonUrl || ''} onChange={(e) => set('announceButtonUrl')(e.target.value)} placeholder="/docs/roadmap" /></Field>
          </div>
          <Field label="Reveal at"><Input type="datetime-local" value={value.announceRevealAt || ''} onChange={(e) => set('announceRevealAt')(e.target.value)} /></Field>
          <label className="flex items-center gap-2 text-sm cursor-pointer pt-1"><input type="checkbox" checked={!!value.announceShowPage} onChange={(e) => set('announceShowPage')(e.target.checked)} /> Show the page behind the countdown (adds it as a first tab instead of hiding everything)</label>
          <p className="text-[11px] text-[var(--faint)]">
            {value.announceShowPage
              ? 'The real page stays reachable; the countdown appears as its own first tab. Normal visibility rules apply.'
              : 'Only the countdown is shown until it ends — the rest of the page is hidden from everyone. Visibility takes effect once it\'s over.'}
            {' '}Tip: to <b>swap in new content the moment the countdown ends</b>, use “Schedule an update” with the same date/time — a countdown can trigger an update, and an update can carry a countdown.
          </p>
        </div>
      )}
    </div>
  );
}

// Stage a future content swap: pick a date/time, edit the "next" JSON (+ name/
// short for showcase pages), and it swaps in automatically once due — no admin
// action needed at reveal time. `putSchedule` is the save callback (varies by
// fixed-vs-showcase endpoint); `current` seeds the editor with today's live values.
// A recent server alert — click to expand its full detail (kind, what it means,
// the complete message, and the exact + relative time). The stored alert is just
// { kind, message, createdAt }, so "detail" = the human-readable expansion of that.
// i18n keys per alert kind — resolved in AlertRow (a module const can't call the hook).
const ALERT_KIND = {
  cpu: { l: 'sp.al.cpu', lf: 'High CPU', d: 'sp.al.cpu.d', df: 'CPU usage crossed the alert threshold (>90%).', tone: 'text-warning' },
  mem: { l: 'sp.al.mem', lf: 'High memory', d: 'sp.al.mem.d', df: 'Memory usage crossed the alert threshold (>90%).', tone: 'text-warning' },
  disk: { l: 'sp.al.disk', lf: 'Low disk', d: 'sp.al.disk.d', df: 'Disk usage crossed the alert threshold (>90%).', tone: 'text-error' },
  service_down: { l: 'sp.al.svc', lf: 'Service unreachable', d: 'sp.al.svc.d', df: 'A dependency (DB, storage, bot, Stripe…) failed its health check.', tone: 'text-error' },
};
function AlertRow({ a }) {
  const { t } = useI18n(); const toast = useToast();
  const [open, setOpen] = useState(false);
  const k = ALERT_KIND[a.kind];
  const info = k ? { label: t(k.l, k.lf), desc: t(k.d, k.df), tone: k.tone } : { label: a.kind, desc: t('sp.al.generic', 'Threshold alert.'), tone: 'text-error' };
  const when = new Date(a.createdAt);
  const ago = (() => { const s = Math.max(0, (Date.now() - when.getTime()) / 1000); if (s < 60) return t('sp.ago.now', 'just now'); if (s < 3600) return t('sp.ago.m', '{n}m ago').replace('{n}', Math.floor(s / 60)); if (s < 86400) return t('sp.ago.h', '{n}h ago').replace('{n}', Math.floor(s / 3600)); return t('sp.ago.d', '{n}d ago').replace('{n}', Math.floor(s / 86400)); })();
  const copy = (e) => { e.stopPropagation(); navigator.clipboard?.writeText(`[${a.kind}] ${a.message} — ${when.toLocaleString()}`); toast.success(t('common.copied', 'Copied.')); };
  return (
    <Card className="p-0 overflow-hidden">
      <button onClick={() => setOpen((v) => !v)} className="w-full p-3 flex items-center gap-3 text-left hover:bg-[var(--surface-2)] transition">
        <AlertTriangle size={15} className={`${info.tone} shrink-0`} />
        <Badge tone={info.tone.includes('red') ? 'red' : 'amber'} className="shrink-0">{info.label}</Badge>
        <span className="flex-1 min-w-0 text-[var(--muted)] truncate">{a.message}</span>
        {a.count > 1 && <Badge className="shrink-0 tabular-nums">×{a.count}</Badge>}
        <button onClick={copy} className="text-[var(--faint)] hover:text-[var(--primary-2)] shrink-0" title={t('common.copy', 'Copy')}><Copy size={13} /></button>
        <span className="text-[11px] text-[var(--faint)] shrink-0 tabular-nums">{ago}</span>
        <ChevronDown size={14} className={`text-[var(--faint)] shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="px-3 pb-3 pt-1 border-t border-[var(--line)] text-sm space-y-1.5">
          <div className="text-[var(--muted)]">{info.desc}</div>
          <div className="rounded-lg bg-[var(--surface-2)] border border-[var(--line)] p-2.5 font-mono text-xs text-[var(--text)] whitespace-pre-wrap break-words">{a.message}</div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--faint)]">
            <span>{t('sp.al.kindlbl', 'Kind:')} <code className="text-[var(--muted)]">{a.kind}</code></span>
            {a.count > 1
              ? <><span>{t('sp.al.occ', 'Occurrences:')} <b className="text-[var(--muted)]">{a.count}</b></span><span>{t('sp.al.lastlbl', 'Last:')} {when.toLocaleString()}</span>{a.firstAt && <span>{t('sp.al.firstlbl', 'First:')} {new Date(a.firstAt).toLocaleString()}</span>}</>
              : <span>{t('sp.al.whenlbl', 'When:')} {when.toLocaleString()}</span>}
            <span>{ago}</span>
          </div>
        </div>
      )}
    </Card>
  );
}

function ScheduleUpdateModal({ title, current, includeNameShort, existing, onClose, onSave, slug, isShowcase }) {
  const toast = useToast(); const { t } = useI18n();
  const [at, setAt] = useState(existing?.scheduledAt ? new Date(existing.scheduledAt).toISOString().slice(0, 16) : '');
  const [name, setName] = useState(existing?.scheduledNext?.name ?? current.name ?? '');
  const [short, setShort] = useState(existing?.scheduledNext?.short ?? current.short ?? '');
  const [configText, setConfigText] = useState(JSON.stringify(existing?.scheduledNext?.config ?? current.config ?? {}, null, 2));
  const [editMode, setEditMode] = useState('form'); // 'form' (visual) | 'json'
  const [busy, setBusy] = useState(false);
  const hasExisting = !!existing?.scheduledAt;
  let cfgValid = true; try { JSON.parse(configText || '{}'); } catch { cfgValid = false; }
  const undoSave = useUndoableSave();
  const save = () => {
    if (!at) return toast.error(t('su.pickdate', 'Pick a date/time.'));
    let config; try { config = JSON.parse(configText || '{}'); } catch { return toast.error(t('su.cfginvalid', 'Config JSON is invalid.')); }
    const next = includeNameShort ? { name: name.trim(), short: short.trim(), config } : { config };
    // `at`/`next` are snapshotted by the closure and the modal closes now, so nothing here
    // depends on component state surviving the undo window. onSave is the parent's mutation.
    const when = new Date(at).toISOString();
    setBusy(true);
    onClose();
    undoSave(() => onSave(when, next), t('su.scheduled', 'Update scheduled.'),
      { onSettled: () => setBusy(false) });
  };
  const cancelSchedule = async () => {
    setBusy(true);
    try { await onSave(null, null); toast.success(t('su.cancelled', 'Schedule cancelled.')); onClose(); }
    catch { toast.error(t('common.failed', 'Failed.')); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={title} icon={Clock} width="max-w-lg"
      footer={<>
        {hasExisting && <Button variant="ghost" className="!text-error" disabled={busy} onClick={cancelSchedule}>{t('su.cancelsched', 'Cancel schedule')}</Button>}
        <Button variant="ghost" onClick={onClose}>{t('su.close', 'Close')}</Button>
        <Button variant="primary" disabled={busy} onClick={save}>{busy ? <Spinner /> : t('su.schedule', 'Schedule')}</Button>
      </>}>
      <p className="text-sm text-[var(--muted)] mb-3">{t('su.desc', 'Stage new content below — it automatically replaces the current version at the date/time you pick. Nothing changes until then.')}</p>
      <Field label={t('su.switchat', 'Switch at')}><Input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} /></Field>
      {includeNameShort && (
        <div className="grid grid-cols-[1fr_110px] gap-3 mt-3">
          <Field label={t('su.newname', 'New name')}><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label={t('su.newshort', 'New short (≤5)')}><Input value={short} maxLength={5} onChange={(e) => setShort(e.target.value)} /></Field>
        </div>
      )}
      <div className="mt-3">
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] block">{t('su.newconfig', 'New config')}</label>
          <div className="inline-flex rounded-lg border border-[var(--line)] p-0.5 text-xs">
            {[['form', t('su.visual', 'Visual')], ['json', 'JSON']].map(([m, label]) => (
              <button key={m} type="button" onClick={() => setEditMode(m)} disabled={m === 'form' && !cfgValid}
                className={`px-2.5 py-1 rounded-md ${editMode === m ? 'bg-[var(--surface-2)] text-[var(--text)]' : 'text-[var(--muted)]'} ${m === 'form' && !cfgValid ? 'opacity-40 cursor-not-allowed' : ''}`}>{label}</button>
            ))}
          </div>
        </div>
        {editMode === 'form'
          ? (cfgValid
              ? <div className="rounded-xl border border-[var(--line)] p-3 max-h-[46vh] overflow-auto bg-[var(--bg-solid)]">
                  <ProjectConfigEditor value={JSON.parse(configText || '{}')} onChange={(cfg) => setConfigText(JSON.stringify(cfg, null, 2))} slug={slug} isShowcase={isShowcase} />
                </div>
              : <div className="text-sm text-[var(--muted)] p-3">{t('su.invalidjsontab', 'Invalid JSON — switch to the JSON tab to fix it.')}</div>)
          : <JsonEditor value={configText} onChange={setConfigText} minH={220} />}
      </div>
    </Modal>
  );
}

// ── Admin: "Other projects" showcase (CRUD) ──
const SHOWCASE_TEMPLATE = {
  tagline: '',
  downloads: [{ label: 'Download', url: '', primary: true }],
  links: { github: '', source: '', discord: '', kofi: '', website: '', customLabel: '', customUrl: '' },
  overview: { image: '', video: '', replayUrl: '', rrwebUrl: '' },
  progressSource: '',
  releaseNotes: { owner: '', repo: '', branch: 'main', path: '' },
  community: { url: '', messages: [], contributors: [] },
  legal: [{ icon: 'shield', title: 'License', text: '', url: '' }],
};

function AdminShowcase() {
  const toast = useToast(); const dialog = useDialog(); const { t } = useI18n();
  const { data, loading, reload } = useAsync(() => api.get('/admin/showcase'), []);
  const [editing, setEditing] = useState(null); // project object or 'new'
  const [scheduling, setScheduling] = useState(null); // project object
  const projects = data?.projects || [];
  // Managers (admin / manage_showcase) get the full surface; a per-project grantee edits
  // content only — no create/delete/schedule, and the reserved controls in the edit modal
  // are hidden. The server enforces the same split.
  const canManage = !!data?.canManage;
  const del = async (pr) => { if (!(await dialog.confirm({ title: t('sh.del.t', 'Delete project'), message: t('sh.del.m', 'Delete "{name}"?').replace('{name}', pr.name), okLabel: t('sh.del.ok', 'Delete'), danger: true }))) return; try { await api.del(`/admin/showcase/${pr.id}`); toast.success(t('common.deleted', 'Deleted.')); reload(); } catch { toast.error(t('common.failed', 'Failed.')); } };
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-semibold flex items-center gap-2"><Sparkles size={16} className="text-[var(--primary-2)]" /> {t('sh.title', 'Other projects')}</h2>
        {canManage && <Button size="sm" variant="primary" onClick={() => setEditing('new')}><Plus size={14} /> {t('sh.new', 'New project')}</Button>}
      </div>
      <p className="text-sm text-[var(--muted)] mb-4">{canManage ? t('sh.sub', 'Feature any project on the public /projects page. Overview is always shown; enable Release notes, Community and Legal per project.') : t('sh.sub.grantee', 'You can edit the content of the projects you were granted. Pinning, visibility and publishing are managed by an admin.')}</p>
      {loading ? <Loading /> : projects.length ? <div className="space-y-2">
        {projects.map((pr) => {
          const announcing = pr.announceEnabled && pr.announceRevealAt && new Date(pr.announceRevealAt) > new Date();
          return (
          /* Badges and four buttons used to be flex siblings of the content, which on a phone
             squeezed the name down to an ellipsis ("S…") while they kept their width. Badges
             now live with the name (and wrap); the actions get their own measured row. */
          <Card key={pr.id} className="p-4">
            <div className="flex items-start gap-3">
              {pr.icon
                ? <div className="grid place-items-center w-10 h-10 rounded-lg bg-[var(--surface-2)] border border-[var(--line)] shrink-0 text-[var(--primary-2)]"><ShowcaseIcon icon={pr.icon} size={24} rounded={6} /></div>
                : <div className="grid place-items-center w-10 h-10 rounded-lg bg-gradient-to-br from-brand to-brand-2 text-white font-extrabold text-xs shrink-0">{pr.short}</div>}
              <div className="flex-1 min-w-0">
                <div className="font-medium flex items-center gap-2 flex-wrap min-w-0">
                  <span className="truncate min-w-0">{pr.name}</span>
                  <span className="text-xs text-[var(--faint)] font-normal truncate min-w-0">/project/{pr.slug}</span>
                  <Badge tone={pr.published ? 'green' : ''}>{pr.published ? t('sh.published', 'published') : t('sh.hidden', 'hidden')}</Badge>
                  {announcing && <Badge tone="primary"><Megaphone size={10} /> {t('sh.countdown', 'counting down')}</Badge>}
                  {pr.scheduledAt && <Badge tone="primary"><Clock size={10} /> {t('sh.update', 'update')} {new Date(pr.scheduledAt).toLocaleDateString()}</Badge>}
                </div>
                <div className="text-xs text-[var(--faint)] flex items-center gap-1.5 flex-wrap mt-0.5">
                  {[pr.config?.tabs?.releases && 'releases', pr.config?.tabs?.community && 'community', pr.config?.tabs?.legal && 'legal'].filter(Boolean).join(' · ') || t('sh.overviewonly', 'overview only')}
                  {pr.pinTopbar && <span className="inline-flex items-center gap-0.5 text-[var(--primary-2)]"><Rss size={10} /> topbar</span>}
                  {pr.visibility && pr.visibility !== 'public' && <span className="inline-flex items-center gap-0.5"><EyeOff size={10} /> {pr.visibility}</span>}
                </div>
              </div>
            </div>
            <div className="mt-3">
              <ActionBar actions={[
                canManage && { key: 'sched', label: t('sh.schedtip', 'Schedule an update'), icon: Clock, onClick: () => setScheduling(pr) },
                { key: 'edit', label: t('sh.editbtn', 'Edit'), icon: PenSquare, onClick: () => setEditing(pr) },
                { key: 'open', label: t('sh.openpage', 'Open page'), icon: ArrowUpRight, href: `/project/${pr.slug}`, target: '_blank' },
                canManage && { key: 'del', label: t('common.delete', 'Delete'), icon: Trash2, danger: true, onClick: () => del(pr) },
              ].filter(Boolean)} />
            </div>
          </Card>
          );
        })}
      </div> : <EmptyState icon={Sparkles} title={t('sh.empty', 'No projects yet')} sub={t('sh.emptysub', 'Add your first featured project.')} />}
      {editing && <ShowcaseEditModal project={editing === 'new' ? null : editing} canManage={canManage} onClose={() => setEditing(null)} onDone={reload} />}
      {scheduling && (
        <ScheduleUpdateModal title={t('sh.schedmodal', 'Schedule an update — {name}').replace('{name}', scheduling.name)} includeNameShort existing={scheduling}
          slug={scheduling.slug} isShowcase
          current={{ name: scheduling.name, short: scheduling.short, config: scheduling.config }}
          onClose={() => setScheduling(null)}
          onSave={async (at, next) => { await api.put(`/admin/showcase/${scheduling.id}/schedule`, { at, next }); reload(); }} />
      )}
    </div>
  );
}

function ShowcaseEditModal({ project, canManage = true, onClose, onDone }) {
  const toast = useToast(); const { t } = useI18n();
  const isNew = !project;
  const cfg0 = project?.config || {};
  const [name, setName] = useState(project?.name || '');
  const [short, setShort] = useState(project?.short || '');
  const [icon, setIcon] = useState(project?.icon || '');
  const [published, setPublished] = useState(project?.published ?? true);
  const [tabs, setTabs] = useState({ releases: !!cfg0.tabs?.releases, community: !!cfg0.tabs?.community, legal: !!cfg0.tabs?.legal });
  const [tagline, setTagline] = useState(cfg0.tagline || '');
  const { tabs: _t, tagline: _tl, ...rest } = cfg0;
  const [details, setDetails] = useState(JSON.stringify(Object.keys(rest).length ? rest : SHOWCASE_TEMPLATE, null, 2));
  const [pinTopbar, setPinTopbar] = useState(project?.pinTopbar ?? false);
  const [visibility, setVisibility] = useState(project?.visibility ?? 'public');
  const [whitelist, setWhitelist] = useState(project?.visibilityWhitelist ?? []);
  const [announce, setAnnounce] = useState({
    announceEnabled: project?.announceEnabled ?? false,
    announceTitle: project?.announceTitle ?? '',
    announceLogo: project?.announceLogo ?? '',
    announceMarkdown: project?.announceMarkdown ?? '',
    announceRevealAt: project?.announceRevealAt ? new Date(project.announceRevealAt).toISOString().slice(0, 16) : '',
    announceShowPage: project?.announceShowPage ?? false,
    announceButtonLabel: project?.announceButtonLabel ?? '',
    announceButtonUrl: project?.announceButtonUrl ?? '',
  });
  const [iconPick, setIconPick] = useState(false);
  const [busy, setBusy] = useState(false);
  const undoSave = useUndoableSave();
  const save = () => {
    if (name.trim().length < 2) return toast.error(t('sh.e.namereq', 'Name is required.'));
    if (!short.trim()) return toast.error(t('sh.e.shortreq', 'Short name is required.'));
    let extra = {}; try { extra = JSON.parse(details || '{}'); } catch { return toast.error(t('sh.e.jsoninvalid', 'Details JSON is invalid.')); }
    if (announce.announceEnabled && !announce.announceRevealAt) return toast.error(t('sh.e.revealreq', 'Set a reveal date/time for the announcement.'));
    const config = { ...extra, tabs, tagline };
    const payload = {
      name: name.trim(), short: short.trim(), icon: icon.trim() || null, published, config, pinTopbar, visibility, visibilityWhitelist: whitelist,
      ...announce, announceRevealAt: announce.announceEnabled && announce.announceRevealAt ? new Date(announce.announceRevealAt).toISOString() : null,
    };
    // payload and the target id are fixed here; the modal closes immediately. onDone() is the
    // parent's refresh and belongs with the commit, not with the click.
    const id = project?.id;
    setBusy(true);
    onClose();
    undoSave(async () => {
      if (isNew) await api.post('/admin/showcase', payload);
      else await api.put(`/admin/showcase/${id}`, payload);
      onDone();
    }, t('common.saved', 'Saved.'),
       { onSettled: () => setBusy(false),
         errorFor: (x) => x.data?.error || t('common.savefail', 'Save failed.') });
  };
  const Toggle = ({ k, label }) => <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={tabs[k]} onChange={(e) => setTabs({ ...tabs, [k]: e.target.checked })} /> {label}</label>;
  return (
    <Modal open onClose={onClose} title={isNew ? t('sh.new', 'New project') : t('sh.e.edit', 'Edit {name}').replace('{name}', project.name)} icon={Sparkles} width="max-w-lg"
      footer={<><Button variant="ghost" onClick={onClose}>{t('su.cancel', 'Cancel')}</Button><Button variant="primary" disabled={busy} onClick={save}>{busy ? <Spinner /> : t('common.save', 'Save')}</Button></>}>
      <div className="grid grid-cols-[1fr_110px] gap-3">
        <Field label={t('sh.e.pname', 'Project name')}><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Better Something" /></Field>
        <Field label={t('sh.e.pshort', 'Short (≤5)')}><Input value={short} maxLength={5} onChange={(e) => setShort(e.target.value)} placeholder="BS" /></Field>
      </div>
      <div className="mt-3"><Field label={t('sh.e.tagline', 'Tagline')}><Input value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder={t('sh.e.taglineph', 'One-line description')} /></Field></div>
      <div className="mt-3"><Field label={t('sh.e.logo', 'Logo / icon')} hint={t('sh.e.logohint', 'Topbar pill + page header + blog-thumbnail fallback. Pick a lucide/brand icon, upload an svg/png, or paste a logo URL.')}>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="w-10 h-10 rounded-lg border border-[var(--line)] shrink-0 grid place-items-center bg-[var(--surface-2)] text-[var(--primary-2)]">
            <ShowcaseIcon icon={icon} size={26} rounded={6} fallback={<Sparkles size={18} className="text-[var(--faint)]" />} />
          </div>
          <Input className="flex-1 min-w-[140px]" value={icon} onChange={(e) => setIcon(e.target.value)} placeholder="lucide name, simple:github, or https://…/logo.png" />
          <Button type="button" size="sm" onClick={() => setIconPick(true)}>{t('sh.e.pick', 'Pick')}</Button>
          <Button type="button" size="sm" onClick={() => { const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*,.svg'; i.onchange = async () => { const f = i.files?.[0]; if (!f) return; try { toast.info(t('sh.e.uploading', 'Uploading…')); setIcon(await uploadImage(f)); } catch { toast.error(t('sh.e.uploadfail', 'Upload failed.')); } }; i.click(); }}>{t('sh.e.upload', 'Upload')}</Button>
          {icon && <Button type="button" size="sm" variant="ghost" onClick={() => setIcon('')}>{t('sh.e.clear', 'Clear')}</Button>}
        </div>
      </Field></div>
      {iconPick && <IconPicker title={t('sh.e.pickicon', 'Pick a project icon')} onPick={(n) => setIcon(n)} onClose={() => setIconPick(false)} />}
      <div className="mt-3">
        <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-1.5">{t('sh.e.subtabs', 'Sub-tabs')}</div>
        <div className="flex flex-wrap gap-x-5 gap-y-2 p-3 rounded-lg bg-[var(--surface-2)] border border-[var(--line)]">
          <label className="flex items-center gap-2 text-sm text-[var(--muted)]"><input type="checkbox" checked disabled /> {t('sh.e.overview', 'Overview (always)')}</label>
          <Toggle k="releases" label={t('sh.e.releases', 'Release notes')} />
          <Toggle k="community" label={t('sh.e.community', 'Community')} />
          <Toggle k="legal" label={t('sh.e.legal', 'Legal')} />
        </div>
      </div>
      <div className="mt-3">
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)]">{t('sh.e.details', 'Details (JSON)')}</label>
          <button type="button" onClick={() => setDetails(JSON.stringify(SHOWCASE_TEMPLATE, null, 2))} className="btn btn-sm"><Wand2 size={13} /> {t('sh.e.template', 'Template')}</button>
        </div>
        <p className="text-[11px] text-[var(--faint)] mb-1.5">{t('sh.e.detailshint', 'links (github/source/discord/kofi/website/custom), downloads[], overview media (image/video/replayUrl/rrwebUrl), progressSource, releaseNotes, community, legal cards.')}</p>
        <JsonEditor value={details} onChange={setDetails} minH={220} />
      </div>
      {canManage ? (<>
        <label className="flex items-center gap-2 text-sm mt-3 cursor-pointer"><input type="checkbox" checked={published} onChange={(e) => setPublished(e.target.checked)} /> {t('sh.e.published', 'Published (visible on /projects)')}</label>
        <label className="flex items-center gap-2 text-sm mt-2 cursor-pointer"><input type="checkbox" checked={pinTopbar} onChange={(e) => setPinTopbar(e.target.checked)} /> <Rss size={13} className="text-[var(--primary-2)]" /> {t('sh.e.pin', 'Pin as its own topbar pill (not just the /projects grid)')}</label>
        <div className="mt-3">
          <VisibilitySection visibility={visibility} whitelist={whitelist} onVisibility={setVisibility}
            onAddWhitelist={(e) => setWhitelist((w) => [...w, e])} onRemoveWhitelist={(e) => setWhitelist((w) => w.filter((a) => !(a.type === e.type && a.id === e.id)))} />
        </div>
        <div className="mt-3"><AnnouncementSection value={announce} onChange={setAnnounce} /></div>
      </>) : (
        <p className="text-xs text-[var(--faint)] mt-3 flex items-center gap-1.5"><Lock size={12} /> {t('sh.e.reservednote', 'Publishing, topbar pin, visibility and the announcement are managed by an admin.')}</p>
      )}
    </Modal>
  );
}

// Hosting settings, grouped by what they actually govern (capacity ceilings vs.
// pricing knobs vs. feature flags) instead of one flat undifferentiated grid —
// each field gets a real description of its effect, not just a bare label.
const SETTINGS_GROUPS = [
  { title: 'Capacity', gk: 'capacity', icon: HardDrive, keys: [
    ['hosting.totalCapacityGB', 'Total capacity (GB)', 'The overall ceiling for everything hosting draws against — checked against the real disk on save.', 'number'],
    ['hosting.reservedFreeGB', 'Reserved free margin (GB)', 'Always kept free below Total capacity, as a safety buffer.', 'number'],
    ['hosting.tempMarginGB', 'Temp margin for submissions (GB)', 'Separate pool for catalog submissions awaiting moderation — full = new uploads refused until reviewed.', 'number'],
    ['hosting.rejectedRetentionDays', 'Rejected-payload grace (days)', 'How long a rejected submission keeps its uploaded file before the sweeper purges it to reclaim temp space. The author can still fix & resubmit within this window. Default 7.', 'number'],
    ['hosting.freeTierCapEnabled', 'Cap the free hosting-plan pool', 'When on, the Free hosting plan goes "sold out" once free repos together reach the cap below — paid plans never count against this.', 'bool'],
    ['hosting.freeTierCapGB', 'Free hosting-plan pool cap (GB)', 'Total storage the Free plan can ever occupy across every user, once the toggle above is on.', 'number'],
    ['catalog.freeTierCapEnabled', 'Cap the free catalog-upload pool', 'When on, free catalog file hosting goes "sold out" once free uploads together reach the cap below — paid uploads never count against this.', 'bool'],
    ['catalog.freeTierCapMB', 'Free catalog-upload pool cap (MB)', 'Total payload bytes the free catalog tier can ever occupy across every user, once the toggle above is on.', 'number'],
    ['telemetry.storageLimitGB', 'BMM telemetry storage limit (GB)', 'How much storage the (separate) BMM telemetry database is allowed — shown as used vs. allocated in Total capacity above. 0 = untracked.', 'number'],
    ['hosting.maxUploadMbps', 'Max upload per repo (Mbps)', 'Hard ceiling on the upload bandwidth a single repo can request (custom plans + upgrades). Scarcity may lower it further as capacity fills. Default 1000.', 'number'],
    ['hosting.burstFactor', 'Bandwidth burst factor', 'Smart sharing: while the server is quiet, a repo download may burst to its cap × this factor, borrowing idle capacity. Tightens back to the cap under load. 1 = no bursting. Default 4.', 'number'],
    ['hosting.burstUntilActive', 'Burst until N active transfers', 'Bursting is allowed only while fewer than this many downloads are in flight at once; beyond it, each repo is held to its own cap. Default 3.', 'number'],
  ] },
  { title: 'Blog, docs & history', gk: 'blog', icon: Newspaper, keys: [
    ['blog.maxTotalPosts', 'Max total blog articles', 'Hard cap on the number of blog articles across the whole site. 0 = unlimited. New articles are refused once reached.', 'number'],
    ['blog.maxTotalKB', 'Max total blog size (KB)', 'Hard cap on the combined size of every article body (EN + FR). Enforced on create AND on edits that grow a post. 0 = unlimited.', 'number'],
    ['docs.maxTotalPages', 'Max total doc pages', 'Hard cap on the number of documentation pages. 0 = unlimited. New pages are refused once reached.', 'number'],
    ['docs.maxTotalKB', 'Max total docs size (KB)', 'Hard cap on the combined size of every doc page (EN + FR). Enforced on create AND on edits that grow a page. 0 = unlimited.', 'number'],
    ['history.maxRevisions', 'Edit-history: keep last N revisions', 'How many past snapshots each blog post / doc page keeps before the oldest is overwritten. Default 30.', 'number'],
    ['history.maxRevisionKB', 'Edit-history: max size per item (KB)', 'Also cap each item\'s stored history by size — older snapshots drop once this is exceeded. 0 = size limit off (count only).', 'number'],
  ] },
  { title: 'Security & audit logs', gk: 'security', icon: ShieldCheck, keys: [
    ['audit.maxDays', 'Audit log retention (days)', 'Staff-action log entries older than this are pruned. 0 = keep forever. The log is HMAC-chained (tamper-evident) — pruning is the only sanctioned deletion.', 'number'],
    ['audit.maxEntries', 'Audit log max entries', 'Also cap the staff-action log by entry count — the oldest are pruned past this. 0 = no count cap.', 'number'],
  ] },
  { title: 'Pricing', gk: 'pricing', icon: Receipt, keys: [
    ['pricing.perGBCents', 'Price per GB (¢ / month)', 'Base hosting cost, before the scarcity multiplier. Only applies above the free floor below.', 'number'],
    ['pricing.hostingFreeGB', 'Free hosting floor', 'Every repo\'s first N of storage cost nothing — small personal repos are free. Only the excess is billed.', 'gbmb', 'GB'],
    ['pricing.perUploadMbpsCents', 'Price per Mbps (¢ / month)', 'Cost per Mbps of upload bandwidth allotted to a repo.', 'number'],
    ['pricing.featurePerDayCents', 'Feature (boost) price / day (¢)', 'Cost to keep a repo featured on the public listing.', 'number'],
    ['pricing.catalogHostPerMBCents', 'Catalog file hosting (¢ / MB / month)', 'Charged to non-staff submitters for our-hosted payloads above the free floor below.', 'number'],
    ['pricing.catalogFreeMB', 'Free catalog upload floor', 'Every submission\'s (app/plugin/theme/preset) first N are free — only the excess is billed.', 'gbmb', 'MB'],
    ['pricing.consolidationDiscount', 'Pool consolidation discount (fraction)', 'When an owner consolidates a merged pool\'s several subscriptions into one bigger plan, this fraction (0–0.9, e.g. 0.15 = 15% off) is taken off the single-plan price. Shown as the "consolidation savings" quote on their pools.', 'number'],
  ] },
  { title: 'Feature flags', gk: 'features', icon: Sliders, keys: [
    ['features.hostingEnabled', 'Hosting enabled', 'Turns the whole Server-Repo hosting feature off site-wide when unchecked.', 'bool'],
  ] },
];

// One-line description shown under each settings-group header panel.
const GROUP_DESC = {
  'Capacity': 'Storage ceilings, free-tier pools, telemetry & per-repo CPU/upload limits.',
  'Blog, docs & history': 'Article/page count & size caps, and edit-history retention.',
  'Security & audit logs': 'How long the tamper-evident staff action log is kept.',
  'Pricing': 'What customers pay — per GB, Mbps, CPU, boost & catalog hosting.',
  'Feature flags': 'Master on/off switches.',
};

// GB<->MB conversion for the free-floor unit toggle — the stored setting value
// always stays in its native unit (GB for hostingFreeGB, MB for catalogFreeMB);
// only the on-screen number changes when the admin picks a different unit.
const convertUnit = (value, fromUnit, toUnit) => fromUnit === toUnit ? Number(value) : (fromUnit === 'GB' ? Number(value) * 1024 : Number(value) / 1024);

// Live BMM telemetry config — proxies the telemetry service's own admin API, so
// changes here are APPLIED to the running telemetry service (config.json, no .env
// edit / restart), unlike the display-only telemetry.storageLimitGB setting.
function TelemetryConfigCard() {
  const { t } = useI18n(); const toast = useToast();
  const { data, loading, reload } = useAsync(() => api.get('/admin/telemetry/config').catch((x) => ({ available: false, error: x?.data?.error || 'telemetry_unreachable' })), []);
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data?.config) setF({ storageGB: String(Math.round((data.config.storageLimitMb / 1024) * 100) / 100), retentionDays: String(data.config.retentionDays), deleteDelayH: String(data.config.deleteDelayH) }); }, [data]);
  if (loading) return null;
  if (data && data.available === false) {
    const notcfg = data.error === 'telemetry_not_configured';
    return (
      <Card className="p-4 mb-3">
        <div className="text-sm font-medium flex items-center gap-2 mb-1"><Gauge size={15} className="text-info" /> {t('tc.title', 'BMM telemetry (live)')}</div>
        <div className="text-xs text-warning">{notcfg ? t('tc.notcfg', 'Set TELEMETRY_INTERNAL_URL + TELEMETRY_ADMIN_KEY in the api service env to manage telemetry limits from here.') : t('tc.unreach', 'Telemetry service unreachable right now.')}</div>
      </Card>
    );
  }
  if (!f) return null;
  const usedGB = (data.used_bytes || 0) / (1024 ** 3);
  const limitGB = Number(f.storageGB) || 0;
  const pct = limitGB > 0 ? Math.min(100, (usedGB / limitGB) * 100) : 0;
  const undoSave = useUndoableSave(reload);
  const save = () => {
    setBusy(true);
    undoSave(() => api.put('/admin/telemetry/config', { storageLimitMb: Math.round(Number(f.storageGB) * 1024), retentionDays: Number(f.retentionDays), deleteDelayH: Number(f.deleteDelayH) }),
      t('tc.saved', 'Applied to the telemetry service.'),
      { onSettled: () => setBusy(false), errorFor: () => t('tc.savefail', 'Could not update telemetry.') });
  };
  return (
    <Card className="p-4 mb-3">
      <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
        <div className="text-sm font-medium flex items-center gap-2"><Gauge size={15} className="text-info" /> {t('tc.title', 'BMM telemetry (live)')}</div>
        <Button size="sm" variant="primary" disabled={busy} onClick={save}>{busy ? <Spinner /> : <><CheckCheck size={14} /> {t('tc.apply', 'Apply to telemetry')}</>}</Button>
      </div>
      <p className="text-[11px] text-[var(--faint)] mb-3">{t('tc.sub', 'Edits the telemetry service directly (storage cap, GDPR retention, erase delay) — applied live, no restart. Over-limit data is trimmed immediately on save.')}</p>
      <div className="mb-3">
        <div className="flex items-center justify-between text-xs mb-1"><span className="text-[var(--muted)]">{t('tc.used', 'Used')}</span><span className="tabular-nums font-medium">{usedGB.toFixed(2)}{limitGB > 0 ? ` / ${limitGB} GB` : ` ${t('hs.gbused', 'GB used')}`}</span></div>
        {limitGB > 0 && <div className="h-2 rounded-full bg-[var(--surface-2)] overflow-hidden"><div className={`h-full ${pct > 90 ? 'bg-error' : 'bg-info'}`} style={{ width: `${pct}%` }} /></div>}
      </div>
      <div className="grid sm:grid-cols-3 gap-3">
        <Field label={t('tc.storage', 'Storage cap (GB)')} hint={t('tc.storage.h', 'Oldest events trimmed when exceeded.')}><Input type="number" min="0.125" step="0.5" value={f.storageGB} onChange={(e) => setF({ ...f, storageGB: e.target.value })} /></Field>
        <Field label={t('tc.retention', 'Retention (days)')} hint={t('tc.retention.h', 'Raw events auto-deleted after this.')}><Input type="number" min="1" max="3650" value={f.retentionDays} onChange={(e) => setF({ ...f, retentionDays: e.target.value })} /></Field>
        <Field label={t('tc.delay', 'Erase delay (h)')} hint={t('tc.delay.h', 'Review window before an erasure request auto-applies.')}><Input type="number" min="0" max="720" value={f.deleteDelayH} onChange={(e) => setF({ ...f, deleteDelayH: e.target.value })} /></Field>
      </div>
    </Card>
  );
}

// Icon names an admin may attach to a nav item — must mirror NAV_ICONS in App.jsx
// (an unknown name harmlessly falls back to the Boxes icon at render time).
const NAV_ICON_CHOICES = ['Boxes', 'Music2', 'Newspaper', 'Server', 'Rocket', 'Shield', 'Download', 'Sparkles', 'Mail', 'Home', 'BookOpen', 'LayoutGrid', 'Info', 'Bell', 'Code'];
// A ready-to-edit starting point mirroring the built-in topbar, so an admin isn't
// staring at a blank editor. Uses plain labels + icon names (both languages).
// Mirrors the site's real built-in NAV (App.jsx) so "Reset to default" restores exactly
// what visitors see out of the box — the clean default: an "Apps" dropdown grouping the
// three apps (with their logos), then Blog / Docs / Server repos / Hosting as flat links.
// Mirrors DEFAULT_ITEMS in App.jsx.
const DEFAULT_NAV_SEED = [
  { type: 'group', label: 'Apps', labelFr: 'Applications', to: '', icon: 'Boxes', children: [
    { label: 'BetterModsManager', labelFr: 'BetterModsManager', to: '/p/bmm', desc: '', descFr: '', icon: 'app:bmm' },
    { label: 'BetterSoundMaker', labelFr: 'BetterSoundMaker', to: '/p/bsm', desc: '', descFr: '', icon: 'app:bsm' },
    { label: 'BetterInstaller', labelFr: 'BetterInstaller', to: '/p/installer', desc: '', descFr: '', icon: 'app:bi' },
  ] },
  { type: 'link', label: 'Blog', labelFr: 'Blog', to: '/blog', icon: 'Newspaper', children: [] },
  { type: 'link', label: 'Docs', labelFr: 'Docs', to: '/docs', icon: 'BookOpen', children: [] },
  { type: 'link', label: 'Developers', labelFr: 'Développeurs', to: '/dev', icon: 'Code', children: [] },
  { type: 'link', label: 'Server repos', labelFr: 'Dépôts serveur', to: '/repos', icon: 'Server', children: [] },
  { type: 'link', label: 'Hosting', labelFr: 'Hébergement', to: '/hosting', icon: 'Rocket', children: [] },
];
const blankItem = (type) => ({ type, label: '', labelFr: '', to: type === 'link' ? '/' : '', icon: 'Boxes', children: [] });
const blankChild = () => ({ label: '', labelFr: '', to: '/', desc: '', descFr: '', icon: 'Boxes' });
// Built-in topbar utility buttons the admin can show/hide + reorder (mirrors App.jsx
// UTIL_A / UTIL_B). Split by responsive cluster so reordering stays within a cluster.
const UTIL_A_KEYS = ['notifications', 'projects', 'lang', 'theme', 'settings'];
const UTIL_B_KEYS = ['dashboard', 'admin', 'profile', 'logout', 'login'];
const UTIL_LABEL = { notifications: 'Notifications', projects: 'Projects', lang: 'Language', theme: 'Theme', settings: 'Settings', dashboard: 'Dashboard', admin: 'Admin', profile: 'Profile', logout: 'Log out', login: 'Sign in' };
const UTIL_ICON = { notifications: 'Bell', projects: 'Boxes', lang: 'Languages', theme: 'SunMoon', settings: 'Settings', dashboard: 'LayoutDashboard', admin: 'Shield', profile: 'User', logout: 'LogOut', login: 'LogIn' };
// Immutably move element `i` of `arr` by `dir` (±1); returns the same array if out of range.
const moveIn = (arr, i, dir) => { const j = i + dir; if (j < 0 || j >= arr.length) return arr; const c = arr.slice(); [c[i], c[j]] = [c[j], c[i]]; return c; };
// Immutably move element `from` to index `to` — for drag-and-drop, which lands anywhere, not
// just a neighbour. No-op if the indices are equal or out of range.
const moveTo = (arr, from, to) => { if (from === to || from < 0 || to < 0 || from >= arr.length || to >= arr.length) return arr; const c = arr.slice(); const [x] = c.splice(from, 1); c.splice(to, 0, x); return c; };

// Renders the preview icon the exact way the live topbar does (any Lucide icon or Simple
// Icons brand, via IconGlyph). PascalCase/old names are kebab-ized first.
const navPvName = (icon) => { const s = String(icon || 'boxes'); return (s.startsWith('simple:') || s.startsWith('app:')) ? s : s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/\s+/g, '-').toLowerCase(); };
const NavPvIcon = ({ name, size = 15 }) => <IconGlyph name={navPvName(name)} size={size} />;
const pvLabel = (it, lang) => (lang === 'fr' && it.labelFr ? it.labelFr : (it.label || '')) || (lang === 'fr' ? 'Sans titre' : 'Untitled');

// Faithful, non-interactive replica of the real ThemeToggle switch (ui/theme.jsx) so the
// preview shows the actual sliding switch — not a flat icon — and mirrors the current theme.
function PvTheme() {
  const { theme } = useTheme();
  const dark = theme === 'dark';
  return (
    <span className="relative inline-block h-6 w-11 rounded-full border align-middle shrink-0"
      style={{ background: dark ? 'var(--primary)' : 'color-mix(in srgb, var(--text) 12%, transparent)', borderColor: 'var(--line-strong)' }}>
      <span className="absolute top-1/2 grid place-items-center w-[18px] h-[18px] rounded-full"
        style={{ left: 2, marginTop: -9, transform: dark ? 'translateX(20px)' : 'translateX(0)', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }}>
        {dark ? <Moon size={11} className="text-[var(--primary)] fill-[var(--primary)]" /> : <Sun size={11} className="text-warning" />}
      </span>
    </span>
  );
}
// One utility button rendered exactly as the live topbar draws it (App.jsx): theme = the
// switch, lang = globe + language code, profile = avatar disc, everything else its lucide
// icon. Callers wrap it for spacing; this owns the per-key shape so desktop & mobile agree.
function PvUtil({ k, lang, size = 16 }) {
  if (k === 'theme') return <PvTheme />;
  if (k === 'profile') return <span className="inline-block align-middle w-6 h-6 rounded-full bg-[var(--surface-2)] border border-[var(--line)]" />;
  if (k === 'lang') return <span className="inline-flex items-center gap-1 text-[var(--muted)]"><Languages size={size} /><span className="text-xs font-semibold uppercase">{lang}</span></span>;
  const Icon = { notifications: Bell, projects: Boxes, settings: SettingsIcon, dashboard: LayoutDashboard, admin: Shield, logout: LogOut, login: LogIn }[k] || Boxes;
  return <Icon size={size} className="text-[var(--muted)]" />;
}
// Mobile hamburger-sheet row, matching the real sheet() style in App.jsx.
const pvSheet = 'flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm text-[var(--muted)]';

// Live preview of the public topbar built from the editor's items — faithful to the real
// component's styling (App.jsx). Desktop = the pill bar with a hover/click dropdown; mobile
// = the hamburger sheet (tap a group to expand, tap the phone to reveal the sheet).
function NavPreview({ items, lang, device, onEdit, utility = {}, projectsMode = 'inline', downbar = true, projects = [], layout: layoutProp }) {
  const layout = readLayout(layoutProp);
  const iconsOnly = layout.labels === 'icons';
  const { t } = useI18n();
  const { user } = useAuth();
  const [openIdx, setOpenIdx] = useState(null);
  const [projOpen, setProjOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [openGroups, setOpenGroups] = useState({}); // per-group accordion state in the mobile sheet
  // Pinned projects for the preview, and whether they collapse into one "Projects" dropdown.
  const pvProjects = (projects || []).map((p) => ({ slug: p.slug, name: (p.isAnnouncing && p.announceTitle) || p.name, icon: p.icon }));
  const projDropdown = projectsMode === 'dropdown' && pvProjects.length > 0;
  // Mobile bottom bar the preview shows under the phone: home + the leading valid links,
  // mirroring deriveDownbar() in App.jsx. Rendered only when the admin left it enabled.
  const validLeaves = items.filter((it) => it.type !== 'group' && it.label.trim() && it.to.trim().startsWith('/')).slice(0, 4);
  // The desktop preview must LOOK like a desktop: it renders at a real desktop width and is
  // scaled to whatever room it has. Letting it reflow into the admin column (or worse, a
  // phone) is what made it "buggy" — it wrapped into a stack of pills, i.e. a preview of a
  // layout the desktop topbar never actually produces.
  //
  // Fit-to-width alone isn't enough though: on a phone that's ~0.26, a 15px-tall sliver you
  // can't read. So fit is only the BASELINE — `zoom` multiplies it, and once the result is
  // wider than the container the wrapper pans horizontally. Zoom 1 always means "the whole
  // bar, exactly fitted", whatever the screen.
  const DESKTOP_W = 1120;
  const ZOOM_MIN = 1, ZOOM_MAX = 6;
  const fitRef = useRef(null);
  const barRef = useRef(null);
  const [fit, setFit] = useState({ base: 1, h: 0 });
  const [zoom, setZoom] = useState(1);
  const scale = fit.base * zoom;
  useEffect(() => {
    if (device === 'mobile') return undefined;
    const wrap = fitRef.current, bar = barRef.current;
    if (!wrap || !bar) return undefined;
    const compute = () => {
      const w = wrap.getBoundingClientRect().width;
      if (!w) return;
      const base = Math.min(1, w / DESKTOP_W);
      // Reserve the SCALED height: a transform doesn't change layout size, so without this
      // the wrapper keeps the full unscaled height and leaves a gap under the bar.
      setFit({ base, h: bar.offsetHeight * base });
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [device, items, utility]);
  // Height follows the zoom too, else zooming in would overlap whatever sits below.
  const boxH = fit.h ? fit.h * zoom : undefined;
  // Keep each valid item's ORIGINAL index so clicking it in the preview can jump to the
  // matching editor card (onEdit). Filter mirrors the server's accept rules.
  const valid = items.map((it, idx) => ({ it, idx })).filter(({ it }) => it.type === 'group' ? (it.label.trim() && it.children.some((c) => c.label.trim() && c.to.trim().startsWith('/'))) : (it.label.trim() && it.to.trim().startsWith('/')));
  const pillCls = (active) => `flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm whitespace-nowrap transition ${active ? 'bg-[var(--bg-solid)] text-[var(--primary)] shadow-sm font-medium' : 'text-[var(--muted)] hover:text-[var(--text)]'}`;
  // Which built-in utility buttons are shown, in configured order. The precondition comes
  // from the SAME shared rule the real topbar uses (lib/roles.js) — re-deriving it here is
  // what made the preview lie: it drew "Log out" and "Sign in" at once, and offered
  // Dashboard/Admin/Profile to a signed-out viewer.
  const uOn = (k) => utility[k]?.visible !== false && utilAllowed(k, user);
  const ordU = (list) => [...list].filter(uOn).sort((a, b) => (utility[a]?.order ?? list.indexOf(a)) - (utility[b]?.order ?? list.indexOf(b)));
  const clusterA = ordU(UTIL_A_KEYS), clusterB = ordU(UTIL_B_KEYS);

  if (device === 'mobile') {
    // Faithful to the real phone menu (App.jsx <Nav> sheet): logo + name + always-visible
    // cluster-A icons + avatar + hamburger, then a 2-column grid — groups are full-width
    // collapsible accordions (tap to expand, like NavSheetGroup) — followed by the
    // projects/contact/settings row, a divider, and the account grid (dashboard/admin/
    // profile/logout, or a single "Sign in" when signed out).
    const topExtras = [uOn('projects') && 'projects', 'contact', uOn('settings') && 'settings'].filter(Boolean);
    const account = UTIL_B_KEYS.filter(uOn);
    const toggleGroup = (i) => setOpenGroups((g) => ({ ...g, [i]: !g[i] }));
    // Use the SAME visible strings the real phone menu uses (App.jsx), not the util-editor
    // labels — so e.g. it reads "Sign out"/"Sign in", not "Log out".
    const mLabel = { projects: t('nav.projects', 'Projects'), settings: t('nav.settings', 'Settings'), dashboard: t('nav.dashboard'), admin: t('nav.admin'), profile: 'Profile', logout: t('nav.signout'), login: t('nav.signin') };
    const extraRow = (k) => k === 'contact'
      ? <div key="contact" className={pvSheet}><Mail size={16} /> Contact</div>
      : <div key={k} className={pvSheet}><PvUtil k={k} lang={lang} /> {mLabel[k]}</div>;
    return (
      <div className="mx-auto w-[320px] rounded-[2rem] border-4 border-[var(--line-strong)] bg-[var(--bg)] p-2.5 shadow-lg">
        <div className="rounded-2xl border border-[var(--line)] px-2 h-12 flex items-center gap-1 topbar bg-[var(--bg-solid)]">
          <img src="/logo.png" alt="" className="w-7 h-7 rounded-lg shrink-0" />
          <span className="font-bold text-[13px] flex-1 min-w-0 truncate">BetterCommunity</span>
          {/* On a real phone the Projects icon is hidden in the bar (hidden sm:inline-flex)
              and only lives in the menu — mirror that so the header doesn't crowd/overflow. */}
          {clusterA.filter((k) => k !== 'projects').map((k) => <span key={k} className="shrink-0 px-0.5" title={t('nav.util.' + k, UTIL_LABEL[k])}><PvUtil k={k} lang={lang} size={15} /></span>)}
          {uOn('profile') && <span className="shrink-0" title={t('nav.util.profile', 'Profile')}><PvUtil k="profile" lang={lang} /></span>}
          <button onClick={() => setSheetOpen((v) => !v)} className="p-1.5 rounded-lg border border-[var(--line)] text-[var(--muted)] shrink-0" title={t('nav.pv.tap', 'Tap to preview the menu')}>{sheetOpen ? <X size={15} /> : <Navigation size={15} />}</button>
        </div>
        {sheetOpen && <div className="mt-2 rounded-2xl border border-[var(--line)] p-2 topbar bg-[var(--bg-solid)]">
          <div className="grid grid-cols-2 gap-1">
            {valid.length === 0 && <div className="col-span-2 text-xs text-[var(--faint)] p-2">{t('nav.pv.empty', 'No valid items yet.')}</div>}
            {valid.map(({ it, idx }) => it.type === 'group' ? (
              <div key={idx} className="col-span-2">
                <button type="button" onClick={() => toggleGroup(idx)} className={pvSheet + ' w-full text-left'} aria-expanded={!!openGroups[idx]}>
                  <NavPvIcon name={it.icon} size={16} /><span className="flex-1">{pvLabel(it, lang)}</span><ChevronDown size={15} className={`transition-transform ${openGroups[idx] ? 'rotate-180' : ''}`} />
                </button>
                {openGroups[idx] && <div className="pl-3 ml-3 border-l border-[var(--line)] space-y-0.5">
                  {it.children.filter((c) => c.label.trim() && c.to.trim().startsWith('/')).map((c, j) => <div key={j} className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm text-[var(--muted)]"><NavPvIcon name={c.icon} size={16} /> {pvLabel(c, lang)}</div>)}
                </div>}
              </div>
            ) : <div key={idx} className={pvSheet}><NavPvIcon name={it.icon} size={16} /> {pvLabel(it, lang)}</div>)}
            {pvProjects.length > 0 && (projDropdown ? (
              <div className="col-span-2">
                <button type="button" onClick={() => setProjOpen((o) => !o)} className={pvSheet + ' w-full text-left'} aria-expanded={projOpen}><Sparkles size={16} /><span className="flex-1">{t('nav.projects', 'Projects')}</span><ChevronDown size={15} className={`transition-transform ${projOpen ? 'rotate-180' : ''}`} /></button>
                {projOpen && <div className="pl-3 ml-3 border-l border-[var(--line)] space-y-0.5">
                  {pvProjects.map((p) => <div key={p.slug} className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm text-[var(--muted)]"><ShowcaseIcon icon={p.icon} size={16} fallback={<Sparkles size={16} />} /> {p.name}</div>)}
                </div>}
              </div>
            ) : pvProjects.map((p) => <div key={p.slug} className={pvSheet}><ShowcaseIcon icon={p.icon} size={16} fallback={<Sparkles size={16} />} /> {p.name}</div>))}
            {topExtras.map(extraRow)}
          </div>
          {account.length > 0 && <>
            <div className="h-px bg-[var(--line)] my-2" />
            <div className="grid grid-cols-2 gap-1">
              {account.map((k) => k === 'login'
                ? <div key={k} className="col-span-2 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-sm font-semibold text-white bg-[var(--primary)]">{mLabel.login}</div>
                : <div key={k} className={pvSheet}><PvUtil k={k} lang={lang} /> {mLabel[k]}</div>)}
            </div>
          </>}
        </div>}
        {!sheetOpen && <div className="text-[11px] text-[var(--faint)] text-center mt-2 flex items-center justify-center gap-1"><MousePointerClick size={11} /> {t('nav.pv.tap', 'Tap the menu to preview')}</div>}
        {/* The real phone gets a bottom tab bar too — home + the leading links (derived), or
            nothing when the admin turned it off. This is the part the old preview never showed. */}
        {downbar
          ? <div className="mt-2 rounded-2xl border border-[var(--line)] bg-[var(--bg-solid)] flex items-stretch px-1 py-1">
              {[{ home: true }, ...validLeaves].map((n, i) => (
                <div key={i} className="flex-1 flex flex-col items-center justify-center py-1 text-[var(--muted)]">
                  <span className="grid place-items-center w-8 h-6"><NavPvIcon name={n.home ? 'home' : n.icon} size={16} /></span>
                  <span className="text-[9px] leading-none mt-0.5 truncate max-w-[52px]">{n.home ? t('nav.home', 'Home') : pvLabel(n, lang)}</span>
                </div>
              ))}
            </div>
          : <div className="mt-2 text-[10px] text-[var(--faint)] text-center italic">{t('nav.pv.nodownbar', 'Bottom bar off')}</div>}
      </div>
    );
  }
  // Clicking an item jumps to (and flashes) its editor card — "edit from the live
  // preview" on desktop. The chevron still toggles a group's dropdown independently.
  const jump = (idx) => onEdit && onEdit(idx);
  const zoomPct = Math.round(scale * 100);
  return (
    <>
    {/* Zoom controls. At zoom 1 the whole bar is fitted; above it, the row below pans. */}
    <div className="flex items-center justify-end gap-1.5 mb-1.5">
      <Button size="sm" variant="ghost" disabled={zoom <= ZOOM_MIN} title={t('nav.pv.zoomout', 'Zoom out')}
        onClick={() => setZoom((z) => Math.max(ZOOM_MIN, +(z - 0.5).toFixed(2)))}><Minus size={13} /></Button>
      <button type="button" onClick={() => setZoom(1)} title={t('nav.pv.zoomreset', 'Fit to width')}
        className="text-[11px] tabular-nums text-[var(--muted)] hover:text-[var(--text)] min-w-[3.2rem] text-center">{zoomPct}%</button>
      <Button size="sm" variant="ghost" disabled={zoom >= ZOOM_MAX} title={t('nav.pv.zoomin', 'Zoom in')}
        onClick={() => setZoom((z) => Math.min(ZOOM_MAX, +(z + 0.5).toFixed(2)))}><Plus size={13} /></Button>
    </div>
    {/* The bar is laid out at DESKTOP_W and scaled; the wrapper reserves the scaled height.
        Overflow is visible at zoom 1 so the group dropdown (which hangs BELOW the bar) isn't
        clipped — an auto overflow-x would clip overflow-y too. Only once zoomed past the fit
        does it become a pan container, where that trade is worth it. */}
    <div ref={fitRef} className={zoom > 1 ? 'overflow-x-auto scroll-thin' : ''} style={{ height: boxH }}>
    {/* Sized to the bar's VISUAL width. A transform is painted, not laid out: the scroll area
        would otherwise follow the bar's 1120px layout box and let you pan into hundreds of
        pixels of nothing at low zoom. */}
    <div style={{ width: fit.base ? DESKTOP_W * scale : undefined, height: boxH }}>
    <div ref={barRef} style={{ width: DESKTOP_W, transform: `scale(${scale})`, transformOrigin: 'top left' }}
      className="rounded-2xl border border-[var(--line)] px-3 py-2 min-h-14 flex items-center gap-1 topbar bg-[var(--bg-solid)]">
      <img src="/logo.png" alt="" className="w-8 h-8 rounded-lg shrink-0" />
      <span className="font-bold text-sm mr-2 shrink-0">BetterCommunity</span>
      {/* flex-1 align track + inline pill bar, mirroring the real topbar (App.jsx): the track
          positions the content-width pill bar left/center/right per layout.align. */}
      <div className={`flex-1 min-w-0 flex ${navAlignClass(layout.align)}`}>
      <div className={`inline-flex items-center ${layout.density === 'compact' ? 'gap-0' : 'gap-0.5'} bg-[var(--surface-2)] rounded-full p-1 border border-[var(--line)] shrink-0`}>
        {valid.length === 0 ? <span className="text-xs text-[var(--faint)] px-3 py-1.5">{t('nav.pv.empty', 'No valid items yet.')}</span> : valid.map(({ it, idx }) => it.type === 'group' ? (
          <div key={idx} className="relative">
            <button title={onEdit ? t('nav.pv.edit', 'Click to edit · chevron opens the dropdown') : undefined} onClick={() => jump(idx)} className={pillCls(openIdx === idx)}>
              <NavPvIcon name={it.icon} />{!iconsOnly && <span>{pvLabel(it, lang)}</span>}
              <span role="button" tabIndex={-1} onClick={(e) => { e.stopPropagation(); setOpenIdx(openIdx === idx ? null : idx); }} className="-mr-1 p-0.5 rounded hover:bg-[var(--surface-3,var(--line))]"><ChevronDown size={13} className={`transition-transform ${openIdx === idx ? 'rotate-180' : ''}`} /></span>
            </button>
            {openIdx === idx && <div className="absolute left-0 top-full mt-1.5 z-10 min-w-[240px] p-1.5 rounded-2xl border border-[var(--line)] topbar bg-[var(--bg-solid)] shadow-xl">
              {it.children.filter((c) => c.label.trim() && c.to.trim().startsWith('/')).map((c, j) => (
                <div key={j} className="flex items-start gap-2.5 p-2 rounded-xl hover:bg-[var(--surface-2)]">
                  <span className="w-7 h-7 rounded-lg bg-[var(--surface-2)] grid place-items-center shrink-0 text-[var(--primary-2)]"><NavPvIcon name={c.icon} /></span>
                  <span className="min-w-0"><span className="block text-sm font-medium truncate">{pvLabel(c, lang)}</span>{(lang === 'fr' ? c.descFr : c.desc) && <span className="block text-xs text-[var(--faint)] truncate">{lang === 'fr' ? c.descFr : c.desc}</span>}</span>
                </div>
              ))}
            </div>}
          </div>
        ) : <button key={idx} title={onEdit ? t('nav.pv.editlink', 'Click to edit this item') : undefined} onClick={() => jump(idx)} className={pillCls(false)}><NavPvIcon name={it.icon} /> {iconsOnly ? null : pvLabel(it, lang)}</button>)}
        {/* Pinned projects — inline pills, or one "Projects" dropdown, per projectsMode. */}
        {projDropdown ? (
          <div className="relative">
            <button onClick={() => setProjOpen((o) => !o)} className={pillCls(projOpen)}>
              <Sparkles size={15} />{!iconsOnly && <span>{t('nav.projects', 'Projects')}</span>}<ChevronDown size={13} className={`transition-transform ${projOpen ? 'rotate-180' : ''}`} />
            </button>
            {projOpen && <div className="absolute left-0 top-full mt-1.5 z-10 min-w-[220px] p-1.5 rounded-2xl border border-[var(--line)] topbar bg-[var(--bg-solid)] shadow-xl">
              {pvProjects.map((p) => <div key={p.slug} className="flex items-center gap-2.5 p-2 rounded-xl hover:bg-[var(--surface-2)]"><span className="w-7 h-7 rounded-lg bg-[var(--surface-2)] grid place-items-center shrink-0 text-[var(--primary-2)]"><ShowcaseIcon icon={p.icon} size={15} fallback={<Sparkles size={15} />} /></span><span className="text-sm font-medium truncate">{p.name}</span></div>)}
            </div>}
          </div>
        ) : pvProjects.map((p) => <span key={p.slug} className={pillCls(false)}><ShowcaseIcon icon={p.icon} size={15} fallback={<Sparkles size={15} />} /> {iconsOnly ? null : p.name}</span>)}
      </div>
      </div>
      {/* Right-side utility cluster — mirrors the real topbar (App.jsx): cluster A always
          on, then a border divider, then the account cluster B. Theme = the real switch,
          lang = globe + code, profile = avatar disc — drawn by PvUtil so it matches 1:1. */}
      <div className="ml-auto flex items-center gap-0.5 shrink-0">
        {clusterA.map((k) => <span key={k} className="inline-flex items-center px-1.5 py-1" title={t('nav.util.' + k, UTIL_LABEL[k])}><PvUtil k={k} lang={lang} /></span>)}
        {clusterB.length > 0 && <span className="w-px h-5 bg-[var(--line)] mx-1.5" />}
        {clusterB.map((k) => <span key={k} className="inline-flex items-center px-1.5 py-1" title={t('nav.util.' + k, UTIL_LABEL[k])}><PvUtil k={k} lang={lang} /></span>)}
      </div>
    </div>
    </div>
    </div>
    </>
  );
}

// Admin: build the public topbar — an ordered list of links and hover-dropdown groups,
// each with an icon + FR/EN label. Saved as one JSON blob (AdminSetting 'nav.config');
// while disabled or empty the site falls back to its built-in navigation. A live preview
// (desktop + mobile) shows exactly what visitors will get; presets import/export as JSON.
function AdminNav() {
  const toast = useToast();
  const { t, lang } = useI18n();
  const loaded = useAsync(() => api.get('/admin/nav'), []);
  const [enabled, setEnabled] = useState(false);
  const [items, setItems] = useState([]);
  const [utility, setUtility] = useState({}); // { <key>: { visible, order } } for built-in topbar buttons
  const [projectsMode, setProjectsMode] = useState('inline'); // how pinned showcase projects show: inline pills | one "Projects" dropdown
  const [downbarEnabled, setDownbarEnabled] = useState(true);  // mobile bottom tab bar on/off (its items derive from the nav)
  const [layout, setLayout] = useState({ align: 'start', density: 'comfortable', labels: 'both' }); // desktop topbar layout
  const [busy, setBusy] = useState(false);
  const [device, setDevice] = useState('desktop'); // preview device
  // Pinned showcase projects, so the preview shows them exactly as the live topbar will
  // (inline or grouped, per projectsMode) instead of pretending they don't exist.
  const [pinnedProjects, setPinnedProjects] = useState([]);
  useEffect(() => { api.get('/showcase').then((r) => setPinnedProjects((r.projects || []).filter((p) => p.pinTopbar))).catch(() => {}); }, []);
  const [iconPick, setIconPick] = useState(null); // { onChange } while the icon picker is open
  const fileRef = useRef(null);
  const itemRefs = useRef([]);            // editor-card DOM nodes, indexed by item position
  const [flashIdx, setFlashIdx] = useState(null); // card to ring after a preview jump
  // "Edit from the live preview": scroll the matching editor card into view and flash it.
  const editItem = (idx) => {
    const el = itemRefs.current[idx];
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setFlashIdx(idx);
    setTimeout(() => setFlashIdx((v) => (v === idx ? null : v)), 1400);
  };
  useEffect(() => {
    const n = loaded.data?.nav;
    if (!n) return;
    setEnabled(!!n.enabled);
    setItems((n.items || []).map((it) => ({ type: it.type === 'group' ? 'group' : 'link', label: it.label || '', labelFr: it.labelFr || '', to: it.to || '', icon: it.icon || 'Boxes', children: (it.children || []).map((c) => ({ label: c.label || '', labelFr: c.labelFr || '', to: c.to || '/', desc: c.desc || '', descFr: c.descFr || '', icon: c.icon || 'Boxes' })) })));
    setUtility(n.utility && typeof n.utility === 'object' ? n.utility : {});
    setProjectsMode(n.projectsMode === 'dropdown' ? 'dropdown' : 'inline');
    setDownbarEnabled(n.downbar?.enabled !== false);
    setLayout(readLayout(n.layout));
  }, [loaded.data]);

  const patchItem = (i, patch) => setItems((s) => s.map((it, k) => k === i ? { ...it, ...patch } : it));
  const moveItem = (i, dir) => setItems((s) => moveIn(s, i, dir));
  // Drag-to-reorder the top-level items. HTML5 DnD (mouse/desktop) — the up/down buttons stay
  // for touch, where native drag is unreliable. dragIdx = the row being dragged; overIdx = the
  // row it's hovering, for a drop line. On drop, moveTo lands it wherever it was released.
  const [dragIdx, setDragIdx] = useState(null);
  const [overIdx, setOverIdx] = useState(null);
  const onDrop = () => { if (dragIdx != null && overIdx != null) setItems((s) => moveTo(s, dragIdx, overIdx)); setDragIdx(null); setOverIdx(null); };
  const removeItem = (i) => setItems((s) => s.filter((_, k) => k !== i));
  const addItem = (type) => setItems((s) => [...s, blankItem(type)]);
  const patchChild = (i, j, patch) => setItems((s) => s.map((it, k) => k === i ? { ...it, children: it.children.map((c, m) => m === j ? { ...c, ...patch } : c) } : it));
  const moveChild = (i, j, dir) => setItems((s) => s.map((it, k) => k === i ? { ...it, children: moveIn(it.children, j, dir) } : it));
  const removeChild = (i, j) => setItems((s) => s.map((it, k) => k === i ? { ...it, children: it.children.filter((_, m) => m !== j) } : it));
  const addChild = (i) => setItems((s) => s.map((it, k) => k === i ? { ...it, children: [...it.children, blankChild()] } : it));

  // ── Built-in topbar utility buttons: show/hide + reorder within a cluster ──
  const uVis = (k) => utility[k]?.visible !== false;
  const setUVis = (k, v) => setUtility((u) => ({ ...u, [k]: { ...u[k], visible: v } }));
  const orderedU = (list) => [...list].sort((a, b) => (utility[a]?.order ?? list.indexOf(a)) - (utility[b]?.order ?? list.indexOf(b)));
  const moveUtil = (list, k, dir) => {
    const ord = orderedU(list); const i = ord.indexOf(k); const j = i + dir;
    if (j < 0 || j >= ord.length) return;
    [ord[i], ord[j]] = [ord[j], ord[i]];
    setUtility((u) => { const n = { ...u }; ord.forEach((key, idx) => { n[key] = { ...n[key], order: idx }; }); return n; });
  };
  const resetUtil = () => setUtility({});

  // Trim + drop incomplete rows the same way the server would reject them, so what an
  // admin previews as valid is exactly what gets saved.
  const buildClean = () => {
    const out = [];
    for (const it of items) {
      if (it.type === 'group') {
        const children = it.children.map((c) => ({ label: c.label.trim(), labelFr: (c.labelFr || '').trim(), to: c.to.trim(), desc: (c.desc || '').trim(), descFr: (c.descFr || '').trim(), icon: c.icon || '' })).filter((c) => c.label && c.to.startsWith('/'));
        if (it.label.trim() && children.length) out.push({ type: 'group', label: it.label.trim(), labelFr: (it.labelFr || '').trim(), icon: it.icon || '', children });
      } else if (it.label.trim() && it.to.trim().startsWith('/')) {
        out.push({ type: 'link', label: it.label.trim(), labelFr: (it.labelFr || '').trim(), to: it.to.trim(), icon: it.icon || '', children: [] });
      }
    }
    return { enabled, items: out, utility, projectsMode, downbar: { enabled: downbarEnabled }, layout };
  };

  // Deferred behind an undo window, like the blog/docs editors: the PUT is idempotent and we
  // already hold the previously-saved config, so "Undo" simply means the request never went
  // out and the editor is restored to what the server still has. With the undo window turned
  // off in Settings, toast.action runs onCommit immediately instead.
  const save = () => {
    const payload = buildClean();
    setBusy(true);
    toast.action({
      tone: 'success', duration: 6000, cancelLabel: t('common.undo', 'Undo'),
      msg: t('nav.saved', 'Navigation saved.'),
      onCommit: async () => {
        try { await api.put('/admin/nav', payload); loaded.reload?.(); }
        catch (x) { toast.error(x.data?.detail || x.data?.error || t('acc.failed', 'Failed.')); }
        finally { setBusy(false); }
      },
      onCancel: () => { setBusy(false); loaded.reload?.(); },
    });
  };

  // Presets: export the current (cleaned) config as a JSON file; import one back; reset to
  // the built-in default. Import accepts either { enabled, items } or a bare items array.
  const exportPreset = () => {
    const blob = new Blob([JSON.stringify(buildClean(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `topbar-preset-${Date.now()}.json`; a.click(); URL.revokeObjectURL(a.href);
  };
  const importPreset = async (e) => {
    const file = e.target.files?.[0]; e.target.value = ''; if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const arr = Array.isArray(parsed) ? parsed : parsed.items;
      if (!Array.isArray(arr)) throw new Error('bad');
      setItems(arr.map((it) => ({ type: it.type === 'group' ? 'group' : 'link', label: it.label || '', labelFr: it.labelFr || '', to: it.to || '', icon: it.icon || 'Boxes', children: (it.children || []).map((c) => ({ label: c.label || '', labelFr: c.labelFr || '', to: c.to || '/', desc: c.desc || '', descFr: c.descFr || '', icon: c.icon || 'Boxes' })) })));
      if (typeof parsed.enabled === 'boolean') setEnabled(parsed.enabled);
      if (parsed.utility && typeof parsed.utility === 'object' && !Array.isArray(parsed.utility)) setUtility(parsed.utility);
      if (parsed.projectsMode === 'dropdown' || parsed.projectsMode === 'inline') setProjectsMode(parsed.projectsMode);
      if (parsed.downbar && typeof parsed.downbar === 'object') setDownbarEnabled(parsed.downbar.enabled !== false);
      if (parsed.layout && typeof parsed.layout === 'object') setLayout(readLayout(parsed.layout));
      toast.success(t('nav.imported', 'Preset imported — review and save.'));
    } catch { toast.error(t('nav.importbad', 'Not a valid topbar preset JSON.')); }
  };
  const resetDefault = () => setItems(DEFAULT_NAV_SEED.map((x) => ({ ...x, children: (x.children || []).map((c) => ({ ...c })) })));

  // Icon = a button opening the shared picker (every Lucide icon + every Simple Icons brand).
  const IconSelect = ({ value, onChange }) => (
    <button type="button" onClick={() => setIconPick({ onChange })} title={t('nav.icon', 'Icon')}
      className="inline-flex items-center gap-1.5 px-2 py-1.5 rounded-lg border border-[var(--line)] hover:border-[var(--primary-2)] text-sm">
      <NavPvIcon name={value} size={15} /> <span className="text-[var(--faint)] font-mono truncate max-w-[80px]">{value || 'icon'}</span>
    </button>
  );
  const validCount = buildClean().items.length;

  if (loaded.loading) return <Loading />;
  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-semibold mb-1 flex items-center gap-2"><Navigation size={16} className="text-[var(--primary-2)]" /> {t('nav.title', 'Topbar navigation')}</h2>
        <p className="text-sm text-[var(--muted)]">{t('nav.desc', 'Design the public topbar: an ordered list of links and hover-dropdown groups, each with an icon and a name in both languages. While this is off (or empty) the site uses its built-in navigation.')}</p>
      </div>

      <Card className="p-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium text-sm">{t('nav.enable', 'Use this custom navigation')}</div>
          <div className="text-xs text-[var(--faint)]">{enabled ? t('nav.enable.on', 'The topbar shows your configured items below.') : t('nav.enable.off', 'The topbar shows the built-in navigation.')}{enabled && validCount === 0 && <span className="text-warning"> · {t('nav.enable.empty', 'no valid items yet — the built-in nav still shows')}</span>}</div>
        </div>
        <button type="button" onClick={() => setEnabled((v) => !v)} aria-pressed={enabled} className={`w-11 h-6 rounded-full relative shrink-0 transition ${enabled ? 'bg-[var(--primary)]' : 'bg-[var(--surface-3,var(--line))]'}`}><span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${enabled ? 'left-[22px]' : 'left-0.5'}`} /></button>
      </Card>

      {/* Live preview of the real topbar built from the items below. */}
      <Card className="p-4">
        <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
          <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] flex items-center gap-1.5"><Eye size={13} className="text-[var(--primary-2)]" /> {t('nav.pv.title', 'Live preview')} <span className="normal-case font-normal text-[var(--faint)]">({lang.toUpperCase()})</span></div>
          <div className="flex rounded-lg border border-[var(--line)] overflow-hidden">
            <button onClick={() => setDevice('desktop')} className={`px-2.5 py-1 text-xs flex items-center gap-1.5 ${device === 'desktop' ? 'bg-[var(--surface-2)] text-[var(--text)] font-medium' : 'text-[var(--muted)]'}`}><MonitorIcon size={13} /> {t('nav.pv.desktop', 'Desktop')}</button>
            <button onClick={() => setDevice('mobile')} className={`px-2.5 py-1 text-xs flex items-center gap-1.5 ${device === 'mobile' ? 'bg-[var(--surface-2)] text-[var(--text)] font-medium' : 'text-[var(--muted)]'}`}><Smartphone size={13} /> {t('nav.pv.mobile', 'Mobile')}</button>
          </div>
        </div>
        <div className="rounded-xl bg-[var(--bg)] p-4"><NavPreview items={items} lang={lang} device={device} utility={utility} projectsMode={projectsMode} downbar={downbarEnabled} layout={layout} projects={pinnedProjects} onEdit={device === 'desktop' ? editItem : undefined} /></div>
        {device === 'desktop' && items.length > 0 && <div className="text-[11px] text-[var(--faint)] mt-2 flex items-center gap-1"><MousePointerClick size={11} /> {t('nav.pv.edithint', 'Click any item in the preview to jump to its settings below.')}</div>}
      </Card>

      {/* Preset tools: import / export a JSON preset, or reset to the built-in default. */}
      <div className="flex flex-wrap items-center gap-2">
        <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={importPreset} />
        <Button size="sm" variant="ghost" onClick={() => fileRef.current?.click()}><UploadIcon size={14} /> {t('nav.import', 'Import preset')}</Button>
        <Button size="sm" variant="ghost" onClick={exportPreset}><Download size={14} /> {t('nav.export', 'Export preset')}</Button>
        <Button size="sm" variant="ghost" onClick={resetDefault}><RotateCcw size={14} /> {t('nav.reset', 'Reset to default')}</Button>
      </div>

      {/* Pinned projects display + mobile bottom bar. */}
      <Card className="p-4 space-y-4">
        <h3 className="font-semibold text-sm flex items-center gap-2"><Sparkles size={15} className="text-[var(--primary-2)]" /> {t('nav.extra.title', 'Projects & mobile')}</h3>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="font-medium text-sm">{t('nav.projmode', 'Pinned projects in the topbar')}</div>
            <div className="text-xs text-[var(--faint)]">{t('nav.projmode.d', 'Show admin-pinned projects as their own pills, or grouped under one “Projects” dropdown. Each keeps its own icon.')}</div>
          </div>
          <div className="flex rounded-lg border border-[var(--line)] overflow-hidden shrink-0">
            {[['inline', t('nav.projmode.inline', 'Inline')], ['dropdown', t('nav.projmode.dropdown', 'Dropdown')]].map(([v, lbl]) =>
              <button key={v} type="button" onClick={() => setProjectsMode(v)} className={`px-3 py-1.5 text-xs ${projectsMode === v ? 'bg-[var(--surface-2)] text-[var(--text)] font-medium' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}>{lbl}</button>)}
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 flex-wrap border-t border-[var(--line)] pt-3">
          <div className="min-w-0">
            <div className="font-medium text-sm flex items-center gap-1.5"><Smartphone size={14} /> {t('nav.downbar', 'Mobile bottom bar')}</div>
            <div className="text-xs text-[var(--faint)]">{t('nav.downbar.d', 'The app-style tab bar at the bottom of the screen on phones. Its buttons follow your nav items (home + the first few links).')}</div>
          </div>
          <button type="button" onClick={() => setDownbarEnabled((v) => !v)} aria-pressed={downbarEnabled} title={downbarEnabled ? t('nav.util.hide', 'Hide') : t('nav.util.show', 'Show')} className={`w-11 h-6 rounded-full relative shrink-0 transition ${downbarEnabled ? 'bg-[var(--primary)]' : 'bg-[var(--surface-3,var(--line))]'}`}><span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${downbarEnabled ? 'left-[22px]' : 'left-0.5'}`} /></button>
        </div>
        {/* Desktop layout — align · density · labels. Applied live by the preview above and
            by the real topbar via the shared lib/navLayout reader. */}
        {(() => {
          const seg = (label, hint, field, opts) => (
            <div className="flex items-center justify-between gap-3 flex-wrap border-t border-[var(--line)] pt-3">
              <div className="min-w-0"><div className="font-medium text-sm">{label}</div><div className="text-xs text-[var(--faint)]">{hint}</div></div>
              <div className="flex rounded-lg border border-[var(--line)] overflow-hidden shrink-0">
                {opts.map(([v, lbl]) => <button key={v} type="button" onClick={() => setLayout((s) => ({ ...s, [field]: v }))} className={`px-3 py-1.5 text-xs ${layout[field] === v ? 'bg-[var(--surface-2)] text-[var(--text)] font-medium' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}>{lbl}</button>)}
              </div>
            </div>
          );
          return <>
            {seg(t('nav.layout.align', 'Nav alignment'), t('nav.layout.align.d', 'Where the nav sits in the bar on desktop.'), 'align', [['start', t('nav.layout.left', 'Left')], ['center', t('nav.layout.center', 'Center')], ['end', t('nav.layout.right', 'Right')]])}
            {seg(t('nav.layout.density', 'Density'), t('nav.layout.density.d', 'Spacing between nav items.'), 'density', [['comfortable', t('nav.layout.comfortable', 'Comfortable')], ['compact', t('nav.layout.compact', 'Compact')]])}
            {seg(t('nav.layout.labels', 'Labels'), t('nav.layout.labels.d', 'Show text next to icons, or icons only to save room.'), 'labels', [['both', t('nav.layout.both', 'Icons + text')], ['icons', t('nav.layout.iconsonly', 'Icons only')]])}
          </>;
        })()}
      </Card>

      {/* Built-in topbar buttons: show/hide + reorder (within each responsive cluster). */}
      <Card className="p-4">
        <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
          <h3 className="font-semibold text-sm flex items-center gap-2"><LayoutGrid size={15} className="text-[var(--primary-2)]" /> {t('nav.util.title', 'Topbar buttons')}</h3>
          <Button size="sm" variant="ghost" onClick={resetUtil}><RotateCcw size={13} /> {t('nav.util.reset', 'Reset')}</Button>
        </div>
        <p className="text-xs text-[var(--muted)] mb-3">{t('nav.util.desc', 'Show/hide and reorder the built-in buttons. Each still respects its own rule (e.g. Admin only shows for staff, Sign in only when logged out). Order changes stay within a group.')}</p>
        {[['a', t('nav.util.always', 'Always visible'), UTIL_A_KEYS], ['b', t('nav.util.account', 'Account (desktop)'), UTIL_B_KEYS]].map(([grp, label, keys]) => (
          <div key={grp} className="mb-3 last:mb-0">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--faint)] mb-1.5">{label}</div>
            <div className="space-y-1">
              {orderedU(keys).map((k, idx, arr) => (
                <div key={k} className="flex items-center gap-2 rounded-lg border border-[var(--line)] px-2.5 py-1.5 bg-[var(--surface-2)]/40">
                  <NavPvIcon name={UTIL_ICON[k]} size={15} />
                  <span className="flex-1 text-sm">{t('nav.util.' + k, UTIL_LABEL[k])}</span>
                  <button className="p-1 rounded text-[var(--muted)] disabled:opacity-30 hover:text-[var(--text)]" disabled={idx === 0} onClick={() => moveUtil(keys, k, -1)} title={t('nav.up', 'Move up')}><ChevronDown size={13} className="rotate-180" /></button>
                  <button className="p-1 rounded text-[var(--muted)] disabled:opacity-30 hover:text-[var(--text)]" disabled={idx === arr.length - 1} onClick={() => moveUtil(keys, k, 1)} title={t('nav.down', 'Move down')}><ChevronDown size={13} /></button>
                  <button type="button" onClick={() => setUVis(k, !uVis(k))} aria-pressed={uVis(k)} title={uVis(k) ? t('nav.util.hide', 'Hide') : t('nav.util.show', 'Show')} className={`w-9 h-5 rounded-full relative shrink-0 transition ${uVis(k) ? 'bg-[var(--primary)]' : 'bg-[var(--surface-3,var(--line))]'}`}><span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${uVis(k) ? 'left-[18px]' : 'left-0.5'}`} /></button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </Card>

      {items.length === 0 ? (
        <EmptyState icon={Navigation} title={t('nav.none.t', 'No items yet')} sub={t('nav.none.s', 'Add a link or a dropdown group, or start from the built-in navigation.')} />
      ) : <div className="space-y-3">
        {items.map((it, i) => (
          <Card key={i} ref={(el) => { itemRefs.current[i] = el; }}
            onDragOver={dragIdx != null ? (e) => { e.preventDefault(); if (overIdx !== i) setOverIdx(i); } : undefined}
            onDrop={dragIdx != null ? (e) => { e.preventDefault(); onDrop(); } : undefined}
            className={`p-4 space-y-3 transition-all ${flashIdx === i ? 'ring-2 ring-[var(--primary)] shadow-lg' : ''} ${dragIdx === i ? 'opacity-40' : ''} ${dragIdx != null && overIdx === i && dragIdx !== i ? 'ring-2 ring-[var(--primary)]/60' : ''}`}>
            <div className="flex items-center gap-2 flex-wrap">
              {/* Drag handle: only this is draggable, so the fields inside stay selectable. */}
              <button type="button" draggable
                onDragStart={(e) => { setDragIdx(i); setOverIdx(i); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', String(i)); } catch { /* Safari */ } }}
                onDragEnd={() => { setDragIdx(null); setOverIdx(null); }}
                className="p-1 -ml-1 rounded-md text-[var(--faint)] hover:text-[var(--text)] cursor-grab active:cursor-grabbing" title={t('nav.drag', 'Drag to reorder')} aria-label={t('nav.drag', 'Drag to reorder')}>
                <GripVertical size={15} />
              </button>
              <Badge tone={it.type === 'group' ? 'primary' : ''}>{it.type === 'group' ? <><Layers size={11} /> {t('nav.group', 'Dropdown')}</> : <><Link2 size={11} /> {t('nav.link', 'Link')}</>}</Badge>
              <div className="flex-1" />
              <button className="nav-icon-btn p-1.5 rounded-lg border border-[var(--line)] text-[var(--muted)] disabled:opacity-30" disabled={i === 0} onClick={() => moveItem(i, -1)} title={t('nav.up', 'Move up')}><ChevronDown size={14} className="rotate-180" /></button>
              <button className="p-1.5 rounded-lg border border-[var(--line)] text-[var(--muted)] disabled:opacity-30" disabled={i === items.length - 1} onClick={() => moveItem(i, 1)} title={t('nav.down', 'Move down')}><ChevronDown size={14} /></button>
              <button className="p-1.5 rounded-lg border border-[var(--line)] text-error hover:bg-error-bg" onClick={() => removeItem(i)} title={t('nav.remove', 'Remove')}><Trash2 size={14} /></button>
            </div>
            <div className="grid sm:grid-cols-2 gap-2.5">
              <Field label={t('nav.label.en', 'Label (EN)')}><Input value={it.label} onChange={(e) => patchItem(i, { label: e.target.value })} placeholder="Apps" /></Field>
              <Field label={t('nav.label.fr', 'Label (FR)')}><Input value={it.labelFr} onChange={(e) => patchItem(i, { labelFr: e.target.value })} placeholder="Applications" /></Field>
            </div>
            <div className="flex flex-wrap items-end gap-2.5">
              <Field label={t('nav.icon', 'Icon')}><IconSelect value={it.icon} onChange={(v) => patchItem(i, { icon: v })} /></Field>
              {it.type === 'link' && <div className="flex-1 min-w-[180px]"><Field label={t('nav.to', 'Links to (internal path)')} hint={t('nav.to.hint', 'Must start with /')}><Input value={it.to} onChange={(e) => patchItem(i, { to: e.target.value })} placeholder="/blog" /></Field></div>}
            </div>

            {it.type === 'group' && <div className="pt-2 border-t border-[var(--line)] space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)]">{t('nav.children', 'Dropdown links')}</div>
              {it.children.length === 0 && <div className="text-xs text-[var(--faint)]">{t('nav.children.none', 'Add at least one link — an empty group is dropped on save.')}</div>}
              {it.children.map((c, j) => (
                <div key={j} className="rounded-xl border border-[var(--line)] p-2.5 space-y-2 bg-[var(--surface-2)]/40">
                  <div className="flex items-center gap-2">
                    <IconSelect value={c.icon} onChange={(v) => patchChild(i, j, { icon: v })} />
                    <div className="flex-1" />
                    <button className="p-1.5 rounded-lg border border-[var(--line)] text-[var(--muted)] disabled:opacity-30" disabled={j === 0} onClick={() => moveChild(i, j, -1)} title={t('nav.up', 'Move up')}><ChevronDown size={13} className="rotate-180" /></button>
                    <button className="p-1.5 rounded-lg border border-[var(--line)] text-[var(--muted)] disabled:opacity-30" disabled={j === it.children.length - 1} onClick={() => moveChild(i, j, 1)} title={t('nav.down', 'Move down')}><ChevronDown size={13} /></button>
                    <button className="p-1.5 rounded-lg border border-[var(--line)] text-error hover:bg-error-bg" onClick={() => removeChild(i, j)} title={t('nav.remove', 'Remove')}><Trash2 size={13} /></button>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-2">
                    <Input value={c.label} onChange={(e) => patchChild(i, j, { label: e.target.value })} placeholder={t('nav.label.en', 'Label (EN)')} />
                    <Input value={c.labelFr} onChange={(e) => patchChild(i, j, { labelFr: e.target.value })} placeholder={t('nav.label.fr', 'Label (FR)')} />
                    <Input value={c.to} onChange={(e) => patchChild(i, j, { to: e.target.value })} placeholder="/p/bmm" />
                    <Input value={c.desc} onChange={(e) => patchChild(i, j, { desc: e.target.value })} placeholder={t('nav.sub.en', 'Sub-text (EN, optional)')} />
                    <Input value={c.descFr} onChange={(e) => patchChild(i, j, { descFr: e.target.value })} placeholder={t('nav.sub.fr', 'Sub-text (FR, optional)')} />
                  </div>
                </div>
              ))}
              <Button size="sm" variant="ghost" onClick={() => addChild(i)}><Plus size={13} /> {t('nav.addchild', 'Add dropdown link')}</Button>
            </div>}
          </Card>
        ))}
      </div>}

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="default" onClick={() => addItem('link')}><Plus size={14} /> {t('nav.addlink', 'Add link')}</Button>
        <Button size="sm" variant="default" onClick={() => addItem('group')}><Plus size={14} /> {t('nav.addgroup', 'Add dropdown')}</Button>
        <Button size="sm" variant="ghost" onClick={() => setItems(DEFAULT_NAV_SEED.map((x) => ({ ...x, children: (x.children || []).map((c) => ({ ...c })) })))}><Layers size={14} /> {t('nav.seed', 'Start from built-in')}</Button>
        <div className="flex-1" />
        <Button variant="primary" disabled={busy} onClick={save}>{busy ? <Spinner /> : <><Save size={15} /> {t('nav.save', 'Save navigation')}</>}</Button>
      </div>
      {iconPick && <IconPicker title={t('nav.pickicon', 'Pick a nav icon')} onPick={(v) => iconPick.onChange(v)} onClose={() => setIconPick(null)} />}
    </div>
  );
}

// Owner: manage my community catalogs — visibility, public listing, share link, delete,
// and (for managed catalogs) the items. The feed URL + /c page are one click away.
// Rendered by the MEMBER dashboard (pages/dashboard.jsx), never by this page — it lives
// here only because the old pages monolith was split this way. Exported so the dashboard
// imports it instead of referencing a bare identifier, which crashed the tab at render.
export function OwnerCatalogs() {
  const { t } = useI18n(); const toast = useToast();
  const { data, loading, reload } = useAsync(() => api.get('/me/catalogs'), []);
  const [openId, setOpenId] = useState(null);
  const [hidden, setHidden] = useState(() => new Set()); // optimistically-removed during the undo window
  const cats = (data?.catalogs || []).filter((c) => !hidden.has(c.id));
  const patch = async (c, body) => { try { await api.patch(`/me/catalogs/${c.id}`, body); reload(); } catch (x) { toast.error(x.data?.error || t('acc.failed', 'Failed.')); } };
  const rotate = async (c) => { try { const r = await api.post(`/me/catalogs/${c.id}/rotate-key`); navigator.clipboard?.writeText(`${location.origin}/c/${c.slug}?k=${r.shareKey}`); toast.success(t('oc.keyrotated', 'New share link copied.')); reload(); } catch { toast.error(t('acc.failed', 'Failed.')); } };
  // Optimistic delete with an undo window: hide the card now and count down; the catalog
  // is only removed when the timer elapses (Undo restores it, nothing is deleted).
  const del = (c) => {
    setHidden((s) => new Set(s).add(c.id));
    if (openId === c.id) setOpenId(null);
    const unhide = () => setHidden((s) => { const n = new Set(s); n.delete(c.id); return n; });
    toast.action({
      tone: 'success', duration: 6000, cancelLabel: t('common.undo', 'Undo'),
      msg: t('oc.deleted2', 'Catalog deleted.'),
      onCommit: async () => { try { await api.del(`/me/catalogs/${c.id}`); reload(); } catch { toast.error(t('acc.failed', 'Failed.')); unhide(); } },
      onCancel: unhide,
    });
  };
  const copyFeed = (c) => { navigator.clipboard?.writeText(`${location.origin}/api/c/${c.slug}/catalog.json`); toast.success(t('ccp.copied', 'Copied.')); };
  const tone = (s) => s === 'SUSPENDED' ? 'red' : s === 'HIDDEN' ? 'amber' : 'green';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div><h2 className="font-semibold flex items-center gap-2"><Boxes size={16} className="text-[var(--primary-2)]" /> {t('mycat.title', 'My catalogs')}</h2>
          <p className="text-sm text-[var(--muted)]">{t('oc.desc', 'Catalogs you host. Share the /c link or add them in BMM. Managed catalogs draw from a storage pool.')}</p></div>
        <Link to="/submit"><Button size="sm" variant="primary"><Plus size={14} /> {t('oc.new', 'New catalog')}</Button></Link>
      </div>
      {loading ? <Loading /> : cats.length ? <div className="space-y-2">
        {cats.map((c) => (
          <Card key={c.id} className="p-4">
            {/* Content, then actions on their own row — the same shape as the repo cards.
                The actions can't share a row with the title: ActionBar sizes itself from its
                container, and next to a flex-1 sibling that container IS its content, so it
                would measure "everything fits" at every width and never fold. */}
            <div className="min-w-0">
              <div className="font-medium flex items-center gap-2 flex-wrap min-w-0"><span className="truncate min-w-0">{c.name}</span> <Badge tone={tone(c.status)}>{c.status}</Badge><Badge tone={c.visibility === 'private' ? 'amber' : ''}>{c.visibility}</Badge><Badge tone="">{c.mode}</Badge></div>
              <div className="text-xs text-[var(--faint)] flex items-center gap-2 flex-wrap mt-0.5">
                <span>{c.itemCount} {t('cc.items', 'items')}</span>
                <span className="flex items-center gap-1"><Download size={11} /> {c.downloads ?? 0}</span>
                <span className="flex items-center gap-1"><Eye size={11} /> {c.views ?? 0}</span>
                <a href={`/c/${c.slug}`} target="_blank" rel="noreferrer" className="underline truncate max-w-full">/c/{c.slug}</a>
              </div>
            </div>
            <div className="mt-3">
              <ActionBar actions={[
                { key: 'feed', label: t('oc.feed', 'Feed URL'), icon: Copy, onClick: () => copyFeed(c) },
                c.mode === 'managed' && { key: 'items', label: t('oc.items', 'Items'), icon: Package, onClick: () => setOpenId(openId === c.id ? null : c.id) },
                { key: 'del', label: t('common.delete', 'Delete'), icon: Trash2, danger: true, onClick: () => del(c) },
              ].filter(Boolean)} />
            </div>
            <div className="flex items-center gap-3 mt-3 pt-3 border-t border-[var(--line)] flex-wrap text-sm">
              <label className="flex items-center gap-1.5 text-[var(--muted)]">{t('oc.visibility', 'Visibility')}
                <Select className="!w-auto" value={c.visibility} onChange={(e) => patch(c, { visibility: e.target.value })}><option value="public">{t('sub2.public', 'Public')}</option><option value="private">{t('sub2.private', 'Private')}</option></Select></label>
              {c.visibility === 'public' && <label className="flex items-center gap-1.5 text-[var(--muted)] cursor-pointer"><input type="checkbox" checked={c.listed} onChange={(e) => patch(c, { listed: e.target.checked })} /> {t('oc.listed', 'Listed publicly')}</label>}
              {/* Which app this catalog is for. Without it the catalog index cannot say,
                  and a client filtering by app has to choose between dropping it and
                  taking everything — so an unset catalog reaches fewer people than a
                  labelled one, not more. "Not specified" stays selectable: a catalog set
                  to the wrong app is worse than an unlabelled one, and would otherwise be
                  permanently mislabelled. */}
              <label className="flex items-center gap-1.5 text-[var(--muted)]">
                {t('oc.forapp', 'For')}
                <Select className="!w-auto" value={c.app || ''} onChange={(e) => patch(c, { app: e.target.value })}>
                  <option value="">{t('oc.forapp.none', 'Not specified')}</option>
                  {['bmm', 'bsm', 'installer'].map((k) => <option key={k} value={k}>{k.toUpperCase()}</option>)}
                </Select>
              </label>
              {c.visibility === 'private' && <Button size="sm" variant="ghost" onClick={() => rotate(c)}><RefreshCw size={12} /> {t('oc.sharelink', 'Copy share link')}</Button>}
            </div>
            {openId === c.id && <OwnerCatalogItems catalog={c} onChange={reload} />}
          </Card>
        ))}
      </div> : <EmptyState icon={Boxes} title={t('mycat.none.t', 'No catalogs yet')} sub={t('mycat.none.s', 'Host your own catalog of plugins, themes or apps.')} />}
    </div>
  );
}

// Managed-catalog item manager. Each item either points at an external download URL, or
// hosts a file uploaded straight into the catalog's storage pool (the size limit is just
// the pool's free space — enforced server-side on create).
function OwnerCatalogItems({ catalog, onChange }) {
  const { t } = useI18n(); const toast = useToast();
  const { data, loading, reload } = useAsync(() => api.get(`/me/catalogs/${catalog.id}`), [catalog.id]);
  const [f, setF] = useState({ name: '', url: '' });
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(() => new Set());
  const fileRef = useRef(null);
  // The catalog's own kind — every item takes it. `kind` comes from the API; `kinds[0]` is
  // the fallback for a catalog serialised before that field existed.
  const itemKind = String(catalog.kind || catalog.kinds?.[0] || 'APP').toUpperCase();
  const items = (data?.catalog?.items || []).filter((it) => !hidden.has(it.id));
  const add = async () => {
    if (f.name.trim().length < 1) return toast.error(t('oc.it.name', 'Name required.'));
    setBusy(true);
    try {
      let payloadKey, payloadSize;
      if (file) { payloadKey = await uploadPayload(itemKind, file); payloadSize = file.size; }
      await api.post(`/me/catalogs/${catalog.id}/items`, {
        kind: itemKind, name: f.name.trim(),
        payloadKey, payloadSize,
        meta: (!file && f.url) ? { download_url: f.url.trim() } : {},
      });
      setF({ ...f, name: '', url: '' }); setFile(null); if (fileRef.current) fileRef.current.value = '';
      reload(); onChange?.();
    } catch (x) {
      const e = x.data?.error;
      toast.error(e === 'too_large' ? t('sub2.toobig', 'Files over 100MB must be arranged via the contact page.') : e === 'pool_exceeded' ? t('oc.it.poolfull', 'Not enough pool space left.') : e || t('acc.failed', 'Failed.'));
    } finally { setBusy(false); }
  };
  const rm = (it) => {
    setHidden((s) => new Set(s).add(it.id));
    const unhide = () => setHidden((s) => { const n = new Set(s); n.delete(it.id); return n; });
    toast.action({
      tone: 'success', duration: 6000, cancelLabel: t('common.undo', 'Undo'),
      msg: t('oc.it.removed', 'Item removed.'),
      onCommit: async () => { try { await api.del(`/me/catalogs/${catalog.id}/items/${it.id}`); reload(); onChange?.(); } catch { toast.error(t('acc.failed', 'Failed.')); unhide(); } },
      onCancel: unhide,
    });
  };
  return (
    <div className="mt-3 pt-3 border-t border-[var(--line)]">
      {loading ? <Loading /> : <>
        {items.length > 0 && <div className="space-y-1 mb-2">
          {items.map((it) => (
            <div key={it.id} className="flex items-center gap-2 text-sm py-1">
              <Badge tone="">{it.kind}</Badge><span className="flex-1 min-w-0 truncate">{it.name}</span>
              {it.payloadKey && <span className="text-[11px] text-[var(--faint)] flex items-center gap-1"><HardDrive size={11} /> {fmtBytes(it.payloadSize)}</span>}
              <span className="text-[11px] text-[var(--faint)] flex items-center gap-1"><Download size={11} /> {it.downloads ?? 0}</span>
              <button onClick={() => rm(it)} className="text-[var(--faint)] hover:text-error"><X size={13} /></button>
            </div>
          ))}
        </div>}
        <div className="flex flex-wrap items-end gap-2">
          {/* Not a choice. A catalog serves one kind, so every item in it has that kind by
              definition — offering a picker here only invited an item the feed would refuse
              to emit (the API now answers kind_mismatch). Shown, not selectable. */}
          <Badge tone="primary" title={t('oc.it.kindfixed', 'This catalog serves one type; every item uses it.')}>{KIND_LABEL[itemKind] || itemKind}</Badge>
          <Input className="flex-1 min-w-[120px]" placeholder={t('sub.name', 'Name')} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          {!file && <Input className="flex-1 min-w-[160px]" placeholder="https://…/download" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} />}
          {file && <span className="text-xs text-[var(--muted)] flex items-center gap-1 min-w-0"><Upload size={12} /> <span className="truncate max-w-[160px]">{file.name}</span> ({fmtBytes(file.size)}) <button onClick={() => { setFile(null); if (fileRef.current) fileRef.current.value = ''; }} className="hover:text-error"><X size={12} /></button></span>}
          <input ref={fileRef} type="file" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          <Button size="sm" variant="ghost" onClick={() => fileRef.current?.click()} title={t('oc.it.upload', 'Upload a file to your pool instead of linking a URL')}><Upload size={13} /> {t('oc.it.uploadbtn', 'Upload')}</Button>
          <Button size="sm" variant="default" onClick={add} disabled={busy}>{busy ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} {t('oc.additem', 'Add')}</Button>
        </div>
        <p className="text-[11px] text-[var(--faint)] mt-1.5">{t('oc.it.hint', 'Link a download URL, or upload a file — uploads use your pool space (up to what is free).')}</p>
      </>}
    </div>
  );
}

// Admin: moderate community-hosted catalogs — suspend (offline for all), unlist (out of
// the public browser but reachable by URL), delete (purge), or examine an item's hosted
// files. Cap: manage_catalogs.
function AdminCatalogs() {
  const { t } = useI18n(); const toast = useToast(); const dialog = useDialog();
  const [q, setQ] = useState('');
  const [examine, setExamine] = useState(null); // catalog being examined
  const { data, loading, reload } = useAsync(() => api.get('/admin/catalogs'), []);
  const act = async (c, action) => {
    try { await api.post(`/admin/catalogs/${c.id}/${action}`); toast.success(t('cc.acted', 'Done.')); reload(); }
    catch (x) { toast.error(x.data?.error || t('acc.failed', 'Failed.')); }
  };
  // A single status control (like repos): Online (active+listed) / Offline (unlisted) /
  // Suspended. Chains the underlying actions as needed.
  const setStatus = async (c, next) => {
    const cur = c.status === 'SUSPENDED' ? 'suspended' : c.listed ? 'online' : 'offline';
    if (cur === next) return;
    try {
      if (next === 'suspended') await api.post(`/admin/catalogs/${c.id}/suspend`);
      else {
        if (c.status === 'SUSPENDED') await api.post(`/admin/catalogs/${c.id}/unsuspend`);
        if (next === 'online' && c.visibility === 'public') await api.post(`/admin/catalogs/${c.id}/relist`);
        if (next === 'offline') await api.post(`/admin/catalogs/${c.id}/unlist`);
      }
      toast.success(t('cc.acted', 'Done.')); reload();
    } catch (x) { toast.error(x.data?.error || t('acc.failed', 'Failed.')); }
  };
  const del = async (c) => {
    if (!(await dialog.confirm({ title: t('cc.del.t', 'Delete catalog?'), message: t('cc.del.m', 'Permanently delete "{n}"? Its items and hosted files are purged and pool space is freed. This cannot be undone.').replace('{n}', c.name), okLabel: t('common.delete', 'Delete'), danger: true }))) return;
    act(c, 'delete');
  };
  const rows = (data?.catalogs || []).filter((c) => {
    const s = q.toLowerCase();
    return !q || c.name.toLowerCase().includes(s) || (c.email || '').toLowerCase().includes(s) || (c.owner || '').toLowerCase().includes(s) || (c.creators || []).some((cr) => (cr.id || '').toLowerCase().includes(s) || (cr.name || '').toLowerCase().includes(s));
  });
  const tone = (s) => s === 'SUSPENDED' ? 'red' : s === 'HIDDEN' ? 'amber' : 'green';
  const roleTone = (r) => r === 'SUPERADMIN' || r === 'ADMIN' ? 'red' : r === 'MOD' ? 'amber' : '';
  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-semibold mb-1 flex items-center gap-2"><Layers size={16} className="text-[var(--primary-2)]" /> {t('cc.admin.title', 'Community catalogs')}</h2>
        <p className="text-sm text-[var(--muted)]">{t('cc.admin.desc2', 'Owner-hosted catalogs. Suspend takes one offline for everyone; unlist just removes it from the public browser (its URL still works); delete purges it. Examine reads the hosted files without running anything.')}</p>
      </div>
      <div className="relative"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--faint)]" /><Input className="!pl-9" placeholder={t('cc.admin.search2', 'Search name, owner, email or creator id…')} value={q} onChange={(e) => setQ(e.target.value)} /></div>
      {loading ? <Loading /> : rows.length ? <div className="space-y-1.5">
        {rows.map((c) => { const cur = c.status === 'SUSPENDED' ? 'suspended' : c.listed ? 'online' : 'offline'; const cr = (c.creators || [])[0];
        // Stack on phones: the status select + Examine + delete sat beside the text, so on a
        // narrow card the name/owner/creator-id line had almost no room and the controls
        // collided with it. Below sm they get their own full-width row under the details.
        return (
          <Card key={c.id} className="p-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
            <div className="flex-1 min-w-0">
              {/* Line 1: name + a couple of defining tags (status lives in the dropdown). */}
              <div className="font-medium flex items-center gap-2 flex-wrap min-w-0"><span className="truncate min-w-0">{c.name}</span> <Badge tone={c.visibility === 'private' ? 'amber' : ''}>{c.visibility}</Badge><Badge tone="">{c.mode}</Badge></div>
              {/* Line 2: WHO — owner (→ profile) + one BMM creator id (copy) + a compact count. */}
              <div className="text-xs text-[var(--faint)] truncate flex items-center gap-2.5 flex-wrap mt-0.5">
                <a href={`/u/${c.ownerId}`} className="flex items-center gap-1 hover:text-[var(--primary)]" title={c.email}><Users size={11} /> {c.owner || t('cc.noname', '—')}{c.ownerRole && c.ownerRole !== 'USER' && <Badge tone={roleTone(c.ownerRole)}>{c.ownerRole}</Badge>}</a>
                {cr ? <button onClick={() => { navigator.clipboard?.writeText(cr.id); toast.success(t('ccp.copied', 'Copied.')); }} className="font-mono inline-flex items-center gap-1 hover:text-[var(--primary)]" title={t('cc.creatorid', 'Linked BMM creator id')}><Fingerprint size={11} /> {cr.id.slice(0, 12)}… <Copy size={9} /></button>
                  : <span className="inline-flex items-center gap-1 text-warning" title={t('cc.nolink', 'No linked BMM account')}><AlertTriangle size={11} /> {t('cc.nolink', 'no BMM link')}</span>}
                <span>{c.itemCount} {t('cc.items', 'items')} · <Download size={11} className="inline" /> {c.downloads ?? 0}</span>
                <a href={`/c/${c.slug}`} target="_blank" rel="noreferrer" className="underline">/c/{c.slug}</a>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0 border-t border-[var(--border)] pt-2 sm:border-0 sm:pt-0">
              {/* DotDropdown, not a native <select> with 🟢/⚪/🔴 in the labels: an <option> can
                  only hold text, which is why the emoji were there at all. They render in the
                  OS font, ignore the theme, and don't match the colour tokens the repo cards
                  use for the very same states. This is the same control those cards already
                  use, so a status reads identically across the admin. */}
              <DotDropdown value={cur} className="flex-1 sm:flex-none" onChange={(v) => setStatus(c, v)}
                options={[
                  { value: 'online', label: t('cc.online', 'Online'), color: 'var(--success)' },
                  { value: 'offline', label: t('cc.offline', 'Offline'), color: 'var(--faint)' },
                  { value: 'suspended', label: t('cc.suspend', 'Suspended'), color: 'var(--error)' },
                ]} />
              {c.mode === 'managed' && <Button size="sm" variant="ghost" onClick={() => setExamine(c)}><Eye size={13} /> {t('cc.examine', 'Examine')}</Button>}
              <Button size="sm" variant="ghost" className="!text-error" onClick={() => del(c)}><Trash2 size={13} /></Button>
            </div>
          </Card>
        ); })}
      </div> : <EmptyState icon={Layers} title={t('cc.admin.none.t', 'No community catalogs')} sub={t('cc.admin.none.s', 'When users host their own catalogs, they show up here for moderation.')} />}
      {examine && <AdminCatalogExamine catalog={examine} onClose={() => setExamine(null)} />}
    </div>
  );
}

// Admin: examine a managed catalog's hosted items — list items, and for each, inspect the
// payload (zip entries + inline text preview for readable files) or download it. Nothing
// is ever executed; downloads are served as attachments.
function AdminCatalogExamine({ catalog, onClose }) {
  const { t } = useI18n(); const toast = useToast();
  const { data, loading } = useAsync(() => api.get(`/admin/catalogs/${catalog.id}/items`), [catalog.id]);
  const [openItem, setOpenItem] = useState(null);
  const [inspect, setInspect] = useState(null); // { loading, data, error }
  const [openEntry, setOpenEntry] = useState(null);
  const items = data?.items || [];
  const doInspect = async (it) => {
    if (openItem === it.id) { setOpenItem(null); setInspect(null); return; }
    setOpenItem(it.id); setOpenEntry(null); setInspect({ loading: true });
    try { const r = await api.get(`/admin/catalogs/${catalog.id}/items/${it.id}/inspect`); setInspect({ data: r }); }
    catch (x) { setInspect({ error: x.data?.error || 'read_failed' }); }
  };
  const dl = (it, path) => { const u = `/api/admin/catalogs/${catalog.id}/items/${it.id}/download${path ? `?path=${encodeURIComponent(path)}` : ''}`; window.open(u, '_blank'); };
  return (
    <Modal open onClose={onClose} title={t('cc.examine.t', 'Examine: {n}').replace('{n}', catalog.name)} icon={Eye} width="max-w-3xl">
      {loading ? <Loading /> : items.length ? <div className="space-y-1.5">
        {items.map((it) => (
          <div key={it.id} className="border border-[var(--line)] rounded-lg p-2.5">
            <div className="flex items-center gap-2 flex-wrap text-sm">
              <Badge tone="">{it.kind}</Badge>
              <span className="flex-1 min-w-0 truncate font-medium">{it.name}</span>
              <span className="text-[11px] text-[var(--faint)]">v{it.version}</span>
              {it.payloadKey ? <span className="text-[11px] text-[var(--faint)] flex items-center gap-1"><HardDrive size={11} /> {fmtBytes(it.payloadSize)}</span> : it.downloadUrl && <a href={it.downloadUrl} target="_blank" rel="noreferrer" className="text-[11px] underline text-[var(--muted)] truncate max-w-[180px]">{t('cc.ex.exturl', 'external URL')}</a>}
              {it.payloadKey && <><Button size="sm" variant="ghost" onClick={() => doInspect(it)}><FileText size={12} /> {t('cc.ex.inspect', 'Inspect')}</Button><Button size="sm" variant="ghost" onClick={() => dl(it)}><Download size={12} /></Button></>}
            </div>
            {openItem === it.id && <div className="mt-2 pt-2 border-t border-[var(--line)] text-xs">
              {inspect?.loading ? <Loading /> : inspect?.error ? <p className="text-error">{inspect.error}</p> : inspect?.data ? (
                inspect.data.type === 'zip' ? <div className="space-y-1">
                  {inspect.data.entries.map((e) => (
                    <div key={e.name}>
                      <div className="flex items-center gap-2">
                        <button onClick={() => setOpenEntry(openEntry === e.name ? null : (e.text != null ? e.name : null))} className={`flex-1 min-w-0 truncate text-left ${e.text != null ? 'hover:text-[var(--primary)]' : 'cursor-default'}`}>{e.text != null && <ChevronDown size={11} className={`inline mr-1 transition-transform ${openEntry === e.name ? '' : '-rotate-90'}`} />}{e.name}</button>
                        <span className="text-[var(--faint)] tabular-nums">{fmtBytes(e.size)}</span>
                        <button onClick={() => dl(it, e.name)} className="text-[var(--faint)] hover:text-[var(--primary)]"><Download size={11} /></button>
                      </div>
                      {openEntry === e.name && e.text != null && <pre className="mt-1 mb-2 p-2 rounded bg-[var(--bg)] border border-[var(--line)] overflow-auto max-h-72 whitespace-pre-wrap break-words text-[11px] leading-relaxed">{e.text}</pre>}
                    </div>
                  ))}
                </div> : (
                  inspect.data.text != null
                    ? <pre className="p-2 rounded bg-[var(--bg)] border border-[var(--line)] overflow-auto max-h-72 whitespace-pre-wrap break-words text-[11px] leading-relaxed">{inspect.data.text}</pre>
                    : <p className="text-[var(--faint)]">{t('cc.ex.binary', 'Binary file — download to inspect.')} ({fmtBytes(inspect.data.size)})</p>
                )
              ) : null}
            </div>}
          </div>
        ))}
      </div> : <EmptyState icon={Package} title={t('cc.ex.none.t', 'No items')} sub={t('cc.ex.none.s', 'This catalog has no hosted items yet.')} />}
    </Modal>
  );
}

// Admin: create & manage profile badges (verified, developer, moderator, YouTuber, Twitch,
// certified, …). Badges can be a lucide icon, a brand/image URL or a data URI; manual ones
// are granted to users by id/email, easter-egg ones are self-claimed via a trigger.
const BADGE_BLANK = { name: '', description: '', iconType: 'lucide', icon: 'BadgeCheck', color: '#f59e0b', grant: 'manual', trigger: '', earnMessage: '', priority: 0, active: true };
function AdminBadges() {
  const { t } = useI18n(); const toast = useToast();
  const { data, loading, reload } = useAsync(() => api.get('/admin/badges'), []);
  const undo = useUndoableDelete(reload);
  const [edit, setEdit] = useState(null); // badge being edited, or BADGE_BLANK for new
  const [holdersOf, setHoldersOf] = useState(null);
  const [iconPick, setIconPick] = useState(false);
  const badges = (data?.badges || []).filter((b) => !undo.pending.has(b.id));
  // The shared icon picker returns a lucide kebab name, or "simple:<slug>" for a brand.
  const onPickIcon = (v) => setEdit((e) => v.startsWith('simple:') ? { ...e, iconType: 'brand', icon: v.slice(7) } : { ...e, iconType: 'lucide', icon: v });
  const undoSave = useUndoableSave(reload);
  const save = () => {
    if (!edit.name.trim()) return toast.error(t('ab.namereq', 'Name required.'));
    const body = { ...edit, trigger: edit.grant === 'manual' ? null : (edit.trigger || null) };
    const id = edit.id;                 // captured: `edit` is swapped when another badge is opened
    setEdit(null);                      // the editor closes now; Undo leaves the list untouched
    undoSave(() => (id ? api.patch(`/admin/badges/${id}`, body) : api.post('/admin/badges', body)),
      t('ab.saved', 'Badge saved.'),
      { errorFor: (x) => x.data?.error === 'trigger_taken' ? t('ab.triggertaken', 'Another badge already uses that trigger.') : (x.data?.error || t('acc.failed', 'Failed.')) });
  };
  const del = (b) => undo.del(b.id, () => api.del(`/admin/badges/${b.id}`), t('ab.deleted', 'Badge deleted.'));
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div><h2 className="font-semibold flex items-center gap-2"><BadgeCheck size={16} className="text-[var(--primary-2)]" /> {t('ab.title', 'Badges')}</h2>
          <p className="text-sm text-[var(--muted)]">{t('ab.desc', 'Profile badges shown next to a member’s name. Grant manual badges to users, or set up an easter-egg badge users can unlock.')}</p></div>
        <Button size="sm" variant="primary" onClick={() => setEdit({ ...BADGE_BLANK })}><Plus size={14} /> {t('ab.new', 'New badge')}</Button>
      </div>
      {loading ? <Loading /> : badges.length ? <div className="space-y-1.5">
        {badges.map((b) => (
          <Card key={b.id} className="p-3 flex items-center gap-3 flex-wrap">
            <span className="grid place-items-center w-9 h-9 rounded-lg shrink-0" style={{ background: `color-mix(in srgb, ${b.color} 16%, transparent)` }}><BadgeIcon badge={b} size={18} /></span>
            <div className="flex-1 min-w-0">
              <div className="font-medium flex items-center gap-2 flex-wrap min-w-0"><span className="truncate min-w-0">{b.name}</span> {!b.active && <Badge tone="">{t('ab.inactive', 'inactive')}</Badge>}<Badge tone={b.grant === 'easter_egg' ? 'amber' : b.grant === 'auto' ? 'info' : ''}>{b.grant}{b.trigger ? `:${b.trigger}` : ''}</Badge></div>
              <div className="text-xs text-[var(--faint)] truncate">{b.description || '—'} · {b.holders} {t('ab.holders', 'holders')}</div>
            </div>
            <Button size="sm" variant="ghost" onClick={() => setHoldersOf(b)}><Users size={13} /> {t('ab.grant', 'Grant')}</Button>
            <Button size="sm" variant="ghost" onClick={() => setEdit({ ...BADGE_BLANK, ...b, trigger: b.trigger || '' })}><PenSquare size={13} /></Button>
            <Button size="sm" variant="ghost" className="!text-error" onClick={() => del(b)}><Trash2 size={13} /></Button>
          </Card>
        ))}
      </div> : <EmptyState icon={BadgeCheck} title={t('ab.none.t', 'No badges yet')} sub={t('ab.none.s', 'Create your first badge — verified, developer, content creator…')} />}

      {edit && <Modal open onClose={() => setEdit(null)} title={edit.id ? t('ab.edit', 'Edit badge') : t('ab.new', 'New badge')} icon={BadgeCheck} width="max-w-lg"
        footer={<><Button variant="ghost" onClick={() => setEdit(null)}>{t('common.cancel', 'Cancel')}</Button><Button variant="primary" onClick={save}>{t('common.save', 'Save')}</Button></>}>
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <span className="grid place-items-center w-12 h-12 rounded-xl shrink-0" style={{ background: `color-mix(in srgb, ${edit.color} 16%, transparent)` }}><BadgeIcon badge={edit} size={24} /></span>
            <Field label={t('ab.name', 'Name')} className="flex-1"><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="Verified" /></Field>
          </div>
          <Field label={t('ab.description', 'Description (tooltip)')}><Input value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} placeholder={t('ab.desc.ph', 'Certified by the BetterCommunity team')} /></Field>
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label={t('ab.icontype', 'Icon type')}><Select value={edit.iconType} onChange={(e) => setEdit({ ...edit, iconType: e.target.value })}><option value="lucide">{t('ab.it.lucide', 'Lucide icon')}</option><option value="brand">{t('ab.it.brand', 'Brand (Simple Icons)')}</option><option value="image">{t('ab.it.image', 'Image (URL or data URI)')}</option></Select></Field>
            <Field label={edit.iconType === 'image' ? t('ab.iconurl', 'Image URL / data URI') : t('ab.iconname2', 'Icon')}>
              {edit.iconType === 'image'
                ? <Input value={edit.icon} onChange={(e) => setEdit({ ...edit, icon: e.target.value })} placeholder="https://…/icon.svg" />
                : <Button variant="default" className="!w-full !justify-start" onClick={() => setIconPick(true)}><Sparkles size={14} /> {t('ab.pickicon', 'Pick an icon')} <span className="text-[var(--faint)] font-mono ml-1 truncate">{edit.icon}</span></Button>}
            </Field>
          </div>
          {edit.iconType !== 'image' && <p className="text-[11px] text-[var(--faint)] -mt-1">{t('ab.pickhint', 'Search every Lucide icon + every Simple Icons brand (YouTube, Twitch, Steam, GitHub…).')}</p>}
          <div className="grid sm:grid-cols-3 gap-3">
            <Field label={t('ab.color', 'Colour')}><Input type="color" value={edit.color} onChange={(e) => setEdit({ ...edit, color: e.target.value })} className="!p-1 h-9" /></Field>
            <Field label={t('ab.priority', 'Priority')}><Input type="number" min="0" value={edit.priority} onChange={(e) => setEdit({ ...edit, priority: Math.max(0, Number(e.target.value) || 0) })} /></Field>
            <Field label={t('ab.grantmode', 'How earned')}><Select value={edit.grant} onChange={(e) => setEdit({ ...edit, grant: e.target.value })}><option value="manual">{t('ab.manual', 'Manual (staff grant)')}</option><option value="easter_egg">{t('ab.easter', 'Easter egg (self-claim)')}</option><option value="auto">{t('ab.auto', 'Automatic (rule)')}</option></Select></Field>
          </div>
          {edit.grant === 'easter_egg' && <>
            <Field label={t('ab.trigger', 'Trigger key')}><Input value={edit.trigger} onChange={(e) => setEdit({ ...edit, trigger: e.target.value })} placeholder="footer5x" /></Field>
            <p className="text-[11px] text-[var(--faint)] -mt-1">{t('ab.triggerhint', 'Use "footer5x" for the footer "Built for the Better* community" 5-click secret.')}</p>
            <Field label={t('ab.earnmsg', 'Reveal message')}><Textarea value={edit.earnMessage} onChange={(e) => setEdit({ ...edit, earnMessage: e.target.value })} placeholder={t('ab.earnmsg.ph', 'Shown in the reveal modal when a user finds it.')} /></Field>
          </>}
          {edit.grant === 'auto' && (() => { const rule = edit.rule || { type: 'signup_nth', every: 100 }; const setRule = (r) => setEdit({ ...edit, rule: r }); return <>
            <Field label={t('ab.rule', 'Auto-grant rule')}><Select value={rule.type} onChange={(e) => setRule({ type: e.target.value, every: rule.every || 100, date: rule.date || '' })}>
              <option value="signup_nth">{t('ab.rule.nth', 'Every Nth signup (100th, 200th…)')}</option>
              <option value="signup_before">{t('ab.rule.before', 'Signed up before a date')}</option>
              <option value="kofi_donation">{t('ab.rule.kofi', 'Made a Ko-fi donation')}</option>
            </Select></Field>
            {rule.type === 'signup_nth' && <Field label={t('ab.rule.every', 'Grant every N signups')}><Input type="number" min="1" value={rule.every ?? 100} onChange={(e) => setRule({ ...rule, every: Math.max(1, Number(e.target.value) || 1) })} placeholder="100" /></Field>}
            {rule.type === 'signup_before' && <Field label={t('ab.rule.date', 'Before date (YYYY-MM-DD)')}><Input type="date" value={rule.date || ''} onChange={(e) => setRule({ ...rule, date: e.target.value })} /></Field>}
            <p className="text-[11px] text-[var(--faint)] -mt-1">{t('ab.rulehint', 'Granted automatically when the event fires — e.g. a badge for the 100th, 200th… member, early adopters, or Ko-fi supporters.')}</p>
          </>; })()}
          <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> {t('ab.active', 'Active')}</label>
        </div>
      </Modal>}

      {holdersOf && <AdminBadgeHolders badge={holdersOf} onClose={() => { setHoldersOf(null); reload(); }} />}
      {iconPick && <IconPicker title={t('ab.pickicon', 'Pick an icon')} onPick={onPickIcon} onClose={() => setIconPick(false)} />}
    </div>
  );
}

// Admin: grant/revoke a badge + see who holds it.
function AdminBadgeHolders({ badge, onClose }) {
  const { t } = useI18n(); const toast = useToast();
  const { data, loading, reload } = useAsync(() => api.get(`/admin/badges/${badge.id}/holders`), [badge.id]);
  const [who, setWho] = useState('');
  const holders = data?.holders || [];
  const grant = async () => {
    if (!who.trim()) return;
    const body = who.includes('@') ? { email: who.trim() } : { userId: who.trim() };
    try { const r = await api.post(`/admin/badges/${badge.id}/grant`, body); toast.success(t('ab.granted', 'Granted to {n}.').replace('{n}', r.displayName || who)); setWho(''); reload(); }
    catch (x) { toast.error(x.data?.error === 'no_such_user' ? t('ab.nouser', 'No user with that id/email.') : x.data?.error || t('acc.failed', 'Failed.')); }
  };
  const revoke = async (h) => { try { await api.del(`/admin/badges/${badge.id}/holders/${h.userId}`); reload(); } catch { toast.error(t('acc.failed', 'Failed.')); } };
  return (
    <Modal open onClose={onClose} title={t('ab.holders.t', 'Grant: {n}').replace('{n}', badge.name)} icon={Users} width="max-w-lg">
      <div className="flex items-end gap-2 mb-3">
        <Field label={t('ab.grantto', 'Grant to (user id or email)')} className="flex-1"><Input value={who} onChange={(e) => setWho(e.target.value)} placeholder="user@example.com" onKeyDown={(e) => e.key === 'Enter' && grant()} /></Field>
        <Button variant="primary" onClick={grant}><Plus size={14} /> {t('ab.grant', 'Grant')}</Button>
      </div>
      {loading ? <Loading /> : holders.length ? <div className="space-y-1 max-h-80 overflow-auto">
        {holders.map((h) => (
          <div key={h.userId} className="flex items-center gap-2 text-sm py-1.5 px-2 rounded-lg hover:bg-[var(--surface-2)]">
            <span className="flex-1 min-w-0 truncate">{h.displayName} <span className="text-[var(--faint)]">· {h.email}</span></span>
            <button onClick={() => revoke(h)} className="text-[var(--faint)] hover:text-error"><X size={14} /></button>
          </div>
        ))}
      </div> : <p className="text-sm text-[var(--faint)] text-center py-6">{t('ab.noholders', 'No one has this badge yet.')}</p>}
    </Modal>
  );
}

const REPORT_STATUS_TONE = { open: 'green', archived: 'amber', closed: '' };
const REPORT_TARGET_ICON = { user: Users, repo: Server, catalog: Boxes, item: Package, general: MessageSquare };

// User dashboard: the reports / support threads this user opened, GitHub-PR style.
// Rendered by the MEMBER dashboard (pages/dashboard.jsx), never by this page — it lives
// here only because the old pages monolith was split this way. Exported so the dashboard
// imports it instead of referencing a bare identifier, which crashed the tab at render.
export function MyReports() {
  const { t } = useI18n();
  const { data, loading, reload } = useAsync(() => api.get('/me/reports'), []);
  const [openId, setOpenId] = useState(null);
  const [newOpen, setNewOpen] = useState(false);
  const reports = data?.reports || [];
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="font-semibold flex items-center gap-2"><MessageSquare size={16} className="text-[var(--primary-2)]" /> {t('mr.title', 'Reports & contact')}</h2>
          <p className="text-sm text-[var(--muted)]">{t('mr.sub', 'Reports you filed and support conversations. Replies from the team show up here.')}</p>
        </div>
        <Button size="sm" variant="primary" onClick={() => setNewOpen(true)}><Plus size={14} /> {t('mr.new2', 'New report / contact')}</Button>
      </div>
      {loading ? <Loading /> : reports.length ? <div className="space-y-1.5">
        {reports.map((r) => { const Ico = REPORT_TARGET_ICON[r.targetType] || MessageSquare; return (
          <button key={r.id} onClick={() => setOpenId(r.id)} className="w-full text-left"><Card className="p-3 flex items-center gap-3 card-hover">
            <span className="grid place-items-center w-9 h-9 rounded-lg bg-[var(--surface-2)] shrink-0"><Ico size={15} className="text-[var(--primary-2)]" /></span>
            <div className="flex-1 min-w-0">
              <div className="font-medium flex items-center gap-2 flex-wrap min-w-0"><span className="truncate min-w-0">{r.targetLabel || t('mr.general', 'Support request')}</span> <Badge tone={REPORT_STATUS_TONE[r.status]}>{r.status}</Badge>{r.userUnread && <Badge tone="red">{t('mr.new', 'new reply')}</Badge>}</div>
              <div className="text-xs text-[var(--faint)]">{t('mr.on', 'on {t}').replace('{t}', r.targetType)} · {r.messageCount} {t('mr.msgs', 'messages')} · {fmtAgo(r.lastActivityAt)}</div>
            </div>
          </Card></button>
        ); })}
      </div> : <EmptyState icon={MessageSquare} title={t('mr.none.t', 'No reports yet')} sub={t('mr.none.s', 'Use the Report button on a profile, repo or catalog — or start one here.')}><Button variant="primary" onClick={() => setNewOpen(true)}><Plus size={15} /> {t('mr.new2', 'New report / contact')}</Button></EmptyState>}
      {openId && <ReportThreadModal id={openId} admin={false} onClose={() => { setOpenId(null); reload(); }} />}
      {newOpen && <ReportModal targetType="general" targetId="" targetLabel="" onClose={() => { setNewOpen(false); reload(); }} />}
    </div>
  );
}

// Shared thread modal — user (admin=false) or staff (admin=true) view of one report.
function ReportThreadModal({ id, admin, onClose }) {
  const { t } = useI18n(); const toast = useToast(); const dialog = useDialog(); const { user } = useAuth();
  const base = admin ? `/admin/reports/${id}` : `/me/reports/${id}`;
  const { data, loading, reload } = useAsync(() => api.get(base), [id]);
  // Live thread. The stream lives under /me/ for BOTH views: canAccessReport already covers
  // staff, so there is no second authorisation path to keep in step with the first.
  useThreadStream(id ? `/me/reports/${id}/stream` : null, () => reload(true));
  const [sending, setSending] = useState(false);
  const [people, setPeople] = useState(false);
  const r = data?.report;
  // A staff member can't moderate a report they opened — they reply to it as the reporter
  // from their own dashboard instead (avoids the "answering myself as staff" confusion).
  const own = admin && r && r.reporterId === user?.id;
  const send = async ({ body, images }) => {
    setSending(true);
    try { await api.post(`${base}/messages`, { body, images }); reload(true); return true; }
    catch (x) { toast.error(x.data?.error === 'closed' ? t('mr.closed', 'This report is closed.') : t('acc.failed', 'Failed.')); return false; }
    finally { setSending(false); }
  };
  const setStatus = async (status) => { try { await api.post(`/admin/reports/${id}/status`, { status }); reload(true); } catch { toast.error(t('acc.failed', 'Failed.')); } };
  // The reporter's own close/reopen. Separate endpoint from the staff one, and narrower:
  // open <-> closed only. Someone who solved their own problem should be able to say so
  // without waiting for staff to clear the thread.
  const mine = r && r.reporterId === user?.id;
  const setOwnStatus = async (status) => { try { await api.post(`/me/reports/${id}/status`, { status }); reload(true); } catch { toast.error(t('acc.failed', 'Failed.')); } };
  const del = async () => { if (!(await dialog.confirm({ title: t('ar.del.t', 'Delete report?'), message: t('ar.del.m', 'Permanently delete this report and its messages?'), okLabel: t('common.delete', 'Delete'), danger: true }))) return; try { await api.del(`/admin/reports/${id}`); toast.success(t('ar.deleted', 'Deleted.')); onClose(); } catch { toast.error(t('acc.failed', 'Failed.')); } };
  return (
    <Modal open onClose={onClose} icon={admin ? Inbox : MessageSquare} width="max-w-2xl"
      title={loading ? t('common.loading', 'Loading…') : (r?.targetLabel || t('mr.general', 'Support request'))}>
      {loading || !r ? <Loading /> : <div className="space-y-4">
        <div className="flex items-center gap-2 flex-wrap text-xs text-[var(--muted)]">
          <Badge tone={REPORT_STATUS_TONE[r.status]}>{r.status}</Badge>
          <span>{t('mr.on', 'on {t}').replace('{t}', r.targetType)}{r.reason ? ` · ${r.reason}` : ''}</span>
          {/* Full report subject: the reported entity's id (repo id / catalog slug / user id) + when. */}
          {admin && r.targetId && <button onClick={() => { navigator.clipboard?.writeText(r.targetId); toast.success(t('ccp.copied', 'Copied.')); }} className="font-mono hover:text-[var(--primary)] inline-flex items-center gap-1" title={t('ar.targetid', 'Reported {t} id — click to copy').replace('{t}', r.targetType)}><Fingerprint size={11} /> {r.targetId} <Copy size={9} /></button>}
          {admin && <span className="flex items-center gap-1"><Calendar size={11} /> {new Date(r.createdAt).toLocaleString()}</span>}
          {admin && r.reporter && <span className="flex items-center gap-1"><Users size={12} /> {r.reporter} · {r.reporterEmail} {r.reporterBcId && <button onClick={() => { navigator.clipboard?.writeText(r.reporterBcId); toast.success(t('prof.bcidcopied', 'BC id copied.')); }} className="font-mono hover:text-[var(--primary)] inline-flex items-center gap-1"><Fingerprint size={11} /> {r.reporterBcId} <Copy size={9} /></button>}</span>}
        </div>
        {own && <div className="text-xs rounded-lg px-3 py-2 bg-warning-bg border border-warning-border text-warning flex items-center gap-2"><AlertTriangle size={14} /> {t('ar.ownreport', 'You opened this report — reply to it from your dashboard (Reports & contact), not as staff here.')}</div>}
        {admin && !own && <div className="flex flex-wrap gap-2">
          {r.status !== 'open' && <Button size="sm" variant="ghost" onClick={() => setStatus('open')}><RefreshCw size={13} /> {t('ar.reopen', 'Reopen')}</Button>}
          {r.status !== 'archived' && <Button size="sm" variant="ghost" onClick={() => setStatus('archived')}><Archive size={13} /> {t('ar.archive', 'Archive')}</Button>}
          {r.status !== 'closed' && <Button size="sm" variant="ghost" onClick={() => setStatus('closed')}><CheckCircle2 size={13} /> {t('ar.close', 'Close')}</Button>}
          <Button size="sm" variant="ghost" onClick={() => setPeople((v) => !v)}><Users size={13} /> {t('ar.people', 'People')}{r.participants?.length ? ` (${r.participants.length})` : ''}</Button>
          <Button size="sm" variant="ghost" className="!text-error" onClick={del}><Trash2 size={13} /> {t('common.delete', 'Delete')}</Button>
        </div>}
        {admin && !own && people && <ReportPeoplePanel report={r} onChange={reload} />}
        {/* The reporter's own controls — shown in the user view, and also to a staff member
            looking at a report they opened themselves (where the staff bar is hidden). */}
        {mine && !admin && <div className="flex flex-wrap gap-2">
          {r.status === 'closed'
            ? <Button size="sm" variant="ghost" onClick={() => setOwnStatus('open')}><RefreshCw size={13} /> {t('mr.reopen', 'Reopen my report')}</Button>
            : <Button size="sm" variant="ghost" onClick={() => setOwnStatus('closed')}><CheckCircle2 size={13} /> {t('mr.close', 'Close my report')}</Button>}
        </div>}
        <div className="max-h-[45vh] overflow-y-auto pr-1"><ReportThread messages={r.messages} /></div>
        {own ? null
          : r.status === 'closed' && !admin ? <p className="text-sm text-[var(--faint)] text-center py-2">{t('mr.closednote', 'This report is closed — reopen it above if you still need help.')}</p>
          : <ReportComposer onSend={send} sending={sending} placeholder={admin ? t('ar.reply', 'Reply as staff…') : t('rp.msgph', 'Write a message…')} />}
      </div>}
    </Modal>
  );
}

// Admin: manage who's in a report thread — add participants (by id/email/BC id, as staff or
// invited) and mint invite links (usage cap + optional lock to an account / email / creator id).
function ReportPeoplePanel({ report, onChange }) {
  const { t } = useI18n(); const toast = useToast();
  const [who, setWho] = useState(''); const [role, setRole] = useState('invited');
  const [inv, setInv] = useState({ maxUses: 1, targetType: 'any', targetValue: '', expiresInDays: '' });
  const add = async () => {
    if (!who.trim()) return;
    try { const rr = await api.post(`/admin/reports/${report.id}/participants`, { who: who.trim(), role }); toast.success(t('rpp.added', 'Added {n}.').replace('{n}', rr.name || who)); setWho(''); onChange(); }
    catch (x) { toast.error(x.data?.error === 'no_such_user' ? t('rpp.nouser', 'No user with that id/email/BC id.') : x.data?.error === 'already_reporter' ? t('rpp.isreporter', 'That’s the reporter.') : t('acc.failed', 'Failed.')); }
  };
  const rmPart = async (p2) => { try { await api.del(`/admin/reports/${report.id}/participants/${p2.userId}`); onChange(); } catch { toast.error(t('acc.failed', 'Failed.')); } };
  const mkInvite = async () => {
    try {
      const body = { maxUses: Number(inv.maxUses) || 0, targetType: inv.targetType, targetValue: inv.targetValue.trim() };
      if (inv.expiresInDays) body.expiresInDays = Number(inv.expiresInDays);
      const rr = await api.post(`/admin/reports/${report.id}/invites`, body);
      navigator.clipboard?.writeText(rr.invite.url); toast.success(t('rpp.invcopied', 'Invite link copied.')); onChange();
    } catch (x) { toast.error(x.data?.error === 'target_value_required' ? t('rpp.needtarget', 'Fill the target (account/email/creator id).') : t('acc.failed', 'Failed.')); }
  };
  const rmInvite = async (iv) => { try { await api.del(`/admin/reports/${report.id}/invites/${iv.id}`); onChange(); } catch { toast.error(t('acc.failed', 'Failed.')); } };
  return (
    <div className="rounded-xl border border-[var(--line)] p-3 space-y-3 bg-[var(--surface-2)]/40">
      {/* Participants */}
      <div>
        <div className="text-[11px] uppercase tracking-wider text-[var(--faint)] font-semibold mb-1.5">{t('rpp.participants', 'Participants')}</div>
        {report.participants?.length > 0 && <div className="space-y-1 mb-2">
          {report.participants.map((p2) => (
            <div key={p2.userId} className="flex items-center gap-2 text-sm">
              <Badge tone={p2.role === 'staff' ? 'amber' : ''}>{p2.role}</Badge>
              <span className="flex-1 min-w-0 truncate">{p2.name} <span className="text-[var(--faint)] text-xs">· {p2.email}</span></span>
              <button onClick={() => rmPart(p2)} className="text-[var(--faint)] hover:text-error"><X size={13} /></button>
            </div>
          ))}
        </div>}
        <div className="flex flex-wrap items-end gap-2">
          <Input className="flex-1 min-w-[160px]" placeholder={t('rpp.who', 'User id, email or BC id')} value={who} onChange={(e) => setWho(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
          <Select className="!w-auto" value={role} onChange={(e) => setRole(e.target.value)}><option value="invited">{t('rpp.invited', 'Invited user')}</option><option value="staff">{t('rpp.staff', 'Staff')}</option></Select>
          <Button size="sm" variant="default" onClick={add}><Plus size={13} /> {t('rpp.add', 'Add')}</Button>
        </div>
      </div>
      {/* Invite links */}
      <div className="pt-2 border-t border-[var(--line)]">
        <div className="text-[11px] uppercase tracking-wider text-[var(--faint)] font-semibold mb-1.5">{t('rpp.invites', 'Invite links')}</div>
        {report.invites?.length > 0 && <div className="space-y-1 mb-2">
          {report.invites.map((iv) => (
            <div key={iv.id} className="flex items-center gap-2 text-xs">
              <span className="flex-1 min-w-0 truncate font-mono">{iv.url}</span>
              <span className="text-[var(--faint)] shrink-0">{iv.maxUses === 0 ? '∞' : `${iv.uses}/${iv.maxUses}`}{iv.targetType !== 'any' ? ` · ${iv.targetType}` : ''}</span>
              <button onClick={() => { navigator.clipboard?.writeText(iv.url); toast.success(t('ccp.copied', 'Copied.')); }} className="text-[var(--faint)] hover:text-[var(--primary)]"><Copy size={12} /></button>
              <button onClick={() => rmInvite(iv)} className="text-[var(--faint)] hover:text-error"><X size={12} /></button>
            </div>
          ))}
        </div>}
        <div className="grid sm:grid-cols-2 gap-2">
          <label className="text-xs text-[var(--muted)]">{t('rpp.maxuses', 'Max uses (0 = unlimited)')}<Input type="number" min="0" value={inv.maxUses} onChange={(e) => setInv({ ...inv, maxUses: e.target.value })} /></label>
          <label className="text-xs text-[var(--muted)]">{t('rpp.expires', 'Expires in days (blank = never)')}<Input type="number" min="1" value={inv.expiresInDays} onChange={(e) => setInv({ ...inv, expiresInDays: e.target.value })} /></label>
          <label className="text-xs text-[var(--muted)]">{t('rpp.lockto', 'Lock to')}<Select value={inv.targetType} onChange={(e) => setInv({ ...inv, targetType: e.target.value })}><option value="any">{t('rpp.anyone', 'Anyone with the link')}</option><option value="user">{t('rpp.anuser', 'A specific account (id)')}</option><option value="email">{t('rpp.anemail', 'An email')}</option><option value="creator">{t('rpp.acreator', 'A BMM creator id')}</option></Select></label>
          {inv.targetType !== 'any' && <label className="text-xs text-[var(--muted)]">{t('rpp.target', 'Target value')}<Input value={inv.targetValue} onChange={(e) => setInv({ ...inv, targetValue: e.target.value })} placeholder={inv.targetType === 'email' ? 'user@example.com' : inv.targetType === 'user' ? 'account id' : 'creator id'} /></label>}
        </div>
        <div className="mt-2"><Button size="sm" variant="default" onClick={mkInvite}><Link2 size={13} /> {t('rpp.mkinvite', 'Create invite link')}</Button></div>
      </div>
    </div>
  );
}

// Admin: the report / support queue. Filter by status; open a thread to reply + moderate.
function AdminReports() {
  const { t } = useI18n(); const { user } = useAuth();
  const [status, setStatus] = useState('open');
  const [openId, setOpenId] = useState(null);
  const [cfgOpen, setCfgOpen] = useState(false);
  const { data, loading, reload } = useAsync(() => api.get(`/admin/reports?status=${status}`), [status]);
  const reports = data?.reports || []; const counts = data?.counts || {};
  const STATUSES = [['open', t('ar.s.open', 'Open')], ['archived', t('ar.s.archived', 'Archived')], ['closed', t('ar.s.closed', 'Closed')]];
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div><h2 className="font-semibold flex items-center gap-2"><Inbox size={16} className="text-[var(--primary-2)]" /> {t('ar.title', 'Reports')}</h2>
          <p className="text-sm text-[var(--muted)]">{t('ar.sub', 'User reports and support threads. Reply, archive, close or delete.')}</p></div>
        <Button size="sm" variant="ghost" onClick={() => setCfgOpen(true)}><Settings2 size={14} /> {t('ar.settings', 'Settings')}</Button>
      </div>
      <div className="flex rounded-lg border border-[var(--line)] overflow-hidden w-fit">
        {STATUSES.map(([k, lbl]) => <button key={k} onClick={() => setStatus(k)} className={`px-3 py-1.5 text-sm ${status === k ? 'bg-[var(--surface-2)] text-[var(--text)] font-medium' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}>{lbl}{counts[k] ? <span className="ml-1.5 text-[10px] tabular-nums text-[var(--faint)]">{counts[k]}</span> : null}</button>)}
      </div>
      {loading ? <Loading /> : reports.length ? <div className="space-y-1.5">
        {reports.map((r) => { const Ico = REPORT_TARGET_ICON[r.targetType] || MessageSquare; return (
          <button key={r.id} onClick={() => setOpenId(r.id)} className="w-full text-left"><Card className="p-3 flex items-center gap-3 card-hover">
            <span className="grid place-items-center w-9 h-9 rounded-lg bg-[var(--surface-2)] shrink-0"><Ico size={15} className="text-[var(--primary-2)]" /></span>
            <div className="flex-1 min-w-0">
              <div className="font-medium flex items-center gap-2 flex-wrap min-w-0"><span className="truncate min-w-0">{r.targetLabel || t('mr.general', 'Support request')}</span> {r.staffUnread && <Badge tone="red">{t('ar.unread', 'new')}</Badge>}{r.reporterId === user?.id && <Badge tone="amber">{t('ar.yours', 'your report')}</Badge>}<Badge tone="">{r.reason || r.targetType}</Badge></div>
              <div className="text-xs text-[var(--faint)] truncate flex items-center gap-2 flex-wrap"><span className="flex items-center gap-1"><Users size={11} /> {r.reporter}</span>{r.reporterBcId && <span className="font-mono flex items-center gap-1"><Fingerprint size={10} /> {r.reporterBcId}</span>}<span>· {r.messageCount} {t('mr.msgs', 'messages')} · {fmtAgo(r.lastActivityAt)}</span></div>
            </div>
          </Card></button>
        ); })}
      </div> : <EmptyState icon={Inbox} title={t('ar.none.t', 'Nothing here')} sub={t('ar.none.s', 'No reports with this status.')} />}
      {openId && <ReportThreadModal id={openId} admin onClose={() => { setOpenId(null); reload(); }} />}
      {cfgOpen && <AdminReportsConfig onClose={() => setCfgOpen(false)} />}
    </div>
  );
}

function AdminReportsConfig({ onClose }) {
  const { t } = useI18n(); const toast = useToast();
  const { data, loading } = useAsync(() => api.get('/admin/reports/config'), []);
  const [f, setF] = useState(null);
  useEffect(() => { if (data?.config) setF(data.config); }, [data]);
  // Snapshot the form before deferring: this modal closes immediately, and `f` would be gone
  // (or reset) by the time the window elapses.
  const undoSave = useUndoableSave();
  const save = () => {
    const body = { imageMaxMB: Number(f.imageMaxMB), maxImagesPerMsg: Number(f.maxImagesPerMsg), archiveDays: Number(f.archiveDays), deleteDays: Number(f.deleteDays), archiveEnabled: !!f.archiveEnabled, deleteEnabled: !!f.deleteEnabled, maxOpenPerUser: Number(f.maxOpenPerUser), maxPerDay: Number(f.maxPerDay) };
    onClose();
    undoSave(() => api.put('/admin/reports/config', body), t('arc.saved', 'Settings saved.'));
  };
  return (
    <Modal open onClose={onClose} title={t('arc.title', 'Report settings')} icon={Settings2} width="max-w-md"
      footer={<><Button variant="ghost" onClick={onClose}>{t('common.cancel', 'Cancel')}</Button><Button variant="primary" onClick={save} disabled={!f}>{t('common.save', 'Save')}</Button></>}>
      {loading || !f ? <Loading /> : <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('arc.imgmb', 'Max image size (MB)')}><Input type="number" min="1" max="50" value={f.imageMaxMB} onChange={(e) => setF({ ...f, imageMaxMB: e.target.value })} /></Field>
          <Field label={t('arc.imgcount', 'Images per message')}><Input type="number" min="1" max="20" value={f.maxImagesPerMsg} onChange={(e) => setF({ ...f, maxImagesPerMsg: e.target.value })} /></Field>
          <Field label={t('arc.archdays', 'Auto-archive after (days idle)')}><Input type="number" min="1" value={f.archiveDays} onChange={(e) => setF({ ...f, archiveDays: e.target.value })} /></Field>
          <Field label={t('arc.deldays', 'Delete after (days archived)')}><Input type="number" min="1" value={f.deleteDays} onChange={(e) => setF({ ...f, deleteDays: e.target.value })} /></Field>
          <Field label={t('arc.maxopen', 'Max open reports / user (0 = off)')}><Input type="number" min="0" value={f.maxOpenPerUser} onChange={(e) => setF({ ...f, maxOpenPerUser: e.target.value })} /></Field>
          <Field label={t('arc.maxday', 'Max new reports / user / day (0 = off)')}><Input type="number" min="0" value={f.maxPerDay} onChange={(e) => setF({ ...f, maxPerDay: e.target.value })} /></Field>
        </div>
        <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={f.archiveEnabled} onChange={(e) => setF({ ...f, archiveEnabled: e.target.checked })} /> {t('arc.archen', 'Auto-archive idle reports')}</label>
        <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={f.deleteEnabled} onChange={(e) => setF({ ...f, deleteEnabled: e.target.checked })} /> {t('arc.delen', 'Auto-delete old archived reports')}</label>
      </div>}
    </Modal>
  );
}

// Admin: what actually fills the Free-plan pool — every $0-provisioned pool/repo with
// its owner. Makes the gauge auditable instead of a black box (root of the "70/10 GB
// while empty" confusion: admin/promo repos used to be miscounted as free-plan usage).
// Everything currently waiting on a human, in one tab.
//
// Its counts come from the server, which filters every queue by the capability that lets you
// ACT on it — so a moderator is never shown a backlog they cannot touch, and a zero here
// means "nothing for you", not "nothing at all".
//
// A count of `null` means that queue's query failed. It is rendered as "—", deliberately
// distinct from 0: a broken query that displays a reassuring zero is worse than one that
// admits it does not know.
// The labels are functions rather than [key, fallback] pairs on purpose: i18n-check finds
// keys by matching the literal text `t('...'`, so a key passed as data — or built from a
// template string — is invisible to it and would sit in English forever with nothing to
// flag it. Written this way, every key below is seen and required to have a French entry.
const NEEDS_QUEUES = [
  { key: 'submissions', to: '/admin?s=moderation', icon: Inbox, label: (t) => t('nq.submissions', 'Submissions to review'), chip: (t) => t('nq.k.submissions', 'Submission') },
  { key: 'reports', to: '/admin?s=reports', icon: Inbox, label: (t) => t('nq.reports', 'Open reports'), chip: (t) => t('nq.k.reports', 'Report') },
  { key: 'contact', to: '/admin?s=messages', icon: Mail, label: (t) => t('nq.contact', 'Unread messages'), chip: (t) => t('nq.k.contact', 'Message') },
  { key: 'myo', to: '/admin?s=myo', icon: Wand2, label: (t) => t('nq.myo', 'Commissions awaiting a reply'), chip: (t) => t('nq.k.myo', 'Commission') },
];

function AdminNeedsAttention({ data, loading, onReload }) {
  const { t } = useI18n(); const toast = useToast();
  const counts = data?.counts || {};
  // Rows on their way out are gone from the list already — that IS the undo affordance.
  // Keeping them visible until the request lands would make Undo look like it did nothing.
  const [pendingOut, setPendingOut] = useState(() => new Set());
  const items = (data?.items || []).filter((it) => !pendingOut.has(`${it.queue}::${it.id}`));

  // The house undo window: the row leaves now, the write happens when the toast expires, and
  // cancelling puts it back without ever having touched the server.
  const dismiss = (it, mode) => {
    const key = `${it.queue}::${it.id}`;
    setPendingOut((s) => new Set(s).add(key));
    toast.action({
      tone: 'success', cancelLabel: t('common.undo', 'Undo'),
      msg: mode === 'handled'
        ? t('nq.handled', 'Marked as dealt with.')
        : t('nq.archived', 'Archived — it stays in its queue.'),
      onCommit: async () => {
        try { await api.post('/admin/pending/dismiss', { queue: it.queue, itemId: String(it.id), mode }); onReload?.(); }
        catch { toast.error(t('common.failed', 'Failed.')); }
        finally { setPendingOut((s) => { const n = new Set(s); n.delete(key); return n; }); }
      },
      onCancel: () => setPendingOut((s) => { const n = new Set(s); n.delete(key); return n; }),
    });
  };
  // Only the queues this account can act on come back from the server.
  const shown = NEEDS_QUEUES.filter((q) => q.key in counts);

  return (
    <div>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <h2 className="font-semibold flex items-center gap-2 flex-1"><BellIcon size={16} className="text-[var(--primary-2)]" /> {t('adm.tab.needs', 'Needs attention')}</h2>
        <Button size="sm" variant="ghost" onClick={() => onReload?.()}><RefreshCw size={13} /> {t('common.refresh', 'Refresh')}</Button>
      </div>

      {loading && !data ? <Loading /> : (
        <>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2.5 mb-4">
            {shown.map((q) => {
              const n = counts[q.key];
              return (
                <Link key={q.key} to={q.to}>
                  <Card className={`p-3.5 h-full transition-colors ${n > 0 ? 'border-[var(--primary)]/40' : ''} hover:border-[var(--primary)]`}>
                    <div className="flex items-center gap-2 text-xs text-[var(--muted)] mb-1"><q.icon size={13} /> {q.label(t)}</div>
                    <div className={`text-2xl font-semibold tabular-nums ${n > 0 ? 'text-[var(--primary-2)]' : 'text-[var(--faint)]'}`}>
                      {n == null ? '—' : n}
                    </div>
                  </Card>
                </Link>
              );
            })}
          </div>

          {items.length === 0 ? (
            <EmptyState icon={CheckCircle2} title={t('nq.clear.t', 'Nothing waiting')}
              sub={data?.dismissed ? t('nq.clear.s2', 'Everything left has been ticked off this list. The queues themselves still hold {n} item(s) — clearing a row here never closes the work.').replace('{n}', String(data.total || 0)) : t('nq.clear.s', 'Every queue you can act on is empty.')} />
          ) : (
            <Card className="divide-y divide-[var(--line)] overflow-hidden">
              {items.map((it) => (
                <div key={`${it.queue}-${it.id}`} className="flex items-start gap-3 p-3 hover:bg-[var(--surface-2)] group">
                  <Link to={it.to} className="flex items-start gap-3 min-w-0 flex-1">
                    <Badge tone="">{NEEDS_QUEUES.find((q) => q.key === it.queue)?.chip(t) || it.queue}</Badge>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{it.title}</div>
                      {it.sub && <div className="text-xs text-[var(--muted)] truncate">{it.sub}</div>}
                    </div>
                  </Link>
                  <span className="text-[11px] text-[var(--faint)] shrink-0">{fmtAgo(it.at)}</span>
                  {/* Clearing a row out of THIS list. The queue count above does not move,
                      because the work has not — that number is the one staff trust, and a
                      to-do list anybody can tick off is not a count. */}
                  <span className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition">
                    <button onClick={() => dismiss(it, 'handled')} title={t('nq.handled.h', 'Dealt with — take it off this list')}
                      className="text-[var(--faint)] hover:text-success"><CheckCircle2 size={14} /></button>
                    <button onClick={() => dismiss(it, 'archived')} title={t('nq.archived.h', 'Not going to act on it — take it off this list')}
                      className="text-[var(--faint)] hover:text-[var(--primary-2)]"><Archive size={14} /></button>
                  </span>
                </div>
              ))}
            </Card>
          )}
        </>
      )}
    </div>
  );
}

// Admin: the site footer — columns, links, and what shows on which device.
//
// Same shape as the topbar manager: an optional config that REPLACES the built-in footer only
// when it is enabled AND has columns. Leave it off and the hardcoded footer stands, so turning
// this on can never leave the site without one.
// Copy fields of the footer newsletter box, and the placeholder for the copyright line.
// Kept out of the component so the JSX stays readable.
const NEWS_FIELDS = [
  ['title', 'Title'], ['titleFr', 'Title (FR)'],
  ['placeholder', 'Input placeholder'], ['placeholderFr', 'Placeholder (FR)'],
  ['button', 'Button'], ['buttonFr', 'Button (FR)'],
  ['text', 'Blurb', '!w-72'], ['textFr', 'Blurb (FR)', '!w-72'],
];
const COPY_PH = '\u00a9 {year} BetterCommunity. ...';

// One social icon, as the footer will actually draw it — or a visible failure.
// The four bundled brand marks are drawn from a data URL by name; anything else is a
// lucide icon fetched from the CDN, and that fetch can 404 silently.
function SocialIconPreview({ icon }) {
  const { t } = useI18n();
  const [bad, setBad] = useState(false);
  const key = String(icon || '').trim().toLowerCase();
  useEffect(() => { setBad(false); }, [key]);
  const bundled = ['github', 'discord', 'reddit', 'kofi'].includes(key);
  if (!key) return <span className="w-7 h-7 shrink-0 rounded-lg border border-dashed border-[var(--line)]" />;
  if (bundled) {
    return (
      <span title={t('afoot.icon.bundled', 'Built-in brand icon')}
        className="w-7 h-7 shrink-0 grid place-items-center rounded-lg border border-[var(--line)] text-[10px] font-bold uppercase text-[var(--primary-2)]">
        {key.slice(0, 2)}
      </span>
    );
  }
  return (
    <span className={`w-7 h-7 shrink-0 grid place-items-center rounded-lg border ${bad ? 'border-error-border bg-error-bg' : 'border-[var(--line)]'}`}
      title={bad ? t('afoot.icon.bad', 'No lucide icon with that name — it would render as an empty space.') : key}>
      {bad
        ? <AlertTriangle size={13} className="text-error" />
        : <img src={`https://cdn.jsdelivr.net/npm/lucide-static@latest/icons/${encodeURIComponent(lucideFileName(key))}.svg`}
            alt="" width={15} height={15} onError={() => setBad(true)} />}
    </span>
  );
}

function AdminFooter() {
  const { t, lang } = useI18n(); const toast = useToast(); const dialog = useDialog();
  const { data, loading, reload } = useAsync(() => api.get('/admin/footer'), []);
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  const [device, setDevice] = useState('desktop');
  useEffect(() => { if (data?.footer) setF({ columns: [], brand: {}, mobile: {}, bottom: {}, ...data.footer }); }, [data]);
  if (loading || !f) return <Loading />;

  // Start from the footer the site actually ships rather than from nothing. Opening this page
  // used to give an empty list, so "customise the footer" meant rebuilding all three columns
  // and nineteen links by hand — and getting one wrong meant quietly losing it. The columns
  // come from ui/footer-default.js, the same definition <Footer/> renders, so what you load
  // here is what visitors see today.
  const loadBuiltIn = async () => {
    if (f.columns.length && !(await dialog.confirm({
      title: t('afoot.load.t', 'Replace what is here?'),
      message: t('afoot.load.m', 'Loads the built-in footer over your current columns. Nothing is saved until you press Save.'),
      okLabel: t('afoot.load.ok', 'Load'),
    }))) return;
    setF({ ...f, ...defaultFooterConfig(t) });
    toast.success(t('afoot.loaded', 'Built-in footer loaded — edit it, then Save.'));
  };

  // Hand the footer back to the site. Clearing the config rather than writing the built-in
  // columns into it is the difference between "the site's footer" and "a copy of it frozen on
  // the day you pressed the button": a link added to the built-in footer later would never
  // reach a saved copy.
  const resetToBuiltIn = async () => {
    if (!(await dialog.confirm({
      title: t('afoot.reset.t', 'Back to the built-in footer?'),
      message: t('afoot.reset.m', 'Discards this custom footer. The site goes back to its built-in one, which stays up to date on its own. Applies immediately.'),
      okLabel: t('afoot.reset.ok', 'Reset'),
      danger: true,
    }))) return;
    const blank = { enabled: false, columns: [], brand: {}, mobile: {}, bottom: {} };
    setBusy(true);
    try {
      await api.put('/admin/footer', blank);
      setF(blank);
      toast.success(t('afoot.resetdone', 'Back to the built-in footer.'));
      reload();
    } catch (x) { toast.error(x.data?.detail || x.data?.error || t('common.failed', 'Failed.')); }
    finally { setBusy(false); }
  };

  const frOr = (v, base) => (lang === 'fr' && v && v.trim()) ? v : base;
  const setCol = (i, patch) => setF({ ...f, columns: f.columns.map((c, n) => (n === i ? { ...c, ...patch } : c)) });
  const setLink = (ci, li, patch) => setCol(ci, { links: f.columns[ci].links.map((l, n) => (n === li ? { ...l, ...patch } : l)) });
  const move = (arr, i, d) => { const a = [...arr]; const j = i + d; if (j < 0 || j >= a.length) return a; [a[i], a[j]] = [a[j], a[i]]; return a; };
  const setBrand = (patch) => setF({ ...f, brand: { ...f.brand, ...patch } });
  const setBottom = (patch) => setF({ ...f, bottom: { ...f.bottom, ...patch } });
  // `socials` and `newsletter` each have THREE stored shapes — absent, a boolean (what the
  // first version of this config saved), or the value itself. Normalise once here so the
  // editor never branches on it and never writes back a shape the live footer would not
  // understand. Dropping the boolean case would blank the socials of every saved footer.
  const socialsRaw = f.brand?.socials;
  const socialList = Array.isArray(socialsRaw) ? socialsRaw : (socialsRaw === false ? [] : DEFAULT_FOOTER_SOCIALS);
  const setSocial = (i, patch) => setBrand({ socials: socialList.map((x, n) => (n === i ? { ...x, ...patch } : x)) });
  const rawNews = f.brand?.newsletter;
  const news = (rawNews && typeof rawNews === 'object') ? rawNews : { on: rawNews !== false };

  // Written immediately, for the same reason as the site theme above: with a deferred
  // commit the toast's × and its Undo are one action, so dismissing the notification threw
  // the save away. Save means save.
  const save = () => commitSave(f);
  const commitSave = async (body) => {
    setBusy(true);
    try {
      await api.put('/admin/footer', body);
      toast.success(!body.enabled
        ? t('afoot.saved.off', 'Saved — but “Use this footer” is off, so visitors still see the built-in one.')
        : !(body.columns || []).length
          ? t('afoot.saved.empty', 'Saved — no columns yet, so the built-in columns still show. Use “Start from the built-in footer”.')
          : t('afoot.saved', 'Footer saved.'));
      reload();
    } catch (x) { toast.error(x.data?.detail || x.data?.error || t('common.failed', 'Failed.')); }
    finally { setBusy(false); }
  };

  // The same `on` rule the live footer applies, so the preview cannot promise a link the
  // footer will drop.
  const shows = (item) => { const v = item?.on || 'both'; return v === 'both' || v === device; };
  const ON_OPTS = [['both', t('afoot.on.both', 'Both')], ['desktop', t('afoot.on.desktop', 'Desktop')], ['mobile', t('afoot.on.mobile', 'Mobile')]];

  return (
    <div>
      <div className="flex items-center gap-2 flex-wrap mb-1">
        <h2 className="font-semibold flex items-center gap-2 flex-1"><PanelTop size={16} className="text-[var(--primary-2)]" /> {t('adm.tab.footer', 'Footer')}</h2>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={!!f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} />
          {t('afoot.enabled', 'Use this footer')}
        </label>
        <Button variant="ghost" disabled={busy} onClick={loadBuiltIn}><LayoutGrid size={14} /> {t('afoot.loadbuiltin', 'Start from the built-in footer')}</Button>
        <Button variant="ghost" disabled={busy} onClick={resetToBuiltIn}><RotateCcw size={14} /> {t('afoot.resetbuiltin', 'Reset to default')}</Button>
        <Button variant="primary" disabled={busy} onClick={save}>{busy ? <Spinner /> : <><Save size={14} /> {t('common.save', 'Save')}</>}</Button>
      </div>
      {/* The two states in which this whole page is decorative. Both are legitimate and
          neither was visible: `enabled` off means the site ignores the config entirely, and
          an empty column list means the built-in columns stand. */}
      {(!f.enabled || !(f.columns || []).length) && (
        <Card className="p-3 mb-3 flex items-start gap-2.5" style={{ background: 'var(--warning-bg)', borderColor: 'var(--warning-border)' }}>
          <AlertTriangle size={16} className="text-warning shrink-0 mt-0.5" />
          <div className="text-sm flex-1">
            <div className="font-semibold text-warning">{t('afoot.inactive', 'Visitors are seeing the built-in footer')}</div>
            <div className="text-[var(--muted)] mt-0.5">
              {!f.enabled
                ? t('afoot.inactive.off', '“Use this footer” is off — nothing here is applied until you turn it on.')
                : t('afoot.inactive.empty', 'There are no columns, so the built-in ones stand. Start from the built-in footer and edit it.')}
            </div>
          </div>
          {!f.enabled
            ? <Button size="sm" variant="primary" onClick={() => setF({ ...f, enabled: true })}>{t('afoot.turnon', 'Turn it on')}</Button>
            : <Button size="sm" variant="primary" onClick={loadBuiltIn}>{t('afoot.loadbuiltin', 'Start from the built-in footer')}</Button>}
        </Card>
      )}
      <p className="text-sm text-[var(--muted)] mb-4">{t('afoot.sub', 'Columns, links, and what appears on phone versus desktop. Turned off, or with no columns, the site keeps its built-in footer — so this can never leave the page without one. Start from the built-in one and edit it, or build your own from scratch.')}</p>

      <Card className="p-4 mb-4 flex flex-wrap items-end gap-4">
        <div className="inline-flex rounded-lg border border-[var(--line)] p-0.5 text-xs">
          {[['desktop', t('afoot.on.desktop', 'Desktop')], ['mobile', t('afoot.on.mobile', 'Mobile')]].map(([k, label]) => (
            <button key={k} type="button" onClick={() => setDevice(k)}
              className={`px-2.5 py-1 rounded-md ${device === k ? 'bg-[var(--surface-2)] text-[var(--text)] font-medium' : 'text-[var(--muted)]'}`}>{label}</button>
          ))}
        </div>
        <Field label={t('afoot.name', 'Brand name')}><Input className="!w-44" value={f.brand?.name || ''} onChange={(e) => setBrand({ name: e.target.value })} placeholder="BetterCommunity" /></Field>
        <Field label={t('afoot.logo', 'Logo URL')}><Input className="!w-52 font-mono !text-xs" value={f.brand?.logo || ''} onChange={(e) => setBrand({ logo: e.target.value })} placeholder="/logo.png" /></Field>
        <Field label={t('afoot.tagline', 'Tagline')}><Input className="!w-56" value={f.brand?.tagline || ''} onChange={(e) => setBrand({ tagline: e.target.value })} placeholder={t('afoot.taglineph', 'Empty = the default')} /></Field>
        <Field label={t('afoot.taglinefr', 'Tagline (FR)')}><Input className="!w-56" value={f.brand?.taglineFr || ''} onChange={(e) => setBrand({ taglineFr: e.target.value })} /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.mobile?.brand !== false} onChange={(e) => setF({ ...f, mobile: { ...f.mobile, brand: e.target.checked } })} /> {t('afoot.mobilebrand', 'Brand block on phone')}</label>
        <Field label={t('afoot.mobilelayout', 'Phone layout')}>
          <Select className="!w-auto" value={f.mobile?.layout || 'stacked'} onChange={(e) => setF({ ...f, mobile: { ...f.mobile, layout: e.target.value } })}>
            <option value="stacked">{t('afoot.lay.stacked', 'Stacked')}</option>
            <option value="grid">{t('afoot.lay.grid', 'Two columns')}</option>
          </Select>
        </Field>
      </Card>

      {/* Social buttons. Stored three ways for back-compat (see the normaliser above). */}
      <Card className="p-4 mb-4">
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <div className="font-semibold text-sm flex-1">{t('afoot.socials', 'Social icons')}</div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={socialsRaw !== false} onChange={(e) => setBrand({ socials: e.target.checked ? socialList.map((x) => ({ ...x })) : false })} />
            {t('afoot.show', 'Show')}
          </label>
          {socialsRaw !== false && <Button size="sm" variant="ghost" onClick={() => setBrand({ socials: [...socialList, { icon: 'link', label: '', href: '' }] })}><Plus size={13} /> {t('afoot.addsocial', 'Add')}</Button>}
        </div>
        {socialsRaw !== false && (socialList.length === 0
          ? <div className="text-xs text-[var(--faint)]">{t('afoot.nosocial', 'No social buttons.')}</div>
          : <div className="space-y-1.5">
            {socialList.map((x, i) => (
              <div key={i} className="flex items-center gap-2 flex-wrap">
                {/* A live preview, because a bad icon name is otherwise INVISIBLE: the
                    renderer paints lucide icons as a CSS mask, and a mask whose URL 404s
                    draws nothing at all — an empty circle that looks exactly like a
                    working one. lucide dropped its brand marks, so `discord` and `reddit`
                    are 404s while `github` still resolves, which is a trap you cannot
                    reason your way out of. Now you see it fail while typing. */}
                <SocialIconPreview icon={x.icon} />
                <Input className="!w-28 !text-xs" value={x.icon || ''} onChange={(e) => setSocial(i, { icon: e.target.value })} placeholder="github" />
                <Input className="!w-36 !text-xs" value={x.label || ''} onChange={(e) => setSocial(i, { label: e.target.value })} placeholder={t('afoot.label', 'Label')} />
                <Input className="!w-72 !text-xs font-mono" value={x.href || ''} onChange={(e) => setSocial(i, { href: e.target.value })} placeholder="https://..." />
                <button onClick={() => setBrand({ socials: move(socialList, i, -1) })} className="text-[var(--faint)] hover:text-[var(--text)] px-1">&uarr;</button>
                <button onClick={() => setBrand({ socials: move(socialList, i, 1) })} className="text-[var(--faint)] hover:text-[var(--text)] px-1">&darr;</button>
                <button onClick={() => setBrand({ socials: socialList.filter((_, n) => n !== i) })} className="p-1 rounded text-error hover:bg-error-bg"><Trash2 size={12} /></button>
              </div>
            ))}
          </div>)}
        <p className="text-[11px] text-[var(--faint)] mt-2">{t('afoot.iconhint', 'github, discord, reddit, kofi, or any lucide icon name.')}</p>
      </Card>

      {/* Newsletter copy. Empty field = keep following the translated built-in string. */}
      <Card className="p-4 mb-4">
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <div className="font-semibold text-sm flex-1">{t('afoot.newsletter', 'Newsletter box')}</div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={news.on !== false} onChange={(e) => setBrand({ newsletter: { ...news, on: e.target.checked } })} />
            {t('afoot.show', 'Show')}
          </label>
        </div>
        {news.on !== false && <div className="flex flex-wrap gap-3">
          {NEWS_FIELDS.map(([k, lb, w]) => (
            <Field key={k} label={t('afoot.news.' + k.toLowerCase(), lb)}>
              <Input className={(w || '!w-48') + ' !text-xs'} value={news[k] || ''} onChange={(e) => setBrand({ newsletter: { ...news, [k]: e.target.value } })} placeholder={t('afoot.emptydefault', 'Empty = the default')} />
            </Field>
          ))}
        </div>}
      </Card>

      {/* Bottom bar. */}
      <Card className="p-4 mb-4 flex flex-wrap items-end gap-4">
        <div className="font-semibold text-sm w-full">{t('afoot.bottom', 'Bottom bar')}</div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.bottom?.copyright !== false} onChange={(e) => setBottom({ copyright: e.target.checked })} /> {t('afoot.copyright', 'Copyright line')}</label>
        <Field label={t('afoot.bottomtext', 'Text')}><Input className="!w-72 !text-xs" value={f.bottom?.text || ''} onChange={(e) => setBottom({ text: e.target.value })} placeholder={COPY_PH} /></Field>
        <Field label={t('afoot.bottomtextfr', 'Text (FR)')}><Input className="!w-72 !text-xs" value={f.bottom?.textFr || ''} onChange={(e) => setBottom({ textFr: e.target.value })} /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.bottom?.lang !== false} onChange={(e) => setBottom({ lang: e.target.checked })} /> {t('afoot.langpicker', 'Language picker')}</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.bottom?.egg !== false} onChange={(e) => setBottom({ egg: e.target.checked })} /> {t('afoot.egg', 'Easter egg')}</label>
        <p className="text-[11px] text-[var(--faint)] w-full">{t('afoot.yeartoken', 'Write {year} in the text and it becomes the current year, so the line stays right on 1 January.')}</p>
      </Card>

      <div className="space-y-3">
        {f.columns.map((c, ci) => (
          <Card key={ci} className={`p-3.5 ${shows(c) ? '' : 'opacity-50'}`}>
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <Input className="!w-44" value={c.title} onChange={(e) => setCol(ci, { title: e.target.value })} placeholder={t('afoot.coltitle', 'Column title')} />
              <Input className="!w-44" value={c.titleFr || ''} onChange={(e) => setCol(ci, { titleFr: e.target.value })} placeholder={t('afoot.coltitlefr', 'Title (FR)')} />
              <Select className="!w-auto" value={c.on || 'both'} onChange={(e) => setCol(ci, { on: e.target.value })}>{ON_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
              <div className="flex-1" />
              <button onClick={() => setF({ ...f, columns: move(f.columns, ci, -1) })} className="p-1.5 rounded-lg text-[var(--muted)] hover:text-[var(--text)]" aria-label="up">↑</button>
              <button onClick={() => setF({ ...f, columns: move(f.columns, ci, 1) })} className="p-1.5 rounded-lg text-[var(--muted)] hover:text-[var(--text)]" aria-label="down">↓</button>
              <button onClick={() => setF({ ...f, columns: f.columns.filter((_, n) => n !== ci) })} className="p-1.5 rounded-lg text-error hover:bg-error-bg"><Trash2 size={13} /></button>
            </div>
            <div className="space-y-1.5 pl-1">
              {(c.links || []).map((l, li) => (
                <div key={li} className={`flex items-center gap-2 flex-wrap ${shows(l) ? '' : 'opacity-50'}`}>
                  <Input className="!w-40 !text-xs" value={l.label} onChange={(e) => setLink(ci, li, { label: e.target.value })} placeholder={t('afoot.label', 'Label')} />
                  <Input className="!w-40 !text-xs" value={l.labelFr || ''} onChange={(e) => setLink(ci, li, { labelFr: e.target.value })} placeholder={t('afoot.labelfr', 'Label (FR)')} />
                  <Input className="!w-56 !text-xs font-mono" value={l.to} onChange={(e) => setLink(ci, li, { to: e.target.value })} placeholder="/blog — https://…" />
                  <Select className="!w-auto !text-xs" value={l.on || 'both'} onChange={(e) => setLink(ci, li, { on: e.target.value })}>{ON_OPTS.map(([v, lb]) => <option key={v} value={v}>{lb}</option>)}</Select>
                  <button onClick={() => setCol(ci, { links: move(c.links, li, -1) })} className="text-[var(--faint)] hover:text-[var(--text)] px-1">↑</button>
                  <button onClick={() => setCol(ci, { links: move(c.links, li, 1) })} className="text-[var(--faint)] hover:text-[var(--text)] px-1">↓</button>
                  <button onClick={() => setCol(ci, { links: c.links.filter((_, n) => n !== li) })} className="text-error px-1"><Trash2 size={12} /></button>
                </div>
              ))}
              <Button size="sm" variant="ghost" onClick={() => setCol(ci, { links: [...(c.links || []), { label: '', to: '/', on: 'both' }] })}><Plus size={13} /> {t('afoot.addlink', 'Add link')}</Button>
            </div>
          </Card>
        ))}
        <Button variant="default" onClick={() => setF({ ...f, columns: [...f.columns, { title: '', links: [], on: 'both' }] })}><Plus size={14} /> {t('afoot.addcol', 'Add column')}</Button>
      </div>

      <Card className="p-4 mt-4">
        <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-2.5">{t('afoot.preview', 'Preview')} — {device === 'mobile' ? t('afoot.on.mobile', 'Mobile') : t('afoot.on.desktop', 'Desktop')}</div>
        {!f.enabled || !f.columns.some((c) => shows(c) && (c.links || []).some(shows))
          ? <div className="text-sm text-[var(--muted)]">{t('afoot.fallback', 'The built-in footer is used.')}</div>
          : <div className={`grid gap-6 ${device === 'mobile' ? 'grid-cols-1 max-w-[22rem]' : 'sm:grid-cols-3'}`}>
              {f.columns.filter((c) => shows(c)).map((c, i) => {
                const links = (c.links || []).filter(shows);
                if (!links.length) return null;
                return (
                  <div key={i}>
                    <div className="text-xs font-semibold text-[var(--faint)] uppercase tracking-wider mb-2">{frOr(c.titleFr, c.title) || '—'}</div>
                    <div className="flex flex-col gap-1.5">
                      {links.map((l, n) => <span key={n} className="text-sm text-[var(--muted)]">{frOr(l.labelFr, l.label) || '—'}</span>)}
                    </div>
                  </div>
                );
              })}
            </div>}
      </Card>
    </div>
  );
}

// SUPERADMIN: the accent every visitor sees, in both light and dark.
//
// Deliberately small. The stylesheet defines ~40 tokens per mode; exposing all of them would
// be a way to make the site unreadable in one click. Light and dark share their accent (the
// dark block never redefines --primary), so one colour pair recolours both — which is what
// "theme the site" means here in practice.
//
// The preview is not a mock-up: it calls the SAME themeCss() the live site applies, scoped to
// a container, so what you see is what visitors get.
// What a token paints RIGHT NOW, read off the live document. `<input type="color">` only
// accepts `#rrggbb`, so anything the browser reports in another notation (rgb(), a colour
// name, a colour-mix() it could not resolve) is converted through a canvas — and anything
// still unresolvable falls back to grey rather than throwing.
function liveToken(name) {
  if (typeof window === 'undefined') return '#888888';
  try {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    if (!raw) return '#888888';
    if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw;
    if (/^#[0-9a-fA-F]{3}$/.test(raw)) return '#' + [...raw.slice(1)].map((c) => c + c).join('');
    const cv = document.createElement('canvas').getContext('2d');
    cv.fillStyle = '#888888';
    cv.fillStyle = raw;              // invalid values leave the previous one in place
    return cv.fillStyle;
  } catch { return '#888888'; }
}

function AdminSiteTheme() {
  const { t, lang } = useI18n(); const toast = useToast(); const dialog = useDialog();
  const { data, loading, reload } = useAsync(() => api.get('/theme'), []);
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  // Which set of tokens is on screen. 'shared' holds the accent (light and dark use the same
  // one); 'light'/'dark' hold everything the two modes define differently.
  const [scope, setScope] = useState('shared');
  // The token catalogue carries its own {en,fr} strings rather than i18n keys: they describe
  // what a token PAINTS, they live next to the token list, and adding a token should not mean
  // remembering to add two dictionary entries somewhere else.
  const tGroup = (o) => (lang === 'fr' ? o.fr : o.en);
  useEffect(() => { if (data?.theme) setF(data.theme); }, [data]);

  if (loading || !f) return <Loading />;

  const ink = inkOn(f.accent || '#f97316');
  // Contrast of the button ink against the accent, measured — not eyeballed. Several of the
  // Pantone presets are pastels, where white text fails outright; the ink flips automatically,
  // and this says whether the result actually clears WCAG's 4.5:1 for body-size text.
  const ratio = contrastRatio(f.accent || '#f97316', ink);

  // Apply MUST apply.
  //
  // This was briefly a deferred commit — the PUT held back for an undo window — which was
  // the wrong pattern for a button labelled "Apply to the whole site". In that shape the
  // toast's × and its Undo are the same action, so dismissing the notification silently
  // rolled the theme back to the previous one and nothing was ever saved. The report was
  // exactly that: "I apply, and it puts the old choice back."
  //
  // Written immediately. Undo is still offered, but as a real second write of the previous
  // value — so closing the toast leaves the new theme in place, which is what the button
  // promised.
  const save = async () => {
    const body = { accent: f.accent, accent2: f.accent2, mode: f.mode, preset: f.preset || '', light: f.light || null, dark: f.dark || null, shared: f.shared || null };
    const previous = data?.theme || null;
    setBusy(true);
    try {
      await api.put('/admin/theme', body);
      applySiteTheme(f);
      // GET /theme is public and cached for 60s, so the tab that just saved would reload
      // into the OLD palette — the change looked applied until the next navigation, then
      // silently reverted. `cache: 'reload'` replaces the browser's stored response instead
      // of merely bypassing it, so the next page load reads the new theme too.
      try { await fetch('/api/theme', { cache: 'reload', headers: { accept: 'application/json' } }); } catch { /* the palette is already applied in this tab */ }
      reload();
      if (previous) {
        toast.action({
          tone: 'success', duration: 8000, cancelLabel: t('st.undo', 'Restore the previous one'),
          msg: t('st.saved', 'Site theme updated for everyone.'),
          onCommit: () => {},
          onCancel: async () => {
            try {
              await api.put('/admin/theme', previous);
              setF({ light: null, dark: null, shared: null, ...previous });
              applySiteTheme(previous);
              reload();
              toast.success(t('st.restored', 'Previous theme restored.'));
            } catch { toast.error(t('common.failed', 'Failed.')); }
          },
        });
      } else {
        toast.success(t('st.saved', 'Site theme updated for everyone.'));
      }
    } catch (x) { toast.error(x.data?.error || t('common.failed', 'Failed.')); }
    finally { setBusy(false); }
  };
  // Picking a preset CLEARS the token bags.
  //
  // A preset carries only accent + accent2 — every surface, line and page glow is derived
  // from that pair by themeCss. So a preset is already a complete look, but only if nothing
  // is overriding it. Keeping the bags meant selecting "BetterCommunity / Default" changed
  // the accent and left every custom token in place: the site kept the previous colours and
  // stray glows, and saving appeared to "put back the old one". Presets looked half-broken
  // for the same reason the reset did.
  //
  // Clearing silently would throw away real work, so it is undoable: the previous state is
  // captured and restored if you take it back.
  const pick = (p) => {
    const had = !!(f.shared || f.light || f.dark);
    const prev = { shared: f.shared, light: f.light, dark: f.dark };
    setF({ ...f, accent: p.accent, accent2: p.accent2, preset: p.id, shared: null, light: null, dark: null });
    if (had) {
      toast.action({
        tone: 'warning', duration: 8000, cancelLabel: t('common.undo', 'Undo'),
        msg: t('st.preset.cleared', 'Preset applied — your token overrides were cleared so it renders as designed.'),
        onCommit: () => {},
        onCancel: () => setF((cur) => ({ ...cur, ...prev })),
      });
    }
  };

  // "Back to the built-in theme", and it has to clear the token bags too.
  //
  // Picking the "BetterCommunity / Default" preset only restores accent + accent2 — every
  // per-token override in shared/light/dark survived it, so the site kept the previous
  // custom colours and it looked like resetting had done nothing. That is the whole bug:
  // there was no way, from this page, to actually get back to the built-in palette.
  //
  // Saved immediately rather than staged, because a reset you then have to remember to save
  // is the same trap in a different shape.
  const resetAll = async () => {
    if (!(await dialog.confirm({
      title: t('st.reset.t', 'Reset the site theme?'),
      message: t('st.reset.m', 'Restores the built-in palette for everyone and clears every token override in Shared, Light and Dark. Applies immediately.'),
      okLabel: t('st.reset.ok', 'Reset'),
      danger: true,
    }))) return;
    const base = { accent: '#f97316', accent2: '#f59e0b', mode: 'light', preset: '', light: null, dark: null, shared: null };
    setBusy(true);
    try {
      await api.put('/admin/theme', base);
      setF(base);
      applySiteTheme(base);
      toast.success(t('st.resetdone', 'Back to the built-in theme.'));
      reload();
    } catch (x) { toast.error(x.data?.error || t('common.failed', 'Failed.')); }
    finally { setBusy(false); }
  };

  // Clear every override in the scope on screen, without touching the other two.
  const clearScope = () => setF({ ...f, [scope]: null });

  return (
    <div>
      <h2 className="font-semibold mb-1 flex items-center gap-2"><Palette size={16} className="text-[var(--primary-2)]" /> {t('adm.tab.sitetheme', 'Site theme')}</h2>
      <p className="text-sm text-[var(--muted)] mb-4">{t('st.sub', 'The accent colour every visitor sees, in both light and dark. Only a superadmin can change it.')}</p>

      <Card className="p-4 mb-4">
        <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-2.5">{t('st.presets', 'Presets')}</div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {THEME_PRESETS.map((p) => (
            <button key={p.id} type="button" onClick={() => pick(p)}
              className={`flex items-center gap-2.5 p-2.5 rounded-xl border text-left transition-colors ${f.preset === p.id ? 'border-[var(--primary)] bg-[var(--primary)]/5' : 'border-[var(--line)] hover:border-[var(--line-strong)]'}`}>
              <span className="w-9 h-9 rounded-lg shrink-0" style={{ background: `linear-gradient(120deg, ${p.accent}, ${p.accent2})` }} />
              <span className="min-w-0">
                <span className="block text-sm font-medium truncate">{p.name}</span>
                <span className="block text-[11px] text-[var(--faint)] truncate">{p.sub}</span>
              </span>
            </button>
          ))}
        </div>
        <p className="text-[11px] text-[var(--faint)] mt-2.5">{t('st.pantonenote', 'Pantone names are used as labels only — these hex values are the widely-published approximations of each Color of the Year, not licensed Pantone data. Use a real Pantone reference for anything colour-critical.')}</p>
      </Card>

      <Card className="p-4 mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field label={t('st.accent', 'Accent')}>
            <div className="flex items-center gap-2">
              <input type="color" value={f.accent} onChange={(e) => setF({ ...f, accent: e.target.value, preset: '' })} className="w-10 h-9 rounded-lg border border-[var(--line)] bg-transparent cursor-pointer" />
              <Input className="!w-28 font-mono" value={f.accent} onChange={(e) => setF({ ...f, accent: e.target.value, preset: '' })} />
            </div>
          </Field>
          <Field label={t('st.accent2', 'Second accent (gradient)')}>
            <div className="flex items-center gap-2">
              <input type="color" value={f.accent2} onChange={(e) => setF({ ...f, accent2: e.target.value, preset: '' })} className="w-10 h-9 rounded-lg border border-[var(--line)] bg-transparent cursor-pointer" />
              <Input className="!w-28 font-mono" value={f.accent2} onChange={(e) => setF({ ...f, accent2: e.target.value, preset: '' })} />
            </div>
          </Field>
          <Field label={t('st.mode', 'Default mode for new visitors')} hint={t('st.modehint', 'Anyone who has used the toggle keeps their own choice.')}>
            <Select value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })} className="!w-auto">
              <option value="light">{t('st.light', 'Light')}</option>
              <option value="dark">{t('st.dark', 'Dark')}</option>
            </Select>
          </Field>
          <Button variant="primary" disabled={busy} onClick={save}>{busy ? <Spinner /> : <><Save size={14} /> {t('st.apply', 'Apply to the whole site')}</>}</Button>
          {/* Picking the "Default" preset only restores the accent — every token override
              survives it, which is why resetting used to bring the old custom colours back.
              This clears all three bags as well, and saves immediately. */}
          <Button variant="ghost" disabled={busy} onClick={resetAll}><RotateCcw size={14} /> {t('st.resetall', 'Reset to the built-in theme')}</Button>
        </div>
      </Card>

      {/* Full token editor. Two colours per mode still DERIVE the whole surface set; every
          individual token can then be corrected on top. That order is the point — "derive
          everything, then fix one thing" keeps full control from being a 27-field form you
          must complete before the site looks right. */}
      <Card className="p-4 mb-4">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)]">{t('st.tokens', 'Tokens')}</div>
          <div className="inline-flex rounded-lg border border-[var(--line)] p-0.5 text-xs ml-auto">
            {[['shared', t('st.scope.shared', 'Shared')], ['light', t('st.light', 'Light')], ['dark', t('st.dark', 'Dark')]].map(([k, label]) => (
              <button key={k} type="button" onClick={() => setScope(k)}
                className={`px-2.5 py-1 rounded-md ${scope === k ? 'bg-[var(--surface-2)] text-[var(--text)] font-medium' : 'text-[var(--muted)]'}`}>{label}</button>
            ))}
          </div>
        </div>
        <div className="flex items-start justify-between gap-3 mb-3">
          <p className="text-xs text-[var(--muted)]">{t('st.tokens.h', 'Set the page and its text, and the surfaces, greys and borders derive from them. Override any single token on top. An empty field means "derived" — clearing one gives it back to the recipe.')}</p>
          {f[scope] && Object.keys(f[scope] || {}).length > 0 &&
            <Button size="sm" variant="ghost" className="shrink-0" onClick={clearScope}><RotateCcw size={13} /> {t('st.clearscope', 'Clear this scope')}</Button>}
        </div>

        {scope !== 'shared' && (
          <div className="flex flex-wrap items-end gap-3 pb-3 mb-3 border-b border-[var(--line)]">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" checked={!!f[scope]} onChange={(e) => setF({ ...f, [scope]: e.target.checked ? (scope === 'light' ? { bg: '#f4efe8', text: '#17140f' } : { bg: '#0a0907', text: '#f3efe9' }) : null })} />
              {t('st.customise', 'Customise this mode')}
            </label>
            {f[scope] ? (
              <>
                {[['bg', t('st.page', 'Page')], ['text', t('st.textc', 'Text')]].map(([k, label]) => (
                  <Field key={k} label={label}>
                    <div className="flex items-center gap-2">
                      <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(f[scope][k] || '') ? f[scope][k] : '#000000'} onChange={(e) => setF({ ...f, [scope]: { ...f[scope], [k]: e.target.value } })} className="w-10 h-9 rounded-lg border border-[var(--line)] bg-transparent cursor-pointer" />
                      <Input className="!w-28 font-mono" value={f[scope][k] || ''} onChange={(e) => setF({ ...f, [scope]: { ...f[scope], [k]: e.target.value } })} />
                    </div>
                  </Field>
                ))}
                {f[scope].bg && f[scope].text && (() => {
                  const r = contrastRatio(f[scope].bg, f[scope].text);
                  return <span className={`text-[11px] ${r >= 4.5 ? 'text-success' : 'text-warning'}`}>
                    {t('st.textcontrast', 'Text {n}:1').replace('{n}', r.toFixed(2))}{r >= 4.5 ? '' : ` — ${t('st.belowaa', 'below AA')}`}
                  </span>;
                })()}
              </>
            ) : <span className="text-xs text-[var(--faint)]">{t('st.usingbuiltin', 'Using the built-in palette.')}</span>}
          </div>
        )}

        {/* Page background. The glow COLOURS were already tokens (--glow-a/b/c); what was
            not reachable was their geometry — where each spot sits, how big it is, how many
            there are — because that lived in index.css. This edits the list itself. */}
        {scope !== 'shared' && f[scope] && (() => {
          const glows = Array.isArray(f[scope].glows) ? f[scope].glows : null;
          const setGlows = (v) => setF({ ...f, [scope]: { ...f[scope], glows: v } });
          const setG = (i, patch) => setGlows(glows.map((g, n) => (n === i ? { ...g, ...patch } : g)));
          const NUM = [['w', 'W %'], ['h', 'H %'], ['x', 'X %'], ['y', 'Y %'], ['fade', 'Fade %']];
          return (
            <div className="mb-3">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--faint)] mb-1.5">{t('thm.bg', 'Page background')}</div>
              {!glows ? (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-[var(--muted)]">{t('thm.bg.default', 'Using the built-in glow layout.')}</span>
                  <Button size="sm" variant="ghost" onClick={() => setGlows(DEFAULT_GLOWS(scope))}>{t('thm.bg.take', 'Customise it')}</Button>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {glows.map((g, i) => (
                    <div key={i} className="flex items-center gap-1.5 flex-wrap">
                      <input type="color" value={hexOf(g.color)} onChange={(e) => setG(i, { color: e.target.value })}
                        className="w-8 h-8 rounded border border-[var(--line)] bg-transparent p-0.5 cursor-pointer" />
                      <Input className="!w-40 !text-xs font-mono" value={g.color || ''} onChange={(e) => setG(i, { color: e.target.value })} placeholder="rgba(249,115,22,.14)" />
                      {NUM.map(([k, lb]) => (
                        <label key={k} className="text-[10px] text-[var(--faint)] flex flex-col">
                          {lb}
                          <Input className="!w-16 !text-xs" type="number" value={g[k] ?? ''} onChange={(e) => setG(i, { [k]: Number(e.target.value) })} />
                        </label>
                      ))}
                      <button onClick={() => setGlows(glows.filter((_, n) => n !== i))} className="p-1 rounded text-error hover:bg-error-bg self-end mb-1"><Trash2 size={12} /></button>
                    </div>
                  ))}
                  <div className="flex items-center gap-2 pt-1">
                    {glows.length < 8 && <Button size="sm" variant="ghost" onClick={() => setGlows([...glows, { color: 'rgba(249,115,22,.10)', w: 50, h: 50, x: 50, y: 50, fade: 60 }])}><Plus size={13} /> {t('thm.bg.add', 'Add a glow')}</Button>}
                    <Button size="sm" variant="ghost" onClick={() => setGlows(null)}><RotateCcw size={13} /> {t('thm.bg.reset', 'Back to the built-in')}</Button>
                    {glows.length === 0 && <span className="text-[11px] text-[var(--faint)]">{t('thm.bg.flat', 'No glows — a flat background.')}</span>}
                  </div>
                </div>
              )}
            </div>
          );
        })()}
        {(scope === 'shared' || f[scope]) && TOKEN_GROUPS.map((g) => {
          const items = TOKENS.filter((tk) => tk.group === g.id && (scope === 'shared' ? tk.scope === 'shared' : tk.scope === 'mode'));
          if (!items.length) return null;
          const bag = f[scope] || {};
          const setTok = (name, val) => {
            const next = { ...bag };
            if (val) next[name] = val; else delete next[name];
            setF({ ...f, [scope]: Object.keys(next).length ? next : (scope === 'shared' ? null : next) });
          };
          return (
            <div key={g.id} className="mb-3">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--faint)] mb-1.5">{tGroup(g.label)}</div>
              <div className="space-y-1.5">
                {items.map((tk) => (
                  <div key={tk.name} className="flex items-start gap-2.5 flex-wrap">
                    {/* An unset token used to fall back to a hardcoded #888888, so every
                        token with no override showed the SAME grey — the one thing the
                        swatch must never do, since its job is to tell you what the token
                        currently paints. It now reads the live computed value, which is what
                        a visitor actually sees. */}
                    <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(bag[tk.name] || '') ? bag[tk.name] : liveToken(tk.name)}
                      onChange={(e) => setTok(tk.name, e.target.value)}
                      className="w-8 h-8 mt-0.5 rounded-lg border border-[var(--line)] bg-transparent cursor-pointer shrink-0" />
                    <Input className="!w-40 font-mono !text-xs" placeholder={tk.derived ? t('st.derived', 'derived') : t('st.default', 'default')}
                      value={bag[tk.name] || ''} onChange={(e) => setTok(tk.name, e.target.value)} />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium flex items-center gap-2 flex-wrap">
                        {tGroup(tk.label)}
                        <code className="text-[10px] text-[var(--faint)]">{tk.name}</code>
                        <span className="text-[10px] text-[var(--faint)]">{t('st.uses', '{n} uses').replace('{n}', tk.uses)}</span>
                      </div>
                      <div className="text-[11px] text-[var(--muted)]">{tGroup(tk.affects)}</div>
                    </div>
                    {bag[tk.name] && <button onClick={() => setTok(tk.name, '')} className="text-[11px] text-[var(--faint)] hover:text-[var(--text)] mt-1">{t('st.reset', 'reset')}</button>}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </Card>

      {/* The preview applies the real themeCss to a scoped container. */}
      <Card className="p-4">
        <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-2.5">{t('st.preview', 'Preview')}</div>
        {/* Every selector themeCss emits is rewritten to the preview container, so the page
            colours are previewed as well as the accent — a preview that showed only half of
            what Apply does would be worse than none. */}
        <style>{(() => {
          // Only the mode currently on screen is emitted. Rewriting BOTH page blocks onto the
          // same container would let the dark one win (it comes last), so a light preview
          // would have silently shown dark colours.
          const active = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
          const scoped = { accent: f.accent, accent2: f.accent2, shared: f.shared, [active]: f[active] };
          return themeCss(scoped).replace(/:root,\[data-theme="light"\]|\[data-theme="dark"\]|:root/g, '#st-preview');
        })()}</style>
        {/* The preview paints the real page background — flat --bg plus the configured
            glow stack — instead of sitting on the admin's own surface. Editing the
            background was otherwise the one thing you could not see the result of, which
            is exactly the case a preview exists for. */}
        <div id="st-preview" className="rounded-xl border border-[var(--line)] p-4 space-y-3"
          style={{ background: 'var(--bg)', backgroundImage: previewGlowCss(f), color: 'var(--text)' }}>
          <div className="flex flex-wrap items-center gap-3">
            <button className="btn btn-primary btn-sm">{t('st.samplebtn', 'Primary button')}</button>
            <button className="btn btn-danger btn-sm">{t('st.sampledanger', 'Delete')}</button>
            <button className="btn btn-ghost btn-sm">{t('st.sampleghost', 'Cancel')}</button>
            <span className="gradient-text text-lg font-semibold">{t('st.sampletext', 'Gradient heading')}</span>
            <span className="px-2 py-0.5 rounded-md text-xs" style={{ background: 'var(--primary)', color: 'var(--on-primary)' }}>Badge</span>
          </div>
          {/* A surface, so --surface / --line / the text ramp are all on screen at once. */}
          <div className="rounded-lg p-3 space-y-2" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
            <div className="font-semibold text-sm">{t('st.samplecard', 'A card on a surface')}</div>
            <div className="text-sm" style={{ color: 'var(--muted)' }}>{t('st.samplemuted', 'Secondary text, the muted ramp.')}</div>
            <div className="text-xs" style={{ color: 'var(--faint)' }}>{t('st.samplefaint', 'Faint text — captions and hints.')}</div>
            <input readOnly value={t('st.sampleinput', 'An input field')}
              className="w-full rounded-lg px-3 py-1.5 text-sm outline-none"
              style={{ background: 'var(--bg-solid)', border: '1px solid var(--control-border, var(--line))', color: 'var(--text)' }} />
            <div className="pt-1" style={{ borderTop: '1px solid var(--line-strong)' }} />
            <div className="flex flex-wrap gap-1.5">
              {[['info', t('st.st.info', 'Info')], ['success', t('st.st.success', 'Saved')],
                ['warning', t('st.st.warning', 'Careful')], ['error', t('st.st.error', 'Failed')]].map(([k, label]) => (
                <span key={k} className="px-2 py-0.5 rounded-md text-xs font-medium"
                  style={{ background: `var(--${k}-bg)`, color: `var(--${k})`, border: `1px solid var(--${k}-border)` }}>{label}</span>
              ))}
            </div>
          </div>
        </div>
        <div className={`text-[11px] mt-2 ${ratio >= 4.5 ? 'text-success' : 'text-warning'}`}>
          {ratio >= 4.5
            ? t('st.contrastok', 'Button text contrast {n}:1 — clears WCAG AA (4.5:1).').replace('{n}', ratio.toFixed(2))
            : t('st.contrastlow', 'Button text contrast {n}:1 — below WCAG AA (4.5:1). The ink already flipped to its best option; this accent is simply hard to write on.').replace('{n}', ratio.toFixed(2))}
        </div>
      </Card>
    </div>
  );
}

function FreePoolBreakdown({ open, onClose }) {
  const { t } = useI18n();
  const [data, setData] = useState(null);
  useEffect(() => {
    if (!open) return;
    setData(null);
    api.get('/admin/hosting/free-pool').then((r) => setData(r.entries || [])).catch(() => setData([]));
  }, [open]);
  const total = (data || []).reduce((a, e) => a + (e.gb || 0), 0);
  return (
    <Modal open={open} onClose={onClose} title={t('fpb.title', 'Free-plan pool breakdown')} icon={Gift} width="max-w-lg">
      {data == null ? <Loading /> : data.length === 0 ? (
        <EmptyState icon={Gift} title={t('fpb.empty.t', 'Pool is empty')} sub={t('fpb.empty.s', 'No repo or pool was provisioned through the $0 Free plan. Admin-provisioned and promo repos never count here.')} />
      ) : (
        <div className="space-y-1.5">
          <div className="text-xs text-[var(--muted)] mb-2">{t('fpb.desc', 'Everything provisioned through the actual $0 Free plan. Admin-provisioned and promo-granted repos are excluded by design.')}</div>
          {data.map((e) => (
            <Card key={e.id} className="p-3 flex items-center gap-3">
              <span className="grid place-items-center w-8 h-8 rounded-lg bg-success-bg border border-[var(--line)] shrink-0">{e.type === 'pool' ? <Layers size={14} className="text-success" /> : <Server size={14} className="text-success" />}</span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{e.name} {e.type === 'pool' && <span className="text-[11px] text-[var(--faint)]">· {t('fpb.repos', '{n} repo(s)').replace('{n}', e.repoCount)}</span>}</div>
                <div className="text-xs text-[var(--faint)] truncate">{e.owner} · {e.email}</div>
              </div>
              <span className="tabular-nums text-sm font-semibold shrink-0">{(e.gb || 0).toFixed(1)} GB</span>
            </Card>
          ))}
          <div className="flex items-center justify-between pt-2 mt-1 border-t border-[var(--line)] text-sm"><span className="text-[var(--muted)]">{t('fpb.total', 'Total counted')}</span><span className="tabular-nums font-semibold">{total.toFixed(1)} GB</span></div>
        </div>
      )}
    </Modal>
  );
}

// Admin: manage the submission temp margin — see the PENDING payloads awaiting review
// and the REJECTED ones squatting space in their purge grace, and reclaim either now.
function TempStorageManager({ open, onClose, onChange }) {
  const { t } = useI18n();
  const toast = useToast();
  const dialog = useDialog();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(null);
  const load = () => { setData(null); api.get('/admin/catalog/temp-storage').then(setData).catch(() => setData({ items: [] })); };
  useEffect(() => { if (open) load(); }, [open]);
  const purgeOne = async (it) => {
    if (!(await dialog.confirm({ title: t('ts.purge1.t', 'Purge this file?'), message: t('ts.purge1.b', 'Deletes the uploaded file for "{name}" to reclaim space. The submission row stays; this cannot be undone.').replace('{name}', it.name), okLabel: t('ts.purge', 'Purge'), danger: true }))) return;
    setBusy(it.id);
    try { await api.post(`/admin/catalog/${it.id}/purge-payload`); toast.success(t('ts.purged', 'File purged.')); load(); onChange?.(); }
    catch { toast.error(t('acc.failed', 'Failed.')); } finally { setBusy(null); }
  };
  const purgeAllRejected = async () => {
    if (!(await dialog.confirm({ title: t('ts.purgeall.t', 'Purge all rejected files?'), message: t('ts.purgeall.b', 'Deletes every rejected submission file still in its grace window. Cannot be undone.'), okLabel: t('ts.purge', 'Purge'), danger: true }))) return;
    setBusy('__all__');
    try { const r = await api.post('/admin/catalog/purge-rejected'); toast.success(t('ts.purgedn', 'Purged {n} file(s).').replace('{n}', r.purged)); load(); onChange?.(); }
    catch { toast.error(t('acc.failed', 'Failed.')); } finally { setBusy(null); }
  };
  const items = data?.items || [];
  const rejected = items.filter((i) => i.status === 'REJECTED');
  const fmtAge = (d) => { const days = Math.floor((Date.now() - new Date(d)) / 864e5); return days <= 0 ? t('ts.today', 'today') : t('ts.daysago', '{n}d ago').replace('{n}', days); };
  return (
    <Modal open={open} onClose={onClose} title={t('ts.title', 'Temp storage — submission payloads')} icon={Upload} width="max-w-2xl"
      footer={rejected.length > 0 ? <Button variant="ghost" className="!text-error" disabled={busy === '__all__'} onClick={purgeAllRejected}>{busy === '__all__' ? <Spinner /> : <><Trash2 size={14} /> {t('ts.purgeallbtn', 'Purge all rejected ({n})').replace('{n}', rejected.length)}</>}</Button> : null}>
      {data == null ? <Loading /> : items.length === 0 ? (
        <EmptyState icon={CheckCircle2} title={t('ts.empty.t', 'Nothing held')} sub={t('ts.empty.s', 'No submission payloads are occupying the temp margin right now.')} />
      ) : (
        <>
          <div className="flex gap-3 mb-3 text-xs">
            <span className="flex items-center gap-1.5 text-[var(--muted)]"><span className="w-2.5 h-2.5 rounded-sm bg-warning" /> {t('ts.pending', 'Pending')} <b className="text-[var(--text)] tabular-nums">{(data.pendingMB || 0).toFixed(1)} MB</b></span>
            <span className="flex items-center gap-1.5 text-[var(--muted)]"><span className="w-2.5 h-2.5 rounded-sm bg-error-bg" /> {t('ts.rejected', 'Rejected (in grace)')} <b className="text-[var(--text)] tabular-nums">{(data.rejectedMB || 0).toFixed(1)} MB</b></span>
          </div>
          <div className="space-y-1.5 max-h-[52vh] overflow-y-auto">
            {items.map((it) => (
              <Card key={it.id} className="p-2.5 flex items-center gap-3">
                <Badge tone={it.status === 'REJECTED' ? 'red' : 'amber'}>{it.status === 'REJECTED' ? t('ts.rej', 'rejected') : t('ts.pend', 'pending')}</Badge>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{it.name} <span className="text-[11px] text-[var(--faint)]">· {it.kind}</span></div>
                  <div className="text-xs text-[var(--faint)] truncate">{it.owner} · {it.status === 'REJECTED' && it.purgeAt ? t('ts.autopurge', 'auto-purge {when}').replace('{when}', fmtAge(it.updatedAt)) : fmtAge(it.updatedAt)}</div>
                </div>
                <span className="tabular-nums text-xs font-semibold shrink-0">{(it.sizeMB || 0).toFixed(1)} MB</span>
                <Button size="sm" variant="ghost" className="!text-error" disabled={busy === it.id} onClick={() => purgeOne(it)}>{busy === it.id ? <Spinner /> : <Trash2 size={13} />}</Button>
              </Card>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}

function AdminSettings() {
  const toast = useToast();
  const { t } = useI18n();
  const { data, reload } = useAsync(() => api.get('/admin/settings'), []);
  const cap = useAsync(() => api.get('/hosting/capacity'), []);
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState(null);
  const [unit, setUnit] = useState({}); // settingKey -> 'MB' | 'GB' (display unit only)
  const [freePoolOpen, setFreePoolOpen] = useState(false);
  const [tempOpen, setTempOpen] = useState(false);
  useEffect(() => { if (data?.settings) setDraft(data.settings); }, [data]);
  const coerce = (v, kind) => kind === 'bool' ? !!v : (v !== '' && !isNaN(Number(v)) ? Number(v) : v);
  const undoSaveOne = useUndoableSave(() => { reload(); cap.reload?.(); });
  const save = (key, kind) => {
    // Value coerced now, not inside the window — the field stays editable while it counts down.
    const value = coerce(draft[key], kind);
    setBusy(key);
    undoSaveOne(() => api.put(`/admin/settings/${key}`, { value }), t('hs.saved', 'Saved.'),
      { onSettled: () => setBusy(null),
        errorFor: (x) => x.data?.error === 'exceeds_disk'
          ? t('hs.exceedsdisk', `Exceeds the real disk capacity (${x.data.diskGB} GB max).`).replace('{n}', x.data.diskGB)
          : t('hs.savefail', 'Save failed.') });
  };
  // "Save all changes" — edit several settings (CPU / storage / upload …) and save them
  // in one click, instead of one Save button per field.
  const KIND_OF = {}; SETTINGS_GROUPS.forEach((g) => g.keys.forEach(([k, , , kind]) => { KIND_OF[k] = kind === 'gbmb' ? 'number' : kind; }));
  const dirtyKeys = Object.keys(KIND_OF).filter((k) => {
    const kind = KIND_OF[k];
    const cur = coerce(draft[k] ?? (kind === 'bool' ? false : ''), kind);
    const saved = data?.settings?.[k] ?? (kind === 'bool' ? false : '');
    return JSON.stringify(cur) !== JSON.stringify(saved);
  });
  const undoSaveAll = useUndoableSave(() => { reload(); cap.reload?.(); });
  const saveAll = () => {
    // The key list and their values are snapshotted: the user can keep editing during the
    // window, and this must write the set they pressed Save on, not whatever is dirty later.
    const batch = dirtyKeys.map((k) => [k, coerce(draft[k], KIND_OF[k])]);
    setBusy('__all__');
    undoSaveAll(async () => {
      for (const [k, value] of batch) await api.put(`/admin/settings/${k}`, { value });
    }, t('hs.savecount', `Saved ${batch.length} changes.`).replace('{n}', batch.length),
       { onSettled: () => setBusy(null),
         errorFor: (x) => x.data?.error === 'exceeds_disk' ? t('hs.exceedsdisk', `Exceeds the real disk capacity (${x.data.diskGB} GB max).`).replace('{n}', x.data.diskGB) : (x.data?.error || t('common.failed', 'Failed.')) });
  };
  const c = cap.data?.capacity;
  const tempPct = c?.tempMarginGB ? Math.min(100, (c.tempUsedGB / c.tempMarginGB) * 100) : 0;
  return (
    <div className="mt-10">
      {/* Plain header — consistent with every other admin panel (Events, Campaigns…).
          The "Save all" pill still floats to a sticky dock at the bottom-right when
          there are unsaved edits, so pinning the header isn't needed. */}
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h2 className="font-semibold flex items-center gap-2"><Settings2 size={16} className="text-[var(--primary-2)]" /> {t('hs.title', 'Hosting settings')}</h2>
      </div>
      {dirtyKeys.length > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 anim-slide">
          <Button variant="primary" disabled={busy === '__all__'} onClick={saveAll} className="shadow-lg">{busy === '__all__' ? <Spinner /> : <><CheckCheck size={15} /> {t('hs.saveall', 'Save all')} ({dirtyKeys.length})</>}</Button>
        </div>
      )}
      {/* At-a-glance stacked bar of the WHOLE Total capacity — where every GB goes
          (hosting quotas, approved submissions, temp margin, reserved, free) plus the
          separately-tracked free-plan pool. */}
      {c && (() => {
        const total = c.totalGB || 0;
        const seg = (gb, color, label) => ({ gb: Math.max(0, Number(gb) || 0), color, label });
        const segs = [
          seg(c.hostingAllocatedGB, 'var(--primary)', t('hs.seg.hosting', 'Hosting quotas')),
          seg(c.submissionsPublishedGB, '#8b5cf6', t('hs.seg.subs', 'Approved submissions')),
          seg(c.tempUsedGB, '#f59e0b', t('hs.seg.tempuse', 'Temp (in use)')),
          seg((c.tempMarginGB || 0) - (c.tempUsedGB || 0), 'rgba(245,158,11,0.35)', t('hs.seg.tempres', 'Temp (reserved)')),
          seg(c.reservedGB, 'var(--faint)', t('hs.seg.reserved', 'Reserved margin')),
        ];
        const used = segs.reduce((a, s) => a + s.gb, 0);
        const all = [...segs, seg(Math.max(0, total - used), 'var(--surface-2)', t('hs.seg.free', 'Free'))];
        return (
          <Card className="p-4 mb-3">
            <div className="flex items-center justify-between text-sm mb-2 flex-wrap gap-2">
              <span className="flex items-center gap-2 font-medium"><HardDrive size={15} className="text-[var(--primary-2)]" /> {t('hs.totalcap', 'Total capacity')}</span>
              <span className="text-xs text-[var(--muted)] tabular-nums">{t('hs.capused', '{used} / {total} GB used · {free} GB free').replace('{used}', used.toFixed(1)).replace('{total}', total).replace('{free}', Math.max(0, total - used).toFixed(1))}</span>
            </div>
            <div className="flex h-3.5 rounded-full overflow-hidden bg-[var(--surface-2)] border border-[var(--line)]">
              {total > 0 && all.map((s, i) => s.gb > 0.001 && <div key={i} title={`${s.label}: ${s.gb.toFixed(2)} GB`} style={{ width: `${(s.gb / total) * 100}%`, background: s.color }} />)}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2.5 text-[11px]">
              {all.filter((s) => s.gb > 0.001).map((s, i) => (
                <span key={i} className="flex items-center gap-1.5 text-[var(--muted)]"><span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: s.color }} /> {s.label} <b className="text-[var(--text)] tabular-nums">{s.gb.toFixed(1)}G</b></span>
              ))}
            </div>
            {c.diskFreeGB != null && <div className="text-[11px] text-[var(--faint)] mt-1.5">{t('hs.realdisk', 'Real disk:')} <b className="text-[var(--text)]">{t('hs.gbfree', '{n} GB free').replace('{n}', c.diskFreeGB.toFixed(0))}</b> / {t('hs.gbtotal', '{n} GB total').replace('{n}', c.diskTotalGB?.toFixed(0))}.</div>}
            {c.freeTierCapEnabled && c.freeTierCapGB > 0 && (
              <div className="mt-3 pt-3 border-t border-[var(--line)]">
                <button type="button" onClick={() => setFreePoolOpen(true)} className="w-full text-left group" title={t('hs.freepool.view', 'See what fills this pool')}>
                  <div className="flex items-center justify-between text-xs mb-1"><span className="text-[var(--muted)] flex items-center gap-1.5 group-hover:text-[var(--text)]"><Gift size={12} className="text-success" /> {t('hs.freepool', 'Free-plan pool (separate)')} <ArrowUpRight size={11} className="opacity-40 group-hover:opacity-100" /></span><span className="tabular-nums font-medium">{(c.freeTierUsedGB || 0).toFixed(1)} / {c.freeTierCapGB} GB</span></div>
                  <div className="h-2 rounded-full bg-[var(--surface-2)] overflow-hidden"><div className="h-full bg-success" style={{ width: `${Math.min(100, ((c.freeTierUsedGB || 0) / c.freeTierCapGB) * 100)}%` }} /></div>
                </button>
              </div>
            )}
            {/* BMM telemetry storage — used vs. the admin-set allocation (separate DB). */}
            {c.telemetryUsedGB != null && (() => {
              const alloc = c.telemetryLimitGB || 0;
              const pct = alloc > 0 ? Math.min(100, (c.telemetryUsedGB / alloc) * 100) : 0;
              return (
                <div className="mt-3 pt-3 border-t border-[var(--line)]">
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-[var(--muted)] flex items-center gap-1.5"><Gauge size={12} className="text-info" /> {t('hs.telestore', 'BMM telemetry storage')} {alloc > 0 ? '' : <span className="text-[var(--faint)]">{t('hs.nolimit', '(no limit set)')}</span>}</span>
                    <span className="tabular-nums font-medium">{c.telemetryUsedGB.toFixed(2)}{alloc > 0 ? ` / ${alloc} GB` : ` ${t('hs.gbused', 'GB used')}`}</span>
                  </div>
                  {alloc > 0 && <div className="h-2 rounded-full bg-[var(--surface-2)] overflow-hidden"><div className={`h-full ${pct > 90 ? 'bg-error' : 'bg-info'}`} style={{ width: `${pct}%` }} /></div>}
                </div>
              );
            })()}
          </Card>
        );
      })()}
      <TelemetryConfigCard />
      <FreePoolBreakdown open={freePoolOpen} onClose={() => setFreePoolOpen(false)} />
      {/* Temp submissions margin — live usage. Uploads (.bmmplugin / .bmmtheme / app
          payloads) are refused once this is full, until moderation clears space. */}
      {c && (
        <Card className="p-4 mb-3">
          <div className="flex items-center justify-between text-sm mb-1.5">
            <span className="flex items-center gap-2 text-[var(--muted)]"><Upload size={14} className="text-[var(--primary-2)]" /> {t('hs.tempstore', 'Temp storage (submissions)')}</span>
            <span className="font-semibold tabular-nums">{(c.tempUsedGB ?? 0).toFixed(2)} / {c.tempMarginGB ?? 0} GB</span>
          </div>
          <div className="h-2 rounded-full bg-[var(--surface-2)] overflow-hidden flex">
            <div className={`h-full ${tempPct > 90 ? 'bg-error' : 'bg-gradient-to-r from-brand to-brand-2'}`} style={{ width: `${(c.tempMarginGB ? Math.min(100, ((c.tempPendingGB || 0) / c.tempMarginGB) * 100) : 0)}%` }} title={t('hs.temppending', 'Pending review')} />
            <div className="h-full bg-error-bg" style={{ width: `${(c.tempMarginGB ? Math.min(100, ((c.tempRejectedGB || 0) / c.tempMarginGB) * 100) : 0)}%` }} title={t('hs.temprejected', 'Rejected (in grace)')} />
          </div>
          <div className="flex items-center justify-between gap-2 mt-1.5 flex-wrap">
            <div className="text-[11px] text-[var(--faint)]">{t('hs.tempnote', 'Submitted files (.bmmplugin, .bmmtheme, app payloads) live here until moderation. When full, new submission uploads are refused.')}
              {(c.tempRejectedGB || 0) > 0.001 && <span className="text-error"> · {t('hs.temprej', '{n} GB held by rejected files in grace').replace('{n}', (c.tempRejectedGB || 0).toFixed(2))}</span>}</div>
            <Button size="sm" variant="ghost" onClick={() => setTempOpen(true)}><Files size={13} /> {t('hs.tempmanage', 'Manage')}</Button>
          </div>
        </Card>
      )}
      <TempStorageManager open={tempOpen} onClose={() => setTempOpen(false)} onChange={() => cap.reload?.()} />
      <div className="space-y-5">
        {SETTINGS_GROUPS.map((g) => (
          <div key={g.title} className="card rounded-2xl overflow-hidden">
            <div className="flex items-center gap-2.5 px-4 py-3 bg-[var(--surface-2)]/40 border-b border-[var(--line)]">
              <span className="grid place-items-center w-8 h-8 rounded-lg bg-[var(--primary)]/10 border border-[var(--primary)]/20 shrink-0"><g.icon size={15} className="text-[var(--primary-2)]" /></span>
              <div className="min-w-0"><div className="text-sm font-semibold">{t(`hs.g.${g.gk}`, g.title)}</div>{GROUP_DESC[g.title] && <div className="text-[11px] text-[var(--faint)] truncate">{t(`hs.gd.${g.gk}`, GROUP_DESC[g.title])}</div>}</div>
            </div>
            <div className="p-3 grid md:grid-cols-2 gap-3">
              {g.keys.map(([k, label, desc, kind, nativeUnit]) => {
                const L = t(`hs.l.${k}`, label);
                const D = t(`hs.d.${k}`, desc);
                const saveLabel = t('hs.save', 'Save');
                return (
                <Card key={k} className="p-4">
                  {kind === 'bool' ? (
                    <div className="flex items-center justify-between gap-3">
                      <label className="flex items-center gap-2.5 text-sm cursor-pointer flex-1"><input type="checkbox" checked={draft[k] !== false && draft[k] !== 'false' && !!draft[k]} onChange={(e) => setDraft({ ...draft, [k]: e.target.checked })} /> <span className="font-medium">{L}</span></label>
                      <Button size="sm" disabled={busy === k} onClick={() => save(k, kind)}>{busy === k ? <Spinner /> : saveLabel}</Button>
                    </div>
                  ) : kind === 'gbmb' ? (() => {
                    const curUnit = unit[k] || nativeUnit;
                    const displayValue = draft[k] !== '' && draft[k] != null ? convertUnit(Number(draft[k]), nativeUnit, curUnit) : '';
                    return (
                      <div className="flex items-end gap-2">
                        <div className="flex-1"><Field label={L}><Input type="number" value={displayValue} onChange={(e) => setDraft({ ...draft, [k]: e.target.value === '' ? '' : convertUnit(Number(e.target.value), curUnit, nativeUnit) })} /></Field></div>
                        <Select className="!w-auto !py-2.5" value={curUnit} onChange={(e) => setUnit({ ...unit, [k]: e.target.value })}><option value="MB">MB</option><option value="GB">GB</option></Select>
                        <Button size="sm" disabled={busy === k} onClick={() => save(k, 'number')}>{busy === k ? <Spinner /> : saveLabel}</Button>
                      </div>
                    );
                  })() : (
                    <div className="flex items-end gap-3">
                      <div className="flex-1"><Field label={L}><Input type="number" value={draft[k] ?? ''} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} /></Field></div>
                      <Button size="sm" disabled={busy === k} onClick={() => save(k, kind)}>{busy === k ? <Spinner /> : saveLabel}</Button>
                    </div>
                  )}
                  <div className="text-[11px] text-[var(--faint)] mt-1.5">{D}</div>
                  {k === 'hosting.totalCapacityGB' && c?.diskTotalGB != null && <div className="text-[11px] text-warning mt-1">{t('hs.realdiskcap', "Real disk: {free} GB free / {total} GB total — can't be set above this.").replace('{free}', c.diskFreeGB.toFixed(0)).replace('{total}', c.diskTotalGB.toFixed(0))}</div>}
                </Card>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}




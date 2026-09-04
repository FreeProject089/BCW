import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { MessageSquare, Server, Shield, Database, MinusCircle, Users, Check, Link2, ScrollText, Gauge, Sparkles, Image as ImageIcon, AlertTriangle, Mic, Plus, Trash2, Ban, Clock, UserMinus, Newspaper } from 'lucide-react';
import { DiscordIcon } from '../ui/brand.jsx';
import { api, uploadImage } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { Card, Button, Badge, Input, Field, Spinner, EmptyState, useToast, useDialog, Textarea, Select } from '../ui/ui.jsx';

// B10 — the user-facing copy of the per-server Discord dashboard. A logged-in user who owns
// (or holds Manage-Server on) a Discord server the bot is in configures it here: no admin
// role, no BMM/BCWEB-specific bits. The storage POOL + byte budget stay admin-only, so the
// capacity meter is read-only — a user picks HOW members are handled, not how big their
// budget is. Backed by /me/discord/guilds (ownership re-checked server-side on every call).

// The three member-handling modes, in plain language. Order matters: the safe default first.
const MODES = [
  { id: 'none', icon: MinusCircle, tone: 'text-[var(--faint)]',
    label: 'Store nothing', labelFr: 'Ne rien stocker',
    desc: 'The bot never scans or stores your members. The safe default — nothing about your server is kept here.',
    descFr: 'Le bot ne scanne ni ne stocke jamais tes membres. Le choix sûr par défaut — rien de ton serveur n’est conservé ici.' },
  { id: 'moderation', icon: Shield, tone: 'text-info',
    label: 'Moderation only', labelFr: 'Modération seule',
    desc: 'Run moderation commands (ban / kick / timeout) that post to a log channel in your server. Keeping a copy of those logs here is optional and uses storage.',
    descFr: 'Utilise les commandes de modération (ban / kick / exclusion) qui postent dans un salon de logs de ton serveur. Garder une copie de ces logs ici est optionnel et consomme du stockage.' },
  { id: 'pool', icon: Database, tone: 'text-[var(--primary-2)]',
    label: 'Member database', labelFr: 'Base de membres',
    desc: 'Store your members (name, join date, roles) so the bot can power a member list and role gating. Budgeted against your storage allowance.',
    descFr: 'Stocke tes membres (nom, date d’arrivée, rôles) pour alimenter une liste de membres et le contrôle par rôle. Décompté de ton allocation de stockage.' },
];

function CapacityBar({ cap }) {
  const { t } = useI18n();
  if (!cap || cap.unlimited) return null;
  return (
    <div className="mt-2">
      <div className="flex items-center justify-between text-[11px] mb-1">
        <span className="text-[var(--muted)] flex items-center gap-1.5"><Gauge size={12} className="text-[var(--primary-2)]" /> {t('ds.capacity', 'Storage used')}</span>
        <span className="tabular-nums font-medium">{cap.stored} / {cap.cap} · {cap.remaining} {t('ds.left', 'left')}</span>
      </div>
      <div className="h-1.5 rounded-full bg-[var(--surface-2)] overflow-hidden">
        <div className={`h-full ${cap.full ? 'bg-error' : cap.near ? 'bg-warning' : 'bg-gradient-to-r from-brand to-brand-2'}`} style={{ width: `${cap.pct}%` }} />
      </div>
      {cap.full && <div className="text-[11px] text-error mt-1">{t('ds.full', 'At capacity — new members are not stored. An admin can raise your allowance.')}</div>}
    </div>
  );
}

// Pick a channel / role from the server's live list (sent by the bot's heartbeat) instead of
// pasting a snowflake. Falls back to the plain id input when the list is unavailable (bot
// offline, or an old heartbeat) so nothing is ever un-editable.
function ChannelPicker({ channels, value, onChange, types = [0, 5], placeholder }) {
  const { t } = useI18n();
  const list = (channels || []).filter((c) => types.includes(c.type));
  if (!list.length) return <Input value={value || ''} onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, '').slice(0, 32))} placeholder={placeholder || t('ds.pick.chanph', 'Channel ID')} />;
  return (<>
    <Select value={value || ''} onChange={(e) => onChange(e.target.value)}>
      <option value="">{t('ds.pick.none', '— none —')}</option>
      {value && !list.some((c) => c.id === value) && <option value={value}>{t('pick.unknown', 'ID {v} (not in the bot’s list)').replace('{v}', value)}</option>}
      {list.map((c) => <option key={c.id} value={c.id}>{c.type === 2 ? '🔊 ' : '# '}{c.name}</option>)}
    </Select>
    {value && <div className="text-[10px] text-[var(--faint)] mt-1 tabular-nums">{t('pick.current', 'Current id: {v}').replace('{v}', value)}</div>}
  </>);
}
function RolePicker({ roles, value, onChange, placeholder }) {
  const { t } = useI18n();
  if (!roles?.length) return <Input value={value || ''} onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, '').slice(0, 32))} placeholder={placeholder || t('ds.pick.roleph', 'Role ID')} />;
  return (<>
    <Select value={value || ''} onChange={(e) => onChange(e.target.value)}>
      <option value="">{t('ds.pick.none', '— none —')}</option>
      {value && !roles.some((r) => r.id === value) && <option value={value}>{t('pick.unknown', 'ID {v} (not in the bot’s list)').replace('{v}', value)}</option>}
      {roles.map((r) => <option key={r.id} value={r.id}>@{r.name}</option>)}
    </Select>
    {value && <div className="text-[10px] text-[var(--faint)] mt-1 tabular-nums">{t('pick.current', 'Current id: {v}').replace('{v}', value)}</div>}
  </>);
}

// Welcome banner background presets (mirrors the admin editor's palette).
const WBG = [['dark', '#0e0c09'], ['midnight', '#0a0f1e'], ['plum', '#140a1e'], ['forest', '#08160f'], ['rose', '#1a0a12'], ['slate', '#0f1115']];
// Normalise a stored welcome object to the exact editable shape, so dirty-checking is a plain
// JSON compare and every field is always a defined primitive.
const normWelcome = (w = {}) => ({
  enabled: !!w.enabled,
  channelId: w.channelId || '',
  joinMessage: w.joinMessage || '',
  leaveMessage: w.leaveMessage || '',
  gifBg: WBG.some(([k]) => k === w.gifBg) ? w.gifBg : 'dark',
  bgImage: w.bgImage || '',
});
const isMediaPath = (s) => /^\/api\/media\/[A-Za-z0-9._/-]+$/.test(s);
// Join-to-create: an enable flag + a list of lobby voice channels.
const normJtc = (j = {}) => ({
  enabled: !!j.enabled,
  lobbies: (Array.isArray(j.lobbies) ? j.lobbies : []).map((l) => ({
    lobbyChannelId: l.lobbyChannelId || '', categoryId: l.categoryId || '', tempCategoryName: l.tempCategoryName || '',
  })),
});
// Gated access: an enable flag + role-grant rules (each grants ONE role to members meeting its
// link requirements).
const normGating = (gt = {}) => ({
  enabled: !!gt.enabled,
  rules: (Array.isArray(gt.rules) ? gt.rules : []).map((r) => ({
    roleId: r.roleId || '', label: r.label || '',
    requireDiscord: r.requireDiscord !== false, requireBcweb: r.requireBcweb !== false, requireBmm: !!r.requireBmm,
  })),
});
// Blog-announcement routes for this server: a channel + which blogs feed it.
const BLOG_SRC = [['*', 'All'], ['bmm', 'BMM'], ['bsm', 'BSM'], ['community', 'Community'], ['installer', 'Installer'], ['developers', 'Developers'], ['showcase', 'Other projects']];
const normBlog = (bl = {}) => ({
  routes: (Array.isArray(bl.routes) ? bl.routes : []).map((r) => ({
    channelId: r.channelId || '', sources: (r.sources && r.sources.length ? r.sources : ['*']),
  })),
});
// Rule & role panels: a posted message with role buttons/dropdown. Roles are entered by id here
// (like every other id in this dashboard) rather than picked, so no guild role list is needed.
const normRp = (panels) => (Array.isArray(panels) ? panels : []).map((p) => ({
  id: p.id || '', channelId: p.channelId || '', title: p.title || '', body: p.body || '',
  asEmbed: p.asEmbed !== false, color: p.color || '#f59e0b', mode: p.mode === 'dropdown' ? 'dropdown' : 'buttons', multi: p.multi !== false,
  roles: (Array.isArray(p.roles) ? p.roles : []).map((r) => ({ roleId: r.roleId || '', label: r.label || '', emoji: r.emoji || '', style: r.style || 'secondary', description: r.description || '' })),
}));

// The guild's stored members — read-only, searchable, paginated. Only rendered for a pool-mode
// guild (the only mode that stores members). Strictly this one server: the endpoint pins the
// query to the guild id, so it can never show another server's roster.
function GuildMembers({ guildId }) {
  const { t } = useI18n();
  const toast = useToast();
  const dialog = useDialog();
  const [q, setQ] = useState('');
  const [data, setData] = useState(null);
  const [skip, setSkip] = useState(0);
  const TAKE = 20;
  // Queue a moderation action against one member of THIS server. The server re-checks that the
  // target is really a member of this guild, so the worst a crafted request can do is fail.
  const moderate = async (m, kind) => {
    let reason = '';
    if (kind !== 'untimeout' && kind !== 'unban') {
      const typed = await dialog.prompt({ title: t('ds.mod.why', 'Reason?'), message: t('ds.mod.whym', 'Sent to Discord with the action and kept with your name.'), danger: kind === 'ban' || kind === 'kick' });
      if (!typed || !String(typed).trim()) return;
      reason = String(typed).trim();
    }
    let minutes;
    if (kind === 'timeout') {
      const typed = await dialog.prompt({ title: t('ds.mod.mins', 'How many minutes?'), message: t('ds.mod.minsm', 'Discord allows up to 28 days (40320 minutes).') });
      minutes = Number(String(typed || '').trim());
      if (!Number.isFinite(minutes) || minutes < 1) return;
    }
    try {
      await api.post(`/me/discord/guilds/${guildId}/actions`, { kind, discordId: m.discordId, reason: reason || undefined, minutes });
      toast.success(t('ds.mod.queued', 'Queued — the bot carries it out shortly.'));
    } catch (x) {
      toast.error(x?.data?.error === 'cannot_moderate_self' ? t('ds.mod.self', 'You can’t moderate yourself.')
        : x?.data?.error === 'member_not_found' ? t('ds.mod.gone', 'That member is no longer in your server.')
        : x?.data?.error === 'reason_required' ? t('ds.mod.needreason', 'A reason is required.')
        : t('common.failed', 'Failed.'));
    }
  };
  useEffect(() => { setSkip(0); }, [q]);
  useEffect(() => {
    let alive = true;
    api.get(`/me/discord/guilds/${guildId}/members?q=${encodeURIComponent(q)}&take=${TAKE}&skip=${skip}`)
      .then((r) => { if (alive) setData(r); }).catch(() => { if (alive) setData({ members: [], total: 0 }); });
    return () => { alive = false; };
  }, [guildId, q, skip]);
  if (!data) return <div className="py-4 flex justify-center"><Spinner /></div>;
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('ds.mem.search', 'Search a member…')} className="flex-1" />
        <span className="text-[11px] text-[var(--faint)] shrink-0 tabular-nums">{data.total}</span>
      </div>
      {data.members.length === 0 ? <div className="text-[11px] text-[var(--faint)] py-2">{t('ds.mem.none', 'No members stored yet.')}</div> : (
        <div className="rounded-xl border border-[var(--line)] divide-y divide-[var(--line)] max-h-72 overflow-y-auto">
          {data.members.map((m) => (
            <div key={m.discordId} className="group px-3 py-2 flex items-center gap-2.5 text-xs">
              {m.avatar ? <img src={m.avatar} alt="" className="w-6 h-6 rounded-full shrink-0" /> : <span className="w-6 h-6 rounded-full bg-[var(--surface-2)] shrink-0" />}
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{m.nickname || m.username || m.discordId}</div>
                {m.roles?.length > 0 && <div className="truncate text-[10px] text-[var(--faint)]">{m.roles.slice(0, 5).join(' · ')}</div>}
              </div>
              {/* Moderation, this server only. Hidden until you hover the row so the list stays a
                  list; each opens a reason (and, for a timeout, a duration) prompt first. */}
              <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition">
                <button type="button" onClick={() => moderate(m, 'timeout')} title={t('ds.mod.timeout', 'Time out')} className="p-1.5 rounded-lg text-[var(--muted)] hover:text-warning hover:bg-[var(--surface-2)]"><Clock size={13} /></button>
                <button type="button" onClick={() => moderate(m, 'kick')} title={t('ds.mod.kick', 'Kick')} className="p-1.5 rounded-lg text-[var(--muted)] hover:text-error hover:bg-[var(--surface-2)]"><UserMinus size={13} /></button>
                <button type="button" onClick={() => moderate(m, 'ban')} title={t('ds.mod.ban', 'Ban')} className="p-1.5 rounded-lg text-[var(--muted)] hover:text-error hover:bg-[var(--surface-2)]"><Ban size={13} /></button>
              </div>
              {m.guildJoinedAt && <span className="text-[10px] text-[var(--faint)] shrink-0">{new Date(m.guildJoinedAt).toLocaleDateString()}</span>}
            </div>
          ))}
        </div>
      )}
      {data.total > TAKE && (
        <div className="flex items-center justify-between mt-2">
          <Button size="sm" variant="ghost" disabled={skip === 0} onClick={() => setSkip((s) => Math.max(0, s - TAKE))}>{t('common.prev', 'Prev')}</Button>
          <span className="text-[11px] text-[var(--faint)] tabular-nums">{skip + 1}–{Math.min(skip + TAKE, data.total)}</span>
          <Button size="sm" variant="ghost" disabled={skip + TAKE >= data.total} onClick={() => setSkip((s) => s + TAKE)}>{t('common.next', 'Next')}</Button>
        </div>
      )}
    </div>
  );
}

// One server's editable config. Fetches its own detail so a save reflects immediately.
function GuildConfig({ guildId, onSaved }) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [section, setSection] = useState('storage'); // which config section is shown
  const load = () => api.get(`/me/discord/guilds/${guildId}`).then((r) => { setData(r); setDraft({ memberMode: r.guild.memberMode, logChannelId: r.guild.logChannelId || '', storeLogs: !!r.guild.storeLogs, welcome: normWelcome(r.welcome), jtc: normJtc(r.joinToCreate), gating: normGating(r.gating), blog: normBlog(r.blog), rp: normRp(r.rolePanels) }); }).catch(() => setData({ error: true }));
  useEffect(() => { setData(null); setDraft(null); load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [guildId]);
  if (!data) return <div className="py-10 flex justify-center"><Spinner /></div>;
  if (data.error) return <EmptyState icon={MessageSquare} title={t('ds.gone', 'You can no longer manage this server')} sub={t('ds.gone.s', 'Your access may have changed on Discord.')} />;
  const g = data.guild;
  const name = (m) => (lang === 'fr' ? m.labelFr : m.label);
  const desc = (m) => (lang === 'fr' ? m.descFr : m.desc);
  const needsChannel = draft.memberMode === 'moderation' && !draft.logChannelId.trim();
  const welcomeDirty = JSON.stringify(draft.welcome) !== JSON.stringify(normWelcome(data.welcome));
  const jtcDirty = JSON.stringify(draft.jtc) !== JSON.stringify(normJtc(data.joinToCreate));
  const gatingDirty = JSON.stringify(draft.gating) !== JSON.stringify(normGating(data.gating));
  const blogDirty = JSON.stringify(draft.blog) !== JSON.stringify(normBlog(data.blog));
  const rpDirty = JSON.stringify(draft.rp) !== JSON.stringify(normRp(data.rolePanels));
  const dirty = draft.memberMode !== g.memberMode || (draft.logChannelId || '') !== (g.logChannelId || '') || draft.storeLogs !== g.storeLogs || welcomeDirty || jtcDirty || gatingDirty || blogDirty || rpDirty;
  const setW = (patch) => setDraft((d) => ({ ...d, welcome: { ...d.welcome, ...patch } }));
  const setJ = (patch) => setDraft((d) => ({ ...d, jtc: { ...d.jtc, ...patch } }));
  // Upload a welcome banner background in place — no trip to another page. Goes through the
  // same media store as everywhere else, so the result is a moderatable /api/media/ path.
  const pickWelcomeBg = () => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
    inp.onchange = async () => {
      const file = inp.files?.[0]; if (!file) return;
      try { toast.info(t('be.uploading', 'Uploading…')); const url = await uploadImage(file); setW({ bgImage: url }); }
      catch { toast.error(t('be.uploadfail', 'Upload failed.')); }
    };
    inp.click();
  };
  const setG = (patch) => setDraft((d) => ({ ...d, gating: { ...d.gating, ...patch } }));
  const setB = (routes) => setDraft((d) => ({ ...d, blog: { routes } }));
  const setRp = (panels) => setDraft((d) => ({ ...d, rp: panels }));
  const save = async () => {
    setBusy(true);
    try {
      const r = await api.put(`/me/discord/guilds/${guildId}`, { memberMode: draft.memberMode, logChannelId: draft.logChannelId.trim() || null, storeLogs: draft.storeLogs, welcome: draft.welcome, joinToCreate: draft.jtc, gating: draft.gating, blog: draft.blog, rolePanels: draft.rp });
      setData((d) => ({ ...d, guild: r.guild, welcome: r.welcome, joinToCreate: r.joinToCreate, gating: r.gating, blog: r.blog, rolePanels: r.rolePanels }));
      setDraft({ memberMode: r.guild.memberMode, logChannelId: r.guild.logChannelId || '', storeLogs: !!r.guild.storeLogs, welcome: normWelcome(r.welcome), jtc: normJtc(r.joinToCreate), gating: normGating(r.gating), blog: normBlog(r.blog), rp: normRp(r.rolePanels) });
      toast.success(t('ds.saved', 'Saved.'));
      onSaved?.();
    } catch (x) {
      toast.error(x?.data?.error === 'log_channel_required' ? t('ds.needchannel', 'Set a log channel first.')
        : x?.data?.error === 'not_found' ? t('ds.gone', 'You can no longer manage this server')
        : t('common.failed', 'Failed.'));
    } finally { setBusy(false); }
  };
  const showBudget = draft.memberMode === 'pool' || (draft.memberMode === 'moderation' && draft.storeLogs);
  // A pool is "usable" only if it is unlimited or has a cap ABOVE zero — a zero-cap pool holds
  // nothing, and treating it as present is what made this area look empty (a 0/0 bar, or a
  // warning that never fired). This drives the storage panel so it is never blank.
  const hasUsablePool = !!(g.capacity && (g.capacity.unlimited || Number(g.capacity.cap) > 0));
  // The dashboard is a set of SECTIONS you switch between, not one long scroll — you pick the
  // area you want to configure. The Members list only exists in pool mode (the only mode that
  // stores members). Each carries its own unsaved-changes dot so nothing hides behind a tab.
  const SECTIONS = [
    { id: 'storage', icon: Database, label: t('ds.sec.storage', 'Members & storage'), dirty: draft.memberMode !== g.memberMode || (draft.logChannelId || '') !== (g.logChannelId || '') || draft.storeLogs !== g.storeLogs },
    { id: 'welcome', icon: Sparkles, label: t('ds.sec.welcome', 'Welcome'), dirty: welcomeDirty },
    { id: 'voice', icon: Mic, label: t('ds.sec.voice', 'Voice'), dirty: jtcDirty },
    { id: 'roles', icon: Shield, label: t('ds.sec.roles', 'Auto-roles'), dirty: gatingDirty },
    { id: 'panels', icon: ScrollText, label: t('ds.sec.panels', 'Panels'), dirty: rpDirty },
    { id: 'blog', icon: Newspaper, label: t('ds.sec.blog', 'Blog'), dirty: blogDirty },
    ...(g.memberMode === 'pool' ? [{ id: 'members', icon: Users, label: t('ds.sec.members', 'Members'), dirty: false }] : []),
  ];
  return (
    <div>
      {/* Server hero — the same idiom as the admin bot dashboard: identity tile with a live
          dot, what you are here, then stat tiles. One card that says "this server, this bot,
          this state" before any control. */}
      <div className="rounded-xl border border-[#5865F2]/30 overflow-hidden mb-4 bg-[var(--surface-2)]/30">
        <div className="h-1 bg-gradient-to-r from-[#5865F2] via-[#5865F2]/60 to-transparent" />
        <div className="px-4 py-3.5 flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <span className="relative grid place-items-center w-12 h-12 rounded-xl bg-[#5865F2]/15 border border-[#5865F2]/30 shrink-0 overflow-hidden">
              {data.icon || g.icon ? <img src={data.icon || g.icon} alt="" className="w-full h-full object-cover" /> : <Server size={22} className="text-[#5865F2]" />}
              <span className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-[var(--bg-solid)] ${g.memberMode !== 'none' ? 'bg-success' : 'bg-[var(--line-strong)]'}`} title={g.memberMode !== 'none' ? t('ds.hero.active', 'Bot active here') : t('ds.hero.idle', 'Bot idle here')} />
            </span>
            <div className="min-w-0">
              <div className="font-bold text-base leading-tight flex items-center gap-2 flex-wrap"><span className="truncate">{g.name || guildId}</span> <Badge tone={g.role === 'owner' ? 'primary' : 'blue'}>{g.role === 'owner' ? t('ds.owner', 'Owner') : t('ds.manager', 'Manager')}</Badge></div>
              <div className="text-xs text-[var(--muted)] mt-0.5 flex items-center gap-1.5">
                <span className={`inline-flex items-center gap-1 font-medium ${g.memberMode !== 'none' ? 'text-success' : 'text-[var(--faint)]'}`}><span className={`w-1.5 h-1.5 rounded-full ${g.memberMode !== 'none' ? 'bg-success' : 'bg-[var(--line-strong)]'}`} /> {g.memberMode === 'pool' ? t('ds.hero.pool', 'Member database on') : g.memberMode === 'moderation' ? t('ds.hero.mod', 'Moderation on') : t('ds.hero.none', 'Nothing stored')}</span>
              </div>
            </div>
          </div>
          <div className="flex items-stretch gap-1.5 flex-wrap ms-auto">
            {[
              [(g.memberCount ?? 0).toLocaleString(), t('ds.membersshort', 'members'), Users],
              ...(g.memberMode === 'pool' ? [[(g.storedMembers ?? g.capacity?.stored ?? 0).toLocaleString(), t('ds.hero.stored', 'stored'), Database]] : []),
              ...(data.logs?.length ? [[data.logs.length, t('ds.hero.logs', 'recent logs'), ScrollText]] : []),
            ].map(([v, l, I], i) => (
              <div key={i} className="rounded-lg border border-[var(--line)] bg-[var(--bg-solid)]/60 px-3 py-1.5 min-w-[74px]">
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-[var(--faint)]"><I size={11} /> {l}</div>
                <div className="text-[15px] font-bold tabular-nums leading-tight text-[var(--text)] mt-0.5">{v}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Section nav — pick one area instead of scrolling the whole config. */}
      <div className="relative mb-4">
        <div className="pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-[var(--bg-solid)] to-transparent z-10 rounded-l-xl md:hidden" />
        <div className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-[var(--bg-solid)] to-transparent z-10 rounded-r-xl md:hidden" />
      <div className="flex gap-1 overflow-x-auto md:overflow-visible md:flex-wrap no-scrollbar p-1 rounded-xl border border-[var(--line)] bg-[var(--surface-2)]/40 snap-x snap-mandatory md:snap-none">
        {SECTIONS.map((s) => (
          <button key={s.id} type="button" onClick={(e) => { setSection(s.id); e.currentTarget.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' }); }}
            className={`shrink-0 snap-center inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition ${section === s.id ? 'bg-[var(--bg-solid)] text-[var(--text)] font-medium shadow-sm border border-[var(--line)]' : 'text-[var(--muted)] hover:text-[var(--text)] border border-transparent'}`}>
            <s.icon size={14} className={section === s.id ? 'text-[var(--primary-2)]' : ''} /> {s.label}
            {s.dirty && <span className="w-1.5 h-1.5 rounded-full bg-[var(--primary)]" title={t('ds.unsaved', 'Unsaved changes')} />}
          </button>
        ))}
      </div>
      </div>

      {section === 'storage' && <>
      {/* When the admin has chosen a global storage strategy, it overrides this per-server
          choice — so say so instead of letting the selector look like it decides. */}
      {(data.globalStorage?.mode === 'free' || data.globalStorage?.mode === 'unified') && (
        <div className="mb-3 rounded-lg border border-[var(--line)] bg-[var(--surface-2)]/50 p-3 flex items-start gap-2.5">
          <Database size={15} className="text-[var(--primary-2)] shrink-0 mt-0.5" />
          <div className="text-xs text-[var(--muted)]">
            {data.globalStorage.mode === 'unified'
              ? t('ds.gstore.unified', 'Members are stored site-wide (one entry per person, unified across servers) by an admin setting — the choice below is not used for storage on this server.')
              : t('ds.gstore.free', 'Members are stored site-wide by an admin setting — the choice below is not used for storage on this server. Moderation logs still follow it.')}
          </div>
        </div>
      )}
      <div className="text-[11px] uppercase tracking-wider text-[var(--faint)] mb-2">{t('ds.mode', 'How the bot handles your members')}</div>
      <div className="grid sm:grid-cols-3 gap-2 mb-4">
        {MODES.map((m) => {
          const on = draft.memberMode === m.id;
          return (
            <button key={m.id} type="button" onClick={() => setDraft({ ...draft, memberMode: m.id })}
              className={`text-start rounded-xl border p-3 transition ${on ? 'border-[var(--primary)] bg-[var(--primary)]/5' : 'border-[var(--line)] hover:border-[var(--primary)]/40'}`}>
              <div className="flex items-center gap-1.5 mb-1"><m.icon size={15} className={m.tone} /> <span className="text-sm font-medium flex-1">{name(m)}</span>{on && <Check size={14} className="text-[var(--primary-2)]" />}</div>
              <div className="text-[11px] text-[var(--faint)] leading-snug">{desc(m)}</div>
            </button>
          );
        })}
      </div>

      {draft.memberMode === 'moderation' && (
        <div className="space-y-3 mb-4">
          <Field label={t('ds.logchannel', 'Log channel ID')} hint={t('ds.logchannel.h', 'The Discord channel the bot posts moderation actions to. Right-click a channel in Discord → Copy Channel ID (Developer Mode on).')}>
            <ChannelPicker channels={data.channels} value={draft.logChannelId} onChange={(v) => setDraft({ ...draft, logChannelId: v })} />
          </Field>
          <label className="flex items-center gap-2.5 text-sm cursor-pointer">
            <input type="checkbox" checked={draft.storeLogs} onChange={(e) => setDraft({ ...draft, storeLogs: e.target.checked })} />
            <span>{t('ds.storelogs', 'Also keep a copy of moderation logs here')}</span>
          </label>
          <p className="text-[11px] text-[var(--faint)] -mt-1.5 ps-6">{t('ds.storelogs.h', 'Off = actions are posted to Discord only. On = a searchable copy is kept here and counts against your storage.')}</p>
        </div>
      )}
      {/* 'none' mode stores nothing — say so plainly instead of leaving the panel blank, so
          the area always explains the current choice rather than looking broken. */}
      {draft.memberMode === 'none' && (
        <div className="mb-4 rounded-xl border border-[var(--line)] bg-[var(--surface-2)]/40 p-3 flex items-start gap-2.5">
          <Shield size={16} className="text-[var(--faint)] shrink-0 mt-0.5" />
          <div className="text-xs text-[var(--muted)]">
            <div className="text-sm font-medium text-[var(--text)]">{t('ds.none.t', 'Nothing is stored')}</div>
            {t('ds.none.s', 'The bot stays in your server and answers commands, but keeps no member data and no logs here. Pick “Moderation only” to log actions, or “Member database” to power a member list and role gating.')}
          </div>
        </div>
      )}
      {/* Storing members needs a storage allowance (a pool an admin assigns). With none, the
          bot has nowhere to put them — so warn plainly instead of silently storing nothing. */}
      {showBudget && (
        hasUsablePool
          ? <Card className="p-3 mb-4"><CapacityBar cap={g.capacity} /></Card>
          : <div className="mb-4 rounded-xl border border-warning-border bg-warning/[0.08] p-3">
              <div className="flex items-start gap-2.5">
                <AlertTriangle size={16} className="text-warning shrink-0 mt-0.5" />
                <div className="text-xs text-[var(--muted)] min-w-0">
                  <div className="text-sm font-medium text-warning">{t('ds.nopool.t', 'No storage pool assigned')}</div>
                  {t('ds.nopool.s2', 'This mode stores members, but this server has no storage pool yet — so nothing is actually kept. Get a storage pool to hold them, or switch to “moderation logs only”.')}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap mt-2.5 ps-[26px]">
                <Link to="/hosting"><Button size="sm" variant="primary"><Gauge size={13} /> {t('ds.nopool.buy', 'Get a storage pool')}</Button></Link>
                <span className="text-[11px] text-[var(--faint)]">{t('ds.nopool.or', 'or ask an admin to assign one to this server')}</span>
              </div>
            </div>
      )}
      {data.logs?.length > 0 && (
        <div className="mb-4">
          <div className="text-[11px] uppercase tracking-wider text-[var(--faint)] mb-2 flex items-center gap-1.5"><ScrollText size={12} /> {t('ds.recentlogs', 'Recent moderation')}</div>
          <div className="rounded-xl border border-[var(--line)] max-h-56 overflow-y-auto divide-y divide-[var(--line)]">
            {data.logs.map((l) => (
              <div key={l.id} className="px-3 py-2 flex items-baseline gap-2 text-xs">
                <Badge tone="blue">{l.action}</Badge>
                <span className="truncate flex-1 text-[var(--muted)]">{l.reason || l.targetTag || l.targetId}</span>
                <span className="text-[10px] text-[var(--faint)] shrink-0">{new Date(l.createdAt).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      </>}

      {/* Welcome / bye — owner-editable per-server banner & messages (was admin-only). */}
      {section === 'welcome' && (
      <div className="rounded-xl border border-[var(--line)] p-3 mb-4">
        <label className="flex items-center gap-2.5 text-sm font-medium cursor-pointer select-none">
          <input type="checkbox" checked={draft.welcome.enabled} onChange={(e) => setW({ enabled: e.target.checked })} />
          <Sparkles size={15} className="text-[var(--primary-2)]" /> {t('ds.wc', 'Welcome & bye banner')}
        </label>
        <p className="text-[11px] text-[var(--faint)] ps-6 mt-0.5">{t('ds.wc.h', 'A banner + message the bot posts when someone joins or leaves your server.')}</p>
        {draft.welcome.enabled && (
          <div className="space-y-3 mt-3">
            <Field label={t('ds.wc.channel', 'Channel ID')} hint={t('ds.wc.channel.h', 'Where the banner is posted. Right-click a Discord channel → Copy Channel ID (Developer Mode on).')}>
              <ChannelPicker channels={data.channels} value={draft.welcome.channelId} onChange={(v) => setW({ channelId: v })} />
            </Field>
            <Field label={t('ds.wc.join', 'Join message')} hint="{user} {username} {servername} {joinnumber} {joindate}">
              <Input value={draft.welcome.joinMessage} onChange={(e) => setW({ joinMessage: e.target.value.slice(0, 500) })} placeholder={t('ds.wc.join.ph', 'Welcome {user} to {servername}!')} />
            </Field>
            <Field label={t('ds.wc.leave', 'Leave message')}>
              <Input value={draft.welcome.leaveMessage} onChange={(e) => setW({ leaveMessage: e.target.value.slice(0, 500) })} placeholder={t('ds.wc.leave.ph', '{username} has left.')} />
            </Field>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--faint)] mb-1.5">{t('ds.wc.bg', 'Banner background')}</div>
              <div className="flex flex-wrap gap-1.5">
                {WBG.map(([k, col]) => (
                  <button key={k} type="button" onClick={() => setW({ gifBg: k })} title={k}
                    className={`w-8 h-8 rounded-lg border-2 transition ${draft.welcome.gifBg === k ? 'border-[var(--primary)] scale-105' : 'border-[var(--line)] hover:border-[var(--line-strong)]'}`} style={{ background: col }} />
                ))}
              </div>
              <Field className="mt-2.5" label={t('ds.wc.bgimg', 'Custom background (optional)')}
                hint={t('ds.wc.bgimg.h2', 'Replaces the colour. Upload an image right here — it is stored on the site (a /api/media/… link) so it can be reviewed and removed.')}>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Button size="sm" variant="ghost" onClick={pickWelcomeBg}><ImageIcon size={13} /> {t('ds.wc.bgimg.upload', 'Upload')}</Button>
                  <Input className="flex-1 min-w-[140px]" value={draft.welcome.bgImage} onChange={(e) => setW({ bgImage: e.target.value.slice(0, 300) })} placeholder="/api/media/blog/…" />
                  {draft.welcome.bgImage && <button type="button" onClick={() => setW({ bgImage: '' })} className="px-1.5 rounded-lg text-error hover:bg-error-bg shrink-0" title={t('common.remove', 'Remove')}>×</button>}
                </div>
              </Field>
              {draft.welcome.bgImage && !isMediaPath(draft.welcome.bgImage) && (
                <div className="text-[11px] text-warning flex items-center gap-1 mt-1"><AlertTriangle size={11} /> {t('ds.wc.bgimg.bad', 'Not an uploaded-media link — it must start with /api/media/. The colour will be used instead.')}</div>
              )}
            </div>
          </div>
        )}
      </div>
      )}

      {/* Join-to-create voice — owner-editable per-server (was admin-only). */}
      {section === 'voice' && (
      <div className="rounded-xl border border-[var(--line)] p-3 mb-4">
        <label className="flex items-center gap-2.5 text-sm font-medium cursor-pointer select-none">
          <input type="checkbox" checked={draft.jtc.enabled} onChange={(e) => setJ({ enabled: e.target.checked })} />
          <Mic size={15} className="text-[var(--primary-2)]" /> {t('ds.jtc', 'Join-to-create voice')}
        </label>
        <p className="text-[11px] text-[var(--faint)] ps-6 mt-0.5">{t('ds.jtc.h', 'Joining a lobby voice channel spawns a personal temporary room for that member.')}</p>
        {draft.jtc.enabled && (
          <div className="space-y-2 mt-3">
            {draft.jtc.lobbies.length === 0 && <div className="text-[11px] text-[var(--faint)]">{t('ds.jtc.none', 'No lobbies yet — add one. Joining that voice channel spawns a temp room in its category.')}</div>}
            {draft.jtc.lobbies.map((lb, i) => (
              <div key={i} className="rounded-lg border border-[var(--line)] p-2.5 space-y-2 relative">
                <button type="button" onClick={() => setJ({ lobbies: draft.jtc.lobbies.filter((_, k) => k !== i) })} className="absolute top-2 right-2 text-[var(--faint)] hover:text-error" title={t('common.remove', 'Remove')}><Trash2 size={13} /></button>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--faint)]">{t('ds.jtc.lobbyn', 'Lobby {n}').replace('{n}', i + 1)}</div>
                <ChannelPicker channels={data.channels} types={[2]} value={lb.lobbyChannelId} placeholder={t('ds.jtc.lobbych', 'Lobby voice channel ID')} onChange={(v) => setJ({ lobbies: draft.jtc.lobbies.map((x, k) => k === i ? { ...x, lobbyChannelId: v } : x) })} />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <ChannelPicker channels={data.channels} types={[4]} value={lb.categoryId} placeholder={t('ds.jtc.catid', 'Category ID (auto if empty)')} onChange={(v) => setJ({ lobbies: draft.jtc.lobbies.map((x, k) => k === i ? { ...x, categoryId: v } : x) })} />
                  <Input value={lb.tempCategoryName} onChange={(e) => setJ({ lobbies: draft.jtc.lobbies.map((x, k) => k === i ? { ...x, tempCategoryName: e.target.value.slice(0, 100) } : x) })} placeholder={t('ds.jtc.tempcat', 'Temp category name')} />
                </div>
              </div>
            ))}
            {draft.jtc.lobbies.length < 20 && <Button size="sm" variant="ghost" onClick={() => setJ({ lobbies: [...draft.jtc.lobbies, { lobbyChannelId: '', categoryId: '', tempCategoryName: 'Temp Voice' }] })}><Plus size={13} /> {t('ds.jtc.add', 'Add lobby')}</Button>}
          </div>
        )}
      </div>
      )}

      {/* Gated access — owner-editable per-server role grants (was admin-only). */}
      {section === 'roles' && (
      <div className="rounded-xl border border-[var(--line)] p-3 mb-4">
        <label className="flex items-center gap-2.5 text-sm font-medium cursor-pointer select-none">
          <input type="checkbox" checked={draft.gating.enabled} onChange={(e) => setG({ enabled: e.target.checked })} />
          <Shield size={15} className="text-[var(--primary-2)]" /> {t('ds.gate', 'Gated access (auto roles)')}
        </label>
        <p className="text-[11px] text-[var(--faint)] ps-6 mt-0.5">{t('ds.gate.h', 'Each rule grants ONE Discord role to members who meet its link requirements. Re-checked every ~5 min; members can run /refreshroles to sync instantly.')}</p>
        {draft.gating.enabled && (
          <div className="space-y-2 mt-3">
            {draft.gating.rules.length === 0 && <div className="text-[11px] text-[var(--faint)]">{t('ds.gate.none', 'No role rules yet — add one to start gating.')}</div>}
            {draft.gating.rules.map((r, i) => {
              const updRule = (patch) => setG({ rules: draft.gating.rules.map((x, k) => k === i ? { ...x, ...patch } : x) });
              return (
                <div key={i} className="rounded-lg border border-[var(--line)] p-2.5 space-y-2 relative">
                  <button type="button" onClick={() => setG({ rules: draft.gating.rules.filter((_, k) => k !== i) })} className="absolute top-2 right-2 text-[var(--faint)] hover:text-error" title={t('common.remove', 'Remove')}><Trash2 size={13} /></button>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pe-6">
                    <Field label={t('ds.gate.roleid', 'Role ID')}><RolePicker roles={data.roles} value={r.roleId} onChange={(v) => updRule({ roleId: v })} /></Field>
                    <Field label={t('ds.gate.label', 'Label (for messages)')}><Input value={r.label} onChange={(e) => updRule({ label: e.target.value.slice(0, 60) })} placeholder={t('ds.gate.labelph', 'Verified / Creator…')} /></Field>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    <label className="flex items-center gap-1.5 text-xs cursor-pointer"><input type="checkbox" checked={r.requireDiscord} onChange={(e) => updRule({ requireDiscord: e.target.checked })} /> {t('ds.gate.reqdiscord', 'Linked Discord')}</label>
                    <label className="flex items-center gap-1.5 text-xs cursor-pointer"><input type="checkbox" checked={r.requireBcweb} onChange={(e) => updRule({ requireBcweb: e.target.checked })} /> {t('ds.gate.reqbcweb', 'BCWEB account')}</label>
                    <label className="flex items-center gap-1.5 text-xs cursor-pointer"><input type="checkbox" checked={r.requireBmm} onChange={(e) => updRule({ requireBmm: e.target.checked })} /> {t('ds.gate.reqbmm', 'BMM creator id')}</label>
                  </div>
                </div>
              );
            })}
            {draft.gating.rules.length < 30 && <Button size="sm" variant="ghost" onClick={() => setG({ rules: [...draft.gating.rules, { roleId: '', label: '', requireDiscord: true, requireBcweb: true, requireBmm: false }] })}><Plus size={13} /> {t('ds.gate.add', 'Add role rule')}</Button>}
          </div>
        )}
      </div>
      )}

      {/* Rule & role panels — owner-editable for THIS server. A posted message with role buttons
          or a dropdown; roles are entered by id (like every other id here). */}
      {section === 'panels' && (
      <div className="rounded-xl border border-[var(--line)] p-3 mb-4">
        <div className="flex items-center gap-2.5 text-sm font-medium"><ScrollText size={15} className="text-[var(--primary-2)]" /> {t('ds.rp', 'Rule & role panels')}</div>
        <p className="text-[11px] text-[var(--faint)] mt-0.5">{t('ds.rp.h', 'A posted message with self-assign role buttons or a dropdown. Saving publishes it; the bot edits it in place when you change it.')}</p>
        <div className="space-y-2 mt-3">
          {draft.rp.length === 0 && <div className="text-[11px] text-[var(--faint)]">{t('ds.rp.none', 'No panels yet — add one.')}</div>}
          {draft.rp.map((pnl, i) => {
            const setP = (patch) => setRp(draft.rp.map((x, k) => k === i ? { ...x, ...patch } : x));
            const setRole = (ri, patch) => setP({ roles: pnl.roles.map((x, k) => k === ri ? { ...x, ...patch } : x) });
            return (
              <div key={i} className="rounded-lg border border-[var(--line)] p-2.5 space-y-2 relative">
                <button type="button" onClick={() => setRp(draft.rp.filter((_, k) => k !== i))} className="absolute top-2 right-2 text-[var(--faint)] hover:text-error" title={t('common.remove', 'Remove')}><Trash2 size={13} /></button>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--faint)] pe-6">{pnl.title || t('ds.rp.untitled', '(untitled panel)')} · {pnl.roles.length} {t('ds.rp.roles', 'roles')}</div>
                <div className="grid sm:grid-cols-2 gap-2">
                  <Input value={pnl.channelId} onChange={(e) => setP({ channelId: e.target.value.replace(/[^0-9]/g, '').slice(0, 32) })} placeholder={t('ds.rp.chan', 'Channel ID')} />
                  <Input value={pnl.title} onChange={(e) => setP({ title: e.target.value.slice(0, 256) })} placeholder={t('ds.rp.title', 'Title')} />
                </div>
                <Textarea rows={3} value={pnl.body} onChange={(e) => setP({ body: e.target.value.slice(0, 3800) })} placeholder={t('ds.rp.body', 'Message (Discord markdown — the rules go here)')} />
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-1.5 text-xs cursor-pointer"><input type="checkbox" checked={pnl.asEmbed} onChange={(e) => setP({ asEmbed: e.target.checked })} /> {t('ds.rp.embed', 'Embed')}</label>
                  {pnl.asEmbed && <input type="color" value={pnl.color} onChange={(e) => setP({ color: e.target.value })} className="w-8 h-7 rounded border border-[var(--line)] bg-transparent p-0.5 cursor-pointer" title={t('ds.rp.color', 'Colour')} />}
                  <Select className="!w-auto !py-1.5 text-xs" value={pnl.mode} onChange={(e) => setP({ mode: e.target.value })}>
                    <option value="buttons">{t('ds.rp.buttons', 'Buttons')}</option>
                    <option value="dropdown">{t('ds.rp.dropdown', 'Dropdown')}</option>
                  </Select>
                  {pnl.mode === 'dropdown' && <label className="flex items-center gap-1.5 text-xs cursor-pointer"><input type="checkbox" checked={pnl.multi} onChange={(e) => setP({ multi: e.target.checked })} /> {t('ds.rp.multi', 'Several at once')}</label>}
                </div>
                <div className="ps-2 ms-1 border-s-2 border-[var(--line)] space-y-1.5">
                  {pnl.roles.map((r, ri) => (
                    <div key={ri} className="flex flex-wrap items-center gap-1.5">
                      <span className="flex-1 min-w-[130px] inline-block"><RolePicker roles={data.roles} value={r.roleId} onChange={(v) => setRole(ri, { roleId: v })} placeholder={t('ds.rp.roleid', 'Role ID')} /></span>
                      <Input value={r.label} onChange={(e) => setRole(ri, { label: e.target.value.slice(0, 80) })} placeholder={t('ds.rp.label', 'Label')} className="flex-1 !min-w-[100px]" />
                      <Input value={r.emoji} onChange={(e) => setRole(ri, { emoji: e.target.value.slice(0, 40) })} placeholder={t('ds.rp.emoji', 'Emoji')} className="!w-16 shrink-0" />
                      <button type="button" onClick={() => setP({ roles: pnl.roles.filter((_, k) => k !== ri) })} className="p-1.5 text-[var(--faint)] hover:text-error" title={t('common.remove', 'Remove')}><Trash2 size={12} /></button>
                    </div>
                  ))}
                  {pnl.roles.length < 25 && <Button size="sm" variant="ghost" onClick={() => setP({ roles: [...pnl.roles, { roleId: '', label: '', emoji: '', style: 'secondary', description: '' }] })}><Plus size={12} /> {t('ds.rp.addrole', 'Add a role')}</Button>}
                </div>
              </div>
            );
          })}
          {draft.rp.length < 20 && <Button size="sm" variant="ghost" onClick={() => setRp([...draft.rp, { id: '', channelId: '', title: '', body: '', asEmbed: true, color: '#f59e0b', mode: 'buttons', multi: true, roles: [] }])}><Plus size={13} /> {t('ds.rp.add', 'Add a panel')}</Button>}
        </div>
      </div>
      )}

      {/* Blog announcements — owner-editable routes for THIS server only. Each posts the chosen
          blogs to a channel. A route with no channel is dropped on save. */}
      {section === 'blog' && (
      <div className="rounded-xl border border-[var(--line)] p-3 mb-4">
        <div className="flex items-center gap-2.5 text-sm font-medium"><Newspaper size={15} className="text-[var(--primary-2)]" /> {t('ds.blog', 'Blog announcements')}</div>
        <p className="text-[11px] text-[var(--faint)] mt-0.5">{t('ds.blog.h', 'Post new blog posts to a channel in your server — pick which blogs feed each channel.')}</p>
        <div className="space-y-2 mt-3">
          {draft.blog.routes.length === 0 && <div className="text-[11px] text-[var(--faint)]">{t('ds.blog.none', 'No routes yet — add one to announce blog posts in your server.')}</div>}
          {draft.blog.routes.map((r, i) => {
            const toggleSrc = (key) => {
              const cur = r.sources || ['*'];
              let nextS;
              if (key === '*') nextS = ['*'];
              else { nextS = cur.includes('*') ? [key] : cur.includes(key) ? cur.filter((s) => s !== key) : [...cur, key]; if (!nextS.length) nextS = ['*']; }
              setB(draft.blog.routes.map((x, k) => k === i ? { ...x, sources: nextS } : x));
            };
            return (
              <div key={i} className="rounded-lg border border-[var(--line)] p-2.5 space-y-2 relative">
                <button type="button" onClick={() => setB(draft.blog.routes.filter((_, k) => k !== i))} className="absolute top-2 right-2 text-[var(--faint)] hover:text-error" title={t('common.remove', 'Remove')}><Trash2 size={13} /></button>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--faint)]">{t('ds.blog.routen', 'Channel {n}').replace('{n}', i + 1)}</div>
                <Input value={r.channelId} onChange={(e) => setB(draft.blog.routes.map((x, k) => k === i ? { ...x, channelId: e.target.value.replace(/[^0-9]/g, '').slice(0, 32) } : x))} placeholder={t('ds.blog.chan', 'Channel ID')} />
                <div className="flex flex-wrap gap-1.5 pe-6">
                  {BLOG_SRC.map(([key, label]) => {
                    const on = (r.sources || ['*']).includes(key);
                    return (
                      <button key={key} type="button" onClick={() => toggleSrc(key)}
                        className={`px-2 py-0.5 rounded-md text-[11px] border transition ${on ? 'bg-[var(--primary)]/15 border-[var(--primary)]/40 text-[var(--primary-2)]' : 'border-[var(--line)] text-[var(--muted)] hover:text-[var(--text)]'}`}>{label}</button>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {draft.blog.routes.length < 10 && <Button size="sm" variant="ghost" onClick={() => setB([...draft.blog.routes, { channelId: '', sources: ['*'] }])}><Plus size={13} /> {t('ds.blog.add', 'Add channel')}</Button>}
        </div>
      </div>
      )}

      {/* The guild's stored roster — only in pool mode (the only mode that stores members), and
          only your own server's members, never another's. */}
      {section === 'members' && (
        <div className="mb-4">
          <div className="text-[11px] uppercase tracking-wider text-[var(--faint)] mb-2 flex items-center gap-1.5"><Users size={12} /> {t('ds.mem', 'Your members')}</div>
          <GuildMembers guildId={guildId} />
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button variant="primary" disabled={busy || !dirty || needsChannel} onClick={save}>{busy ? <Spinner /> : <><Check size={15} /> {t('common.save', 'Save')}</>}</Button>
        {needsChannel && <span className="text-[11px] text-warning">{t('ds.needchannel', 'Set a log channel first.')}</span>}
      </div>
    </div>
  );
}

// Inline Discord account linking — the same code-redeem the profile page uses, so a server
// owner can link without leaving the dashboard. Calls onLinked() so the parent re-fetches
// its guild list once the account is attached.
function DiscordLinkInline({ onLinked }) {
  const { t } = useI18n();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const link = async () => {
    if (!code.trim()) return;
    setBusy(true); setMsg('');
    try { await api.post('/me/discord/redeem', { code: code.trim() }); setCode(''); setMsg('linked'); onLinked?.(); }
    catch (x) { setMsg(x.data?.error === 'already_linked' ? 'taken' : x.data?.error === 'invalid_or_expired' ? 'bad' : 'error'); }
    finally { setBusy(false); }
  };
  return (
    <div className="text-start">
      <div className="flex gap-2">
        <Input value={code} maxLength={9} onChange={(e) => { const s = e.target.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 8); setCode(s.length > 4 ? `${s.slice(0, 4)}-${s.slice(4)}` : s); }} placeholder={t('disl.ph', 'Code from /link (e.g. K7P39QMX)')} onKeyDown={(e) => e.key === 'Enter' && link()} />
        <Button variant="primary" disabled={busy} onClick={link}>{busy ? <Spinner /> : t('cl.link', 'Link')}</Button>
      </div>
      {msg === 'linked' && <div className="text-sm text-success mt-2 flex items-center gap-1"><Check size={14} /> {t('disl.ok', 'Discord linked.')}</div>}
      {msg === 'taken' && <div className="text-sm text-error mt-2">{t('disl.taken', 'That Discord account is already linked.')}</div>}
      {msg === 'bad' && <div className="text-sm text-error mt-2">{t('cl.bad', 'Invalid or expired code.')}</div>}
      {msg === 'error' && <div className="text-sm text-error mt-2">{t('cl.error', 'Something went wrong.')}</div>}
    </div>
  );
}

export function MyDiscordServers() {
  const { t } = useI18n();
  const [state, setState] = useState(null); // { linked, guilds }
  const [sel, setSel] = useState(null);
  const load = () => api.get('/me/discord/guilds').then((r) => { setState(r); setSel((s) => s || r.guilds?.[0]?.guildId || null); }).catch(() => setState({ linked: false, guilds: [] }));
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  if (!state) return <div className="py-10 flex justify-center"><Spinner /></div>;
  // The bot's OAuth2 invite URL, built from its application id. A curated permission set (manage
  // roles/channels, kick/ban/timeout, move members, send/embed/history/view) — not Administrator.
  const inviteUrl = state.appId ? `https://discord.com/oauth2/authorize?client_id=${state.appId}&permissions=1099796925462&scope=bot%20applications.commands` : null;
  const InviteBtn = inviteUrl ? <a href={inviteUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium text-white bg-[#5865F2] hover:opacity-90 transition"><DiscordIcon size={16} className="text-white" /> {t('ds.invite', 'Invite the bot')}</a> : null;
  if (!state.linked) {
    return (
      <div className="max-w-md mx-auto text-center py-8">
        <span className="grid place-items-center w-14 h-14 rounded-2xl bg-[#5865F2]/10 mx-auto mb-3"><DiscordIcon size={26} className="text-[#5865F2]" /></span>
        <h2 className="font-semibold text-lg">{t('ds.nolink', 'Link your Discord account')}</h2>
        <p className="text-sm text-[var(--muted)] mt-1 mb-4">{t('ds.nolink.s2', 'Run')} <code className="px-1 rounded bg-[var(--surface-2)]">/link</code> {t('ds.nolink.s3', 'in any server the bot is in to get a code, then paste it here — no need to leave this page. The servers you own or manage then appear here.')}</p>
        {/* Link right here rather than bouncing to the profile page — this IS where someone
            arrives wanting to manage their server. Same redeem flow. */}
        <DiscordLinkInline onLinked={load} />
        <div className="mt-4 pt-4 border-t border-[var(--line)] flex items-center justify-center gap-2 flex-wrap">
          <span className="text-xs text-[var(--faint)]">{t('ds.nolink.notin', 'Bot not in your server yet?')}</span>
          {InviteBtn}
        </div>
      </div>
    );
  }
  if (!state.guilds.length) {
    return <EmptyState icon={MessageSquare} title={t('ds.noguilds', 'No servers to manage yet')}
      sub={t('ds.noguilds.s', 'You’ll see a server here once our Discord bot is in a server you own or have Manage Server on. Add it below.')}>
      {InviteBtn}
    </EmptyState>;
  }
  return (
    <div>
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <MessageSquare size={16} className="text-[var(--primary-2)]" /><h2 className="font-semibold">{t('ds.title', 'My Discord servers')}</h2>
        {inviteUrl && <a href={inviteUrl} target="_blank" rel="noreferrer" className="ms-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-white bg-[#5865F2] hover:opacity-90 transition"><DiscordIcon size={15} className="text-white" /> {t('ds.invite', 'Invite the bot')}</a>}
      </div>
      <div className="grid md:grid-cols-[minmax(0,240px)_1fr] gap-4">
        {/* Server picker — a column on desktop, a scrolling row on mobile. */}
        <div className="flex md:flex-col gap-2 overflow-x-auto md:overflow-visible pb-1 md:pb-0">
          {state.guilds.map((g) => (
            <button key={g.guildId} type="button" onClick={() => setSel(g.guildId)}
              className={`text-start rounded-xl border px-3 py-2.5 shrink-0 md:shrink w-56 md:w-auto transition ${sel === g.guildId ? 'border-[var(--primary)] bg-[var(--primary)]/5' : 'border-[var(--line)] hover:border-[var(--primary)]/40'}`}>
              <div className="text-sm font-medium truncate flex items-center gap-2">
                {g.icon ? <img src={g.icon} alt="" className="w-6 h-6 rounded-lg shrink-0 object-cover" /> : <span className="grid place-items-center w-6 h-6 rounded-lg bg-[#5865F2]/15 shrink-0"><Server size={12} className="text-[#5865F2]" /></span>}
                <span className="truncate">{g.name || g.guildId}</span>
              </div>
              <div className="text-[11px] text-[var(--faint)] mt-0.5 flex items-center gap-2">
                <span>{(g.memberCount ?? 0).toLocaleString()} {t('ds.membersshort', 'members')}</span>
                {g.memberMode !== 'none' && <Badge tone={g.memberMode === 'pool' ? 'primary' : 'blue'}>{g.memberMode}</Badge>}
              </div>
            </button>
          ))}
        </div>
        <Card className="p-4 min-w-0">
          {sel ? <GuildConfig guildId={sel} onSaved={load} /> : <div className="text-sm text-[var(--muted)]">{t('ds.pick', 'Pick a server.')}</div>}
        </Card>
      </div>
    </div>
  );
}

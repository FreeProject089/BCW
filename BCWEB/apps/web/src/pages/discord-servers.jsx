import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { MessageSquare, Server, Shield, Database, MinusCircle, Users, Check, Link2, ScrollText, Gauge, Sparkles, Image as ImageIcon, AlertTriangle, Mic, Plus, Trash2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { Card, Button, Badge, Input, Field, Spinner, EmptyState, useToast } from '../ui/ui.jsx';

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

// The guild's stored members — read-only, searchable, paginated. Only rendered for a pool-mode
// guild (the only mode that stores members). Strictly this one server: the endpoint pins the
// query to the guild id, so it can never show another server's roster.
function GuildMembers({ guildId }) {
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const [data, setData] = useState(null);
  const [skip, setSkip] = useState(0);
  const TAKE = 20;
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
            <div key={m.discordId} className="px-3 py-2 flex items-center gap-2.5 text-xs">
              {m.avatar ? <img src={m.avatar} alt="" className="w-6 h-6 rounded-full shrink-0" /> : <span className="w-6 h-6 rounded-full bg-[var(--surface-2)] shrink-0" />}
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{m.nickname || m.username || m.discordId}</div>
                {m.roles?.length > 0 && <div className="truncate text-[10px] text-[var(--faint)]">{m.roles.slice(0, 5).join(' · ')}</div>}
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
  const load = () => api.get(`/me/discord/guilds/${guildId}`).then((r) => { setData(r); setDraft({ memberMode: r.guild.memberMode, logChannelId: r.guild.logChannelId || '', storeLogs: !!r.guild.storeLogs, welcome: normWelcome(r.welcome), jtc: normJtc(r.joinToCreate), gating: normGating(r.gating) }); }).catch(() => setData({ error: true }));
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
  const dirty = draft.memberMode !== g.memberMode || (draft.logChannelId || '') !== (g.logChannelId || '') || draft.storeLogs !== g.storeLogs || welcomeDirty || jtcDirty || gatingDirty;
  const setW = (patch) => setDraft((d) => ({ ...d, welcome: { ...d.welcome, ...patch } }));
  const setJ = (patch) => setDraft((d) => ({ ...d, jtc: { ...d.jtc, ...patch } }));
  const setG = (patch) => setDraft((d) => ({ ...d, gating: { ...d.gating, ...patch } }));
  const save = async () => {
    setBusy(true);
    try {
      const r = await api.put(`/me/discord/guilds/${guildId}`, { memberMode: draft.memberMode, logChannelId: draft.logChannelId.trim() || null, storeLogs: draft.storeLogs, welcome: draft.welcome, joinToCreate: draft.jtc, gating: draft.gating });
      setData((d) => ({ ...d, guild: r.guild, welcome: r.welcome, joinToCreate: r.joinToCreate, gating: r.gating }));
      setDraft({ memberMode: r.guild.memberMode, logChannelId: r.guild.logChannelId || '', storeLogs: !!r.guild.storeLogs, welcome: normWelcome(r.welcome), jtc: normJtc(r.joinToCreate), gating: normGating(r.gating) });
      toast.success(t('ds.saved', 'Saved.'));
      onSaved?.();
    } catch (x) {
      toast.error(x?.data?.error === 'log_channel_required' ? t('ds.needchannel', 'Set a log channel first.')
        : x?.data?.error === 'not_found' ? t('ds.gone', 'You can no longer manage this server')
        : t('common.failed', 'Failed.'));
    } finally { setBusy(false); }
  };
  const showBudget = draft.memberMode === 'pool' || (draft.memberMode === 'moderation' && draft.storeLogs);
  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <Server size={16} className="text-[var(--primary-2)]" />
        <span className="font-semibold">{g.name || guildId}</span>
        <Badge tone={g.role === 'owner' ? 'primary' : 'blue'}>{g.role === 'owner' ? t('ds.owner', 'Owner') : t('ds.manager', 'Manager')}</Badge>
      </div>
      <div className="text-xs text-[var(--muted)] mb-4 flex items-center gap-1.5"><Users size={13} /> {t('ds.members', '{n} members').replace('{n}', (g.memberCount ?? 0).toLocaleString())}</div>

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
            <Input value={draft.logChannelId} onChange={(e) => setDraft({ ...draft, logChannelId: e.target.value.replace(/[^0-9]/g, '').slice(0, 32) })} placeholder="123456789012345678" />
          </Field>
          <label className="flex items-center gap-2.5 text-sm cursor-pointer">
            <input type="checkbox" checked={draft.storeLogs} onChange={(e) => setDraft({ ...draft, storeLogs: e.target.checked })} />
            <span>{t('ds.storelogs', 'Also keep a copy of moderation logs here')}</span>
          </label>
          <p className="text-[11px] text-[var(--faint)] -mt-1.5 ps-6">{t('ds.storelogs.h', 'Off = actions are posted to Discord only. On = a searchable copy is kept here and counts against your storage.')}</p>
        </div>
      )}

      {/* Welcome / bye — owner-editable per-server banner & messages (was admin-only). */}
      <div className="rounded-xl border border-[var(--line)] p-3 mb-4">
        <label className="flex items-center gap-2.5 text-sm font-medium cursor-pointer select-none">
          <input type="checkbox" checked={draft.welcome.enabled} onChange={(e) => setW({ enabled: e.target.checked })} />
          <Sparkles size={15} className="text-[var(--primary-2)]" /> {t('ds.wc', 'Welcome & bye banner')}
        </label>
        <p className="text-[11px] text-[var(--faint)] ps-6 mt-0.5">{t('ds.wc.h', 'A banner + message the bot posts when someone joins or leaves your server.')}</p>
        {draft.welcome.enabled && (
          <div className="space-y-3 mt-3">
            <Field label={t('ds.wc.channel', 'Channel ID')} hint={t('ds.wc.channel.h', 'Where the banner is posted. Right-click a Discord channel → Copy Channel ID (Developer Mode on).')}>
              <Input value={draft.welcome.channelId} onChange={(e) => setW({ channelId: e.target.value.replace(/[^0-9]/g, '').slice(0, 32) })} placeholder="123456789012345678" />
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
                hint={t('ds.wc.bgimg.h', 'Replaces the colour. Upload an image on the Uploads page, then paste its /api/media/… link here — it is stored on the site so it can be reviewed and removed.')}>
                <div className="flex items-center gap-1.5">
                  <ImageIcon size={14} className="text-[var(--faint)] shrink-0" />
                  <Input value={draft.welcome.bgImage} onChange={(e) => setW({ bgImage: e.target.value.slice(0, 300) })} placeholder="/api/media/blog/…" />
                  {draft.welcome.bgImage && <button type="button" onClick={() => setW({ bgImage: '' })} className="px-1.5 rounded-lg text-error hover:bg-error-bg shrink-0" title={t('common.remove', 'Remove')}>×</button>}
                </div>
              </Field>
              {draft.welcome.bgImage && !isMediaPath(draft.welcome.bgImage) && (
                <div className="text-[11px] text-warning flex items-center gap-1 mt-1"><AlertTriangle size={11} /> {t('ds.wc.bgimg.bad', 'Not an uploaded-media link — it must start with /api/media/. The colour will be used instead.')}</div>
              )}
              <Link to="/uploads" className="text-[11px] text-[var(--primary-2)] hover:underline inline-flex items-center gap-1 mt-1">{t('ds.wc.uploads', 'Open the Uploads page')} →</Link>
            </div>
          </div>
        )}
      </div>

      {/* Join-to-create voice — owner-editable per-server (was admin-only). */}
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
                <Input value={lb.lobbyChannelId} onChange={(e) => setJ({ lobbies: draft.jtc.lobbies.map((x, k) => k === i ? { ...x, lobbyChannelId: e.target.value.replace(/[^0-9]/g, '').slice(0, 32) } : x) })} placeholder={t('ds.jtc.lobbych', 'Lobby voice channel ID')} />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <Input value={lb.categoryId} onChange={(e) => setJ({ lobbies: draft.jtc.lobbies.map((x, k) => k === i ? { ...x, categoryId: e.target.value.replace(/[^0-9]/g, '').slice(0, 32) } : x) })} placeholder={t('ds.jtc.catid', 'Category ID (auto if empty)')} />
                  <Input value={lb.tempCategoryName} onChange={(e) => setJ({ lobbies: draft.jtc.lobbies.map((x, k) => k === i ? { ...x, tempCategoryName: e.target.value.slice(0, 100) } : x) })} placeholder={t('ds.jtc.tempcat', 'Temp category name')} />
                </div>
              </div>
            ))}
            {draft.jtc.lobbies.length < 20 && <Button size="sm" variant="ghost" onClick={() => setJ({ lobbies: [...draft.jtc.lobbies, { lobbyChannelId: '', categoryId: '', tempCategoryName: 'Temp Voice' }] })}><Plus size={13} /> {t('ds.jtc.add', 'Add lobby')}</Button>}
          </div>
        )}
      </div>

      {/* Gated access — owner-editable per-server role grants (was admin-only). */}
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
                    <Field label={t('ds.gate.roleid', 'Role ID')}><Input value={r.roleId} onChange={(e) => updRule({ roleId: e.target.value.replace(/[^0-9]/g, '').slice(0, 32) })} placeholder="123456789012345678" /></Field>
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

      {showBudget && <Card className="p-3 mb-4"><CapacityBar cap={g.capacity} /></Card>}

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

      {/* The guild's stored roster — only when it's actually in pool mode (the only mode that
          stores members), and only your own server's members, never another's. */}
      {g.memberMode === 'pool' && (
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

export function MyDiscordServers() {
  const { t } = useI18n();
  const [state, setState] = useState(null); // { linked, guilds }
  const [sel, setSel] = useState(null);
  const load = () => api.get('/me/discord/guilds').then((r) => { setState(r); setSel((s) => s || r.guilds?.[0]?.guildId || null); }).catch(() => setState({ linked: false, guilds: [] }));
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  if (!state) return <div className="py-10 flex justify-center"><Spinner /></div>;
  if (!state.linked) {
    return <EmptyState icon={Link2} title={t('ds.nolink', 'Link your Discord account')}
      sub={t('ds.nolink.s', 'Connect Discord to your account, then the servers you own or manage appear here.')}>
      <Link to="/profile"><Button size="sm"><Link2 size={14} /> {t('ds.connect', 'Connect Discord')}</Button></Link>
    </EmptyState>;
  }
  if (!state.guilds.length) {
    return <EmptyState icon={MessageSquare} title={t('ds.noguilds', 'No servers to manage yet')}
      sub={t('ds.noguilds.s', 'You’ll see a server here once our Discord bot is in a server you own or have Manage Server on.')} />;
  }
  return (
    <div>
      <div className="flex items-center gap-2 mb-4"><MessageSquare size={16} className="text-[var(--primary-2)]" /><h2 className="font-semibold">{t('ds.title', 'My Discord servers')}</h2></div>
      <div className="grid md:grid-cols-[minmax(0,240px)_1fr] gap-4">
        {/* Server picker — a column on desktop, a scrolling row on mobile. */}
        <div className="flex md:flex-col gap-2 overflow-x-auto md:overflow-visible pb-1 md:pb-0">
          {state.guilds.map((g) => (
            <button key={g.guildId} type="button" onClick={() => setSel(g.guildId)}
              className={`text-start rounded-xl border px-3 py-2.5 shrink-0 md:shrink w-56 md:w-auto transition ${sel === g.guildId ? 'border-[var(--primary)] bg-[var(--primary)]/5' : 'border-[var(--line)] hover:border-[var(--primary)]/40'}`}>
              <div className="text-sm font-medium truncate flex items-center gap-1.5"><Server size={13} className="shrink-0 text-[var(--faint)]" /> {g.name || g.guildId}</div>
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

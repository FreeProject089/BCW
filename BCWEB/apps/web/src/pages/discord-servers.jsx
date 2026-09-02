import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { MessageSquare, Server, Shield, Database, MinusCircle, Users, Check, Link2, ScrollText, Gauge, Sparkles, Image as ImageIcon, AlertTriangle } from 'lucide-react';
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

// One server's editable config. Fetches its own detail so a save reflects immediately.
function GuildConfig({ guildId, onSaved }) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = () => api.get(`/me/discord/guilds/${guildId}`).then((r) => { setData(r); setDraft({ memberMode: r.guild.memberMode, logChannelId: r.guild.logChannelId || '', storeLogs: !!r.guild.storeLogs, welcome: normWelcome(r.welcome) }); }).catch(() => setData({ error: true }));
  useEffect(() => { setData(null); setDraft(null); load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [guildId]);
  if (!data) return <div className="py-10 flex justify-center"><Spinner /></div>;
  if (data.error) return <EmptyState icon={MessageSquare} title={t('ds.gone', 'You can no longer manage this server')} sub={t('ds.gone.s', 'Your access may have changed on Discord.')} />;
  const g = data.guild;
  const name = (m) => (lang === 'fr' ? m.labelFr : m.label);
  const desc = (m) => (lang === 'fr' ? m.descFr : m.desc);
  const needsChannel = draft.memberMode === 'moderation' && !draft.logChannelId.trim();
  const welcomeDirty = JSON.stringify(draft.welcome) !== JSON.stringify(normWelcome(data.welcome));
  const dirty = draft.memberMode !== g.memberMode || (draft.logChannelId || '') !== (g.logChannelId || '') || draft.storeLogs !== g.storeLogs || welcomeDirty;
  const setW = (patch) => setDraft((d) => ({ ...d, welcome: { ...d.welcome, ...patch } }));
  const save = async () => {
    setBusy(true);
    try {
      const r = await api.put(`/me/discord/guilds/${guildId}`, { memberMode: draft.memberMode, logChannelId: draft.logChannelId.trim() || null, storeLogs: draft.storeLogs, welcome: draft.welcome });
      setData((d) => ({ ...d, guild: r.guild, welcome: r.welcome }));
      setDraft({ memberMode: r.guild.memberMode, logChannelId: r.guild.logChannelId || '', storeLogs: !!r.guild.storeLogs, welcome: normWelcome(r.welcome) });
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

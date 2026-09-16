// Automod + log routing — the two per-server bot shapes, edited from two places.
//
// The bot documents both shapes verbatim at the top of apps/bot/src/features/automod.mjs and
// apps/bot/src/features/logs.mjs, and the API bounds them with MODERATION_SCHEMA / LOGS_SCHEMA
// in routes/bot.mjs. This file is the dashboard's copy of that vocabulary — the rule names,
// the per-rule thresholds, the 23 log categories in their 8 groups — plus the two editors
// that render it. A server owner reaches them from their own dashboard (discord-servers.jsx);
// an admin reaches the same editors, for the same guild subtree, from the bot tab.
//
// One editor, two hosts, so the two doors cannot save different shapes. `normAutomod` /
// `normLogs` turn whatever was stored into the full shape with the bot's defaults filled in,
// and that is also what is SENT: the API's zod schemas want numbers as numbers and actions
// from the enum, and a half-typed field must never reach them as an empty string.
import { useEffect, useState } from 'react';
import { ChevronDown, Plus, X, SlidersHorizontal } from 'lucide-react';
import { useI18n } from '../i18n.jsx';
import { Input, Select, Field, Button } from '../ui/ui.jsx';

// ── The vocabulary (mirrors the bot) ──────────────────────────────────────────────────────
export const AUTOMOD_ACTIONS = ['log', 'delete', 'warn', 'timeout', 'kick', 'ban'];
export const JOIN_ACTIONS = ['log', 'kick', 'ban', 'quarantine', 'timeout'];
export const RAID_ACTIONS = ['log', 'timeout', 'kick', 'ban'];
export const AUTOMOD_RULES = ['spam', 'mentions', 'invites', 'links', 'words', 'caps', 'zalgo', 'attachments', 'accountAge', 'selfbot', 'raid'];

// DEFAULT_AUTOMOD in the bot, copied. If the bot's defaults move, move these.
export const AUTOMOD_DEFAULTS = {
  enabled: true,
  exempt: { roles: [], channels: [], users: [], moderators: true },
  warnDecayHours: 168,
  rules: {
    spam: { enabled: true, action: 'timeout', timeoutMin: 10, maxMessages: 6, windowSec: 5, maxRepeats: 3, repeatWindowSec: 30 },
    mentions: { enabled: true, action: 'timeout', timeoutMin: 60, maxUsers: 6, maxRoles: 3, everyone: false },
    invites: { enabled: true, action: 'delete', allowGuilds: [], allowCodes: [] },
    links: { enabled: false, action: 'delete', allowDomains: [] },
    words: { enabled: false, action: 'delete', patterns: [] },
    caps: { enabled: false, action: 'delete', ratio: 0.7, minLetters: 12 },
    zalgo: { enabled: true, action: 'delete', maxCombining: 6, maxRatio: 0.3 },
    attachments: { enabled: true, action: 'delete', allowTypes: [], blockTypes: ['exe', 'bat', 'cmd', 'scr', 'msi', 'ps1', 'vbs', 'jar', 'com', 'dll', 'hta', 'lnk'] },
    accountAge: { enabled: false, action: 'kick', minDays: 7, timeoutMin: 1440 },
    selfbot: { enabled: true, action: 'kick', channelsPerWindow: 3, windowSec: 5, identicalAcrossSec: 10, maxPerMinute: 40 },
    raid: { enabled: true, action: 'timeout', timeoutMin: 60, joins: 10, windowSec: 30, lockdownMin: 15, raiseVerification: true, alert: true },
  },
};

// Every threshold a rule has, with the bounds the API enforces (routes/bot.mjs). `int` fields
// are rounded; a value outside its bounds is clamped rather than refused, because the server
// would refuse the WHOLE save over one field and say only "invalid_input".
const N = (k, min, max, opt = {}) => ({ k, kind: 'num', min, max, int: opt.int !== false, step: opt.step });
const B = (k) => ({ k, kind: 'bool' });
const L = (k, max = 100) => ({ k, kind: 'list', max });
export const RULE_FIELDS = {
  spam: [N('timeoutMin', 1, 40320), N('maxMessages', 1, 100), N('windowSec', 1, 600), N('maxRepeats', 2, 50), N('repeatWindowSec', 1, 3600)],
  mentions: [N('timeoutMin', 1, 40320), N('maxUsers', 1, 100), N('maxRoles', 1, 100), B('everyone')],
  invites: [N('timeoutMin', 1, 40320), L('allowGuilds'), L('allowCodes')],
  links: [N('timeoutMin', 1, 40320), L('allowDomains', 200)],
  words: [N('timeoutMin', 1, 40320), L('patterns', 500)],
  caps: [N('timeoutMin', 1, 40320), N('ratio', 0, 1, { int: false, step: 0.05 }), N('minLetters', 1, 4000)],
  zalgo: [N('timeoutMin', 1, 40320), N('maxCombining', 1, 1000), N('maxRatio', 0, 1, { int: false, step: 0.05 })],
  attachments: [N('timeoutMin', 1, 40320), L('allowTypes'), L('blockTypes')],
  accountAge: [N('minDays', 0, 3650, { int: false, step: 0.5 }), N('timeoutMin', 1, 40320)],
  selfbot: [N('timeoutMin', 1, 40320), N('channelsPerWindow', 2, 50), N('windowSec', 1, 600), N('identicalAcrossSec', 1, 3600), N('maxPerMinute', 1, 1000)],
  raid: [N('timeoutMin', 1, 40320), N('joins', 2, 1000), N('windowSec', 1, 3600), N('lockdownMin', 1, 1440), B('raiseVerification'), B('alert')],
};
const actionsFor = (rule) => (rule === 'accountAge' ? JOIN_ACTIONS : rule === 'raid' ? RAID_ACTIONS : AUTOMOD_ACTIONS);
// The two join-time rules have no message to delete, so `delete`/`warn` do not apply to them.
export const JOIN_RULES = ['accountAge', 'raid'];

// CATEGORIES / GROUPS in the bot's logs.mjs, copied — the routing keys the dashboard renders.
export const LOG_GROUPS = ['messages', 'members', 'voice', 'automod', 'moderation', 'server', 'bot', 'economy'];
export const LOG_CATEGORIES = {
  'messages.delete': 'messages', 'messages.edit': 'messages', 'messages.bulk': 'messages',
  'members.join': 'members', 'members.leave': 'members', 'members.kick': 'members', 'members.ban': 'members',
  'members.unban': 'members', 'members.timeout': 'members', 'members.nick': 'members', 'members.roles': 'members',
  voice: 'voice',
  automod: 'automod',
  modcmd: 'moderation',
  'server.channels': 'server', 'server.roles': 'server', 'server.emoji': 'server', 'server.webhooks': 'server',
  'bot.errors': 'bot', 'bot.config': 'bot',
  'economy.casino': 'economy', 'economy.shop': 'economy', 'economy.season': 'economy',
};
export const LOG_CATEGORY_KEYS = Object.keys(LOG_CATEGORIES);
export const LOGS_DEFAULTS = { enabled: true, forumId: '', channelId: '', forumMode: 'category', reaction: '', pinSummary: true, routes: {} };

// ── Normalisation ─────────────────────────────────────────────────────────────────────────
const clamp = (v, f, d) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return d;
  const c = Math.min(f.max, Math.max(f.min, n));
  return f.int ? Math.round(c) : Math.round(c * 1000) / 1000;
};
const strList = (v, max = 100) => (Array.isArray(v) ? v.map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, max) : []);
const idList = (v) => strList(v).map((x) => x.replace(/[^0-9]/g, '')).filter(Boolean);

/** Whatever was stored under moderation.automod → the full shape, bounds applied. */
export function normAutomod(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const ex = r.exempt && typeof r.exempt === 'object' ? r.exempt : {};
  const rules = {};
  for (const name of AUTOMOD_RULES) {
    const d = AUTOMOD_DEFAULTS.rules[name];
    const s = r.rules && r.rules[name] && typeof r.rules[name] === 'object' ? r.rules[name] : {};
    const out = { enabled: typeof s.enabled === 'boolean' ? s.enabled : d.enabled };
    const acts = actionsFor(name);
    out.action = acts.includes(s.action) ? s.action : d.action;
    for (const f of RULE_FIELDS[name]) {
      const dv = d[f.k];
      if (f.kind === 'num') out[f.k] = clamp(s[f.k] ?? dv ?? f.min, f, dv ?? f.min);
      else if (f.kind === 'bool') out[f.k] = typeof s[f.k] === 'boolean' ? s[f.k] : dv;
      else out[f.k] = strList(s[f.k] ?? dv, f.max);
    }
    rules[name] = out;
  }
  return {
    enabled: r.enabled !== false,
    exempt: { roles: idList(ex.roles), channels: idList(ex.channels), users: idList(ex.users), moderators: ex.moderators !== false },
    warnDecayHours: clamp(r.warnDecayHours ?? AUTOMOD_DEFAULTS.warnDecayHours, { min: 0, max: 8760, int: true }, AUTOMOD_DEFAULTS.warnDecayHours),
    rules,
  };
}

/** Whatever was stored under `logs` → the full shape. Routes keep only known keys. */
export function normLogs(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const routes = {};
  for (const [k, v] of Object.entries(r.routes && typeof r.routes === 'object' ? r.routes : {})) {
    if (!LOG_CATEGORIES[k] && !LOG_GROUPS.includes(k)) continue;
    if (v === 'off' || v?.kind === 'off') { routes[k] = { kind: 'off', id: '', tags: [] }; continue; }
    if (typeof v === 'string') { if (v.trim()) routes[k] = { kind: 'channel', id: v.trim(), tags: [] }; continue; }
    if (v && typeof v === 'object' && (v.kind === 'forum' || v.kind === 'channel')) {
      routes[k] = { kind: v.kind, id: String(v.id || '').trim(), tags: strList(v.tags, 5) };
    }
  }
  return {
    enabled: r.enabled !== false,
    forumId: String(r.forumId || '').trim(), channelId: String(r.channelId || '').trim(),
    forumMode: r.forumMode === 'day' ? 'day' : 'category',
    reaction: String(r.reaction || '').trim().slice(0, 64),
    pinSummary: r.pinSummary !== false,
    routes,
  };
}

/** What is sent: the normalised shape, minus routes that name no channel (they route nowhere). */
export function logsForSave(v) {
  const n = normLogs(v);
  const routes = {};
  for (const [k, r] of Object.entries(n.routes)) {
    if (r.kind === 'off') routes[k] = 'off';
    else if (r.id) routes[k] = r.kind === 'forum' ? { kind: 'forum', id: r.id, tags: r.tags } : { kind: 'channel', id: r.id };
  }
  return { ...n, routes };
}

// ── Small controls ────────────────────────────────────────────────────────────────────────
// A number that commits on blur / Enter and only forwards a valid value while typing, so a
// field can be cleared and retyped without the draft ever holding an empty string.
function NumField({ value, onCommit, f, className = '' }) {
  const [txt, setTxt] = useState(String(value ?? ''));
  useEffect(() => { setTxt(String(value ?? '')); }, [value]);
  const commit = () => { const v = clamp(txt, f, value); onCommit(v); setTxt(String(v)); };
  return (
    <Input type="number" min={f.min} max={f.max} step={f.step ?? (f.int ? 1 : 0.1)} value={txt} className={`!py-1 text-xs tabular-nums ${className}`}
      onChange={(e) => { setTxt(e.target.value); const n = Number(e.target.value); if (e.target.value !== '' && Number.isFinite(n) && n >= f.min && n <= f.max) onCommit(f.int ? Math.round(n) : n); }}
      onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }} />
  );
}

// Chips + an "add" box. With `options` (the bot's live role/channel list) the add box is a
// picker; without one it is a plain input, so nothing is ever un-editable when the bot is off.
function Chips({ items, onChange, options, placeholder, max = 100, mono = true, digitsOnly = false, prefix = '' }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState('');
  const list = Array.isArray(items) ? items : [];
  const add = (raw) => {
    const v = String(raw || '').trim();
    if (!v || list.includes(v) || list.length >= max) return;
    onChange([...list, v]); setDraft('');
  };
  const nameOf = (v) => options?.find((o) => o.id === v)?.name;
  return (
    <div className="space-y-1.5">
      {list.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {list.map((v) => (
            <span key={v} className={`inline-flex items-center gap-1 ps-2 pe-1 py-0.5 rounded-md bg-[var(--surface-2)] border border-[var(--line)] text-[11px] ${mono && !nameOf(v) ? 'font-mono' : ''}`}>
              {nameOf(v) ? `${prefix}${nameOf(v)}` : v}
              <button type="button" onClick={() => onChange(list.filter((x) => x !== v))} className="text-[var(--faint)] hover:text-error" title={t('common.remove', 'Remove')}><X size={11} /></button>
            </span>
          ))}
        </div>
      )}
      {options?.length ? (
        <Select className="!py-1 text-xs" value="" onChange={(e) => add(e.target.value)}>
          <option value="">{placeholder}</option>
          {options.filter((o) => !list.includes(o.id)).map((o) => <option key={o.id} value={o.id}>{prefix}{o.name}</option>)}
        </Select>
      ) : (
        <div className="flex gap-1.5">
          <Input className={`!py-1 text-xs ${mono ? 'font-mono' : ''}`} value={draft} placeholder={placeholder}
            onChange={(e) => setDraft(digitsOnly ? e.target.value.replace(/[^0-9]/g, '').slice(0, 32) : e.target.value.slice(0, 200))}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(draft); } }} />
          <Button size="sm" variant="ghost" onClick={() => add(draft)} title={t('common.add', 'Add')}><Plus size={13} /></Button>
        </div>
      )}
    </div>
  );
}

// Channel picker over the bot's live list (types: 0 text · 5 announcement · 15 forum), with
// the id input as the fallback. Same idea as the dashboard's ChannelPicker, local so this file
// does not reach into another page for a control.
function ChanPick({ channels, types, value, onChange, placeholder }) {
  const { t } = useI18n();
  const list = (channels || []).filter((c) => types.includes(c.type));
  if (!list.length) return <Input className="!py-1 text-xs font-mono" value={value || ''} onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, '').slice(0, 32))} placeholder={placeholder || t('ds.pick.chanph', 'Channel ID')} />;
  return (
    <Select className="!py-1 text-xs" value={value || ''} onChange={(e) => onChange(e.target.value)}>
      <option value="">{t('ds.pick.none', '— none —')}</option>
      {value && !list.some((c) => c.id === value) && <option value={value}>{t('pick.unknown', 'ID {v} (not in the bot’s list)').replace('{v}', value)}</option>}
      {list.map((c) => <option key={c.id} value={c.id}>{c.type === 15 ? '' : '# '}{c.name}</option>)}
    </Select>
  );
}

const Check = ({ checked, onChange, children, className = '' }) => (
  <label className={`flex items-center gap-1.5 text-xs cursor-pointer select-none ${className}`}>
    <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} /> {children}
  </label>
);

// ── Labels (literal keys, so i18n:check sees every one) ───────────────────────────────────
function useAutomodLabels() {
  const { t } = useI18n();
  return {
    rule: {
      spam: [t('amod.r.spam', 'Spam'), t('amod.r.spam.d', 'Too many messages in a few seconds, or the same message repeated.')],
      mentions: [t('amod.r.mentions', 'Mass mentions'), t('amod.r.mentions.d', 'Too many users or roles pinged in one message, or @everyone.')],
      invites: [t('amod.r.invites', 'Invites'), t('amod.r.invites.d', 'Discord invite links to other servers. Your own server is always allowed.')],
      links: [t('amod.r.links', 'Links'), t('amod.r.links.d', 'Any link. An empty allow-list means every link is caught.')],
      words: [t('amod.r.words', 'Words'), t('amod.r.words.d', 'Patterns: a whole word, pre* / *mid* wildcards, or /regex/i.')],
      caps: [t('amod.r.caps', 'Caps'), t('amod.r.caps.d', 'A message that is mostly upper-case, once it is long enough to matter.')],
      zalgo: [t('amod.r.zalgo', 'Zalgo'), t('amod.r.zalgo.d', 'Text stacked with combining marks.')],
      attachments: [t('amod.r.attachments', 'Attachments'), t('amod.r.attachments.d', 'Blocked file types, or anything outside an allow-list of types.')],
      accountAge: [t('amod.r.accountAge', 'Account age'), t('amod.r.accountAge.d', 'On join: an account younger than the minimum. Quarantine = a timeout for the minutes below.')],
      selfbot: [t('amod.r.selfbot', 'Selfbot'), t('amod.r.selfbot.d', 'The same text across several channels within seconds, or an inhuman message rate.')],
      raid: [t('amod.r.raid', 'Raid'), t('amod.r.raid.d', 'A burst of joins. Can lock the server down, raise verification and alert you.')],
    },
    action: {
      log: t('amod.a.log', 'Log only'), delete: t('amod.a.delete', 'Delete'), warn: t('amod.a.warn', 'Delete + warn'),
      timeout: t('amod.a.timeout', 'Delete + time out'), kick: t('amod.a.kick', 'Kick'), ban: t('amod.a.ban', 'Ban'), quarantine: t('amod.a.quarantine', 'Quarantine'),
    },
    joinAction: { log: t('amod.a.log', 'Log only'), timeout: t('amod.a.timeoutj', 'Time out'), kick: t('amod.a.kick', 'Kick'), ban: t('amod.a.ban', 'Ban'), quarantine: t('amod.a.quarantine', 'Quarantine') },
    field: {
      timeoutMin: t('amod.f.timeoutMin', 'Timeout (minutes)'), maxMessages: t('amod.f.maxMessages', 'Max messages'), windowSec: t('amod.f.windowSec', 'Window (seconds)'),
      maxRepeats: t('amod.f.maxRepeats', 'Max repeats'), repeatWindowSec: t('amod.f.repeatWindowSec', 'Repeat window (seconds)'),
      maxUsers: t('amod.f.maxUsers', 'Max users mentioned'), maxRoles: t('amod.f.maxRoles', 'Max roles mentioned'), everyone: t('amod.f.everyone', 'Catch @everyone / @here'),
      allowGuilds: t('amod.f.allowGuilds', 'Allowed server ids'), allowCodes: t('amod.f.allowCodes', 'Allowed invite codes'),
      allowDomains: t('amod.f.allowDomains', 'Allowed domains'), patterns: t('amod.f.patterns', 'Patterns'),
      ratio: t('amod.f.ratio', 'Upper-case share (0–1)'), minLetters: t('amod.f.minLetters', 'Minimum letters'),
      maxCombining: t('amod.f.maxCombining', 'Max combining marks'), maxRatio: t('amod.f.maxRatio', 'Max combining share (0–1)'),
      allowTypes: t('amod.f.allowTypes', 'Allowed file types'), blockTypes: t('amod.f.blockTypes', 'Blocked file types'),
      minDays: t('amod.f.minDays', 'Minimum account age (days)'),
      channelsPerWindow: t('amod.f.channelsPerWindow', 'Channels per window'), identicalAcrossSec: t('amod.f.identicalAcrossSec', 'Identical across (seconds)'), maxPerMinute: t('amod.f.maxPerMinute', 'Max messages per minute'),
      joins: t('amod.f.joins', 'Joins'), lockdownMin: t('amod.f.lockdownMin', 'Lockdown (minutes)'), raiseVerification: t('amod.f.raiseVerification', 'Raise verification level'), alert: t('amod.f.alert', 'Alert the log'),
    },
  };
}

function useLogLabels() {
  const { t } = useI18n();
  return {
    group: {
      messages: t('lg.g.messages', 'Messages'), members: t('lg.g.members', 'Members'), voice: t('lg.g.voice', 'Voice'), automod: t('lg.g.automod', 'Automod'),
      moderation: t('lg.g.moderation', 'Moderation'), server: t('lg.g.server', 'Server'), bot: t('lg.g.bot', 'Bot'), economy: t('lg.g.economy', 'Economy'),
    },
    cat: {
      'messages.delete': t('lg.c.messages.delete', 'Message deleted'), 'messages.edit': t('lg.c.messages.edit', 'Message edited'), 'messages.bulk': t('lg.c.messages.bulk', 'Messages bulk-deleted'),
      'members.join': t('lg.c.members.join', 'Member joined'), 'members.leave': t('lg.c.members.leave', 'Member left'), 'members.kick': t('lg.c.members.kick', 'Member kicked'),
      'members.ban': t('lg.c.members.ban', 'Member banned'), 'members.unban': t('lg.c.members.unban', 'Member unbanned'), 'members.timeout': t('lg.c.members.timeout', 'Member timed out'),
      'members.nick': t('lg.c.members.nick', 'Nickname changed'), 'members.roles': t('lg.c.members.roles', 'Roles changed'),
      voice: t('lg.c.voice', 'Voice activity'), automod: t('lg.c.automod', 'Automod action'), modcmd: t('lg.c.modcmd', 'Moderation command'),
      'server.channels': t('lg.c.server.channels', 'Channel changed'), 'server.roles': t('lg.c.server.roles', 'Role changed'), 'server.emoji': t('lg.c.server.emoji', 'Emoji / sticker changed'), 'server.webhooks': t('lg.c.server.webhooks', 'Webhooks changed'),
      'bot.errors': t('lg.c.bot.errors', 'Bot error'), 'bot.config': t('lg.c.bot.config', 'Bot config changed'),
      'economy.casino': t('lg.c.economy.casino', 'Casino'), 'economy.shop': t('lg.c.economy.shop', 'Shop'), 'economy.season': t('lg.c.economy.season', 'Season'),
    },
  };
}

// ── The automod editor ────────────────────────────────────────────────────────────────────
/**
 * `value` is a normalised automod object (normAutomod), `onChange` gets the next one.
 * `roles` / `channels` are the bot's live lists for pickers (optional). `hideEnable` when the
 * host card already carries the on/off switch.
 */
export function AutomodEditor({ value, onChange, roles, channels, hideEnable }) {
  const { t } = useI18n();
  const L = useAutomodLabels();
  const v = value || normAutomod(null);
  const [adv, setAdv] = useState({});   // rule → advanced open
  const set = (patch) => onChange({ ...v, ...patch });
  const setEx = (patch) => set({ exempt: { ...v.exempt, ...patch } });
  const setRule = (name, patch) => set({ rules: { ...v.rules, [name]: { ...v.rules[name], ...patch } } });
  const textChannels = (channels || []).filter((c) => [0, 5, 15].includes(c.type));
  return (
    <div className="space-y-4">
      {!hideEnable && (
        <Check checked={v.enabled} onChange={(on) => set({ enabled: on })} className="text-sm font-medium">{t('amod.enabled', 'Automod on')}</Check>
      )}
      <p className="text-[11px] text-[var(--faint)]">{t('amod.h', 'Every rule is checked on each message (or join). When several fire at once only the most severe action runs — they never stack. A warning counts toward the /warn ladder.')}</p>

      {/* Exemptions */}
      <div className="rounded-lg border border-[var(--line)] p-3 space-y-2.5">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--faint)]">{t('amod.ex', 'Never applies to')}</div>
        <Check checked={v.exempt.moderators} onChange={(on) => setEx({ moderators: on })}>{t('amod.ex.mods', 'Moderators (Manage Messages / Manage Server / Administrator)')}</Check>
        <div className="grid sm:grid-cols-3 gap-3">
          <Field label={t('amod.ex.roles', 'Roles')}><Chips items={v.exempt.roles} onChange={(l) => setEx({ roles: l })} options={roles} placeholder={t('amod.ex.roleph', 'Add a role…')} digitsOnly prefix="@" /></Field>
          <Field label={t('amod.ex.channels', 'Channels')}><Chips items={v.exempt.channels} onChange={(l) => setEx({ channels: l })} options={textChannels} placeholder={t('amod.ex.chanph', 'Add a channel…')} digitsOnly prefix="# " /></Field>
          <Field label={t('amod.ex.users', 'Users (ids)')}><Chips items={v.exempt.users} onChange={(l) => setEx({ users: l })} placeholder={t('amod.ex.userph', 'User ID — press Enter')} digitsOnly /></Field>
        </div>
        <Field label={t('amod.decay', 'Warnings stop counting after (hours)')} hint={t('amod.decay.h', '0 = a warning counts for ever. The ladder (3 → timeout, 5 → kick, 7 → ban by default) only sees warnings younger than this.')}>
          <NumField value={v.warnDecayHours} f={{ min: 0, max: 8760, int: true }} onCommit={(n) => set({ warnDecayHours: n })} className="!w-28" />
        </Field>
      </div>

      {/* Rules */}
      <div className="rounded-lg border border-[var(--line)] divide-y divide-[var(--line)]">
        {AUTOMOD_RULES.map((name) => {
          const r = v.rules[name];
          const [label, desc] = L.rule[name];
          const join = JOIN_RULES.includes(name);
          const acts = actionsFor(name);
          const actLabel = join ? L.joinAction : L.action;
          const open = !!adv[name];
          const fields = RULE_FIELDS[name].filter((f) => f.k !== 'timeoutMin');
          const wantsTimeout = r.action === 'timeout' || r.action === 'quarantine';
          return (
            <div key={name} className={`p-2.5 ${r.enabled ? '' : 'opacity-70'}`}>
              <div className="flex items-center gap-2 flex-wrap">
                <Check checked={r.enabled} onChange={(on) => setRule(name, { enabled: on })} className="min-w-[140px] flex-1">
                  <span className="text-sm font-medium">{label}</span>
                </Check>
                <Select className="!w-auto !py-1 text-xs" value={r.action} onChange={(e) => setRule(name, { action: e.target.value })} aria-label={t('amod.action', 'Action')}>
                  {acts.map((a) => <option key={a} value={a}>{actLabel[a]}</option>)}
                </Select>
                {wantsTimeout && (
                  <span className="inline-flex items-center gap-1 text-[11px] text-[var(--muted)]">
                    <NumField value={r.timeoutMin} f={{ min: 1, max: 40320, int: true }} onCommit={(n) => setRule(name, { timeoutMin: n })} className="!w-20" /> {t('amod.min', 'min')}
                  </span>
                )}
                {fields.length > 0 && (
                  <button type="button" onClick={() => setAdv((s) => ({ ...s, [name]: !open }))} className={`inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border transition ${open ? 'border-[var(--primary)]/40 text-[var(--primary-2)]' : 'border-[var(--line)] text-[var(--muted)] hover:text-[var(--text)]'}`} aria-expanded={open}>
                    <SlidersHorizontal size={11} /> {t('amod.adv', 'Advanced')} <ChevronDown size={11} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
                  </button>
                )}
              </div>
              <div className="text-[11px] text-[var(--faint)] ps-6 mt-0.5">{desc}</div>
              {open && (
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2.5 mt-2.5 ps-6">
                  {fields.map((f) => (
                    f.kind === 'bool' ? (
                      <Check key={f.k} checked={r[f.k]} onChange={(on) => setRule(name, { [f.k]: on })} className="self-end pb-1">{L.field[f.k]}</Check>
                    ) : f.kind === 'num' ? (
                      <Field key={f.k} label={L.field[f.k]}><NumField value={r[f.k]} f={f} onCommit={(n) => setRule(name, { [f.k]: n })} /></Field>
                    ) : (
                      <Field key={f.k} label={L.field[f.k]} className="sm:col-span-2 lg:col-span-3">
                        <Chips items={r[f.k]} onChange={(l) => setRule(name, { [f.k]: l })} max={f.max} mono={false} digitsOnly={f.k === 'allowGuilds'} placeholder={t('amod.list.ph', 'Type and press Enter')} />
                      </Field>
                    )
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── The log routing editor ────────────────────────────────────────────────────────────────
/** `value` is a normalised logs object (normLogs); `channels` the bot's live list (optional). */
export function LogsEditor({ value, onChange, channels, hideEnable }) {
  const { t } = useI18n();
  const L = useLogLabels();
  const v = value || normLogs(null);
  const [openGroups, setOpenGroups] = useState({});
  const set = (patch) => onChange({ ...v, ...patch });
  const routeOf = (k) => v.routes[k] || null;
  const mode = (k) => (routeOf(k)?.kind || 'default');
  const setRoute = (k, next) => {
    const routes = { ...v.routes };
    if (!next) delete routes[k]; else routes[k] = next;
    set({ routes });
  };
  const setMode = (k, m) => {
    if (m === 'default') return setRoute(k, null);
    if (m === 'off') return setRoute(k, { kind: 'off', id: '', tags: [] });
    const cur = routeOf(k);
    setRoute(k, { kind: m, id: cur && cur.kind !== 'off' ? cur.id : '', tags: cur?.tags || [] });
  };
  const hasForums = (channels || []).some((c) => c.type === 15);
  const RouteRow = ({ k, label, sub }) => {
    const r = routeOf(k);
    const m = mode(k);
    return (
      <div className={`flex items-center gap-2 flex-wrap py-1.5 ${sub ? 'ps-6' : ''}`}>
        <span className={`flex-1 min-w-[140px] ${sub ? 'text-xs text-[var(--muted)]' : 'text-sm font-medium'}`}>{label}</span>
        <Select className="!w-auto !py-1 text-xs" value={m} onChange={(e) => setMode(k, e.target.value)} aria-label={t('lg.route', 'Route')}>
          <option value="default">{sub ? t('lg.m.group', 'As its group') : t('lg.m.default', 'Default')}</option>
          <option value="off">{t('lg.m.off', 'Off')}</option>
          <option value="channel">{t('lg.m.channel', 'A text channel')}</option>
          <option value="forum">{t('lg.m.forum', 'A forum')}</option>
        </Select>
        {(m === 'channel' || m === 'forum') && (
          <span className="w-44"><ChanPick channels={channels} types={m === 'forum' ? [15] : [0, 5]} value={r?.id} onChange={(id) => setRoute(k, { ...r, id })} placeholder={m === 'forum' ? t('lg.forumph', 'Forum ID') : t('ds.pick.chanph', 'Channel ID')} /></span>
        )}
        {m === 'forum' && (
          <Input className="!py-1 text-xs w-40" value={(r?.tags || []).join(', ')} placeholder={t('lg.tags.ph', 'Tags (names, comma)')}
            onChange={(e) => setRoute(k, { ...r, tags: e.target.value.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 5) })} />
        )}
      </div>
    );
  };
  return (
    <div className="space-y-4">
      {!hideEnable && <Check checked={v.enabled} onChange={(on) => set({ enabled: on })} className="text-sm font-medium">{t('lg.enabled', 'Logs on')}</Check>}
      <p className="text-[11px] text-[var(--faint)]">{t('lg.h', 'Where the bot writes what happens. A forum gets one tagged post per category (or per day); a text channel gets plain embeds. A category not routed below follows its group, and a group not routed follows the defaults here.')}</p>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label={t('lg.forum', 'Log forum')} hint={hasForums ? t('lg.forum.h', 'A forum channel. Every category lands here by default, one post each, tagged with its group.') : t('lg.forum.h2', 'A forum channel id. Create a forum in Discord first — the bot lists it after its next heartbeat.')}>
          <ChanPick channels={channels} types={[15]} value={v.forumId} onChange={(id) => set({ forumId: id })} placeholder={t('lg.forumph', 'Forum ID')} />
        </Field>
        <Field label={t('lg.channel', 'Fallback text channel')} hint={t('lg.channel.h', 'Used when no forum is set. Empty = the moderation log channel above.')}>
          <ChanPick channels={channels} types={[0, 5]} value={v.channelId} onChange={(id) => set({ channelId: id })} />
        </Field>
        <Field label={t('lg.mode', 'Forum posts')}>
          <Select className="!py-1 text-xs" value={v.forumMode} onChange={(e) => set({ forumMode: e.target.value })}>
            <option value="category">{t('lg.mode.category', 'One post per category')}</option>
            <option value="day">{t('lg.mode.day', 'One post per day')}</option>
          </Select>
        </Field>
        <Field label={t('lg.reaction', 'Reaction on every post')} hint={t('lg.reaction.h', 'Empty = the icon set’s history glyph. Else a unicode emoji or <:name:id>.')}>
          <Input className="!py-1 text-xs" value={v.reaction} onChange={(e) => set({ reaction: e.target.value.slice(0, 64) })} placeholder="<:name:id>" />
        </Field>
      </div>
      <Check checked={v.pinSummary} onChange={(on) => set({ pinSummary: on })}>{t('lg.pin', 'Pin each post’s first message (what the post is for)')}</Check>

      <div className="rounded-lg border border-[var(--line)] divide-y divide-[var(--line)] px-3">
        {LOG_GROUPS.map((g) => {
          const cats = LOG_CATEGORY_KEYS.filter((k) => LOG_CATEGORIES[k] === g);
          const open = !!openGroups[g];
          const overridden = cats.filter((k) => routeOf(k)).length;
          return (
            <div key={g}>
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => setOpenGroups((s) => ({ ...s, [g]: !open }))} className="p-1 -ms-1 text-[var(--faint)] hover:text-[var(--text)]" aria-expanded={open} title={t('lg.cats', 'Categories')}>
                  <ChevronDown size={13} className={`transition-transform ${open ? '' : '-rotate-90'}`} />
                </button>
                <div className="flex-1 min-w-0"><RouteRow k={g} label={<>{L.group[g]} <span className="text-[10px] font-normal text-[var(--faint)]">· {cats.length}{overridden ? ` · ${t('lg.overridden', '{n} routed on their own').replace('{n}', overridden)}` : ''}</span></>} /></div>
              </div>
              {open && <div className="pb-1.5">{cats.map((k) => <RouteRow key={k} k={k} label={L.cat[k]} sub />)}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Automod, the warn ladder and log routing — the per-server bot shapes, edited from two places.
//
// The bot documents all of them at the top of apps/bot/src/features/automod.mjs and
// apps/bot/src/features/logs.mjs, and the API bounds them with MODERATION_SCHEMA / LOGS_SCHEMA
// in routes/bot.mjs. This file is the dashboard's copy of that vocabulary — the rule names,
// the per-rule thresholds and parameters, the 23 log categories in their 8 groups — plus the
// editors that render it. A server owner reaches them from their own dashboard
// (discord-servers.jsx); an admin reaches the same editors, for the same guild subtree, from
// the bot tab.
//
// One editor, several hosts, so the doors cannot save different shapes. `normAutomod` /
// `normLogs` / `normLadder` turn whatever was stored into the full shape with the bot's
// defaults filled in, and that is also what is SENT: the API's zod schemas want numbers as
// numbers and actions from the enum, and a half-typed field must never reach them as an
// empty string.
//
// THE RULE THIS FILE FOLLOWS: a control says what it DOES, in the words of the thing it does
// it to. A log row does not say "Default", it says where the next event actually lands; a
// rule does not hide "maxMessages" behind "Advanced", it says "more than 6 messages in 5
// seconds" with 6 and 5 as the fields you type in.
import { useEffect, useState } from 'react';
import { ChevronDown, Plus, X, Trash2, Send, ArrowRight, ShieldOff } from 'lucide-react';
import { useI18n } from '../i18n.jsx';
import { Input, Select, Field, Button } from '../ui/ui.jsx';
import { ChannelPicker, PickerList, ChannelTag, CHANNEL_TYPES, channelOf } from './discord-pickers.jsx';

// The vocabulary and the pure rules live in lib/discord-config.js (testable without a DOM);
// they are re-exported here so every importer keeps one address for them.
import { clamp, actionsFor, AUTOMOD_ACTIONS, JOIN_ACTIONS, RAID_ACTIONS, AUTOMOD_RULES, JOIN_RULES, LADDER_ACTIONS, AUTOMOD_DEFAULTS, LADDER_DEFAULTS, RULE_FIELDS, LOG_GROUPS, LOG_CATEGORIES, LOG_CATEGORY_KEYS, LOG_GROUP_TAG, LOGS_DEFAULTS, normAutomod, normLadder, ladderForSave, normLogs, logsForSave, resolveLogRoute } from '../lib/discord-config.js';

export { AUTOMOD_ACTIONS, JOIN_ACTIONS, RAID_ACTIONS, AUTOMOD_RULES, JOIN_RULES, LADDER_ACTIONS, AUTOMOD_DEFAULTS, LADDER_DEFAULTS, RULE_FIELDS, LOG_GROUPS, LOG_CATEGORIES, LOG_CATEGORY_KEYS, LOG_GROUP_TAG, LOGS_DEFAULTS, normAutomod, normLadder, ladderForSave, normLogs, logsForSave, resolveLogRoute };

// Private helpers the editors need from that module's own idiom.
const FIELD = (rule, k) => RULE_FIELDS[rule].find((f) => f.k === k);
const LADDER_TIMED = ['timeout', 'quarantine'];

// ── Small controls ────────────────────────────────────────────────────────────────────────
// A number that commits on blur / Enter and only forwards a valid value while typing, so a
// field can be cleared and retyped without the draft ever holding an empty string.
function NumField({ value, onCommit, f, className = '' }) {
  const [txt, setTxt] = useState(String(value ?? ''));
  useEffect(() => { setTxt(String(value ?? '')); }, [value]);
  const commit = () => { const v = clamp(txt, f, value); onCommit(v); setTxt(String(v)); };
  return (
    <Input type="number" min={f.min} max={f.max} step={f.step ?? (f.int ? 1 : 0.1)} value={txt} className={`!py-0.5 !px-1.5 text-xs tabular-nums !w-14 text-center ${className}`}
      onChange={(e) => { setTxt(e.target.value); const n = Number(e.target.value); if (e.target.value !== '' && Number.isFinite(n) && n >= f.min && n <= f.max) onCommit(f.int ? Math.round(n) : n); }}
      onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }} />
  );
}

// Free-text chips (patterns, domains, file types). Ids get a real picker instead — see
// discord-pickers.jsx — so this stays what it is: a list of words.
function Chips({ items, onChange, placeholder, max = 100 }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState('');
  const list = Array.isArray(items) ? items : [];
  const add = (raw) => {
    const v = String(raw || '').trim();
    if (!v || list.includes(v) || list.length >= max) return;
    onChange([...list, v]); setDraft('');
  };
  return (
    <div className="space-y-1.5">
      {list.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {list.map((v) => (
            <span key={v} className="inline-flex items-center gap-1 ps-2 pe-1 py-0.5 rounded-md bg-[var(--surface-2)] border border-[var(--line)] text-[11px]">
              {v}
              <button type="button" onClick={() => onChange(list.filter((x) => x !== v))} className="text-[var(--faint)] hover:text-error" title={t('common.remove', 'Remove')}><X size={11} /></button>
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-1.5">
        <Input className="!py-1 text-xs" value={draft} placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value.slice(0, 200))}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(draft); } }} />
        <Button size="sm" variant="ghost" onClick={() => add(draft)} title={t('common.add', 'Add')}><Plus size={13} /></Button>
      </div>
    </div>
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
    name: {
      spam: t('amod.r.spam', 'Spam'), mentions: t('amod.r.mentions', 'Mass mentions'), invites: t('amod.r.invites', 'Invites'),
      links: t('amod.r.links', 'Links'), words: t('amod.r.words', 'Words'), caps: t('amod.r.caps', 'Caps'), zalgo: t('amod.r.zalgo', 'Zalgo'),
      attachments: t('amod.r.attachments', 'Attachments'), accountAge: t('amod.r.accountAge', 'New accounts'),
      selfbot: t('amod.r.selfbot', 'Selfbot'), raid: t('amod.r.raid', 'Raid'),
    },
    action: {
      log: t('amod.a.log', 'Log only'), delete: t('amod.a.delete', 'Delete'), warn: t('amod.a.warn', 'Warn'),
      timeout: t('amod.a.timeout', 'Time out'), kick: t('amod.a.kick', 'Kick'), ban: t('amod.a.ban', 'Ban'), quarantine: t('amod.a.quarantine', 'Quarantine'),
    },
    field: {
      allowGuilds: t('amod.f.allowGuilds', 'Allowed server ids'), allowCodes: t('amod.f.allowCodes', 'Allowed invite codes'),
      allowDomains: t('amod.f.allowDomains', 'Allowed domains'), patterns: t('amod.f.patterns', 'Patterns'),
      allowTypes: t('amod.f.allowTypes', 'Allowed file types'), blockTypes: t('amod.f.blockTypes', 'Blocked file types'),
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
      'server.channels': t('lg.c.server.channels', 'Channel changed'), 'server.roles': t('lg.c.server.roles', 'Role changed'), 'server.emoji': t('lg.c.server.emoji', 'Emoji or sticker changed'), 'server.webhooks': t('lg.c.server.webhooks', 'Webhooks changed'),
      'bot.errors': t('lg.c.bot.errors', 'Bot error'), 'bot.config': t('lg.c.bot.config', 'Bot config changed'),
      'economy.casino': t('lg.c.economy.casino', 'Casino'), 'economy.shop': t('lg.c.economy.shop', 'Shop'), 'economy.season': t('lg.c.economy.season', 'Season'),
    },
  };
}

/** A resolved route, in words. Returns a node, because a channel is worth its own glyph. */
function useDestination(channels) {
  const { t } = useI18n();
  return (route) => {
    if (!route || route.kind === 'off') {
      return {
        short: t('lg.dest.off', 'nowhere'),
        node: <span className="text-[var(--faint)] inline-flex items-center gap-1"><ShieldOff size={11} /> {t('lg.dest.off', 'nowhere')}</span>,
      };
    }
    const ch = channelOf(channels, route.id);
    const name = ch?.name || route.id;
    if (route.kind === 'forum') {
      const tag = (route.tags || []).join(', ');
      return {
        short: tag ? t('lg.dest.forum', 'the {c} forum, tag {t}').replace('{c}', name).replace('{t}', tag) : t('lg.dest.forum0', 'the {c} forum').replace('{c}', name),
        node: (
          <span className="inline-flex items-center gap-1 min-w-0">
            <ChannelTag channel={ch || { type: 15, name }} id={route.id} />
            {tag && <span className="text-[10px] text-[var(--faint)] shrink-0">{t('lg.dest.tag', 'tag {t}').replace('{t}', tag)}</span>}
          </span>
        ),
      };
    }
    return { short: `#${name}`, node: <ChannelTag channel={ch || { type: 0, name }} id={route.id} /> };
  };
}

// ── The automod editor ────────────────────────────────────────────────────────────────────
// Each rule reads as two sentences: what it CATCHES (with its numbers as the fields you type
// in) and what it THEN DOES. Nothing is behind a label like "maxMessages".

/** A sentence with fields in it. `parts` is a list of strings and nodes. */
const Sentence = ({ children, className = '' }) => (
  <div className={`flex flex-wrap items-center gap-x-1 gap-y-1 text-[11.5px] text-[var(--muted)] leading-relaxed ${className}`}>{children}</div>
);

function CatchSentence({ name, r, setRule, LB }) {
  const { t } = useI18n();
  const num = (k, cls) => <NumField key={k} value={r[k]} f={FIELD(name, k)} onCommit={(n) => setRule({ [k]: n })} className={cls} />;
  switch (name) {
    case 'spam': return (
      <Sentence>
        {t('amod.s.spam1', 'More than')} {num('maxMessages')} {t('amod.s.spam2', 'messages in')} {num('windowSec')} {t('amod.s.sec', 'seconds,')}
        {t('amod.s.spam3', 'or the same message')} {num('maxRepeats')} {t('amod.s.spam4', 'times within')} {num('repeatWindowSec')} {t('amod.s.sec2', 'seconds.')}
      </Sentence>
    );
    case 'mentions': return (
      <Sentence>
        {t('amod.s.men1', 'One message pinging more than')} {num('maxUsers')} {t('amod.s.men2', 'members or')} {num('maxRoles')} {t('amod.s.men3', 'roles.')}
        <Check checked={!r.everyone} onChange={(on) => setRule({ everyone: !on })} className="!text-[11.5px]">{t('amod.s.men4', 'Also catch @everyone and @here')}</Check>
      </Sentence>
    );
    case 'invites': return (
      <div className="space-y-1.5">
        <Sentence>{t('amod.s.inv', 'An invite link to another Discord server. Your own server is always allowed.')}</Sentence>
        <div className="grid sm:grid-cols-2 gap-2">
          <Field label={LB.field.allowGuilds}><Chips items={r.allowGuilds} onChange={(l) => setRule({ allowGuilds: l })} placeholder={t('amod.list.ph', 'Type and press Enter')} /></Field>
          <Field label={LB.field.allowCodes}><Chips items={r.allowCodes} onChange={(l) => setRule({ allowCodes: l })} placeholder={t('amod.list.ph', 'Type and press Enter')} /></Field>
        </div>
      </div>
    );
    case 'links': return (
      <div className="space-y-1.5">
        <Sentence>{r.allowDomains.length ? t('amod.s.link1', 'A link to any domain outside the list below.') : t('amod.s.link0', 'Any link at all: the allowed list is empty.')}</Sentence>
        <Field label={LB.field.allowDomains}><Chips items={r.allowDomains} onChange={(l) => setRule({ allowDomains: l })} max={200} placeholder={t('amod.s.link.ph', 'example.com')} /></Field>
      </div>
    );
    case 'words': return (
      <div className="space-y-1.5">
        <Sentence>{t('amod.s.words', 'A message matching one of these patterns. A plain word matches that whole word; pre* and *mid* are wildcards; /regex/i is the regex as written.')}</Sentence>
        <Field label={LB.field.patterns}><Chips items={r.patterns} onChange={(l) => setRule({ patterns: l })} max={500} placeholder={t('amod.s.words.ph', 'word, pre*, /regex/i')} /></Field>
      </div>
    );
    case 'caps': return (
      <Sentence>
        {t('amod.s.caps1', 'A message of at least')} {num('minLetters')} {t('amod.s.caps2', 'letters that is')}
        <NumField value={Math.round(r.ratio * 100)} f={{ min: 0, max: 100, int: true }} onCommit={(n) => setRule({ ratio: Math.round(n) / 100 })} />
        {t('amod.s.caps3', '% upper-case or more.')}
      </Sentence>
    );
    case 'zalgo': return (
      <Sentence>
        {t('amod.s.zal1', 'Text carrying')} {num('maxCombining')} {t('amod.s.zal2', 'combining marks or more, or where they are')}
        <NumField value={Math.round(r.maxRatio * 100)} f={{ min: 0, max: 100, int: true }} onCommit={(n) => setRule({ maxRatio: Math.round(n) / 100 })} />
        {t('amod.s.zal3', '% of the characters.')}
      </Sentence>
    );
    case 'attachments': return (
      <div className="space-y-1.5">
        <Sentence>{r.allowTypes.length ? t('amod.s.att1', 'Any attached file whose type is not in the allowed list.') : t('amod.s.att0', 'An attached file of one of the blocked types.')}</Sentence>
        <div className="grid sm:grid-cols-2 gap-2">
          <Field label={LB.field.blockTypes}><Chips items={r.blockTypes} onChange={(l) => setRule({ blockTypes: l })} placeholder={t('amod.s.att.ph', 'exe')} /></Field>
          <Field label={LB.field.allowTypes}><Chips items={r.allowTypes} onChange={(l) => setRule({ allowTypes: l })} placeholder={t('amod.s.att.ph2', 'png')} /></Field>
        </div>
      </div>
    );
    case 'accountAge': return (
      <Sentence>{t('amod.s.age1', 'Someone joining with an account less than')} {num('minDays')} {t('amod.s.age2', 'days old.')}</Sentence>
    );
    case 'selfbot': return (
      <Sentence>
        {t('amod.s.self1', 'One member posting across')} {num('channelsPerWindow')} {t('amod.s.self2', 'channels within')} {num('windowSec')} {t('amod.s.sec', 'seconds,')}
        {t('amod.s.self3', 'the same text in two channels within')} {num('identicalAcrossSec')} {t('amod.s.sec', 'seconds,')}
        {t('amod.s.self4', 'or more than')} {num('maxPerMinute')} {t('amod.s.self5', 'messages a minute.')}
      </Sentence>
    );
    case 'raid': return (
      <div className="space-y-1">
        <Sentence>
          {num('joins')} {t('amod.s.raid1', 'joins within')} {num('windowSec')} {t('amod.s.raid2', 'seconds locks the server down for')} {num('lockdownMin')} {t('amod.s.raid3', 'minutes.')}
        </Sentence>
        <Sentence>
          <Check checked={r.raiseVerification} onChange={(on) => setRule({ raiseVerification: on })} className="!text-[11.5px]">{t('amod.s.raid4', 'Raise the verification level while it lasts')}</Check>
          <Check checked={r.alert} onChange={(on) => setRule({ alert: on })} className="!text-[11.5px] ms-3">{t('amod.s.raid5', 'Mark the log entry as an alert')}</Check>
        </Sentence>
      </div>
    );
    default: return null;
  }
}

/** What the rule does once it fires, in one sentence, from the action and its parameters. */
function EffectSentence({ name, r, setRule, LB }) {
  const { t } = useI18n();
  const join = JOIN_RULES.includes(name);
  const act = r.logOnly ? 'log' : r.action;
  const mins = <NumField value={r.timeoutMin} f={FIELD(name, 'timeoutMin')} onCommit={(n) => setRule({ timeoutMin: n })} />;
  const del = !join && act !== 'log' && r.deleteMessage;
  const what = () => {
    if (act === 'log') return t('amod.e.log', 'nothing is carried out: it is only recorded.');
    if (act === 'delete') return t('amod.e.delete', 'the message is removed.');
    if (act === 'warn') return t('amod.e.warn', 'a warning goes on their record, and the warn ladder below decides the rest.');
    if (act === 'kick') return t('amod.e.kick', 'they are removed from the server.');
    if (act === 'ban') return t('amod.e.ban', 'they are banned.');
    return null; // timeout / quarantine carry a number, handled inline below
  };
  const timed = act === 'timeout' || act === 'quarantine';
  return (
    <Sentence className="!text-[var(--text)]">
      <ArrowRight size={11} className="text-[var(--faint)] shrink-0" />
      {del && <span>{t('amod.e.del', 'The message is removed and')}</span>}
      {timed ? <>{del ? t('amod.e.timed2', 'they cannot post for') : t('amod.e.timed', 'They cannot post for')} {mins} {t('amod.e.min', 'minutes.')}</>
        : <span>{del ? what() : `${what().charAt(0).toUpperCase()}${what().slice(1)}`}</span>}
      {r.logOnly && r.action !== 'log' && (
        <span className="text-warning">{t('amod.e.watch', 'Watch-only is on, so the action below is written down and not carried out.')}</span>
      )}
      {!r.logOnly && r.dm && <span>{t('amod.e.dm', 'They are told by DM.')}</span>}
    </Sentence>
  );
}

/**
 * `value` is a normalised automod object (normAutomod), `onChange` gets the next one.
 * `roles` / `channels` are the bot's live lists for the pickers. `memberSearch(q)` feeds the
 * member picker. `hideEnable` when the host card already carries the on/off switch.
 */
export function AutomodEditor({ value, onChange, roles, channels, memberSearch, hideEnable }) {
  const { t } = useI18n();
  const LB = useAutomodLabels();
  const v = value || normAutomod(null);
  const [open, setOpen] = useState({});   // rule → its exceptions panel is open
  const set = (patch) => onChange({ ...v, ...patch });
  const setEx = (patch) => set({ exempt: { ...v.exempt, ...patch } });
  const setRule = (name, patch) => set({ rules: { ...v.rules, [name]: { ...v.rules[name], ...patch } } });
  return (
    <div className="space-y-4">
      {!hideEnable && (
        <Check checked={v.enabled} onChange={(on) => set({ enabled: on })} className="text-sm font-medium">{t('amod.enabled', 'Automod on')}</Check>
      )}
      <p className="text-[11.5px] text-[var(--muted)]">{t('amod.h2', 'Every rule is checked on each message, or on each join. When several fire at once only the most severe one is carried out, never both.')}</p>

      {/* The rules */}
      <div className="rounded-xl border border-[var(--line)] divide-y divide-[var(--line)] overflow-hidden">
        {AUTOMOD_RULES.map((name) => {
          const r = v.rules[name];
          const join = JOIN_RULES.includes(name);
          const acts = actionsFor(name);
          const isOpen = !!open[name];
          const exCount = join ? 0 : (r.exempt.roles.length + r.exempt.channels.length);
          return (
            <div key={name} className={`p-3 ${r.enabled ? '' : 'opacity-60'}`}>
              <div className="flex items-center gap-2 flex-wrap">
                <Check checked={r.enabled} onChange={(on) => setRule(name, { enabled: on })} className="min-w-[120px]">
                  <span className="text-sm font-medium text-[var(--text)]">{LB.name[name]}</span>
                </Check>
                <span className="flex-1" />
                <Select className="!w-auto !py-1 text-xs" value={r.action} onChange={(e) => setRule(name, { action: e.target.value })} aria-label={t('amod.action', 'Action')}>
                  {acts.map((a) => <option key={a} value={a}>{LB.action[a]}</option>)}
                </Select>
              </div>
              {r.enabled && (
                <div className="mt-2 ps-6 space-y-2">
                  <CatchSentence name={name} r={r} setRule={(p) => setRule(name, p)} LB={LB} />
                  <EffectSentence name={name} r={r} setRule={(p) => setRule(name, p)} LB={LB} />
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                    {!join && r.action !== 'log' && (
                      <Check checked={r.deleteMessage} onChange={(on) => setRule(name, { deleteMessage: on })}>{t('amod.p.del', 'Delete the message')}</Check>
                    )}
                    <Check checked={r.dm} onChange={(on) => setRule(name, { dm: on })}>{t('amod.p.dm', 'Tell the member by DM')}</Check>
                    <Check checked={r.logOnly} onChange={(on) => setRule(name, { logOnly: on })}>{t('amod.p.watch', 'Watch only, carry nothing out')}</Check>
                    {!join && (
                      <button type="button" onClick={() => setOpen((s) => ({ ...s, [name]: !isOpen }))} aria-expanded={isOpen}
                        className="inline-flex items-center gap-1 text-[11px] text-[var(--muted)] hover:text-[var(--text)]">
                        {exCount ? t('amod.p.exn', 'Exceptions ({n})').replace('{n}', exCount) : t('amod.p.ex', 'Exceptions')}
                        <ChevronDown size={11} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                      </button>
                    )}
                  </div>
                  {!join && isOpen && (
                    <div className="grid sm:grid-cols-2 gap-2.5 pt-1">
                      <Field label={t('amod.p.exroles', 'Roles this rule ignores')}>
                        <PickerList kind="role" items={r.exempt.roles} roles={roles} onChange={(l) => setRule(name, { exempt: { ...r.exempt, roles: l } })} />
                      </Field>
                      <Field label={t('amod.p.exchans', 'Channels this rule ignores')}>
                        <PickerList kind="channel" items={r.exempt.channels} channels={channels} types={CHANNEL_TYPES.postable} onChange={(l) => setRule(name, { exempt: { ...r.exempt, channels: l } })} />
                      </Field>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Exemptions that apply to every rule */}
      <div className="rounded-xl border border-[var(--line)] p-3 space-y-2.5">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--faint)]">{t('amod.ex2', 'No rule applies to')}</div>
        <Check checked={v.exempt.moderators} onChange={(on) => setEx({ moderators: on })}>{t('amod.ex.mods', 'Moderators (Manage Messages / Manage Server / Administrator)')}</Check>
        <div className="grid sm:grid-cols-3 gap-3">
          <Field label={t('amod.ex.roles', 'Roles')}><PickerList kind="role" items={v.exempt.roles} roles={roles} onChange={(l) => setEx({ roles: l })} /></Field>
          <Field label={t('amod.ex.channels', 'Channels')}><PickerList kind="channel" items={v.exempt.channels} channels={channels} types={CHANNEL_TYPES.postable} onChange={(l) => setEx({ channels: l })} /></Field>
          <Field label={t('amod.ex.users2', 'Members')}><PickerList kind="user" items={v.exempt.users} search={memberSearch} onChange={(l) => setEx({ users: l })} /></Field>
        </div>
      </div>
    </div>
  );
}

// ── The warn ladder ───────────────────────────────────────────────────────────────────────
/**
 * "At N warnings, do X." `value` is moderation.warnThresholds (normLadder'd), `decayHours` is
 * automod.warnDecayHours — it lives in another subtree but it belongs beside the ladder,
 * because it is the ladder's units: a ladder counting warnings nobody can see the lifetime of
 * is a ladder nobody can predict.
 */
export function WarnLadderEditor({ value, onChange, decayHours, onDecayChange }) {
  const { t } = useI18n();
  const LB = useAutomodLabels();
  const rows = normLadder(value);
  const set = (next) => onChange(normLadder(next));
  const upd = (i, patch) => set(rows.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const nextCount = () => Math.min(1000, (rows.length ? Math.max(...rows.map((r) => r.count)) : 0) + 2);
  return (
    <div className="space-y-2.5">
      <p className="text-[11.5px] text-[var(--muted)]">{t('wl.h', 'A warning on its own does nothing. These steps say what the Nth one costs. Only the step whose number the member has just reached fires, never the ones below it, and never twice.')}</p>
      <div className="rounded-xl border border-[var(--line)] divide-y divide-[var(--line)]">
        {rows.length === 0 && <div className="px-3 py-2.5 text-[11px] text-[var(--faint)]">{t('wl.none', 'No step: a warning never turns into anything else.')}</div>}
        {rows.map((r, i) => (
          <div key={i} className="px-3 py-2 flex items-center gap-2 flex-wrap text-[11.5px] text-[var(--muted)]">
            <span>{t('wl.at', 'At')}</span>
            <NumField value={r.count} f={{ min: 1, max: 1000, int: true }} onCommit={(n) => upd(i, { count: n })} />
            <span>{t('wl.warnings', 'warnings,')}</span>
            <Select className="!w-auto !py-1 text-xs" value={r.action} onChange={(e) => upd(i, { action: e.target.value })} aria-label={t('wl.action', 'What happens')}>
              {LADDER_ACTIONS.map((a) => <option key={a} value={a}>{LB.action[a]}</option>)}
            </Select>
            {LADDER_TIMED.includes(r.action) && (<>
              <span>{t('wl.for', 'for')}</span>
              <NumField value={r.minutes} f={{ min: 1, max: 40320, int: true }} onCommit={(n) => upd(i, { minutes: n })} />
              <span>{t('wl.min', 'minutes')}</span>
            </>)}
            {['log', 'delete', 'warn'].includes(r.action) && <span className="text-[var(--faint)]">{t('wl.noop', 'nothing is carried out: the step is written down and inert.')}</span>}
            <span className="flex-1" />
            <button type="button" onClick={() => set(rows.filter((_, k) => k !== i))} className="text-[var(--faint)] hover:text-error shrink-0" title={t('common.remove', 'Remove')}><Trash2 size={12} /></button>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {rows.length < 20 && (
          <Button size="sm" variant="ghost" onClick={() => set([...rows, { count: nextCount(), action: 'timeout', minutes: 60 }])}>
            <Plus size={13} /> {t('wl.add', 'Add a step')}
          </Button>
        )}
        {onDecayChange && (
          <span className="inline-flex items-center gap-1.5 text-[11.5px] text-[var(--muted)] ms-auto">
            {t('wl.decay', 'A warning counts for')}
            <NumField value={decayHours} f={{ min: 0, max: 8760, int: true }} onCommit={onDecayChange} className="!w-16" />
            {decayHours === 0 ? t('wl.decay0', 'hours: 0 means for ever') : t('wl.decayh', 'hours')}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * One routing row: the category or group, where it lands RIGHT NOW in words, the control that
 * changes it, and (for a category) the button that sends a sample entry there.
 *
 * Module scope on purpose. Declared inside LogsEditor it would be a new component type on
 * every render, which unmounts and remounts the tag input after each keystroke.
 */
function RouteRow({ k, label, sub, ctx }) {
  const { t } = useI18n();
  const { v, channels, legacyChannelId, describe, setMode, setRoute, routeOf, resolve, onTest, testing, test } = ctx;
  const r = routeOf(k);
  const m = r?.kind || 'default';
  // What "follow the default" resolves to for THIS row: the option is named after the place it
  // ends at, so the list never offers the bare word "default".
  const inherited = describe(resolveLogRoute({ ...v, routes: Object.fromEntries(Object.entries(v.routes).filter(([x]) => x !== k)) }, k, { legacyChannelId }));
  const here = describe(resolve(k));
  return (
    <div className={`py-1.5 ${sub ? 'ps-6' : ''}`}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`min-w-[130px] ${sub ? 'text-xs text-[var(--muted)]' : 'text-sm font-medium'}`}>{label}</span>
        <span className="inline-flex items-center gap-1 text-[11px] min-w-0 flex-1">
          <ArrowRight size={11} className="text-[var(--faint)] shrink-0" />
          {here.node}
        </span>
        <Select className="!w-auto !py-1 text-xs" value={m} onChange={(e) => setMode(k, e.target.value)} aria-label={t('lg.route', 'Route')}>
          <option value="default">{sub ? t('lg.m.group2', 'Same as its group ({d})').replace('{d}', inherited.short) : t('lg.m.default2', 'The default ({d})').replace('{d}', inherited.short)}</option>
          <option value="off">{t('lg.m.off2', 'Nowhere')}</option>
          <option value="channel">{t('lg.m.channel', 'A text channel')}</option>
          <option value="forum">{t('lg.m.forum', 'A forum')}</option>
        </Select>
        {onTest && sub && (
          <button type="button" disabled={!!testing} onClick={() => test(k)} title={t('lg.test', 'Send a test entry')}
            className="p-1 rounded-md text-[var(--muted)] hover:text-[var(--primary-2)] hover:bg-[var(--surface-2)] disabled:opacity-50 shrink-0">
            <Send size={12} />
          </button>
        )}
      </div>
      {(m === 'channel' || m === 'forum') && (
        <div className="flex items-center gap-2 flex-wrap mt-1 sm:ps-[138px]">
          <span className="w-52"><ChannelPicker channels={channels} types={m === 'forum' ? CHANNEL_TYPES.forum : CHANNEL_TYPES.postable} value={r?.id} onChange={(id) => setRoute(k, { ...r, id })} /></span>
          {m === 'forum' && (
            <Input className="!py-1 text-xs w-44" value={(r?.tags || []).join(', ')} placeholder={t('lg.tags.ph2', 'Tag names, comma separated')}
              onChange={(e) => setRoute(k, { ...r, tags: e.target.value.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 5) })} />
          )}
        </div>
      )}
    </div>
  );
}

// ── The log routing editor ────────────────────────────────────────────────────────────────
/**
 * `value` is a normalised logs object (normLogs); `channels` the bot's live list.
 * `legacyChannelId` is the moderation log channel set elsewhere, so a row can say it is what
 * an event falls back to. `onTest(category)` (optional) posts a sample entry and resolves to
 * `{ ok, route }` — the host owns the network call and the toast.
 */
export function LogsEditor({ value, onChange, channels, legacyChannelId = '', onTest, hideEnable }) {
  const { t } = useI18n();
  const LB = useLogLabels();
  const describe = useDestination(channels);
  const v = value || normLogs(null);
  const [openGroups, setOpenGroups] = useState({});
  const [testing, setTesting] = useState('');
  const set = (patch) => onChange({ ...v, ...patch });
  const routeOf = (k) => v.routes[k] || null;
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
  const resolve = (k) => resolveLogRoute(v, k, { legacyChannelId });
  const test = async (k) => {
    if (!onTest) return;
    setTesting(k);
    try { await onTest(k); } finally { setTesting(''); }
  };

  const row = { v, channels, legacyChannelId, describe, setMode, setRoute, routeOf, resolve, onTest, testing, test };

  return (
    <div className="space-y-4">
      {!hideEnable && <Check checked={v.enabled} onChange={(on) => set({ enabled: on })} className="text-sm font-medium">{t('lg.enabled', 'Logs on')}</Check>}

      {/* The screen's default destination: what every row below falls back to. */}
      <div className="rounded-xl border border-[var(--line)] p-3 space-y-3">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--faint)]">{t('lg.def', 'By default, everything goes to')}</div>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label={t('lg.forum', 'Log forum')} hint={t('lg.forum.h3', 'One post per category, tagged with its group. Used first when it is set.')}>
            <ChannelPicker channels={channels} types={CHANNEL_TYPES.forum} value={v.forumId} onChange={(id) => set({ forumId: id })} />
          </Field>
          <Field label={t('lg.channel', 'Fallback text channel')} hint={t('lg.channel.h2', 'Used when no forum is set. Empty falls back to the moderation log channel.')}>
            <ChannelPicker channels={channels} types={CHANNEL_TYPES.postable} value={v.channelId} onChange={(id) => set({ channelId: id })} />
          </Field>
          <Field label={t('lg.mode', 'Forum posts')}>
            <Select className="!py-1 text-xs" value={v.forumMode} onChange={(e) => set({ forumMode: e.target.value })}>
              <option value="category">{t('lg.mode.category', 'One post per category')}</option>
              <option value="day">{t('lg.mode.day', 'One post per day')}</option>
            </Select>
          </Field>
          <Field label={t('lg.reaction', 'Reaction on every post')} hint={t('lg.reaction.h2', 'Empty uses the icon set. Else a unicode emoji or <:name:id>.')}>
            <Input className="!py-1 text-xs" value={v.reaction} onChange={(e) => set({ reaction: e.target.value.slice(0, 64) })} placeholder="<:name:id>" />
          </Field>
        </div>
        <Check checked={v.pinSummary} onChange={(on) => set({ pinSummary: on })}>{t('lg.pin', 'Pin each post’s first message (what the post is for)')}</Check>
      </div>

      {/* The routing table. One sentence states the rule; every row states its answer. */}
      <div>
        <p className="text-[11.5px] text-[var(--muted)] mb-2">{t('lg.rule', 'A category goes where its group goes, and a group goes to the default above, unless you route it somewhere of its own. Each row already says where its next event will land.')}</p>
        <div className="rounded-xl border border-[var(--line)] divide-y divide-[var(--line)] px-3">
          {LOG_GROUPS.map((g) => {
            const cats = LOG_CATEGORY_KEYS.filter((k) => LOG_CATEGORIES[k] === g);
            const isOpen = !!openGroups[g];
            const own = cats.filter((k) => routeOf(k)).length;
            return (
              <div key={g}>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => setOpenGroups((s) => ({ ...s, [g]: !isOpen }))} className="p-1 -ms-1 text-[var(--faint)] hover:text-[var(--text)]" aria-expanded={isOpen} title={t('lg.cats', 'Categories')}>
                    <ChevronDown size={13} className={`transition-transform ${isOpen ? '' : '-rotate-90'}`} />
                  </button>
                  <div className="flex-1 min-w-0">
                    <RouteRow k={g} ctx={row} label={<>{LB.group[g]}{own ? <span className="text-[10px] font-normal text-[var(--faint)]"> · {t('lg.own', '{n} routed on their own').replace('{n}', own)}</span> : null}</>} />
                  </div>
                </div>
                {isOpen && <div className="pb-1.5">{cats.map((k) => <RouteRow key={k} k={k} ctx={row} label={LB.cat[k]} sub />)}</div>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// /logs — setup, route, test, status — and /lockdown. The Discord front door of logs.mjs.
//
// Writes go through the API (PUT /bot/guilds/:id/features): the API checks the actor is the
// server's owner or a manager with a LINKED account, the same rule /config follows, and the
// saved shape is the one documented at the top of logs.mjs — so the dashboard and this
// command edit the same object.
import { ButtonStyle, ChannelType, PermissionFlagsBits } from 'discord.js';
import * as ui from '../ui.mjs';
import { api, SITE_URL } from '../api.mjs';
import { guildConfig, config } from '../config.mjs';
import { tr } from '../i18n.mjs';
import { learnButton } from '../help.mjs';
import { CATEGORIES, GROUPS, CATEGORY_KEYS, normalizeLogs, resolveRoute, setupLogForum, setupAlertForum, logEvent, _queue } from './logs.mjs';
import { manualLockdown, stateFor, lockdownActive } from './automod.mjs';

const canManage = (i) => !!(i.memberPermissions?.has?.(PermissionFlagsBits.ManageGuild) || i.guild?.ownerId === i.user.id);

/** Autocomplete for the `category` option: categories and groups, filtered on what was typed. */
export async function logsAutocomplete(i) {
  const q = String(i.options.getFocused() || '').toLowerCase();
  const all = [
    ...Object.entries(GROUPS).map(([k, v]) => ({ name: `${v} (every ${k} category)`, value: k })),
    ...CATEGORY_KEYS.map((k) => ({ name: `${GROUPS[CATEGORIES[k].group]} · ${CATEGORIES[k].label}  [${k}]`, value: k })),
  ];
  const hits = all.filter((c) => !q || c.name.toLowerCase().includes(q) || c.value.includes(q)).slice(0, 25);
  return i.respond(hits.map((c) => ({ name: c.name.slice(0, 100), value: c.value }))).catch(() => {});
}

async function refuse(i, t) {
  if (!i.guildId) { await ui.line(i, t('cfg.guildonly'), { color: ui.BAD }); return true; }
  if (!canManage(i)) { await ui.line(i, t('cfg.notmanager'), { color: ui.BAD }); return true; }
  return false;
}
/** Explain a refused write the way configure.mjs does: not linked ≠ not allowed. */
async function saveOrExplain(i, t, r) {
  if (r?.ok) return true;
  if (r?.error === 'not_allowed' && r.linked === false) {
    await ui.reply(i, { title: t('cfg.link.title'), body: [t('cfg.link.body')], color: ui.INFO, buttons: [ui.btn('eco:link', t('btn.link'), ButtonStyle.Primary, { emoji: 'link' })] });
  } else if (r?.error === 'not_allowed') await ui.line(i, t('cfg.notmanager'), { color: ui.BAD });
  else await ui.line(i, t('cfg.failed'), { color: ui.BAD });
  return false;
}

const describeRoute = (r) => (r.kind === 'off' ? '— off' : `${r.kind === 'forum' ? 'forum' : 'channel'} ${(r.ids?.length ? r.ids : [r.id]).map((id) => `<#${id}>`).join(' ')}${r.tags?.length ? ` · ${r.tags.join(', ')}` : ''}`);

export async function cmdLogs(i) {
  const { t } = await tr(i);
  if (await refuse(i, t)) return undefined;
  const sub = i.options.getSubcommand();
  if (sub === 'setup') return logsSetup(i, t);
  if (sub === 'route') return logsRoute(i, t);
  if (sub === 'test') return logsTest(i, t);
  return logsStatus(i, t);
}

async function currentLogs(guildId) {
  const cfg = await guildConfig(guildId, true);
  const legacy = (await config().catch(() => null))?.guildLogChannels?.[guildId] || '';
  return { cfg, logs: normalizeLogs(cfg.logs), legacy };
}

async function logsSetup(i, t) {
  const kind = i.options.getString('kind') || 'logs';
  const parent = i.options.getChannel('category');
  const parentId = parent?.type === ChannelType.GuildCategory ? parent.id : null;
  await i.deferReply({ ephemeral: true });
  const { logs } = await currentLogs(i.guildId);
  if (kind === 'alerts') {
    // The admin-alerts forum is GLOBAL config (alerts.forumId) — a site admin sets it in the
    // dashboard. This creates the forum with its tags and hands over the id to paste.
    const forum = await setupAlertForum(i.guild, { parentId }).catch((e) => { console.warn('[logs] alert forum:', e.message); return null; });
    if (!forum) return ui.editReply(i, { title: t('logs.title'), body: t('logs.setup.failed'), color: ui.BAD });
    return ui.editReply(i, { title: t('logs.title'), color: ui.GOOD, body: [t('logs.setup.alerts', { ch: `<#${forum.id}>` }), `\`${forum.id}\``], buttons: [ui.btn(`${SITE_URL}/admin?s=bot`, t('btn.dashboard'), ButtonStyle.Secondary, { emoji: 'site' })] });
  }
  const existing = logs.forumId ? (i.guild.channels.cache.get(logs.forumId) || await i.guild.channels.fetch(logs.forumId).catch(() => null)) : null;
  const forum = await setupLogForum(i.guild, { parentId, existing: existing && [ChannelType.GuildForum, ChannelType.GuildMedia].includes(existing.type) ? existing : null, reaction: logs.reaction }).catch((e) => { console.warn('[logs] forum setup:', e.message); return null; });
  if (!forum) return ui.editReply(i, { title: t('logs.title'), body: t('logs.setup.failed'), color: ui.BAD });
  const r = await api.setGuildFeatures(i.guildId, i.user.id, { logs: { ...logs, forumId: forum.id, enabled: true } });
  if (!(await saveOrExplain(i, t, r))) return undefined;
  await guildConfig(i.guildId, true);
  return ui.editReply(i, {
    title: t('logs.title'), color: ui.GOOD,
    body: [t(existing ? 'logs.setup.updated' : 'logs.setup.done', { ch: `<#${forum.id}>` }), '', t('logs.setup.next')],
    buttons: [ui.btn(`${SITE_URL}/dashboard?s=discord`, t('cfg.more'), ButtonStyle.Secondary, { emoji: 'site' })],
  });
}

async function logsRoute(i, t) {
  const category = String(i.options.getString('category') || '').trim();
  if (!CATEGORIES[category] && !GROUPS[category]) return ui.line(i, t('logs.route.unknown', { c: category }), { color: ui.BAD });
  const ch = i.options.getChannel('destination');
  const off = i.options.getBoolean('off');
  const { logs } = await currentLogs(i.guildId);
  const routes = { ...logs.routes };
  let route;
  if (off) route = { kind: 'off' };
  else if (ch) {
    const isForum = ch.type === ChannelType.GuildForum || ch.type === ChannelType.GuildMedia;
    if (!isForum && ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(ch.type)) return ui.line(i, t('logs.route.badchannel'), { color: ui.BAD });
    route = { kind: isForum ? 'forum' : 'channel', id: ch.id, tags: [] };
  } else { delete routes[category]; route = null; } // back to the default
  if (route) routes[category] = route;
  const r = await api.setGuildFeatures(i.guildId, i.user.id, { logs: { ...logs, routes } });
  if (!(await saveOrExplain(i, t, r))) return undefined;
  const cfg = await guildConfig(i.guildId, true);
  const shown = CATEGORIES[category] ? resolveRoute(cfg.logs, category, { legacyChannelId: (await currentLogs(i.guildId)).legacy }) : (route || { kind: 'off' });
  return ui.reply(i, { title: t('logs.title'), color: ui.GOOD, body: t('logs.route.saved', { c: category, d: describeRoute(shown), from: shown.from || '' }) });
}

async function logsTest(i, t) {
  const category = String(i.options.getString('category') || 'automod').trim();
  const cat = CATEGORIES[category] ? category : CATEGORY_KEYS.find((k) => CATEGORIES[k].group === category) || null;
  if (!cat) return ui.line(i, t('logs.route.unknown', { c: category }), { color: ui.BAD });
  const { cfg, legacy } = await currentLogs(i.guildId);
  const route = resolveRoute(cfg.logs, cat, { legacyChannelId: legacy });
  if (route.kind === 'off') return ui.line(i, t('logs.test.off', { c: cat, from: route.from }), { color: ui.INFO });
  const me = { id: i.user.id, tag: i.user.tag, avatar: i.user.displayAvatarURL?.({ size: 64 }) };
  const sample = {
    'messages.edit': { user: me, channelId: i.channelId, messageId: i.id, before: 'helo', after: 'hello' },
    'messages.bulk': { channelId: i.channelId, count: 2, messages: [{ user: me, content: 'one' }, { user: me, content: 'two' }] },
    'members.roles': { user: me, added: [i.guild.roles.everyone?.id].filter(Boolean), removed: [] },
    'members.timeout': { user: me, until: Date.now() + 60_000, actor: me, reason: 'test' },
    'voice': { user: me, kind: 'join', to: i.channelId },
    'automod': { user: me, rule: 'test', action: 'log', reason: '/logs test', channelId: i.channelId, content: 'a test message', outcome: {} },
    'modcmd': { actor: me, command: 'logs test', channelId: i.channelId, detail: `category ${cat}` },
    'server.channels': { kind: 'test', name: i.channel?.name || 'channel', targetId: i.channelId, changes: [{ key: 'topic', before: 'old', after: 'new' }], actor: me },
    'economy.shop': { user: me, kind: 'test', detail: 'a test purchase', delta: -10, balance: 90 },
  }[cat] || { user: me, channelId: i.channelId, messageId: i.id, content: `/logs test ${cat}`, reason: 'test', actor: me, title: 'Test', message: `/logs test ${cat}`, name: 'test', kind: 'test' };
  const ok = await logEvent(i.guildId, cat, sample);
  _queue.flush();
  return ui.reply(i, { title: t('logs.title'), color: ok ? ui.GOOD : ui.BAD, body: ok ? t('logs.test.sent', { c: cat, d: describeRoute(route), from: route.from }) : t('logs.test.failed', { c: cat, d: describeRoute(route) }) });
}

async function logsStatus(i, t) {
  const { cfg, logs, legacy } = await currentLogs(i.guildId);
  const lines = [];
  let lastGroup = '';
  for (const k of CATEGORY_KEYS) {
    const g = CATEGORIES[k].group;
    if (g !== lastGroup) { lines.push(`**${GROUPS[g]}**`); lastGroup = g; }
    lines.push(`· ${CATEGORIES[k].label} ${describeRoute(resolveRoute(cfg.logs, k, { legacyChannelId: legacy }))}`);
  }
  const head = [
    `${t('logs.status.forum')} ${logs.forumId ? `<#${logs.forumId}> (${logs.forumMode})` : `*${t('cfg.none')}*`}`,
    `${t('logs.status.channel')} ${logs.channelId ? `<#${logs.channelId}>` : legacy ? `<#${legacy}> (/config)` : `*${t('cfg.none')}*`}`,
    logs.enabled ? '' : `**${t('logs.status.disabled')}**`,
  ].filter(Boolean);
  return ui.reply(i, { title: t('logs.title'), body: [...head, '', ...lines], footer: t('logs.status.footer'), buttons: [ui.btn(`${SITE_URL}/dashboard?s=discord`, t('cfg.more'), ButtonStyle.Secondary, { emoji: 'site' }), learnButton(t, 'logs')] });
}

/** /lockdown on|off [minutes] — the raid lockdown, by hand. */
export async function cmdLockdown(i) {
  const { t } = await tr(i);
  if (!i.guildId) return ui.line(i, t('cfg.guildonly'), { color: ui.BAD });
  const on = i.options.getString('state') !== 'off';
  const minutes = Math.max(1, Math.min(24 * 60, i.options.getInteger('minutes') || 15));
  if (!on && !lockdownActive(stateFor(i.guildId))) return ui.line(i, t('lock.notactive'), { color: ui.INFO });
  await i.deferReply({ ephemeral: true });
  const r = await manualLockdown(i.guild, on, minutes).catch((e) => { console.warn('[automod] lockdown:', e.message); return null; });
  if (r == null) return ui.editReply(i, { title: t('lock.title'), body: t('cfg.failed'), color: ui.BAD });
  await logEvent(i.guildId, 'modcmd', { actor: { id: i.user.id, tag: i.user.tag }, command: `lockdown ${on ? 'on' : 'off'}`, detail: on ? `${minutes} min` : '' });
  return ui.editReply(i, { title: t('lock.title'), color: on ? ui.BAD : ui.GOOD, body: on ? t('lock.on', { n: minutes }) : t('lock.off') });
}

// BetterCommunity Discord bot entry point. A small connection manager keeps the gateway
// client in sync with the admin dashboard: it connects when a token exists and the bot
// is enabled, reconnects when the token changes, and disconnects when disabled — so the
// token can be set/rotated from the dashboard with no container restart.
import './logbuffer.mjs'; // patch console first so all startup logs are captured
import { Client, GatewayIntentBits, Partials, Events, REST, Routes, PermissionsBitField } from 'discord.js';
import { recentLogs } from './logbuffer.mjs';
import { api } from './api.mjs';
import { config, guildBan } from './config.mjs';
import { commandData, handleInteraction } from './commands.mjs';
import { onVoiceStateUpdate, sweepTempRooms } from './features/joinToCreate.mjs';
import { onMemberAdd, onMemberRemove } from './features/welcome.mjs';
import { onMessage } from './features/moderation.mjs';
import { checkGating, syncAllGating } from './features/gating.mjs';
import { scanAllMembers } from './features/scanMembers.mjs';
import { wireEconomy, flushEconomy } from './features/economy.mjs';
import { startModQueue } from './features/modqueue.mjs';
import { startAnnouncer } from './features/announce.mjs';
import { pollBlog } from './features/blog.mjs';
import { pollAlerts } from './features/alerts.mjs';
import { pollKofi } from './features/kofi.mjs';
import { pollPayments } from './features/payments.mjs';
import { pollDMs, pollDMBroadcast } from './features/dm.mjs';
import { pollGiveaways } from './features/giveaways.mjs';
import { pollRolePanels } from './features/rolepanel.mjs';
import { pollLinks } from './features/links.mjs';
import { temp, modStats } from './store.mjs';

let client = null;
let currentToken = null;
let timers = [];

function buildClient() {
  const c = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      // B-econ: reactions earn XP. Not a privileged intent.
      GatewayIntentBits.GuildMessageReactions,
    ],
    // Reaction partials so a reaction on an uncached (older) message still fires the event.
    partials: [Partials.Channel, Partials.Message, Partials.Reaction],
  });
  const guard = (fn) => (...a) => fn(...a).catch((e) => console.warn('[bot] handler error:', e.message));
  c.once(Events.ClientReady, async (ready) => {
    console.log(`[bot] logged in as ${ready.user.tag}`);
    try {
      const rest = new REST({ version: '10' }).setToken(currentToken);
      await rest.put(Routes.applicationCommands(ready.user.id), { body: commandData });
      console.log('[bot] slash commands registered');
    } catch (e) { console.warn('[bot] command registration failed:', e.message); }

    const beat = () => api.heartbeat({
      // The bot's own id === the application (client) id — what an "invite the bot" OAuth2 URL
      // needs, so the user dashboard can build that link without anyone pasting a client id.
      appId: ready.user.id,
      uptimeSec: Math.round(process.uptime()), guilds: ready.guilds.cache.size,
      users: ready.users.cache.size, tempChannels: temp.size, version: '0.1.0',
      // The servers the bot is in — id + name + icon + member count — so the
      // dashboard renders a real bot-style server picker and can target a specific
      // server for per-server config.
      // `roles` rides along so the dashboard can offer a role PICKER instead of a box to
      // paste a snowflake into. @everyone and managed roles (a bot's or a boost's own role)
      // are dropped: neither can be handed out, so offering them is offering a mistake.
      // Position is kept because it is the only way the dashboard can warn that a role sits
      // above the bot's own and therefore cannot be assigned.
      guildList: [...c.guilds.cache.values()].slice(0, 200).map((g) => ({
        id: g.id, name: String(g.name || '').slice(0, 120), icon: g.iconURL?.({ size: 64 }) || null, members: g.memberCount ?? null,
        botTop: g.members.me?.roles?.highest?.position ?? null,
        // B10: the owner (always known) + best-effort Manage-Server admins from the member
        // cache — so the user dashboard knows who may configure this server. Owner is the
        // reliable signal; managers depend on how much of the roster is cached, hence capped.
        ownerId: g.ownerId ?? null,
        managerIds: [...g.members.cache.values()]
          .filter((m) => !m.user?.bot && m.id !== g.ownerId && m.permissions?.has?.(PermissionsBitField.Flags.ManageGuild))
          .map((m) => m.id).slice(0, 50),
        roles: [...g.roles.cache.values()]
          .filter((r) => r.id !== g.id && !r.managed)
          .sort((a, b) => b.position - a.position)
          .slice(0, 100)
          .map((r) => ({ id: r.id, name: String(r.name || '').slice(0, 100), color: r.hexColor || null, position: r.position })),
        // Channels, so the dashboards can offer a PICKER instead of a box to paste a snowflake
        // into. type: 0=text, 2=voice, 4=category, 5=announcement, 15=forum — enough to filter
        // "a text channel to post in" from "a voice lobby". Capped like roles.
        channels: [...g.channels.cache.values()]
          .filter((ch) => [0, 2, 4, 5, 15].includes(ch.type))
          .slice(0, 200)
          .map((ch) => ({ id: ch.id, name: String(ch.name || '').slice(0, 100), type: ch.type, parentId: ch.parentId || null })),
      })),
      ping: c.ws.ping >= 0 ? c.ws.ping : null, mod: { ...modStats }, logs: recentLogs(60),
    });
    beat();
    timers.push(setInterval(beat, 60_000));
    // Temp voice rooms: re-adopt the ones a previous process created (people are still in
    // them), delete the empty ones it left behind, then keep doing that every two minutes.
    sweepTempRooms(c).catch(() => {});
    timers.push(setInterval(() => sweepTempRooms(c).catch(() => {}), 2 * 60_000));
    // B-econ: track messages / reactions / voice for XP, and flush the buffer every minute.
    wireEconomy(c);
    timers.push(setInterval(() => flushEconomy().catch(() => {}), 60_000));
    // Full member scan: populate the member database with the ENTIRE roster now, then
    // refresh every 30 min (names/avatars change, people join). Independent of gating.
    scanAllMembers(c).catch(() => {});
    timers.push(setInterval(() => scanAllMembers(c).catch(() => {}), 30 * 60_000));
    // Moderation queued on the website. Every guild the bot is in gets its own poller, because
    // the queue is keyed by discord id and the bot does not know which guild an id belongs to
    // until it tries — a single-guild assumption would silently ignore the others.
    for (const g of c.guilds.cache.values()) timers.push(startModQueue(c, g.id));
    // One announcer for the client, not one per guild: an announcement names its channel.
    timers.push(startAnnouncer(c));
    timers.push(setInterval(() => syncAllGating(c).catch(() => {}), 5 * 60_000));
    // Blog announcements: check for new published posts every 5 min (+ once now).
    pollBlog(c).catch(() => {});
    timers.push(setInterval(() => pollBlog(c).catch(() => {}), 5 * 60_000));
    // Server-perf alerts: check every 2 min (+ once now) — these are time-sensitive.
    pollAlerts(c).catch(() => {});
    timers.push(setInterval(() => pollAlerts(c).catch(() => {}), 2 * 60_000));
    // Ko-fi tips: check every 2 min (+ once now) — a thank-you should feel prompt.
    pollKofi(c).catch(() => {});
    timers.push(setInterval(() => pollKofi(c).catch(() => {}), 2 * 60_000));
    // Stripe payments & refunds: check every 2 min (+ once now).
    pollPayments(c).catch(() => {});
    timers.push(setInterval(() => pollPayments(c).catch(() => {}), 2 * 60_000));
    // Admin DMs / gift codes: deliver promptly (30s).
    pollDMs(c).catch(() => {});
    timers.push(setInterval(() => pollDMs(c).catch(() => {}), 30_000));
    // Same cadence as single DMs; the pacing that matters is inside the drainer.
    timers.push(setInterval(() => pollDMBroadcast(c).catch(() => {}), 30_000));
    // Giveaways: post new ones + draw due ones (30s).
    pollGiveaways(c).catch(() => {});
    timers.push(setInterval(() => pollGiveaways(c).catch(() => {}), 30_000));
    // Panels only move when an admin edits one, so a 60s cadence is plenty; a click on
    // an already-posted panel is answered by the interaction handler, not by this.
    pollRolePanels(c).catch(() => {});
    timers.push(setInterval(() => pollRolePanels(c).catch(() => {}), 60_000));
    // Link buffer: refresh roles for accounts freshly linked via website Discord sign-in (30s).
    pollLinks(c).catch(() => {});
    timers.push(setInterval(() => pollLinks(c).catch(() => {}), 30_000));
  });
  c.on(Events.InteractionCreate, guard(handleInteraction));
  c.on(Events.VoiceStateUpdate, guard((o, n) => onVoiceStateUpdate(c, o, n)));
  c.on(Events.GuildMemberAdd, guard(async (m) => { await onMemberAdd(m); await checkGating(m); }));
  c.on(Events.GuildMemberRemove, guard(onMemberRemove));
  c.on(Events.MessageCreate, guard(onMessage));
  // Invited to a server that is banned from the bot? Leave at once (unless the ban is the
  // softer 'disable' mode, which keeps the bot present but inert). The 20s sweep in tick()
  // is the backstop; this is the immediate response.
  c.on(Events.GuildCreate, guard(async (g) => {
    const ban = guildBan(await config(), g.id);
    if (ban && ban.mode !== 'disable') { console.log(`[bot] joined a banned guild (${g.id}) — leaving.`); await g.leave().catch(() => {}); }
  }));
  return c;
}

let backoffUntil = 0;
let lastTriedToken = null;
async function connect(token) {
  currentToken = token; lastTriedToken = token;
  client = buildClient();
  try { await client.login(token); backoffUntil = 0; }
  catch (e) {
    const msg = e?.message || String(e);
    const intents = /disallowed intents/i.test(msg);
    const badToken = /invalid token|an invalid token/i.test(msg);
    // Report a clear, actionable reason to the dashboard instead of looping silently.
    const reason = intents ? 'Privileged intents disabled — enable Server Members + Message Content in the Discord Developer Portal (Bot → Privileged Gateway Intents).'
      : badToken ? 'Invalid bot token — check the token in the dashboard.'
      : msg.slice(0, 200);
    console.error('[bot] login failed:', msg, intents ? '→ enable privileged intents in the Discord Developer Portal' : '');
    api.reportError(reason);
    await disconnect();
    // Back off so we don't hammer Discord: bad token waits for a change; intents retries
    // in a minute (so enabling them in the portal reconnects promptly).
    backoffUntil = Date.now() + (badToken ? 10 * 60_000 : intents ? 60_000 : 30_000);
  }
}

async function disconnect() {
  timers.forEach(clearInterval); timers = [];
  if (client) { try { await client.destroy(); } catch { /* already gone */ } client = null; }
  currentToken = null;
}

// The env token always wins; otherwise use the dashboard-managed token.
async function resolveToken() {
  if (process.env.DISCORD_TOKEN) return process.env.DISCORD_TOKEN;
  try { return await api.getToken(); } catch { return null; }
}

// The restart stamp we have already acted on. Seeded on the FIRST tick rather than left
// null, or every deploy of this container would reconnect once for no reason — the stamp
// would look new simply because this process had never seen it.
let lastRestartAt;
async function tick() {
  let enabled = true, cfg = null;
  try { cfg = await config(true); enabled = cfg?.enabled !== false; } catch { /* keep last */ }
  // An admin pressed Reconnect. Take the same path a token rotation takes — that code is
  // already the one that tears a client down cleanly and rebuilds it.
  if (cfg) {
    const stamp = cfg.restartAt || null;
    if (lastRestartAt === undefined) lastRestartAt = stamp;
    else if (stamp && stamp !== lastRestartAt) {
      lastRestartAt = stamp;
      console.log('[bot] reconnect requested from the dashboard.');
      await disconnect();
      backoffUntil = 0; lastTriedToken = null; // a deliberate reconnect is not a retry
    }
  }
  // Leave any 'leave'-banned server the bot is currently in — the backstop for a ban added
  // while the bot was already present (GuildCreate only fires on a fresh join). Runs on the
  // fresh config every 20s, so a new ban takes effect within one tick.
  if (client && cfg && Array.isArray(cfg.bannedGuilds)) {
    for (const b of cfg.bannedGuilds) {
      if (b && b.guildId && b.mode !== 'disable' && client.guilds?.cache?.has(b.guildId)) {
        console.log(`[bot] leaving banned guild ${b.guildId}.`);
        await client.guilds.cache.get(b.guildId)?.leave().catch(() => {});
      }
    }
  }
  const token = enabled ? await resolveToken() : null;
  if (token && token !== lastTriedToken) backoffUntil = 0; // a new token retries immediately
  if (Date.now() < backoffUntil) return;                   // backing off after a failed login
  if (token) {
    if (!client) { console.log('[bot] token available — connecting…'); await connect(token); }
    else if (token !== currentToken) { console.log('[bot] token changed — reconnecting…'); await disconnect(); await connect(token); }
  } else if (client) {
    console.log('[bot] disabled or no token — disconnecting.'); await disconnect();
  }
}

console.log('[bot] starting — will connect when a token is set (env DISCORD_TOKEN or the admin dashboard).');
tick();
setInterval(tick, 20_000);

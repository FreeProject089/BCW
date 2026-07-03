// BetterCommunity Discord bot entry point. A small connection manager keeps the gateway
// client in sync with the admin dashboard: it connects when a token exists and the bot
// is enabled, reconnects when the token changes, and disconnects when disabled — so the
// token can be set/rotated from the dashboard with no container restart.
import { Client, GatewayIntentBits, Partials, Events, REST, Routes } from 'discord.js';
import { api } from './api.mjs';
import { config } from './config.mjs';
import { commandData, handleInteraction } from './commands.mjs';
import { onVoiceStateUpdate } from './features/joinToCreate.mjs';
import { onMemberAdd, onMemberRemove } from './features/welcome.mjs';
import { onMessage } from './features/moderation.mjs';
import { checkGating, syncAllGating } from './features/gating.mjs';
import { pollBlog } from './features/blog.mjs';
import { pollAlerts } from './features/alerts.mjs';
import { pollKofi } from './features/kofi.mjs';
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
    ],
    partials: [Partials.Channel],
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
      uptimeSec: Math.round(process.uptime()), guilds: ready.guilds.cache.size,
      users: ready.users.cache.size, tempChannels: temp.size, version: '0.1.0',
      ping: c.ws.ping >= 0 ? c.ws.ping : null, mod: { ...modStats },
    });
    beat();
    timers.push(setInterval(beat, 60_000));
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
  });
  c.on(Events.InteractionCreate, guard(handleInteraction));
  c.on(Events.VoiceStateUpdate, guard((o, n) => onVoiceStateUpdate(c, o, n)));
  c.on(Events.GuildMemberAdd, guard(async (m) => { await onMemberAdd(m); await checkGating(m); }));
  c.on(Events.GuildMemberRemove, guard(onMemberRemove));
  c.on(Events.MessageCreate, guard(onMessage));
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

async function tick() {
  let enabled = true;
  try { enabled = (await config(true))?.enabled !== false; } catch { /* keep last */ }
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

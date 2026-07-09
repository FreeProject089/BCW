// In-memory ring buffer of the bot's recent console output. Patches console.* so
// every log/warn/error is captured (still printed normally) and can be shipped to
// BCWEB in the heartbeat, then shown live in the admin Discord-bot tab. No secrets
// are logged by the bot, so this is safe to surface to admins.
const MAX = 200;
const buf = [];

function push(level, args) {
  try {
    const msg = args.map((a) => (typeof a === 'string' ? a : (a && a.message) ? a.message : (() => { try { return JSON.stringify(a); } catch { return String(a); } })())).join(' ');
    buf.push({ t: Date.now(), level, msg: msg.slice(0, 500) });
    if (buf.length > MAX) buf.splice(0, buf.length - MAX);
  } catch {}
}

const orig = { log: console.log, warn: console.warn, error: console.error };
console.log = (...a) => { push('log', a); orig.log(...a); };
console.warn = (...a) => { push('warn', a); orig.warn(...a); };
console.error = (...a) => { push('error', a); orig.error(...a); };

// Last `n` lines (newest last), for the heartbeat payload.
export function recentLogs(n = 60) { return buf.slice(-n); }

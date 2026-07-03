// In-memory runtime state. (Ephemeral by design — temp channels don't outlive the
// process; voice presets are user-held .json files now, not server state.)
export const temp = new Map();    // channelId -> { ownerId, guildId, bans:Set, kicks:Set, locked, private, lastRename }
export const msgReported = new Map(); // discordId -> last activity report ts (throttle)

// Lightweight moderation counters shown on the admin dashboard — reset on restart
// (like everything else here), just a few in-memory increments, no DB writes.
export const modStats = { kicks: 0, timeouts: 0, purged: 0 };

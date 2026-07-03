// Gated access. Grants each configured ROLE to members who meet that role's own
// link requirements (BMM creator id / Discord link / BCWEB account), and removes
// it when they no longer do. Multiple independent rules are supported — e.g. a
// "Linked" role for anyone with a BCWEB account, plus a "Creator" role that also
// needs a BMM creator id. Rules are configured from the BCWEB admin dashboard.
import { config } from '../config.mjs';
import { api } from '../api.mjs';

// Normalise config into a rules array. New shape: gating.rules = [{ roleId,
// requireDiscord, requireBcweb, requireBmm, label }]. Legacy single-role config
// (gating.roleId + gating.requireX flags) is transparently treated as one rule,
// so nothing breaks for servers set up before multi-role.
export function gatingRules(g = {}) {
  if (Array.isArray(g.rules) && g.rules.length) return g.rules.filter((r) => r?.roleId);
  if (g.roleId) return [{ roleId: g.roleId, requireDiscord: g.requireDiscord, requireBcweb: g.requireBcweb, requireBmm: g.requireBmm, label: 'Gated' }];
  return [];
}

// Does an account satisfy one rule's requirements?  `acc` = { linked, hasBmm }.
function meetsRule(rule, acc) {
  if ((rule.requireDiscord || rule.requireBcweb) && !acc.linked) return false;
  if (rule.requireBmm && !acc.hasBmm) return false;
  return true;
}

// Evaluate ONE member against ALL rules and reconcile every gate role. The
// account is fetched ONCE (not per rule), so cost is O(members), not O(members
// × rules). Returns a small summary used by the /verify and /refreshroles replies.
export async function checkGating(member, cfg) {
  cfg = cfg || await config();
  const g = cfg.gating || {};
  if (!cfg.enabled || !g.enabled) return null;
  const rules = gatingRules(g);
  if (!rules.length || member.user?.bot) return null;

  const acc = await api.account(member.id); // { linked, hasBmm }
  const results = [];
  for (const rule of rules) {
    const role = member.guild.roles.cache.get(rule.roleId);
    if (!role) continue;
    const ok = meetsRule(rule, acc);
    const has = member.roles.cache.has(rule.roleId);
    try {
      if (ok && !has) await member.roles.add(rule.roleId, `Meets requirements for ${rule.label || 'gated role'}`);
      else if (!ok && has) await member.roles.remove(rule.roleId, `No longer meets requirements for ${rule.label || 'gated role'}`);
    } catch { /* missing perms / role hierarchy — skip this one */ }
    results.push({ roleId: rule.roleId, label: rule.label || role.name, ok });
  }
  return { linked: acc.linked, hasBmm: acc.hasBmm, roles: results };
}

// Periodic full re-check (link status changes on the website, not via Discord
// events) — grants AND revokes across every guild, every member, every rule.
export async function syncAllGating(client) {
  const cfg = await config();
  const g = cfg.gating || {};
  if (!cfg.enabled || !g.enabled || !gatingRules(g).length) return;
  for (const guild of client.guilds.cache.values()) {
    let members;
    try { members = await guild.members.fetch(); } catch { continue; }
    for (const m of members.values()) if (!m.user.bot) await checkGating(m, cfg).catch(() => {});
  }
}

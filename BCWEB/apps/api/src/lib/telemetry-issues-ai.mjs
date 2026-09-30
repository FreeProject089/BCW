// Laya on BMM's live issues (agent-telemetry-live).
//
// The telemetry service (bmm/telemetry-dashboard, issues_ai.rs) sends the redacted text of each
// NEW issue group here, server-to-server, and gets labels back. Why here and not straight to the
// sidecar: see the header of issues_ai.rs. In short, this file adds questions; the guards (kill
// switch, shared concurrency, breaker, cache, usage analytics) are the AI layer's.
//
// The vocabulary MUST match issues.rs (CATEGORIES / SEVERITIES / ORIGINS): the telemetry side
// drops any value it does not know.
import { aiAskWithReason, FEATURE_PREFIX } from './moderation/ai.mjs';
import { loadFeatures } from './ai-features.mjs';

export const ISSUE_CATEGORIES = Object.freeze({
  crash: 'the application crashed, panicked or stopped responding',
  ui: 'a screen, button, dialog or rendering problem in the interface',
  network: 'a download, connection, server, DNS, timeout or HTTP problem',
  filesystem: 'a file or folder is missing, locked, corrupted, too long or on a full disk',
  permissions: 'access denied, administrator rights, antivirus or a protected folder',
  mod_conflict: 'two mods conflict, a load order or overwrite problem between mods',
  configuration: 'a wrong setting, profile, path or game configuration',
  performance: 'something is too slow, uses too much memory or freezes for a while',
  update: 'an update of BMM, a game or a plugin broke something',
  other: 'none of the above',
});
export const ISSUE_SEVERITIES = Object.freeze({
  critical: 'the app crashes or data can be lost',
  high: 'a main feature (deploy, install, backup) fails',
  medium: 'a secondary feature fails, there is a workaround',
  low: 'cosmetic, a warning, or nothing the user notices',
});
export const ISSUE_ORIGINS = Object.freeze({
  user_environment: 'caused by the user\'s machine, files, antivirus, network or game install',
  bmm_bug: 'a defect in BetterModsManager\'s own code',
  unclear: 'cannot tell from this text',
});

/** The questions of one request. `duplicate` only when the text carries a candidate. */
export function issueQuestions(withDuplicate) {
  const q = {
    category: { type: 'choice', instructions: 'Which category best describes this application error?', criteria: ISSUE_CATEGORIES },
    severity: { type: 'choice', instructions: 'How severe is this error for the user?', criteria: ISSUE_SEVERITIES },
    origin: { type: 'choice', instructions: 'Is this error more likely caused by the user environment or by a bug in the application?', criteria: ISSUE_ORIGINS },
  };
  if (withDuplicate) q.duplicate = { type: 'noul', instructions: 'Does the "Possible earlier issue" describe the same underlying problem as the error above?' };
  return q;
}

/** The layer's answers → { category: { value, p }, …, duplicate: { p } }. Pure. */
export function mapIssueAnswers(answers) {
  const out = {};
  const a = answers && typeof answers === 'object' ? answers : {};
  const pick = (id, vocab) => {
    const x = a[id];
    if (x && typeof x.choice === 'string' && Object.hasOwn(vocab, x.choice)) out[id] = { value: x.choice, p: typeof x.p === 'number' ? x.p : null };
  };
  pick('category', ISSUE_CATEGORIES);
  pick('severity', ISSUE_SEVERITIES);
  pick('origin', ISSUE_ORIGINS);
  if (a.duplicate && typeof a.duplicate.p === 'number') out.duplicate = { p: a.duplicate.p };
  return out;
}

/** One classification. Never throws: { ok: true, model, latencyMs, labels } | { ok: false, reason }. */
export async function classifyIssue({ text, duplicate }, { ask = aiAskWithReason, features = loadFeatures } = {}) {
  try {
    const t = typeof text === 'string' ? text.slice(0, 4000) : '';
    if (!t.trim()) return { ok: false, reason: 'empty' };
    const f = await features();
    if (!f?.cfg?.features?.telemetry_issues?.enabled) return { ok: false, reason: 'feature_off' };
    const r = await ask(issueQuestions(!!duplicate), { text: t }, { surface: `${FEATURE_PREFIX}telemetry_issues`, layaOnly: true });
    if (!r?.value) return { ok: false, reason: r?.reason || 'unavailable' };
    const labels = mapIssueAnswers(r.value.answers);
    if (!Object.keys(labels).length) return { ok: false, reason: 'unavailable' };
    return { ok: true, model: r.value.model || 'laya', latencyMs: r.value.latencyMs ?? null, cached: !!r.value.cached, labels };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}

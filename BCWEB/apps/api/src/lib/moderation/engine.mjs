// The moderation engine: rules first, AI as an optional signal, a human for anything that
// matters.
//
//   moderate(surface, { text, links, authorId, ip, meta }, opts)
//     → { decision, action, score, reasons, caseId, ai, raw, mode, surface }
//
// Order of work, and why:
//
//   1. RULES, synchronously: links, keyword and pattern lists, shape heuristics, flood and
//      duplicate counters, then author trust. Each fires a weighted reason; the score is the
//      sum. They decide alone whenever they can, which is almost always.
//   2. POLICY: thresholds turn the score into a raw decision (policy.mjs), the surface's mode
//      turns that into what actually happens. report and legal always end in REVIEW.
//   3. AI, only in the grey zone (a score between half the flag threshold and the block
//      threshold), only if the surface allows it, the global kill switch is off and the AI
//      layer says it is available. By default AFTER the response (the request never waits on
//      a model); with `aiBlocking` it is awaited under a hard timeout, and a timeout is simply
//      "no AI". The AI can raise a decision to REVIEW at most: never hold, never refuse, never
//      the sole reason for a BLOCK, and never the one to close a report or a legal notice.
//   4. A CASE is written when a human should look (status open) or, in analysis mode, when
//      the rules WOULD have acted (status logged, kept out of the queue, counted in the stats).
//
// It FAILS OPEN. Any error inside the engine returns ALLOW with an `engine.error` reason: a
// broken rule must never take the contact form or the report button down with it. That is
// the right trade for a site whose forms already carry their own rate limits and proof of work.
import { db } from '../lib.mjs';
import { loadConfig } from './config.mjs';
import { SURFACES, scoreToDecision, applyMode, actionFor, maxDecision, rank } from './policy.mjs';
import { fold, skeleton, textHashes, hasWord, excerptOf } from './text.mjs';
import { extractUrls, checkLinks } from './links.mjs';
import { runPatterns } from './patterns.mjs';
import { heuristics } from './heuristics.mjs';
import { floodReasons, ipKey } from './flood.mjs';
import { authorFacts, trustReasons } from './trust.mjs';

const MAX_TEXT = 20000;

// ── the optional collaborators, imported so that their absence is "no AI" / "no notice" ──
let aiP = null;
/** The AI layer (agent-laya-bcweb's ai.mjs), or null when it is missing or does not load. */
export function aiModule() {
  if (!aiP) aiP = import('./ai.mjs').catch(() => null);
  return aiP;
}
/** Test hook: swap the AI layer for a stub (or null). */
export function _setAiModule(mod) { aiP = Promise.resolve(mod); }

/** Group reasons by rule: one weight per rule (the strongest), except keyword and pattern
 *  hits, which add up per distinct term, capped at 100. Admin weight overrides apply here. */
export function combine(reasons, weights = {}) {
  const by = new Map();
  for (const r of reasons) {
    const w = weights[r.rule] ?? r.weight;
    const cur = by.get(r.rule);
    const additive = r.rule === 'text.keyword' || r.rule === 'text.pattern';
    if (!cur) { by.set(r.rule, { rule: r.rule, weight: w, detail: r.detail ? [String(r.detail).slice(0, 160)] : [] }); continue; }
    if (additive) cur.weight = Math.min(100, cur.weight + w);
    else if (Math.abs(w) > Math.abs(cur.weight)) cur.weight = w;
    if (r.detail && cur.detail.length < 4) cur.detail.push(String(r.detail).slice(0, 160));
  }
  const list = [...by.values()].map((r) => ({ rule: r.rule, weight: r.weight, detail: r.detail.join(' · ') }));
  list.sort((a, b) => b.weight - a.weight);
  return list;
}
const sum = (list) => list.reduce((a, r) => a + r.weight, 0);

/** AI output as reasons. Probabilities become small weights: a signal, never a verdict. */
export function aiReasons(ai) {
  const out = [];
  const labels = ai?.labels && typeof ai.labels === 'object' ? ai.labels : {};
  for (const [label, pRaw] of Object.entries(labels)) {
    const pv = Number(pRaw);
    if (!Number.isFinite(pv)) continue;
    if (!/^[a-z_]{2,20}$/.test(label)) continue;
    const w = pv >= 0.9 ? 25 : pv >= 0.75 ? 12 : 0;
    if (w) out.push({ rule: `ai.${label}`, weight: w, detail: `p=${pv.toFixed(2)} (${ai.provider || 'ai'})` });
  }
  return out;
}

/** The highest decision the AI may push a case to. */
const AI_CEILING = 'REVIEW';
function withAi(ruleRaw, ruleScore, aiList, policy) {
  const aiScore = ruleScore + sum(aiList);
  let aiRaw = scoreToDecision(aiScore, policy.thresholds);
  if (rank(aiRaw) > rank(AI_CEILING)) aiRaw = AI_CEILING;
  return maxDecision(ruleRaw, aiRaw);
}

async function callAi(mod, surface, text, meta, timeoutMs) {
  if (!mod?.aiAnalyze) return null;
  const ctl = new AbortController();
  let timer;
  try {
    return await Promise.race([
      Promise.resolve(mod.aiAnalyze(surface, { text: text.slice(0, 4000), meta }, { signal: ctl.signal })).catch(() => null),
      new Promise((resolve) => { timer = setTimeout(() => { ctl.abort(); resolve(null); }, timeoutMs); }),
    ]);
  } catch { return null; } finally { clearTimeout(timer); }
}

function aiAllowed(cfg, policy, surface, mod) {
  if (!policy.ai || cfg.killSwitch.killed || !mod) return false;
  try { return typeof mod.aiEnabledFor === 'function' ? mod.aiEnabledFor(surface) === true : false; } catch { return false; }
}

/** A short, storable view of what the AI said. */
const aiRecord = (ai) => (ai ? {
  provider: String(ai.provider || '').slice(0, 20), model: String(ai.model || '').slice(0, 80), latencyMs: Number(ai.latencyMs) || null,
  labels: ai.labels && typeof ai.labels === 'object' ? Object.fromEntries(Object.entries(ai.labels).slice(0, 12).map(([k, v]) => [String(k).slice(0, 20), Number(v)])) : {},
  category: ai.category ? String(ai.category).slice(0, 60) : null, categoryProb: Number(ai.categoryProb) || null,
  at: new Date().toISOString(),
} : null);

/** Tell staff about a case that waits on them. Throttled per surface: a flood of cases is one
 *  notice per surface per ten minutes, not one per case. Best-effort, never awaited. */
const lastNotice = new Map();
async function notifyStaff(p, c, log) {
  const bucket = Math.floor(Date.now() / 600_000);
  const key = `${c.surface}:${bucket}`;
  if (lastNotice.get(c.surface) === key) return;
  lastNotice.set(c.surface, key);
  try {
    const staff = await p.user.findMany({ where: { OR: [{ role: { in: ['MOD', 'ADMIN', 'SUPERADMIN'] } }, { permissions: { has: 'manage_moderation' } }] }, select: { id: true } });
    if (!staff.length) return;
    const title = `Moderation: a ${c.surface.replace(/_/g, ' ')} case needs review`;
    const url = `/admin?s=modqueue&case=${c.id}`;
    const mod = await import('../notify.mjs').catch(() => null);
    if (mod?.notify) {
      await mod.notify({ userIds: staff.map((s) => s.id), kind: 'moderation.case', title, body: `${c.decision} · score ${c.score}`, url, dedupeKey: `moderation.case:${key}`, priority: c.held ? 'high' : 'normal' });
      return;
    }
    // No notify.mjs: the platform's own per-user notification, same destination.
    const { notify } = await import('../lib.mjs');
    await Promise.all(staff.map((s) => notify(p, s.id, 'moderation_case', title, { href: url })));
  } catch (e) { log?.warn?.(`[moderation] staff notice failed: ${e?.message || e}`); }
}

/**
 * Moderate one piece of content.
 *
 * @param surface  one of SURFACES
 * @param input    { text, links?, authorId?, authorKey?, ip?, meta? }
 *                 authorKey identifies a sender with no account here (a Discord id).
 *                 meta.secret: never store the text (a security report).
 * @param opts     { p, subject: { type, id }, holdType, canHold, canRefuse, payload, dryRun, log }
 *                 holdType: the subject type to record when the content is held instead.
 *                 payload: what a held item needs to be released later (contact form).
 *                 dryRun: the admin's "test this text": count nothing, store nothing.
 */
export async function moderate(surface, input = {}, opts = {}) {
  const t0 = performance.now();
  try {
    const p = opts.p || await db();
    const cfg = await loadConfig(p);
    if (!cfg.settings.enabled) return { decision: 'ALLOW', action: 'allow', score: 0, reasons: [], caseId: null, ai: null, engine: 'off', surface };
    if (!SURFACES.includes(surface)) return { decision: 'ALLOW', action: 'allow', score: 0, reasons: [{ rule: 'engine.unknown_surface', weight: 0, detail: String(surface).slice(0, 40) }], caseId: null, ai: null, surface };
    const policy = cfg.policies[surface];
    const dryRun = !!opts.dryRun;
    const text = String(input.text ?? '').slice(0, MAX_TEXT);
    const meta = input.meta && typeof input.meta === 'object' ? input.meta : {};
    const R = cfg.rules;
    const applies = (r) => !r.surfaces?.length || r.surfaces.includes(surface);

    const raw = [];
    const hashes = textHashes(text);
    const knownFp = (hashes.exact && R.fpHashes.has(hashes.exact)) || (hashes.loose && R.fpHashes.has(hashes.loose));

    // Links
    const urls = [...new Set([...extractUrls(text), ...(Array.isArray(input.links) ? input.links : []).map((u) => String(u).slice(0, 2000))])].slice(0, 50);
    if (urls.length) raw.push(...checkLinks(urls, { allowDomains: R.allowDomains, blockDomains: R.blockDomains, extraBrands: R.protectedBrands, blockedRules: cfg.blocked }).reasons);

    // Keywords (data, never a regex) and patterns (checked regexes, time-boxed)
    if (text) {
      const folded = fold(text);
      let skel = null;
      for (const k of R.keywords) {
        if (!applies(k)) continue;
        const hit = hasWord(folded, k.term) || (k.loose && (skel ??= skeleton(text)).includes(skeleton(k.term)));
        if (hit) raw.push({ rule: 'text.keyword', weight: k.weight, detail: k.term });
      }
      const pats = R.compiled.filter(applies);
      if (pats.length) {
        const { hits, exhausted } = runPatterns(pats, text);
        for (const h of hits) raw.push({ rule: 'text.pattern', weight: h.weight, detail: h.label || h.id });
        if (exhausted) raw.push({ rule: 'rules.budget', weight: 0, detail: 'pattern time budget spent; the remaining patterns were skipped' });
      }
      raw.push(...heuristics(text, { discord: surface === 'discord_automod' }));
    }

    // Flood and duplicates
    const who = { authorId: input.authorId || input.authorKey || null, ip: input.ip || null };
    raw.push(...await floodReasons(surface, who, hashes, policy, { count: !dryRun }));

    let reasons = combine(raw, R.weights);
    let contentScore = sum(reasons);
    if (knownFp) {
      reasons.unshift({ rule: 'fp.known', weight: -contentScore, detail: 'this text was marked as a false positive' });
      contentScore = 0;
    }

    // Trust (amplifies or dampens; see trust.mjs)
    const facts = input.authorId ? await authorFacts(p, input.authorId) : null;
    const trust = combine(trustReasons(facts, { anonymous: !input.authorId && !input.authorKey, contentScore }), R.weights);
    reasons = [...reasons, ...trust];
    const score = Math.max(0, Math.round(contentScore + sum(trust)));

    let rawDecision = scoreToDecision(score, policy.thresholds);

    // AI, only in the grey zone.
    const mod = await aiModule();
    const grey = score >= Math.round(policy.thresholds.flag / 2) && rawDecision !== 'BLOCK';
    const aiOk = grey && aiAllowed(cfg, policy, surface, mod);
    let ai = null;
    let aiPending = false;
    if (aiOk && (policy.aiBlocking || dryRun)) {
      ai = await callAi(mod, surface, text, { ...meta, secret: undefined }, policy.aiTimeoutMs);
      if (ai) {
        const list = aiReasons(ai);
        reasons = [...reasons, ...list];
        rawDecision = withAi(rawDecision, score, list, policy);
      }
    } else if (aiOk) aiPending = true;

    const { decision, status } = applyMode(rawDecision, policy);
    const action = policy.mode === 'auto' ? actionFor(decision, opts) : 'allow';
    const result = { decision, action, score, reasons, caseId: null, ai: aiRecord(ai), raw: rawDecision, mode: policy.mode, surface, ms: Math.round(performance.now() - t0) };
    if (dryRun) return result;

    // followups (agent-bcw-followups): the content's id, once the route has written it. The
    // after-the-response AI pass can open a case AFTER the route called linkCase (there was no
    // case to link yet), so the id is kept here: a case created later reads it, and an id that
    // arrives after that case is written onto it (linkCase below).
    const subject = { type: opts.subject?.type || null, id: opts.subject?.id || null, laterCaseId: null };
    Object.defineProperty(result, 'subjectRef', { value: subject, enumerable: false });
    // fin followups
    const secret = policy.sensitive || meta.secret === true;
    const authorKey = input.authorId ? '' : input.authorKey ? String(input.authorKey).slice(0, 80) : input.ip ? `ip:${ipKey(input.ip)}` : '';
    const caseData = () => ({
      surface, decision, rawDecision, mode: policy.mode, score,
      reasons, ai: aiRecord(ai) ?? undefined,
      status, held: action === 'hold',
      subjectType: action === 'refuse' ? 'refused' : String((action === 'hold' && opts.holdType) || subject.type || 'text').slice(0, 40),
      subjectId: String((action === 'refuse' ? '' : subject.id) || '').slice(0, 80),
      authorId: input.authorId || null, authorKey,
      excerpt: secret ? null : excerptOf(text),
      payload: action === 'hold' && opts.payload ? opts.payload : undefined,
      textHash: hashes.exact || hashes.loose || '',
    });
    if (status) {
      const c = await p.moderationCase.create({ data: caseData() });
      result.caseId = c.id;
      // A sensitive surface's own queue already tells staff (report_new, rights_notice): a
      // second notice about the same report would only teach people to ignore both.
      if (status === 'open' && policy.notify && !policy.sensitive && (decision === 'REVIEW' || c.held)) notifyStaff(p, c, opts.log);
    }
    if (aiPending) {
      // After the response. The content is already published by then, so the AI can only open
      // or raise a case for a human; it never holds or refuses anything.
      setImmediate(() => { laterAi(p, mod, { surface, text, meta, policy, score, rawDecision, reasons, caseId: result.caseId, caseData, subject, log: opts.log }).catch(() => {}); });
    }
    return result;
  } catch (e) {
    opts.log?.warn?.(`[moderation] engine error on ${surface}: ${e?.message || e}`);
    return { decision: 'ALLOW', action: 'allow', score: 0, reasons: [{ rule: 'engine.error', weight: 0, detail: 'the engine failed; the content was let through' }], caseId: null, ai: null, surface, error: true };
  }
}

async function laterAi(p, mod, ctx) {
  const ai = await callAi(mod, ctx.surface, ctx.text, { ...ctx.meta, secret: undefined }, Math.max(ctx.policy.aiTimeoutMs, 5000));
  if (!ai) return;
  const list = aiReasons(ai);
  const raised = withAi(ctx.rawDecision, ctx.score, list, ctx.policy);
  const { decision, status } = applyMode(raised, ctx.policy);
  const reasons = [...ctx.reasons, ...list];
  if (ctx.caseId) {
    const cur = await p.moderationCase.findUnique({ where: { id: ctx.caseId }, select: { status: true, decision: true } });
    if (!cur) return;
    const up = cur.status === 'open' && rank(decision) > rank(cur.decision);
    await p.moderationCase.update({ where: { id: ctx.caseId }, data: { ai: aiRecord(ai), reasons, ...(up ? { decision, rawDecision: raised } : {}) } });
    return;
  }
  if (!status) return;
  const base = ctx.caseData();
  const c = await p.moderationCase.create({ data: { ...base, decision, rawDecision: raised, status, held: false, payload: undefined, reasons, ai: aiRecord(ai) } });
  // followups (agent-bcw-followups): the route's linkCase may land after this; it will find
  // the case through the subject holder.
  if (ctx.subject) {
    ctx.subject.laterCaseId = c.id;
    if (ctx.subject.id && !base.subjectId) await linkCase(p, c.id, ctx.subject.type, ctx.subject.id);
  }
  if (status === 'open' && ctx.policy.notify && !ctx.policy.sensitive && decision === 'REVIEW') notifyStaff(p, c, ctx.log);
}

/** Point a case at the content it was about, once that content has an id. Never throws.
 *  `caseId` may be the whole `moderate()` result (followups, agent-bcw-followups): then a case
 *  the after-the-response AI pass opens later is linked too, whichever of the two comes first. */
export async function linkCase(p, caseId, type, id) {
  if (caseId && typeof caseId === 'object') {
    const res = caseId;
    const ref = res.subjectRef;
    if (ref && id) {
      ref.type = type; ref.id = id;
      if (ref.laterCaseId && ref.laterCaseId !== res.caseId) await linkCase(p, ref.laterCaseId, type, id);
    }
    caseId = res.caseId;
  }
  if (!caseId || !id) return;
  await p.moderationCase.update({ where: { id: caseId }, data: { subjectType: String(type).slice(0, 40), subjectId: String(id).slice(0, 80) } }).catch(() => {});
}

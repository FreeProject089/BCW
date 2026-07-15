// Rendering + analysis for the stress ladder: turns the raw per-(scenario × level)
// autocannon rows into a saturation "knee", a bottleneck diagnosis, a minimum-spec
// extrapolation, and a report meant to be read by BOTH a human and an AI (flat tables,
// explicit units, a plain-language verdict per scenario). Pure functions only — run.mjs
// does the I/O. Prose lives in report-i18n.mjs so EN and FR can't drift apart.
import { tr, LOCALE } from './report-i18n.mjs';

// Which sizing note a user-count tier gets — shared with the HTML renderer so the two can't
// disagree about what "10,000 users" implies.
export const tierKey = (u) => (u <= 100 ? 'minspec.tier1' : u <= 1000 ? 'minspec.tier2' : u <= 10000 ? 'minspec.tier3' : 'minspec.tier4');

const fmt = (n) => (n == null ? '—' : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)));
const ms = (n) => (n == null ? '—' : `${Math.round(n)}ms`);

// A level's row is "clean" when the server answered without failing the client: no
// transport errors and no timeouts. non-2xx (rate-limiter 429s) is NOT a failure — it's
// the server deliberately shedding load, so a clean-but-throttled row is still healthy.
export function isClean(r) {
  return r.errors === 0 && r.timeouts === 0;
}

// The saturation knee = the highest level where the server still served real traffic
// cleanly at its best throughput. We pick the clean row with the most 2xx/s; anything
// past it either plateaus (throughput stops rising) or starts erroring/timing out.
export function findKnee(results) {
  const clean = results.filter(isClean);
  if (!clean.length) return null;
  return clean.reduce((best, r) => (r.ok2xx_s > (best?.ok2xx_s ?? -1) ? r : best), null);
}

// Bottleneck verdict for one scenario, from the shape of the ladder. Heuristics, not proof —
// but they point at the right layer to go profile. Returns i18n KEYS (+ params) rather than
// prose, so every renderer/language gets the same verdicts — see report-i18n.mjs.
export function diagnose(scn) {
  const rows = scn.results;
  const last = rows[rows.length - 1];
  const knee = findKnee(rows);
  const notes = [];

  const anyTimeouts = rows.some((r) => r.timeouts > 0);
  const anyErrors = rows.some((r) => r.errors > 0);
  // Ping = a trivial /health request issued DURING the flood. If its tail explodes, the
  // event loop itself is starving → CPU-bound / synchronous work on the main thread.
  const pingBlew = rows.some((r) => r.ping && r.ping.p99 >= 1000);
  const throttled = last && last.total > 0 && last.non2xx / last.total > 0.5;
  // A p99.9 far above p99 means a small fraction of requests hit something occasional and
  // slow: a GC pause, a cold query, lock contention.
  const longTail = rows.some((r) => r.p99_9 && r.p99 && r.p99_9 > r.p99 * 4 && r.p99_9 > 200);

  if (pingBlew) notes.push({ key: 'note.eventloop' });
  if (anyTimeouts) notes.push({ key: 'note.timeouts' });
  else if (!anyErrors) notes.push({ key: 'note.clean' });
  if (throttled) notes.push({ key: 'note.throttled' });
  if (longTail) notes.push({ key: 'note.longtail' });
  if (knee) notes.push({ key: 'note.knee', params: { rps: fmt(knee.ok2xx_s), level: knee.level, conns: fmt(knee.conns), p99: ms(knee.p99), p999: ms(knee.p99_9) } });

  return notes;
}

// Render a scenario's verdicts in one language: [{key,params}] → translated strings.
export function diagnoseText(scn, t) {
  return diagnose(scn).map((n) => t(n.key, n.params));
}

// Minimum-server-spec extrapolation, anchored to the measured capacity on THIS box.
// Deliberately conservative + clearly heuristic: it scales the measured served-req/s per
// core linearly and converts to concurrent users at an assumed per-user request rate.
export function minSpec(meta, capacityRps) {
  const cores = meta.cores || 1;
  const perCoreRps = capacityRps / cores;
  const reqPerSecPerUser = Math.max(0.001, (meta.rpmPerUser || 6) / 60); // default: 6 req/min/active user
  const usersPerCore = perCoreRps / reqPerSecPerUser;
  const targets = [100, 1000, 10000, 100000];
  return targets.map((users) => {
    const coresNeeded = Math.max(1, Math.ceil(users / usersPerCore));
    // Very rough RAM rule: a small base + headroom per core (Node heap + PG pool + Redis
    // client). Real memory is dominated by Postgres/Redis sizing, called out in the report.
    const gb = Math.max(1, Math.ceil(0.5 + coresNeeded * 0.75));
    return { users, coresNeeded, gb, usersPerCore: Math.round(usersPerCore) };
  });
}

export function toMarkdown(meta, scenarios, lang = 'en') {
  const t = tr(lang);
  const loc = LOCALE[lang] || 'en-US';
  const L = [];
  const knees = scenarios.map((s) => ({ name: s.name, knee: findKnee(s.results) })).filter((x) => x.knee);
  // Headline peak = the best any scenario did (usually the trivial cached path).
  const overallKnee = knees.map((x) => x.knee).reduce((best, k) => (k.ok2xx_s > (best?.ok2xx_s ?? -1) ? k : best), null);
  // Capacity ANCHOR for sizing must be REPRESENTATIVE, not the /health peak: prefer the
  // realistic `mixed` blend, else the most conservative (lowest) scenario knee. Sizing a
  // fleet on a bare liveness endpoint's throughput would wildly under-provision.
  const mixed = knees.find((x) => x.name === 'mixed')?.knee;
  const lowest = knees.map((x) => x.knee).reduce((min, k) => (k.ok2xx_s < (min?.ok2xx_s ?? Infinity) ? k : min), null);
  const anchor = mixed || lowest || overallKnee;
  const capacity = anchor?.ok2xx_s || 0;

  L.push(`# ${t('title')}`, '', t('generated'), '', '## Run', '', '| | |', '|---|---|');
  L.push(`| ${t('meta.when')} | ${meta.at} |`);
  L.push(`| ${t('meta.target')} | \`${meta.origin}${meta.prefix}\` |`);
  L.push(`| ${t('meta.client')} | ${meta.cores} ${t('meta.cores')} · ${meta.memGB} GB · Node ${meta.node} |`);
  L.push(`| ${t('meta.perLevel')} | ${meta.durationSec}s |`);
  L.push(`| ${t('meta.levels')} | ${meta.levels.map((l) => `${l.name} (${fmt(l.conns)})`).join(' · ')} |`);
  L.push('', `> ${t('readfirst')}`, '');

  L.push(`## ${t('headline')}`, '');
  // The peak line must quote the PEAK's own throughput: it used to print the ANCHOR's rps
  // beside the peak's scenario/level, so the number and the label disagreed.
  L.push(overallKnee
    ? `- ${t('headline.peak', { rps: fmt(overallKnee.ok2xx_s), scenario: overallKnee.scenario, level: overallKnee.level, conns: fmt(overallKnee.conns), p99: ms(overallKnee.p99), p999: ms(overallKnee.p99_9) })}`
    : `- ${t('headline.none')}`);
  L.push(`- ${t('headline.cwv')}`, '');

  for (const scn of scenarios) {
    L.push(`## ${t('scenario')}: ${scn.name}`, '', `_${scn.desc}_`, '');
    L.push(`| ${t('th.level')} | ${t('th.conns')} | ${t('th.rps')} | ${t('th.ok')} | p50 | p90 | p99 | p99.9 | ${t('th.non2xx')} | ${t('th.err')} | ${t('th.to')} | ${t('th.ping')} |`);
    L.push('|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|');
    for (const r of scn.results) {
      L.push(`| ${r.level} | ${fmt(r.conns)} | ${fmt(r.rps)} | ${fmt(r.ok2xx_s)} | ${ms(r.p50)} | ${ms(r.p90)} | ${ms(r.p99)} | ${ms(r.p99_9)} | ${fmt(r.non2xx)} | ${r.errors} | ${r.timeouts} | ${r.ping ? ms(r.ping.p99) : '—'} |`);
    }
    L.push('');
    for (const n of diagnoseText(scn, t)) L.push(`- ${n}`);
    L.push('');
  }

  L.push(`## ${t('minspec')}`, '');
  if (capacity > 0) {
    const specs = minSpec(meta, capacity);
    L.push(t('minspec.intro', { scenario: anchor?.scenario || '—', rps: fmt(capacity), cores: meta.cores, perCore: fmt(capacity / meta.cores), rpm: meta.rpmPerUser, usersPerCore: specs[0].usersPerCore.toLocaleString(loc) }));
    L.push('', `| ${t('minspec.users')} | ${t('minspec.cpu')} | ${t('minspec.ram')} | ${t('minspec.notes')} |`, '|---|--:|--:|---|');
    for (const s of specs) L.push(`| ${s.users.toLocaleString(loc)} | ${s.coresNeeded} | ${s.gb} GB | ${t(tierKey(s.users))} |`);
    L.push('', `> ${t('minspec.caveat')}`);
  } else {
    L.push(t('minspec.none'));
  }
  L.push('', `## ${t('act')}`, '');
  L.push(`1. ${t('act.1')}`, `2. ${t('act.2')}`, `3. ${t('act.3')}`, `4. ${t('act.4')}`, '');

  return L.join('\n');
}

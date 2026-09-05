// Turn GitHub's commit-stats endpoints into the shape a project-page activity heatmap needs
// (B13). Pure and dependency-free so the arithmetic is unit-testable; the fetching + caching
// live in the route (projects.mjs), which hands the two raw payloads straight in.
//
// Two sources, one call each (NOT paging /commits — that is O(commits) requests and burns the
// 60/hr unauthenticated budget on a big repo):
//   • /stats/commit_activity  → the last ~52 weeks, with a per-DAY breakdown → the heatmap.
//   • /stats/contributors     → every contributor's all-time weekly commits → totals, the
//                               contributor list, and the true first/last-commit span.

const DAY = 86400;
const iso = (unixSec) => new Date(unixSec * 1000).toISOString().slice(0, 10);

/**
 * @param commitActivity  GitHub /stats/commit_activity: [{ total, week (unix s), days:[7] }]
 * @param contributors    GitHub /stats/contributors:    [{ total, weeks:[{w,a,d,c}], author:{login} }]
 */
export function computeActivity(commitActivity, contributors) {
  // ── Daily heatmap (last year), from commit_activity ──
  const heatmap = [];
  let yearCommits = 0;
  let activeDays = 0;
  let busiest = { date: null, count: 0 };
  for (const wk of Array.isArray(commitActivity) ? commitActivity : []) {
    const days = Array.isArray(wk?.days) ? wk.days : [];
    for (let i = 0; i < 7; i++) {
      const count = Number(days[i]) || 0;
      const date = iso(wk.week + i * DAY);
      heatmap.push({ date, count });
      yearCommits += count;
      if (count > 0) activeDays += 1;
      if (count > busiest.count) busiest = { date, count };
    }
  }

  // ── All-time contributors + span, from contributors ──
  const rows = Array.isArray(contributors) ? contributors : [];
  const contribList = rows
    // Carry the avatar + profile link straight from GitHub's stats payload — the page shows a
    // real face beside each contributor instead of a bare login.
    .map((c) => ({ name: c?.author?.login || 'unknown', commits: Number(c?.total) || 0, avatar: c?.author?.avatar_url || null, url: c?.author?.html_url || null }))
    .filter((c) => c.commits > 0)
    .sort((a, b) => b.commits - a.commits);
  const totalCommits = contribList.reduce((s, c) => s + c.commits, 0);

  let firstWeek = Infinity;
  let lastWeek = 0;
  // Commits per calendar year, summed across every contributor's ALL-TIME weekly buckets — so
  // a project's whole history can be compared year by year, not just the trailing 12 months the
  // daily heatmap covers. Free: the weeks are already in hand for the span below.
  const byYear = {};
  for (const c of rows) {
    for (const w of Array.isArray(c?.weeks) ? c.weeks : []) {
      const n = Number(w?.c) || 0;
      if (n > 0) {
        firstWeek = Math.min(firstWeek, w.w);
        lastWeek = Math.max(lastWeek, w.w);
        const y = new Date(w.w * 1000).getUTCFullYear();
        byYear[y] = (byYear[y] || 0) + n;
      }
    }
  }
  // As a sorted [{ year, commits }] list — the shape the page charts directly.
  const perYear = Object.keys(byYear).map((y) => ({ year: Number(y), commits: byYear[y] })).sort((a, b) => a.year - b.year);
  const hasSpan = firstWeek !== Infinity && lastWeek > 0;
  // +7: a week's `w` is its start, so the last active week runs six days past its own stamp.
  const spanDays = hasSpan ? Math.round((lastWeek - firstWeek) / DAY) + 7 : 0;

  return {
    heatmap,
    yearCommits,
    activeDays,
    busiestDay: busiest.date ? busiest : null,
    totalCommits,
    perYear,
    contributors: contribList,
    firstCommit: hasSpan ? iso(firstWeek) : null,
    lastCommit: hasSpan ? iso(lastWeek) : null,
    spanDays,
    spanMonths: Math.round(spanDays / 30.44),
    spanYears: spanDays ? +(spanDays / 365.25).toFixed(1) : 0,
  };
}

/**
 * The BRANCH case. GitHub's /stats/* endpoints only ever describe the DEFAULT branch, so when a
 * project pins a specific branch we build the same activity shape from /commits?sha=<branch>
 * instead. It is a WINDOWED view — only the commits actually fetched (typically the trailing
 * year the caller pages back to) — rather than the all-time totals the stats path gives, which
 * is the honest trade for being able to see a non-default branch at all.
 *
 * @param commits GitHub /commits: [{ sha, commit:{author:{date},committer:{date}},
 *                                     author:{login,avatar_url,html_url}|null }]
 */
export function computeActivityFromCommits(commits) {
  const list = Array.isArray(commits) ? commits : [];
  const dayCount = new Map();   // 'YYYY-MM-DD' → count
  const byAuthor = new Map();   // login/name → { name, commits, avatar, url }
  const byYear = {};
  let firstTs = Infinity, lastTs = 0;
  for (const c of list) {
    const dateStr = c?.commit?.author?.date || c?.commit?.committer?.date;
    if (!dateStr) continue;
    const ts = Math.floor(new Date(dateStr).getTime() / 1000);
    if (!Number.isFinite(ts)) continue;
    firstTs = Math.min(firstTs, ts); lastTs = Math.max(lastTs, ts);
    const d = iso(ts);
    dayCount.set(d, (dayCount.get(d) || 0) + 1);
    const y = new Date(ts * 1000).getUTCFullYear();
    byYear[y] = (byYear[y] || 0) + 1;
    // Prefer the GitHub login (carries an avatar + profile link); fall back to the raw commit
    // author name for commits by an address not linked to a GitHub account.
    const login = c?.author?.login;
    const key = login || c?.commit?.author?.name || 'unknown';
    const cur = byAuthor.get(key) || { name: login || c?.commit?.author?.name || 'unknown', commits: 0, avatar: c?.author?.avatar_url || null, url: c?.author?.html_url || null };
    cur.commits += 1;
    if (!cur.avatar && c?.author?.avatar_url) cur.avatar = c.author.avatar_url;
    if (!cur.url && c?.author?.html_url) cur.url = c.author.html_url;
    byAuthor.set(key, cur);
  }
  // Daily heatmap for the last 52 weeks, Sunday-aligned like /stats/commit_activity — so the
  // page renders it identically whichever path produced it.
  const heatmap = [];
  let yearCommits = 0, activeDays = 0, busiest = { date: null, count: 0 };
  const now = new Date();
  const todaySec = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 1000;
  const dow = new Date(todaySec * 1000).getUTCDay();
  const startWeek = todaySec - dow * DAY - 51 * 7 * DAY;
  for (let i = 0; i < 52 * 7; i++) {
    const date = iso(startWeek + i * DAY);
    const count = dayCount.get(date) || 0;
    heatmap.push({ date, count });
    yearCommits += count;
    if (count > 0) activeDays += 1;
    if (count > busiest.count) busiest = { date, count };
  }
  const contribList = [...byAuthor.values()].filter((c) => c.commits > 0).sort((a, b) => b.commits - a.commits);
  const totalCommits = contribList.reduce((s, c) => s + c.commits, 0);
  const perYear = Object.keys(byYear).map((y) => ({ year: Number(y), commits: byYear[y] })).sort((a, b) => a.year - b.year);
  const hasSpan = firstTs !== Infinity && lastTs > 0;
  const spanDays = hasSpan ? Math.round((lastTs - firstTs) / DAY) + 1 : 0;
  return {
    heatmap, yearCommits, activeDays, busiestDay: busiest.date ? busiest : null,
    totalCommits, perYear, contributors: contribList,
    firstCommit: hasSpan ? iso(firstTs) : null, lastCommit: hasSpan ? iso(lastTs) : null,
    spanDays, spanMonths: Math.round(spanDays / 30.44), spanYears: spanDays ? +(spanDays / 365.25).toFixed(1) : 0,
    windowed: true, // the page can note these are branch-window totals, not all-time
  };
}

/**
 * Parse a `git log` export into per-day / per-author counts — the compact form an import
 * stores (a 20 000-commit repo is a few KB of counts, not a few MB of messages).
 *
 * Two shapes are accepted, because both are one command away:
 *   · the pipe format the editor suggests:  `git log --all --format="%H|%aI|%an|%s"`
 *   · plain `git log` output — the "commit …" / "Author: …" / "Date: …" blocks.
 * Anything else is ignored line by line; an import that parses to zero commits is refused by
 * the route rather than stored as an empty year.
 */
export function parseGitLog(text) {
  const days = {}, authors = {};
  let total = 0, first = null, last = null;
  const take = (dateStr, author) => {
    const t = new Date(dateStr);
    if (!Number.isFinite(t.getTime())) return;
    const d = t.toISOString().slice(0, 10);
    days[d] = (days[d] || 0) + 1;
    const a = String(author || 'unknown').trim().slice(0, 80) || 'unknown';
    authors[a] = (authors[a] || 0) + 1;
    total++;
    if (!first || d < first) first = d;
    if (!last || d > last) last = d;
  };
  const lines = String(text || '').split(/\r?\n/);
  let plainAuthor = null;
  for (const raw of lines) {
    const line = raw.trimEnd();
    // Pipe format: hash|date|author|subject (subject may itself contain pipes).
    const pipe = line.match(/^([0-9a-f]{7,40})\|([^|]+)\|([^|]*)\|?/i);
    if (pipe) { take(pipe[2].trim(), pipe[3]); continue; }
    // Plain `git log`.
    const au = line.match(/^Author:\s+(.+?)\s*(<[^>]*>)?\s*$/);
    if (au) { plainAuthor = au[1]; continue; }
    const dt = line.match(/^(?:Author)?Date:\s+(.+)$/);
    if (dt && plainAuthor != null) { take(dt[1].trim(), plainAuthor); plainAuthor = null; continue; }
  }
  return { days, authors, total, first, last };
}

/** The activity shape the page renders, from stored day/author counts (an import). */
export function computeActivityFromCounts({ days = {}, authors = {}, first = null, last = null, total = 0 } = {}) {
  const heatmap = [];
  let yearCommits = 0, activeDays = 0, busiest = { date: null, count: 0 };
  const now = new Date();
  const todaySec = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 1000;
  const dow = new Date(todaySec * 1000).getUTCDay();
  const startWeek = todaySec - dow * DAY - 51 * 7 * DAY;
  for (let i = 0; i < 52 * 7; i++) {
    const date = iso(startWeek + i * DAY);
    const count = days[date] || 0;
    heatmap.push({ date, count });
    yearCommits += count;
    if (count > 0) activeDays += 1;
    if (count > busiest.count) busiest = { date, count };
  }
  const byYear = {};
  for (const [d, n] of Object.entries(days)) { const y = d.slice(0, 4); byYear[y] = (byYear[y] || 0) + n; }
  const perYear = Object.keys(byYear).map((y) => ({ year: Number(y), commits: byYear[y] })).sort((a, b) => a.year - b.year);
  const contributors = Object.entries(authors).map(([name, commits]) => ({ name, commits, avatar: null, url: null })).sort((a, b) => b.commits - a.commits);
  const spanDays = first && last ? Math.round((new Date(last) - new Date(first)) / 864e5) + 1 : 0;
  return {
    heatmap, yearCommits, activeDays, busiestDay: busiest.date ? busiest : null,
    totalCommits: total, perYear, contributors,
    firstCommit: first, lastCommit: last,
    spanDays, spanMonths: Math.round(spanDays / 30.44), spanYears: spanDays ? +(spanDays / 365.25).toFixed(1) : 0,
    imported: true,
  };
}

/**
 * Dated markers to pin on the timeline, from GitHub /releases. `includeMessages` decides
 * whether the release body travels (the "include commit messages" toggle the feature asks
 * for, applied to release notes here).
 */
export function releaseMarkers(releases, { includeMessages = false } = {}) {
  return (Array.isArray(releases) ? releases : [])
    .filter((r) => r && !r.draft && (r.published_at || r.created_at))
    .map((r) => ({
      kind: r.prerelease ? 'prerelease' : 'release',
      date: String(r.published_at || r.created_at).slice(0, 10),
      title: r.name || r.tag_name || '',
      tag: r.tag_name || '',
      ...(includeMessages && r.body ? { body: String(r.body).slice(0, 2000) } : {}),
    }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

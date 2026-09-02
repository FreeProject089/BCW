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
  for (const c of rows) {
    for (const w of Array.isArray(c?.weeks) ? c.weeks : []) {
      if ((Number(w?.c) || 0) > 0) {
        firstWeek = Math.min(firstWeek, w.w);
        lastWeek = Math.max(lastWeek, w.w);
      }
    }
  }
  const hasSpan = firstWeek !== Infinity && lastWeek > 0;
  // +7: a week's `w` is its start, so the last active week runs six days past its own stamp.
  const spanDays = hasSpan ? Math.round((lastWeek - firstWeek) / DAY) + 7 : 0;

  return {
    heatmap,
    yearCommits,
    activeDays,
    busiestDay: busiest.date ? busiest : null,
    totalCommits,
    contributors: contribList,
    firstCommit: hasSpan ? iso(firstWeek) : null,
    lastCommit: hasSpan ? iso(lastWeek) : null,
    spanDays,
    spanMonths: Math.round(spanDays / 30.44),
    spanYears: spanDays ? +(spanDays / 365.25).toFixed(1) : 0,
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

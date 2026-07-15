// HTML rendering for the stress report — a single self-contained file you open in a browser.
// No CDN, no build step: inline CSS + SVG, so `report.html` works from the filesystem.
//
// Two separate charts (throughput, latency tail) rather than one dual-axis plot: two y-scales
// on one plot invent a correlation that isn't in the data. Colors are the validated 4-slot
// categorical palette, assigned per SCENARIO in fixed order — a scenario keeps its hue no
// matter which chart it appears in. Legend + endpoint labels + the full tables mean identity
// and values are never color-alone.
import { findKnee, diagnose, minSpec } from './report.mjs';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (n) => (n == null ? '—' : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)));
const ms = (n) => (n == null ? '—' : `${Math.round(n)}ms`);

// Fixed categorical order — slot per scenario, light/dark steps of the same hues.
const SLOTS = ['--series-1', '--series-2', '--series-3', '--series-4'];

// ── SVG line chart. `scale` is 'linear' or 'log'. x is ORDINAL (the named levels are not
// linearly spaced: 10/50/200/1000/5000), so evenly spaced ticks are the honest layout.
function lineChart({ series, levels, yLabel, scale = 'linear', fmtY }) {
  const W = 760, H = 300, P = { t: 18, r: 96, b: 46, l: 58 }; // r/b leave room for endpoint labels + the x-axis band
  const iw = W - P.l - P.r, ih = H - P.t - P.b;
  const all = series.flatMap((s) => s.points.map((p) => p.y)).filter((v) => v != null && (scale !== 'log' || v > 0));
  const maxY = Math.max(...all, 1);
  const minY = scale === 'log' ? Math.max(Math.min(...all), 0.5) : 0;
  const yPos = (v) => {
    if (v == null) return null;
    if (scale === 'log') {
      const lv = Math.log10(Math.max(v, minY)), lo = Math.log10(minY), hi = Math.log10(maxY);
      return P.t + ih - ((lv - lo) / Math.max(hi - lo, 1e-6)) * ih;
    }
    return P.t + ih - (v / maxY) * ih;
  };
  const xPos = (i) => P.l + (levels.length === 1 ? iw / 2 : (i / (levels.length - 1)) * iw);

  // Ticks: log → decades; linear → 4 even steps.
  let ticks = [];
  if (scale === 'log') {
    for (let e = Math.floor(Math.log10(minY)); e <= Math.ceil(Math.log10(maxY)); e++) {
      const v = Math.pow(10, e);
      if (v >= minY * 0.9 && v <= maxY * 1.1) ticks.push(v);
    }
  } else {
    for (let i = 0; i <= 4; i++) ticks.push((maxY / 4) * i);
  }

  const grid = ticks.map((v) => `<line class="grid" x1="${P.l}" x2="${P.l + iw}" y1="${yPos(v).toFixed(1)}" y2="${yPos(v).toFixed(1)}"/>
    <text class="tick" x="${P.l - 8}" y="${(yPos(v) + 4).toFixed(1)}" text-anchor="end">${esc(fmtY(v))}</text>`).join('');

  const xticks = levels.map((l, i) => `<text class="tick" x="${xPos(i).toFixed(1)}" y="${H - P.b + 18}" text-anchor="middle">${esc(l.name)}</text>
    <text class="tick tick-sub" x="${xPos(i).toFixed(1)}" y="${H - P.b + 32}" text-anchor="middle">${esc(fmt(l.conns))}</text>`).join('');

  const drawn = series.map((s, si) => ({
    s, si,
    pts: s.points.map((p, i) => ({ x: xPos(i), y: yPos(p.y), raw: p })).filter((p) => p.y != null && !Number.isNaN(p.y)),
  })).filter((d) => d.pts.length);

  // Endpoint labels collide whenever two series finish at a similar value — which is exactly
  // when you most need to tell them apart. Nudge them apart vertically (sorted, min gap, then
  // shifted back inside the plot if the stack overflows) instead of letting them overprint.
  // 16 viewBox units: an 11-unit label's line box measures ~14.1, so a smaller gap still
  // overprints (13 did). The SVG scales, but so does the text — the ratio holds at any width.
  const GAP = 16;
  const labels = drawn.map((d) => ({ d, y: d.pts[d.pts.length - 1].y })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < GAP) labels[i].y = labels[i - 1].y + GAP;
  const overflow = labels.length ? labels[labels.length - 1].y - (P.t + ih) : 0;
  if (overflow > 0) for (const l of labels) l.y = Math.max(P.t + 6, l.y - overflow);
  const labelY = new Map(labels.map((l) => [l.d.si, l.y]));

  const body = drawn.map(({ s, si, pts }) => {
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
    const last = pts[pts.length - 1];
    const c = `var(${SLOTS[si % SLOTS.length]})`;
    // Marks: 2px line, >=8px markers with a 2px surface ring where they overlap.
    const dots = pts.map((p) => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4" fill="${c}" stroke="var(--surface-1)" stroke-width="2"/>`).join('');
    // Hover: a >=24px invisible target per point; the tooltip ENHANCES — every value is also
    // in the table below, so nothing is gated behind hover.
    const hits = pts.map((p) => `<rect class="hit" x="${(p.x - 14).toFixed(1)}" y="${(p.y - 14).toFixed(1)}" width="28" height="28" fill="transparent"
      tabindex="0" role="img" aria-label="${esc(s.name)} ${esc(p.raw.label)}: ${esc(fmtY(p.raw.y))}"
      data-tip="${esc(s.name)} · ${esc(p.raw.label)} · ${esc(fmtY(p.raw.y))}"/>`).join('');
    // Direct label at the ENDPOINT only — never a number on every point. A hairline leader
    // connects it back to its line when de-collision moved it off the endpoint.
    const ly = labelY.get(si);
    const leader = Math.abs(ly - last.y) > 2
      ? `<line x1="${(last.x + 4).toFixed(1)}" y1="${last.y.toFixed(1)}" x2="${(last.x + 8).toFixed(1)}" y2="${ly.toFixed(1)}" stroke="${c}" stroke-width="1" opacity=".5"/>` : '';
    return `<g><path d="${d}" fill="none" stroke="${c}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>${dots}${leader}
      <text class="endlabel" x="${(last.x + 10).toFixed(1)}" y="${(ly + 4).toFixed(1)}">${esc(s.name)}</text>${hits}</g>`;
  }).join('');

  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="${esc(yLabel)}">
    <text class="axis-title" x="${P.l}" y="12">${esc(yLabel)}</text>
    ${grid}
    <line class="axis" x1="${P.l}" x2="${P.l + iw}" y1="${P.t + ih}" y2="${P.t + ih}"/>
    ${xticks}${body}
  </svg>`;
}

export function toHtml(meta, scenarios) {
  const knees = scenarios.map((s) => ({ name: s.name, knee: findKnee(s.results) })).filter((x) => x.knee);
  const peak = knees.map((x) => x.knee).reduce((b, k) => (k.ok2xx_s > (b?.ok2xx_s ?? -1) ? k : b), null);
  const mixed = knees.find((x) => x.name === 'mixed')?.knee;
  const lowest = knees.map((x) => x.knee).reduce((m, k) => (k.ok2xx_s < (m?.ok2xx_s ?? Infinity) ? k : m), null);
  const anchor = mixed || lowest || peak;
  const worstTail = scenarios.flatMap((s) => s.results).reduce((w, r) => (r.p99_9 > (w?.p99_9 ?? -1) ? r : w), null);

  const thr = lineChart({
    levels: meta.levels, yLabel: 'Served requests/sec (2xx only)', fmtY: fmt,
    series: scenarios.map((s) => ({ name: s.name, points: s.results.map((r) => ({ y: r.ok2xx_s, label: r.level })) })),
  });
  const lat = lineChart({
    levels: meta.levels, yLabel: 'p99.9 latency (ms · log scale)', scale: 'log', fmtY: (v) => (v >= 1000 ? `${v / 1000}s` : `${v}`),
    series: scenarios.map((s) => ({ name: s.name, points: s.results.map((r) => ({ y: r.p99_9, label: r.level })) })),
  });

  const tables = scenarios.map((s) => `
    <section class="card">
      <h3>${esc(s.name)}</h3>
      <p class="desc">${esc(s.desc)}</p>
      <div class="scroll"><table>
        <thead><tr><th>level</th><th>conns</th><th>req/s</th><th>2xx/s</th><th>p50</th><th>p90</th><th>p99</th><th>p99.9</th><th>non-2xx</th><th>err</th><th>t/o</th><th>ping p99</th></tr></thead>
        <tbody>${s.results.map((r) => `<tr><td>${esc(r.level)}</td><td>${fmt(r.conns)}</td><td>${fmt(r.rps)}</td><td><b>${fmt(r.ok2xx_s)}</b></td>
          <td>${ms(r.p50)}</td><td>${ms(r.p90)}</td><td>${ms(r.p99)}</td><td>${ms(r.p99_9)}</td><td>${fmt(r.non2xx)}</td>
          <td class="${r.errors ? 'bad' : ''}">${r.errors}</td><td class="${r.timeouts ? 'bad' : ''}">${r.timeouts}</td><td>${r.ping ? ms(r.ping.p99) : '—'}</td></tr>`).join('')}</tbody>
      </table></div>
      <ul class="notes">${diagnose(s).map((n) => `<li>${n.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`(.+?)`/g, '<code>$1</code>')}</li>`).join('')}</ul>
    </section>`).join('');

  const specRows = anchor ? minSpec(meta, anchor.ok2xx_s).map((s) => {
    const note = s.users <= 100 ? 'single small instance' : s.users <= 1000 ? '1–2 replicas behind the edge'
      : s.users <= 10000 ? 'horizontal replicas + managed Postgres + Redis' : 'multi-node + read replicas + CDN';
    return `<tr><td>${s.users.toLocaleString('en-US')}</td><td>${s.coresNeeded}</td><td>${s.gb} GB</td><td>${note}</td></tr>`;
  }).join('') : '';

  return `<div class="viz-root" data-palette="#2a78d6,#1baf7a,#eda100,#008300">
<style>
  .viz-root{color-scheme:light;--surface-1:#fcfcfb;--plane:#f9f9f7;--text-primary:#0b0b0b;--text-secondary:#52514e;--muted:#898781;
    --grid:#e1e0d9;--axis:#c3c2b7;--border:rgba(11,11,11,0.10);--critical:#d03b3b;
    --series-1:#2a78d6;--series-2:#1baf7a;--series-3:#eda100;--series-4:#008300;
    font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:var(--plane);color:var(--text-primary);
    padding:24px;line-height:1.5;}
  @media (prefers-color-scheme:dark){:root:where(:not([data-theme="light"])) .viz-root{color-scheme:dark;
    --surface-1:#1a1a19;--plane:#0d0d0d;--text-primary:#fff;--text-secondary:#c3c2b7;--muted:#898781;
    --grid:#2c2c2a;--axis:#383835;--border:rgba(255,255,255,0.10);
    --series-1:#3987e5;--series-2:#199e70;--series-3:#c98500;--series-4:#008300;}}
  :root[data-theme="dark"] .viz-root{color-scheme:dark;--surface-1:#1a1a19;--plane:#0d0d0d;--text-primary:#fff;--text-secondary:#c3c2b7;
    --grid:#2c2c2a;--axis:#383835;--border:rgba(255,255,255,0.10);
    --series-1:#3987e5;--series-2:#199e70;--series-3:#c98500;--series-4:#008300;}
  .viz-root *{box-sizing:border-box}
  h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:28px 0 10px}h3{font-size:14px;margin:0 0 2px}
  .sub{color:var(--text-secondary);font-size:13px;margin:0 0 18px}
  .card{background:var(--surface-1);border:1px solid var(--border);border-radius:10px;padding:16px;margin-bottom:14px}
  .tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px;margin-bottom:8px}
  .tile .k{font-size:12px;color:var(--text-secondary);margin-bottom:6px}
  .tile .v{font-size:30px;font-weight:600;letter-spacing:-.02em}   /* proportional figures, system sans */
  .tile .m{font-size:12px;color:var(--muted);margin-top:4px}
  .chart{width:100%;height:auto;display:block;overflow:visible}
  .grid{stroke:var(--grid);stroke-width:1}       /* solid hairline — never dashed */
  .axis{stroke:var(--axis);stroke-width:1}
  .tick{fill:var(--muted);font-size:10px;font-variant-numeric:tabular-nums}
  .tick-sub{font-size:9px;opacity:.75}
  .axis-title{fill:var(--text-secondary);font-size:11px}
  .endlabel{fill:var(--text-secondary);font-size:11px}  /* text wears text ink, not the series hue */
  .hit{cursor:crosshair;outline:none}
  .hit:focus-visible{stroke:var(--text-primary);stroke-width:2}
  .legend{display:flex;gap:16px;flex-wrap:wrap;margin:10px 0 0;padding:0;list-style:none;font-size:12px;color:var(--text-secondary)}
  .legend li{display:flex;align-items:center;gap:6px}
  .sw{width:10px;height:10px;border-radius:3px;flex:none}
  .scroll{overflow-x:auto}
  table{border-collapse:collapse;width:100%;font-size:12px;font-variant-numeric:tabular-nums}
  th,td{text-align:right;padding:6px 8px;border-bottom:1px solid var(--border);white-space:nowrap}
  th:first-child,td:first-child{text-align:left}
  th{color:var(--text-secondary);font-weight:500}
  td.bad{color:var(--critical);font-weight:600}
  .desc{color:var(--text-secondary);font-size:12px;margin:0 0 10px}
  .notes{margin:12px 0 0;padding-left:18px;font-size:13px;color:var(--text-secondary)}
  .notes li{margin-bottom:6px}
  code{background:var(--plane);border:1px solid var(--border);border-radius:4px;padding:0 4px;font-size:12px}
  .callout{border-left:3px solid var(--series-1);padding:10px 14px;background:var(--surface-1);border-radius:0 8px 8px 0;
    font-size:13px;color:var(--text-secondary);margin-bottom:14px}
  #tip{position:fixed;pointer-events:none;opacity:0;transition:opacity .1s;background:var(--text-primary);color:var(--surface-1);
    font-size:12px;padding:5px 9px;border-radius:6px;white-space:nowrap;z-index:9}
</style>

<h1>BCWEB stress report</h1>
<p class="sub">${esc(meta.at)} · target <code>${esc(meta.origin + meta.prefix)}</code> · ${esc(meta.cores)} cores / ${esc(meta.memGB)} GB · Node ${esc(meta.node)} · ${esc(meta.durationSec)}s per level</p>

<div class="tiles">
  <div class="card tile"><div class="k">Peak clean throughput</div><div class="v">${peak ? fmt(peak.ok2xx_s) : '—'}</div>
    <div class="m">${peak ? `req/s · ${esc(peak.scenario)} @ ${esc(peak.level)}` : 'no clean level'}</div></div>
  <div class="card tile"><div class="k">Realistic blend (sizing anchor)</div><div class="v">${anchor ? fmt(anchor.ok2xx_s) : '—'}</div>
    <div class="m">${anchor ? `req/s · ${esc(anchor.scenario)} @ ${esc(anchor.level)}` : '—'}</div></div>
  <div class="card tile"><div class="k">Worst p99.9</div><div class="v">${worstTail ? ms(worstTail.p99_9) : '—'}</div>
    <div class="m">${worstTail ? `${esc(worstTail.scenario)} @ ${esc(worstTail.level)}` : '—'}</div></div>
</div>

<div class="callout"><b>Read this first.</b> On loopback with one client box the upper levels aren't real internet clients — one machine
out-runs the server, and the anti-abuse rate limiter then sheds the flood <b>by design</b> (that's non-2xx, not errors). The honest signals
are <b>served req/s</b>, the <b>tail</b> (p99/p99.9), and <b>where errors or timeouts first appear</b>.</div>

<section class="card">
  <h3>Throughput vs concurrency</h3>
  <p class="desc">Where each curve stops rising is that path's ceiling on this hardware.</p>
  ${thr}
  <ul class="legend">${scenarios.map((s, i) => `<li><span class="sw" style="background:var(${SLOTS[i % SLOTS.length]})"></span>${esc(s.name)}</li>`).join('')}</ul>
</section>

<section class="card">
  <h3>Latency tail vs concurrency</h3>
  <p class="desc">p99.9 — the 1-in-1000 request. Log scale: a straight rise is an order-of-magnitude jump.</p>
  ${lat}
  <ul class="legend">${scenarios.map((s, i) => `<li><span class="sw" style="background:var(${SLOTS[i % SLOTS.length]})"></span>${esc(s.name)}</li>`).join('')}</ul>
</section>

<h2>Per scenario</h2>
${tables}

<h2>Minimum server spec (extrapolated)</h2>
<section class="card">
  ${anchor ? `<p class="desc">Anchored to the <b>${esc(anchor.scenario)}</b> scenario — the realistic blend, <i>not</i> the trivial /health peak:
    <b>${fmt(anchor.ok2xx_s)} served req/s on ${esc(meta.cores)} core(s)</b> (≈ ${fmt(anchor.ok2xx_s / meta.cores)} req/s/core), assuming
    <b>${esc(meta.rpmPerUser)} requests/min per active user</b>. Linear and conservative — a starting point, then measure.</p>
  <div class="scroll"><table><thead><tr><th>Concurrent active users</th><th>vCPU (API)</th><th>RAM (API)</th><th>Notes</th></tr></thead>
    <tbody>${specRows}</tbody></table></div>
  <ul class="notes"><li>These are <b>API-tier</b> numbers. The first real ceiling is usually <b>Postgres</b> (pool + slow queries) and Redis
    memory, not API CPU — size those from the <code>db-read</code> knee, and put the static site + <code>catalog.json</code> behind a CDN so
    they never reach the origin. The API scales horizontally; the database does not for free.</li></ul>`
    : '<p class="desc">No clean capacity anchor was measured, so no extrapolation is given.</p>'}
</section>

<div id="tip"></div>
<script>
(() => {
  const tip = document.getElementById('tip');
  const show = (el) => { const t = el.getAttribute('data-tip'); if (!t) return;
    const r = el.getBoundingClientRect(); tip.textContent = t; tip.style.opacity = '1';
    tip.style.left = Math.min(window.innerWidth - tip.offsetWidth - 8, r.left + r.width / 2 - tip.offsetWidth / 2) + 'px';
    tip.style.top = (r.top - tip.offsetHeight - 8) + 'px'; };
  const hide = () => { tip.style.opacity = '0'; };
  for (const el of document.querySelectorAll('.hit')) {
    el.addEventListener('mouseenter', () => show(el)); el.addEventListener('mouseleave', hide);
    el.addEventListener('focus', () => show(el)); el.addEventListener('blur', hide);   // keyboard sees what hover sees
  }
})();
</script>
</div>`;
}

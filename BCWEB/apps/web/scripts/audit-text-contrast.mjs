#!/usr/bin/env node
// Text that has nothing behind it.
//
// "Too many elements have no background behind their text" is a claim about what is PAINTED,
// and the DOM alone cannot answer it: a heading with no background of its own sits on the page,
// and on this site the page is the moving 3D orb (Hero3D, `fixed inset-0 -z-10`), which is
// bright in places and changes every frame. So this measures twice:
//
//   1. by the DOM: for every element that owns visible text, walk up to the first ancestor that
//      paints an OPAQUE background. None before <html> means "no surface": the text sits on the
//      page backdrop, i.e. on the orb. Translucent layers met on the way are counted (that is
//      the Translucent surfaces setting at work, which is the user's choice, not a defect).
//   2. by the pixels: the page is screenshotted with every glyph made transparent, one viewport
//      at a time, and the pixels under each text box are read back. The contrast reported is
//      the 10th percentile over those pixels, against the text colour composited at its real
//      opacity: what the reader actually gets, orb, gradients and glass included.
//
// A text box fails below WCAG AA: 4.5:1, or 3:1 for large text (>= 24px, or >= 18.66px bold).
//
// Runs against any served build: `npm run dev` or `npm run preview`. It needs a Chromium:
// puppeteer-core is resolved from any node_modules above this folder, and the browser from
// CHROME_PATH or the usual install locations. Nothing here runs in `lint`; it needs a server.
//
//   node scripts/audit-text-contrast.mjs --base http://localhost:5176
//     [--pages /,/catalog] [--widths 375,768,1280] [--themes light,dark] [--glass off,on]
//     [--texture off,on] [--json out.json] [--top 25] [--max-steps 8]
//
// `--halo` keeps every text-shadow while the glyphs are hidden. Text on the backdrop gets its
// legibility from its own shadow (index.css, `.plate` / `.on-backdrop`), not from a box, and a
// run without this flag measures that text as if the shadow did not exist. With it, the pixels
// read back under a text box are the ones the glyphs are actually drawn on. Conservative: the
// halo is densest AT the glyphs, and the sampling grid also reads the gaps between words.
//
// Signed-in screens (/dashboard, /admin?s=…): set AUDIT_EMAIL, AUDIT_PASSWORD and, for a 2FA
// account (every staff account), AUDIT_TOTP (the base32 secret). Each worker signs in once
// before its pages. Use a throwaway fixture account on a dev database, never a real one.
//
// Exit code is 0: this is a measurement, not a gate. Read the table.
import { existsSync, writeFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : '1']);
  return acc;
}, []));
const list = (v, d) => String(v ?? d).split(',').map((s) => s.trim()).filter(Boolean);

const BASE = (args.base || 'http://localhost:5176').replace(/\/$/, '');
const PAGES = list(args.pages, [
  '/', '/catalog', '/blog', '/blog/bmm-1-0-release', '/docs', '/docs/site-tour', '/hosting', '/repos',
  '/projects', '/project/bmm', '/contact', '/faq', '/status', '/polls', '/myo', '/charity', '/settings',
  '/legal/privacy', '/auth', '/dashboard', '/profile', '/admin',
].join(','));
const WIDTHS = list(args.widths, '375,768,1280').map(Number);
const THEMES = list(args.themes, 'light,dark');
const GLASS = list(args.glass, 'off,on');
const TEXTURE = list(args.texture, 'off');
const TOP = Number(args.top || 25);
const MAX_STEPS = Number(args["max-steps"] || 14);

const CHROMES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].filter(Boolean);

let puppeteer;
try { puppeteer = (await import('puppeteer-core')).default; } catch {
  console.error('audit-text-contrast: puppeteer-core is not installed anywhere above this folder.\n  npm i -D puppeteer-core   (or run it from a checkout that has it)');
  process.exit(2);
}
const executablePath = CHROMES.find((p) => existsSync(p));
if (!executablePath) { console.error('audit-text-contrast: no Chromium found; set CHROME_PATH.'); process.exit(2); }

// ---------------------------------------------------------------- in-page code
// Collected once per load. Stores the elements on window so each scroll step can re-read their
// rects (sticky and fixed elements move with the viewport; a rect taken once would be wrong).
function collect() {
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION', 'TEMPLATE', 'svg', 'SVG', 'CANVAS']);
  const cv = document.createElement('canvas'); cv.width = cv.height = 1;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  // Any CSS colour (rgb, color(srgb), oklab, color-mix results) -> [r,g,b,a] via the canvas.
  const rgba = (str) => {
    if (!str || str === 'transparent') return [0, 0, 0, 0];
    cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = str; cx.fillRect(0, 0, 1, 1);
    const d = cx.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2], d[3] / 255];
  };
  const byEl = new Map();
  const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    if (!n.nodeValue || !n.nodeValue.trim()) continue;
    const el = n.parentElement;
    if (!el || SKIP.has(el.tagName) || el.closest('[aria-hidden="true"],svg,.sr-only,[hidden]')) continue;
    if (!byEl.has(el)) byEl.set(el, []);
    byEl.get(el).push(n);
  }
  const els = [];
  for (const [el, nodes] of byEl) {
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    const fill = cs.webkitTextFillColor;
    if (fill && rgba(fill)[3] === 0) continue; // gradient text (background-clip:text)
    let op = 1;
    for (let a = el; a; a = a.parentElement) op *= Number(getComputedStyle(a).opacity);
    if (op < 0.15) continue;
    // Surface: the first ancestor with an opaque background; translucent ones on the way.
    let surface = 'none', surfaceSel = '', translucent = 0, glassy = 0;
    for (let a = el; a && a !== document.documentElement; a = a.parentElement) {
      const s = getComputedStyle(a);
      const bg = rgba(s.backgroundColor);
      const img = s.backgroundImage || 'none';
      const tag = a === document.body ? 'body' : a.tagName.toLowerCase() + (a.classList.length ? '.' + [...a.classList].slice(0, 3).join('.') : '');
      if (img.includes('url(') && !img.includes('data:image/svg+xml') && !img.includes('data:image/png')) { surface = 'image'; surfaceSel = tag; break; }
      if (a === document.body) break; // body paints the page, which the orb draws over
      if (bg[3] >= 0.995) { surface = 'opaque'; surfaceSel = tag; break; }
      if (bg[3] > 0.02 || img.includes('gradient')) { translucent += 1; if (!surfaceSel) surfaceSel = tag; }
      if (s.backdropFilter && s.backdropFilter !== 'none') glassy += 1;
    }
    if (surface === 'none' && translucent) surface = 'translucent';
    const size = parseFloat(cs.fontSize), weight = Number(cs.fontWeight) || 400;
    const text = nodes.map((n) => n.nodeValue).join(' ').replace(/\s+/g, ' ').trim();
    const path = [];
    for (let a = el; a && a !== document.body && path.length < 4; a = a.parentElement) {
      path.unshift(a.tagName.toLowerCase() + (a.classList.length ? '.' + [...a.classList].filter((c) => !/[[\]:/]/.test(c)).slice(0, 2).join('.') : ''));
    }
    els.push({ el, nodes, rec: {
      text: text.slice(0, 60), sel: path.join(' > '), size, weight,
      large: size >= 24 || (size >= 18.66 && weight >= 700),
      color: rgba(cs.color), opacity: op, surface, surfaceSel, translucent, glassy,
    } });
  }
  window.__cx = els;
  window.__cxRgba = rgba;
  return els.length;
}

// Text boxes of the element's own text nodes, in viewport coordinates.
function boxesInView() {
  const vw = innerWidth, vh = innerHeight, out = [];
  window.__cx.forEach((e, i) => {
    if (e.done) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of e.nodes) {
      const r = document.createRange(); r.selectNodeContents(n);
      for (const b of r.getClientRects()) {
        if (b.width < 1 || b.height < 1) continue;
        x0 = Math.min(x0, b.left); y0 = Math.min(y0, b.top); x1 = Math.max(x1, b.right); y1 = Math.max(y1, b.bottom);
      }
    }
    if (!(x1 > x0 && y1 > y0)) return;
    if (x0 < 0 || y0 < 0 || x1 > vw || y1 > vh) return;
    // Occluded (under the sticky topbar, a dialog, the cookie banner)? Then not this step.
    const cxp = (x0 + x1) / 2, cyp = (y0 + y1) / 2;
    const top = document.elementFromPoint(cxp, cyp);
    if (!top || !(top === e.el || e.el.contains(top) || top.contains(e.el))) return;
    out.push({ i, x0: Math.floor(x0), y0: Math.floor(y0), x1: Math.ceil(x1), y1: Math.ceil(y1) });
  });
  return out;
}

async function sample(dataUrl, boxes) {
  const blob = await (await fetch(dataUrl)).blob();
  const bmp = await createImageBitmap(blob);
  const oc = new OffscreenCanvas(bmp.width, bmp.height);
  const g = oc.getContext('2d', { willReadFrequently: true });
  g.drawImage(bmp, 0, 0);
  const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const lum = (r, gg, b) => 0.2126 * lin(r) + 0.7152 * lin(gg) + 0.0722 * lin(b);
  const res = [];
  for (const b of boxes) {
    const e = window.__cx[b.i];
    const w = Math.max(1, b.x1 - b.x0), h = Math.max(1, b.y1 - b.y0);
    const d = g.getImageData(b.x0, b.y0, w, h).data;
    const [tr, tg, tb, ta] = e.rec.color; const a = ta * e.rec.opacity;
    const sx = Math.max(1, Math.floor(w / 24)), sy = Math.max(1, Math.floor(h / 6));
    const ratios = [];
    for (let y = 0; y < h; y += sy) for (let x = 0; x < w; x += sx) {
      const k = (y * w + x) * 4;
      const br = d[k], bg = d[k + 1], bb = d[k + 2];
      const Lb = lum(br, bg, bb);
      const Lf = lum(a * tr + (1 - a) * br, a * tg + (1 - a) * bg, a * tb + (1 - a) * bb);
      ratios.push((Math.max(Lb, Lf) + 0.05) / (Math.min(Lb, Lf) + 0.05));
    }
    ratios.sort((p, q) => p - q);
    const p10 = ratios[Math.floor(ratios.length * 0.1)] ?? 21;
    e.done = true;
    res.push({ ...e.rec, contrast: Math.round(p10 * 100) / 100, min: Math.round(ratios[0] * 100) / 100 });
  }
  return res;
}

// ---------------------------------------------------------------- driver
const HALO = args.halo === '1';
const HIDE = '*,*::before,*::after{color:transparent!important;-webkit-text-fill-color:transparent!important;'
  + (HALO ? '' : 'text-shadow:none!important;') + 'caret-color:transparent!important;transition:none!important}';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// RFC 6238, the same computation as apps/api/src/lib/totp.mjs.
function totpNow(secretB32) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of secretB32.replace(/[=\s]/g, '').toUpperCase()) bits += A.indexOf(c).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const ctr = Buffer.alloc(8); ctr.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const h = createHmac('sha1', key).update(ctr).digest(); const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0');
}
async function signIn(page) {
  const email = process.env.AUDIT_EMAIL, password = process.env.AUDIT_PASSWORD;
  if (!email || !password) return;
  await page.goto(BASE + '/auth', { waitUntil: 'load', timeout: 30000 });
  const call = (url, body) => page.evaluate(async (u, b) => fetch(u, { method: 'POST', credentials: 'include',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json()).catch(() => ({})), url, body);
  const one = await call('/api/auth/login', { email, password });
  if (one.twoFactorRequired || one.tempToken) {
    if (!process.env.AUDIT_TOTP) throw new Error('the account needs 2FA: set AUDIT_TOTP');
    const two = await call('/api/auth/login/2fa', { tempToken: one.tempToken, code: totpNow(process.env.AUDIT_TOTP) });
    if (two.error) throw new Error('2fa refused: ' + two.error);
  } else if (one.error) throw new Error('sign-in refused: ' + one.error);
}

// One browser per worker, not one tab per worker: a background tab in a shared browser does
// not render (no animation frames, no intersection callbacks), so lazy sections never mount
// and the page measures as its topbar and footer. Measured: 47 text boxes instead of 158.
const launch = () => puppeteer.launch({
  executablePath, headless: true,
  args: ['--hide-scrollbars', '--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--force-color-profile=srgb'],
});

const combos = [];
for (const theme of THEMES) for (const glass of GLASS) for (const texture of TEXTURE) combos.push({ theme, glass, texture });

const all = [];
const summary = [];
const jobs = [];
for (const combo of combos) for (const width of WIDTHS) jobs.push({ combo, width });
const JOBS = Number(args.jobs || 3);

async function run(browser, { combo, width }) {
  {
    const page = await browser.newPage();
    await page.setViewport({ width, height: width < 768 ? 812 : 900, deviceScaleFactor: 1 });
    await page.evaluateOnNewDocument((c) => {
      try {
        localStorage.setItem('bcw_theme', c.theme);
        localStorage.setItem('bcw_glass_surfaces', c.glass === 'on' ? '1' : '0');
        localStorage.setItem('bcw_glass_opacity', '85');
        localStorage.setItem('bcw_texture', c.texture);
        localStorage.setItem('bcw_consent', 'essential');
        localStorage.setItem('bcw_welcome_v1', '1');
        localStorage.setItem('bcweb_skip_intro', '1');
      } catch { /* storage refused */ }
    }, combo);
    await signIn(page);
    for (const path of PAGES) {
      const row = { ...combo, width, path, texts: 0, measured: 0, fail: 0, noSurface: 0, noSurfaceFail: 0 };
      try {
        // `load`, not network-idle: some pages hold a live connection open and never go idle.
        await page.goto(BASE + path, { waitUntil: 'load', timeout: 30000 });
        await sleep(1800);
        row.url = page.url().replace(BASE, '');
        const H = await page.evaluate(() => document.documentElement.scrollHeight);
        const vh = await page.evaluate(() => innerHeight);
        // One pass down the page first: sections reveal on scroll (opacity 0 until seen), and
        // text collected before that would be skipped as invisible.
        for (let y = 0, s = 0; s < MAX_STEPS && y < H; s += 1, y += Math.floor(vh * 0.8)) {
          await page.evaluate((yy) => window.scrollTo(0, yy), y);
          await sleep(150);
        }
        await page.evaluate(() => window.scrollTo(0, 0));
        await sleep(700);
        row.texts = await page.evaluate(collect);
        const style = await page.addStyleTag({ content: HIDE });
        for (let step = 0, y = 0; step < MAX_STEPS && y < H; step += 1, y += Math.floor(vh * 0.8)) {
          await page.evaluate((yy) => window.scrollTo(0, yy), y);
          await sleep(350);
          const boxes = await page.evaluate(boxesInView);
          if (!boxes.length) continue;
          const shot = await page.screenshot({ encoding: 'base64', type: 'png' });
          const res = await page.evaluate(sample, 'data:image/png;base64,' + shot, boxes);
          for (const r of res) {
            const need = r.large ? 3 : 4.5;
            r.fail = r.contrast < need;
            r.need = need;
            row.measured += 1;
            if (r.fail) row.fail += 1;
            if (r.surface === 'none') { row.noSurface += 1; if (r.fail) row.noSurfaceFail += 1; }
            all.push({ ...combo, width, path, ...r });
          }
        }
        await page.evaluate((el) => el.remove(), style);
      } catch (e) {
        row.error = String(e.message || e).slice(0, 120);
      }
      summary.push(row);
      process.stderr.write(`${combo.theme}/${combo.glass}/tex-${combo.texture} ${width} ${path}: ${row.fail}/${row.measured} (of ${row.texts}) fail, ${row.noSurface} no-surface${row.error ? ' ERR ' + row.error : ''}\n`);
    }
    await page.close().catch(() => {});
  }
}
// A worker outlives its browser. Three headless Chromiums with WebGL, on a machine that is
// also running the dev server and a build, is enough for one of them to be killed: the CDP
// socket closes, `page.close()` throws ConnectionClosedError, and — before this — the
// rejection escaped `Promise.all`, so a run 250 pages deep printed a stack trace and NOTHING
// ELSE. Every measurement already taken was thrown away to report a crash in the harness.
// Now the worker relaunches and picks the queue back up, and the report always prints.
const queue = [...jobs];
const lost = [];
await Promise.all(Array.from({ length: Math.min(JOBS, queue.length) }, async () => {
  let browser = await launch();
  while (queue.length) {
    const job = queue.shift();
    try {
      await run(browser, job);
    } catch (e) {
      process.stderr.write(`worker lost its browser on ${job.combo.theme}/${job.combo.glass} ${job.width}: ${String(e.message || e).slice(0, 80)} — relaunching\n`);
      try { await browser.close(); } catch { /* already gone */ }
      browser = await launch();
      // NOT re-queued: a lost job has already written a row for every page it reached, and
      // running it again would count those pages twice — a table that double-counts is worse
      // than one with a gap, because only the gap announces itself. The line above is the
      // announcement; `--jobs 2` is the way to avoid it on a loaded machine.
      lost.push(`${job.combo.theme}/${job.combo.glass} ${job.width}`);
    }
  }
  await browser.close().catch(() => {});
}));

// ---------------------------------------------------------------- report
const pad = (s, n) => String(s).padEnd(n);
console.log('\nPer combination (text boxes measured / failing AA / sitting on no surface / no-surface AND failing)');
console.log(pad('theme', 7) + pad('glass', 7) + pad('texture', 9) + pad('measured', 10) + pad('fail', 7) + pad('noSurf', 8) + 'noSurf+fail');
for (const c of combos) {
  const rows = summary.filter((r) => r.theme === c.theme && r.glass === c.glass && r.texture === c.texture);
  const s = (k) => rows.reduce((n, r) => n + (r[k] || 0), 0);
  console.log(pad(c.theme, 7) + pad(c.glass, 7) + pad(c.texture, 9) + pad(s('measured'), 10) + pad(s('fail'), 7) + pad(s('noSurface'), 8) + s('noSurfaceFail'));
}
if (lost.length) console.log(`
${lost.length} job(s) were cut short by a browser crash and are MISSING from the table above: ${lost.join(', ')}`);
const errs = summary.filter((r) => r.error);
if (errs.length) console.log(`\n${errs.length} page loads failed: ` + errs.map((r) => `${r.path}@${r.width}`).slice(0, 10).join(', '));

// Offenders grouped by where they are, not by instance: one component repeated 40 times is
// one fix.
const byPlace = new Map();
for (const r of all.filter((x) => x.fail)) {
  const key = r.sel;
  if (!byPlace.has(key)) byPlace.set(key, { key, n: 0, worst: 99, pages: new Set(), combos: new Set(), text: r.text, surface: r.surface, surfaceSel: r.surfaceSel });
  const g = byPlace.get(key);
  g.n += 1; g.worst = Math.min(g.worst, r.contrast); g.pages.add(r.path); g.combos.add(`${r.theme}/${r.glass}/${r.width}`);
}
console.log(`\nWorst offenders (grouped by element path, top ${TOP})`);
for (const g of [...byPlace.values()].sort((a, b) => b.n - a.n || a.worst - b.worst).slice(0, TOP)) {
  console.log(`  ${String(g.n).padStart(4)}x  worst ${g.worst.toFixed(2)}  [${g.surface}${g.surfaceSel ? ' ' + g.surfaceSel : ''}]  ${g.key}\n         "${g.text}"  pages ${[...g.pages].slice(0, 4).join(' ')}  (${[...g.combos].slice(0, 4).join(', ')})`);
}
if (args.json) writeFileSync(args.json, JSON.stringify({ summary, fails: all.filter((x) => x.fail), noSurface: all.filter((x) => x.surface === 'none') }, null, 1));

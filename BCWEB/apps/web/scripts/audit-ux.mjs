#!/usr/bin/env node
// What a phone and a desktop actually get.
//
// "Is the site UX friendly on phone and PC" is a taste question until it is turned into
// counts. This walks the main pages at 375 / 768 / 1280 and measures, per page and width,
// the defects that a reader FEELS but that no unit test sees:
//
//   overflow     the document scrolls sideways, or an element is wider than the viewport
//                (ancestors that scroll or clip on their own are not defects, so an element
//                inside an overflow-x:auto strip is excluded: that strip is the design)
//   target       an interactive element smaller than 44x44 CSS px. Inline links inside
//                flowing text are counted SEPARATELY (`inline`): WCAG 2.5.8 exempts them,
//                and growing them would break the paragraph.
//   tiny         text rendered under 12px
//   measure      a paragraph longer than ~90 characters per line on desktop (est. from the
//                real font metrics via canvas measureText, not from a ch guess)
//   focus        an interactive element whose :focus-visible outline/box-shadow/border is
//                identical to its resting state, i.e. a keyboard user cannot see where
//                they are; and interactive-by-ROLE elements that Tab never reaches
//   shift        img / iframe / canvas / video with no reserved box (no width+height attrs,
//                no aspect-ratio, no fixed CSS height): the classic layout jump
//   heading      no h1, more than one h1, or a level skipped (h3 straight after h1)
//   landmark     main missing or duplicated, nav missing
//   anchor       an in-page #target with less scroll-margin-top than the sticky header is
//                tall, so jumping to it parks it behind the header
//   occluded     content that STAYS under a bar: measured with elementFromPoint at scroll 0
//                for the sticky header, and at the bottom of the page for the fixed mobile
//                bar. (Content sliding under a sticky header mid-scroll is what sticky means
//                and is not counted; an earlier version did, and reported the feature.)
//
// Everything is measured in the DOM at a real viewport. Screenshots time out in this
// environment, so nothing here takes one: geometry and computed styles only.
//
// Focus rings need keyboard modality or Chrome refuses :focus-visible, so the driver presses
// Tab once before the sweep and then focuses elements programmatically; the ring that is read
// back is the one a Tab user would see.
//
// Runs against any served build (`npm run dev` / `npm run preview`). Needs a Chromium:
// puppeteer-core is resolved from any node_modules above this folder, and the browser from
// CHROME_PATH or the usual install locations. Nothing here runs in `lint`; it needs a server.
//
//   node scripts/audit-ux.mjs --base http://localhost:5176
//     [--pages /,/catalog] [--widths 375,768,1280] [--json out.json] [--top 30] [--jobs 3]
//     [--modals] [--only overflow,target]
//
// Exit code is 0 unless --gate is passed: this is a measurement, not a gate. Read the table.
import { existsSync, writeFileSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : '1']);
  return acc;
}, []));
const list = (v, d) => String(v ?? d).split(',').map((s) => s.trim()).filter(Boolean);

const BASE = (args.base || 'http://localhost:5176').replace(/\/$/, '');
const PAGES = list(args.pages, [
  '/', '/catalog', '/blog', '/docs', '/hosting', '/repos', '/projects', '/project/bmm',
  '/contact', '/faq', '/status', '/polls', '/myo', '/charity', '/settings', '/legal/privacy',
  '/auth', '/dashboard', '/profile', '/admin', '/giveaways', '/notfound-probe',
].join(','));
const WIDTHS = list(args.widths, '375,768,1280').map(Number);
const TOP = Number(args.top || 30);
const ONLY = args.only ? new Set(list(args.only, '')) : null;
const MAX_STEPS = Number(args['max-steps'] || 12);

const CHROMES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].filter(Boolean);

let puppeteer;
try { puppeteer = (await import('puppeteer-core')).default; } catch {
  console.error('audit-ux: puppeteer-core is not installed anywhere above this folder.\n  npm i -D puppeteer-core');
  process.exit(2);
}
const executablePath = CHROMES.find((p) => existsSync(p));
if (!executablePath) { console.error('audit-ux: no Chromium found; set CHROME_PATH.'); process.exit(2); }

// ---------------------------------------------------------------- in-page audit
// One function, serialized into the page. It returns a flat list of defect records so the
// driver can group them by component path rather than by page: one shared component repeated
// on twenty pages is ONE fix, and a table that lists it twenty times hides that.
function auditPage(width) {
  const vw = innerWidth, vh = innerHeight;
  const out = [];
  const INTERACTIVE = 'a[href],button,input,select,textarea,summary,[role="button"],[role="link"],[role="tab"],[role="switch"],[role="checkbox"],[role="menuitem"],[role="option"],[contenteditable="true"],[tabindex]';
  // The ActionBar renders a hidden aria-hidden measuring COPY of every button. Measuring it
  // doubles every count and points at an element no reader can touch.
  const HIDDEN = '[aria-hidden="true"],.sr-only,[hidden],template';

  const vis = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return null;
    if (el.closest(HIDDEN)) return null;
    // A CLOSED <details> is the trap that cost the most here. Chrome renders its contents
    // with `content-visibility: hidden`, which keeps the element's LAST size in
    // getBoundingClientRect and its display as `block` - so it reads as a visible 325x32 link
    // - while making it unfocusable. /legal/privacy alone produced 31 "focus() did not take"
    // and 29 undersized targets for links nobody can see. checkVisibility() knows the
    // difference; the closest() is the belt to its braces.
    if (el.closest('details:not([open])') && !el.matches('summary,summary *')) return null;
    if (el.checkVisibility && !el.checkVisibility({ contentVisibilityAuto: true, opacityProperty: true, visibilityProperty: true })) return null;
    const r = el.getBoundingClientRect();
    if (r.width < 1 && r.height < 1) return null;
    return { cs, r };
  };
  const pathOf = (el) => {
    const p = [];
    for (let a = el; a && a !== document.body && p.length < 4; a = a.parentElement) {
      const cls = [...a.classList].filter((c) => !/[[\]:/()]/.test(c)).slice(0, 2).join('.');
      p.unshift(a.tagName.toLowerCase() + (cls ? '.' + cls : ''));
    }
    return p.join(' > ');
  };
  const label = (el) => (el.getAttribute('aria-label') || el.textContent || el.getAttribute('title') || el.getAttribute('placeholder') || '').replace(/\s+/g, ' ').trim().slice(0, 44);
  const add = (kind, el, detail, extra) => out.push({ kind, sel: pathOf(el), text: label(el), detail, ...extra });

  // ---- overflow ------------------------------------------------------------
  const de = document.documentElement;
  if (de.scrollWidth > de.clientWidth + 1) {
    out.push({ kind: 'overflow', sel: 'document', text: '', detail: `scrollWidth ${de.scrollWidth} > clientWidth ${de.clientWidth}`, doc: 1 });
  }
  for (const el of document.querySelectorAll('body *')) {
    const v = vis(el); if (!v) continue;
    if (v.cs.position === 'fixed') continue;           // a drawer parked off-canvas is not overflow
    const r = v.r;
    if (r.width <= vw + 1 && r.right <= vw + 1 && r.left >= -1) continue;
    // Clipped or scrolled by an ancestor that itself fits? Then the strip IS the design.
    let excused = false;
    for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
      const cs = getComputedStyle(a), ar = a.getBoundingClientRect();
      const ox = cs.overflowX;
      if ((ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') && ar.right <= vw + 1 && ar.left >= -1) { excused = true; break; }
    }
    if (excused) continue;
    add('overflow', el, `${Math.round(r.width)}px wide, right edge ${Math.round(r.right)} of ${vw}`, { over: Math.round(Math.max(r.right - vw, -r.left)) });
  }

  // ---- touch targets -------------------------------------------------------
  // Threshold by input device, not by dogma. A finger needs 44x44 (WCAG 2.5.5 AAA, and the
  // Apple/Material number); a mouse pointer needs 24x24 (WCAG 2.5.8 AA). Holding a 1280px
  // desktop to the phone number would bury the real phone defects under hundreds of rows
  // about toolbar icons that nobody has ever missed with a cursor.
  const MIN = width < 1024 ? 44 : 24;
  const seenTarget = new Set();
  for (const el of document.querySelectorAll(INTERACTIVE)) {
    if (seenTarget.has(el)) continue; seenTarget.add(el);
    if (el.disabled) continue;
    if (el.matches('[tabindex]') && Number(el.getAttribute('tabindex')) < 0 && !el.matches('a[href],button,input,select,textarea,summary')) continue;
    if (el.matches('input[type="hidden"]')) continue;
    const v = vis(el); if (!v) continue;
    const r = v.r;
    // <a> wrapping a <button> (or a label wrapping its input) is ONE target, not two. Count
    // the outermost and drop the inner box when it fills its parent: otherwise every wrapped
    // CTA in the codebase is reported twice and the totals cannot be compared to anything.
    let wrapped = false;
    for (let a = el.parentElement, d = 0; a && d < 2; a = a.parentElement, d += 1) {
      if (!a.matches || !a.matches(INTERACTIVE)) continue;
      const ar = a.getBoundingClientRect();
      if (Math.abs(ar.width - r.width) <= 2 && Math.abs(ar.height - r.height) <= 2) { wrapped = true; break; }
    }
    if (wrapped) continue;
    let w = Math.round(r.width), h = Math.round(r.height);
    if (w >= MIN && h >= MIN) continue;
    // A control whose LOOK is fixed - a 40x24 toggle pill, a dense filter chip - is made
    // reachable by an absolutely positioned, transparent ::after larger than the visual box.
    // The finger hits that, so it is the target, and measuring only the border box would
    // report a defect that was already answered. Only a pseudo-element that actually takes
    // pointer events counts.
    for (const pe of ['::after', '::before']) {
      const ps = getComputedStyle(el, pe);
      if (!ps || ps.content === 'none' || ps.pointerEvents === 'none') continue;
      if (ps.position !== 'absolute' && ps.position !== 'fixed') continue;
      const pw = parseFloat(ps.width), ph = parseFloat(ps.height);
      if (pw > w) w = Math.round(pw);
      if (ph > h) h = Math.round(ph);
    }
    if (w >= MIN && h >= MIN) continue;
    // An inline link inside a sentence is exempt (WCAG 2.5.8); growing it breaks the line box.
    // WCAG 2.5.8 exempts a link "in a sentence": growing it would break the line box, and
    // the sentence around it is the thing you aim at. The test is the actual condition, not
    // a list of tags - the parent must hold real text OUTSIDE this link. Matching on
    // `closest('p,li,...')` missed "Read more in the <a>Cookie Policy</a> and ..." on
    // /settings, which is inside a plain div and is as inline as a link gets.
    const par = el.parentElement;
    const around = par ? par.textContent.replace(el.textContent, '').trim() : '';
    const inline = v.cs.display.startsWith('inline') && el.matches('a[href]') && around.length > 1;
    add(inline ? 'target-inline' : 'target', el, `${w}x${h} (min ${MIN})`, { w, h, small: Math.min(w, h) });
  }

  // ---- tiny text, and line measure ----------------------------------------
  const cv = document.createElement('canvas');
  const cx2 = cv.getContext('2d');
  const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const textEls = new Map();
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    const s = n.nodeValue && n.nodeValue.trim();
    if (!s) continue;
    const el = n.parentElement;
    if (!el || el.closest(HIDDEN) || el.closest('script,style,noscript,svg')) continue;
    textEls.set(el, (textEls.get(el) || '') + ' ' + s);
  }
  for (const [el, txt] of textEls) {
    const v = vis(el); if (!v) continue;
    const size = parseFloat(v.cs.fontSize);
    if (size < 12) add('tiny', el, `${size}px`, { size });
    if (width >= 1280) {
      const clean = txt.replace(/\s+/g, ' ').trim();
      if (clean.length < 160) continue;
      if (v.cs.display.startsWith('inline')) continue;
      cx2.font = `${v.cs.fontStyle} ${v.cs.fontWeight} ${v.cs.fontSize} ${v.cs.fontFamily}`;
      const avg = cx2.measureText('abcdefghijklmnopqrstuvwxyz ABCDEFGHIJ').width / 37;
      if (!avg) continue;
      const inner = v.r.width - parseFloat(v.cs.paddingLeft) - parseFloat(v.cs.paddingRight);
      const cpl = Math.round(inner / avg);
      if (cpl > 90) add('measure', el, `${cpl} chars/line over ${Math.round(inner)}px`, { cpl });
    }
  }

  // ---- focus: reachability, then the ring ---------------------------------
  // Reachability first, because it needs no focus at all: a div with role="button" and no
  // tabindex is invisible to the keyboard however pretty its ring would have been.
  for (const el of document.querySelectorAll('[role="button"],[role="link"],[role="switch"],[role="checkbox"],[role="tab"],[role="menuitem"],[role="option"]')) {
    const v = vis(el); if (!v) continue;
    if (el.matches('a[href],button,input,select,textarea,summary,[tabindex]')) continue;
    add('focus-unreachable', el, `role=${el.getAttribute('role')} on <${el.tagName.toLowerCase()}> with no tabindex`);
  }
  // Positive tabindex reorders the whole page's tab sequence; it is a trap by construction.
  for (const el of document.querySelectorAll('[tabindex]')) {
    const ti = Number(el.getAttribute('tabindex'));
    if (ti > 0 && vis(el)) add('focus-order', el, `tabindex=${ti} rewrites the page tab order`);
  }
  const ring = (cs) => `${cs.outlineStyle}|${cs.outlineWidth}|${cs.outlineColor}|${cs.boxShadow}|${cs.borderColor}|${cs.backgroundColor}`;
  const focusable = [...document.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex^="-"])')]
    .filter((el) => vis(el));
  const prev = document.activeElement;
  let checked = 0;
  for (const el of focusable) {
    if (checked >= 160) break;                          // enough to characterise; the rest repeat
    // Read the RESTING style with nothing focused. The driver presses Tab to establish
    // keyboard modality, which lands on the skip link - so without this blur the very first
    // element is measured while already focused, its "before" IS its focus ring, and the one
    // control whose ring matters most is reported as having none. (Measured: 62 false hits.)
    if (document.activeElement === el) el.blur();
    const before = ring(getComputedStyle(el));
    try { el.focus({ preventScroll: true }); } catch { continue; }
    if (document.activeElement !== el) { add('focus-unreachable', el, 'focus() did not take'); continue; }
    checked += 1;
    const after = ring(getComputedStyle(el));
    const visible = el.matches(':focus-visible');
    if (!visible) continue;                             // no :focus-visible => modality problem, not a style bug
    if (before === after) add('focus-ring', el, 'no visual change on :focus-visible');
  }
  try { prev && prev.focus && prev.focus({ preventScroll: true }); } catch { /* fine */ }

  // ---- reserved boxes ------------------------------------------------------
  for (const el of document.querySelectorAll('img,iframe,canvas,video')) {
    const v = vis(el); if (!v) continue;
    const cs = v.cs;
    // "computed height is a number" proves nothing: a loaded <img> reports its INTRINSIC
    // height there, which is exactly the size nobody reserved. Only an AUTHORED box counts:
    // the width+height attributes, a CSS aspect-ratio, an inline height, a Tailwind h-*/
    // aspect-* utility, or an absolutely-filled box (inset-0 inside a sized parent).
    const attrs = !!(el.getAttribute('width') && el.getAttribute('height'));
    const ratio = !!cs.aspectRatio && cs.aspectRatio !== 'auto';
    const inlineH = !!el.style.height && el.style.height !== 'auto';
    const util = /(^|\s)(h-|aspect-|inset-0|object-cover)/.test(el.className || '');
    const filled = cs.position === 'absolute' && cs.top !== 'auto' && cs.bottom !== 'auto';
    if (attrs || ratio || inlineH || util || filled) continue;
    add('shift', el, `<${el.tagName.toLowerCase()}> no width/height attrs, no aspect-ratio, no authored height`, { src: (el.currentSrc || el.src || '').slice(-60) });
  }

  // ---- in-page anchors under the sticky header ----------------------------
  // The header stops flagging as "occlusion" once that check is scoped to scroll 0, but the
  // defect it used to catch is real and has a cause you can measure: jumping to #section
  // scrolls it to y=0, which is BEHIND the sticky header unless the target reserves
  // scroll-margin-top. So measure the header once and compare.
  let headerH = 0;
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.position !== 'sticky' && cs.position !== 'fixed') continue;
    const r = el.getBoundingClientRect();
    if (r.top <= 2 && r.width >= vw * 0.6 && r.height > 8 && r.height < vh * 0.4) headerH = Math.max(headerH, r.bottom);
  }
  if (headerH > 8) {
    const ids = new Set();
    for (const a of document.querySelectorAll('a[href^="#"]')) {
      const id = a.getAttribute('href').slice(1);
      if (id) ids.add(id);
    }
    for (const id of ids) {
      const t = document.getElementById(id);
      if (!t) continue;
      const v = vis(t); if (!v) continue;
      const smt = parseFloat(getComputedStyle(t).scrollMarginTop) || 0;
      if (smt < headerH - 4) add('anchor', t, `scroll-margin-top ${Math.round(smt)}px under a ${Math.round(headerH)}px header`, { gap: Math.round(headerH - smt) });
    }
  }

  // ---- headings and landmarks ---------------------------------------------
  const hs = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter((el) => vis(el));
  const h1 = hs.filter((el) => el.tagName === 'H1');
  if (!h1.length) out.push({ kind: 'heading', sel: 'document', text: '', detail: 'no visible h1' });
  else if (h1.length > 1) out.push({ kind: 'heading', sel: 'document', text: h1.map((e) => label(e)).slice(0, 3).join(' | '), detail: `${h1.length} h1 on the page` });
  let last = 0;
  for (const el of hs) {
    const lvl = Number(el.tagName[1]);
    if (last && lvl > last + 1) add('heading', el, `h${lvl} straight after h${last}`);
    last = lvl;
  }
  const mains = [...document.querySelectorAll('main,[role="main"]')].filter((el) => vis(el));
  if (mains.length !== 1) out.push({ kind: 'landmark', sel: 'document', text: '', detail: `${mains.length} <main>` });
  const navs = [...document.querySelectorAll('nav,[role="navigation"]')].filter((el) => vis(el));
  if (!navs.length) out.push({ kind: 'landmark', sel: 'document', text: '', detail: 'no <nav>' });

  return { out, vw, vh, docH: de.scrollHeight };
}

// Content hidden UNDER a fixed bar.
//
// `want` matters, and getting it wrong makes the check meaningless. Content sliding under a
// STICKY HEADER while you scroll is what sticky means - flagging it reports the feature. The
// defect is content that is under a bar and STAYS there:
//   header    measured at scroll 0: the page begins underneath its own topbar
//   bottombar measured at the bottom of the page: the last rows sit under the mobile bar and
//             no further scroll can free them
function auditOcclusion(want) {
  const vw = innerWidth, vh = innerHeight;
  const bars = [];
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.position !== 'fixed' && cs.position !== 'sticky') continue;
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
    const r = el.getBoundingClientRect();
    if (r.width < vw * 0.6 || r.height < 8 || r.height > vh * 0.5) continue;
    if (r.top <= 2 && want === 'header') bars.push({ el, kind: 'header', r });
    else if (r.bottom >= vh - 2 && cs.position === 'fixed' && want === 'bottombar') bars.push({ el, kind: 'bottombar', r });
  }
  if (!bars.length) return [];
  const hits = [];
  const seen = new Set();
  const cand = document.querySelectorAll('a[href],button,input,select,textarea,h1,h2,h3,p,li,label,[role="button"]');
  for (const el of cand) {
    if (el.closest('[aria-hidden="true"],.sr-only,[hidden]')) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    if (cs.position === 'fixed' || cs.position === 'sticky') continue;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4 || r.bottom < 0 || r.top > vh) continue;
    for (const b of bars) {
      if (b.el.contains(el)) continue;
      if (r.bottom <= b.r.top || r.top >= b.r.bottom) continue;
      // Overlap is not proof: the bar may be behind. Ask the compositor.
      const x = Math.min(Math.max(r.left + r.width / 2, 1), vw - 1);
      const y = Math.min(Math.max(r.top + r.height / 2, 1), vh - 1);
      const top = document.elementFromPoint(x, y);
      if (!top) continue;
      if (top === el || el.contains(top) || top.contains(el)) continue;
      if (!b.el.contains(top) && top !== b.el) continue;
      const p = [];
      for (let a = el; a && a !== document.body && p.length < 4; a = a.parentElement) {
        const cls = [...a.classList].filter((c) => !/[[\]:/()]/.test(c)).slice(0, 2).join('.');
        p.unshift(a.tagName.toLowerCase() + (cls ? '.' + cls : ''));
      }
      const key = p.join(' > ') + '|' + b.kind;
      if (seen.has(key)) break;
      seen.add(key);
      hits.push({ kind: 'occluded', sel: p.join(' > '), text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 44), detail: `hidden under the ${b.kind}` });
      break;
    }
  }
  return hits;
}

// ---------------------------------------------------------------- modal probe
// Only triggers listed here are clicked. Clicking "whatever looks like a button" on a dev
// build talks to the owner's real database; a probe that mutates data is not a probe.
const MODAL_TRIGGERS = [
  { path: '/', key: 'Control+k', name: 'command palette (Ctrl+K)', dialog: '[role="dialog"],.cmdk,[data-palette]' },
  { path: '/settings', text: null, key: 'Control+k', name: 'command palette on /settings', dialog: '[role="dialog"],.cmdk,[data-palette]' },
];

async function probeModals(page, base) {
  const rows = [];
  for (const trig of MODAL_TRIGGERS) {
    try {
      await page.goto(base + trig.path, { waitUntil: 'load', timeout: 30000 });
      await new Promise((r) => setTimeout(r, 1500));
      const beforeFocus = await page.evaluate(() => document.activeElement ? document.activeElement.tagName + '#' + (document.activeElement.id || '') : 'none');
      await page.keyboard.down('Control'); await page.keyboard.press('k'); await page.keyboard.up('Control');
      await new Promise((r) => setTimeout(r, 600));
      const st = await page.evaluate((sel) => {
        const d = document.querySelector(sel);
        if (!d) return null;
        const a = document.activeElement;
        return {
          open: true,
          focusInside: !!(a && (d === a || d.contains(a))),
          bodyLocked: getComputedStyle(document.body).overflow === 'hidden' || document.body.style.overflow === 'hidden',
        };
      }, trig.dialog);
      if (!st) { rows.push({ name: trig.name, opened: false }); continue; }
      await page.keyboard.press('Escape');
      await new Promise((r) => setTimeout(r, 500));
      const after = await page.evaluate((sel) => ({
        closed: !document.querySelector(sel),
        focus: document.activeElement ? document.activeElement.tagName + '#' + (document.activeElement.id || '') : 'none',
        bodyFree: (document.body.style.overflow || '') !== 'hidden',
      }), trig.dialog);
      rows.push({ name: trig.name, opened: true, focusInside: st.focusInside, bodyLocked: st.bodyLocked, escapeCloses: after.closed, focusRestored: after.focus === beforeFocus, bodyFreed: after.bodyFree });
    } catch (e) {
      rows.push({ name: trig.name, error: String(e.message || e).slice(0, 90) });
    }
  }
  return rows;
}

// ---------------------------------------------------------------- driver
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const launch = () => puppeteer.launch({
  executablePath, headless: true,
  args: ['--hide-scrollbars', '--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--force-color-profile=srgb'],
});

const all = [];
const summary = [];
const lost = [];
const jobs = WIDTHS.map((width) => ({ width }));
const JOBS = Number(args.jobs || Math.min(3, jobs.length));

async function run(browser, { width }) {
  const page = await browser.newPage();
  await page.setViewport({ width, height: width < 768 ? 812 : 900, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument(() => {
    try {
      localStorage.setItem('bcw_consent', 'essential');
      localStorage.setItem('bcw_welcome_v1', '1');
      localStorage.setItem('bcweb_skip_intro', '1');
    } catch { /* storage refused */ }
  });
  for (const path of PAGES) {
    const row = { width, path, n: 0, byKind: {} };
    try {
      // `load`, not network-idle: some pages hold a live connection open and never go idle.
      // And a page that never fires `load` at all (a stalled asset, a slow API on a cold
      // route) must still be measured rather than dropped: a missing page reads as a clean
      // page in the totals, which is the one failure mode a report must not have.
      try {
        await page.goto(BASE + path, { waitUntil: 'load', timeout: 25000 });
      } catch {
        await page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 25000 });
        row.slowLoad = true;
      }
      await sleep(1800);
      // Sections reveal on scroll (opacity 0 until seen). Walk down once so everything mounts,
      // then come back to the top and measure.
      const H = await page.evaluate(() => document.documentElement.scrollHeight);
      for (let y = 0, s = 0; s < MAX_STEPS && y < H; s += 1, y += Math.floor((width < 768 ? 812 : 900) * 0.8)) {
        await page.evaluate((yy) => window.scrollTo(0, yy), y);
        await sleep(120);
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      await sleep(600);
      // Keyboard modality, or Chrome never matches :focus-visible and every ring reads as fine.
      await page.keyboard.press('Tab');
      await sleep(80);
      // Focus rings are almost always transitioned. getComputedStyle right after focus()
      // returns the value at t=0, which is still the RESTING one, so every transitioned ring
      // reads as "no visual change". Kill transitions for the measurement only.
      await page.addStyleTag({ content: '*,*::before,*::after{transition:none!important}' });
      const res = await page.evaluate(auditPage, width);
      let defects = res.out;
      // Occlusion at the top of the page (sticky header) and at the bottom (the mobile bar).
      const occ = await page.evaluate(auditOcclusion, 'header');
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await sleep(500);
      const occ2 = await page.evaluate(auditOcclusion, 'bottombar');
      const seen = new Set();
      for (const o of [...occ, ...occ2]) { const k = o.sel + o.detail; if (!seen.has(k)) { seen.add(k); defects.push(o); } }
      if (ONLY) defects = defects.filter((d) => ONLY.has(d.kind) || ONLY.has(d.kind.split('-')[0]));
      for (const d of defects) {
        row.n += 1;
        row.byKind[d.kind] = (row.byKind[d.kind] || 0) + 1;
        all.push({ width, path, ...d });
      }
    } catch (e) {
      row.error = String(e.message || e).slice(0, 120);
    }
    summary.push(row);
    const kinds = Object.entries(row.byKind).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' ');
    process.stderr.write(`${String(width).padStart(4)} ${path.padEnd(18)} ${String(row.n).padStart(4)}  ${kinds}${row.error ? ' ERR ' + row.error : ''}\n`);
  }
  await page.close().catch(() => {});
}

const queue = [...jobs];
await Promise.all(Array.from({ length: Math.min(JOBS, queue.length) }, async () => {
  let browser = await launch();
  while (queue.length) {
    const job = queue.shift();
    try { await run(browser, job); } catch (e) {
      process.stderr.write(`worker lost its browser at ${job.width}: ${String(e.message || e).slice(0, 80)} - relaunching\n`);
      try { await browser.close(); } catch { /* already gone */ }
      browser = await launch();
      lost.push(String(job.width));
    }
  }
  await browser.close().catch(() => {});
}));

let modalRows = [];
if (args.modals) {
  const b = await launch();
  const p = await b.newPage();
  await p.setViewport({ width: 1280, height: 900 });
  await p.evaluateOnNewDocument(() => { try { localStorage.setItem('bcw_consent', 'essential'); localStorage.setItem('bcw_welcome_v1', '1'); localStorage.setItem('bcweb_skip_intro', '1'); } catch { /* */ } });
  modalRows = await probeModals(p, BASE);
  await b.close().catch(() => {});
}

// ---------------------------------------------------------------- report
const KINDS = ['overflow', 'target', 'target-inline', 'tiny', 'measure', 'focus-ring', 'focus-unreachable', 'focus-order', 'shift', 'anchor', 'heading', 'landmark', 'occluded'];
const pad = (s, n) => String(s).padEnd(n);
console.log('\nDefects per width (one row per viewport, summed over every page)');
console.log(pad('width', 7) + KINDS.map((k) => pad(k, k.length + 2)).join(''));
for (const w of WIDTHS) {
  const rows = summary.filter((r) => r.width === w);
  const n = (k) => rows.reduce((a, r) => a + (r.byKind[k] || 0), 0);
  console.log(pad(w, 7) + KINDS.map((k) => pad(n(k), k.length + 2)).join(''));
}

console.log('\nWorst pages');
for (const r of [...summary].sort((a, b) => b.n - a.n).slice(0, 12)) {
  console.log(`  ${String(r.width).padStart(4)} ${pad(r.path, 20)} ${String(r.n).padStart(4)}  ${Object.entries(r.byKind).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' ')}`);
}

// Grouped by component path: one component repeated is one fix.
const byPlace = new Map();
for (const d of all) {
  if (d.kind === 'target-inline') continue;
  const key = d.kind + '  ' + d.sel;
  if (!byPlace.has(key)) byPlace.set(key, { key, kind: d.kind, sel: d.sel, n: 0, pages: new Set(), widths: new Set(), text: d.text, detail: d.detail, worst: d.small ?? d.over ?? d.cpl ?? 0 });
  const g = byPlace.get(key);
  g.n += 1; g.pages.add(d.path); g.widths.add(d.width);
  if (d.small != null) g.worst = Math.min(g.worst, d.small);
  if (d.over != null) g.worst = Math.max(g.worst, d.over);
  if (d.cpl != null) g.worst = Math.max(g.worst, d.cpl);
}
console.log(`\nWorst offenders (grouped by kind + element path, top ${TOP})`);
for (const g of [...byPlace.values()].sort((a, b) => b.n - a.n).slice(0, TOP)) {
  console.log(`  ${String(g.n).padStart(4)}x  ${pad(g.kind, 18)} ${g.sel}\n         "${g.text}"  ${g.detail}  widths ${[...g.widths].join('/')}  pages ${[...g.pages].slice(0, 5).join(' ')}`);
}

const errs = summary.filter((r) => r.error);
if (errs.length) console.log(`\n${errs.length} page loads failed: ` + errs.map((r) => `${r.path}@${r.width}`).slice(0, 12).join(', '));
if (lost.length) console.log(`\n${lost.length} job(s) were cut short by a browser crash and are MISSING above: ${lost.join(', ')}`);
if (args.modals) {
  console.log('\nModals');
  for (const m of modalRows) console.log('  ' + JSON.stringify(m));
}
if (args.json) writeFileSync(args.json, JSON.stringify({ summary, defects: all, modals: modalRows }, null, 1));

// The page builder: arrange blocks, see the page, save it.
//
// Three panes, and the middle one is the real page. The canvas is `PageRender` with an `edit`
// object passed to it — the same renderer the site uses, wearing a wrapper. That is the whole
// design decision here: a builder with its own preview renderer has two renderers, and the
// one that is wrong is whichever nobody looked at last.
//
// What it is NOT: a free-form canvas with absolute coordinates. Blocks go in a tree and the
// site's own spacing scale lays them out, so a page built here matches the rest of the site
// and reflows on a phone. Pixel positions would look like more freedom and would produce a
// page that is broken at every width but the one it was built at.
import { useEffect, useRef, useState } from 'react';
import {
  Save, Trash2, Copy, ChevronUp, ChevronDown, Monitor, Smartphone, Eye, EyeOff,
  Package, Download, Upload, ExternalLink, RotateCcw, Layers, LayoutTemplate, X,
  Maximize2, PanelLeft, PanelRight, Minimize2,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { Card, Button, Input, Textarea, Field, Dropdown, Spinner, useToast, useDialog, copyText } from '../ui/ui.jsx';
import { fmtNum } from '../lib/format.js';
import { useI18n } from '../i18n.jsx';
import PageRender from '../pages/page-render.jsx';
import { setSitePages } from '../lib/site-pages.js';
import { productCards } from '../lib/home-products.js';
import { homeVariantList } from '../lib/home-variants-meta.js';
import SelectionToolbar from './selection-toolbar.jsx';
import IconPicker from './icon-picker.jsx';
import { IconGlyph } from '../ui/md.jsx';

/* ── Tree operations ─────────────────────────────────────────────────────────
   All pure, all returning a new tree. The editor holds one piece of state — the page — and
   every action is a function of it, which is what makes undo a single `useState` history and
   not a per-widget conversation. */

/** A short, unique id. Prefixed so a hand-written tree and a generated one never collide. */
const newId = () => `b${Math.random().toString(36).slice(2, 9)}`;

export function findNode(nodes, id) {
  for (const n of nodes || []) {
    if (n.id === id) return n;
    const hit = findNode(n.children, id);
    if (hit) return hit;
  }
  return null;
}

/** The tree with `id` gone, wherever it was. */
export function removeNode(nodes, id) {
  const out = [];
  for (const n of nodes || []) {
    if (n.id === id) continue;
    out.push(n.children ? { ...n, children: removeNode(n.children, id) } : n);
  }
  return out;
}

/**
 * Put `node` somewhere.
 *
 * `targetId === null` appends at the top level. A layout target takes it as a child; anything
 * else takes it as the next sibling — which is what dropping "onto" a paragraph means to the
 * person doing it.
 */
export function insertNode(nodes, targetId, node, isContainer) {
  if (targetId === null) return [...(nodes || []), node];
  const out = [];
  for (const n of nodes || []) {
    if (n.id === targetId) {
      if (isContainer(n.type)) out.push({ ...n, children: [...(n.children || []), node] });
      else { out.push(n); out.push(node); }
      continue;
    }
    out.push(n.children ? { ...n, children: insertNode(n.children, targetId, node, isContainer) } : n);
  }
  return out;
}

/** Merge props into one node, in place in the tree. */
export function patchNode(nodes, id, patch) {
  return (nodes || []).map((n) => {
    if (n.id === id) return { ...n, ...patch, props: { ...(n.props || {}), ...(patch.props || {}) } };
    return n.children ? { ...n, children: patchNode(n.children, id, patch) } : n;
  });
}

/** Move one node among its siblings. Returns the same tree when there is nowhere to go. */
export function shiftNode(nodes, id, dir) {
  const step = (list) => {
    const i = list.findIndex((n) => n.id === id);
    if (i >= 0) {
      const j = i + dir;
      if (j < 0 || j >= list.length) return list;
      const copy = [...list];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    }
    return list.map((n) => (n.children ? { ...n, children: step(n.children) } : n));
  };
  return step(nodes || []);
}

/** A copy of a subtree with fresh ids, so a duplicate is not two blocks that move together. */
export function reid(node) {
  return { ...node, id: newId(), ...(node.children ? { children: node.children.map(reid) } : {}) };
}

/** Is `maybeChild` inside `id`? Dropping a node into itself would detach the whole subtree. */
export function contains(nodes, id, maybeChild) {
  const n = findNode(nodes, id);
  return !!n && !!findNode(n.children, maybeChild);
}

/* ── Property forms ──────────────────────────────────────────────────────────
   One descriptor per block type. A form built from a list is a form that gains a field when
   the palette does, instead of a form somebody has to remember to extend. */
const SELECT = (options) => ({ kind: 'select', options });
/**
 * The field labels, as literal t() calls.
 *
 * Built here rather than stored beside each field, because a label written as `t(row[1])`
 * is invisible to i18n-check: it scans the source for literal keys, so a dynamic one
 * passes the gate and falls back to English on a French screen — silently, which is the
 * exact failure the gate exists to catch.
 */
const LABELS = (t) => ({
    accent: t('pb.f.accent', 'Accent colour'),
    align: t('pb.f.align', 'Align'),
    alttext: t('pb.f.alttext', 'Alt text'),
    background: t('pb.f.background', 'Background'),
    columns: t('pb.f.columns', 'Columns'),
    content: t('pb.f.content', 'Content'),
    cornerradius: t('pb.f.cornerradius', 'Corner radius'),
    fit: t('pb.f.fit', 'Fit'),
    fixedheight: t('pb.f.fixedheight', 'Fixed height (0 = auto)'),
    fullwidth: t('pb.f.fullwidth', 'Full width'),
    gap: t('pb.f.gap', 'Gap'),
    gradient: t('pb.f.gradient', 'Gradient'),
    height: t('pb.f.height', 'Height'),
    howmany: t('pb.f.howmany', 'How many'),
    icon: t('pb.f.icon', 'Icon'),
    imageurl: t('pb.f.imageurl', 'Image URL'),
    label: t('pb.f.label', 'Label'),
    mediacolour: t('pb.f.mediacolour', 'Strip colour'),
    mediastrip: t('pb.f.mediastrip', 'Media strip'),
    mincardwidth: t('pb.f.mincardwidth', 'Narrowest card'),
    level: t('pb.f.level', 'Level'),
    link: t('pb.f.link', 'Link'),
    number: t('pb.f.number', 'Number'),
    padding: t('pb.f.padding', 'Padding'),
    showheading: t('pb.f.showheading', 'Show the heading'),
    size: t('pb.f.size', 'Size'),
    spacing: t('pb.f.spacing', 'Spacing'),
    style: t('pb.f.style', 'Style'),
    text: t('pb.f.text', 'Text'),
    title: t('pb.f.title', 'Title'),
    width: t('pb.f.width', 'Width'),
    widthshare: t('pb.f.widthshare', 'Width share'),
    wrap: t('pb.f.wrap', 'Wrap'),
});

const FIELDS = {
  section: [
    ['pad', 'padding', SELECT(['none', 'sm', 'md', 'lg'])],
    ['maxw', 'width', SELECT(['wide', 'narrow', 'prose'])],
    ['bg', 'background', SELECT(['none', 'surface', 'surface2'])],
    ['radius', 'cornerradius', { kind: 'number', min: 0, max: 40 }],
    ['full', 'fullwidth', { kind: 'bool' }],
  ],
  row: [
    ['cols', 'columns', SELECT(['auto', '1', '2', '3', '4', '5', '6'])],
    ['gap', 'gap', SELECT(['none', 'sm', 'md', 'lg'])],
    ['align', 'align', SELECT(['stretch', 'start', 'center', 'end'])],
    ['wrap', 'wrap', { kind: 'bool' }],
  ],
  col: [
    ['span', 'widthshare', { kind: 'number', min: 1, max: 6 }],
    ['align', 'align', SELECT(['start', 'center', 'end', 'stretch'])],
  ],
  cards: [
    ['cols', 'columns', SELECT(['auto', '1', '2', '3', '4', '5', '6'])],
    ['min', 'mincardwidth', { kind: 'number', min: 140, max: 480 }],
    ['gap', 'gap', SELECT(['none', 'sm', 'md', 'lg'])],
  ],
  card: [
    ['title', 'title', { kind: 'text' }],
    ['href', 'link', { kind: 'text' }],
    ['icon', 'icon', { kind: 'icon' }],
    ['media', 'mediastrip', SELECT(['none', 'short', 'tall'])],
    ['image', 'imageurl', { kind: 'text' }],
    ['bg', 'mediacolour', { kind: 'colour' }],
    ['accent', 'accent', { kind: 'colour' }],
    ['align', 'align', SELECT(['left', 'center', 'right'])],
  ],
  heading: [
    ['text', 'text', { kind: 'text' }],
    ['level', 'level', SELECT(['1', '2', '3', '4'])],
    ['align', 'align', SELECT(['left', 'center', 'right'])],
    ['gradient', 'gradient', { kind: 'bool' }],
  ],
  text: [
    ['md', 'content', { kind: 'markdown' }],
    ['align', 'align', SELECT(['left', 'center', 'right'])],
    ['width', 'width', SELECT(['prose', 'full'])],
  ],
  button: [
    ['label', 'label', { kind: 'text' }],
    ['href', 'link', { kind: 'text' }],
    ['style', 'style', SELECT(['primary', 'outline'])],
    ['size', 'size', SELECT(['sm', 'md', 'lg'])],
    ['icon', 'icon', { kind: 'icon' }],
  ],
  image: [
    ['src', 'imageurl', { kind: 'text' }],
    ['alt', 'alttext', { kind: 'text' }],
    ['radius', 'cornerradius', { kind: 'number', min: 0, max: 40 }],
    ['fit', 'fit', SELECT(['cover', 'contain'])],
    ['height', 'fixedheight', { kind: 'number', min: 0, max: 900 }],
  ],
  spacer: [['size', 'height', { kind: 'number', min: 0, max: 400 }]],
  divider: [
    ['style', 'style', SELECT(['line', 'dashed', 'dots', 'gradient', 'space'])],
    ['label', 'label', { kind: 'text' }],
    ['width', 'width', SELECT(['full', 'short'])],
    ['space', 'spacing', SELECT(['none', 'sm', 'md', 'lg'])],
  ],
  stat: [
    ['variable', 'number', { kind: 'variable' }],
    ['label', 'label', { kind: 'text' }],
    ['style', 'style', SELECT(['tile', 'big', 'inline'])],
    ['icon', 'icon', { kind: 'icon' }],
  ],
  news: [
    ['style', 'style', SELECT(['grid', 'feed', 'list'])],
    ['limit', 'howmany', { kind: 'number', min: 1, max: 12 }],
    ['heading', 'showheading', { kind: 'bool' }],
  ],
  products: [['style', 'style', SELECT(['rows', 'cards'])]],
  status: [['style', 'style', SELECT(['banner', 'services', 'both'])]],
  reviews: [
    ['style', 'style', SELECT(['cards', 'quotes'])],
    ['limit', 'howmany', { kind: 'number', min: 1, max: 9 }],
  ],
  myo: [['limit', 'howmany', { kind: 'number', min: 1, max: 9 }]],
};

/* ── Starting points ─────────────────────────────────────────────────────────
   "Show me the home page and let me edit it."

   The three landing pages are JSX, so there is nothing to import from them: a page built out
   of blocks and a page written as a component are different objects, and pretending otherwise
   would mean a builder that shows you something it cannot actually change.

   What it CAN do is rebuild each one out of the palette. Every band of the live page is
   either a dynamic block (the showcase, the products, the news — the same components the real
   page calls) or a heading and a paragraph you can now rewrite. Press the button and the
   canvas shows the page you already have; from that point every part of it is yours.
 */
const nid = () => `b${Math.random().toString(36).slice(2, 9)}`;
const B = (type, props = {}, children) => ({ id: nid(), type, props, ...(children ? { children } : {}) });

export const STARTERS = {
  // v1 — the long landing page, in the order the real one draws it: hero, poll, products,
  // why, steps, dev, myo, reviews, news. `HOME_VARIANTS.v1` on the API side is the list, and
  // scripts/check-home-starters.mjs holds this to it.
  v1: (t) => [
    B('section', { pad: 'lg', maxw: 'wide' }, [
      B('heading', { text: t('pb.start.h1', 'The home for every Better* project'), level: 1, align: 'center', gradient: true }),
      B('text', {
        md: t('pb.start.lede', 'Catalogs, presets, hosting and accounts, in one place.'),
        align: 'center', width: 'prose',
      }),
      B('row', { cols: 'auto', gap: 'md', align: 'center' }, [
        B('button', { label: t('pb.start.cta', 'Browse the catalog'), href: '/catalog', style: 'primary', size: 'lg', icon: 'box' }),
        B('button', { label: t('pb.start.cta2', 'Host a repo'), href: '/hosting', style: 'outline', size: 'lg' }),
      ]),
    ]),
    B('section', { pad: 'md' }, [
      B('row', { cols: '4', gap: 'md', align: 'center' }, [
        B('stat', { variable: 'members', label: t('pb.start.s1', 'members'), icon: 'users', style: 'tile' }),
        B('stat', { variable: 'items', label: t('pb.start.s2', 'published'), icon: 'package', style: 'tile' }),
        B('stat', { variable: 'downloads', label: t('pb.start.s3', 'downloads'), icon: 'download', style: 'tile' }),
        B('stat', { variable: 'repos', label: t('pb.start.s4', 'repositories'), icon: 'server', style: 'tile' }),
      ]),
    ]),
    // First, as on the real page: it is the one block that answers a question the reader
    // already has when they arrive during an incident, and it draws nothing otherwise.
    B('section', { pad: 'sm' }, [B('status', {})]),
    B('section', { pad: 'md' }, [B('poll', {})]),
    B('section', { pad: 'md' }, [
      B('heading', { text: t('pb.start.products', 'The apps'), level: 2 }),
      B('products', { style: 'cards' }),
    ]),
    B('divider', { style: 'gradient', space: 'lg' }),
    // "Why" — four cards, with the wording the real section uses. Written out as blocks
    // because that is what it is on the real page too: content, not a component.
    B('section', { pad: 'md' }, [
      B('heading', { text: t('home.k.why', 'Why BetterCommunity'), level: 2 }),
      B('cards', { cols: 'auto', gap: 'md', min: 240 }, [
        B('card', { title: t('home.feat.accounts'), icon: 'layout-dashboard' }, [
          B('text', { md: t('home.feat.accounts.d') }),
        ]),
        B('card', { title: t('home.feat.hosting'), icon: 'zap' }, [
          B('text', { md: t('home.feat.hosting.d') }),
        ]),
        B('card', { title: t('home.feat.install', 'One-click install'), icon: 'link' }, [
          B('text', { md: t('home.feat.install.d', 'Catalog entries install straight into BMM through bmm:// deeplinks — no manual downloads.') }),
        ]),
        B('card', { title: t('home.feat.privacy', 'Privacy-first'), icon: 'lock' }, [
          B('text', { md: t('home.feat.privacy.d', 'No third-party trackers — anonymous first-party analytics, and only with your consent.') }),
        ]),
      ]),
    ]),
    // "How it works" — the three steps, each a card with its own link, as on the real page.
    B('section', { pad: 'md' }, [
      B('heading', { text: t('home.steps.title'), level: 2 }),
      B('text', { md: t('home.steps.sub'), width: 'prose' }),
      B('cards', { cols: '3', gap: 'md', min: 220 }, [
        B('card', { title: t('home.step1'), icon: 'users', href: '/auth' }, [B('text', { md: t('home.step1.d') })]),
        B('card', { title: t('home.step2'), icon: 'box', href: '/catalog' }, [B('text', { md: t('home.step2.d') })]),
        B('card', { title: t('home.step3'), icon: 'server', href: '/hosting' }, [B('text', { md: t('home.step3.d') })]),
      ]),
    ]),
    B('section', { pad: 'md' }, [
      B('heading', { text: t('home.dev.t', 'Build on BetterCommunity'), level: 2 }),
      B('text', { md: t('home.dev.d'), width: 'prose' }),
      B('devtools', {}),
    ]),
    B('section', { pad: 'md' }, [B('myo', { limit: 3 })]),
    B('section', { pad: 'md' }, [B('reviews', { style: 'quotes', limit: 3 })]),
    B('section', { pad: 'md' }, [B('news', { style: 'grid', limit: 3 })]),
  ],
  v2: (t) => [
    B('section', { pad: 'sm' }, [B('status', {})]),
    B('section', { pad: 'md' }, [
      B('row', { cols: '2', gap: 'lg', align: 'center' }, [
        B('col', { span: 1 }, [
          B('heading', { text: t('pb.start.h1', 'The home for every Better* project'), level: 1, gradient: true }),
          B('text', { md: t('pb.start.lede2', 'Pick the one you came for.'), width: 'prose' }),
          B('products', { style: 'rows' }),
        ]),
        B('col', { span: 1 }, [B('showcase', {})]),
      ]),
    ]),
    B('section', { pad: 'md' }, [B('news', { style: 'grid', limit: 3 })]),
  ],
  v3: (t) => [
    B('section', { pad: 'sm' }, [B('status', {})]),
    B('section', { pad: 'sm' }, [
      B('heading', { text: t('pb.start.h3', 'What\u2019s happening'), level: 1 }),
    ]),
    B('section', { pad: 'sm' }, [
      B('row', { cols: '3', gap: 'md', align: 'start' }, [
        B('col', { span: 2 }, [B('news', { style: 'feed', limit: 6, heading: false })]),
        B('col', { span: 1 }, [B('poll', {}), B('reviews', { style: 'cards', limit: 3 }), B('myo', { limit: 3 })]),
      ]),
    ]),
  ],
  dev: (t) => [
    B('section', { pad: 'lg', maxw: 'narrow' }, [
      B('heading', { text: t('pb.start.dev', 'Build on BetterCommunity'), level: 1, align: 'center', gradient: true }),
      B('text', { md: t('pb.start.devlede', 'An API, webhooks, deeplinks and an OpenID provider.'), align: 'center', width: 'prose' }),
    ]),
    B('section', { pad: 'md' }, [B('devtools', {})]),
    B('divider', { style: 'dots', space: 'lg' }),
    B('section', { pad: 'md' }, [B('news', { style: 'list', limit: 5 })]),
  ],
};

/* ── The editor ──────────────────────────────────────────────────────────── */

export default function PageBuilder() {
  const { t } = useI18n();
  const toast = useToast();
  const dialog = useDialog();
  const [cfg, setCfg] = useState(null);
  const [pageKey, setPageKey] = useState('home');
  const [which, setWhich] = useState('desktop');
  const [sel, setSel] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  // Whether the side panels are folded away. Remembered per browser: arranging a page is
  // minutes of work in one mode, and re-choosing on every visit is the small tax that makes
  // a tool feel unfinished. Wrapped because localStorage THROWS outright in some private
  // windows — not returns null — and an editor that fails to mount over a layout preference
  // would be a poor trade.
  // The width the preview is rendered AT, in real pixels. `0` means "fill the column", which
  // is the old behaviour and is right while arranging blocks; a number is a screen size being
  // judged.
  const [previewW, setPreviewW] = useState(0);
  const canvasRef = useRef(null);
  const [canvasW, setCanvasW] = useState(0);
  // Measured, because the scale is a ratio of two widths and one of them changes with the
  // window, the panels folding, and the dashboard's own sidebar.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([e]) => setCanvasW(e.contentRect.width));
    ro.observe(el);
    setCanvasW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // How much the frame is shrunk to fit. Never above 1: a 390-wide phone frame blown up to
  // fill a desktop column would be a lie in the other direction.
  const frameRef = useRef(null);
  const [frameH, setFrameH] = useState(0);
  const scale = previewW && canvasW ? Math.min(1, (canvasW - 32) / previewW) : 1;
  // Two panels, folded independently.
  //
  // One flag used to fold BOTH, so the choice was a canvas 480px narrower than the page it is
  // a copy of, or no palette and no properties at all. What somebody wants is the palette away
  // while adjusting one block's settings, and the properties away while dragging blocks in.
  const [showPalette, setShowPalette] = useState(() => {
    try { return localStorage.getItem('bcw.pb.palette') !== '0'; } catch { return true; }
  });
  const [showProps, setShowProps] = useState(() => {
    try { return localStorage.getItem('bcw.pb.props') !== '0'; } catch { return true; }
  });
  useEffect(() => {
    try {
      localStorage.setItem('bcw.pb.palette', showPalette ? '1' : '0');
      localStorage.setItem('bcw.pb.props', showProps ? '1' : '0');
    } catch { /* not remembered */ }
  }, [showPalette, showProps]);
  // "Full width" still means what it said: both away. It is now a shortcut for the two
  // switches rather than a third state that overrides them.
  const wide = !showPalette && !showProps;
  const setWide = (fn) => {
    const next = typeof fn === 'function' ? fn(wide) : fn;
    setShowPalette(!next);
    setShowProps(!next);
  };
  // Live data for the dynamic blocks, so the preview shows the real news and the real
  // numbers rather than placeholders — a builder that previews something other than the page
  // is asking you to imagine it.
  const [live, setLive] = useState({ stats: {}, posts: [], showcase: null, pollData: null, reviewsData: null, myo: null, projects: null });
  // Which landing page the site currently opens with. Three presets and no indication of
  // which one you are actually looking at when you visit the site is a choice made blind:
  // the reason to start from a layout is almost always "the one that is live".
  const [liveVariant, setLiveVariant] = useState(null);
  const drag = useRef(null);
  // Undo, as a stack of whole trees. They are small and they are already immutable, so a
  // history is a list of the states we happened to be in — no diffs, no reverse operations,
  // nothing to get wrong.
  const history = useRef([]);

  useEffect(() => {
    let on = true;
    api.get('/admin/site/pages').then((d) => { if (on) setCfg(d); }).catch((e) => { if (on) setErr(String(e?.message || e)); });
    Promise.all([
      api.get('/stats').catch(() => ({})),
      api.get('/blog?home=1').catch(() => ({ posts: [] })),
      api.get('/site/showcase').catch(() => null),
      api.get('/polls?home=1').catch(() => null),
      api.get('/reviews').catch(() => null),
      api.get('/myo/products').catch(() => null),
      api.get('/projects').catch(() => null),
    ]).then(([stats, blog, showcase, pollData, reviewsData, myo, projects]) => {
      if (on) setLive({ stats: stats || {}, posts: blog?.posts || [], showcase, pollData, reviewsData, myo, projects });
    });
    // The public read, not the admin one: it is cached, it is small, and the variant is all
    // that is wanted here.
    api.get('/site/home').then((d) => { if (on) setLiveVariant(d?.variant || null); }).catch(() => {});
    return () => { on = false; };
  }, []);

  const blocks = cfg?.blocks || {};
  const isContainer = (type) => blocks[type]?.kind === 'layout';
  const page = cfg?.pages?.[pageKey];
  // `mobile: null` is inheritance. The editor has to keep saying so, because the moment it
  // silently copies the desktop tree into `mobile` the two stop tracking each other and
  // nobody is told which edit stopped applying to phones.
  const inherits = which === 'mobile' && page?.mobile == null;
  const tree = (which === 'mobile' ? (page?.mobile ?? page?.desktop) : page?.desktop) || [];

  // The unscaled height, so the negative margin below can reclaim exactly what the transform
  // stops drawing. Read after paint and after anything that changes the layout.
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    setFrameH(el.offsetHeight);
  }, [previewW, canvasW, which, tree]);

  const setPage = (patch, remember = true) => {
    setCfg((c) => {
      if (remember) history.current = [...history.current.slice(-29), c];
      return { ...c, pages: { ...c.pages, [pageKey]: { ...c.pages[pageKey], ...patch } } };
    });
  };

  /** Write a tree back to whichever layout is being edited. */
  const setTree = (next) => {
    if (which === 'mobile') setPage({ mobile: next });
    else setPage({ desktop: next });
  };

  /**
   * Fill the canvas with a rebuild of one of the live landing pages.
   *
   * Refuses over a page that already has blocks in it, because "start from" and "replace
   * everything I have built" are the same click otherwise, and one of them is unrecoverable
   * once the undo stack is 30 deep.
   */
  const startFrom = async (key) => {
    if (tree.length) {
      const ok = await dialog.confirm({
        title: t('pb.start.replaceT', 'Replace what is on this page?'),
        body: t('pb.start.replaceB', 'This page already has blocks. Starting from a layout replaces all of them.'),
        danger: true,
      });
      if (!ok) return;
    }
    const make = STARTERS[key];
    if (make) setTree(make(t));
    setSel(null);
  };

  /**
   * What "Start from:" offers on the page being edited.
   *
   * Filtered by what STARTERS can actually build, so the offer and the outcome are the same
   * list — see the comment on the cards.
   */
  const starters = (pageKey === 'home'
    ? homeVariantList(t).map((v) => ({ key: v.v, name: v.name, sub: v.sub, live: liveVariant === v.v }))
    : [{
      key: 'dev',
      name: t('pb.start.devp', 'The developer hub'),
      sub: t('pb.start.devp.s', 'The API, webhooks, deeplinks and the OpenID provider, then the latest posts.'),
    }]
  ).filter((o) => STARTERS[o.key]);

  const undo = () => {
    const prev = history.current.pop();
    if (!prev) return;
    setCfg(prev);
    setSel(null);
  };

  /* ── Actions ── */
  const add = (type, targetId = sel) => {
    const def = blocks[type];
    if (!def) return;
    const node = { id: newId(), type, props: { ...(def.props || {}) } };
    if (def.kind === 'layout') node.children = [];
    // Into the selection when it can hold children, otherwise next to it, otherwise at the
    // end. "Next to it" is what somebody who selected a paragraph and clicked Heading means.
    setTree(insertNode(tree, targetId && findNode(tree, targetId) ? targetId : null, node, isContainer));
    setSel(node.id);
  };

  const onDrop = (targetId) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.kind === 'new') return add(d.type, targetId);
    if (d.kind === 'component') {
      const nodes = (d.nodes || []).map(reid);
      let next = tree;
      for (const n of nodes) next = insertNode(next, targetId, n, isContainer);
      return setTree(next);
    }
    // Moving an existing block. Into itself or into its own subtree would detach everything
    // below it — the tree would still be valid JSON and the blocks would be gone.
    if (d.id === targetId || (targetId && contains(tree, d.id, targetId))) return;
    const node = findNode(tree, d.id);
    if (!node) return;
    setTree(insertNode(removeNode(tree, d.id), targetId, node, isContainer));
  };

  const canDrop = () => !!drag.current;

  const remove = (id) => { setTree(removeNode(tree, id)); if (sel === id) setSel(null); };
  const duplicate = (id) => {
    const n = findNode(tree, id);
    if (!n) return;
    const copy = reid(n);
    setTree(insertNode(tree, id, copy, () => false));
    setSel(copy.id);
  };

  const save = async () => {
    setBusy(true);
    try {
      const res = await api.put('/admin/site/pages', { pages: cfg.pages, components: cfg.components || [] });
      setCfg((c) => ({ ...c, ...res }));
      // The resolved copy the site reads was decided when this tab opened. Without this the
      // admin saves, opens `/`, and sees the page they just replaced.
      setSitePages(res);
      history.current = [];
      toast.success(t('pb.saved', 'Saved.'));
    } catch (e) {
      // The API says WHICH rule failed and where. Printing "failed" instead would leave
      // somebody hunting a duplicate id by eye through sixty blocks.
      const msg = e?.data?.detail ? `${e.data.error}: ${e.data.detail}` : (e?.data?.error || String(e?.message || e));
      toast.error(msg);
    } finally { setBusy(false); }
  };

  /* ── Components: a subtree with a name ── */
  const saveComponent = async () => {
    const node = sel && findNode(tree, sel);
    if (!node) return toast.error(t('pb.pickFirst', 'Select a block first.'));
    const name = await dialog.prompt({
      title: t('pb.comp.name', 'Name this component'),
      placeholder: t('pb.comp.ph', 'Hero, footer CTA, pricing row…'),
    });
    if (!name) return;
    setCfg((c) => ({ ...c, components: [...(c.components || []), { id: newId(), name, nodes: [reid(node)] }] }));
    toast.success(t('pb.comp.saved', 'Saved to your components.'));
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ page: pageKey, ...cfg.pages[pageKey] }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${pageKey}-page.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importJson = async (file) => {
    try {
      const v = JSON.parse(await file.text());
      if (!Array.isArray(v.desktop)) throw new Error('no desktop layout in that file');
      // Fresh ids on the way in. Importing a page exported from the SAME site would otherwise
      // collide with the ids already in the other layout, and the API would refuse the save
      // with a duplicate it is not obvious you created.
      setPage({ desktop: v.desktop.map(reid), mobile: Array.isArray(v.mobile) ? v.mobile.map(reid) : null });
      toast.success(t('pb.imported', 'Imported — not saved yet.'));
    } catch (e) {
      toast.error(String(e?.message || e));
    }
  };

  if (err) return <Card className="p-6 text-sm text-[var(--muted)]">{err}</Card>;
  if (!cfg) return <div className="p-8 grid place-items-center"><Spinner /></div>;

  const selected = sel ? findNode(tree, sel) : null;
  const labels = LABELS(t);
  const paletteGroups = [
    ['layout', t('pb.g.layout', 'Layout')],
    ['content', t('pb.g.content', 'Content')],
    ['dynamic', t('pb.g.dynamic', 'Live sections')],
  ];

  return (
    <div className="space-y-4 pb-24">
      {/* ── Header: which page, is it live, and where to look at it ── */}
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-semibold flex items-center gap-2"><Layers size={16} /> {t('pb.title', 'Page builder')}</h2>
        <div className="flex rounded-lg border border-[var(--line)] overflow-hidden ml-2">
          {(cfg.buildable || []).map((k) => (
            <button key={k} type="button" onClick={() => { setPageKey(k); setSel(null); }}
              aria-current={pageKey === k ? 'true' : undefined}
              className={`px-3 py-1.5 text-xs capitalize transition ${pageKey === k ? 'bg-[var(--surface-2)] text-[var(--text)]' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}>
              {k === 'home' ? t('pb.p.home', 'Home') : t('pb.p.dev', 'Developers')}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-xs ml-2">
          <input type="checkbox" checked={!!page.enabled} onChange={(e) => setPage({ enabled: e.target.checked })} />
          {t('pb.live', 'Use this instead of the built-in page')}
        </label>
        <div className="ml-auto flex items-center gap-2">
          <a href={pageKey === 'home' ? '/' : '/dev'} target="_blank" rel="noreferrer"
            className="text-xs inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[var(--line)] text-[var(--muted)] hover:text-[var(--text)] hover:border-[var(--primary)] transition">
            <ExternalLink size={13} /> {t('pb.view', 'View the page')}
          </a>
          <Button size="sm" variant="ghost" onClick={undo} disabled={!history.current.length}><RotateCcw size={14} /> {t('pb.undo', 'Undo')}</Button>
          <Button variant="primary" onClick={save} loading={busy}><Save size={15} /> {t('common.save', 'Save')}</Button>
        </div>
      </div>

      {/* A page that is switched on and has nothing in it is refused on save. Saying so here
          is cheaper than saying so after somebody has arranged the rest of the screen. */}
      {page.enabled && !page.desktop?.length && (
        <p className="text-[11px] text-warning">{t('pb.warnEmpty', 'This page is switched on but has no blocks \u2014 add one before saving.')}</p>
      )}

      {/* Start from the page that is live.
          A blank canvas is the wrong first screen for this: nobody wants to rebuild their own
          home page from an empty box, and the fastest way to understand the palette is to see
          a page you recognise made out of it. */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-[var(--muted)]">{t('pb.start.label', 'Start from:')}</span>
        <span className="text-[var(--faint)]">{t('pb.start.note', '\u2014 rebuilt out of blocks, then yours to change')}</span>

        {/* The canvas is the narrowest column on this screen, and it is the one being judged.
            Inside a dashboard that already spends 220px on its own sidebar, a 220 palette and
            a 280 properties panel leave the preview about half the width the real page gets \u2014
            so a home page rebuilt out of blocks rendered in a thin column and looked nothing
            like the page it is a copy of, which is the one job a preview has.

            A toggle rather than new fixed numbers: both panels fold away and the canvas takes
            the whole row. */}
        {/* ONE PER PANEL. A single "full width" folded both, so the choice was a canvas
            500px too narrow or no tools at all — and the useful states are in between: the
            palette away while adjusting one block's settings, the properties away while
            dragging blocks in. Both away is still one click on the third button, and each
            switch is remembered. */}
        <div className="ml-auto flex items-center gap-1.5">
          <Button size="sm" variant={showPalette ? 'ghost' : 'primary'}
            onClick={() => setShowPalette((v) => !v)}
            title={t('pb.fold.palette', 'Fold the block palette away')}>
            <PanelLeft size={13} /> {t('pb.fold.paletteL', 'Blocks')}
          </Button>
          <Button size="sm" variant={showProps ? 'ghost' : 'primary'}
            onClick={() => setShowProps((v) => !v)}
            title={t('pb.fold.props', 'Fold the properties panel away')}>
            <PanelRight size={13} /> {t('pb.fold.propsL', 'Settings')}
          </Button>
          <Button size="sm" variant={wide ? 'primary' : 'ghost'}
            onClick={() => setWide((w) => !w)}
            title={t('pb.wide.h', 'Fold the palette and the properties away, so the page is seen at full width')}>
            {wide ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
            {wide ? t('pb.wide.off', 'Show the panels') : t('pb.wide.on', 'Full width')}
          </Button>
        </div>
      </div>

      {/* The same three pages the home editor offers, under the same names and the same
          sentences, read from one module.

          They were named differently in the two places — "The long one" there and "The long
          landing page" here, with no sentence at all — so the list you choose from when you
          decide what the site opens with and the list you choose from when you rebuild that
          page described the same three pages in two vocabularies, and neither said which one
          was live. A name is not enough to choose by; that is why the other screen has
          always carried the sentence.

          Only variants that HAVE a preset are offered. A fourth landing page added without
          one would otherwise appear here as a button that quietly does nothing. */}
      <div className="grid sm:grid-cols-3 gap-2">
        {starters.map((o) => (
          <button
            key={o.key} type="button" onClick={() => startFrom(o.key)}
            className="text-left rounded-xl border border-[var(--line)] hover:border-[var(--primary)] p-2.5 transition-colors"
          >
            <div className="flex items-center gap-1.5">
              <LayoutTemplate size={13} className="text-[var(--muted)] shrink-0" />
              <span className="text-xs font-semibold">{o.name}</span>
              {o.live && (
                <span className="ml-auto text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-[var(--primary)]/[0.12] text-[var(--primary)]">
                  {t('pb.start.live', 'live')}
                </span>
              )}
            </div>
            {o.sub && <p className="mt-1 text-[11px] leading-snug text-[var(--muted)]">{o.sub}</p>}
          </button>
        ))}
      </div>

      {/* Columns follow what is OPEN. A folded panel gives its width back to the canvas
          instead of leaving a gap where it used to be. */}
      <div className={`grid gap-4 items-start ${
        showPalette && showProps ? 'lg:grid-cols-[210px_minmax(0,1fr)_290px]'
          : showPalette ? 'lg:grid-cols-[210px_minmax(0,1fr)]'
            : showProps ? 'lg:grid-cols-[minmax(0,1fr)_290px]'
              : ''}`}>
        {/* ── Palette ── */}
        <Card className={`p-3 space-y-3 lg:sticky lg:top-4 ${showPalette ? '' : 'hidden'}`}>
          {paletteGroups.map(([kind, label]) => (
            <div key={kind}>
              <div className="text-[10px] uppercase tracking-wider text-[var(--faint)] mb-1.5">{label}</div>
              <div className="grid grid-cols-2 gap-1.5">
                {Object.entries(blocks).filter(([, b]) => b.kind === kind).map(([type]) => (
                  <button
                    key={type} type="button" draggable
                    onDragStart={() => { drag.current = { kind: 'new', type }; }}
                    onClick={() => add(type)}
                    className="text-[11px] px-2 py-1.5 rounded-lg border border-[var(--line)] hover:border-[var(--primary)] text-left capitalize transition-colors"
                  >
                    {type}
                  </button>
                ))}
              </div>
            </div>
          ))}

          {!!(cfg.components || []).length && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[var(--faint)] mb-1.5">{t('pb.g.saved', 'Your components')}</div>
              <div className="space-y-1">
                {cfg.components.map((c) => (
                  <div key={c.id} className="flex items-center gap-1">
                    <button
                      type="button" draggable
                      onDragStart={() => { drag.current = { kind: 'component', nodes: c.nodes }; }}
                      onClick={() => onDropComponent(c)}
                      className="flex-1 min-w-0 truncate text-[11px] px-2 py-1.5 rounded-lg border border-[var(--line)] hover:border-[var(--primary)] text-left transition-colors"
                    >
                      <Package size={11} className="inline mr-1" />{c.name}
                    </button>
                    <button type="button" title={t('common.delete', 'Delete')}
                      onClick={() => setCfg((x) => ({ ...x, components: x.components.filter((y) => y.id !== c.id) }))}
                      className="p-1 text-[var(--faint)] hover:text-error"><Trash2 size={12} /></button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="pt-2 border-t border-[var(--line)] space-y-1.5">
            <Button size="sm" variant="ghost" className="w-full justify-start" onClick={saveComponent}><Package size={13} /> {t('pb.comp.save', 'Save selection')}</Button>
            <Button size="sm" variant="ghost" className="w-full justify-start" onClick={exportJson}><Download size={13} /> {t('pb.export', 'Export page')}</Button>
            <label className="flex items-center gap-1.5 text-xs px-2 py-1.5 rounded-lg text-[var(--muted)] hover:text-[var(--text)] cursor-pointer">
              <Upload size={13} /> {t('pb.import', 'Import page')}
              <input type="file" accept="application/json" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) importJson(f); e.target.value = ''; }} />
            </label>
          </div>
        </Card>

        {/* ── Canvas ── */}
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg border border-[var(--line)] overflow-hidden">
              <button type="button" onClick={() => setWhich('desktop')} aria-current={which === 'desktop' ? 'true' : undefined}
                className={`px-3 py-1.5 text-xs flex items-center gap-1.5 transition ${which === 'desktop' ? 'bg-[var(--surface-2)]' : 'text-[var(--muted)]'}`}>
                <Monitor size={13} /> {t('pb.desktop', 'Desktop')}
              </button>
              <button type="button" onClick={() => setWhich('mobile')} aria-current={which === 'mobile' ? 'true' : undefined}
                className={`px-3 py-1.5 text-xs flex items-center gap-1.5 transition ${which === 'mobile' ? 'bg-[var(--surface-2)]' : 'text-[var(--muted)]'}`}>
                <Smartphone size={13} /> {t('pb.mobile', 'Phone')}
              </button>
            </div>
            {which === 'mobile' && (
              inherits
                ? (
                  <div className="flex items-center gap-2 text-[11px] text-[var(--muted)]">
                    {t('pb.inherit', 'The phone shows the desktop layout, reflowed.')}
                    <Button size="sm" variant="ghost" onClick={() => setPage({ mobile: (page.desktop || []).map(reid) })}>
                      {t('pb.detach', 'Give it its own layout')}
                    </Button>
                  </div>
                )
                : (
                  <Button size="sm" variant="ghost" onClick={() => setPage({ mobile: null })}>
                    <RotateCcw size={13} /> {t('pb.reattach', 'Back to inheriting the desktop layout')}
                  </Button>
                )
            )}
            {/* The width the page is JUDGED at.
                "Fill the column" is right while arranging blocks. A number is a screen being
                looked at: the frame is rendered at that many real pixels and scaled to fit,
                so every media query answers the way it will on that screen. Fitting by
                shrinking the element instead would keep answering for the window. */}
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-[var(--muted)]">{t('pb.at', 'At')}</span>
              <Dropdown
                value={String(previewW)}
                onChange={(v) => setPreviewW(Number(v))}
                options={[
                  { value: '0', label: t('pb.w.fit', 'the column') },
                  { value: '1440', label: t('pb.w.1440', '1440 — large desktop') },
                  { value: '1280', label: t('pb.w.1280', '1280 — desktop') },
                  { value: '1024', label: t('pb.w.1024', '1024 — small laptop') },
                  { value: '768', label: t('pb.w.768', '768 — tablet') },
                  { value: '390', label: t('pb.w.390', '390 — phone') },
                ]}
              />
              {scale < 1 && (
                <span className="text-[var(--faint)] tabular-nums">{Math.round(scale * 100)}%</span>
              )}
            </div>

            <label className="ml-auto flex items-center gap-1.5 text-xs">
              {page.orb === 'off' ? <EyeOff size={13} /> : <Eye size={13} />}
              <Dropdown
                value={page.orb || 'default'}
                onChange={(v) => setPage({ orb: v })}
                options={[
                  { value: 'default', label: t('pb.orb.def', 'Orb: as the visitor prefers') },
                  { value: 'off', label: t('pb.orb.off', 'Orb: hidden on this page') },
                ]}
              />
            </label>
          </div>

          {/* `overflow-hidden`, not `auto`: the frame is scaled to fit by construction, so a
              scrollbar here would mean the maths is wrong rather than that the page is wide. */}
          <Card ref={canvasRef} className="p-4 overflow-hidden">
            <div
              className={`pb-frame ${which === 'mobile' && !previewW ? 'is-mobile' : ''}`}
              style={previewW ? {
                width: `${previewW}px`,
                transform: `scale(${scale})`,
                transformOrigin: 'top left',
                // The scaled element still occupies its UNSCALED height in the layout, so the
                // card would keep a tall empty gap under a shrunk page. Pulled back by the
                // part that is no longer drawn.
                marginBottom: frameH ? `${-(frameH * (1 - scale))}px` : undefined,
              } : undefined}
              ref={frameRef}
            >
              <PageRender
                page={which === 'mobile' && !inherits ? { desktop: tree } : { desktop: tree }}
                // The suite row, for real. It used to be handed an empty array, so a
                // `products` block previewed as nothing and the only way to see what you had
                // built was to publish it — which is the one job a preview has.
                ctx={{ ...live, products: productCards(live.projects, t) }}
                vars={live.stats}
                which={which}
                edit={{
                  selected: sel,
                  onSelect: setSel,
                  onDragStart: (id) => { drag.current = { kind: 'move', id }; },
                  onDrop,
                  canDrop,
                  emptyLabel: t('pb.dropHere', 'Drag a block here, or click one in the palette.'),
                }}
              />
            </div>
          </Card>
        </div>

        {/* ── Properties ── */}
        <Card className={`p-3 lg:sticky lg:top-4 space-y-3 ${showProps ? '' : 'hidden'}`}>
          {!selected && <p className="text-xs text-[var(--muted)]">{t('pb.pick', 'Select a block on the page to change it.')}</p>}
          {selected && (
            <>
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-semibold capitalize">{selected.type}</span>
                <div className="ml-auto flex items-center gap-0.5">
                  <button type="button" title={t('pb.up', 'Move up')} onClick={() => setTree(shiftNode(tree, selected.id, -1))} className="p-1 text-[var(--muted)] hover:text-[var(--text)]"><ChevronUp size={14} /></button>
                  <button type="button" title={t('pb.down', 'Move down')} onClick={() => setTree(shiftNode(tree, selected.id, 1))} className="p-1 text-[var(--muted)] hover:text-[var(--text)]"><ChevronDown size={14} /></button>
                  <button type="button" title={t('pb.dup', 'Duplicate')} onClick={() => duplicate(selected.id)} className="p-1 text-[var(--muted)] hover:text-[var(--text)]"><Copy size={14} /></button>
                  <button type="button" title={t('common.delete', 'Delete')} onClick={() => remove(selected.id)} className="p-1 text-[var(--muted)] hover:text-error"><Trash2 size={14} /></button>
                </div>
              </div>

              {(FIELDS[selected.type] || []).map(([key, label, spec]) => (
                <PropField
                  key={key} label={labels[label] || label} spec={spec} variables={cfg.variables || []}
                  value={selected.props?.[key]}
                  onChange={(v) => setTree(patchNode(tree, selected.id, { props: { [key]: v } }))}
                />
              ))}
              {!FIELDS[selected.type] && (
                <p className="text-[11px] text-[var(--muted)]">{t('pb.nofields', 'This block draws live data and has nothing to configure.')}</p>
              )}

              {/* Which layouts this block appears in. Absent means both, and the editor keeps
                  it absent rather than writing ['desktop','mobile'] — a stored list would
                  stop meaning "both" the day a third layout exists. */}
              <div className="pt-2 border-t border-[var(--line)]">
                <div className="text-[10px] uppercase tracking-wider text-[var(--faint)] mb-1.5">{t('pb.shownOn', 'Shown on')}</div>
                {['desktop', 'mobile'].map((w) => {
                  const on = !selected.on?.length || selected.on.includes(w);
                  return (
                    <label key={w} className="flex items-center gap-2 text-xs py-0.5">
                      <input
                        type="checkbox" checked={on}
                        onChange={() => {
                          const cur = selected.on?.length ? selected.on : ['desktop', 'mobile'];
                          const next = on ? cur.filter((x) => x !== w) : [...cur, w];
                          setTree(patchNode(tree, selected.id, { on: next.length === 2 ? undefined : next }));
                        }}
                      />
                      {w === 'desktop' ? t('pb.desktop', 'Desktop') : t('pb.mobile', 'Phone')}
                    </label>
                  );
                })}
                {selected.on?.length === 0 && (
                  <p className="text-[11px] text-warning mt-1">{t('pb.nowhere', 'This block is hidden everywhere.')}</p>
                )}
              </div>
            </>
          )}

        </Card>
      </div>
    </div>
  );

  function onDropComponent(c) {
    let next = tree;
    for (const n of c.nodes || []) next = insertNode(next, sel, reid(n), isContainer);
    setTree(next);
  }
}

/** One property row. The `markdown` kind carries the same select-to-format toolbar the
 *  document editors use — a text block IS a markdown document, and typing `**bold**` by hand
 *  in one editor while another has a toolbar is the split that made "Visual" mode read as
 *  half-finished. */
function PropField({ label, spec, value, onChange, variables }) {
  const { t } = useI18n();
  const ref = useRef(null);
  const [pick, setPick] = useState(false);
  if (spec.kind === 'bool') {
    return (
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={value !== false} onChange={(e) => onChange(e.target.checked)} />
        {label}
      </label>
    );
  }
  if (spec.kind === 'select') {
    return (
      <Field label={label}>
        <Dropdown value={String(value ?? spec.options[0])} onChange={onChange}
          options={spec.options.map((o) => ({ value: o, label: o }))} />
      </Field>
    );
  }
  if (spec.kind === 'variable') {
    return (
      <Field label={label}>
        <Dropdown value={String(value ?? variables[0] ?? '')} onChange={onChange}
          options={variables.map((o) => ({ value: o, label: o }))} />
      </Field>
    );
  }
  if (spec.kind === 'icon') {
    return (
      <Field label={label}>
        <div className="flex items-center gap-1.5">
          <button
            type="button" onClick={() => setPick(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--line)] px-2.5 py-1.5 text-sm text-[var(--muted)] hover:text-[var(--text)] min-w-0"
          >
            {value ? <IconGlyph name={value} size={15} /> : null}
            <span className="truncate">{value || t('pb.f.pickicon', 'Pick\u2026')}</span>
          </button>
          {value && (
            <button type="button" onClick={() => onChange('')} className="p-1 text-[var(--faint)] hover:text-error" aria-label={t('common.clear', 'Clear')}>
              <X size={13} />
            </button>
          )}
        </div>
        {pick && <IconPicker title={t('pb.f.pickicon', 'Pick\u2026')} onPick={(n) => { onChange(n); setPick(false); }} onClose={() => setPick(false)} />}
      </Field>
    );
  }
  if (spec.kind === 'colour') {
    // A swatch AND the text, because a colour here can be a CSS variable or a gradient, which
    // a native colour input cannot express \u2014 and losing that would make the field narrower
    // than the renderer it feeds.
    const hex = /^#[0-9a-f]{3,8}$/i.test(String(value || '')) ? value : '#888888';
    return (
      <Field label={label}>
        <div className="flex items-center gap-1.5">
          <input
            type="color" value={hex} onChange={(e) => onChange(e.target.value)}
            className="w-8 h-8 rounded-lg border border-[var(--line)] bg-transparent p-0.5 shrink-0 cursor-pointer"
            aria-label={label}
          />
          <Input value={value ?? ''} onChange={(e) => onChange(e.target.value)} placeholder="#0a7 \u00b7 var(\u2013\u2013primary)" />
          {value && (
            <button type="button" onClick={() => onChange('')} className="p-1 text-[var(--faint)] hover:text-error" aria-label={t('common.clear', 'Clear')}>
              <X size={13} />
            </button>
          )}
        </div>
      </Field>
    );
  }
  if (spec.kind === 'number') {
    return (
      <Field label={label}>
        <Input type="number" min={spec.min} max={spec.max} value={Number(value ?? 0)}
          onChange={(e) => onChange(Number(e.target.value))} />
      </Field>
    );
  }
  if (spec.kind === 'markdown') {
    return (
      <Field label={label}>
        <div className="relative">
          <Textarea ref={ref} rows={8} value={value || ''} onChange={(e) => onChange(e.target.value)}
            placeholder={t('pb.md.ph', 'Select any words to format them — or write markdown')} />
          <SelectionToolbar taRef={ref} value={value || ''} onChange={onChange} />
        </div>
      </Field>
    );
  }
  return (
    <Field label={label}>
      <Input value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

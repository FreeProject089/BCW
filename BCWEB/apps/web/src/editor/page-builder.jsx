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
  Package, Download, Upload, ExternalLink, RotateCcw, Layers,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { Card, Button, Input, Textarea, Field, Dropdown, Spinner, useToast, useDialog } from '../ui/ui.jsx';
import { useI18n } from '../i18n.jsx';
import PageRender from '../pages/page-render.jsx';
import { setSitePages } from '../lib/site-pages.js';
import SelectionToolbar from './selection-toolbar.jsx';

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
    level: t('pb.f.level', 'Level'),
    link: t('pb.f.link', 'Link'),
    number: t('pb.f.number', 'Number'),
    padding: t('pb.f.padding', 'Padding'),
    size: t('pb.f.size', 'Size'),
    style: t('pb.f.style', 'Style'),
    text: t('pb.f.text', 'Text'),
    width: t('pb.f.width', 'Width'),
    widthshare: t('pb.f.widthshare', 'Width share'),
    wrap: t('pb.f.wrap', 'Wrap'),
});

const FIELDS = {
  section: [
    ['pad', 'padding', SELECT(['none', 'sm', 'md', 'lg'])],
    ['bg', 'background', SELECT(['none', 'surface', 'surface2'])],
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
    ['icon', 'icon', { kind: 'text' }],
  ],
  image: [
    ['src', 'imageurl', { kind: 'text' }],
    ['alt', 'alttext', { kind: 'text' }],
    ['radius', 'cornerradius', { kind: 'number', min: 0, max: 40 }],
    ['fit', 'fit', SELECT(['cover', 'contain'])],
    ['height', 'fixedheight', { kind: 'number', min: 0, max: 900 }],
  ],
  spacer: [['size', 'height', { kind: 'number', min: 0, max: 400 }]],
  divider: [['width', 'width', SELECT(['full', 'short'])]],
  stat: [
    ['variable', 'number', { kind: 'variable' }],
    ['label', 'label', { kind: 'text' }],
    ['icon', 'icon', { kind: 'text' }],
  ],
  news: [['limit', 'howmany', { kind: 'number', min: 1, max: 12 }]],
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
  // Live data for the dynamic blocks, so the preview shows the real news and the real
  // numbers. A builder that previews `{{members}}` as `{{members}}` is asking you to imagine
  // the page you are building.
  const [live, setLive] = useState({ stats: {}, posts: [], showcase: null, pollData: null, reviewsData: null, myo: null });
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
    ]).then(([stats, blog, showcase, pollData, reviewsData, myo]) => {
      if (on) setLive({ stats: stats || {}, posts: blog?.posts || [], showcase, pollData, reviewsData, myo });
    });
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
        <p className="text-[11px] text-warning">{t('pb.warnEmpty', 'This page is switched on but has no blocks — add one before saving.')}</p>
      )}

      <div className="grid lg:grid-cols-[220px_minmax(0,1fr)_280px] gap-4 items-start">
        {/* ── Palette ── */}
        <Card className="p-3 space-y-3 lg:sticky lg:top-4">
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

          <Card className={`p-4 overflow-x-auto ${which === 'mobile' ? '' : ''}`}>
            <div className={`pb-frame ${which === 'mobile' ? 'is-mobile' : ''}`}>
              <PageRender
                page={which === 'mobile' && !inherits ? { desktop: tree } : { desktop: tree }}
                ctx={{ ...live, products: [] }}
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
        <Card className="p-3 lg:sticky lg:top-4 space-y-3">
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

          <div className="pt-2 border-t border-[var(--line)]">
            <div className="text-[10px] uppercase tracking-wider text-[var(--faint)] mb-1.5">{t('pb.vars', 'Numbers you can use')}</div>
            <p className="text-[11px] text-[var(--muted)] mb-1.5">{t('pb.vars.how', 'Type {{name}} in any heading or text block.')}</p>
            <div className="flex flex-wrap gap-1">
              {(cfg.variables || []).map((v) => (
                <code key={v} className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--surface-2)] border border-[var(--line)]">
                  {'{{'}{v}{'}}'} <span className="text-[var(--faint)]">{live.stats?.[v] ?? 0}</span>
                </code>
              ))}
            </div>
          </div>
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

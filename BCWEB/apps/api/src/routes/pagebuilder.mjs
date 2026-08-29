// Custom pages: a tree of blocks an admin arranges, instead of a variant they pick.
//
// The site had three landing pages and a set of on/off switches. That is a preset chooser,
// not a page builder: a section can be hidden but not moved, nothing new can be added, and
// the order is whatever home.jsx happens to declare. Every question past "which of the three"
// had the same answer — edit the JSX.
//
// So a page is stored here as a TREE. Layout nodes hold children; content nodes hold props;
// and one content type is `text`, whose prop is BetterCommunity markdown — which means the
// whole block vocabulary (buttons, cards, tabs, columns, callouts, maths) is already inside
// the builder without the builder knowing anything about it. The palette only has to cover
// what markdown cannot do: layout, live data, and the components that are React.
//
// Two layouts per page, desktop and mobile. `mobile: null` means "the desktop tree, reflowed"
// rather than an empty phone — an inherited layout that stays in step is worth more than a
// second tree somebody has to remember to edit.
import { z } from 'zod';
import { db, requireRole, logAudit } from '../lib/lib.mjs';
import { safeUrl } from './misc.mjs';

const PAGES_KEY = 'site.pages';

/** Which pages can be built. A page not named here has no builder and keeps its JSX. */
export const BUILDABLE = ['home', 'dev'];

/**
 * The palette.
 *
 * `kind` decides what the editor offers and what the renderer draws:
 *   layout   — holds children
 *   content  — draws itself from props
 *   dynamic  — a React section that fetches its own data (the existing home blocks)
 *
 * Declared once, here, and served to the editor. A palette written twice would offer a block
 * the renderer cannot draw, and the failure would be a blank rectangle on the live site.
 */
export const BLOCKS = {
  // ── Layout ──
  section: { kind: 'layout', props: { pad: 'md', bg: 'none', full: false, radius: 0, maxw: 'wide' } },
  row:     { kind: 'layout', props: { gap: 'md', align: 'stretch', wrap: true, cols: 'auto' } },
  col:     { kind: 'layout', props: { span: 1, align: 'start' } },
  /**
   * A card, and a grid of them.
   *
   * Layout blocks rather than a title-and-blurb pair, because the moment a card can only hold
   * two strings somebody needs a third and the answer is a second card type. Children mean a
   * card holds whatever the palette holds — including a `text` block, which is markdown, which
   * is everything.
   *
   * The props are the frame: what the card looks like and where it goes. `image` and `bg` are
   * the two ways to fill the top; `icon` sits on either.
   */
  cards:   { kind: 'layout', props: { cols: 'auto', gap: 'md', min: 240 } },
  card:    { kind: 'layout', props: { title: '', href: '', icon: '', image: '', bg: '', accent: '', media: 'none', align: 'left' } },
  // ── Content ──
  heading: { kind: 'content', props: { text: '', level: 2, align: 'left', gradient: false } },
  text:    { kind: 'content', props: { md: '', align: 'left', width: 'prose' } },
  button:  { kind: 'content', props: { label: '', href: '/', style: 'primary', icon: '', size: 'md' } },
  image:   { kind: 'content', props: { src: '', alt: '', radius: 12, fit: 'cover', height: 0 } },
  spacer:  { kind: 'content', props: { size: 32 } },
  /**
   * A rule between two things.
   *
   * `style` because a divider is the one element on a page whose whole job is tone: a hairline
   * says "next section", a row of dots says "pause", a gradient says "the page ends here". One
   * of them drawn three ways is one block; three blocks would be three names to learn.
   */
  divider: { kind: 'content', props: { width: 'full', style: 'line', space: 'md', label: '' } },
  stat:    { kind: 'content', props: { variable: 'members', label: '', icon: '', style: 'tile' } },
  // ── Dynamic: the sections the landing pages already draw ──
  // No `orb` here on purpose. The orb is a site-wide backdrop mounted once in App.jsx, not a
  // section inside a page — a block that "contains" it would be a second one behind the first.
  // Whether a page has it is a page-level setting, below.
  //
  // Each one takes a `style`, because "the news" is a different section on a page that opens
  // with it and on a page that ends with it. Same data, same component, different shape — and
  // a second block type per shape would be a second thing to keep in step.
  showcase:  { kind: 'dynamic', props: {} },
  products:  { kind: 'dynamic', props: { style: 'rows' } },
  news:      { kind: 'dynamic', props: { limit: 6, style: 'grid', heading: true } },
  // `banner` draws NOTHING when no service is down, which is what makes it safe to put on a
  // page somebody built by hand: it costs a blank line on every ordinary day rather than a
  // permanent green strip nobody reads. `services` is the opposite promise — the uptime
  // record, which is only worth anything when it IS green — so it is a choice, not a default.
  status:    { kind: 'dynamic', props: { style: 'banner' } },
  poll:      { kind: 'dynamic', props: {} },
  reviews:   { kind: 'dynamic', props: { style: 'cards', limit: 3 } },
  myo:       { kind: 'dynamic', props: { limit: 3 } },
  devtools:  { kind: 'dynamic', props: {} },
};
export const BLOCK_TYPES = Object.keys(BLOCKS);
const LAYOUT_TYPES = BLOCK_TYPES.filter((t) => BLOCKS[t].kind === 'layout');

/**
 * The variables a `stat` block may read. Text substitution used to read this list too and
 * was removed; a number in a sentence is a block now, not a placeholder.
 *
 * An allowlist of names, not a path into the database. The editor shows this list, the
 * renderer resolves against the numbers `/stats` already publishes, and a name that is not
 * here renders as nothing rather than as `undefined`.
 */
export const VARIABLES = ['members', 'items', 'downloads', 'repos', 'catalogs', 'posts', 'projects', 'apps', 'plugins', 'themes', 'presets'];

/**
 * A block tree, with a depth cap.
 *
 * zod has no native recursion, so the tree is built by nesting a fixed number of levels. Six
 * is past anything a person arranges by hand and short enough that a hostile payload cannot
 * make the validator walk forever. Below the cap, a layout node simply holds no children —
 * the page renders, minus a nesting nobody meant.
 */
const nodeAt = (depth) => {
  const base = {
    id: z.string().trim().min(1).max(40),
    type: z.enum(BLOCK_TYPES),
    props: z.record(z.union([z.string().max(4000), z.number(), z.boolean(), z.null()])).default({}),
    // Which layouts this node appears in. Both by default: a block placed once should show up
    // on a phone too, and hiding it there is the deliberate act.
    on: z.array(z.enum(['desktop', 'mobile'])).max(2).optional(),
  };
  if (depth <= 0) return z.object(base).strict();
  return z.object({ ...base, children: z.array(nodeAt(depth - 1)).max(60).optional() }).strict();
};
const NODE = nodeAt(6);

const layoutSchema = z.array(NODE).max(80);

const pageSchema = z.object({
  // OFF is the default and it means "keep the page that is compiled in". A half-built tree
  // saved by somebody who got interrupted must not become the front page.
  enabled: z.boolean().default(false),
  /**
   * The backdrop orb on this page.
   *
   * `default` respects the visitor: the orb is a per-visitor preference, and somebody who
   * turned it off did so for a reason — motion, a weak GPU, or simply not wanting it. There
   * is deliberately no value that turns it back ON for them.
   *
   * `off` hides it for everyone on this page, which is what a custom landing page with its
   * own full-bleed hero needs.
   */
  orb: z.enum(['default', 'off']).default('default'),
  desktop: layoutSchema.default([]),
  // null — not [] — is "reflow the desktop tree". An empty array is a deliberately blank
  // phone layout, and the two have to stay distinguishable.
  mobile: layoutSchema.nullable().default(null),
}).strict();

const DEFAULT_PAGE = { enabled: false, orb: 'default', desktop: [], mobile: null };

/** A saved component: a subtree with a name, so a header built once can be placed again. */
const componentSchema = z.object({
  id: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(60),
  nodes: layoutSchema,
}).strict();

const pagesConfig = (row) => {
  const v = row?.value || {};
  const pages = {};
  for (const k of BUILDABLE) pages[k] = { ...DEFAULT_PAGE, ...(v.pages?.[k] || {}) };
  return { pages, components: Array.isArray(v.components) ? v.components : [] };
};

/**
 * Are the ids in one tree unique?
 *
 * They address a node in the editor and they are React keys in the renderer. A duplicate is
 * not a crash — it is two blocks that move together and a drag that drops the wrong one, i.e.
 * a bug reported as "the editor is broken" with nothing in the console.
 */
function duplicateId(nodes, seen = new Set()) {
  for (const n of nodes || []) {
    if (seen.has(n.id)) return n.id;
    seen.add(n.id);
    const dup = duplicateId(n.children, seen);
    if (dup) return dup;
  }
  return null;
}

/** Children on a node that cannot hold any is a silent bug in whatever produced the tree. */
function misplacedChildren(nodes) {
  for (const n of nodes || []) {
    if (n.children?.length && !LAYOUT_TYPES.includes(n.type)) return n.type;
    const bad = misplacedChildren(n.children);
    if (bad) return bad;
  }
  return null;
}

export default async function pageBuilderRoutes(app) {
  // Public, and read before the first paint — so it is small and it is cached. Only the
  // pages an admin actually built travel; a site that never opened the builder gets two
  // `enabled: false` rows and renders exactly what it rendered before.
  app.get('/site/pages', async (req, reply) => {
    const p = await db();
    const cfg = pagesConfig(await p.adminSetting.findUnique({ where: { key: PAGES_KEY } }));
    reply.header('Cache-Control', 'public, max-age=30');
    // The components are the admin's library, not the visitor's. They are only useful in the
    // editor and they can be large, so they do not ride along on every page load.
    return { pages: cfg.pages };
  });

  app.get('/admin/site/pages', { preHandler: requireRole('ADMIN') }, async () => {
    const p = await db();
    // The palette and the variable list travel WITH the config, for the same reason the home
    // variants do: an editor holding its own copy would offer a block the renderer does not
    // know, and that failure looks like a bug in the page rather than in the list.
    return { ...pagesConfig(await p.adminSetting.findUnique({ where: { key: PAGES_KEY } })), blocks: BLOCKS, variables: VARIABLES, buildable: BUILDABLE };
  });

  app.put('/admin/site/pages', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const b = z.object({
      pages: z.record(z.enum(BUILDABLE), pageSchema).optional(),
      components: z.array(componentSchema).max(100).optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input', detail: b.error.issues?.[0]?.message });

    for (const [key, page] of Object.entries(b.data.pages || {})) {
      for (const which of ['desktop', 'mobile']) {
        const tree = page[which];
        if (!tree) continue;
        const dup = duplicateId(tree);
        if (dup) return reply.code(400).send({ error: 'duplicate_id', detail: `${key}.${which}: ${dup}` });
        const bad = misplacedChildren(tree);
        if (bad) return reply.code(400).send({ error: 'not_a_container', detail: `${key}.${which}: ${bad}` });
        const unsafe = unsafeUrlIn(tree);
        if (unsafe) return reply.code(400).send({ error: 'unsafe_url', detail: unsafe });
      }
      // A page cannot be switched on with nothing in it: the visitor would get a blank
      // document where the landing page used to be, and the way back would be guessing that
      // the builder is what did it.
      if (page.enabled && !page.desktop?.length) return reply.code(400).send({ error: 'empty_page', detail: key });
    }

    const p = await db();
    const current = pagesConfig(await p.adminSetting.findUnique({ where: { key: PAGES_KEY } }));
    const value = {
      pages: { ...current.pages, ...(b.data.pages || {}) },
      components: b.data.components ?? current.components,
    };
    await p.adminSetting.upsert({ where: { key: PAGES_KEY }, create: { key: PAGES_KEY, value }, update: { value } });
    const on = Object.entries(value.pages).filter(([, v]) => v.enabled).map(([k]) => k);
    await logAudit(p, req.user.uid, 'site.pages', `custom=${on.join(',') || 'none'}`);
    return { ...value, blocks: BLOCKS, variables: VARIABLES, buildable: BUILDABLE };
  });
}

/**
 * `javascript:` in a button's href is a script the visitor runs by clicking the front page.
 *
 * Same rule and the same helper as the showcase, deliberately: two url guards on one site
 * diverge, and the one that is wrong is whichever nobody tested. Checked on every prop whose
 * name says it is an address, at every depth.
 */
export function unsafeUrlIn(nodes) {
  for (const n of nodes || []) {
    for (const k of ['href', 'src', 'poster']) {
      const v = n.props?.[k];
      if (typeof v === 'string' && v.trim() && !safeUrl(v)) return `${n.type}.${k}`;
    }
    const bad = unsafeUrlIn(n.children);
    if (bad) return bad;
  }
  return null;
}

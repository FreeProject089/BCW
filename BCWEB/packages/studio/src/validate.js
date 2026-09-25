// What a studio document may carry, checked where it is SAVED.
//
// ONE function, run by the API on every write (apps/api/src/lib/studio-doc.mjs imports it
// from this package) and available to the web through the same module. There used to be two:
// the API restated the web's rules because its image did not carry the web's source, and a
// test compared the copies over a corpus. Two copies of a rule drift (the lesson of the staff
// poll tally that went public), so the rule now lives here once and the parity test asserts
// that the API's validator IS this function, not merely one that agrees with it today.
//
// Normalise on read, validate on write (PLAN-STUDIO-2026, 2.1 point 3):
//   · normalizeDoc (canvas.js) is TOLERANT: an old or odd document still renders, whatever
//     it holds, because a page that throws is worse than a page drawn badly.
//   · validateDoc is STRICT: it names every problem with the path of the field, so an author
//     sees "blocks[3].props.action.href: unsafe_url" at Save instead of a page that silently
//     lost something. Unknown fields are refused, not ignored: an allow-list that tolerates
//     extra keys is a place to smuggle data past the next reader of the document.
//
// Every problem is `{ path, reason, key }`. `path` is for the author; `key` names the same
// problem WITHOUT indexes (page id, block id, field, value), which is what lets the API
// tolerate a problem ALREADY stored at the same block of the same page after the blocks were
// reordered (a legacy `api` button, decision D5), while refusing anything new.
import {
  ID_SHAPE, LIMITS, BOUND, BLOCK_KINDS, SHAPES, ANIM_KINDS, ANIM_TRIGGERS, ANIM_EASINGS,
  BUTTON_VARIANTS, SHADOWS, HOVER_EFFECTS, GRID_SIZES, TEXT_ALIGNS, FRAME_WIDTHS, FRAME_FITS,
  PHONE_MODES, DOC_VERSION, propAllowed, safeLink, buttonTarget,
  COMPONENT_SCOPES, COMPONENT_REF, MAX_DOC_COMPONENTS, MAX_COMPONENT_BLOCKS, MAX_EXPOSED, EXPOSED_KEY,
  EXPOSABLE_FIELDS, exposableFor, withFieldValue, normalizeDoc,
} from './canvas.js';
import { safeCssValue, decodeCssEscapes } from './css-scope.js';
import { backgroundProblems } from './background.js';
import { actionProblems, normalizeLinkPolicy, DEFAULT_LINK_POLICY } from './actions.js';
import { treeProblems, containerInfo, MAX_TABS, TAB_LABEL_MAX } from './tree.js';
// Components (phase 7b): the loops, the depth, the expansion (components.js).
import {
  componentGraphProblems, expandedCount, expandedTreeProblems, expandInstances, MAX_EXPANDED_BLOCKS,
} from './components.js';

/** A page, serialised, may not be larger than this. */
export const MAX_DOC_BYTES = LIMITS.bytes;

/**
 * Names that are never a component id, an exposed key or an override key (phase 7c). Each of
 * those becomes a KEY of a plain object somewhere (a page's map of definitions, an instance's
 * overrides), and `obj['__proto__'] = v` does not add a key, it replaces the object's
 * prototype; `constructor` and `prototype` name what every object already inherits. An
 * imported file is the obvious carrier, so the file reader refuses them anywhere as a key
 * (io.js); here they are refused where a save would store them as one.
 */
export const RESERVED_NAMES = ['__proto__', 'constructor', 'prototype'];
const reserved = (s) => RESERVED_NAMES.includes(s);
/** `map[key]` when the map OWNS it (never what every object inherits, like `map.__proto__`). */
const own = (map, key) => (isObj(map) && typeof key === 'string' && Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined);

/** The fields a document may have at the top, by version. */
// `hidden` (phase 6): a page kept in the studio and out of the public page's tabs.
// `components` (phase 7b): the definitions the page's instances copy (components.js).
const DOC_KEYS_V1 = ['id', 'title', 'hidden', 'height', 'phoneHeight', 'phoneBoard', 'bg', 'grid', 'css', 'blocks', 'components'];
// `background` is the closed value (background.js, phase 4). `bg` stays readable on a v2 page
// saved before phase 4 (the API tolerates what is already stored); the studio never writes it.
const DOC_KEYS_V2 = ['v', 'id', 'title', 'hidden', 'frames', 'background', 'bg', 'grid', 'css', 'blocks', 'components'];
/** The fields a block may have. */
export const BLOCK_KEYS = ['id', 'kind', 'x', 'y', 'w', 'h', 'z', 'props', 'opacity', 'themes', 'phone', 'anim',
  'name', 'locked', 'hidden', 'rotate', 'shadow', 'hover', 'link', 'component', 'action',
  // Containers (phase 7a, tree.js): the container a block sits in, and its tab on a tab card.
  'parent', 'slot'];
const OVERLAY_KEYS = ['x', 'y', 'w', 'h', 'opacity', 'hidden', 'props'];
const PHONE_KEYS = ['order', 'hidden', 'h', 'x', 'y', 'w'];
const ANIM_KEYS = ['kind', 'trigger', 'delay', 'duration', 'easing', 'loop', 'custom'];
// `inst`: a personal component's copy (before phase 7b); `overrides`: an instance's (phase 7b).
const COMPONENT_KEYS = ['id', 'inst', 'overrides'];
/** A definition in a page's map, and its document (phase 7b). */
const SNAPSHOT_KEYS = ['name', 'scope', 'ref', 'doc', 'exposed'];
const SNAPSHOT_DOC_KEYS = ['v', 'frames', 'blocks'];
const EXPOSED_KEYS = ['key', 'block', 'field', 'label'];
const PATTERN_KEYS = ['id', 'color', 'size', 'opacity'];
const ITEM_KEYS = ['label', 'href'];
/** An action's fields. `api` is the removed type (D5): its own fields are reported as that. */
const ACTION_KEYS = ['type', 'href', 'text', 'target'];
/** Author colour fields, each written into a style attribute or an SVG paint. */
const CSS_PROPS = ['bg', 'border', 'color', 'fill', 'fill2', 'stroke', 'textColor'];
/** Props that are free text, and how long each may be. */
const TEXT_PROPS = { md: Infinity /* bounded by the page size */, svg: LIMITS.svg, text: 80, label: 200, desc: 500, doneLabel: 80, alt: 500, title: 200,
  src: 4000, poster: 4000, url: 2000, cls: 2000, style: 4000, dash: 40 };
const NUMBER_PROPS = { radius: [0, 1000], pad: [0, 1000], strokeWidth: [0, 200], corner: [0, 50], textSize: [1, 400], opacity: [0, 1] };
const BOOL_PROPS = ['controls', 'muted', 'loop', 'autoplay', 'keepRatio', 'outline'];
const ENUM_PROPS = {
  shape: SHAPES, variant: BUTTON_VARIANTS, size: ['sm', 'md', 'lg'], fit: ['cover', 'contain', 'fill', 'none', 'scale-down'],
  align: TEXT_ALIGNS,
};

const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Is this one CSS value safe in a style attribute? The renderer's own rule (safeCssValue),
 *  so what is refused here is exactly what the page would have dropped. */
export function cssValueOk(input) {
  if (input == null || input === '') return true;
  if (typeof input !== 'string' || input.length > 600) return false;
  return !input.trim() || safeCssValue(input) !== '';
}

/** Does this stylesheet or inline style pin a box to the viewport (`position: fixed|sticky`)? */
export function pinsToViewport(css) {
  if (typeof css !== 'string' || !css) return false;
  return /position\s*:\s*(?:fixed|sticky)\b/i.test(decodeCssEscapes(css).replace(/\/\*[\s\S]*?\*\//g, ''));
}

/**
 * Every problem in ONE studio document, as `{ path, reason, key }`. [] = accept.
 *
 * Reasons (the web turns each into words, `cst.save.why.<reason>`): `too_large`, `bad_type`,
 * `unknown_field`, `bad_value`, `out_of_bounds`, `too_many`, `too_long`, `bad_id`,
 * `unsafe_url`, `unsafe_css`, `position_fixed`, `api_removed`, `unknown_action`,
 * `bad_scroll_target`, and for a block's `action` (actions.js, phase 5): `reserved_action`,
 * `https_only`, `host_not_allowed`, `bad_target`, `unknown_endpoint`, `terminal_not_last`,
 * `too_short`, and for the tree of containers (tree.js, phase 7a): `unknown_parent`,
 * `self_parent`, `not_container`, `cycle`, `too_deep`, `modal_nested`, `outside_parent`, and for
 * components (phase 7b, components.js): `unknown_component`, `not_exposed`, `component_cycle`,
 * `instance_too_deep`, `too_many_expanded`, `unknown_block`, `duplicate`, `required`, `not_allowed`, and
 * (phase 7c) `duplicate_id` for two blocks under one id.
 *
 * @param {unknown} doc
 * @param {string} [prefix]  prepended to every path, e.g. `canvases[2]`
 * @param {{ links?: object, selfComponent?: string }} [opts]  `links`: the site's link policy
 *        (actions.js), which an `external` step is checked against. Absent = the default (every
 *        https host). `selfComponent`: the document IS the definition of this component (a
 *        library entry), so an instance of it inside is a loop.
 */
export function validateDoc(doc, prefix = '', opts = {}) {
  const out = [];
  const pre = prefix ? `${prefix}.` : '';
  if (!isObj(doc)) {
    out.push({ path: prefix, reason: 'bad_type', key: `||(doc)|bad_type|${JSON.stringify(doc ?? null).slice(0, 100)}` });
    return out;
  }
  const c = doc;
  const cid = typeof c.id === 'string' ? c.id : '';
  const add = (path, reason, value, blockId = '') => out.push({
    path: `${pre}${path}`, reason,
    key: `${cid}|${blockId}|${path.replace(/^blocks\[\d+\]\.?/, '')}|${reason}|${JSON.stringify(value ?? null).slice(0, 500)}`,
  });
  let bytes = 0;
  try { bytes = JSON.stringify(c).length; } catch { bytes = Infinity; }
  if (bytes > MAX_DOC_BYTES) add('', 'too_large', bytes);

  const v2 = c.v != null;
  if (v2 && c.v !== DOC_VERSION) add('v', 'bad_value', c.v);
  for (const k of Object.keys(c)) if (!(v2 ? DOC_KEYS_V2 : DOC_KEYS_V1).includes(k)) add(k, 'unknown_field', k);

  if (c.id != null && c.id !== '' && !(typeof c.id === 'string' && ID_SHAPE.test(c.id))) add('id', 'bad_id', c.id);
  text(c.title, LIMITS.title, 'title', add);
  if (c.hidden != null && typeof c.hidden !== 'boolean') add('hidden', 'bad_type', c.hidden);
  if (c.bg != null && typeof c.bg !== 'string') add('bg', 'bad_type', c.bg);
  else if (!cssValueOk(c.bg)) add('bg', 'unsafe_css', c.bg);
  // Closed: every field named, every value one of the kinds' own (background.js).
  if (v2) backgroundProblems(c.background, (path, reason, value) => add(path, reason, value));
  if (c.grid != null && !GRID_SIZES.includes(c.grid)) add('grid', 'bad_value', c.grid);
  if (c.css != null && typeof c.css !== 'string') add('css', 'bad_type', '');
  else if (typeof c.css === 'string') {
    if (c.css.length > LIMITS.css) add('css', 'too_long', c.css.length);
    if (pinsToViewport(c.css)) add('css', 'position_fixed', '');
  }

  if (v2) framesProblems(c.frames, add);
  else {
    for (const k of ['height', 'phoneHeight']) if (c[k] != null && !(isNum(c[k]) && c[k] >= 0 && c[k] <= BOUND)) add(k, 'bad_value', c[k]);
    if (c.phoneBoard != null && typeof c.phoneBoard !== 'boolean') add('phoneBoard', 'bad_type', c.phoneBoard);
  }

  if (c.blocks != null && !Array.isArray(c.blocks)) { add('blocks', 'bad_type', null); return out; }
  const blocks = Array.isArray(c.blocks) ? c.blocks : [];
  if (blocks.length > LIMITS.blocks) add('blocks', 'too_many', blocks.length);
  // Components (phase 7b): the definitions the instances resolve against. A definition inside a
  // page's map is checked with the PAGE's map (`opts.componentsMap`), which it never repeats.
  const nested = !!(opts && opts.componentsMap);
  const map = nested ? opts.componentsMap : (isObj(c.components) ? c.components : {});
  const hasInstances = blocks.some((b) => isObj(b) && b.kind === 'instance');
  // An instance stands in its place as a container (its component's own, or a group): a step
  // of the page may reveal it, or open it when the component is a dialog.
  let norm = null;
  let expanded = null;
  if (hasInstances && !nested) {
    try { norm = normalizeDoc(c); expanded = expandInstances(norm); } catch { norm = null; expanded = null; }
  }
  // What a scroll or a reveal may name: the page's own blocks (ids as stored).
  const actx = {
    links: opts && opts.links ? normalizeLinkPolicy(opts.links) : DEFAULT_LINK_POLICY,
    blockIds: new Set(blocks.map((b) => (isObj(b) && typeof b.id === 'string' ? b.id : '')).filter(Boolean)),
    // What a `modal`, `tab` or `reveal` step may name (phase 7a): the kind of each container.
    containers: expanded ? new Map([...containerInfo(expanded.blocks), ...containerInfo(blocks)]) : containerInfo(blocks),
  };
  blocks.forEach((b, i) => blockProblems(b, i, add, actx));
  // Two blocks under one id (phase 7c): the normaliser would rename the second, and whatever
  // named it (a container link, a step's target) would silently point at the first.
  const seenIds = new Set();
  blocks.forEach((b, i) => {
    if (!isObj(b) || typeof b.id !== 'string' || !b.id) return;
    if (seenIds.has(b.id)) add(`blocks[${i}].id`, 'duplicate_id', b.id, b.id);
    else seenIds.add(b.id);
  });
  if (c.components != null) {
    if (nested) add('components', 'not_allowed', null);
    else mapProblems(c.components, pre, out, add, opts);
  }
  if (hasInstances) instanceProblems(blocks, map, add, actx.links);
  if (!nested) {
    for (const p of componentGraphProblems(blocks, map, opts && typeof opts.selfComponent === 'string' ? opts.selfComponent : '')) add(p.path, p.reason, p.value);
    if (hasInstances) {
      const n = expandedCount(blocks, map);
      if (n > MAX_EXPANDED_BLOCKS) add('blocks', 'too_many_expanded', n);
      // The tree as a reader gets it: an instance may not take the page past its bounds.
      if (norm) {
        const at = new Map(blocks.map((b, i) => [isObj(b) ? b.id : null, i]));
        for (const p of expandedTreeProblems(norm)) {
          const i = at.get(p.instance);
          if (i != null) add(`blocks[${i}]`, p.reason, p.instance, p.instance);
        }
      }
    }
  }
  // The tree of containers (tree.js): every broken link with the path of the block's field.
  for (const p of treeProblems(blocks)) {
    const b = blocks[p.index];
    const bid = isObj(b) && typeof b.id === 'string' ? b.id : '';
    const value = p.field === 'slot' ? b.slot : p.field === 'parent' ? b.parent : null;
    add(`blocks[${p.index}]${p.field ? `.${p.field}` : ''}`, p.reason, value, bid);
  }
  return out;
}

function text(v, max, path, push) {
  if (v == null) return;
  if (typeof v !== 'string') push(path, 'bad_type', typeof v);
  else if (v.length > max) push(path, 'too_long', v.length);
}

function keysOnly(o, allowed, path, push) {
  for (const k of Object.keys(o)) if (!allowed.includes(k)) push(path ? `${path}.${k}` : k, 'unknown_field', k);
}

/** A coordinate: a number on the board. */
function coordOk(v, path, push) {
  if (v == null) return;
  if (!isNum(v)) push(path, 'bad_type', v);
  else if (Math.abs(v) > BOUND) push(path, 'out_of_bounds', v);
}
/** A size: positive, on the board. */
function sizeOk(v, path, push) {
  if (v == null) return;
  if (!isNum(v)) push(path, 'bad_type', v);
  else if (v <= 0 || v > BOUND) push(path, 'out_of_bounds', v);
}

function framesProblems(frames, add) {
  if (!isObj(frames)) { add('frames', 'bad_type', null); return; }
  keysOnly(frames, ['desktop', 'phone'], 'frames', add);
  for (const name of ['desktop', 'phone']) {
    const f = frames[name];
    const at = `frames.${name}`;
    if (f == null) continue;
    if (!isObj(f)) { add(at, 'bad_type', null); continue; }
    keysOnly(f, name === 'phone' ? ['w', 'h', 'fit', 'mode'] : ['w', 'h', 'fit'], at, add);
    if (f.w != null && f.w !== FRAME_WIDTHS[name]) add(`${at}.w`, 'bad_value', f.w);
    if (f.fit != null && !FRAME_FITS.includes(f.fit)) add(`${at}.fit`, 'bad_value', f.fit);
    if (f.h != null && !(isNum(f.h) && f.h >= 0 && f.h <= BOUND)) add(`${at}.h`, 'bad_value', f.h);
    if (name === 'phone' && f.mode != null && !PHONE_MODES.includes(f.mode)) add(`${at}.mode`, 'bad_value', f.mode);
  }
}

function propsProblems(kind, props, at, push) {
  if (props == null) return;
  if (!isObj(props)) { push(at, 'bad_type', null); return; }
  const p = props;
  for (const k of Object.keys(p)) if (!propAllowed(kind, k)) push(`${at}.${k}`, 'unknown_field', k);
  for (const k of CSS_PROPS) {
    if (p[k] == null) continue;
    if (typeof p[k] !== 'string') push(`${at}.${k}`, 'bad_type', p[k]);
    else if (!cssValueOk(p[k])) push(`${at}.${k}`, 'unsafe_css', p[k]);
  }
  for (const [k, max] of Object.entries(TEXT_PROPS)) text(p[k], max, `${at}.${k}`, push);
  for (const [k, [lo, hi]] of Object.entries(NUMBER_PROPS)) {
    if (p[k] == null) continue;
    if (!isNum(p[k])) push(`${at}.${k}`, 'bad_type', p[k]);
    else if (p[k] < lo || p[k] > hi) push(`${at}.${k}`, 'out_of_bounds', p[k]);
  }
  for (const k of BOOL_PROPS) if (p[k] != null && typeof p[k] !== 'boolean') push(`${at}.${k}`, 'bad_type', p[k]);
  for (const [k, list] of Object.entries(ENUM_PROPS)) if (p[k] != null && !list.includes(p[k])) push(`${at}.${k}`, 'bad_value', p[k]);
  if (pinsToViewport(p.style)) push(`${at}.style`, 'position_fixed', p.style);
  if (p.pattern != null) {
    if (!isObj(p.pattern)) push(`${at}.pattern`, 'bad_type', null);
    else {
      keysOnly(p.pattern, PATTERN_KEYS, `${at}.pattern`, push);
      if (!cssValueOk(p.pattern.color)) push(`${at}.pattern.color`, 'unsafe_css', p.pattern.color);
    }
  }
  const act = p.action;
  if (act != null) {
    if (!isObj(act)) push(`${at}.action`, 'bad_type', null);
    else {
      const t = buttonTarget(act);
      const type = typeof act.type === 'string' && act.type ? act.type : 'link';
      if (t.reason === 'api_removed' || t.reason === 'unknown_action') push(`${at}.action.type`, t.reason, type);
      else {
        keysOnly(act, ACTION_KEYS, `${at}.action`, push);
        if (t.reason === 'unsafe_url') push(`${at}.action.href`, 'unsafe_url', act.href);
        if (t.reason === 'bad_scroll_target') push(`${at}.action.target`, 'bad_scroll_target', act.target);
        text(act.text, LIMITS.text, `${at}.action.text`, push);
      }
    }
  }
  // A tab card's labels (phase 7a): 1 to MAX_TABS short strings.
  if (p.tabs != null) {
    if (!Array.isArray(p.tabs)) push(`${at}.tabs`, 'bad_type', null);
    else {
      if (!p.tabs.length) push(`${at}.tabs`, 'bad_value', 0);
      if (p.tabs.length > MAX_TABS) push(`${at}.tabs`, 'too_many', p.tabs.length);
      p.tabs.slice(0, MAX_TABS + 1).forEach((l, j) => text(l, TAB_LABEL_MAX, `${at}.tabs[${j}]`, push));
    }
  }
  if (p.items != null) {
    if (!Array.isArray(p.items)) push(`${at}.items`, 'bad_type', null);
    else {
      if (p.items.length > LIMITS.items) push(`${at}.items`, 'too_many', p.items.length);
      p.items.forEach((it, j) => {
        const ip = `${at}.items[${j}]`;
        if (!isObj(it)) { push(ip, 'bad_type', null); return; }
        keysOnly(it, ITEM_KEYS, ip, push);
        text(it.label, 200, `${ip}.label`, push);
        if (it.href && !safeLink(it.href)) push(`${ip}.href`, 'unsafe_url', it.href);
      });
    }
  }
}

function blockProblems(b, i, add, actx) {
  if (!isObj(b)) { add(`blocks[${i}]`, 'bad_type', null); return; }
  const bid = typeof b.id === 'string' ? b.id : '';
  const push = (path, reason, value) => add(`blocks[${i}]${path ? `.${path}` : ''}`, reason, value, bid);
  keysOnly(b, BLOCK_KEYS, '', push);
  if (b.id != null && b.id !== '' && !(typeof b.id === 'string' && ID_SHAPE.test(b.id))) push('id', 'bad_id', b.id);
  if (b.kind != null && !BLOCK_KINDS.includes(b.kind)) push('kind', 'bad_value', b.kind);
  const kind = BLOCK_KINDS.includes(b.kind) ? b.kind : 'text';
  coordOk(b.x, 'x', push); coordOk(b.y, 'y', push);
  sizeOk(b.w, 'w', push); sizeOk(b.h, 'h', push);
  if (b.z != null && !isNum(b.z)) push('z', 'bad_type', b.z);
  if (b.opacity != null && !(isNum(b.opacity) && b.opacity >= 0 && b.opacity <= 1)) push('opacity', 'bad_value', b.opacity);
  if (b.rotate != null && !(isNum(b.rotate) && Math.abs(b.rotate) <= 180)) push('rotate', 'bad_value', b.rotate);
  text(b.name, LIMITS.name, 'name', push);
  for (const k of ['locked', 'hidden']) if (b[k] != null && typeof b[k] !== 'boolean') push(k, 'bad_type', b[k]);
  if (b.shadow != null && b.shadow !== '' && !SHADOWS.includes(b.shadow)) push('shadow', 'bad_value', b.shadow);
  if (b.hover != null && b.hover !== '' && !HOVER_EFFECTS.includes(b.hover)) push('hover', 'bad_value', b.hover);
  // `link` (and a button's `props.action`, below) are the fields before phase 5, still read
  // and converted by normalizeDoc, and checked by their own rule for a page that carries them.
  if (b.link != null && b.link !== '' && (typeof b.link !== 'string' || !safeLink(b.link))) push('link', 'unsafe_url', b.link);
  // The closed action vocabulary (actions.js): every step, every field, with its path.
  actionProblems(b.action, actx, push);
  if (b.component != null) {
    if (!isObj(b.component)) push('component', 'bad_type', null);
    else {
      keysOnly(b.component, COMPONENT_KEYS, 'component', push);
      text(b.component.id, LIMITS.id, 'component.id', push);
      text(b.component.inst, LIMITS.id, 'component.inst', push);
      // Overrides belong to an instance (phase 7b), checked against its component elsewhere.
      if (b.component.overrides != null && b.kind !== 'instance') push('component.overrides', 'not_allowed', null);
      if (b.kind === 'instance' && !(typeof b.component.id === 'string' && ID_SHAPE.test(b.component.id))) push('component.id', 'bad_id', b.component.id);
    }
  } else if (b.kind === 'instance') push('component', 'required', null);
  propsProblems(kind, b.props, 'props', push);
  if (b.themes != null) {
    if (!isObj(b.themes)) push('themes', 'bad_type', null);
    else {
      keysOnly(b.themes, ['light', 'dark'], 'themes', push);
      for (const theme of ['light', 'dark']) {
        const o = b.themes[theme];
        if (o == null) continue;
        if (!isObj(o)) { push(`themes.${theme}`, 'bad_type', null); continue; }
        keysOnly(o, OVERLAY_KEYS, `themes.${theme}`, push);
        coordOk(o.x, `themes.${theme}.x`, push); coordOk(o.y, `themes.${theme}.y`, push);
        sizeOk(o.w, `themes.${theme}.w`, push); sizeOk(o.h, `themes.${theme}.h`, push);
        propsProblems(kind, o.props, `themes.${theme}.props`, push);
      }
    }
  }
  if (b.phone != null) {
    if (!isObj(b.phone)) push('phone', 'bad_type', null);
    else {
      keysOnly(b.phone, PHONE_KEYS, 'phone', push);
      coordOk(b.phone.x, 'phone.x', push); coordOk(b.phone.y, 'phone.y', push);
      sizeOk(b.phone.w, 'phone.w', push); sizeOk(b.phone.h, 'phone.h', push);
      if (b.phone.order != null && !isNum(b.phone.order)) push('phone.order', 'bad_type', b.phone.order);
    }
  }
  if (b.anim != null) {
    if (!isObj(b.anim)) push('anim', 'bad_type', null);
    else {
      keysOnly(b.anim, ANIM_KEYS, 'anim', push);
      if (!ANIM_KINDS.includes(b.anim.kind)) push('anim.kind', 'bad_value', b.anim.kind);
      if (b.anim.trigger != null && !ANIM_TRIGGERS.includes(b.anim.trigger)) push('anim.trigger', 'bad_value', b.anim.trigger);
      if (b.anim.easing != null && !ANIM_EASINGS.includes(b.anim.easing)) push('anim.easing', 'bad_value', b.anim.easing);
      text(b.anim.custom, LIMITS.custom, 'anim.custom', push);
    }
  }
}

// ── Components (PLAN-STUDIO-2026 2.6, phase 7b) ─────────────────────────────────────────

/**
 * The fields a definition exposes to its instances, strict: `[{ key, block, field, label? }]`,
 * each key a name used once, each naming a block of the definition and a field that block has
 * among EXPOSABLE_FIELDS. `push(path, reason, value)` with paths under `at`.
 */
export function exposedProblems(raw, blocks, push, at = 'exposed') {
  if (raw == null) return;
  if (!Array.isArray(raw)) { push(at, 'bad_type', null); return; }
  if (raw.length > MAX_EXPOSED) push(at, 'too_many', raw.length);
  const kinds = new Map((Array.isArray(blocks) ? blocks : []).filter(isObj).map((b) => [b.id, b.kind]));
  const seen = new Set();
  raw.slice(0, MAX_EXPOSED + 1).forEach((e, j) => {
    const p = `${at}[${j}]`;
    if (!isObj(e)) { push(p, 'bad_type', null); return; }
    keysOnly(e, EXPOSED_KEYS, p, push);
    if (typeof e.key !== 'string' || !EXPOSED_KEY.test(e.key) || reserved(e.key)) push(`${p}.key`, 'bad_id', e.key);
    else if (seen.has(e.key)) push(`${p}.key`, 'duplicate', e.key);
    else seen.add(e.key);
    if (typeof e.block !== 'string' || !kinds.has(e.block)) push(`${p}.block`, 'unknown_block', e.block);
    if (!EXPOSABLE_FIELDS.includes(e.field)) push(`${p}.field`, 'bad_value', e.field);
    else if (kinds.has(e.block) && !exposableFor(kinds.get(e.block)).includes(e.field)) push(`${p}.field`, 'not_allowed', e.field);
    text(e.label, LIMITS.name, `${p}.label`, push);
  });
}

/** A page's map of definitions: each one's fields, its document (validateDoc, with the page's
 *  map for its own instances), and what it exposes. */
function mapProblems(raw, pre, out, add, opts) {
  if (!isObj(raw)) { add('components', 'bad_type', null); return; }
  const ids = Object.keys(raw);
  if (ids.length > MAX_DOC_COMPONENTS) add('components', 'too_many', ids.length);
  for (const cid of ids.slice(0, MAX_DOC_COMPONENTS + 1)) {
    const at = `components.${cid}`;
    const push = (path, reason, value) => add(path ? `${at}.${path}` : at, reason, value, cid);
    if (!ID_SHAPE.test(cid) || reserved(cid)) { add(at, 'bad_id', cid); continue; }
    const s = raw[cid];
    if (!isObj(s)) { push('', 'bad_type', null); continue; }
    keysOnly(s, SNAPSHOT_KEYS, '', push);
    text(s.name, LIMITS.name, 'name', push);
    if (!COMPONENT_SCOPES.includes(s.scope)) push('scope', 'bad_value', s.scope);
    if (s.ref != null && !(typeof s.ref === 'string' && COMPONENT_REF.test(s.ref))) push('ref', 'bad_value', s.ref);
    if (!isObj(s.doc)) { push('doc', 'bad_type', null); continue; }
    keysOnly(s.doc, SNAPSHOT_DOC_KEYS, 'doc', push);
    const blocks = Array.isArray(s.doc.blocks) ? s.doc.blocks : [];
    if (blocks.length > MAX_COMPONENT_BLOCKS) push('doc.blocks', 'too_many', blocks.length);
    const inner = { ...s.doc, id: cid };
    delete inner.components;
    for (const p of validateDoc(inner, `${pre}${at}.doc`, { ...(opts || {}), componentsMap: raw, selfComponent: undefined })) out.push(p);
    exposedProblems(s.exposed, blocks, (path, reason, value) => push(path, reason, value), 'exposed');
  }
}

/**
 * Every instance: its component is in the map (`unknown_component`), and each override names a
 * field the component EXPOSES (`not_exposed`, whatever the key looks like) and holds a value
 * that field's own rule accepts: the definition's block with the value put in, checked like any
 * block, the problems of that field reported under the override's path.
 */
function instanceProblems(blocks, map, add, links) {
  blocks.forEach((b, i) => {
    if (!isObj(b) || b.kind !== 'instance' || !isObj(b.component)) return;
    const bid = typeof b.id === 'string' ? b.id : '';
    const at = `blocks[${i}].component`;
    const cid = b.component.id;
    const snap = isObj(own(map, cid)) ? own(map, cid) : null;
    if (typeof cid === 'string' && ID_SHAPE.test(cid) && !snap) add(`${at}.id`, 'unknown_component', cid, bid);
    const ov = b.component.overrides;
    if (ov == null) return;
    if (!isObj(ov)) { add(`${at}.overrides`, 'bad_type', null, bid); return; }
    const keys = Object.keys(ov);
    if (keys.length > MAX_EXPOSED) add(`${at}.overrides`, 'too_many', keys.length, bid);
    const exposed = snap && Array.isArray(snap.exposed) ? snap.exposed : [];
    const defBlocks = snap && isObj(snap.doc) && Array.isArray(snap.doc.blocks) ? snap.doc.blocks.filter(isObj) : [];
    const dctx = {
      links,
      blockIds: new Set(defBlocks.map((x) => (typeof x.id === 'string' ? x.id : '')).filter(Boolean)),
      containers: containerInfo(defBlocks),
    };
    for (const k of keys.slice(0, MAX_EXPOSED + 1)) {
      const kp = `${at}.overrides.${k}`;
      const e = EXPOSED_KEY.test(k) && !reserved(k) ? exposed.find((x) => isObj(x) && x.key === k) : null;
      const db = e ? defBlocks.find((x) => x.id === e.block) : null;
      if (!e || !db || !exposableFor(db.kind).includes(e.field)) { add(kp, 'not_exposed', k, bid); continue; }
      const probe = withFieldValue(db, e.field, ov[k]);
      blockProblems(probe, 0, (path, reason, value) => {
        const rel = path.replace(/^blocks\[0\]\.?/, '');
        if (rel === e.field || rel.startsWith(`${e.field}.`) || rel.startsWith(`${e.field}[`)) add(`${kp}${rel.slice(e.field.length)}`, reason, value, bid);
      }, dctx);
    }
  });
}

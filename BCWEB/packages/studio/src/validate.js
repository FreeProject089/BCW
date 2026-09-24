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
} from './canvas.js';
import { safeCssValue, decodeCssEscapes } from './css-scope.js';
import { backgroundProblems } from './background.js';

/** A page, serialised, may not be larger than this. */
export const MAX_DOC_BYTES = LIMITS.bytes;

/** The fields a document may have at the top, by version. */
const DOC_KEYS_V1 = ['id', 'title', 'height', 'phoneHeight', 'phoneBoard', 'bg', 'grid', 'css', 'blocks'];
// `background` is the closed value (background.js, phase 4). `bg` stays readable on a v2 page
// saved before phase 4 (the API tolerates what is already stored); the studio never writes it.
const DOC_KEYS_V2 = ['v', 'id', 'title', 'frames', 'background', 'bg', 'grid', 'css', 'blocks'];
/** The fields a block may have. */
export const BLOCK_KEYS = ['id', 'kind', 'x', 'y', 'w', 'h', 'z', 'props', 'opacity', 'themes', 'phone', 'anim',
  'name', 'locked', 'hidden', 'rotate', 'shadow', 'hover', 'link', 'component'];
const OVERLAY_KEYS = ['x', 'y', 'w', 'h', 'opacity', 'hidden', 'props'];
const PHONE_KEYS = ['order', 'hidden', 'h', 'x', 'y', 'w'];
const ANIM_KEYS = ['kind', 'trigger', 'delay', 'duration', 'easing', 'loop', 'custom'];
const COMPONENT_KEYS = ['id', 'inst'];
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
 * `bad_scroll_target`.
 *
 * @param {unknown} doc
 * @param {string} [prefix]  prepended to every path, e.g. `canvases[2]`
 */
export function validateDoc(doc, prefix = '') {
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
  blocks.forEach((b, i) => blockProblems(b, i, add));
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

function blockProblems(b, i, add) {
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
  if (b.link != null && b.link !== '' && (typeof b.link !== 'string' || !safeLink(b.link))) push('link', 'unsafe_url', b.link);
  if (b.component != null) {
    if (!isObj(b.component)) push('component', 'bad_type', null);
    else {
      keysOnly(b.component, COMPONENT_KEYS, 'component', push);
      text(b.component.id, LIMITS.id, 'component.id', push);
      text(b.component.inst, LIMITS.id, 'component.inst', push);
    }
  }
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

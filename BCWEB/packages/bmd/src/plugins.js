// A block B.MD does not have, added without editing B.MD.
//
// Every directive the kit draws is a branch in `remarkDocBlocks`. That is fine for the ones
// it ships and it is the whole problem for the ones it does not: a project that wants
// `:::pricing` has to fork the parser, and a fork is a copy that stops receiving the fixes.
//
// So the parser asks here first. A registered block gets the same inputs every built-in one
// has — its label, its attributes, its children — and returns either a component to render or
// a plain element description. Nothing about the pipeline changes: the block is sanitised,
// anchored and packed exactly like the rest, which is what stops a plugin being a hole in the
// sanitiser.

/** name → { component, tag, className, attrs } */
const REGISTRY = new Map();

/**
 * Add a block.
 *
 * @param {string} name  what authors write after `:::`, lowercase, `[a-z0-9-]`
 * @param {object} spec
 * @param {Function} [spec.component]  ({ node, children }) => node — rendered for this block
 * @param {string}   [spec.tag]        the element the parser emits (default: a custom tag)
 * @param {string[]} [spec.className]  classes on it
 * @param {Function} [spec.attrs]      ({ label, attrs, text }) => object of data-* to carry
 * @param {boolean}  [spec.leaf]       true for `:name[…]` text directives
 *
 * Re-registering a name replaces it, so a host can override a built-in — and the built-ins
 * are checked FIRST, so it cannot do so by accident.
 */
export function registerBlock(name, spec = {}) {
  const key = String(name || '').toLowerCase();
  if (!/^[a-z][a-z0-9-]*$/.test(key)) throw new Error(`B.MD: "${name}" is not a usable block name`);
  REGISTRY.set(key, spec);
  return () => REGISTRY.delete(key);
}

/** Every registered name — the parser reads this to know what to accept. */
export const blockNames = () => [...REGISTRY.keys()];

/** One block's spec, or undefined. */
export const blockSpec = (name) => REGISTRY.get(String(name || '').toLowerCase());

/**
 * The tag a registered block emits.
 *
 * Prefixed, and that prefix is doing real work: `doc-x-<name>` cannot collide with an HTML
 * element, with one of the kit's own `doc-*` tags, or with another plugin — and it is what
 * the sanitiser is told to keep, so a plugin cannot widen the schema by picking a tag name.
 */
export const blockTag = (name) => `doc-x-${String(name).toLowerCase()}`;

/** The component map the renderer merges in. */
export function blockComponents() {
  const out = {};
  for (const [name, spec] of REGISTRY) {
    if (typeof spec.component === 'function') out[blockTag(name)] = spec.component;
  }
  return out;
}

/** The tags and attributes the sanitiser must let through for the registered blocks. */
export function blockSanitizeRules() {
  const tagNames = [];
  const attributes = {};
  for (const [name] of REGISTRY) {
    const tag = blockTag(name);
    tagNames.push(tag);
    // `data*` is the hast (camelCased) form and covers every `data-…` a spec emits. Nothing
    // else is allowed: a plugin may carry data, not an `onclick`.
    attributes[tag] = ['className', 'id', 'data*'];
  }
  return { tagNames, attributes };
}

// A project's own catalogues (G4), official project or "other project" alike.
//
// Stored as ONE AdminSetting row per project, never inside the project's page config:
//   catalogs.project.<key>    an official project (Project row, key)
//   catalogs.showcase.<id>    an other project (ShowcaseProject row, id — a slug can change)
// Apart from the page config on purpose. The page config is a free-form blob a studio save
// rewrites whole, and a catalogue list riding inside it would be lost to the first editor who
// saved the page from a tab opened before the catalogue was added.
//
// A catalogue is one of two FORMATS:
//   bmm     the established catalog.json feed, from one of three sources:
//             official   this project's own CatalogItem rows of one kind (official projects only)
//             community  a hosted community catalogue, linked by slug
//             inline     a catalog.json the editor uploaded, validated like a raw community feed
//   custom  a declared schema (fields) and the entries filling it, shown as a generic card grid
//
// Everything here is PURE: the schema, the normalisation and the feed. Routes do the DB and
// the permission question (routes/project-catalogs.mjs).
import crypto from 'node:crypto';
import { z } from 'zod';
import { httpUrl } from './lib.mjs';
import { CATALOG_KINDS } from './catalog-kinds.mjs';

export const SCOPES = ['project', 'showcase'];
export const settingKeyFor = (scope, ref) => `catalogs.${scope}.${ref}`;

/**
 * The tags every catalogue offers, with their icon. A project adds its own on top.
 *
 * Icon names are from the markdown kit's CURATED set (packages/bmd/src/icons.jsx), so a tag
 * dropdown draws from the bundle and never fetches a mask from a CDN.
 */
export const BUILTIN_TAGS = Object.freeze([
  { key: 'utility', label: 'Utility', labelFr: 'Utilitaire', icon: 'wrench' },
  { key: 'interface', label: 'Interface', labelFr: 'Interface', icon: 'palette' },
  { key: 'performance', label: 'Performance', labelFr: 'Performances', icon: 'zap' },
  { key: 'gameplay', label: 'Gameplay', labelFr: 'Gameplay', icon: 'play' },
  { key: 'quality-of-life', label: 'Quality of life', labelFr: 'Confort', icon: 'sparkles' },
  { key: 'audio', label: 'Audio', labelFr: 'Audio', icon: 'file-audio' },
  { key: 'graphics', label: 'Graphics', labelFr: 'Graphismes', icon: 'file-image' },
  { key: 'automation', label: 'Automation', labelFr: 'Automatisation', icon: 'clock' },
  { key: 'backup', label: 'Backup', labelFr: 'Sauvegarde', icon: 'database' },
  { key: 'security', label: 'Security', labelFr: 'Sécurité', icon: 'shield' },
  { key: 'network', label: 'Network', labelFr: 'Réseau', icon: 'globe' },
  { key: 'multiplayer', label: 'Multiplayer', labelFr: 'Multijoueur', icon: 'users' },
  { key: 'developer', label: 'Developer', labelFr: 'Développeurs', icon: 'code' },
  { key: 'scripting', label: 'Scripting', labelFr: 'Scripts', icon: 'terminal' },
  { key: 'library', label: 'Library', labelFr: 'Bibliothèque', icon: 'book' },
  { key: 'translation', label: 'Translation', labelFr: 'Traduction', icon: 'file-text' },
  { key: 'fix', label: 'Fix', labelFr: 'Correctif', icon: 'bug' },
  { key: 'hardware', label: 'Hardware', labelFr: 'Matériel', icon: 'cpu' },
]);

/** The formats of BMM-native feeds an editor may upload inline, and the array each carries. */
export const INLINE_KINDS = { APP: 'apps', PLUGIN: 'plugins', THEME: 'themes', PRESET: 'presets' };
export const FIELD_TYPES = ['text', 'longtext', 'url', 'image', 'number', 'date', 'version', 'tags'];

export const LIMITS = Object.freeze({ catalogs: 12, tags: 40, fields: 16, entries: 300, inlineEntries: 500, bytes: 600 * 1024 });

// An IconGlyph name: lucide (`wrench`), a brand (`simple:github`), phosphor (`ph-bold:rocket`)
// or a project logo (`app:bmm`). Never a URL: an icon is drawn from the kit, not fetched.
const ICON_NAME = /^[a-z0-9]+(?:[-:][a-z0-9]+)*$/;
const iconName = z.string().max(60).regex(ICON_NAME);
export const TAG_KEY = /^[a-z0-9][a-z0-9-]{0,23}$/;
const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const FIELD_KEY = /^[a-z][a-z0-9_]{0,31}$/;

const tagSchema = z.object({
  key: z.string().regex(TAG_KEY),
  label: z.string().trim().min(1).max(40),
  labelFr: z.string().trim().max(40).optional(),
  icon: iconName.default('hash'),
}).strict();

const fieldSchema = z.object({
  key: z.string().regex(FIELD_KEY),
  label: z.string().trim().min(1).max(40),
  labelFr: z.string().trim().max(40).optional(),
  type: z.enum(FIELD_TYPES),
  card: z.boolean().default(true),
  required: z.boolean().default(false),
}).strict();

const catalogBase = {
  id: z.string().regex(ID),
  name: z.string().trim().min(2).max(80),
  description: z.string().max(500).default(''),
  icon: iconName.optional(),
};

const bmmCatalog = z.object({
  ...catalogBase,
  format: z.literal('bmm'),
  source: z.enum(['official', 'community', 'inline']),
  kind: z.enum(CATALOG_KINDS).default('APP'),
  communitySlug: z.string().max(120).regex(/^[a-z0-9][a-z0-9-]*$/).optional(),
  // Checked item by item in normalizeConfig (only the one array the kind reads is kept).
  feed: z.record(z.any()).optional(),
}).strict();

const customCatalog = z.object({
  ...catalogBase,
  format: z.literal('custom'),
  fields: z.array(fieldSchema).min(1).max(LIMITS.fields),
  entries: z.array(z.record(z.any())).max(LIMITS.entries).default([]),
}).strict();

export const configSchema = z.object({
  enabled: z.boolean().default(true),
  tags: z.array(tagSchema).max(LIMITS.tags).default([]),
  catalogs: z.array(z.discriminatedUnion('format', [bmmCatalog, customCatalog])).max(LIMITS.catalogs).default([]),
}).strict();

export const EMPTY_CONFIG = Object.freeze({ enabled: true, tags: [], catalogs: [] });

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isHttp = (v) => httpUrl().safeParse(v).success;

/** One value of a custom entry, checked against its field. Returns [ok, value | error]. */
function checkValue(field, v, tagKeys) {
  if (v == null || v === '' || (Array.isArray(v) && !v.length)) return [true, undefined];
  switch (field.type) {
    case 'text': return typeof v === 'string' && v.length <= 300 ? [true, v.trim()] : [false, 'text'];
    case 'longtext': return typeof v === 'string' && v.length <= 4000 ? [true, v] : [false, 'longtext'];
    case 'version': return typeof v === 'string' && v.length <= 24 ? [true, v.trim()] : [false, 'version'];
    // http(s) only. `z.string().url()` accepts javascript: and data:, and these values end up
    // in an <a href> and an <img src> on a public page.
    case 'url': case 'image': return typeof v === 'string' && isHttp(v.trim()) ? [true, v.trim()] : [false, 'url'];
    case 'number': { const n = typeof v === 'number' ? v : Number(v); return Number.isFinite(n) ? [true, n] : [false, 'number']; }
    case 'date': return typeof v === 'string' && DATE.test(v) ? [true, v] : [false, 'date'];
    case 'tags': {
      if (!Array.isArray(v) || v.length > 12) return [false, 'tags'];
      const out = [...new Set(v.map(String))];
      return out.every((k) => tagKeys.has(k)) ? [true, out] : [false, 'unknown_tag'];
    }
    default: return [false, 'type'];
  }
}

/** The inline feed, narrowed to the one array its kind is read from, each entry an object. */
function normalizeFeed(kind, feed) {
  const field = INLINE_KINDS[kind];
  if (!field) return { error: 'inline_kind_unsupported' };
  const arr = feed?.[field];
  if (!Array.isArray(arr)) return { error: 'feed_missing_array', field };
  if (arr.length > LIMITS.inlineEntries) return { error: 'feed_too_many' };
  if (!arr.every((x) => x && typeof x === 'object' && !Array.isArray(x))) return { error: 'feed_bad_entry' };
  return { feed: { version: String(feed.version || '1.0').slice(0, 16), name: String(feed.name || '').slice(0, 120), [field]: arr } };
}

/**
 * Validate a whole config and bring it to its stored shape.
 *
 * Returns `{ config }` or `{ error, path? }`. `isOfficial` says whether the `official` source
 * is allowed (a showcase project owns no CatalogItem rows, so an official source there would
 * be a feed that is always empty).
 */
export function normalizeConfig(input, { isOfficial }) {
  const parsed = configSchema.safeParse(input);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return { error: 'invalid_config', path: (i?.path || []).join('.') };
  }
  const cfg = parsed.data;
  const tagKeys = new Set([...BUILTIN_TAGS.map((t) => t.key), ...cfg.tags.map((t) => t.key)]);
  if (new Set(cfg.tags.map((t) => t.key)).size !== cfg.tags.length) return { error: 'duplicate_tag' };
  if (cfg.tags.some((t) => BUILTIN_TAGS.some((b) => b.key === t.key))) return { error: 'tag_is_builtin' };
  if (new Set(cfg.catalogs.map((c) => c.id)).size !== cfg.catalogs.length) return { error: 'duplicate_catalog_id' };
  const catalogs = [];
  for (const [ci, c] of cfg.catalogs.entries()) {
    if (c.format === 'bmm') {
      const out = { id: c.id, name: c.name, description: c.description, ...(c.icon ? { icon: c.icon } : {}), format: 'bmm', source: c.source, kind: c.kind };
      if (c.source === 'official' && !isOfficial) return { error: 'official_source_needs_official_project', path: `catalogs.${ci}` };
      if (c.source === 'community') {
        if (!c.communitySlug) return { error: 'community_slug_required', path: `catalogs.${ci}` };
        out.communitySlug = c.communitySlug;
      }
      if (c.source === 'inline') {
        const f = normalizeFeed(c.kind, c.feed);
        if (f.error) return { error: f.error, path: `catalogs.${ci}`, ...(f.field ? { field: f.field } : {}) };
        out.feed = f.feed;
      }
      catalogs.push(out);
      continue;
    }
    if (new Set(c.fields.map((f) => f.key)).size !== c.fields.length) return { error: 'duplicate_field', path: `catalogs.${ci}` };
    const entries = [];
    const seen = new Set();
    for (const [ei, e] of c.entries.entries()) {
      const row = {};
      // An id per entry so a shared link can point at one card. Kept when valid and unique,
      // minted otherwise: an editor pasting a list should not have to invent ids.
      let id = typeof e.id === 'string' && ID.test(e.id) && !seen.has(e.id) ? e.id : null;
      if (!id) do { id = crypto.randomBytes(4).toString('hex'); } while (seen.has(id));
      seen.add(id);
      for (const f of c.fields) {
        const [ok, v] = checkValue(f, e[f.key], tagKeys);
        if (!ok) return { error: `invalid_value_${v}`, path: `catalogs.${ci}.entries.${ei}.${f.key}` };
        if (v === undefined) {
          if (f.required) return { error: 'required_value', path: `catalogs.${ci}.entries.${ei}.${f.key}` };
          continue;
        }
        row[f.key] = v;
      }
      entries.push({ id, ...row });
    }
    catalogs.push({ id: c.id, name: c.name, description: c.description, ...(c.icon ? { icon: c.icon } : {}), format: 'custom', fields: c.fields, entries });
  }
  const config = { enabled: cfg.enabled, tags: cfg.tags, catalogs };
  if (Buffer.byteLength(JSON.stringify(config)) > LIMITS.bytes) return { error: 'config_too_large', max: LIMITS.bytes };
  return { config };
}

/** Every http(s) address a config points at, for the URL blocklist. */
export function urlsOfConfig(config) {
  const out = [];
  const walk = (v, depth = 0) => {
    if (depth > 6 || v == null) return;
    if (typeof v === 'string') { if (/^https?:\/\//i.test(v)) out.push(v); return; }
    if (Array.isArray(v)) { for (const x of v) walk(x, depth + 1); return; }
    if (typeof v === 'object') for (const x of Object.values(v)) walk(x, depth + 1);
  };
  walk(config?.catalogs || []);
  return [...new Set(out)];
}

/** Tags this project offers: the built-in set, then its own. */
export const tagsFor = (config) => [...BUILTIN_TAGS, ...(config?.tags || [])];

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const safeUrl = (v) => (typeof v === 'string' && isHttp(v) ? v : null);

/**
 * An inline feed's entries as a reader sees them. Whitelisted field by field: the feed is
 * editor-supplied JSON (passthrough), so spreading it would publish whatever was in there,
 * and every link is dropped unless it is http(s).
 */
export function inlineDisplay(kind, feed) {
  const arr = feed?.[INLINE_KINDS[kind]] || [];
  return arr.map((x, i) => ({
    id: str(x.id, 80) || String(i),
    name: str(x.title || x.name || x.id, 120) || '—',
    description: str(x.description, 1000),
    version: str(x.version, 24),
    author: str(x.author, 80),
    tags: Array.isArray(x.tags) ? x.tags.filter((t) => typeof t === 'string').slice(0, 12).map((t) => t.slice(0, 24)) : [],
    url: safeUrl(x.download?.url || x.download_url || x.url),
    icon: safeUrl(x.icon_url || x.images?.thumb || x.thumb),
  }));
}

/** A catalogue without its bulk, for lists. */
export function catalogSummary(c) {
  const count = c.format === 'custom' ? c.entries.length : c.source === 'inline' ? (c.feed?.[INLINE_KINDS[c.kind]] || []).length : null;
  return { id: c.id, name: c.name, description: c.description, icon: c.icon || null, format: c.format, source: c.source || null, kind: c.format === 'bmm' ? c.kind : null, count };
}

/** The feed a client downloads. Inline → the BMM-native document; custom → its own schema. */
export function feedOf(c, projectName) {
  if (c.format === 'custom') {
    return { version: '1.0', format: 'custom', name: c.name, description: c.description, project: projectName || null, fields: c.fields, entries: c.entries };
  }
  const field = INLINE_KINDS[c.kind];
  return { version: c.feed?.version || '1.0', name: c.feed?.name || c.name, [field]: c.feed?.[field] || [] };
}

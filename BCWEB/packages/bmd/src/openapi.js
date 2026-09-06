// An OpenAPI document, written out as B.MD.
//
// Two readers: the `::openapi{src=…}` block, which fetches a spec and draws it through
// `<Markdown>` like any other document, and the /dev/tools generator, which hands the same
// markdown to somebody who wants to paste it into a page and edit it. One function so the two
// cannot disagree about what an endpoint looks like.
//
// Plain JS, no React, no fetch: given a parsed spec (OpenAPI 3.x, and enough of Swagger 2 to
// be useful), it returns a string. What is drawn from that string is `:::api`'s business.

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];

const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n+/g, ' ').trim();
const q = (s) => `"${String(s ?? '').replace(/"/g, '\\"').replace(/\r?\n+/g, ' ').trim()}"`;

/** `#/components/schemas/Foo` → the schema, when the spec has it. */
function deref(spec, node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 8) return node;
  if (typeof node.$ref === 'string') {
    const path = node.$ref.replace(/^#\//, '').split('/');
    let cur = spec;
    for (const seg of path) { cur = cur?.[seg.replace(/~1/g, '/').replace(/~0/g, '~')]; if (cur == null) return node; }
    return deref(spec, cur, depth + 1);
  }
  return node;
}

/** A schema, said in a few words: `string`, `integer (int64)`, `array<Item>`, `object {a, b}`. */
export function schemaLabel(spec, schema, depth = 0) {
  const s = deref(spec, schema, depth);
  if (!s || typeof s !== 'object') return '';
  if (Array.isArray(s.enum)) return s.enum.map((v) => `\`${v}\``).join(' · ');
  if (s.oneOf || s.anyOf) return (s.oneOf || s.anyOf).map((x) => schemaLabel(spec, x, depth + 1)).filter(Boolean).join(' | ');
  if (s.type === 'array') return `array<${schemaLabel(spec, s.items, depth + 1) || 'any'}>`;
  if (s.type === 'object' || s.properties) {
    const keys = Object.keys(s.properties || {});
    return keys.length && depth < 2 ? `object {${keys.slice(0, 8).join(', ')}${keys.length > 8 ? ', …' : ''}}` : 'object';
  }
  return [s.type, s.format ? `(${s.format})` : ''].filter(Boolean).join(' ') || (s.$ref ? String(s.$ref).split('/').pop() : 'any');
}

/** A JSON example for a schema — the `example` when the spec gives one, a sketch otherwise. */
export function schemaExample(spec, schema, depth = 0) {
  const s = deref(spec, schema, depth);
  if (!s || typeof s !== 'object' || depth > 5) return null;
  if (s.example !== undefined) return s.example;
  if (Array.isArray(s.examples) && s.examples.length) return s.examples[0];
  if (s.default !== undefined) return s.default;
  if (Array.isArray(s.enum)) return s.enum[0];
  if (s.oneOf || s.anyOf) return schemaExample(spec, (s.oneOf || s.anyOf)[0], depth + 1);
  if (s.type === 'array') { const it = schemaExample(spec, s.items, depth + 1); return it == null ? [] : [it]; }
  if (s.type === 'object' || s.properties) {
    const out = {};
    for (const [k, v] of Object.entries(s.properties || {})) out[k] = schemaExample(spec, v, depth + 1);
    return out;
  }
  if (s.type === 'integer' || s.type === 'number') return 0;
  if (s.type === 'boolean') return true;
  if (s.type === 'string') return s.format === 'date-time' ? '2026-01-01T00:00:00Z' : s.format === 'date' ? '2026-01-01' : s.format === 'email' ? 'me@example.com' : s.format === 'uri' ? 'https://example.com' : 'string';
  return null;
}

/** The parameters table of one operation (path + operation level, path level first). */
function paramsTable(spec, pathItem, op) {
  const all = [...(pathItem.parameters || []), ...(op.parameters || [])].map((p) => deref(spec, p));
  // An operation-level parameter overrides a path-level one with the same name and place.
  const seen = new Map();
  for (const p of all) if (p?.name) seen.set(`${p.in}:${p.name}`, p);
  const rows = [...seen.values()];
  if (!rows.length) return '';
  return [
    '| Name | In | Type | Required | Description |',
    '|---|---|---|---|---|',
    ...rows.map((p) => `| \`${esc(p.name)}\` | ${esc(p.in)} | ${esc(schemaLabel(spec, p.schema || p))} | ${p.required ? 'yes' : '—'} | ${esc(p.description || '')} |`),
  ].join('\n');
}

function bodySection(spec, op) {
  const rb = deref(spec, op.requestBody);
  const content = rb?.content || {};
  const [ctype, media] = Object.entries(content)[0] || [];
  if (!ctype) return '';
  const schema = media?.schema;
  const ex = media?.example ?? (media?.examples ? Object.values(media.examples)[0]?.value : undefined) ?? schemaExample(spec, schema);
  const lines = [':::request', `${esc(rb.description || '')}${rb.required ? ' (required)' : ''} — \`${ctype}\`${schema ? ` · ${schemaLabel(spec, schema)}` : ''}`.replace(/^ — /, '')];
  if (ex != null && /json/.test(ctype)) lines.push('', '```json', JSON.stringify(ex, null, 2), '```');
  lines.push(':::');
  return lines.join('\n');
}

function responsesSection(spec, op) {
  const out = [];
  for (const [status, r0] of Object.entries(op.responses || {})) {
    const r = deref(spec, r0);
    const [ctype, media] = Object.entries(r?.content || {})[0] || [];
    const ex = media?.example ?? (media?.examples ? Object.values(media.examples)[0]?.value : undefined) ?? (media?.schema ? schemaExample(spec, media.schema) : undefined);
    const lines = [`:::response{status=${status}}`, esc(r?.description || '') + (ctype ? ` — \`${ctype}\`` : '')];
    if (ex != null && /json/.test(ctype || '')) lines.push('', '```json', JSON.stringify(ex, null, 2), '```');
    lines.push(':::');
    out.push(lines.join('\n'));
  }
  return out.join('\n');
}

function authOf(spec, op) {
  const sec = op.security ?? spec.security;
  if (!Array.isArray(sec) || !sec.length) return '';
  const names = sec.flatMap((s) => Object.keys(s || {}));
  if (!names.length) return 'none';
  const schemes = spec.components?.securitySchemes || spec.securityDefinitions || {};
  return names.map((n) => { const s = schemes[n]; return s?.type === 'http' ? (s.scheme || 'http') : s?.type === 'apiKey' ? `key (${s.in}: ${s.name})` : s?.type || n; }).join(', ');
}

/**
 * The whole spec, or the part of it that matches, as B.MD.
 *
 * @param {object} spec        a parsed OpenAPI 3.x / Swagger 2 document
 * @param {object} [opt]
 * @param {string} [opt.tag]     only operations carrying this tag
 * @param {string} [opt.filter]  only paths starting with this prefix
 * @param {boolean} [opt.header] a title + servers block on top (default true)
 * @param {boolean} [opt.toc]    a `::toc` after the header
 */
export function openapiToBmd(spec, opt = {}) {
  if (!spec || typeof spec !== 'object') return '';
  const info = spec.info || {};
  const out = [];
  if (opt.header !== false) {
    out.push(`# ${esc(info.title || 'API')}${info.version ? ` :badge[v${esc(info.version)}]` : ''}`);
    if (info.description) out.push('', String(info.description).trim());
    const servers = Array.isArray(spec.servers) ? spec.servers.map((s) => s.url).filter(Boolean)
      : spec.host ? [`${(spec.schemes || ['https'])[0]}://${spec.host}${spec.basePath || ''}`] : [];
    if (servers.length) out.push('', ':::info[Base URL]', servers.map((u) => `\`${u}\``).join(' · '), ':::');
    if (opt.toc) out.push('', '::toc');
  }
  const groups = new Map();
  for (const [path, item0] of Object.entries(spec.paths || {})) {
    if (opt.filter && !path.startsWith(opt.filter)) continue;
    const item = deref(spec, item0) || {};
    for (const m of METHODS) {
      const op = item[m];
      if (!op) continue;
      if (opt.tag && !(op.tags || []).includes(opt.tag)) continue;
      const tag = (op.tags || ['Endpoints'])[0];
      if (!groups.has(tag)) groups.set(tag, []);
      groups.get(tag).push({ path, method: m.toUpperCase(), item, op });
    }
  }
  for (const [tag, ops] of groups) {
    if (groups.size > 1 || !opt.tag) out.push('', `## ${esc(tag)}`);
    const tagInfo = (spec.tags || []).find((t) => t.name === tag);
    if (tagInfo?.description) out.push('', String(tagInfo.description).trim());
    for (const { path, method, item, op } of ops) {
      const attrs = [];
      const auth = authOf(spec, op); if (auth) attrs.push(`auth=${q(auth)}`);
      if (op.summary) attrs.push(`summary=${q(op.summary)}`);
      if (op.deprecated) attrs.push('deprecated');
      out.push('', `:::api[${method} ${path}]${attrs.length ? `{${attrs.join(' ')}}` : ''}`);
      if (op.description) out.push(String(op.description).trim(), '');
      const params = paramsTable(spec, item, op);
      if (params) out.push(':::params', params, ':::');
      const body = bodySection(spec, op);
      if (body) out.push(body);
      const res = responsesSection(spec, op);
      if (res) out.push(res);
      out.push(':::');
    }
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/** Counts, for a tool that wants to say "42 operations across 6 tags" before generating. */
export function openapiSummary(spec) {
  const paths = Object.keys(spec?.paths || {});
  let ops = 0; const tags = new Set();
  for (const p of paths) for (const m of METHODS) { const op = spec.paths[p]?.[m]; if (op) { ops++; for (const t of op.tags || []) tags.add(t); } }
  return { title: spec?.info?.title || '', version: spec?.info?.version || '', paths: paths.length, operations: ops, tags: [...tags] };
}

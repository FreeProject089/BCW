// The studio's saved components: what the API accepts and stores per user.
//
// A component is a named group of canvas blocks an author keeps to reuse across pages (see
// apps/web/src/lib/studio-components.js for how the studio builds and places them). The API
// stores the list as ONE JSON value per user — components are personal, small, and read as a
// whole when the studio opens, so a row per component would be a table for nothing.
//
// Storage is the key/value AdminSetting store under `studio.components:<userId>`: no new
// Prisma model, no migration, and the same store the site's own settings live in. Pure
// validation here, tested in test/studio-components.test.mjs; routes/studio.mjs is the HTTP.
import { z } from 'zod';

export const COMPONENT_LIMITS = { count: 60, blocks: 40, name: 60, bytes: 512 * 1024 };

export const storageKey = (userId) => `studio.components:${userId}`;

// A block is free-form canvas JSON; the renderer normalises it (lib/canvas.js) and refuses
// anything it does not understand, so the API checks shape and size, not every field.
const blockSchema = z.object({
  kind: z.string().max(20),
  x: z.number().finite(), y: z.number().finite(), w: z.number().finite(), h: z.number().finite(),
  z: z.number().finite().optional(),
  props: z.record(z.any()).optional(),
}).passthrough();

export const componentSchema = z.object({
  id: z.string().min(1).max(60).regex(/^[A-Za-z0-9_-]+$/),
  name: z.string().min(1).max(COMPONENT_LIMITS.name),
  w: z.number().finite().nonnegative().optional(),
  h: z.number().finite().nonnegative().optional(),
  blocks: z.array(blockSchema).min(1).max(COMPONENT_LIMITS.blocks),
  createdAt: z.string().max(40).optional(),
});

export const listSchema = z.object({ components: z.array(componentSchema).max(COMPONENT_LIMITS.count) });

/**
 * Validate a PUT body. Returns `{ ok: true, components }` or `{ ok: false, error }`.
 * Duplicate ids collapse to the first — two components with one id would be one the studio
 * could never tell apart, and "update all copies" would rebuild them from whichever it found.
 */
export function parseComponentList(body) {
  const size = Buffer.byteLength(JSON.stringify(body ?? null), 'utf8');
  if (size > COMPONENT_LIMITS.bytes) return { ok: false, error: 'too_large' };
  const b = listSchema.safeParse(body);
  if (!b.success) return { ok: false, error: 'invalid_input' };
  const seen = new Set();
  const components = [];
  for (const c of b.data.components) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    components.push({ ...c, name: c.name.trim() || 'Component' });
  }
  return { ok: true, components };
}

/** Whatever is in the store, as a list — an old or hand-edited value never breaks the GET. */
export function readStored(value) {
  const list = value && typeof value === 'object' && Array.isArray(value.components) ? value.components : [];
  return list.filter((c) => c && typeof c === 'object' && typeof c.id === 'string' && Array.isArray(c.blocks) && c.blocks.length);
}

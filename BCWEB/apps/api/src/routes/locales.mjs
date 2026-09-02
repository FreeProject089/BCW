import { z } from 'zod';
import { db, requireCap, logAudit } from '../lib/lib.mjs';
import { clientIp } from '../lib/geo.mjs';
import {
  RESERVED_CODES, isValidLocaleCode, normalizeCode, publicLocaleList, sanitizeStrings,
} from '../lib/locales.mjs';

// B9 Phase 1 — runtime languages: the read path every page needs, plus admin CRUD.
// The compiled en/fr are the base; a runtime locale is a partial override with English
// fallback, so a half-translated language never breaks a page.

export default async function localeRoutes(app) {
  // Public: the picker list = compiled base + enabled runtime locales. Small and cached.
  app.get('/site/locales', async (req, reply) => {
    const p = await db();
    const rows = await p.siteLocale.findMany({
      where: { enabled: true },
      select: { code: true, nativeName: true, rtl: true, enabled: true, order: true },
    });
    reply.header('Cache-Control', 'public, max-age=60');
    return { locales: publicLocaleList(rows) };
  });

  // Public: the string map for ONE runtime locale (en/fr are compiled, so they return empty —
  // the client already holds them). Cached; unknown/disabled locale → empty, never an error, so
  // a stale client that asks for a removed language just falls back to English.
  app.get('/site/i18n/:code', async (req, reply) => {
    const code = normalizeCode(req.params.code);
    reply.header('Cache-Control', 'public, max-age=60');
    const p = await db();
    const row = await p.siteLocale.findUnique({ where: { code } });
    // en/fr are the COMPILED base — the client already holds the dictionary. A base row here is
    // an OVERRIDE layer (typo fixes / rewording) applied on top, so it returns its strings when
    // one exists, else empty. Every other code is a runtime locale (partial + English fallback).
    if (RESERVED_CODES.has(code)) return { code, rtl: false, strings: row ? sanitizeStrings(row.strings) : {} };
    if (!row || !row.enabled) return { code, rtl: false, strings: {} };
    return { code: row.code, rtl: !!row.rtl, strings: sanitizeStrings(row.strings) };
  });

  // ── Admin ───────────────────────────────────────────────────────────────────
  app.get('/admin/locales', { preHandler: requireCap('translate_site') }, async () => {
    const p = await db();
    const rows = await p.siteLocale.findMany({ orderBy: [{ order: 'asc' }, { code: 'asc' }] });
    // en/fr may exist as base-OVERRIDE rows (edited via /admin/locales/base) — they are not
    // "extra languages", so they never belong in this list; the base editor owns them. Report
    // their override key counts separately so the UI can show "N base strings changed".
    const baseCounts = {};
    for (const r of rows) if (RESERVED_CODES.has(r.code)) baseCounts[r.code] = Object.keys(sanitizeStrings(r.strings)).length;
    const extra = rows.filter((r) => !RESERVED_CODES.has(r.code));
    // Report the key count rather than shipping every dictionary to the list screen.
    return {
      base: ['en', 'fr'],
      baseCounts,
      locales: extra.map((r) => ({
        code: r.code, nativeName: r.nativeName, englishName: r.englishName, rtl: r.rtl,
        enabled: r.enabled, order: r.order, translatedKeys: Object.keys(sanitizeStrings(r.strings)).length,
        updatedAt: r.updatedAt,
      })),
    };
  });

  // The full dictionary for one locale — for the admin editor.
  app.get('/admin/locales/:code', { preHandler: requireCap('translate_site') }, async (req, reply) => {
    const p = await db();
    const row = await p.siteLocale.findUnique({ where: { code: normalizeCode(req.params.code) } });
    if (!row) return reply.code(404).send({ error: 'not_found' });
    return {
      code: row.code, nativeName: row.nativeName, englishName: row.englishName, rtl: row.rtl,
      enabled: row.enabled, order: row.order, strings: sanitizeStrings(row.strings),
    };
  });

  app.post('/admin/locales', { preHandler: requireCap('translate_site') }, async (req, reply) => {
    const body = z.object({
      code: z.string(), nativeName: z.string().min(1).max(80),
      englishName: z.string().max(80).optional(), rtl: z.boolean().optional(),
      order: z.number().int().optional(),
    }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'bad_request' });
    const code = normalizeCode(body.data.code);
    // en/fr are the compiled base; they are never rows.
    if (RESERVED_CODES.has(code)) return reply.code(400).send({ error: 'reserved_code' });
    if (!isValidLocaleCode(code)) return reply.code(400).send({ error: 'bad_code' });
    const p = await db();
    if (await p.siteLocale.findUnique({ where: { code } })) return reply.code(409).send({ error: 'exists' });
    const row = await p.siteLocale.create({
      data: {
        code, nativeName: body.data.nativeName, englishName: body.data.englishName || '',
        rtl: body.data.rtl === true, order: body.data.order ?? 0, strings: {},
      },
    });
    await logAudit(p, req.user.uid, 'locale.create', `${code} (${row.nativeName})${row.rtl ? ' rtl' : ''}`, clientIp(req)).catch(() => {});
    return reply.code(201).send({ ok: true, code: row.code });
  });

  // Update meta / enabled / rtl / order, and/or the strings. `strings` REPLACES the map when a
  // full object is sent; `patch` merges a partial set of keys (empty value deletes a key).
  app.put('/admin/locales/:code', { preHandler: requireCap('translate_site') }, async (req, reply) => {
    const code = normalizeCode(req.params.code);
    if (RESERVED_CODES.has(code)) return reply.code(400).send({ error: 'reserved_code' });
    const body = z.object({
      nativeName: z.string().min(1).max(80).optional(),
      englishName: z.string().max(80).optional(),
      rtl: z.boolean().optional(),
      enabled: z.boolean().optional(),
      order: z.number().int().optional(),
      strings: z.record(z.string()).optional(),
      patch: z.record(z.string()).optional(),
    }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'bad_request' });
    const p = await db();
    const row = await p.siteLocale.findUnique({ where: { code } });
    if (!row) return reply.code(404).send({ error: 'not_found' });

    const data = {};
    if (body.data.nativeName !== undefined) data.nativeName = body.data.nativeName;
    if (body.data.englishName !== undefined) data.englishName = body.data.englishName;
    if (body.data.rtl !== undefined) data.rtl = body.data.rtl;
    if (body.data.enabled !== undefined) data.enabled = body.data.enabled;
    if (body.data.order !== undefined) data.order = body.data.order;
    if (body.data.strings !== undefined) {
      data.strings = sanitizeStrings(body.data.strings);
    } else if (body.data.patch !== undefined) {
      const merged = { ...sanitizeStrings(row.strings) };
      for (const [k, v] of Object.entries(body.data.patch)) {
        if (v === '') delete merged[k]; else merged[k] = v;
      }
      data.strings = merged;
    }
    const next = await p.siteLocale.update({ where: { code }, data });
    await logAudit(p, req.user.uid, 'locale.update', `${code}${data.strings ? ` strings=${Object.keys(data.strings).length}` : ''}`, clientIp(req)).catch(() => {});
    return { ok: true, code: next.code, translatedKeys: Object.keys(sanitizeStrings(next.strings)).length };
  });

  app.delete('/admin/locales/:code', { preHandler: requireCap('translate_site') }, async (req, reply) => {
    const code = normalizeCode(req.params.code);
    if (RESERVED_CODES.has(code)) return reply.code(400).send({ error: 'reserved_code' });
    const p = await db();
    const row = await p.siteLocale.findUnique({ where: { code } });
    if (!row) return reply.code(404).send({ error: 'not_found' });
    await p.siteLocale.delete({ where: { code } });
    await logAudit(p, req.user.uid, 'locale.delete', `${code} (${row.nativeName})`, clientIp(req)).catch(() => {});
    return { ok: true };
  });

  // ── en/fr base overrides ──────────────────────────────────────────────────────
  // The compiled en/fr dictionaries are the base; these are an override layer stored as a
  // SiteLocale row for 'en'/'fr' (which the normal create/meta routes refuse). Editing a
  // base string here corrects the shipped copy for everyone without a redeploy, and clearing
  // it (empty value) falls back to the compiled string — so it is always reversible. Gated by
  // translate_site like the rest of this file; admins pass via hasCap.
  const isBase = (c) => c === 'en' || c === 'fr';
  const baseNative = (c) => (c === 'en' ? 'English' : 'Français');
  app.get('/admin/locales/base/:code', { preHandler: requireCap('translate_site') }, async (req, reply) => {
    const code = normalizeCode(req.params.code);
    if (!isBase(code)) return reply.code(400).send({ error: 'not_base' });
    const p = await db();
    const row = await p.siteLocale.findUnique({ where: { code } });
    return { code, base: true, strings: row ? sanitizeStrings(row.strings) : {} };
  });
  app.put('/admin/locales/base/:code', { preHandler: requireCap('translate_site') }, async (req, reply) => {
    const code = normalizeCode(req.params.code);
    if (!isBase(code)) return reply.code(400).send({ error: 'not_base' });
    const body = z.object({
      strings: z.record(z.string()).optional(),
      patch: z.record(z.string()).optional(),
    }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'bad_request' });
    const p = await db();
    const row = await p.siteLocale.findUnique({ where: { code } });
    let strings;
    if (body.data.strings !== undefined) {
      strings = sanitizeStrings(body.data.strings);
    } else if (body.data.patch !== undefined) {
      strings = { ...(row ? sanitizeStrings(row.strings) : {}) };
      for (const [k, v] of Object.entries(body.data.patch)) { if (v === '') delete strings[k]; else strings[k] = v; }
    } else {
      strings = row ? sanitizeStrings(row.strings) : {};
    }
    await p.siteLocale.upsert({
      where: { code },
      // order:-1 keeps these ahead of runtime locales in any ordered scan; enabled:true so the
      // public read serves them. publicLocaleList excludes reserved codes, so they never appear
      // as a duplicate entry in the language picker.
      create: { code, nativeName: baseNative(code), englishName: baseNative(code), rtl: false, enabled: true, order: -1, strings },
      update: { strings },
    });
    await logAudit(p, req.user.uid, 'locale.base', `${code} strings=${Object.keys(strings).length}`, clientIp(req)).catch(() => {});
    return { ok: true, code, translatedKeys: Object.keys(strings).length };
  });
}

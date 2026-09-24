// The custom seed, v2: every kind of setting this install holds, by domain, as one JSON
// bundle that another install can check and apply.
//
// ── Why a second format ─────────────────────────────────────────────────────────
// The first custom seed (lib/seed-export.mjs) emits a runnable script for a handful of
// sections and writes whatever it carries without checking it. What people asked to move was
// wider — the Discord bot, every hosting knob, BMM telemetry, analytics goals, the economy —
// and a seed that writes unchecked values into those is how a hand-edited file ends up
// disabling checkout on the other side.
//
// ── The three rules ──────────────────────────────────────────────────────────────
// 1. Structured by DOMAIN, each chosen on its own, with a manifest that says what is inside,
//    what version of the format it is, and what was left out and why.
// 2. An import is checked with the SAME zod schema (or the same check function) the live
//    admin route uses — imported from that route, never copied. A seed cannot store what the
//    admin screen would have refused. Each schema is named beside its domain below.
// 3. Secrets never leave (lib/secret-guard.mjs): credential rows are not read, credential
//    fields and credential-shaped values are stripped and reported, and the finished bundle
//    is scanned once more as a whole — an export that still finds one throws rather than
//    shipping it. On import, a setting that had a secret field stripped keeps the secret this
//    install already holds.
//
// ── What is NOT here, on purpose ─────────────────────────────────────────────────
// Runtime state (bot status/logs/queues, sweep watermarks, season clocks, download counters,
// code-graph snapshots), per-user rows (`onboarding:<id>`, `studio.components:<id>`), lists of
// people (thread blocklists, site bans, a project's visibility whitelist), install-bound ids
// (the Discord application's emoji ids, a guild's hosting-pool id), and the four credential
// rows. EXCLUDED_KEYS below lists each with its reason.

import { z } from 'zod';
import { SECRET_SETTING_KEYS, stripSecrets, findSecrets, keepLocalSecrets } from './secret-guard.mjs';
import { CONFIG_KEY as ONBOARDING_KEY, ONBOARDING_CONFIG_SCHEMA, normalizeConfig as normalizeOnboarding, PROGRESS_PREFIX as ONBOARDING_PROGRESS_PREFIX } from './onboarding.mjs';
import { footerSchema, THEME_DEFAULTS } from './config-schemas.mjs';
import { FLAG_KEYS } from './flags.mjs';
import { normalizeCharityConfig } from './charity.mjs';
import { normalizeSeason } from './economy-season.mjs';
import { MAIL_SAMPLES } from './mail-samples.mjs';
import { BUILTIN_PROJECT_KEYS } from './project-keys.mjs';
import { GRANT_PLAN_NAME } from './lib.mjs';
import {
  navSchema, SCENE_BODY, SHOWCASE_BODY, HOME_BODY, APP_ICONS_BODY, THEME_BODY, MAIL_TEMPLATE_BODY,
  MAIL_CUSTOM_TEMPLATES_BODY, checkAdminSetting, scenePartial,
} from '../routes/misc.mjs';
import { BOT_CONFIG_BODY, BOT_GUILD_BODY, BOT_I18N_BODY } from '../routes/bot.mjs';
import { CHARITY_BODY } from '../routes/charity.mjs';
import { FEEDBACK_CONFIG_BODY } from '../routes/feedback.mjs';
import { REPORTS_CONFIG_BODY } from '../routes/reports.mjs';
import { RIGHTS_CONFIG_BODY } from '../routes/rights.mjs';
import { goalSchema, retentionSchema, REPLAY_BODY } from '../routes/analytics.mjs';
import { TELEMETRY_CONFIG_BODY } from '../routes/server-control.mjs';
import { THRESHOLDS_BODY } from '../routes/server-perf.mjs';
import { KOFI_GOAL_BODY, nextGoalValue } from '../routes/kofi.mjs';
import { planShape } from '../routes/hosting.mjs';
import { MYO_SETTINGS_BODY } from '../routes/myo.mjs';
import { SEASON_BODY } from '../routes/economy-admin.mjs';
import { HISTORY_RETENTION_BODY } from '../routes/history.mjs';
import { CODEGRAPH_SETTINGS_BODY, PROJECT_CONFIG_BODY } from '../routes/projects.mjs';
import { configStudioProblems, studioValidateOpts } from './studio-doc.mjs';
import { pageSchema as DOC_PAGE_SCHEMA } from '../routes/docs.mjs';
import { faqSchema as FAQ_SCHEMA } from '../routes/faq.mjs';
import { badgeInput as BADGE_SCHEMA } from '../routes/social.mjs';

export const FORMAT = 'bcweb-custom-seed';
export const FORMAT_VERSION = 2;

// ── Checks ────────────────────────────────────────────────────────────────────────
const firstIssue = (err) => {
  const i = err?.issues?.[0];
  return i ? `${i.path.join('.') || '(root)'}: ${i.message}` : 'invalid';
};
/** A value checked by a zod schema; `wrap`/`unwrap` adapt a stored value to a route body. */
const byZod = (schema, { wrap = (v) => v, unwrap = (d) => d } = {}) => async (value) => {
  const r = schema.safeParse(wrap(value));
  return r.success ? { ok: true, value: unwrap(r.data) } : { ok: false, error: firstIssue(r.error) };
};
/** The generic settings door (PUT /admin/settings/:key), as a check. */
const byGenericRoute = async (value, { p, key, role }) => {
  const r = await checkAdminSetting(p, key, value, { role });
  return r.ok ? { ok: true, value: r.value } : { ok: false, error: r.body?.error || 'refused' };
};

// ── What is excluded, and why (shown in the manifest when present on this install) ──
export const EXCLUDED_KEYS = [
  { match: (k) => SECRET_SETTING_KEYS.has(k), reason: 'credential' },
  { match: (k) => k.startsWith(ONBOARDING_PROGRESS_PREFIX) || k.startsWith('studio.components:'), reason: 'per-user' },
  { match: (k) => /^bot\.(status|logs|commands|i18n\.base|dmQueue|dmBroadcast|blogAnnounced|kofiAnnounced|paymentsAnnounced|paymentsTest|refundEvents|restart|rolePanelState|alertPosts|appEmojis)$/.test(k), reason: 'runtime state or bound to this Discord application' },
  { match: (k) => /(^analytics\.rollupAt$|^badges\.sweepAt$|^backup\.lastFullSnapshot$|^economy\.seasonState$|^attention\.|^migr\.|^demo\.|^project\.dlclicks$|^project\.activity-import\.|^serverperf\.|^api\.usage\.|^reports\.imageMaxMB$)/.test(k), reason: 'runtime state' },
  { match: (k) => k.startsWith('codegraph.') && !k.startsWith('codegraph.settings.'), reason: 'generated snapshot' },
  { match: (k) => k === 'threads.config' || k === 'security.bans', reason: 'lists of people' },
];
export function exclusionReason(key) {
  for (const e of EXCLUDED_KEYS) if (e.match(key)) return e.reason;
  return null;
}

// ── The domains ───────────────────────────────────────────────────────────────────
// A setting spec: { key | prefix, check(value, ctx), pick?(value) for export, merge?(incoming,
// current) for import, virtual? (reads/writes part of another row) }.
// A model spec: { model, id(row), read(p), keep?(row), toSeed(row), check(row), write(p, v),
// exists(p, v) }. A service spec: { label, check(value) } for the telemetry service's live config.
//
// Every `check` names the route it comes from. None of them is written here.

const botConfigCheck = byZod(BOT_CONFIG_BODY, { wrap: (v) => ({ config: v }), unwrap: (d) => d.config }); // PUT /admin/bot/config

export const DOMAINS = [
  {
    id: 'bot', label: 'Discord bot', labelFr: 'Bot Discord',
    desc: 'Bot configuration (channels, gating, welcome, moderation, logs), its translation overrides and the per-server settings. Not the token.',
    settings: [
      {
        key: 'bot.config', check: botConfigCheck,
        // The economy travels in its own domain, so it can be moved (or not) separately.
        pick: (v) => { const { economy, ...rest } = v || {}; return rest; },
        merge: (incoming, current) => (current?.economy ? { ...incoming, economy: current.economy } : incoming),
      },
      {
        key: 'bot.i18n', // PUT /admin/bot/i18n, one language at a time
        check: async (v) => {
          if (!v || typeof v !== 'object' || Array.isArray(v)) return { ok: false, error: 'not_an_object' };
          for (const [lang, strings] of Object.entries(v)) {
            const r = BOT_I18N_BODY.safeParse({ lang, strings });
            if (!r.success) return { ok: false, error: `${lang}: ${firstIssue(r.error)}` };
          }
          return { ok: true, value: v };
        },
      },
    ],
    models: [{
      model: 'botGuild', label: 'server settings',
      id: (r) => r.guildId,
      read: (p) => p.botGuild.findMany({ select: { guildId: true, memberMode: true, logChannelId: true, storeLogs: true, storageQuotaBytes: true } }),
      // hostingGroupId is left out: it is a pool id on THIS install and means nothing elsewhere.
      toSeed: (r) => ({ guildId: r.guildId, memberMode: r.memberMode, logChannelId: r.logChannelId, storeLogs: r.storeLogs, storageQuotaBytes: Number(r.storageQuotaBytes || 0) }),
      check: async (row) => { // PUT /admin/bot/guilds/:id
        if (!/^\d{5,25}$/.test(String(row?.guildId || ''))) return { ok: false, error: 'guildId' };
        const { guildId, ...body } = row;
        const r = BOT_GUILD_BODY.safeParse(body);
        if (!r.success) return { ok: false, error: firstIssue(r.error) };
        // The route's own rule: moderation runs bans and MUST log somewhere.
        if (r.data.memberMode === 'moderation' && !r.data.logChannelId) return { ok: false, error: 'log_channel_required' };
        return { ok: true, value: { guildId, ...r.data } };
      },
      write: async (p, v) => {
        const { guildId, ...data } = v;
        if ('storageQuotaBytes' in data) data.storageQuotaBytes = BigInt(data.storageQuotaBytes);
        await p.botGuild.upsert({ where: { guildId }, create: { guildId, ...data }, update: data });
      },
      exists: async (p, v) => !!(await p.botGuild.findUnique({ where: { guildId: v.guildId }, select: { guildId: true } })),
    }],
  },
  {
    id: 'economy', label: 'Economy', labelFr: 'Économie',
    desc: 'XP, levels, points, the shop, the casino rules and the season schedule (bot.config → economy). Balances and purchases are not settings and stay.',
    settings: [{
      key: 'bot.config#economy', virtual: { key: 'bot.config', path: 'economy' },
      check: async (v, ctx) => {
        if (!v || typeof v !== 'object' || Array.isArray(v)) return { ok: false, error: 'not_an_object' };
        if (v.season) { // PUT /admin/economy/season
          const s = SEASON_BODY.safeParse(normalizeSeason(v.season));
          if (!s.success) return { ok: false, error: `season: ${firstIssue(s.error)}` };
        }
        // …and the whole bot config it lands in, through PUT /admin/bot/config's schema.
        const whole = await botConfigCheck({ ...(ctx.current || {}), economy: v });
        return whole.ok ? { ok: true, value: v } : whole;
      },
    }],
  },
  {
    id: 'hosting', label: 'Hosting', labelFr: 'Hébergement',
    desc: 'Every hosting, pricing, catalogue, marketplace and feature-flag setting, the backup size cap, and the hosting plans. Subscriptions and repos are not settings.',
    settings: [
      { prefix: 'hosting.', check: byGenericRoute },
      { prefix: 'pricing.', check: byGenericRoute },
      { prefix: 'catalog.', check: byGenericRoute },
      { prefix: 'marketplace.', check: byGenericRoute },
      ...FLAG_KEYS.map((key) => ({ key, check: byGenericRoute })),
      { key: 'backup.maxBytes', check: byGenericRoute },
      { key: 'reviews.enabled', check: byGenericRoute },
    ],
    models: [{
      model: 'hostingPlan', label: 'plans',
      // The route's own identity for "the same offer" (its duplicate check): name + size + speed.
      id: (r) => `${r.name} · ${r.storageGB} GB · ${r.uploadLimitKbps} kbps`,
      read: (p) => p.hostingPlan.findMany({ orderBy: [{ active: 'desc' }, { storageGB: 'asc' }] }),
      // Plans minted for one customer (a renewal quote, an admin grant) are paperwork, not the
      // catalogue somebody built.
      keep: (r) => r.name !== GRANT_PLAN_NAME && !/^Custom .*\(renewal\)$/.test(r.name),
      toSeed: (r) => Object.fromEntries(Object.keys(planShape).map((k) => [k, r[k]])),
      check: async (row) => { // POST /admin/hosting/plans
        const r = await byZod(z.object(planShape))(row);
        // The route derives an empty price from the pricing settings; a seed row always carries
        // the number it had, and one without would otherwise land as a FREE plan.
        if (r.ok && r.value.priceMonthlyCents == null) return { ok: false, error: 'priceMonthlyCents: required in a seed' };
        return r;
      },
      write: async (p, v) => {
        const found = await p.hostingPlan.findFirst({ where: { name: v.name, storageGB: v.storageGB, uploadLimitKbps: v.uploadLimitKbps } });
        if (found) await p.hostingPlan.update({ where: { id: found.id }, data: v });
        else await p.hostingPlan.create({ data: v });
      },
      exists: async (p, v) => !!(await p.hostingPlan.findFirst({ where: { name: v.name, storageGB: v.storageGB, uploadLimitKbps: v.uploadLimitKbps }, select: { id: true } })),
    }],
  },
  {
    id: 'telemetry', label: 'BMM telemetry', labelFr: 'Télémétrie BMM',
    desc: 'The BCWEB-side telemetry settings and, when the telemetry service is reachable, its live limits (storage, retention, deletion delay). Its admin key stays in the environment.',
    settings: [{ prefix: 'telemetry.', check: byGenericRoute }],
    service: {
      label: 'telemetry service',
      check: byZod(TELEMETRY_CONFIG_BODY), // PUT /admin/telemetry/config
    },
  },
  {
    id: 'goals', label: 'Analytics goals', labelFr: "Objectifs d'analyse",
    desc: 'Conversion goals (name, kind, path/label pattern, target). The events they count are not copied.',
    models: [{
      model: 'analyticsGoal', label: 'goals',
      id: (r) => `${r.kind}:${r.name}`,
      read: (p) => p.analyticsGoal.findMany({ orderBy: { createdAt: 'asc' } }),
      toSeed: (r) => ({ name: r.name, kind: r.kind, path: r.path, label: r.label, target: r.target, active: r.active }),
      check: byZod(goalSchema), // POST /admin/analytics/goals
      write: async (p, v) => {
        const data = { name: v.name, kind: v.kind, path: v.path || null, label: v.label || null, target: v.target ?? null, active: v.active ?? true };
        const found = await p.analyticsGoal.findFirst({ where: { name: v.name, kind: v.kind } });
        if (found) await p.analyticsGoal.update({ where: { id: found.id }, data });
        else await p.analyticsGoal.create({ data });
      },
      exists: async (p, v) => !!(await p.analyticsGoal.findFirst({ where: { name: v.name, kind: v.kind }, select: { id: true } })),
    }],
  },
  {
    id: 'analytics', label: 'Analytics & retention', labelFr: 'Analyse et conservation',
    desc: 'Data retention windows, session-replay sampling, server alert thresholds, audit and repo-history retention.',
    settings: [
      { key: 'analytics.retention', check: byZod(retentionSchema) },   // PUT /admin/analytics/retention
      { key: 'analytics.replay', check: byZod(REPLAY_BODY) },          // PUT /admin/analytics/replay/config
      { key: 'alerts.thresholds', check: byZod(THRESHOLDS_BODY) },     // PUT /admin/server/thresholds
      { key: 'audit.maxDays', check: byZod(HISTORY_RETENTION_BODY, { wrap: (v) => ({ source: 'staff', days: v?.maxDays }), unwrap: (d) => ({ maxDays: d.days }) }) }, // PUT /admin/history/retention
      { key: 'history.repoDays', check: byZod(HISTORY_RETENTION_BODY, { wrap: (v) => ({ source: 'repo', days: v?.days }), unwrap: (d) => ({ days: d.days }) }) },
      { key: 'api.usage', check: byGenericRoute },
    ],
  },
  {
    id: 'site', label: 'Look & navigation', labelFr: 'Apparence et navigation',
    desc: 'Theme, topbar, footer, home page, 3D scene, showcase and the app icons.',
    settings: [
      { key: 'site.theme', check: byZod(THEME_BODY, { unwrap: (d) => ({ ...THEME_DEFAULTS, ...d }) }) }, // PUT /admin/theme
      { key: 'nav.config', check: byZod(navSchema) },               // PUT /admin/nav
      { key: 'footer.config', check: byZod(footerSchema) },         // PUT /admin/footer
      { key: 'site.home', check: byZod(HOME_BODY) },                // PUT /admin/site/home
      { key: 'site.scene', check: byZod(SCENE_BODY, { unwrap: (d) => ({ ...d, events: Object.fromEntries(Object.entries(d.events || {}).map(([k, v]) => [k, scenePartial(v)]).filter(([, v]) => v)) }) }) }, // PUT /admin/site/scene
      {
        key: 'site.showcase', // PUT /admin/site/showcase, with its duplicate-id rule
        check: async (v) => {
          const r = SHOWCASE_BODY.safeParse(v);
          if (!r.success) return { ok: false, error: firstIssue(r.error) };
          const ids = (r.data.items || []).map((i) => i.id);
          if (new Set(ids).size !== ids.length) return { ok: false, error: 'duplicate_id' };
          return { ok: true, value: r.data };
        },
      },
      { key: 'brand.appIcons', check: byZod(APP_ICONS_BODY, { wrap: (v) => ({ icons: v }), unwrap: (d) => d.icons }) }, // PUT /admin/site/app-icons
    ],
  },
  {
    id: 'seo', label: 'SEO', labelFr: 'Référencement',
    desc: 'Per-page unfurl cards, the tag-manager id, verification tokens and robots additions.',
    settings: [{ prefix: 'seo.', check: byGenericRoute }],
  },
  {
    id: 'charity', label: 'Charity & donations', labelFr: 'Caritatif et dons',
    desc: 'The charity share and its landing page, and the Ko-fi funding goal. Not the Ko-fi token, not any money.',
    settings: [
      { key: 'charity.config', check: byZod(CHARITY_BODY, { unwrap: (d) => normalizeCharityConfig(d) }) }, // PUT /admin/charity
      { key: 'kofi.goal', check: byZod(KOFI_GOAL_BODY), merge: (incoming, current) => nextGoalValue(current || null, incoming) }, // PUT /admin/kofi/goal
    ],
  },
  {
    id: 'moderation', label: 'Feedback & reports', labelFr: 'Retours et signalements',
    desc: 'Feedback intake per project, report and rights-notice rules.',
    settings: [
      { key: 'feedback.config', check: byZod(FEEDBACK_CONFIG_BODY) },  // PUT /admin/feedback/config
      { key: 'reports.config', check: byZod(REPORTS_CONFIG_BODY) },    // PUT /admin/reports/config
      { key: 'rights.config', check: byZod(RIGHTS_CONFIG_BODY) },      // PUT /admin/rights/config
    ],
  },
  {
    id: 'services', label: 'Make Your Own', labelFr: 'Make Your Own',
    desc: 'Consultation prices, queue limits and auto-archive for the /myo service.',
    settings: [{
      prefix: 'myo.', // PUT /admin/myo/settings stores one field per key
      check: async (v, { key }) => {
        const field = key.slice('myo.'.length);
        if (!(field in MYO_SETTINGS_BODY.shape)) return { ok: false, error: 'unknown_field' };
        const r = MYO_SETTINGS_BODY.safeParse({ [field]: v });
        return r.success ? { ok: true, value: r.data[field] } : { ok: false, error: firstIssue(r.error) };
      },
    }],
  },
  {
    id: 'mail', label: 'E-mail templates', labelFr: 'Modèles d’e-mail',
    desc: 'Rewordings of the built-in mails and the composer templates.',
    settings: [
      {
        key: 'mail.templates', // PUT /admin/mail/templates/:id, one mail at a time
        check: async (v) => {
          if (!v || typeof v !== 'object' || Array.isArray(v)) return { ok: false, error: 'not_an_object' };
          for (const [id, t] of Object.entries(v)) {
            const sample = MAIL_SAMPLES.find((x) => x.id === id);
            if (!sample) return { ok: false, error: `${id}: unknown_mail` };
            if (!sample.editable) return { ok: false, error: `${id}: not_editable` };
            const r = MAIL_TEMPLATE_BODY.safeParse(t);
            if (!r.success) return { ok: false, error: `${id}: ${firstIssue(r.error)}` };
          }
          return { ok: true, value: v };
        },
      },
      { key: 'mail.customTemplates', check: byZod(MAIL_CUSTOM_TEMPLATES_BODY, { wrap: (v) => ({ templates: v }), unwrap: (d) => d.templates }) }, // PUT /admin/mail/custom-templates
    ],
  },
  {
    id: 'guide', label: 'Admin guide', labelFr: 'Guide admin',
    desc: 'Custom sections and overrides of the built-in admin guide.',
    settings: [
      { key: 'guide.custom', check: byGenericRoute },
      { key: 'guide.overrides', check: byGenericRoute },
    ],
  },
  {
    id: 'projects', label: 'Project pages', labelFr: 'Pages projet',
    desc: 'Each fixed project page’s configuration and its code-map repository. Not the webhook secret, not download counters.',
    settings: [
      {
        prefix: 'project.', // PUT /projects/:key
        check: async (v, { p, key }) => {
          const pk = key.slice('project.'.length);
          // The route's own gate (isProjectKey): a page is only configurable for a project that
          // exists here. Asked through the injected client so a check never opens a second one.
          const known = BUILTIN_PROJECT_KEYS.includes(pk) || !!(await p.project?.findUnique({ where: { key: pk }, select: { key: true } }).catch(() => null));
          if (!known) return { ok: false, error: 'unknown_project' };
          const r = PROJECT_CONFIG_BODY.safeParse({ config: v });
          if (!r.success) return { ok: false, error: firstIssue(r.error) };
          // Its studio pages are checked as PUT /projects/:key checks them (lib/studio-doc.mjs):
          // an imported file is one more way for a hostile page to arrive.
          const stored = await p.adminSetting?.findUnique({ where: { key }, select: { value: true } }).catch(() => null);
          const problems = configStudioProblems(r.data.config, stored?.value, await studioValidateOpts(p));
          if (problems.length) return { ok: false, error: `${problems[0].path}: ${problems[0].reason}` };
          return { ok: true, value: r.data.config };
        },
      },
      {
        prefix: 'codegraph.settings.', // PUT /admin/projects/:key/code-graph
        check: byZod(CODEGRAPH_SETTINGS_BODY),
        // The export dropped the webhook secret; the one this install has stays.
        merge: (incoming, current) => keepLocalSecrets(incoming, current),
      },
    ],
  },
  {
    id: 'onboarding', label: 'Onboarding', labelFr: 'Accueil des nouveaux comptes',
    desc: 'The first-run flow: which steps, in what order, and their wording.',
    settings: [{ key: ONBOARDING_KEY, check: byZod(ONBOARDING_CONFIG_SCHEMA, { unwrap: (d) => normalizeOnboarding(d) }) }], // PUT /admin/onboarding
  },
  {
    id: 'content', label: 'Docs, FAQ & badges', labelFr: 'Docs, FAQ et badges',
    desc: 'Documentation pages, FAQ entries and badge definitions. Who holds a badge is not copied.',
    models: [
      {
        model: 'docPage', label: 'docs', id: (r) => r.slug,
        read: (p) => p.docPage.findMany({ orderBy: { order: 'asc' } }),
        toSeed: (r) => ({ slug: r.slug, title: r.title, titleFr: r.titleFr, category: r.category, categoryFr: r.categoryFr, icon: r.icon, body: r.body, bodyFr: r.bodyFr, order: r.order, published: r.published, commentsPublic: r.commentsPublic }),
        check: async (row) => { // POST /admin/docs
          // The slug is the page's identity here (the route derives it from the title); any
          // non-empty one is accepted, as the content backup's restore does.
          if (typeof row?.slug !== 'string' || !row.slug.trim() || row.slug.length > 200) return { ok: false, error: 'slug' };
          const { slug, ...rest } = row;
          const r = DOC_PAGE_SCHEMA.safeParse(rest);
          return r.success ? { ok: true, value: { slug, ...r.data } } : { ok: false, error: firstIssue(r.error) };
        },
        write: async (p, v) => { const { baseVersion, ...data } = v; await p.docPage.upsert({ where: { slug: v.slug }, create: data, update: data }); },
        exists: async (p, v) => !!(await p.docPage.findUnique({ where: { slug: v.slug }, select: { id: true } })),
      },
      {
        model: 'faqItem', label: 'FAQ', id: (r) => r.question,
        read: (p) => p.faqItem.findMany({ orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] }),
        toSeed: (r) => ({ question: r.question, questionFr: r.questionFr, answer: r.answer, answerFr: r.answerFr, category: r.category, categoryFr: r.categoryFr, order: r.order, published: r.published }),
        check: byZod(FAQ_SCHEMA), // POST /admin/faq
        write: async (p, v) => {
          const found = await p.faqItem.findFirst({ where: { question: v.question } });
          if (found) await p.faqItem.update({ where: { id: found.id }, data: v });
          else await p.faqItem.create({ data: v });
        },
        exists: async (p, v) => !!(await p.faqItem.findFirst({ where: { question: v.question }, select: { id: true } })),
      },
      {
        model: 'badge', label: 'badges', id: (r) => r.slug,
        read: (p) => p.badge.findMany({ orderBy: { priority: 'desc' } }),
        toSeed: (r) => ({ slug: r.slug, name: r.name, description: r.description, iconType: r.iconType, icon: r.icon, color: r.color, grant: r.grant, trigger: r.trigger, rule: r.rule, earnMessage: r.earnMessage, priority: r.priority, active: r.active }),
        check: async (row) => { // POST /admin/badges
          const r = BADGE_SCHEMA.safeParse(row);
          if (!r.success) return { ok: false, error: firstIssue(r.error) };
          if (!r.data.slug) return { ok: false, error: 'slug' };
          return { ok: true, value: r.data };
        },
        write: async (p, v) => { await p.badge.upsert({ where: { slug: v.slug }, create: v, update: v }); },
        exists: async (p, v) => !!(await p.badge.findUnique({ where: { slug: v.slug }, select: { id: true } })),
      },
    ],
  },
];
export const DOMAIN_IDS = DOMAINS.map((d) => d.id);
const domainById = (id) => DOMAINS.find((d) => d.id === id);

/** Which setting spec owns a stored key, within one domain. */
function specFor(domain, key) {
  for (const s of domain.settings || []) {
    if (s.virtual) { if (s.key === key) return s; continue; }
    if (s.key ? s.key === key : key.startsWith(s.prefix)) return s;
  }
  return null;
}

/** Read the value a spec exports from the stored rows (virtual specs read part of a row). */
function exportedValue(spec, row) {
  if (spec.virtual) return row?.value?.[spec.virtual.path];
  return spec.pick ? spec.pick(row.value) : row.value;
}

// ── Export ────────────────────────────────────────────────────────────────────────

/**
 * Build the bundle for the chosen domains.
 *
 * `io` is { p, telemetry?: { read(): Promise<config|null> } } — the telemetry service is
 * injected so tests (and installs without one) need no network.
 */
export async function buildBundle(io, selected = DOMAIN_IDS, meta = {}) {
  const { p } = io;
  const chosen = DOMAINS.filter((d) => selected.includes(d.id));
  const rows = await p.adminSetting.findMany({ select: { key: true, value: true } });
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const redacted = [];
  const excluded = [];
  for (const r of rows) {
    const why = exclusionReason(r.key);
    if (why) excluded.push({ key: r.key, reason: why });
  }
  const domains = {};
  const summary = [];
  for (const d of chosen) {
    const out = { settings: [], rows: {} };
    // Settings
    for (const r of rows) {
      if (exclusionReason(r.key)) continue;
      const spec = specFor(d, r.key);
      if (!spec || spec.virtual) continue;
      const v = exportedValue(spec, r);
      if (v === undefined) continue;
      const clean = stripSecrets(v);
      clean.removed.forEach((x) => redacted.push({ domain: d.id, key: r.key, path: x.path, reason: x.reason }));
      out.settings.push({ key: r.key, value: clean.value });
    }
    for (const spec of (d.settings || []).filter((s) => s.virtual)) {
      const row = byKey.get(spec.virtual.key);
      const v = row ? exportedValue(spec, row) : undefined;
      if (v === undefined || v === null) continue;
      const clean = stripSecrets(v);
      clean.removed.forEach((x) => redacted.push({ domain: d.id, key: spec.key, path: x.path, reason: x.reason }));
      out.settings.push({ key: spec.key, value: clean.value });
    }
    // Rows
    for (const m of d.models || []) {
      const all = await m.read(p).catch(() => []);
      out.rows[m.model] = all.filter((r) => !m.keep || m.keep(r)).map((r) => {
        const clean = stripSecrets(m.toSeed(r));
        clean.removed.forEach((x) => redacted.push({ domain: d.id, key: `${m.model}:${m.id(r)}`, path: x.path, reason: x.reason }));
        return clean.value;
      });
    }
    // The external service
    if (d.service && io.telemetry) {
      const live = await io.telemetry.read().catch(() => null);
      if (live) {
        const picked = { storageLimitMb: live.storageLimitMb, retentionDays: live.retentionDays, deleteDelayH: live.deleteDelayH };
        out.service = stripSecrets(picked).value;
      }
    }
    domains[d.id] = out;
    summary.push({ id: d.id, settings: out.settings.length, rows: Object.fromEntries(Object.entries(out.rows).map(([k, v]) => [k, v.length])), service: !!out.service });
  }
  const bundle = {
    manifest: {
      format: FORMAT,
      version: FORMAT_VERSION,
      generatedAt: meta.generatedAtIso || new Date().toISOString(),
      source: meta.source || null,
      domains: summary,
      // What did not travel, by path, so the reader knows before importing.
      redacted,
      excluded,
      notes: [
        'Secrets are never exported: credential rows, fields named like credentials and values shaped like one (tokens, keys, hashes, webhook URLs) are removed and listed in `redacted` / `excluded`.',
        'Import checks every value with the schema the admin screen uses; a domain with one invalid value is not applied at all.',
      ],
    },
    domains,
  };
  // The last line of defence: the finished bundle, scanned as a whole. If anything shaped
  // like a credential survived the per-value pass, refuse to hand the file out at all.
  const leak = findSecrets(bundle.domains);
  if (leak.length) {
    const e = new Error('secret_in_export');
    e.paths = leak.map((x) => x.path);
    throw e;
  }
  return bundle;
}

// ── Import ────────────────────────────────────────────────────────────────────────

const ENVELOPE = z.object({
  manifest: z.object({ format: z.literal(FORMAT), version: z.number().int() }).passthrough(),
  domains: z.record(z.string(), z.object({
    settings: z.array(z.object({ key: z.string().min(1).max(200), value: z.any() })).max(2000).optional().default([]),
    rows: z.record(z.string(), z.array(z.any()).max(5000)).optional().default({}),
    service: z.any().optional(),
  })),
});

/**
 * Check a bundle, and apply it when `apply` is true.
 *
 * Returns { ok, applied, domains: [{ id, ok, items: [{ kind, id, status, error? }] }] }.
 * `status` is create | update | invalid | refused | skipped. A domain with any invalid or
 * refused item is reported and NOT written: half a bot configuration is worse than the one
 * that was there.
 *
 * `io` is { p, role, telemetry?: { write(cfg) } }.
 */
export async function applyBundle(io, raw, { apply = false, only = null } = {}) {
  const env = ENVELOPE.safeParse(raw);
  if (!env.success) return { ok: false, error: 'not_a_seed', detail: firstIssue(env.error) };
  if (env.data.manifest.version !== FORMAT_VERSION) return { ok: false, error: 'unsupported_version', version: env.data.manifest.version };
  const { p, role } = io;
  const report = [];
  for (const [id, body] of Object.entries(env.data.domains)) {
    if (only && !only.includes(id)) continue;
    const d = domainById(id);
    if (!d) { report.push({ id, ok: false, items: [{ kind: 'domain', id, status: 'refused', error: 'unknown_domain' }] }); continue; }
    const items = [];
    const writes = [];
    for (const s of body.settings) {
      const item = { kind: 'setting', id: s.key };
      items.push(item);
      const excl = exclusionReason(s.key);
      if (excl) { item.status = 'refused'; item.error = excl; continue; }
      const spec = specFor(d, s.key);
      if (!spec) { item.status = 'refused'; item.error = 'not_in_domain'; continue; }
      // A value shaped like a credential was never produced by an export; somebody put it there.
      const planted = findSecrets(s.value);
      if (planted.length) { item.status = 'refused'; item.error = `secret_in_import: ${planted[0].path || '(value)'}`; continue; }
      const targetKey = spec.virtual ? spec.virtual.key : s.key;
      const currentRow = await p.adminSetting.findUnique({ where: { key: targetKey } }).catch(() => null);
      const current = currentRow?.value;
      const r = await spec.check(s.value, { p, key: s.key, role, current });
      if (!r.ok) { item.status = 'invalid'; item.error = r.error; continue; }
      item.status = currentRow ? 'update' : 'create';
      // The merge runs at WRITE time, against what is stored then: the bot and economy domains
      // both land in `bot.config`, and a merge computed before the first one wrote would make
      // the second put the first one's old values back.
      writes.push(async () => {
        const now = (await p.adminSetting.findUnique({ where: { key: targetKey } }).catch(() => null))?.value;
        let value = spec.merge ? spec.merge(r.value, spec.virtual ? now?.[spec.virtual.path] : now) : r.value;
        if (spec.virtual) value = { ...(now || {}), [spec.virtual.path]: value };
        await p.adminSetting.upsert({ where: { key: targetKey }, create: { key: targetKey, value }, update: { value } });
      });
    }
    for (const [model, list] of Object.entries(body.rows)) {
      const m = (d.models || []).find((x) => x.model === model);
      if (!m) { items.push({ kind: 'row', id: model, status: 'refused', error: 'not_in_domain' }); continue; }
      for (const row of list) {
        const item = { kind: 'row', id: `${model}:${safeId(m, row)}` };
        items.push(item);
        const planted = findSecrets(row);
        if (planted.length) { item.status = 'refused'; item.error = `secret_in_import: ${planted[0].path}`; continue; }
        const r = await m.check(row);
        if (!r.ok) { item.status = 'invalid'; item.error = r.error; continue; }
        item.status = (await m.exists(p, r.value).catch(() => false)) ? 'update' : 'create';
        writes.push(() => m.write(p, r.value));
      }
    }
    if (body.service !== undefined && d.service) {
      const item = { kind: 'service', id: d.service.label };
      items.push(item);
      const r = await d.service.check(body.service);
      if (!r.ok) { item.status = 'invalid'; item.error = r.error; }
      else if (!io.telemetry) { item.status = 'skipped'; item.error = 'service_not_configured'; }
      else { item.status = 'update'; writes.push(() => io.telemetry.write(r.value)); }
    }
    const ok = !items.some((i) => i.status === 'invalid' || i.status === 'refused');
    if (apply && ok) for (const w of writes) await w();
    report.push({ id, ok, applied: apply && ok, items });
  }
  return { ok: report.every((d) => d.ok), applied: apply, domains: report };
}

function safeId(m, row) {
  try { return String(m.id(row) ?? '?').slice(0, 120); } catch { return '?'; }
}

/**
 * The same bundle as a runnable seed script, for the command line. It does not carry its own
 * writer: it loads THIS module from the api it is run in, so the checks it applies are the
 * ones that install's routes use, not the ones the exporting install had.
 */
export function bundleToScript(bundle) {
  const json = JSON.stringify(bundle, null, 2).replace(/<\//g, '<\\/');
  return `// BetterCommunity custom seed (format ${FORMAT} v${FORMAT_VERSION}), generated ${bundle.manifest.generatedAt}.
// Domains: ${bundle.manifest.domains.map((d) => d.id).join(', ')}
//
// Run it from the api directory of the install that should receive it (apps/api, with its
// DATABASE_URL set):
//   node custom-seed.mjs            check only: every value against that install's own schemas
//   node custom-seed.mjs --apply    check, then write the domains that passed
// No secret is in this file; the ones the target install already has are kept.
const bundle = ${json};

const here = new URL('.', import.meta.url);
const { applyBundle } = await import(new URL('./src/lib/config-transfer.mjs', here));
const { db } = await import(new URL('./src/lib/lib.mjs', here));
const apply = process.argv.includes('--apply');
const r = await applyBundle({ p: await db(), role: 'SUPERADMIN' }, bundle, { apply });
for (const d of r.domains || []) {
  console.log(\`\${d.ok ? (d.applied ? 'applied ' : 'ok      ') : 'REFUSED '} \${d.id}\`);
  for (const i of d.items) if (i.status === 'invalid' || i.status === 'refused') console.log(\`           \${i.id}: \${i.error}\`);
}
if (r.error) console.error(r.error, r.detail || '');
if (!apply) console.log('\\nChecked only. Run again with --apply to write.');
process.exit(r.ok ? 0 : 1);
`;
}

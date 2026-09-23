// The first-run flow a new account walks through once, right after it is created.
//
// ── What it replaces ──────────────────────────────────────────────────────────
// The dashboard used to open with a "Getting started" checklist: account ✓, turn on 2FA,
// submit a first item, host a first Server-Repo. It was dismissed per DEVICE (localStorage),
// so the same person met it again on their phone, and it was shown to EVERY account without
// 2FA or without a repo, which is to say to long-standing members who had simply never
// wanted a repo. The three things it pointed at are still here: 2FA is the `security` step,
// the item and the repo are links in the `next` step.
//
// ── The rules, in one place ───────────────────────────────────────────────────
//   · shown ONCE, to accounts created after this shipped. The marker is written at the
//     moment the account is created (password sign-up and OAuth sign-up both), so an
//     account that predates it has no marker and never sees the flow — "returning users"
//     are out by construction, not by a date comparison somebody has to keep right;
//   · resumable: progress lives on the server, so leaving half-way on a laptop and coming
//     back on a phone picks up at the same step;
//   · skippable per step, and as a whole ("don't show this again");
//   · never twice: finishing leaves a tombstone, and the marker is only ever CREATED, never
//     reset, so a second OAuth sign-in (or any later event) cannot re-arm it.
//
// ── Where it is stored ────────────────────────────────────────────────────────
// Per-user progress is one AdminSetting row, `onboarding:<userId>` — the same idiom as
// `studio.components:<userId>` — rather than a column on User: a column is a migration and a
// regenerated Prisma client on a table every request reads, for a value that is written a
// handful of times in an account's life and then shrinks to a tombstone. The row holds step
// ids and the chosen interest ids, nothing a person typed. Closing an account deletes it.
//
// The admin's copy of the flow is `onboarding.config` (enable, order, FR/EN text).

import { z } from 'zod';

export const CONFIG_KEY = 'onboarding.config';
export const progressKey = (userId) => `onboarding:${userId}`;
export const PROGRESS_PREFIX = 'onboarding:';

/** Every step the flow knows how to draw. The admin orders, enables and rewords them; a
 *  step that is not in this list has no screen, so it cannot be added from the config. */
export const STEP_IDS = ['verify', 'profile', 'connections', 'interests', 'privacy', 'security', 'next'];

const loc = (max) => z.object({ en: z.string().max(max).optional().default(''), fr: z.string().max(max).optional().default('') });
// A link the `next` step offers. Internal path or https only, like every other admin-typed
// link on the site: a `javascript:` href here would run on a brand-new member's first click.
const safeTo = z.string().trim().min(1).max(300)
  .refine((v) => (v.startsWith('/') && !v.startsWith('//')) || /^https:\/\//i.test(v), 'internal path or https URL');
const linkSchema = z.object({
  id: z.string().trim().regex(/^[a-z0-9-]{1,40}$/),
  label: loc(60),
  desc: loc(160).optional().default({}),
  to: safeTo,
  icon: z.string().trim().max(60).optional().default(''),
});
const interestSchema = z.object({
  id: z.string().trim().regex(/^[a-z0-9-]{1,40}$/),
  label: loc(60),
  // Where somebody who picked this should go next. Optional: an interest can just be a
  // signal for the admin without a page of its own.
  to: safeTo.optional(),
  icon: z.string().trim().max(60).optional().default(''),
});
const stepSchema = z.object({
  id: z.enum(STEP_IDS),
  enabled: z.boolean(),
  title: loc(80).optional().default({}),
  body: loc(600).optional().default({}),
  // D5: the step's icon (a name from the web's ONB_ICONS; '' = the built-in one) and whether
  // it may be skipped. Enforced here too, not only by hiding the button: applyAction refuses a
  // `skip` on a step that cannot be skipped.
  icon: z.string().trim().max(40).regex(/^[A-Za-z0-9]*$/).optional().default(''),
  skippable: z.boolean().optional().default(true),
});

// D5: how the flow presents itself, beyond its steps. Every field defaults to what the flow did
// before these options existed, so a stored config without `ui` behaves exactly as it did.
const uiSchema = z.object({
  allowSnooze: z.boolean().optional().default(true),     // "Finish later" and the close button
  allowDismiss: z.boolean().optional().default(true),    // "Do not show again"
  showProgress: z.boolean().optional().default(true),    // the bar and "Step n of m"
  continueLabel: loc(40).optional().default({}),         // '' = the built-in "Continue"
  finishLabel: loc(40).optional().default({}),           // '' = the built-in "Finish"
}).optional().default({});

export const ONBOARDING_CONFIG_SCHEMA = z.object({
  enabled: z.boolean(),
  // Order IS the array order. Each id at most once.
  steps: z.array(stepSchema).min(1).max(STEP_IDS.length)
    .refine((s) => new Set(s.map((x) => x.id)).size === s.length, 'duplicate step'),
  interests: z.array(interestSchema).max(12).optional().default([]),
  links: z.array(linkSchema).max(8).optional().default([]),
  ui: uiSchema,
});

export const DEFAULT_CONFIG = Object.freeze({
  enabled: true,
  steps: STEP_IDS.map((id) => ({ id, enabled: true, title: {}, body: {}, icon: '', skippable: true })),
  interests: [
    { id: 'mods', label: { en: 'Mods for BetterModsManager', fr: 'Des mods pour BetterModsManager' }, to: '/catalog', icon: 'Package' },
    { id: 'hosting', label: { en: 'Hosting a Server-Repo', fr: 'Héberger un Server-Repo' }, to: '/hosting', icon: 'Server' },
    { id: 'catalogs', label: { en: 'Publishing a catalogue', fr: 'Publier un catalogue' }, to: '/submit', icon: 'BookOpen' },
    { id: 'discord', label: { en: 'The Discord bot', fr: 'Le bot Discord' }, to: '/dashboard?s=discord', icon: 'Bot' },
    { id: 'dev', label: { en: 'The API and the docs', fr: "L'API et la documentation" }, to: '/docs', icon: 'Code2' },
  ],
  links: [
    { id: 'submit', label: { en: 'Submit your first item', fr: 'Proposer votre premier élément' }, desc: {}, to: '/submit', icon: 'Upload' },
    { id: 'repo', label: { en: 'Host your first Server-Repo', fr: 'Héberger votre premier Server-Repo' }, desc: {}, to: '/hosting#plans', icon: 'Server' },
    { id: 'docs', label: { en: 'Read the documentation', fr: 'Lire la documentation' }, desc: {}, to: '/docs', icon: 'BookOpen' },
  ],
  ui: { allowSnooze: true, allowDismiss: true, showProgress: true, continueLabel: {}, finishLabel: {} },
});

/** The stored config, with anything unreadable replaced by the default. Steps missing from a
 *  stored config (a step added in a later release) are appended DISABLED, so shipping a new
 *  step never changes a flow an admin already arranged. */
export function normalizeConfig(raw) {
  const r = ONBOARDING_CONFIG_SCHEMA.safeParse(raw);
  if (!r.success) return structuredClone(DEFAULT_CONFIG);
  const cfg = r.data;
  const seen = new Set(cfg.steps.map((s) => s.id));
  for (const id of STEP_IDS) if (!seen.has(id)) cfg.steps.push({ id, enabled: false, title: {}, body: {}, icon: '', skippable: true });
  return cfg;
}

/** A brand-new account's marker. */
export function initialProgress(now = new Date()) {
  return { v: 1, state: 'pending', startedAt: now.toISOString(), done: [], skipped: [], interests: [] };
}

/**
 * Which steps this person actually walks through, in order.
 *
 * `ctx` is { emailEnabled, emailVerified, totpEnabled, oauthAvailable }. A step can be:
 *   - absent: switched off by the admin, or meaningless here (no OAuth provider configured
 *     means nothing to link; no e-mail backend means nothing to confirm);
 *   - auto-done: its outcome is already true (the address is confirmed — which is always the
 *     case for an OAuth sign-up — or 2FA is on). It is kept in the list so the progress bar
 *     counts it, and it is never the current step.
 */
export function resolveSteps(config, ctx = {}) {
  const cfg = normalizeConfig(config);
  return cfg.steps
    .filter((s) => s.enabled)
    .filter((s) => (s.id === 'verify' ? !!ctx.emailEnabled : true))
    .filter((s) => (s.id === 'connections' ? !!ctx.oauthAvailable : true))
    .map((s) => ({ ...s, auto: (s.id === 'verify' && !!ctx.emailVerified) || (s.id === 'security' && !!ctx.totpEnabled) }));
}

const finished = (progress, id) => progress.done.includes(id) || progress.skipped.includes(id);

/** The step to show now, or null when there is nothing left. */
export function currentStep(progress, steps) {
  if (!progress || progress.state !== 'pending') return null;
  const s = steps.find((x) => !x.auto && !finished(progress, x.id));
  return s ? s.id : null;
}

/** Whether the flow opens at all. A missing row is a legacy account: never. */
export function shouldShow(progress, config, steps) {
  if (!progress || progress.state !== 'pending') return false;
  if (!normalizeConfig(config).enabled) return false;
  return currentStep(progress, steps) !== null;
}

/** What a finished flow keeps: enough to never open again, nothing else. */
export function tombstone(how, now = new Date()) {
  return { v: 1, state: 'done', how, finishedAt: now.toISOString() };
}

export const ACTION_SCHEMA = z.object({
  action: z.enum(['done', 'skip', 'snooze', 'resume', 'dismiss']),
  step: z.enum(STEP_IDS).optional(),
  interests: z.array(z.string().regex(/^[a-z0-9-]{1,40}$/)).max(12).optional(),
});

/**
 * Apply one action and return the next progress value, or `{ error }`.
 *
 * Pure: the route reads the row, calls this, writes what comes back. `done` / `skip` must
 * name the CURRENT step — a stale tab posting "done" for a step it showed an hour ago must
 * not tick off a step the person has not seen in this tab's order.
 */
export function applyAction(progress, input, steps, config, now = new Date()) {
  if (!progress || progress.state !== 'pending') return { error: 'not_onboarding' };
  const cur = currentStep(progress, steps);
  const next = { ...progress, done: [...progress.done], skipped: [...progress.skipped], interests: [...(progress.interests || [])] };
  const ui = normalizeConfig(config).ui || {};
  // D5: an option the admin switched off is refused here, not only hidden in the page.
  if (input.action === 'snooze' && ui.allowSnooze === false) return { error: 'not_allowed' };
  if (input.action === 'dismiss' && ui.allowDismiss === false) return { error: 'not_allowed' };
  if (input.action === 'skip' && steps.find((s) => s.id === input.step)?.skippable === false) return { error: 'not_skippable' };
  switch (input.action) {
    case 'snooze': next.snoozedAt = now.toISOString(); return { progress: next };
    case 'resume': delete next.snoozedAt; return { progress: next };
    case 'dismiss': return { progress: tombstone('dismissed', now), finished: true };
    case 'done':
    case 'skip': {
      if (!input.step || input.step !== cur) return { error: 'not_current_step', current: cur };
      if (input.step === 'interests' && input.action === 'done') {
        // Only ids the admin actually offers; anything else is dropped rather than stored.
        const offered = new Set(normalizeConfig(config).interests.map((i) => i.id));
        next.interests = (input.interests || []).filter((id) => offered.has(id));
      }
      (input.action === 'done' ? next.done : next.skipped).push(input.step);
      delete next.snoozedAt;
      if (currentStep(next, steps) === null) {
        const how = next.skipped.length && !next.done.length ? 'skipped' : 'completed';
        return { progress: tombstone(how, now), finished: true };
      }
      return { progress: next };
    }
    default: return { error: 'unknown_action' };
  }
}

/**
 * Write the marker for an account that was JUST created. Create-only: an existing row (in
 * any state) is left exactly as it is, which is what makes "never twice" hold even if this
 * is ever called again for the same account.
 */
export async function markNewAccount(p, userId, now = new Date()) {
  try {
    await p.adminSetting.create({ data: { key: progressKey(userId), value: initialProgress(now) } });
    return true;
  } catch {
    // P2002 (already there) is the "never twice" rule doing its job; anything else must not
    // turn a sign-up into a failure over a welcome screen.
    return false;
  }
}

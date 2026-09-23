// How a notification is SHOWN, in one place, for the two lists that show them: the topbar
// bell (ui/notif-bell.jsx) and the centre (pages/notifications.jsx). Icons and tones stay in
// ui/notif.js (the dashboard panel reads them too); this adds what both lists were each doing
// their own way, or not at all: where a click goes, the translated type label, the day
// grouping and the time.
//
// The centre used to print the raw kind ("repo_published") as the title of every row, and the
// bell and the centre disagreed about where a click went. One module, one answer.

import { NOTIF, NOTIF_FALLBACK } from '../ui/notif.js';

// Where a notification takes you when it has no `href` of its own. `href` is written per
// notification by whatever raised it (validated server-side to an in-app path) and always wins;
// this per-kind map is the fallback that every notification already in the database relies on.
export const NOTIF_LINK = {
  submission_approved: '/dashboard', submission_rejected: '/dashboard',
  repo_verified: '/repos', repo_published: '/dashboard?s=repos', repo_rejected: '/dashboard?s=repos',
  repo_access_granted: '/dashboard?s=repos', repo_renew: '/dashboard?s=repos', repo_upgrade: '/dashboard?s=repos',
  repo_review: '/admin?s=moderation',
  hosting_started: '/dashboard?s=repos', hosting_online: '/dashboard?s=repos', hosting_stopped: '/dashboard?s=repos', hosting_expiring: '/dashboard?s=repos',
  feature_active: '/dashboard?s=repos', server_alert: '/admin?s=serverperf',
  creator_linked: '/profile', discord_linked: '/profile',
  kofi_reward: '/dashboard', promo_redeemed: '/dashboard', discount: '/hosting#plans', free_hosting: '/dashboard?s=repos', free_pool: '/dashboard?s=repos', free_boost: '/dashboard?s=repos',
};

export const notifHref = (n) => n?.href || NOTIF_LINK[n?.kind] || null;

export const notifMeta = (n) => NOTIF[n?.kind] || NOTIF_FALLBACK;

// The small type label, translated. Literal t() calls so the i18n checker sees every one.
const LABELS = {
  Approved: (t) => t('notif.l.approved', 'Approved'),
  Rejected: (t) => t('notif.l.rejected', 'Rejected'),
  Verified: (t) => t('notif.l.verified', 'Verified'),
  Published: (t) => t('notif.l.published', 'Published'),
  Access: (t) => t('notif.l.access', 'Access'),
  Renewal: (t) => t('notif.l.renewal', 'Renewal'),
  Upgrade: (t) => t('notif.l.upgrade', 'Upgrade'),
  Hosting: (t) => t('notif.l.hosting', 'Hosting'),
  Online: (t) => t('notif.l.online', 'Online'),
  Stopped: (t) => t('notif.l.stopped', 'Stopped'),
  Expiring: (t) => t('notif.l.expiring', 'Expiring'),
  Announcement: (t) => t('notif.l.announcement', 'Announcement'),
  Broadcast: (t) => t('notif.l.broadcast', 'Broadcast'),
  Featured: (t) => t('notif.l.featured', 'Featured'),
  Alert: (t) => t('notif.l.alert', 'Alert'),
  Linked: (t) => t('notif.l.linked', 'Linked'),
  Discord: () => 'Discord',
  'Ko-fi': () => 'Ko-fi',
  Gift: (t) => t('notif.l.gift', 'Gift'),
  Promo: (t) => t('notif.l.promo', 'Promo'),
  Discount: (t) => t('notif.l.discount', 'Discount'),
  Boost: (t) => t('notif.l.boost', 'Boost'),
};

// Kinds with no entry in ui/notif.js still get a word that says what they are about, from the
// same prefixes the server groups them by (NOTIF_CATEGORIES in the API's lib.mjs), instead of
// every one of them reading "Update".
const PREFIX_LABELS = [
  [/^report_/, (t) => t('notif.l.report', 'Report')],
  [/^myo_/, (t) => t('notif.l.myo', 'Commission')],
  [/^(transfer_|ownership)/, (t) => t('notif.l.transfer', 'Transfer')],
  [/^poll_/, (t) => t('notif.l.poll', 'Poll')],
  [/^login_/, (t) => t('notif.l.login', 'Sign-in')],
  [/^(badge_|follow|profile_|reaction)/, (t) => t('notif.l.social', 'Community')],
  [/^(blog_|docs_|comment)/, (t) => t('notif.l.comment', 'Comment')],
  [/^(event$|announce)/, (t) => t('notif.l.news', 'News')],
  [/^(catalog_|submission_)/, (t) => t('notif.l.catalog', 'Catalog')],
  [/^(hosting_|feature_)/, (t) => t('notif.l.hosting', 'Hosting')],
  [/^repo_/, (t) => t('notif.l.repo', 'Repository')],
];

export function notifLabel(n, t) {
  const m = NOTIF[n?.kind];
  if (m && LABELS[m.label]) return LABELS[m.label](t);
  const k = String(n?.kind || '');
  for (const [re, f] of PREFIX_LABELS) if (re.test(k)) return f(t);
  return t('notif.l.update', 'Update');
}

export const notifBody = (n, lang) => (lang === 'fr' && n?.bodyFr) || n?.body || '';

const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); };

/** "Today", "Yesterday", then "Monday 21 September" (the year only when it is not this one). */
export function dayLabel(iso, t, lang, now = Date.now()) {
  const d = startOfDay(iso);
  const today = startOfDay(now);
  const diff = Math.round((today - d) / 86400000);
  if (diff <= 0) return t('notif.day.today', 'Today');
  if (diff === 1) return t('notif.day.yesterday', 'Yesterday');
  const date = new Date(iso);
  const opts = { weekday: 'long', day: 'numeric', month: 'long' };
  if (date.getFullYear() !== new Date(now).getFullYear()) opts.year = 'numeric';
  try { return date.toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-GB', opts); } catch { return date.toDateString(); }
}

/** Newest first, bucketed by calendar day: [{ key, label, items }]. */
export function groupByDay(items, t, lang, now = Date.now()) {
  const out = [];
  const sorted = [...(items || [])].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  for (const n of sorted) {
    const key = String(startOfDay(n.createdAt));
    let g = out[out.length - 1];
    if (!g || g.key !== key) { g = { key, label: dayLabel(n.createdAt, t, lang, now), items: [] }; out.push(g); }
    g.items.push(n);
  }
  return out;
}

/** "just now", "5 min", "3 h" today; the clock time on an older day (the day is the heading). */
export function notifTime(iso, t, lang, now = Date.now()) {
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (startOfDay(iso) === startOfDay(now)) {
    if (s < 60) return t('notif.now', 'just now');
    if (s < 3600) return t('notif.min', '{n} min ago').replace('{n}', String(Math.floor(s / 60)));
    return t('notif.hr', '{n} h ago').replace('{n}', String(Math.floor(s / 3600)));
  }
  try { return new Date(iso).toLocaleTimeString(lang === 'fr' ? 'fr-FR' : 'en-GB', { hour: '2-digit', minute: '2-digit' }); } catch { return ''; }
}

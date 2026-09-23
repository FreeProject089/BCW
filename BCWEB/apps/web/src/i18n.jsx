import { createContext, useContext, useState, useRef, useEffect } from 'react';
import { Languages, ChevronDown, Check } from 'lucide-react';

// Lightweight i18n. Add a language = add a dictionary below. Strings fall back to
// English, then to the key, so missing translations never break the UI.
const DICT = {
  en: {
    'promo.badge.default': 'Limited-time offer', 'promo.badge.dismiss': 'Dismiss', 'promo.badge.d': 'd', 'promo.badge.h': 'h', 'promo.badge.m': 'm',
    'nav.home': 'Home', 'nav.apps': 'Apps', 'nav.bmm': 'BMM', 'nav.bsm': 'BSM', 'nav.installer': 'BI', 'nav.blog': 'Blog',
    'nav.repos': 'Repos', 'nav.hosting': 'Hosting', 'nav.projects': 'Projects', 'nav.dashboard': 'Dashboard', 'nav.admin': 'Admin',
    'nav.dev': 'Developers',
    'nav.settings': 'Settings', 'nav.docs': 'Docs', 'nav.catalog': 'Catalog',
    'docs.title': 'Documentation', 'docs.search': 'Search…', 'docs.filter': 'Filter pages…', 'docs.newpage': 'New page',
    'docs.edit': 'Edit', 'docs.updated': 'Updated', 'docs.contributors': '{n} contributors', 'docs.empty': '*This page is empty.*', 'docs.onthispage': 'On this page',
    'docs.none.title': 'No documentation yet', 'docs.none.sub.admin': 'Create the first page to get started.', 'docs.none.sub': 'Check back soon.',
    'docs.helpful': 'Was this page helpful?', 'docs.helpful.thanks': 'Thanks for your feedback!',
    'docs.notfr': "This page isn't translated into French yet, the English version is shown.",
    'docs.search.ph': 'Search the documentation…', 'docs.search.recent': 'Recent', 'docs.search.min': 'Type at least 2 characters…',
    'docs.search.none': 'No results for', 'docs.search.hint': 'Search titles and section headings across the docs.',
    'docs.kb.nav': 'navigate', 'docs.kb.open': 'open', 'docs.kb.close': 'close',
    'projects.sub': 'More from the Better* ecosystem.',
    'nav.signin': 'Sign in', 'nav.signout': 'Sign out', 'nav.notifications': 'Notifications',
    'notif.none': 'No notifications', 'notif.markall': 'Mark all read', 'notif.open': 'Open dashboard', 'notif.justnow': 'just now',
    'notif.clear': 'Clear', 'notif.clearmenu.hint': "Just clears this menu, they'll be back next time.", 'notif.clearall': 'Clear all', 'notif.clearall.confirm.t': 'Clear all notifications', 'notif.clearall.confirm.m': 'This permanently deletes all of your notifications. Continue?',

    'home.badge': 'BetterCommunity',
    'home.hero1': 'A place for all', 'home.brand': 'Better', 'home.hero2': 'projects.',
    'home.sub': 'One place for every Better* project, browse catalogs, share presets, manage your uploads, and host your Server-Repos.',
    'home.cta.explore': 'Explore the catalog', 'home.cta.host': 'Host a repo',
    'home.feat.moderated': 'Every listing says how it was checked',
    'home.feat.moderated.d': 'Two ways in: reviewed by us first, or posted straight by its maker. Every page tells you which, no guessing.',
    'home.feat.accounts': 'Accounts & dashboards', 'home.feat.accounts.d': 'Manage your uploads and propose updates anytime.',
    'home.feat.hosting': 'Pay-as-you-grow hosting', 'home.feat.hosting.d': 'Flexible Server-Repo hosting with capacity guards.',
    'home.feat.install': 'One-click install', 'home.feat.install.d': 'Catalog entries install straight into the app in one click through deeplinks, no manual downloads, no hunting for files.',
    'home.feat.privacy': 'Privacy-first', 'home.feat.privacy.d': 'No third-party trackers and no ads. Analytics are first-party and anonymous, off until you opt in, and you can turn them back off anytime.',
    'home.pipe.sub': 'Submitted', 'home.pipe.review': 'In review', 'home.pipe.live': 'Published',
    'home.stat.items': 'Mods & presets', 'home.stat.downloads': 'Downloads', 'home.stat.members': 'Members', 'home.stat.repos': 'Hosted repos',
    'home.cta2.discord': 'Join the Discord',
    'home.steps.title': 'Get going in minutes', 'home.steps.sub': 'Three steps to join the community.',
    'home.step1': 'Create an account', 'home.step1.d': 'Sign up free to publish and manage your content.',
    'home.step2': 'Share or browse', 'home.step2.d': 'Submit apps, plugins, themes and presets, or discover the community’s.',
    'home.step3': 'Host & scale', 'home.step3.d': 'Spin up a hosted Server-Repo and pay only for what you use.',
    'home.step1.cta': 'Sign up free', 'home.step1.done': "You're set, view profile", 'home.step2.cta': 'Browse the catalog', 'home.step3.cta': 'See hosting plans',
    'home.news': 'Latest news', 'home.news.all': 'All posts', 'home.news.none': 'No posts yet.',
    'home.cta2.title': 'Build with the Better* community', 'home.cta2.sub': 'Join, publish, and help the projects grow. Every contribution counts.',
    'home.cta2.start': 'Get started', 'home.cta2.kofi': 'Support on Ko-fi',
    'home.kofi.goal.title': 'Funding goal', 'home.kofi.goal.tips': '{n} tips', 'home.kofi.goal.help': 'Help keep the servers running, every tip counts.',
    'home.kofi.support': 'Support BetterCommunity', 'home.kofi.goal.tip1': '1 tip', 'home.kofi.goal.reached': 'Goal reached',
    'prod.bmm.d': 'Apps, plugins & themes for Better Mods Manager.',
    'prod.bsm.d': 'Community sound presets, one JSON each.',
    'prod.installer.d': 'A fast, modern installer for the suite.',
    'prod.hosting.d': 'Let us host your Server-Repo, billed by size.', 'prod.open': 'Open',

    'foot.products': 'Products', 'foot.community': 'Community', 'foot.legal': 'Legal',
    'foot.tagline': 'The home for all Better projects.', 'foot.kofi': 'Support us on Ko-fi',
    'foot.privacy': 'Privacy', 'foot.terms': 'Terms', 'foot.cookies': 'Cookies', 'foot.rights': 'All rights reserved.', 'foot.about': 'About', 'foot.refunds': 'Payments & Refunds',
    'news.title': 'Get blog updates by email', 'news.sub': 'New posts, straight to your inbox. Double opt-in, and one-click unsubscribe in every email.',
    'news.ph': 'you@example.com', 'news.cta': 'Subscribe', 'news.sending': 'Subscribing…',
    'news.check': 'Almost there, check your inbox to confirm your subscription.', 'news.err': 'Could not subscribe, check the address and try again.',
    'news.foot': 'Newsletter',
    
    
    
    
    
    
    
    
    
    
    
    
    'sub2.k.preset': "Automations",
    
    
    'usanc.title': "Sanctions",
    
    'usanc.note': "Note interne",
    
    
    
    
    
    'gdpr.send.ok': "Envoyer",
    
    
    
    
    
    'arp.susp.title': "Suspendre « {n} »",
    
    
    'cc.susp.title': "Suspendre « {n} »",
    
    
    'sanc.form.d.1': "24 heures",
    'sanc.form.d.7': "7 jours",
    'sanc.form.d.30': "30 jours",
    'sanc.form.d.90': "90 jours",
    
    
    'maps.hide': "masquer",
    
    
    
    
    
    
    
    
    
    'flow.routes': "routes",
    
    
    
    
    
    'adm.tab.newsletter': 'Newsletter',
    'nl.h': 'Newsletter', 'nl.sub': 'Send a custom email to your subscribers — everyone, or a hand-picked list. Every message is branded and includes a one-click unsubscribe link.',
    'nl.c.active': '{n} active', 'nl.c.pending': '{n} pending', 'nl.c.unsub': '{n} unsubscribed',
    'nl.f.subject': 'Subject (email subject line)', 'nl.f.subject.ph': 'New on BetterCommunity: …',
    'nl.f.title': 'Heading (shown inside the email)', 'nl.f.title.ph': "What's new",
    'nl.f.body': 'Message', 'nl.f.body.ph': 'Write your update. Line breaks are preserved.',
    'nl.f.url': 'Call-to-action link (optional)', 'nl.f.url.h': 'Adds a “Read on the blog” button pointing here.',
    'nl.rec': 'Recipients', 'nl.rec.all': 'Everyone ({n})', 'nl.rec.en': 'English ({n})', 'nl.rec.fr': 'French ({n})', 'nl.rec.pick': 'Pick subscribers ({n})',
    'nl.rec.note': 'Language = the one each subscriber signed up in (footer/blog/registration use the site language at the time; defaults to English). “English” / “French” send to that whole segment — no need to hand-pick.',
    'nl.pick.all': 'Select all shown', 'nl.pick.search': 'Filter by email…', 'nl.pick.none': 'No matching active subscribers.',
    'nl.willsend': 'Will send to {n} subscriber(s).', 'nl.send.btn': 'Send email', 'nl.refresh': 'Refresh',
    'nl.subj.req': 'A subject is required.', 'nl.title.req': 'A title is required.', 'nl.body.req': 'A message body is required.', 'nl.pick.req': 'Select at least one recipient.',
    'nl.send.t': 'Send newsletter email', 'nl.send.m': 'Send this email to {n} subscriber(s)? This cannot be undone.', 'nl.send.ok': 'Send',
    'nl.sent': 'Sent to {n} of {total} subscriber(s).', 'nl.err.disabled': 'Email is not configured on this server (SMTP).', 'nl.err': 'Failed to send.',
    'nl.test.btn': 'Send test to me', 'nl.test.btn2': 'Test', 'nl.test.to': 'Test recipient', 'nl.test.emailreq': 'Enter a valid email to send the test to.', 'nl.test.errdetail': 'Send failed: {d}', 'nl.test.sent': 'Test sent to {to}.', 'nl.test.err': 'Could not send the test.', 'nl.noactive': 'No confirmed subscribers yet, sign-ups stay “pending” until they click the confirm email. You can still send yourself a test below.',
    'nl.subs': 'Subscribers', 'nl.subs.none': 'No subscribers yet.', 'nl.add.ph': 'email to add…', 'nl.add.btn': 'Add', 'nl.add.emailreq': 'Enter a valid email.', 'nl.add.done': 'Subscriber added.', 'nl.add.err': 'Could not add.',
    'nl.rm.t': 'Remove subscriber', 'nl.rm.m': 'Remove {e} from the newsletter?', 'nl.rm.ok': 'Remove', 'nl.rm.done': 'Removed.', 'nl.rm.err': 'Could not remove.',
    'arp.dashboard': 'Manage (admin)', 'an.wv.export': 'Export CSV',

    'cookie.title': 'Cookies',
    'cookie.body': 'We use an essential cookie to keep you signed in. With your consent we also collect privacy-friendly, first-party page analytics — no third parties, no ad tracking.',
    'cookie.policy': 'Cookie Policy', 'cookie.all': 'Accept all', 'cookie.essential': 'Essential only',
    'cookie.reject': 'Reject non-essential', 'cookie.customise': 'Customise', 'cookie.back': 'Back', 'cookie.save': 'Save choices', 'cookie.always': 'always on',
    'cookie.cat.essential': 'Essential', 'cookie.cat.essential.d': 'Sign-in session and security. The site can’t work without these.',
    'cookie.cat.analytics': 'Analytics', 'cookie.cat.analytics.d': 'Anonymous, first-party usage stats (no ads, no cross-site tracking).',

    'auth.welcome': 'Welcome back', 'auth.create': 'Create your account',
    'auth.subin': 'Sign in to manage your content.', 'auth.subup': 'Join to publish and host.',
    'auth.name': 'Display name', 'auth.name.ph': 'How should we call you?', 'auth.email': 'Email', 'auth.password': 'Password',
    'auth.toRegister': 'Need an account? Register', 'auth.toLogin': 'Have an account? Sign in',
    'auth.or': 'or',
    'pu.empty.paying.t': 'No paying customers', 'pu.empty.paying.s': 'Nobody has made a payment yet.',
    'pu.empty.free.t': 'No free-plan users', 'pu.empty.free.s': 'Nobody is hosting content on the free tier right now.',
    'pu.empty.archived.t': 'Nothing archived', 'pu.empty.archived.s': 'No expired terms or finished boosts yet.', 'auth.oauth.github': 'Continue with GitHub', 'auth.oauth.discord': 'Continue with Discord', 'auth.oauth.google': 'Continue with Google',
    'auth.err.oauthOnly': "This account was created with GitHub or Discord, use that to sign in, or set a password from your profile once signed in.",
    'auth.welcome.toast': 'Welcome!',
    'auth.redirecting': 'Already signed in, taking you to your profile…',
    'auth.forgot': 'Forgot your password?',
    'auth.reset.title': 'Reset password', 'auth.reset.sub': 'Enter your email to get a reset token.',
    'auth.newpw.title': 'Set a new password', 'auth.newpw.sub': 'Choose a new password for your account.',
    'auth.sendreset': 'Send reset', 'auth.updatepw': 'Update password',
    'auth.token': 'Reset token', 'auth.token.ph': 'paste your token',
    'auth.newpw': 'New password', 'auth.confirmpw': 'Confirm password',
    'auth.newsletter': 'Send me BetterCommunity news and blog updates by email.', 'auth.newsletter.hint': 'Double opt-in, unsubscribe anytime.',
    'auth.toast.sent': 'If that email exists, a reset link was sent.',
    'auth.toast.updated': 'Password updated, sign in.',
    'auth.err.creds': 'Wrong email or password.', 'auth.err.taken': 'This email already exists.', 'auth.err.taken.login': 'Login instead?', 'auth.err.emailformat': 'Enter a valid email address.',
    'auth.err.token': 'Invalid or expired reset token.', 'auth.err.pow': 'Verification failed, try again.',
    'auth.err.fail': 'Something went wrong.', 'auth.err.match': 'Passwords do not match.', 'auth.err.short': 'Password must be at least 8 characters.',
    'auth.2fa.title': 'Two-factor code', 'auth.2fa.sub': 'Enter the 6-digit code from your authenticator app.',
    'auth.2fa.code': 'Code', 'auth.2fa.verify': 'Verify', 'auth.2fa.back': 'Back to login', 'auth.2fa.bad': 'Invalid code.',

    'proj.edit': 'Modifier la page',
    'proj.edit.h': 'Modifier cette page, textes, liens, téléchargements et le diagramme « How it runs »',
    'proj.edit.stack': 'Modifier ce diagramme',
    'proj.overview': 'Overview', 'proj.releases': 'Release Notes', 'proj.community': 'Community', 'proj.legal': 'Legal', 'proj.countdown': 'Countdown',
    'proj.browse': 'Browse catalog', 'proj.progress': 'Progress tracker', 'proj.noprogress': 'No roadmap yet',
    'proj.nocontrib': 'No contributors yet', 'proj.messages': 'Community messages',
    'proj.blog': 'Blog', 'proj.noposts': 'No posts yet',
    'common.loading': 'Loading…',
  },
  // M18 (agent-perf-M18): the French dictionary (DICT.fr) now lives in ./i18n-fr.js and is
  // loaded on demand by loadLang() below, only for a French visitor. Add French strings THERE.
  // fin M18 (agent-perf-M18)
};

const KEY = 'bcw_lang';
const Ctx = createContext(null);
export const useI18n = () => useContext(Ctx);

// M18 (agent-perf-M18): the compiled dictionaries that are NOT in this module, fetched on demand.
//
// French was ~190 KB gzip of the first load for every visitor, English readers included. It is
// now a chunk of its own (./i18n-fr.js), imported the first time French is needed:
//   · main.jsx calls loadLang(storedLang()) BEFORE the first render when the saved language
//     is French, so a French visitor gets French on the first frame (no English flash, no
//     layout shift from every label changing length). English visitors do not wait at all.
//   · setLang('fr') switches once the dictionary is there (a toggle click waits one fetch
//     instead of flashing English into French).
//   · the provider still loads it itself if something mounted it first (tests, a harness).
// A failed fetch is not fatal: t() falls back to English, as it always did for a missing key.
const LAZY = { fr: () => import('./i18n-fr.js') };
const pending = {};
/** Is this language's compiled dictionary in memory (or does it have none to fetch)? */
export const langReady = (l) => !LAZY[l] || !!DICT[l];
/** Fetch a language's compiled dictionary once. Resolves when t() can use it. */
export function loadLang(l) {
  if (langReady(l)) return Promise.resolve();
  if (!pending[l]) {
    pending[l] = LAZY[l]().then((m) => { DICT[l] = m.default; }, (e) => { delete pending[l]; throw e; });
  }
  return pending[l];
}
/** The saved language, as the provider reads it on mount. */
export function storedLang() { try { return localStorage.getItem(KEY) || 'en'; } catch { return 'en'; } }
/** Re-render once the French dictionary is in memory: for screens that enumerate DICT.fr. */
export function useLangReady(l = 'fr') {
  const [, setTick] = useState(0);
  const ready = langReady(l);
  useEffect(() => {
    if (ready) return undefined;
    let live = true;
    loadLang(l).then(() => { if (live) setTick((n) => n + 1); }, () => {});
    return () => { live = false; };
  }, [l, ready]);
  return ready;
}
// fin M18 (agent-perf-M18)

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(storedLang);
  // M18: switch once the dictionary is there; on a failed fetch switch anyway (English fallback).
  const setLang = (l) => {
    try { localStorage.setItem(KEY, l); } catch {}
    if (langReady(l)) setLangState(l);
    else loadLang(l).then(() => setLangState(l), () => setLangState(l));
  };
  // M18: a provider mounted without main.jsx's preload (or with a language set elsewhere)
  // renders English until the dictionary arrives, then re-renders.
  useLangReady(lang);

  // Admin-authored copy, layered OVER the dictionary rather than replacing entries in it.
  //
  // Only the keys somebody actually overrode travel, so this is a few hundred bytes on a
  // normal site and nothing at all on a fresh one. Fetched once here instead of in the home
  // page, because `t()` is what consults it and `t()` is everywhere.
  const [over, setOver] = useState(null);
  useEffect(() => {
    let live = true;
    fetch('/api/site/home')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (live) setOver(d?.text || {}); })
      .catch(() => { if (live) setOver({}); });   // the site must render without this
    return () => { live = false; };
  }, []);

  // The available languages (B9). Starts as the compiled base and is EXTENDED — never replaced —
  // by the admin-added runtime locales, so a slow or failed fetch leaves EN/FR working. The
  // switchers read this from context instead of the module `LANGS`, which stays the base list.
  const [locales, setLocales] = useState(LANGS.map((l) => ({ code: l.code, nativeName: l.label, rtl: false })));
  useEffect(() => {
    let live = true;
    fetch('/api/site/locales')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (live && Array.isArray(d?.locales) && d.locales.length) setLocales(d.locales); })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  // The current language's runtime override strings — a flat { key: value } map. For an EXTRA
  // language it is the (partial) translation with English fallback; for the compiled base en/fr
  // it is the base-OVERRIDE layer (typo fixes / rewording an admin or translator saved), empty
  // on a site that never touched it. Either way it layers over the compiled dictionary in t(),
  // so a missing key falls through to English and nothing here can blank a line.
  const [localeStrings, setLocaleStrings] = useState({});
  useEffect(() => {
    let live = true;
    fetch(`/api/site/i18n/${encodeURIComponent(lang)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (live) setLocaleStrings(d?.strings || {}); })
      .catch(() => { if (live) setLocaleStrings({}); });
    return () => { live = false; };
  }, [lang]);

  // Reflect the chosen language on <html>: `lang` for a11y/SEO, `dir` for RTL scripts. Driven by
  // the locale's `rtl` flag from the fetched list; the compiled base is always LTR. This is the
  // switch the RTL layout pass (Phase 3) keys off — `[dir=rtl]` rules do nothing until it is set.
  useEffect(() => {
    const el = document.documentElement;
    const rtl = !!locales.find((l) => l.code === lang)?.rtl;
    el.setAttribute('lang', lang);
    el.setAttribute('dir', rtl ? 'rtl' : 'ltr');
  }, [lang, locales]);

  // `||`, not `??`: an override is only an override when it has words in it. An empty
  // string means "not translated here", and must fall through to the dictionary rather than
  // blanking the line — otherwise an admin who fills in French and leaves English empty
  // erases the English. A runtime locale's string sits between the admin overrides and the
  // compiled dictionary: it beats the English fallback but not an explicit admin override.
  const t = (k, fb) => over?.[k]?.[lang] || over?.[k]?.en || localeStrings?.[k] || DICT[lang]?.[k] || DICT.en[k] || fb || k;
  return <Ctx.Provider value={{ lang, setLang, t, locales }}>{children}</Ctx.Provider>;
}

/**
 * The same dictionary, with a DIFFERENT set of overrides — copy that is not saved yet.
 *
 * The admin screen edits `home.*` in a form and the public page reads those keys through
 * `t()`, so the only thing standing between "what I typed" and "what a visitor sees" is
 * which override map `t()` consults. Rather than a second renderer that approximates the
 * page, the preview mounts the REAL one under this provider.
 *
 * The fallthrough order is the live provider's, character for character, and deliberately
 * so: a preview that resolves an empty box differently from the site is a preview that
 * lies about the one case admins get wrong.
 */
export function I18nDraft({ over, children }) {
  const { lang, setLang, locales } = useI18n();
  const t = (k, fb) => over?.[k]?.[lang] || over?.[k]?.en || DICT[lang]?.[k] || DICT.en[k] || fb || k;
  return <Ctx.Provider value={{ lang, setLang, t, locales }}>{children}</Ctx.Provider>;
}

/**
 * D5 (agent-admin-D): a subtree in ANOTHER language than the page.
 *
 * The admin's onboarding preview has a language picker, and it only switched the admin's own
 * wording: every button of the real flow was still drawn in the admin's language, so the
 * French preview had English buttons and "does it hold in French" could not be answered by
 * looking at it. Compiled dictionary only (no site overrides): it previews built-in wording.
 */
export function I18nLang({ lang, children }) {
  const parent = useI18n();
  useLangReady(lang); // M18: the French preview re-renders once DICT.fr is loaded
  const t = (k, fb) => DICT[lang]?.[k] || DICT.en[k] || fb || k;
  return <Ctx.Provider value={{ ...parent, lang, t }}>{children}</Ctx.Provider>;
}

/**
 * The shipped English, read-only, for the admin screen that rewrites home-page copy.
 *
 * Exported as a getter over one prefix rather than as the whole DICT: the admin bundle has
 * no business holding a mutable reference to the live dictionary, and the only caller wants
 * "what does the home page say today" — which is also the list of what EXISTS, so a line
 * added to the page tomorrow shows up in that editor with no work.
 */
export function shippedText(prefix) {
  const out = {};
  // Enumerated from the FRENCH dictionary, which is the complete one. DICT.en holds only
  // the ~270 strings that needed an explicit English entry — every other key gets its
  // English from the `t(key, fallback)` call site and is absent here. Listing from DICT.en
  // would have shown an admin four of the home page's sixty-odd lines and looked correct.
  // M18: DICT.fr is loaded on demand now. Callers re-run this once useLangReady('fr') is true;
  // before that it lists the English block rather than throwing.
  for (const k of Object.keys(DICT.fr || DICT.en)) {
    if (k.startsWith(prefix)) out[k] = { en: DICT.en[k] || '', fr: DICT.fr?.[k] || '' };
  }
  return out;
}

// The site's available languages. Add a locale here (and its DICT block above)
// and the switchers below automatically become a dropdown — no other change.
export const LANGS = [
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'Français' },
];

// Topbar switcher. With exactly two languages it's a fast one-tap toggle; once a
// third language is added it becomes a proper dropdown listing every language.
// The presentations an admin can pick for a language selector (topbar utility + footer):
//   auto     — toggle when ≤2 languages, dropdown beyond (the historical behaviour)
//   toggle   — one button that cycles to the next language (compact)
//   inline   — a pill per language, shown inline (best for a few languages)
//   dropdown — always the searchable native-name menu
export const LANG_SELECTOR_TYPES = ['auto', 'toggle', 'inline', 'dropdown'];

// `icon`: a node replacing the globe, when an admin picked one for this button.
export function LangToggle({ type = 'auto', icon = null } = {}) {
  const { t, lang, setLang, locales } = useI18n();
  const LIST = (locales && locales.length) ? locales : LANGS.map((l) => ({ code: l.code, nativeName: l.label }));
  const nameOf = (l) => l.nativeName || l.label || l.code;
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc); return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  // Toggle: cycle to the next language. Forced by type='toggle', and the default when there are
  // only two languages under 'auto'.
  if (type === 'toggle' || (type === 'auto' && LIST.length <= 2)) {
    const idx = Math.max(0, LIST.findIndex((l) => l.code === lang));
    const next = LIST[(idx + 1) % LIST.length] || LIST[0];
    return (
      <button className="nav-link" onClick={() => setLang(next.code)} title={`Language — ${nameOf(next)}`} aria-label={t('nav.language', 'Language')}>
        {icon || <Languages size={16} />} <span className="text-xs font-semibold uppercase">{lang}</span>
      </button>
    );
  }
  // Inline pills — one per language. Only sensible for a short list; falls back to the dropdown
  // beyond five so the topbar never overflows.
  if (type === 'inline' && LIST.length <= 5) {
    return (
      <div className="inline-flex items-center gap-0.5">
        {LIST.map((l) => (
          <button key={l.code} onClick={() => setLang(l.code)} title={nameOf(l)}
            className={`px-2 py-1 max-lg:min-h-[44px] max-lg:min-w-[44px] rounded-md text-xs font-semibold uppercase transition ${l.code === lang ? 'tint-primary text-[var(--accent-ink)]' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}>
            {l.code}
          </button>
        ))}
      </div>
    );
  }
  // With more than a handful of languages the list gets a search box (native names).
  const showSearch = LIST.length > 6;
  const filtered = q ? LIST.filter((l) => (nameOf(l) + ' ' + l.code).toLowerCase().includes(q.toLowerCase())) : LIST;
  return (
    <div className="relative" ref={ref}>
      <button className="nav-link" onClick={() => setOpen((o) => { const n = !o; if (n) setQ(''); return n; })} title={t('nav.language', 'Language')} aria-label={t('nav.language', 'Language')} aria-expanded={open}>
        {icon || <Languages size={16} />} <span className="text-xs font-semibold uppercase">{lang}</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 w-48 rounded-xl border border-[var(--line-strong)] py-1 z-[60] anim-fade overflow-hidden"
          style={{ background: 'var(--bg-solid)', boxShadow: '0 18px 50px -12px rgba(0,0,0,0.5)' }}>
          {showSearch && (
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('lang.search', 'Search language…')}
              className="w-[calc(100%-0.5rem)] mx-1 mb-1 px-2 py-1.5 text-sm rounded-lg border border-[var(--line)] bg-[var(--surface-2)] text-[var(--text)] outline-none focus:border-[var(--ring)]" />
          )}
          <div className="max-h-72 overflow-auto">
            {filtered.map((l) => (
              <button key={l.code} onClick={() => { setLang(l.code); setOpen(false); }}
                className={`w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-[var(--surface-2)] transition ${l.code === lang ? 'text-[var(--accent-ink)] font-medium' : 'text-[var(--text)]'}`}>
                {nameOf(l)} {l.code === lang && <span className="text-[10px] uppercase tracking-wider">{l.code}</span>}
              </button>
            ))}
            {!filtered.length && <div className="px-3 py-2 text-xs text-[var(--faint)]">{t('lang.none', 'No match')}</div>}
          </div>
        </div>
      )}
    </div>
  );
}

// Footer language switcher — a compact native <select> that reads cleanly on
// both desktop and mobile and needs no popover/positioning logic.
// Footer language switcher. A themed button + popover, NOT a native <select>: the rest of the
// app replaced native selects app-wide because their <option> popups ignore the theme and
// render as an OS-grey menu — this was the last one left. Self-contained (no import from
// ui.jsx, which would cycle back through useI18n here); mirrors LangToggle's opaque menu.
export function LangSelect({ className = '', type = 'dropdown' }) {
  const { t, lang, setLang, locales } = useI18n();
  const LIST = (locales && locales.length) ? locales : LANGS.map((l) => ({ code: l.code, nativeName: l.label }));
  const nameOf = (l) => l.nativeName || l.label || l.code;
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef(null);
  const cur = LIST.find((l) => l.code === lang) || LIST[0];
  const showSearch = LIST.length > 6;
  // Toggle: a single pill that cycles to the next language.
  if (type === 'toggle' || (type === 'auto' && LIST.length <= 2)) {
    const idx = Math.max(0, LIST.findIndex((l) => l.code === lang));
    const next = LIST[(idx + 1) % LIST.length] || LIST[0];
    return (
      <button type="button" onClick={() => setLang(next.code)} title={`Language — ${nameOf(next)}`} aria-label={t('nav.language', 'Language')}
        className={`inline-flex items-center gap-1.5 max-lg:min-h-[44px] rounded-lg border border-[var(--line-strong)] bg-[var(--surface-2)] px-2.5 py-1.5 text-xs font-medium text-[var(--muted)] hover:text-[var(--text)] hover:border-[var(--ring)] transition-colors ${className}`}>
        <Languages size={14} /> <span className="uppercase font-semibold">{lang}</span>
      </button>
    );
  }
  // Inline pills.
  if (type === 'inline' && LIST.length <= 5) {
    return (
      <div className={`inline-flex items-center gap-0.5 ${className}`}>
        {LIST.map((l) => (
          <button key={l.code} type="button" onClick={() => setLang(l.code)} title={nameOf(l)}
            className={`px-2 py-1 max-lg:min-h-[44px] max-lg:min-w-[44px] rounded-md text-xs font-semibold uppercase transition ${l.code === lang ? 'tint-primary text-[var(--accent-ink)]' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}>
            {l.code}
          </button>
        ))}
      </div>
    );
  }
  const filtered = q ? LIST.filter((l) => (nameOf(l) + ' ' + l.code).toLowerCase().includes(q.toLowerCase())) : LIST;
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc); document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);
  return (
    <div className={`relative inline-flex ${className}`} ref={ref}>
      <button type="button" onClick={() => setOpen((o) => { const n = !o; if (n) setQ(''); return n; })} aria-haspopup="listbox" aria-expanded={open} aria-label={t('nav.language', 'Language')}
        className="inline-flex items-center gap-1.5 max-lg:min-h-[44px] rounded-lg border border-[var(--line-strong)] bg-[var(--surface-2)] px-2.5 py-1.5 text-xs font-medium text-[var(--muted)] hover:text-[var(--text)] hover:border-[var(--ring)] transition-colors">
        <Languages size={14} className="shrink-0" /> {nameOf(cur)}
        <ChevronDown size={13} className={`text-[var(--faint)] transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div role="listbox" className="absolute left-0 bottom-full mb-2 w-48 rounded-xl border border-[var(--line-strong)] py-1 z-[60] anim-fade overflow-hidden"
          style={{ background: 'var(--bg-solid)', boxShadow: '0 18px 50px -12px rgba(0,0,0,0.5)' }}>
          {showSearch && (
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('lang.search', 'Search language…')}
              className="w-[calc(100%-0.5rem)] mx-1 mb-1 px-2 py-1.5 text-sm rounded-lg border border-[var(--line)] bg-[var(--surface-2)] text-[var(--text)] outline-none focus:border-[var(--ring)]" />
          )}
          <div className="max-h-72 overflow-auto">
            {filtered.map((l) => (
              <button key={l.code} type="button" role="option" aria-selected={l.code === lang} onClick={() => { setLang(l.code); setOpen(false); }}
                className={`w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-[var(--surface-2)] transition ${l.code === lang ? 'text-[var(--accent-ink)] font-medium' : 'text-[var(--text)]'}`}>
                {nameOf(l)} {l.code === lang && <Check size={13} />}
              </button>
            ))}
            {!filtered.length && <div className="px-3 py-2 text-xs text-[var(--faint)]">{t('lang.none', 'No match')}</div>}
          </div>
        </div>
      )}
    </div>
  );
}

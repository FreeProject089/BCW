// What the mobile bottom bar actually shows.
//
// Lives outside App.jsx so the admin "Navigation & pied de page" editor (pages/admin.jsx) can
// import the SAME rules and preview the same bar, instead of the two drifting apart. The data
// shape the editor writes is unchanged:
//
//   nav.downbar = {
//     enabled?: boolean,              // false hides the bar entirely
//     display?: 'icon'|'text'|'both', // per-button rendering
//     items?: [{ kind:'link'|'primary'|'dropup', to, icon, label, labelFr, children:[…] }],
//     quick?: boolean,                // NEW, optional — see DOWNBAR_QUICK_DEFAULT below
//   }
//
// WHY THE DEFAULTS CHANGED
// ------------------------
// The old default bar was Home · BMM · BSM · Hosting: four DESTINATIONS, three of which are
// product pages you read once. On a phone the things a signed-in person reaches for are not
// reading destinations, they are: get somewhere (search), see what happened (notifications),
// and get to their own stuff (dashboard/profile). Browsing the catalog is the one content
// destination that earns a permanent slot. So the default is now
//
//   Home · Catalog · Search (raised) · Notifications · Me
//
// with the account slot degrading to "Sign in" when signed out and Notifications degrading to
// Docs, because a signed-out visitor has no notifications and a tab that always reads zero is
// worse than no tab.
//
// Search is the centre button on purpose: the phone has no ⌘K, so the palette — which is the
// fastest way to anything on this site — had no entry point at all on the surface where
// finding things is hardest.

// An admin who has hand-built a custom bar owns every slot; nothing is injected into it.
// Otherwise the three "quick" slots (search / notifications / me) are added, unless the
// config turns them off. Opt-OUT, not opt-in: this is the behaviour the default bar wants,
// and a config written before the field existed must get it.
export const DOWNBAR_QUICK_DEFAULT = true;
export const quickEnabled = (db) => (db && db.quick === false ? false : DOWNBAR_QUICK_DEFAULT);

// Slots are described by data, not JSX, so this file stays importable from the editor and
// from a plain node test. `icon` is a name from the nav icon whitelist; `kind` is the shape
// App.jsx renders; `act` marks a slot that runs something instead of navigating.
//
// `k` is a translation key (hardcoded slots); configured slots carry label/labelFr instead.
const HOME = { to: '/', k: 'nav.home', icon: 'Home', exact: true, kind: 'link' };

export const DOWNBAR_DEFAULT_DESTINATIONS = [
  { to: '/catalog', k: 'nav.catalog', icon: 'LayoutGrid', kind: 'link' },
];

/**
 * The bar, from the nav config.
 *
 * @param navCfg   the /nav config object (or null)
 * @param opts     { signedIn: boolean }
 * @returns null when the bar is off, otherwise { display, items }
 */
export function buildDownbar(navCfg, opts = {}) {
  const db = (navCfg && navCfg.downbar) || {};
  if (db.enabled === false) return null;
  const display = db.display === 'icon' || db.display === 'text' ? db.display : 'both';
  const signedIn = !!opts.signedIn;

  // 1. An explicit custom bar wins outright, exactly as before.
  const customRaw = Array.isArray(db.items) ? db.items : [];
  const custom = customRaw
    .filter((it) => it && (String(it.to || '').startsWith('/')
      || (it.kind === 'dropup' && (it.children || []).some((c) => c && String(c.to || '').startsWith('/')))))
    .slice(0, 5)
    .map((it) => ({
      kind: it.kind === 'primary' || it.kind === 'dropup' ? it.kind : 'link',
      to: it.to, icon: it.icon, label: it.label, labelFr: it.labelFr, exact: it.to === '/',
      children: (it.children || []).filter((c) => c && String(c.to || '').startsWith('/')),
    }));
  if (custom.length) return { display, items: custom };

  // 2. Otherwise: home, then whatever the admin put at the front of the MENU (groups skipped,
  //    a bottom bar cannot nest), then the quick slots.
  const configured = (navCfg && Array.isArray(navCfg.items) ? navCfg.items : [])
    .filter((it) => it && it.type !== 'group' && it.to)
    .map((it) => ({ kind: 'link', to: it.to, icon: it.icon, label: it.label, labelFr: it.labelFr, exact: it.to === '/' }));

  const quick = quickEnabled(db);
  // Two destination slots when the quick slots are on (5 total), four when they are off —
  // the bar is five slots wide either way, which is the most a thumb can aim at on a phone.
  const room = quick ? 2 : 4;
  const dests = (configured.length ? configured : DOWNBAR_DEFAULT_DESTINATIONS)
    .filter((it) => it.to !== '/')
    .slice(0, room);

  const items = [HOME, ...dests];
  if (quick) {
    items.push({ kind: 'primary', act: 'search', k: 'downbar.search', icon: 'Search' });
    // The same destination twice is the failure mode here: the admin's menu on this site
    // already starts with Blog and Docs, so a signed-out bar read Home · Blog · Docs ·
    // Search · Docs. Each quick slot is a SHORT LIST and takes the first entry not already
    // on the bar.
    const taken = new Set(items.map((it) => it.to).filter(Boolean));
    const add = (cands) => {
      const c = cands.find((x) => !taken.has(x.to));
      if (c) { taken.add(c.to); items.push(c); }
    };
    add(signedIn
      ? [{ kind: 'link', to: '/notifications', k: 'nav.notifications', icon: 'Bell', badge: 'notifs' }]
      : [{ kind: 'link', to: '/docs', k: 'nav.docs', icon: 'BookOpen' },
        { kind: 'link', to: '/faq', k: 'nav.faq', icon: 'Info' },
        { kind: 'link', to: '/blog', k: 'nav.blog', icon: 'Newspaper' }]);
    // `/auth`, not `/login`: the sign-in route in App.jsx is /auth and /login is a 404. The
    // whole bar is hardcoded paths, so this is the kind of mistake nothing else catches.
    add(signedIn
      ? [{ kind: 'link', to: '/dashboard', k: 'downbar.me', icon: 'LayoutGrid' }]
      : [{ kind: 'link', to: '/auth', k: 'nav.signin', icon: 'Shield' }]);
  }
  return { display, items: items.slice(0, 5) };
}

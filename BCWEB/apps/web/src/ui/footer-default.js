// The built-in footer, as data.
//
// It used to exist only as JSX inside <Footer/>, which meant the admin editor could not
// offer it as a starting point: opening the editor gave you an empty list, so "customise the
// footer" really meant "rebuild it from nothing, and hope you remember every link". The two
// also had no way to stay in step — adding a link to the JSX would silently not appear in
// anything an admin had already built.
//
// Defined once here and consumed by both: <Footer/> renders this when no config is enabled,
// and the editor's "Start from the built-in footer" / "Reset" load the same array.
//
// The labels are i18n KEYS with their English fallback, not finished strings, because the
// built-in footer is translated live. Once an admin edits a column the text becomes theirs
// (with its own `titleFr` / `labelFr`), which is why the editor resolves these through `t`
// exactly once, at the moment it loads them.
export const DEFAULT_FOOTER_COLUMNS = [
  {
    key: 'foot.products', title: 'Products',
    links: [
      { key: null, label: 'BetterModsManager', to: '/p/bmm' },
      { key: null, label: 'BetterSoundMaker', to: '/p/bsm' },
      { key: null, label: 'BetterInstaller', to: '/p/installer' },
      { key: 'nav.hosting', label: 'Hosting', to: '/hosting' },
      { key: 'myo.badge', label: 'Make Your Own', to: '/myo' },
    ],
  },
  {
    key: 'foot.community', title: 'Community',
    links: [
      { key: 'foot.about', label: 'About', to: '/legal/about' },
      { key: null, label: 'Blog', to: '/blog' },
      { key: 'nav.docs', label: 'Docs', to: '/docs' },
      { key: 'faq.title', label: 'FAQ', to: '/faq' },
      { key: 'nav.repos', label: 'Repos', to: '/repos' },
      { key: 'foot.members', label: 'Members', to: '/users' },
      { key: 'tfa.short', label: 'Authenticator (2FA)', to: '/2fa' },
      { key: null, label: 'Contact', to: '/contact' },
      { key: 'foot.kofi', label: 'Support us', to: 'https://ko-fi.com/bettercommunity', ext: true },
    ],
  },
  {
    key: 'foot.legal', title: 'Legal',
    links: [
      { key: 'legal.all', label: 'All', to: '/legal' },
      { key: 'foot.privacy', label: 'Privacy', to: '/legal/privacy' },
      { key: 'foot.terms', label: 'Terms', to: '/legal/terms' },
      { key: 'foot.cookies', label: 'Cookies', to: '/legal/cookies' },
      { key: 'foot.refunds', label: 'Payments & Refunds', to: '/legal/refunds' },
    ],
  },
];

// The social row, as data. The four built-ins are brand marks that lucide does not ship,
// so they are referenced by KEY ('github' | 'discord' | 'reddit' | 'kofi') and resolved to
// the bundled SVG components; any other value is treated as a lucide icon name, which is
// what lets an admin add a fifth network without a code change.
export const DEFAULT_FOOTER_SOCIALS = [
  { icon: 'github', label: 'GitHub', href: 'https://github.com/FreeProject089' },
  { icon: 'discord', label: 'Discord', href: 'https://discord.com/invite/CTaaEF9R75' },
  { icon: 'reddit', label: 'Reddit', href: 'https://www.reddit.com/r/BetterModManager/' },
  { icon: 'kofi', label: 'Ko-fi', href: 'https://ko-fi.com/bettercommunity' },
];

// The newsletter block's copy. `''` means "use the translated built-in string", so a site
// that never touches these keeps following the i18n dictionary as the language changes —
// only a value an admin actually typed overrides it.
export const DEFAULT_FOOTER_NEWSLETTER = {
  on: true, title: '', titleFr: '', text: '', textFr: '',
  placeholder: '', placeholderFr: '', button: '', buttonFr: '',
};

// The bottom bar. `text` supports one token, {year}, so "© {year} BetterCommunity" stays
// correct on 1 January without anyone editing it.
export const DEFAULT_FOOTER_BOTTOM = {
  copyright: true, text: '', textFr: '', lang: true, egg: true,
};

// Turn the definition above into the shape the editor and the API store: plain strings, no
// i18n keys, every item marked as showing on both devices. `t` is passed in rather than
// imported so this module stays free of React.
export function defaultFooterConfig(t) {
  const label = (l) => (l.key ? t(l.key, l.label) : l.label);
  return {
    enabled: true,
    brand: {
      name: '', logo: '', tagline: '', taglineFr: '',
      socials: DEFAULT_FOOTER_SOCIALS.map((x) => ({ ...x })),
      newsletter: { ...DEFAULT_FOOTER_NEWSLETTER },
    },
    bottom: { ...DEFAULT_FOOTER_BOTTOM },
    mobile: { layout: 'stacked', brand: true },
    columns: DEFAULT_FOOTER_COLUMNS.map((c) => ({
      title: t(c.key, c.title),
      titleFr: '',
      on: 'both',
      links: c.links.map((l) => ({ label: label(l), labelFr: '', to: l.to, on: 'both' })),
    })),
  };
}

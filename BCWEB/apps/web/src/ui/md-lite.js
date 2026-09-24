// The light half of the markdown kit: icons, app-icon config, and the site's configuration of
// the kit. No renderer.
//
// M18 (agent-perf-M18). Most of the eager modules that imported `ui/md.jsx` (App.jsx, the
// catalogue, the icon picker, the badges, the topbar glyphs) only wanted `IconGlyph` or
// `ShowcaseIcon`. Importing them through md.jsx evaluated md.jsx, whose `@bettercommunity/bmd`
// index pulls react-markdown, remark/rehype, parse5 and the directive/sanitize layer: about a
// megabyte of source on every visitor's first load, for an icon. These come straight from the
// kit's own `icons` and `config` entry points, which import none of that.
//
// The configuration lives HERE, not in md.jsx, and md.jsx imports this file. It has to run
// exactly once and early: configureMarkdown() REPLACES the app-icon map, so a second call made
// when the lazily loaded renderer arrives would wipe the icons that ui/theme.jsx registered in
// the meantime (registerAppIcons).
import { configureMarkdown } from '@bettercommunity/bmd/config';

export { ICON_NAMES, ISO_NAMES, ShowcaseIcon, IconGlyph } from '@bettercommunity/bmd/icons';
export { appIconKeys, appIconLabel, registerAppIcons, MarkdownConfig, configureMarkdown } from '@bettercommunity/bmd/config';

// These paths are this site's asset layout, and they are the only thing in the kit that was
// specific to it by value. Set once, at import time, before anything renders.
configureMarkdown({
  // Diagrams: the package is installed here, so no CDN request.
  loadMermaid: () => import('mermaid'),
  // G5: the isometric icons (`iso:server`) are served from public/icons/iso, a copy of the kit's
  // assets/iso written by scripts/build-iso-icons.mjs: same origin, nothing asked of a CDN.
  cdn: { iso: (name) => `/icons/iso/${name}.svg` },
  appIcons: { bmm: '/icons/bmm.png', bsm: '/icons/bsm.png', bi: '/icons/bi.png', installer: '/icons/bi.png', bc: '/logo.png' },
});

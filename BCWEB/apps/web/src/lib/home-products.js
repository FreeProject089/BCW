// The suite row's cards, built once.
//
// The landing page and the page builder's preview both draw this row, and they drew it from
// different places: the landing had four products written into it, and the builder passed an
// empty array — so a `products` block in the builder previewed as nothing at all, and the only
// way to see what you had built was to publish it.
//
// One function, two callers. A second copy of this is a second list to keep in step with the
// projects an admin actually manages, which is the thing this replaced in the first place.
import { Boxes, Music2, Download, Rocket } from 'lucide-react';

/**
 * One icon per known key, for a project with no logo of its own. A key nobody mapped gets the
 * generic one rather than nothing: an empty square in a row of logos reads as a broken image,
 * not as a project without art.
 */
const PROD_ICON = { bmm: Boxes, bsm: Music2, installer: Download };

/**
 * @param {object|null} projData  the `/projects` response — `{ projects, visible }`
 * @param {(k: string, fallback?: string) => string} t
 */
export function productCards(projData, t) {
  const projects = projData?.projects || null;
  const visible = projData?.visible || null;

  // `community` is skipped: it is this site, and a card pointing at the page you are already
  // on is a card nobody clicks.
  const fromApi = Object.entries(projects || {})
    .filter(([k]) => k !== 'community' && visible?.[k] !== false)
    .map(([k, cfg]) => ({
      icon: PROD_ICON[k] || Boxes,
      logo: k,
      name: cfg?.name || k,
      desc: cfg?.tagline || '',
      to: `/p/${k}`,
    }));

  return [
    // Only when the API gave nothing at all — a fresh install, or a request that failed. The
    // row is what the page is FOR; an empty one reads as a broken site rather than an
    // unconfigured one.
    ...(fromApi.length ? fromApi : [
      { icon: Boxes, logo: 'bmm', name: 'BMM', desc: t('prod.bmm.d'), to: '/p/bmm' },
      { icon: Music2, logo: 'bsm', name: 'BSM', desc: t('prod.bsm.d'), to: '/p/bsm' },
      { icon: Download, logo: 'installer', name: 'BetterInstaller', desc: t('prod.installer.d'), to: '/p/installer' },
    ]),
    // Hosting is hand-written because it is a service, not a project: it has no project page
    // and no row in the admin's list, and the suite would be poorer without it.
    { icon: Rocket, name: 'Hosting', desc: t('prod.hosting.d'), to: '/hosting' },
  ];
}

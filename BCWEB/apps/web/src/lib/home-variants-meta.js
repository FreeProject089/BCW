/**
 * What the three landing pages are CALLED, and what each one is for.
 *
 * `HOME_VARIANTS` on the API side declares what each variant is MADE OF — which sections it
 * draws. That is the machine-readable half and it already has one home. This is the other
 * half: the name and the sentence a human picks by, which had two.
 *
 * The admin's home editor called v1 "The long one". The page builder's "Start from:" called
 * the same page "The long landing page", with no sentence at all — so the list you chose
 * from when you were deciding what the site opens with, and the list you chose from when you
 * were rebuilding that page out of blocks, described the same three pages differently and
 * neither said which one was live. Whichever of the two anybody edited, the other went
 * stale, silently, because nothing renders them side by side.
 *
 * One list, one set of i18n keys (`hp.v*`, already translated), both screens.
 *
 * Adding a fourth landing page is a row here and a row in `HOME_VARIANTS`. Keep the ids in
 * step: `scripts/check-home-variant-labels.mjs` fails if this list and the API's disagree,
 * and if either screen goes back to writing its own.
 */

/**
 * @param {(key: string, fallback?: string) => string} t
 * @returns {{ v: string, name: string, sub: string }[]}
 */
export const homeVariantList = (t) => [
  {
    v: 'v1',
    name: t('hp.v1', 'The long one'),
    sub: t('hp.v1.s2', 'Pick this when most arrivals are strangers. It argues: hero, why, how it works, the dev hub, commissions, reviews, news, in that order, and it takes a full scroll to read.'),
  },
  {
    v: 'v2',
    name: t('hp.v2', 'One screen'),
    sub: t('hp.v2.s2', 'Pick this when people arrive knowing what they want. It answers: the four products as a list with the media beside them, the headlines, the ask. No story, nothing below the fold that has to be read.'),
  },
  {
    v: 'v3',
    name: t('hp.v3', 'What’s happening'),
    sub: t('hp.v3.s2', 'Pick this when most arrivals have been here before. It reports: the posts as a feed, with the open poll, the reviews, what is on offer and the showcase beside them. No hero, because they know what the site is.'),
  },
];

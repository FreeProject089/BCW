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
    sub: t('hp.v1.s', 'Hero, why, how it works, the dev hub, commissions, reviews, news. For somebody who has never heard of this.'),
  },
  {
    v: 'v2',
    name: t('hp.v2', 'One screen'),
    sub: t('hp.v2.s', 'No story and no scroll before the answer: the products as a list, the media beside them, news at the end. For somebody who came to get something.'),
  },
  {
    v: 'v3',
    name: t('hp.v3', 'What’s happening'),
    sub: t('hp.v3.s', 'A feed, posts, the open poll, what people said, what is on offer. No hero. For somebody who already uses this.'),
  },
];

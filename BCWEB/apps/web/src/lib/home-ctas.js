// What the front page asks a visitor to do — and it is not the same question twice.
//
// The home page had two headline calls to action and both were fixed. The one at the bottom
// said "Get started" and pointed at /auth, which it also said to somebody who was already
// signed in: an invitation to create the account they are currently using. A member reading
// that learns the page is not looking at them.
//
// The two visitors want opposite things:
//
//   · signed out — deciding whether this is for them. The right ask is to LOOK, and the
//     account comes later, on its own merits. Asking for a sign-up above the fold is asking
//     for commitment before showing anything.
//   · signed in — already decided. The dashboard is what they came back for, and a second
//     "browse" button is a link the navbar already carries.
//
// One module because there are three landing-page variants. A rule written three times is a
// rule that is right once: v2 could learn about the signed-in visitor and v1 not, and nothing
// would report it — both pages render, both look finished.
//
// Descriptors, not JSX: the variants lay their buttons out differently (a stack, a row, a
// split hero) and this decides WHAT is offered, not how it looks.

/**
 * The two hero buttons, in order. The first is the primary.
 *
 * @param {object|null} user  the signed-in user, or null
 * @param {(k: string, fallback?: string) => string} t
 */
export function heroCtas(user, t) {
  if (user) {
    return [
      { to: '/dashboard', label: t('home.cta.dash', 'Open your dashboard'), primary: true, arrow: true },
      { to: '/repos', label: t('home.cta.repos', 'Browse Server Repos') },
    ];
  }
  return [
    { to: '/repos', label: t('home.cta.repos', 'Browse Server Repos'), primary: true, arrow: true },
    { to: '/hosting', label: t('home.cta.host', 'Host a repo') },
  ];
}

/**
 * The line under the hero buttons, or null.
 *
 * Only for the visitor who has not signed in, and only because it answers the question that
 * stops one: "will this make me register first?". Shown to a member it would be noise about
 * a decision they already made.
 */
export function heroNote(user, t) {
  return user ? null : t('home.cta.note', 'Free to browse — no account needed.');
}

/** The closing section: its heading, its sub, and its one button. */
export function closingCta(user, t) {
  if (user) {
    return {
      title: t('home.cta2.title.in', 'Your turn'),
      sub: t('home.cta2.sub.in', 'Publish something, or check in on what you are hosting.'),
      action: { to: '/dashboard', label: t('home.cta.dash', 'Open your dashboard') },
    };
  }
  return {
    title: t('home.cta2.title'),
    sub: t('home.cta2.sub'),
    action: { to: '/auth', label: t('home.cta2.start.out', 'Create a free account') },
  };
}

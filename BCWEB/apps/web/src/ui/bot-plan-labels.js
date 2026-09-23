// What each Discord bot plan feature and limit is called, in one place.
//
// The keys are the API's (apps/api/src/lib/bot-entitlements.mjs: BOT_FEATURES, BOT_LIMITS);
// the admin plan editor, the public /hosting#bot cards and the server dashboard all read the
// names from here, so a feature is never called two things on two screens.

/** The feature keys, in the order the API lists them (a fallback when the API is not asked). */
export const BOT_FEATURE_KEYS = ['welcome', 'welcomeBanner', 'joinToCreate', 'gating', 'rolePanels', 'blog', 'automod', 'logRouting'];
export const BOT_LIMIT_KEYS = ['joinToCreateLobbies', 'gatingRules', 'rolePanels', 'blogRoutes', 'automodWords'];

export function botFeatureLabel(t, key) {
  switch (key) {
    case 'welcome': return t('botplan.f.welcome', 'Welcome and goodbye messages');
    case 'welcomeBanner': return t('botplan.f.welcomeBanner', 'Your own welcome banner image');
    case 'joinToCreate': return t('botplan.f.joinToCreate', 'Join-to-create voice rooms');
    case 'gating': return t('botplan.f.gating', 'Roles for linked accounts');
    case 'rolePanels': return t('botplan.f.rolePanels', 'Role and rules panels');
    case 'blog': return t('botplan.f.blog', 'Blog posts announced in your channels');
    case 'automod': return t('botplan.f.automod', 'Automatic moderation');
    case 'logRouting': return t('botplan.f.logRouting', 'Logs sorted by category, or into a forum');
    default: return key;
  }
}

/** "{n} …" sentence for a limit, with the number filled in. */
export function botLimitLabel(t, key, n) {
  const s = (() => {
    switch (key) {
      case 'joinToCreateLobbies': return t('botplan.l.joinToCreateLobbies', 'Up to {n} voice lobbies');
      case 'gatingRules': return t('botplan.l.gatingRules', 'Up to {n} linked-account role rules');
      case 'rolePanels': return t('botplan.l.rolePanels', 'Up to {n} role panels');
      case 'blogRoutes': return t('botplan.l.blogRoutes', 'Up to {n} blog announcement channels');
      case 'automodWords': return t('botplan.l.automodWords', 'Up to {n} blocked words or patterns');
      default: return `${key}: {n}`;
    }
  })();
  return s.replace('{n}', n);
}

/** The short name of a limit, for an input label. */
export function botLimitName(t, key) {
  switch (key) {
    case 'joinToCreateLobbies': return t('botplan.ln.joinToCreateLobbies', 'Voice lobbies');
    case 'gatingRules': return t('botplan.ln.gatingRules', 'Role rules');
    case 'rolePanels': return t('botplan.ln.rolePanels', 'Role panels');
    case 'blogRoutes': return t('botplan.ln.blogRoutes', 'Blog channels');
    case 'automodWords': return t('botplan.ln.automodWords', 'Blocked words');
    default: return key;
  }
}

/** The sentence for a 402 from a bot config save ({ error: 'plan_required', feature } or
 *  { error: 'plan_limit', limit, max }), or null for any other error. */
export function planErrorText(t, data) {
  if (data?.error === 'plan_required') {
    return t('botplan.err.required', '"{f}" needs a Discord bot plan on this server. Turn it off to save, or see the plans on the Hosting page.').replace('{f}', botFeatureLabel(t, data.feature));
  }
  if (data?.error === 'plan_limit') {
    return t('botplan.err.limit', 'This server\'s plan allows {n} here ({what}). Remove some to save, or take a bigger plan.').replace('{n}', data.max).replace('{what}', botLimitName(t, data.limit));
  }
  return null;
}

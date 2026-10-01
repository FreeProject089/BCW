// What each Discord bot plan feature and limit is called, in one place.
//
// The keys are the API's (apps/api/src/lib/bot-entitlements.mjs: BOT_FEATURES, BOT_LIMITS);
// the admin plan editor, the public /hosting#bot cards and the server dashboard all read the
// names from here, so a feature is never called two things on two screens.

/** The feature keys, in the order the API lists them (a fallback when the API is not asked). */
export const BOT_FEATURE_KEYS = ['welcome', 'welcomeBanner', 'joinToCreate', 'gating', 'rolePanels', 'blog', 'automod', 'logRouting', 'aiAutomod', 'aiAsk', 'jtcPro', 'aiByok'];
export const BOT_LIMIT_KEYS = ['joinToCreateLobbies', 'gatingRules', 'rolePanels', 'blogRoutes', 'automodWords', 'aiMonthly', 'storageMB'];
/** agent-bcw-bot: paid until an admin makes them free (PAID_BY_DEFAULT in the API). */
export const BOT_PAID_BY_DEFAULT = ['aiAutomod', 'jtcPro', 'aiByok'];

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
    // laya (agent-laya-bcweb): paid by default (PAID_BY_DEFAULT in the API's bot-entitlements.mjs).
    case 'aiAutomod': return t('botplan.f.aiAutomod', 'AI-assisted anti-phishing and anti-troll checks');
    // agent-bcw-bot
    case 'aiAsk': return t('botplan.f.aiAsk', 'AI helper for members (/ask)');
    case 'jtcPro': return t('botplan.f.jtcPro', 'Voice room pro controls (transfer, audio quality)');
    case 'aiByok': return t('botplan.f.aiByok', 'Your own AI key, no fee per call');
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
      case 'aiMonthly': return t('botplan.l.aiMonthly', '{n} AI calls a month included');
      case 'storageMB': return t('botplan.l.storageMB', '{n} MB of member storage');
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
    case 'aiMonthly': return t('botplan.ln.aiMonthly', 'AI calls a month');
    case 'storageMB': return t('botplan.ln.storageMB', 'Member storage (MB)');
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

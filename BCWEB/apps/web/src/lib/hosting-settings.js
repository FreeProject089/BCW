// The hosting-settings catalog, shared between the admin Hosting screen (which renders the
// live controls) and the Admin guide (which renders a COMPLETE per-setting reference from the
// same source). Kept data-only — icons are lucide NAMES, resolved by each consumer — so the
// guide and the controls can never drift, and the guide is complete by construction.
//
// Each key row is [settingKey, labelEN, descEN, kind, nativeUnit?].
//   kind: 'gbmb' (byte size w/ unit toggle) | 'number' | 'bool' | 'text'.
// The EN label/desc are the English source AND the t() fallback; the FR lives in i18n under
// hs.l.<key> / hs.d.<key>, so t(`hs.l.${key}`, labelEN) gives the right string in either lang.

export const HOSTING_SETTINGS_GROUPS = [
  { title: 'Capacity', gk: 'capacity', icon: 'HardDrive', keys: [
    ['hosting.totalCapacityGB', 'Total capacity (GB)', 'The overall ceiling for everything hosting draws against — checked against the real disk on save.', 'gbmb', 'GB'],
    ['hosting.reservedFreeGB', 'Reserved free margin (GB)', 'Always kept free below Total capacity, as a safety buffer.', 'gbmb', 'GB'],
    ['hosting.tempMarginGB', 'Temp margin for submissions (GB)', 'Separate pool for catalog submissions awaiting moderation — full = new uploads refused until reviewed.', 'gbmb', 'GB'],
    ['hosting.rejectedRetentionDays', 'Rejected-payload grace (days)', 'How long a rejected submission keeps its uploaded file before the sweeper purges it to reclaim temp space. The author can still fix & resubmit within this window. Default 7.', 'number'],
    ['hosting.freeTierCapEnabled', 'Cap the free hosting-plan pool', 'When on, the Free hosting plan goes "sold out" once free repos together reach the cap below — paid plans never count against this.', 'bool'],
    ['hosting.freeTierCapGB', 'Free hosting-plan pool cap (GB)', 'Total storage the Free plan can ever occupy across every user, once the toggle above is on.', 'gbmb', 'GB'],
    ['catalog.freeTierCapEnabled', 'Cap the free catalog-upload pool', 'When on, free catalog file hosting goes "sold out" once free uploads together reach the cap below — paid uploads never count against this.', 'bool'],
    ['catalog.freeTierCapMB', 'Free catalog-upload pool cap (MB)', 'Total payload bytes the free catalog tier can ever occupy across every user, once the toggle above is on.', 'gbmb', 'MB'],
    ['telemetry.storageLimitGB', 'BMM telemetry storage limit (GB)', 'How much storage the (separate) BMM telemetry database is allowed — shown as used vs. allocated in Total capacity above. 0 = untracked.', 'gbmb', 'GB'],
    ['analytics.maxMB', 'Analytics & replay storage cap (MB)', 'Combined size ceiling for the site\'s own analytics — pageviews, interactions, vitals and session replays. Once exceeded, the oldest data is trimmed (heaviest replays first) each sweep. Sits alongside the time-based retention on the Analytics screen. 0 = no size cap.', 'gbmb', 'MB'],
    ['marketplace.storageMB', 'Marketplace product files (MB)', 'Everything every paid product hands over as a FILE draws on this one pool. It is the only byte budget on the platform that had no control anywhere \u2014 the API read a 2048 default nobody could see. Sits on the same disk hosting is sold from, so raising it takes capacity away from what somebody paid for. 0 = no file products can be uploaded at all.', 'gbmb', 'MB'],
    ['hosting.maxUploadMbps', 'Max upload per repo (Mbps)', 'Hard ceiling on the upload bandwidth a single repo can request (custom plans + upgrades). Scarcity may lower it further as capacity fills. Default 1000.', 'number'],
    ['hosting.burstFactor', 'Bandwidth burst factor', 'Smart sharing: while the server is quiet, a repo download may burst to its cap × this factor, borrowing idle capacity. Tightens back to the cap under load. 1 = no bursting. Default 4.', 'number'],
    ['hosting.burstUntilActive', 'Burst until N active transfers', 'Bursting is allowed only while fewer than this many downloads are in flight at once; beyond it, each repo is held to its own cap. Default 3.', 'number'],
  ] },
  { title: 'Blog, docs & history', gk: 'blog', icon: 'Newspaper', keys: [
    ['blog.maxTotalPosts', 'Max total blog articles', 'Hard cap on the number of blog articles across the whole site. 0 = unlimited. New articles are refused once reached.', 'number'],
    ['blog.maxTotalKB', 'Max total blog size (KB)', 'Hard cap on the combined size of every article body (EN + FR). Enforced on create AND on edits that grow a post. 0 = unlimited.', 'number'],
    ['docs.maxTotalPages', 'Max total doc pages', 'Hard cap on the number of documentation pages. 0 = unlimited. New pages are refused once reached.', 'number'],
    ['docs.maxTotalKB', 'Max total docs size (KB)', 'Hard cap on the combined size of every doc page (EN + FR). Enforced on create AND on edits that grow a page. 0 = unlimited.', 'number'],
    ['history.maxRevisions', 'Edit-history: keep last N revisions', 'How many past snapshots each blog post / doc page keeps before the oldest is overwritten. Default 30.', 'number'],
    ['history.maxRevisionKB', 'Edit-history: max size per item (KB)', 'Also cap each item\'s stored history by size — older snapshots drop once this is exceeded. 0 = size limit off (count only).', 'number'],
  ] },
  { title: 'Security & audit logs', gk: 'security', icon: 'ShieldCheck', keys: [
    ['hosting.apiRateLimitMax', 'API requests per minute, per IP', 'Above this an IP gets 429 for the rest of the minute, and after 4 refusals it is blocked outright with 403 until the window passes. 600 is generous for a person (~10/s); lower it while something is hammering the site, raise it if real traffic is being refused. Clamped to 30-100000 — empty or 0 means the RATE_LIMIT_MAX default. Takes effect within ~15s, no restart.', 'number'],
    ['audit.maxDays', 'Audit log retention (days)', 'Staff-action log entries older than this are pruned. 0 = keep forever. The log is HMAC-chained (tamper-evident) — pruning is the only sanctioned deletion.', 'number'],
    ['audit.maxEntries', 'Audit log max entries', 'Also cap the staff-action log by entry count — the oldest are pruned past this. 0 = no count cap.', 'number'],
  ] },
  { title: 'Pricing', gk: 'pricing', icon: 'Receipt', keys: [
    ['pricing.perGBCents', 'Price per GB (¢ / month)', 'Base hosting cost, before the scarcity multiplier. Only applies above the free floor below.', 'number'],
    ['pricing.hostingFreeGB', 'Free hosting floor', 'Every repo\'s first N of storage cost nothing — small personal repos are free. Only the excess is billed.', 'gbmb', 'GB'],
    ['pricing.perUploadMbpsCents', 'Price per Mbps (¢ / month)', 'Cost per Mbps of upload bandwidth allotted to a repo.', 'number'],
    ['pricing.featurePerDayCents', 'Feature (boost) price / day (¢)', 'Cost to keep a repo featured on the public listing.', 'number'],
    ['pricing.catalogHostPerMBCents', 'Catalog file hosting (¢ / MB / month)', 'Charged to non-staff submitters for our-hosted payloads above the free floor below.', 'number'],
    ['pricing.catalogFreeMB', 'Free catalog upload floor', 'Every submission\'s (app/plugin/theme/preset) first N are free — only the excess is billed.', 'gbmb', 'MB'],
    ['marketplace.feePercentBp', 'Marketplace margin (basis points)', 'What the platform keeps on every marketplace sale, in basis points \u2014 1000 = 10%, 250 = 2.5%. A product can override it, and a product of ours can be set to 0 so we do not charge ourselves. SUPERADMIN only: it decides how much of somebody else\'s sale we keep, and the split is written onto each purchase as it was at the moment of the sale, so changing this never rewrites history.', 'number'],
    ['hosting.termMinMonths', 'Prepaid term: minimum (months)', 'The shortest term a hosting checkout accepts. A slider on the Hosting page runs from here to the maximum below; anything outside is refused by the server, whatever the page sent. 1 = one month. Default 1.', 'number'],
    ['hosting.termMaxMonths', 'Prepaid term: maximum (months)', 'The longest term anyone can prepay in one go, in months. Terms over 12 months are always a one-time charge (Stripe cannot bill an interval longer than a year), so auto-renew is unavailable above 12 whatever this says. Hard ceiling 120. Default 36.', 'number'],
    ['hosting.termStepMonths', 'Prepaid term: step (months)', 'The slider moves by this many months at a time, counted from the minimum: min 1 / step 3 sells 1, 4, 7…; min 3 / step 3 sells 3, 6, 9…. The discount tiers (3, 6, 12, 24 months and up) apply to whatever lands on the grid. Default 1.', 'number'],
    ['teams.maxOwned', 'Teams an account may own', 'How many teams one account can create as owner before it has to buy a slot. Staff are never capped. Default 3.', 'number'],
    ['teams.slotPriceCents', 'Extra team slot price (¢, one-off)', 'What one more team costs, paid once through Stripe; the slot is permanent for that account. Default 500 (5.00). Under 50 falls back to the default.', 'number'],
    ['teams.slotCurrency', 'Extra team slot currency', 'Three-letter Stripe currency for the slot price (eur, usd, chf…). Default eur.', 'text'],
    ['pricing.consolidationDiscount', 'Pool consolidation discount (fraction)', 'When an owner consolidates a merged pool\'s several subscriptions into one bigger plan, this fraction (0–0.9, e.g. 0.15 = 15% off) is taken off the single-plan price. Shown as the "consolidation savings" quote on their pools.', 'number'],
  ] },
  { title: 'Feature flags', gk: 'features', icon: 'Sliders', keys: [
    ['features.hostingEnabled', 'Hosting enabled', 'Turns the whole Server-Repo hosting feature off site-wide when unchecked.', 'bool'],
    ['features.paymentsEnabled', 'Payments (Stripe) enabled', 'Off = no new checkout can be started anywhere: hosting, catalog, boosts, MYO. Existing subscriptions are NOT cancelled and the Stripe webhook keeps running, so renewals and cancellations still get recorded — turning this off stops new money coming in, it does not abandon the customers you already have.', 'bool'],
    ['features.oauthLoginEnabled', 'Sign in with GitHub / Discord / Google', 'Off = those buttons disappear and both halves of the flow refuse, including a callback already in flight. Password sign-in is untouched, so this can never lock you out of this page.', 'bool'],
    ['features.ssoEnabled', 'Single sign-on (we are the identity provider)', 'Off = /oauth2/authorize and /oauth2/token refuse, so applications can no longer sign people in with a BetterCommunity account. Different from the switch above: that one is us USING GitHub/Discord, this one is other apps using US.', 'bool'],
    ['features.webhooksEnabled', 'Incoming webhooks (Ko-fi, code push)', 'Off = Ko-fi tips and repository push events are refused with 503. The Stripe webhook is deliberately NOT included — cutting that one makes the billing database drift away from Stripe.', 'bool'],
    ['features.publicApiEnabled', 'Public API (/v1) enabled', 'Off = every API-key route answers 503, including read-only ones. The site itself is unaffected; this only governs third-party keys.', 'bool'],
  ] },
  { title: 'Search & discoverability', gk: 'seo', icon: 'Globe', keys: [
    // Tag Manager & the Google/Bing verification tokens are edited in ONE place only — the
    // dedicated "Tag Manager & ownership tokens" card in SEO health (SeoTagsInline), which
    // validates the id format on save and explains the consent gate. Listing them here too
    // was the duplicate the admin kept hitting: the same four fields in two tabs.
    ['seo.title', 'Site title (EN)', 'The bold title of a search result and every shared link. Empty keeps the built-in name. Shown in the link-preview card below.', 'text'],
    ['seo.titleFr', 'Site title (FR)', 'The same, shown when the visitor is on the French site. Empty falls back to the English one.', 'text'],
    ['seo.description', 'Site description (EN)', 'The sentence a search result and every shared link show. Around 150 characters is what gets displayed; longer is cut mid-word. Empty keeps the built-in text.', 'text'],
    ['seo.descriptionFr', 'Site description (FR)', 'The same, shown when the visitor is on the French site. Empty falls back to the English one.', 'text'],
    ['seo.ogImage', 'Link preview image URL', 'The picture shown when the site is shared on Discord, X or anywhere else. 1200x630 is the size everything crops to. Empty = no image, which renders as a plain text link.', 'text'],
  ] },
  { title: 'Hosting lifecycle', gk: 'hosting', icon: 'Clock', keys: [
    ['hosting.graceLapseHours', 'Grace after a term ends (hours)', 'A hosting term that ended — or a subscription somebody cancelled — suspends the content instead of deleting it, and this is how long they have before it IS deleted. Suspended is read-only, not gone: the owner can still download a copy, move it to another account, or renew and have it come straight back. 72 = three days.', 'number'],
    ['hosting.graceUnpaidHours', 'Grace after a FAILED payment (hours)', 'The same window, for the case where the card failed rather than the person deciding. Longer on purpose: cancelling is a decision, an expired card is an accident, and the same three days punishes the accident. It applies from the moment Stripe gives up retrying, not from the first failure. 168 = one week.', 'number'],
    ['hosting.warnBeforeHours', 'Warn this long before a term ends (hours)', 'How far ahead the "your hosting expires soon" notice goes out. Raising the grace above this means people hear about the deadline after it is the only thing left — keep it at least as long as the notice period you want them to act on.', 'number'],
  ] },
  { title: 'Other projects', gk: 'showcase', icon: 'Layers', keys: [
    ['showcase.requestsEnabled', 'Accept listing requests (free)', 'Shows a "Submit your project" form on /projects. Off, and the form is not offered and the route refuses — a submission box on a site whose owner is not reading submissions is worse than no box. Every request is still reviewed here before anything appears.', 'bool'],
    ['showcase.paidEnabled', 'Accept PAID listing requests', 'Adds a paid option beside the free one (or instead of it, if the free one is off). Paying buys a place in the review queue and NOTHING else — the answer is still yours, and a rejected paid request may owe a refund.', 'bool'],
    ['showcase.priceCents', 'Paid request price (cents)', 'What the paid option charges, once, in the currency below. 2000 = 20.00.', 'number'],
    ['showcase.currency', 'Paid request currency', 'Three-letter code, lowercase — usd, eur, chf. Must be one Stripe accepts for your account.', 'text'],
    ['showcase.maxOpenPerUser', 'Max pending requests per person', 'How many un-reviewed requests one account may hold at once. Someone who can open fifty can bury the queue. 0 = no limit.', 'number'],
  ] },
];

// One-line description shown under each settings-group header panel (and in the guide).
export const HOSTING_GROUP_DESC = {
  'Capacity': 'Storage ceilings, free-tier pools, telemetry & per-repo CPU/upload limits.',
  'Blog, docs & history': 'Article/page count & size caps, and edit-history retention.',
  'Security & audit logs': 'How long the tamper-evident staff action log is kept.',
  'Pricing': 'What customers pay — per GB, Mbps, CPU, boost & catalog hosting.',
  'Feature flags': 'Master on/off switches. Each one says what it does NOT turn off, which is usually the part that matters.',
  'Search & discoverability': 'Google Tag, search-engine verification, and what a search result or a shared link says. Nothing here is consent-gated except the tag, which still waits for the Analytics cookie.',
  'Hosting lifecycle': 'How long people keep their data after the money stops. Suspended is read-only, never gone — the whole point of the window is that it can be undone by renewing, and that a backup can still be taken during it.',
  'Other projects': 'Whether people can ask for their project to be listed in the /projects grid, and whether they can pay to be looked at sooner. Both are OFF until you turn them on, and neither ever approves anything by itself.',
};

// i18n key for a group's translated title/desc, so the guide and controls read the same.
export const hsGroupKey = (gk) => `hs.g.${gk}`;
export const hsGroupDescKey = (gk) => `hs.gd.${gk}`;

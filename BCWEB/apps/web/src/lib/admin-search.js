// The admin dashboard's "find anything" ranking — local, no API, no embeddings.
//
// What "intelligent" means here: accents and case do not matter ("réglages" finds
// "Settings" through the synonym table, "Reglages" too); a word typed halfway matches
// ("modér" → Moderation); a typo of one or two letters still lands ("sanctons"); French and
// English both work whatever language the UI shows; and the guide's body text feeds each
// screen's keywords, so "Ko-fi" finds Funding and "72 hours" finds Hosting settings without
// anybody having to repeat those words in a label. Results carry a score so the best hit is
// first and Enter opens it.
const STRIP = /[̀-ͯ]/g;
export const norm = (s) => String(s || '').normalize('NFD').replace(STRIP, '').toLowerCase().replace(/[’']/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
export const tokens = (s) => norm(s).split(' ').filter((w) => w.length > 1);

// Both directions, both languages: a token on either side pulls in the whole row.
export const SYNONYMS = [
  ['settings', 'reglages', 'parametres', 'config', 'configuration', 'options', 'preferences'],
  ['moderation', 'modo', 'mod', 'queue', 'file', 'review', 'examen'],
  ['users', 'user', 'accounts', 'account', 'comptes', 'compte', 'utilisateurs', 'utilisateur', 'membres', 'member', 'people', 'gens'],
  ['ban', 'bans', 'bannir', 'banned', 'banni', 'suspend', 'suspension', 'suspendre', 'sanctions', 'sanction', 'punir', 'appeal', 'appel'],
  ['reports', 'report', 'signalements', 'signalement', 'flag', 'flags', 'abuse', 'abus'],
  ['messages', 'message', 'threads', 'thread', 'conversations', 'conversation', 'contact', 'inbox', 'boite', 'mail', 'mails', 'courriel', 'email', 'emails'],
  ['hosting', 'hebergement', 'heberger', 'host', 'repos', 'repo', 'depots', 'depot', 'pools', 'pool', 'storage', 'stockage', 'quota', 'gb', 'go'],
  ['billing', 'facturation', 'payments', 'payment', 'paiements', 'paiement', 'stripe', 'invoice', 'facture', 'subscription', 'abonnement', 'refund', 'rembourser', 'remboursement', 'price', 'prix', 'tarif', 'plan', 'plans'],
  ['promo', 'promotions', 'codes', 'code', 'coupon', 'discount', 'reduction', 'campaign', 'campagne', 'boost', 'boosts', 'featured', 'mis en avant'],
  ['catalog', 'catalogs', 'catalogue', 'catalogues', 'plugins', 'plugin', 'themes', 'theme', 'presets', 'preset', 'apps', 'app', 'submissions', 'soumissions', 'soumission', 'submit', 'soumettre', 'upload', 'envoi'],
  ['blog', 'posts', 'post', 'articles', 'article', 'news', 'actualites', 'announcements', 'annonces', 'annonce', 'newsletter'],
  ['docs', 'documentation', 'doc', 'guide', 'guides', 'help', 'aide', 'faq', 'questions'],
  ['analytics', 'stats', 'statistiques', 'statistics', 'metrics', 'metriques', 'traffic', 'trafic', 'visits', 'visites', 'vitals', 'performance', 'perf', 'cpu', 'memory', 'memoire', 'latency', 'latence', 'graph', 'graphique', 'chart'],
  ['server', 'serveur', 'infra', 'docker', 'caddy', 'database', 'base de donnees', 'db', 'backup', 'sauvegarde', 'restore', 'restaurer', 'logs', 'journaux', 'errors', 'erreurs', 'error', 'erreur', 'status', 'statut', 'health', 'sante', 'uptime'],
  ['discord', 'bot', 'guild', 'guilds', 'serveur discord', 'economy', 'economie', 'points', 'xp', 'level', 'niveau', 'casino', 'shop', 'boutique', 'automod', 'welcome', 'bienvenue', 'roles', 'role', 'giveaway', 'giveaways', 'tirage'],
  ['legal', 'juridique', 'privacy', 'confidentialite', 'terms', 'conditions', 'cookies', 'gdpr', 'rgpd', 'dpa', 'rights', 'droits', 'copyright', 'takedown', 'retrait'],
  ['theme', 'site theme', 'apparence', 'design', 'colors', 'couleurs', 'logo', 'brand', 'marque', 'homepage', 'accueil', 'home', 'landing', 'hero', 'scene', 'showcase', 'vitrine', 'projects', 'projets', 'projet', 'project'],
  ['languages', 'langues', 'langue', 'i18n', 'translation', 'traduction', 'traductions', 'locale', 'french', 'francais', 'english', 'anglais'],
  ['api', 'keys', 'key', 'cles', 'cle', 'tokens', 'token', 'sso', 'oauth', 'oidc', 'webhook', 'webhooks', 'integrations'],
  ['marketplace', 'market', 'products', 'product', 'produits', 'produit', 'sellers', 'seller', 'vendeur', 'vendeurs', 'connect', 'payout', 'payouts', 'versement'],
  ['myo', 'make your own', 'commissions', 'commission', 'commande', 'commandes', 'orders', 'order', 'quote', 'devis', 'consultation'],
  ['polls', 'poll', 'sondages', 'sondage', 'vote', 'votes', 'reactions', 'reaction'],
  ['charity', 'charite', 'donations', 'donation', 'dons', 'don', 'kofi', 'ko fi', 'tips', 'tip', 'funding', 'financement', 'goal', 'objectif', 'expenses', 'depenses', 'depense'],
  ['teams', 'team', 'equipes', 'equipe', 'members', 'invite', 'invitation', 'invitations'],
  ['pictures', 'picture', 'images', 'image', 'photo', 'avatar', 'avatars', 'lookalike', 'ressemblante', 'ressemblantes', 'phash', 'duplicate', 'doublon', 'copie', 'copy', 'media'],
  ['history', 'historique', 'audit', 'journal', 'log', 'versions', 'version', 'changes', 'changements', 'revert', 'annuler'],
  ['navigation', 'nav', 'menu', 'topbar', 'barre', 'footer', 'pied de page', 'links', 'liens', 'lien', 'link'],
  ['storage', 'assets', 'downloads', 'telechargements', 'files', 'fichiers', 'fichier', 'file', 'installers', 'installeur', 'releases', 'platform'],
  ['feedback', 'retours', 'retour', 'crash', 'crashes', 'plantage', 'plantages', 'bug', 'bugs', 'suggestion', 'suggestions'],
  ['needs', 'attention', 'todo', 'a traiter', 'waiting', 'attente', 'pending', 'urgent'],
];
const SYN = new Map();
for (const row of SYNONYMS) for (const w of row) { const k = norm(w); SYN.set(k, [...(SYN.get(k) || []), ...row.map(norm)]); }

/** Every token plus the synonym rows it belongs to. */
export function expand(word) {
  const k = norm(word);
  const out = new Set([k]);
  for (const s of SYN.get(k) || []) out.add(s);
  return [...out];
}

/** Levenshtein with an early exit: true when `a` and `b` differ by at most `max` edits. */
export function within(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return false;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let cur = [i]; let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v); if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return false;
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j];
  }
  return prev[b.length] <= max;
}

/** How well one query token matches one haystack token: 0 (no) … 1 (exact). */
function tokenScore(qt, ht) {
  if (qt === ht) return 1;
  if (ht.startsWith(qt)) return 0.85;
  if (qt.length >= 4 && ht.includes(qt)) return 0.6;
  if (qt.length >= 5 && within(qt, ht, qt.length >= 8 ? 2 : 1)) return 0.5;
  return 0;
}

/**
 * Score an entry `{ title, extra }` against a query. The title's own words count for more
 * than words found only in the guide text; a synonym hit counts as a slightly weaker word.
 * Every query token must find SOMETHING, or the entry is out — "hosting logs" must not
 * surface every hosting screen because one of the two words matched.
 */
export function score(query, title, extra = '') {
  const qts = tokens(query);
  if (!qts.length) return 0;
  const tt = tokens(title), et = tokens(extra);
  let total = 0;
  for (const qt of qts) {
    let best = 0;
    for (const v of expand(qt)) {
      const syn = v === qt ? 1 : 0.8;
      for (const ht of tt) best = Math.max(best, tokenScore(v, ht) * syn);
      for (const ht of et) best = Math.max(best, tokenScore(v, ht) * syn * 0.55);
    }
    if (!best) return 0;
    total += best;
  }
  // A whole-phrase prefix on the title is the strongest signal of all.
  if (norm(title).startsWith(norm(query))) total += 1;
  return total / qts.length;
}

/**
 * Rank the dashboard's leaves for a query. `keywords(id)` returns the guide text for a leaf
 * (or ''); the parent's label is searched too, so "server" finds the sub-tabs under Server.
 */
export function rankLeaves(leaves, query, keywords = () => '', limit = 8) {
  const q = String(query || '').trim();
  if (!q) return [];
  return leaves
    .map((lf) => ({ lf, s: score(q, `${lf.label} ${lf.parent?.label && lf.parent.label !== lf.label ? lf.parent.label : ''}`, `${keywords(lf.id) || ''} ${keywords(lf.parent?.id) || ''}`) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.lf);
}

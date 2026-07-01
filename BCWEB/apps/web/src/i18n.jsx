import { createContext, useContext, useState } from 'react';
import { Languages } from 'lucide-react';

// Lightweight i18n. Add a language = add a dictionary below. Strings fall back to
// English, then to the key, so missing translations never break the UI.
const DICT = {
  en: {
    'nav.bmm': 'BMM', 'nav.bsm': 'BSM', 'nav.installer': 'Installer', 'nav.blog': 'Blog',
    'nav.repos': 'Repos', 'nav.hosting': 'Hosting', 'nav.dashboard': 'Dashboard', 'nav.admin': 'Admin',
    'nav.signin': 'Sign in', 'nav.signout': 'Sign out',

    'home.badge': 'BetterCommunity',
    'home.hero1': 'The home for all', 'home.brand': 'Better', 'home.hero2': 'projects.',
    'home.sub': 'One place for every Better* project — browse catalogs, share presets, manage your uploads, and host your Server-Repos.',
    'home.cta.explore': 'Explore the catalog', 'home.cta.host': 'Host a repo',
    'home.feat.moderated': 'Moderated catalogs', 'home.feat.moderated.d': 'Every submission is reviewed before it goes live.',
    'home.feat.accounts': 'Accounts & dashboards', 'home.feat.accounts.d': 'Manage your uploads and propose updates anytime.',
    'home.feat.hosting': 'Pay-as-you-grow hosting', 'home.feat.hosting.d': 'Flexible Server-Repo hosting with capacity guards.',
    'home.steps.title': 'Get going in minutes', 'home.steps.sub': 'Three steps to join the community.',
    'home.step1': 'Create an account', 'home.step1.d': 'Sign up free to publish and manage your content.',
    'home.step2': 'Share or browse', 'home.step2.d': 'Submit apps, plugins, themes and presets — or discover the community’s.',
    'home.step3': 'Host & scale', 'home.step3.d': 'Spin up a hosted Server-Repo and pay only for what you use.',
    'home.news': 'Latest news', 'home.news.all': 'All posts', 'home.news.none': 'No posts yet.',
    'home.cta2.title': 'Build with the Better* community', 'home.cta2.sub': 'Join, publish, and help the projects grow. Every contribution counts.',
    'home.cta2.start': 'Get started', 'home.cta2.kofi': 'Support on Ko-fi',
    'prod.bmm.d': 'Apps, plugins & themes for Better Mods Manager.',
    'prod.bsm.d': 'Community sound presets, one JSON each.',
    'prod.installer.d': 'A fast, modern installer for the suite.',
    'prod.hosting.d': 'Let us host your Server-Repo, billed by size.', 'prod.open': 'Open',

    'foot.products': 'Products', 'foot.community': 'Community', 'foot.legal': 'Legal',
    'foot.tagline': 'The home for all Better projects.', 'foot.kofi': 'Support us on Ko-fi',
    'foot.privacy': 'Privacy', 'foot.terms': 'Terms', 'foot.cookies': 'Cookies', 'foot.rights': 'All rights reserved.',

    'cookie.title': 'Cookies',
    'cookie.body': 'We use an essential cookie to keep you signed in. With your consent we also collect privacy-friendly, first-party page analytics — no third parties, no ad tracking.',
    'cookie.policy': 'Cookie Policy', 'cookie.all': 'Accept all', 'cookie.essential': 'Essential only',

    'auth.welcome': 'Welcome back', 'auth.create': 'Create your account',
    'auth.subin': 'Sign in to manage your content.', 'auth.subup': 'Join to publish and host.',
    'auth.name': 'Display name', 'auth.email': 'Email', 'auth.password': 'Password',
    'auth.toRegister': 'Need an account? Register', 'auth.toLogin': 'Have an account? Sign in',
    'auth.welcome.toast': 'Welcome!',

    'proj.overview': 'Overview', 'proj.releases': 'Release Notes', 'proj.community': 'Community', 'proj.legal': 'Legal',
    'proj.browse': 'Browse catalog', 'proj.progress': 'Progress tracker', 'proj.noprogress': 'No roadmap yet',
    'proj.nocontrib': 'No contributors yet', 'proj.messages': 'Community messages',
    'common.loading': 'Loading…',
  },
  fr: {
    'nav.bmm': 'BMM', 'nav.bsm': 'BSM', 'nav.installer': 'Installeur', 'nav.blog': 'Blog',
    'nav.repos': 'Dépôts', 'nav.hosting': 'Hébergement', 'nav.dashboard': 'Tableau de bord', 'nav.admin': 'Admin',
    'nav.signin': 'Connexion', 'nav.signout': 'Déconnexion',

    'home.badge': 'BetterCommunity',
    'home.hero1': 'La maison de tous les', 'home.brand': 'Better', 'home.hero2': 'projets.',
    'home.sub': 'Un seul endroit pour chaque projet Better* — parcours les catalogues, partage des presets, gère tes envois et héberge tes Server-Repos.',
    'home.cta.explore': 'Explorer le catalogue', 'home.cta.host': 'Héberger un dépôt',
    'home.feat.moderated': 'Catalogues modérés', 'home.feat.moderated.d': 'Chaque soumission est vérifiée avant publication.',
    'home.feat.accounts': 'Comptes & tableaux de bord', 'home.feat.accounts.d': 'Gère tes envois et propose des mises à jour quand tu veux.',
    'home.feat.hosting': 'Hébergement à la demande', 'home.feat.hosting.d': 'Hébergement de Server-Repos flexible avec garde-fous de capacité.',
    'home.steps.title': 'Lance-toi en quelques minutes', 'home.steps.sub': 'Trois étapes pour rejoindre la communauté.',
    'home.step1': 'Crée un compte', 'home.step1.d': 'Inscris-toi gratuitement pour publier et gérer ton contenu.',
    'home.step2': 'Partage ou explore', 'home.step2.d': 'Soumets apps, plugins, thèmes et presets — ou découvre ceux de la communauté.',
    'home.step3': 'Héberge & passe à l’échelle', 'home.step3.d': 'Lance un Server-Repo hébergé et ne paie que ce que tu utilises.',
    'home.news': 'Dernières actus', 'home.news.all': 'Tous les articles', 'home.news.none': 'Aucun article pour le moment.',
    'home.cta2.title': 'Construis avec la communauté Better*', 'home.cta2.sub': 'Rejoins, publie et aide les projets à grandir. Chaque contribution compte.',
    'home.cta2.start': 'Commencer', 'home.cta2.kofi': 'Soutenir sur Ko-fi',
    'prod.bmm.d': 'Apps, plugins & thèmes pour Better Mods Manager.',
    'prod.bsm.d': 'Presets sonores de la communauté, un JSON chacun.',
    'prod.installer.d': 'Un installeur moderne et rapide pour la suite.',
    'prod.hosting.d': 'On héberge ton Server-Repo, facturé à la taille.', 'prod.open': 'Ouvrir',

    'foot.products': 'Produits', 'foot.community': 'Communauté', 'foot.legal': 'Légal',
    'foot.tagline': 'La maison de tous les projets Better.', 'foot.kofi': 'Soutiens-nous sur Ko-fi',
    'foot.privacy': 'Confidentialité', 'foot.terms': 'Conditions', 'foot.cookies': 'Cookies', 'foot.rights': 'Tous droits réservés.',

    'cookie.title': 'Cookies',
    'cookie.body': 'Nous utilisons un cookie essentiel pour te garder connecté. Avec ton accord, nous collectons aussi des statistiques de pages respectueuses de la vie privée, en interne — aucun tiers, aucun pistage publicitaire.',
    'cookie.policy': 'Politique de cookies', 'cookie.all': 'Tout accepter', 'cookie.essential': 'Essentiels uniquement',

    'auth.welcome': 'Content de te revoir', 'auth.create': 'Crée ton compte',
    'auth.subin': 'Connecte-toi pour gérer ton contenu.', 'auth.subup': 'Rejoins pour publier et héberger.',
    'auth.name': 'Nom affiché', 'auth.email': 'E-mail', 'auth.password': 'Mot de passe',
    'auth.toRegister': 'Pas de compte ? Inscris-toi', 'auth.toLogin': 'Déjà un compte ? Connecte-toi',
    'auth.welcome.toast': 'Bienvenue !',

    'proj.overview': 'Aperçu', 'proj.releases': 'Notes de version', 'proj.community': 'Communauté', 'proj.legal': 'Légal',
    'proj.browse': 'Voir le catalogue', 'proj.progress': 'Suivi d’avancement', 'proj.noprogress': 'Pas encore de roadmap',
    'proj.nocontrib': 'Pas encore de contributeurs', 'proj.messages': 'Messages de la communauté',
    'common.loading': 'Chargement…',
  },
};

const KEY = 'bcw_lang';
const Ctx = createContext(null);
export const useI18n = () => useContext(Ctx);

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(() => { try { return localStorage.getItem(KEY) || 'en'; } catch { return 'en'; } });
  const setLang = (l) => { setLangState(l); try { localStorage.setItem(KEY, l); } catch {} };
  const t = (k, fb) => DICT[lang]?.[k] ?? DICT.en[k] ?? fb ?? k;
  return <Ctx.Provider value={{ lang, setLang, t }}>{children}</Ctx.Provider>;
}

export function LangToggle() {
  const { lang, setLang } = useI18n();
  return (
    <button className="nav-link" onClick={() => setLang(lang === 'en' ? 'fr' : 'en')} title="Language" aria-label="Language">
      <Languages size={16} /> <span className="text-xs font-semibold uppercase">{lang}</span>
    </button>
  );
}

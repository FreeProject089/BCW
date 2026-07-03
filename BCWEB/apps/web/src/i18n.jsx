import { createContext, useContext, useState, useRef, useEffect } from 'react';
import { Languages } from 'lucide-react';

// Lightweight i18n. Add a language = add a dictionary below. Strings fall back to
// English, then to the key, so missing translations never break the UI.
const DICT = {
  en: {
    'nav.home': 'Home', 'nav.bmm': 'BMM', 'nav.bsm': 'BSM', 'nav.installer': 'BI', 'nav.blog': 'Blog',
    'nav.repos': 'Repos', 'nav.hosting': 'Hosting', 'nav.projects': 'Projects', 'nav.dashboard': 'Dashboard', 'nav.admin': 'Admin',
    'nav.settings': 'Settings',
    'projects.sub': 'More from the Better* ecosystem.',
    'nav.signin': 'Sign in', 'nav.signout': 'Sign out', 'nav.notifications': 'Notifications',
    'notif.none': 'No notifications', 'notif.markall': 'Mark all read', 'notif.open': 'Open dashboard', 'notif.justnow': 'just now',
    'notif.clear': 'Clear', 'notif.clearmenu.hint': "Just clears this menu — they'll be back next time.", 'notif.clearall': 'Clear all', 'notif.clearall.confirm.t': 'Clear all notifications', 'notif.clearall.confirm.m': 'This permanently deletes all of your notifications. Continue?',

    'home.badge': 'BetterCommunity',
    'home.hero1': 'The home for all', 'home.brand': 'Better', 'home.hero2': 'projects.',
    'home.sub': 'One place for every Better* project — browse catalogs, share presets, manage your uploads, and host your Server-Repos.',
    'home.cta.explore': 'Explore the catalog', 'home.cta.host': 'Host a repo',
    'home.feat.moderated': 'Moderated catalogs', 'home.feat.moderated.d': 'Every submission is reviewed before it goes live.',
    'home.feat.accounts': 'Accounts & dashboards', 'home.feat.accounts.d': 'Manage your uploads and propose updates anytime.',
    'home.feat.hosting': 'Pay-as-you-grow hosting', 'home.feat.hosting.d': 'Flexible Server-Repo hosting with capacity guards.',
    'home.feat.install': 'One-click install', 'home.feat.install.d': 'Catalog entries install straight into BMM through bmm:// deeplinks — no manual downloads.',
    'home.feat.privacy': 'Privacy-first', 'home.feat.privacy.d': 'No third-party trackers — anonymous first-party analytics, and only with your consent.',
    'home.pipe.sub': 'Submitted', 'home.pipe.review': 'In review', 'home.pipe.live': 'Published',
    'home.stat.items': 'Mods & presets', 'home.stat.downloads': 'Downloads', 'home.stat.members': 'Members', 'home.stat.repos': 'Hosted repos',
    'home.cta2.discord': 'Join the Discord',
    'home.steps.title': 'Get going in minutes', 'home.steps.sub': 'Three steps to join the community.',
    'home.step1': 'Create an account', 'home.step1.d': 'Sign up free to publish and manage your content.',
    'home.step2': 'Share or browse', 'home.step2.d': 'Submit apps, plugins, themes and presets — or discover the community’s.',
    'home.step3': 'Host & scale', 'home.step3.d': 'Spin up a hosted Server-Repo and pay only for what you use.',
    'home.step1.cta': 'Sign up free', 'home.step1.done': "You're set — view profile", 'home.step2.cta': 'Browse the catalog', 'home.step3.cta': 'See hosting plans',
    'home.news': 'Latest news', 'home.news.all': 'All posts', 'home.news.none': 'No posts yet.',
    'home.cta2.title': 'Build with the Better* community', 'home.cta2.sub': 'Join, publish, and help the projects grow. Every contribution counts.',
    'home.cta2.start': 'Get started', 'home.cta2.kofi': 'Support on Ko-fi',
    'home.kofi.goal.title': 'Funding goal', 'home.kofi.goal.tips': '{n} tips', 'home.kofi.goal.help': 'Help keep the servers running — every tip counts.',
    'prod.bmm.d': 'Apps, plugins & themes for Better Mods Manager.',
    'prod.bsm.d': 'Community sound presets, one JSON each.',
    'prod.installer.d': 'A fast, modern installer for the suite.',
    'prod.hosting.d': 'Let us host your Server-Repo, billed by size.', 'prod.open': 'Open',

    'foot.products': 'Products', 'foot.community': 'Community', 'foot.legal': 'Legal',
    'foot.tagline': 'The home for all Better projects.', 'foot.kofi': 'Support us on Ko-fi',
    'foot.privacy': 'Privacy', 'foot.terms': 'Terms', 'foot.cookies': 'Cookies', 'foot.rights': 'All rights reserved.', 'foot.about': 'About', 'foot.refunds': 'Payments & Refunds',

    'cookie.title': 'Cookies',
    'cookie.body': 'We use an essential cookie to keep you signed in. With your consent we also collect privacy-friendly, first-party page analytics — no third parties, no ad tracking.',
    'cookie.policy': 'Cookie Policy', 'cookie.all': 'Accept all', 'cookie.essential': 'Essential only',

    'auth.welcome': 'Welcome back', 'auth.create': 'Create your account',
    'auth.subin': 'Sign in to manage your content.', 'auth.subup': 'Join to publish and host.',
    'auth.name': 'Display name', 'auth.email': 'Email', 'auth.password': 'Password',
    'auth.toRegister': 'Need an account? Register', 'auth.toLogin': 'Have an account? Sign in',
    'auth.or': 'or', 'auth.oauth.github': 'Continue with GitHub', 'auth.oauth.discord': 'Continue with Discord',
    'auth.err.oauthOnly': "This account was created with GitHub or Discord — use that to sign in, or set a password from your profile once signed in.",
    'auth.welcome.toast': 'Welcome!',
    'auth.redirecting': 'Already signed in — taking you to your profile…',
    'auth.forgot': 'Forgot your password?',
    'auth.reset.title': 'Reset password', 'auth.reset.sub': 'Enter your email to get a reset token.',
    'auth.newpw.title': 'Set a new password', 'auth.newpw.sub': 'Choose a new password for your account.',
    'auth.sendreset': 'Send reset', 'auth.updatepw': 'Update password',
    'auth.token': 'Reset token', 'auth.token.ph': 'paste your token',
    'auth.newpw': 'New password', 'auth.confirmpw': 'Confirm password',
    'auth.toast.sent': 'If that email exists, a reset link was sent.',
    'auth.toast.updated': 'Password updated — sign in.',
    'auth.err.creds': 'Wrong email or password.', 'auth.err.taken': 'Email already registered.',
    'auth.err.token': 'Invalid or expired reset token.', 'auth.err.pow': 'Verification failed — try again.',
    'auth.err.fail': 'Something went wrong.', 'auth.err.match': 'Passwords do not match.', 'auth.err.short': 'Password must be at least 8 characters.',
    'auth.2fa.title': 'Two-factor code', 'auth.2fa.sub': 'Enter the 6-digit code from your authenticator app.',
    'auth.2fa.code': 'Code', 'auth.2fa.verify': 'Verify', 'auth.2fa.back': 'Back to login', 'auth.2fa.bad': 'Invalid code.',

    'proj.overview': 'Overview', 'proj.releases': 'Release Notes', 'proj.community': 'Community', 'proj.legal': 'Legal',
    'proj.browse': 'Browse catalog', 'proj.progress': 'Progress tracker', 'proj.noprogress': 'No roadmap yet',
    'proj.nocontrib': 'No contributors yet', 'proj.messages': 'Community messages',
    'proj.blog': 'Blog', 'proj.noposts': 'No posts yet',
    'common.loading': 'Loading…',
  },
  fr: {
    'intro.brand': 'BetterCommunity', 'intro.dontshow': 'Ne plus afficher', 'intro.skip': "Passer l'intro",
    'admin.2fa.title': 'Authentification à deux facteurs requise', 'admin.2fa.sub': "Le tableau de bord admin nécessite la 2FA sur ton compte, même pour les admins. Active-la dans ton profil pour continuer.", 'admin.2fa.cta': 'Aller au profil',
    'nav.home': 'Accueil', 'nav.bmm': 'BMM', 'nav.bsm': 'BSM', 'nav.installer': 'BI', 'nav.blog': 'Blog',
    'nav.repos': 'Dépôts', 'nav.hosting': 'Hébergement', 'nav.projects': 'Projets', 'nav.dashboard': 'Tableau de bord', 'nav.admin': 'Admin',
    'nav.settings': 'Paramètres',
    'set.title': 'Paramètres', 'set.sub': 'Tes préférences — enregistrées sur ce navigateur uniquement.',
    'set.appearance': 'Apparence', 'set.theme': 'Thème', 'set.theme.d': 'Clair ou sombre — appliqué instantanément.',
    'set.light': 'Clair', 'set.dark': 'Sombre',
    'set.lang': 'Langue', 'set.lang.d': "Langue de l'interface.",
    'set.intro': "Animation d'intro", 'set.intro.d': "Jouer l'intro de l'orbe à chaque chargement de page.",
    'set.orbtr': "Transitions de l'orbe entre les pages", 'set.orbtr.d': "À chaque navigation, l'orbe éclate et la caméra plonge dans un fragment aléatoire, puis se reconstruit. Désactivé par défaut.",
    'set.glass': 'Surfaces translucides', 'set.glass.d': 'Cartes & fenêtres en verre dépoli au lieu de pleines.',
    'set.glass.opacity': 'Opacité',
    'set.privacy': 'Cookies & confidentialité', 'set.cookies': 'Cookies analytiques',
    'set.cookies.d': "« Essentiels » te garde connecté ; « Tous » active aussi des analyses de pages respectueuses de la vie privée.",
    'set.essential': 'Essentiels seulement', 'set.all': 'Tout accepter',
    'set.privacy.more': 'En savoir plus dans la', 'set.and': 'et la', 'set.saved': 'Enregistré.',
    'projects.sub': 'Plus depuis l’écosystème Better*.',
    'nav.signin': 'Connexion', 'nav.signout': 'Déconnexion', 'nav.notifications': 'Notifications',
    'notif.none': 'Aucune notification', 'notif.markall': 'Tout marquer comme lu', 'notif.open': 'Ouvrir le tableau de bord', 'notif.justnow': "à l'instant",
    'notif.clear': 'Effacer', 'notif.clearmenu.hint': 'Efface juste ce menu — elles reviendront la prochaine fois.', 'notif.clearall': 'Tout effacer', 'notif.clearall.confirm.t': 'Effacer toutes les notifications', 'notif.clearall.confirm.m': 'Ceci supprime définitivement toutes tes notifications. Continuer ?',

    'home.badge': 'BetterCommunity',
    'home.hero1': 'La maison de tous les', 'home.brand': 'Better', 'home.hero2': 'projets.',
    'home.sub': 'Un seul endroit pour chaque projet Better* — parcours les catalogues, partage des presets, gère tes envois et héberge tes Server-Repos.',
    'home.cta.explore': 'Explorer le catalogue', 'home.cta.host': 'Héberger un dépôt',
    'home.feat.moderated': 'Catalogues modérés', 'home.feat.moderated.d': 'Chaque soumission est vérifiée avant publication.',
    'home.feat.accounts': 'Comptes & tableaux de bord', 'home.feat.accounts.d': 'Gère tes envois et propose des mises à jour quand tu veux.',
    'home.feat.hosting': 'Hébergement à la demande', 'home.feat.hosting.d': 'Hébergement de Server-Repos flexible avec garde-fous de capacité.',
    'home.feat.install': 'Installation en un clic', 'home.feat.install.d': 'Les entrées du catalogue s’installent directement dans BMM via des liens bmm:// — sans téléchargement manuel.',
    'home.feat.privacy': 'Vie privée d’abord', 'home.feat.privacy.d': 'Aucun traqueur tiers — des statistiques first-party anonymes, et uniquement avec ton consentement.',
    'home.pipe.sub': 'Soumis', 'home.pipe.review': 'En review', 'home.pipe.live': 'Publié',
    'home.stat.items': 'Mods & presets', 'home.stat.downloads': 'Téléchargements', 'home.stat.members': 'Membres', 'home.stat.repos': 'Repos hébergés',
    'home.cta2.discord': 'Rejoindre le Discord',
    'home.steps.title': 'Lance-toi en quelques minutes', 'home.steps.sub': 'Trois étapes pour rejoindre la communauté.',
    'home.step1': 'Crée un compte', 'home.step1.d': 'Inscris-toi gratuitement pour publier et gérer ton contenu.',
    'home.step2': 'Partage ou explore', 'home.step2.d': 'Soumets apps, plugins, thèmes et presets — ou découvre ceux de la communauté.',
    'home.step3': 'Héberge & passe à l’échelle', 'home.step3.d': 'Lance un Server-Repo hébergé et ne paie que ce que tu utilises.',
    'home.step1.cta': 'Inscription gratuite', 'home.step1.done': 'C’est fait — voir le profil', 'home.step2.cta': 'Parcourir le catalogue', 'home.step3.cta': 'Voir les offres d’hébergement',
    'home.news': 'Dernières actus', 'home.news.all': 'Tous les articles', 'home.news.none': 'Aucun article pour le moment.',
    'home.k.products': 'La suite', 'home.k.why': 'Pourquoi BetterCommunity', 'home.k.start': 'Commencer', 'home.k.news': 'Le blog',
    'home.cta2.title': 'Construis avec la communauté Better*', 'home.cta2.sub': 'Rejoins, publie et aide les projets à grandir. Chaque contribution compte.',
    'home.cta2.start': 'Commencer', 'home.cta2.kofi': 'Soutenir sur Ko-fi',
    'home.kofi.goal.title': 'Objectif de financement', 'home.kofi.goal.tips': '{n} dons', 'home.kofi.goal.help': 'Aide à financer les serveurs — chaque don compte.',
    'prod.bmm.d': 'Apps, plugins & thèmes pour Better Mods Manager.',
    'prod.bsm.d': 'Presets sonores de la communauté, un JSON chacun.',
    'prod.installer.d': 'Un installeur moderne et rapide pour la suite.',
    'prod.hosting.d': 'On héberge ton Server-Repo, facturé à la taille.', 'prod.open': 'Ouvrir',

    'foot.products': 'Produits', 'foot.community': 'Communauté', 'foot.legal': 'Légal',
    'foot.tagline': 'La maison de tous les projets Better.', 'foot.kofi': 'Soutiens-nous sur Ko-fi',
    'foot.privacy': 'Confidentialité', 'foot.terms': 'Conditions', 'foot.cookies': 'Cookies', 'foot.rights': 'Tous droits réservés.', 'foot.about': 'À propos', 'foot.refunds': 'Paiements & Remboursements',

    'cookie.title': 'Cookies',
    'cookie.body': 'Nous utilisons un cookie essentiel pour te garder connecté. Avec ton accord, nous collectons aussi des statistiques de pages respectueuses de la vie privée, en interne — aucun tiers, aucun pistage publicitaire.',
    'cookie.policy': 'Politique de cookies', 'cookie.all': 'Tout accepter', 'cookie.essential': 'Essentiels uniquement',

    'auth.welcome': 'Content de te revoir', 'auth.create': 'Crée ton compte',
    'auth.subin': 'Connecte-toi pour gérer ton contenu.', 'auth.subup': 'Rejoins pour publier et héberger.',
    'auth.name': 'Nom affiché', 'auth.email': 'E-mail', 'auth.password': 'Mot de passe',
    'auth.toRegister': 'Pas de compte ? Inscris-toi', 'auth.toLogin': 'Déjà un compte ? Connecte-toi',
    'auth.or': 'ou', 'auth.oauth.github': 'Continuer avec GitHub', 'auth.oauth.discord': 'Continuer avec Discord',
    'auth.err.oauthOnly': "Ce compte a été créé avec GitHub ou Discord — utilise ça pour te connecter, ou définis un mot de passe depuis ton profil une fois connecté.",
    'auth.welcome.toast': 'Bienvenue !',
    'auth.redirecting': 'Déjà connecté — redirection vers ton profil…',
    'auth.forgot': 'Mot de passe oublié ?',
    'auth.reset.title': 'Réinitialiser le mot de passe', 'auth.reset.sub': 'Saisis ton e-mail pour recevoir un jeton de réinitialisation.',
    'auth.newpw.title': 'Définir un nouveau mot de passe', 'auth.newpw.sub': 'Choisis un nouveau mot de passe pour ton compte.',
    'auth.sendreset': 'Envoyer', 'auth.updatepw': 'Mettre à jour',
    'auth.token': 'Jeton de réinitialisation', 'auth.token.ph': 'colle ton jeton',
    'auth.newpw': 'Nouveau mot de passe', 'auth.confirmpw': 'Confirme le mot de passe',
    'auth.toast.sent': 'Si cet e-mail existe, un lien de réinitialisation a été envoyé.',
    'auth.toast.updated': 'Mot de passe mis à jour — connecte-toi.',
    'auth.err.creds': 'E-mail ou mot de passe incorrect.', 'auth.err.taken': 'E-mail déjà enregistré.',
    'auth.err.token': 'Jeton de réinitialisation invalide ou expiré.', 'auth.err.pow': 'Échec de la vérification — réessaie.',
    'auth.err.fail': 'Une erreur est survenue.', 'auth.err.match': 'Les mots de passe ne correspondent pas.', 'auth.err.short': 'Le mot de passe doit faire au moins 8 caractères.',
    'auth.2fa.title': 'Code à deux facteurs', 'auth.2fa.sub': 'Entre le code à 6 chiffres de ton application d’authentification.',
    'auth.2fa.code': 'Code', 'auth.2fa.verify': 'Vérifier', 'auth.2fa.back': 'Retour à la connexion', 'auth.2fa.bad': 'Code invalide.',

    'proj.overview': 'Aperçu', 'proj.releases': 'Notes de version', 'proj.community': 'Communauté', 'proj.legal': 'Légal',
    'proj.browse': 'Voir le catalogue', 'proj.progress': 'Suivi d’avancement', 'proj.noprogress': 'Pas encore de roadmap',
    'proj.nocontrib': 'Pas encore de contributeurs', 'proj.messages': 'Messages de la communauté',
    'proj.blog': 'Blog', 'proj.noposts': 'Pas encore de billets',
    'common.loading': 'Chargement…', 'common.cancel': 'Annuler',

    'hosting.title': 'Héberger un Server-Repo', 'hosting.sub': 'On l’exécute, tu le gères. Paie selon la taille dont tu as besoin.',
    'hosting.single': 'Dépôt unique', 'hosting.single.d': 'Un seul dépôt avec tout le quota.',
    'hosting.multi': 'Dépôts multiples', 'hosting.multi.d': 'Répartis le stockage sur plusieurs dépôts, gérés par toi.',
    'hosting.term': 'Durée de facturation', 'hosting.term.note': '· prépayé, min. 1 mois',
    'hosting.term.note2': 'Prépayé — min. 1 mois, plus long = plus de réduction', 'hosting.2yr': '2 ans', 'hosting.standard': 'standard',
    'hosting.mo': 'mois', 'hosting.1yr': '1 an', 'hosting.best': 'TOP', 'hosting.popular': 'RECOMMANDÉE',
    'hosting.best2': 'Meilleure offre', 'hosting.savepct': 'Économise {n}% vs mensuel',
    'hosting.free': 'libres', 'hosting.permo': '/mois',
    'hosting.billedfor': 'facturé pour', 'hosting.billedmonthly': 'facturé mensuellement', 'hosting.gethosted': 'Héberger',
    'hosting.soldout': 'Aucune place d’hébergement disponible pour le moment', 'hosting.soldout.short': 'Complet',
    'hosting.soldout.d': 'Tous les plans sont complets jusqu’à ce qu’un dépôt existant libère de la place ou qu’un admin augmente la capacité totale. Réessaie plus tard.',
    'hosting.nospace': 'Pas assez de place',
    'hosting.freeplan.title': 'Envie d’essayer d’abord ?', 'hosting.freeplan.badge': 'GRATUIT',
    'hosting.freeplan.sub': 'Héberge un petit dépôt sans frais — {gb} Go de stockage, {mbps} Mbps d’envoi, gratuit pour toujours.',
    'hosting.freeplan.cta': 'Obtenir gratuitement', 'hosting.freeplan.provisioned': 'Ton dépôt « {name} » est en cours de provisionnement — palier gratuit, aucun frais.',
    'hosting.freeplan.note': 'Un dépôt gratuit par compte. Tu peux toujours augmenter la taille plus tard — le palier gratuit continue de s\'appliquer, donc tu ne payes que le surplus.',
    'hosting.freeplan.soldout': 'Plan gratuit complet', 'hosting.freeplan.pool': 'Réserve gratuite restante',
    'hosting.err.freetierfull': 'Le plan gratuit est complet en ce moment — toutes les places gratuites sont prises. Essaie un plan payant, ou réessaie plus tard.',
    'hosting.err.freeused': 'Tu as déjà utilisé ton dépôt gratuit (par compte et par identifiant créateur lié) — choisis un plan payant à la place.',
    'hosting.custom.title': 'Besoin d’une autre taille ?',
    'hosting.custom.sub': 'Crée un plan sur mesure — choisis ton stockage, ta vitesse d’envoi et le CPU. Le prix s’adapte instantanément.',
    'hosting.custom.cta': 'Créer un plan sur mesure', 'hosting.custom.modaltitle': 'Créer un plan sur mesure',
    'hosting.note': 'Les mises à jour nécessitent seulement un SHA valide. Nous fixons la limite d’envoi par dépôt.',
    'hosting.pool.title': 'Nouveau pool de stockage', 'hosting.pool.label': 'Nom du pool', 'hosting.pool.ph': 'mon-pool',
    'hosting.repo.title': 'Héberger un dépôt', 'hosting.repo.label': 'Nom du dépôt', 'hosting.repo.ph': 'mon-super-depot',
    'hosting.continue': 'Continuer vers le paiement',
    'hosting.err.link': 'Lie d’abord un creator id BMM (Profil → Creator IDs) pour héberger un dépôt.',
    'hosting.err.capacity': 'Aucune capacité disponible pour le moment.',
    'hosting.err.stripe': 'Paiements pas encore configurés.', 'hosting.err.checkout': 'Échec du paiement.',
    'hosting.s.storage': 'Stockage', 'hosting.s.upload': 'Vitesse d’envoi', 'hosting.s.cpu': 'Part de CPU',
    'hosting.estprice': 'Prix estimé', 'hosting.baseprice': 'Prix de base', 'hosting.termdiscount': 'Remise durée',
    'hosting.promo.label': 'Code promo', 'hosting.promo.ph': 'Code promo (optionnel)', 'hosting.promo.invalid': 'Code invalide ou expiré.',
    'hosting.promo.pct': '{pct}% de réduction appliquée', 'hosting.promo.free': '{n} premiers mois offerts', 'hosting.promo.ok': 'Code appliqué.',
    'hosting.promo.minmonths': 'Ce code nécessite une durée de {n} mois ou plus.',

    'inst.feat1': 'Rapide & léger', 'inst.feat1.d': 'Un installeur natif qui ne te gêne pas.',
    'inst.feat2': 'Signé & vérifié', 'inst.feat2.d': 'Charges utiles vérifiées à chaque version.',
    'inst.feat3': 'Mises à jour malines', 'inst.feat3.d': 'Les mises à jour delta gardent les téléchargements minuscules.',
    'inst.feat4': 'Contrôle total', 'inst.feat4.d': 'Choisis composants, chemins et canaux.',
    'inst.hero1': 'L’installeur moderne', 'inst.hero2': 'pour la suite', 'inst.hero3': '.',
    'inst.sub': 'Un remplaçant NSIS/MSI rapide et sûr, avec une interface claire, des mises à jour delta et un contrat de transfert avec l’app.',
    'inst.download': 'Télécharger pour Windows', 'inst.releases': 'Notes de version', 'inst.platform': 'Windows 10/11 · 64-bit',
    'inst.dev': 'En développement actif', 'inst.dev.d': 'BetterInstaller est développé comme une app séparée basée sur Slint. Suis l’avancement sur le blog.',

    'repos.title': 'Dépôts serveur', 'repos.sub': 'Dépôts vérifiés de la communauté — les mis en avant d’abord.',
    'repos.search': 'Rechercher dépôts, tags, auteurs…', 'repos.hostedonly': 'Hébergés uniquement', 'repos.alltags': 'Tous',
    'repos.onlineonly': 'En ligne uniquement', 'repos.favonly': 'Favoris',
    'repos.favorite': 'Ajouter aux favoris', 'repos.unfavorite': 'Retirer des favoris',
    'repos.fav.signin': 'Connecte-toi pour ajouter des favoris.', 'repos.fav.failed': 'Échec.',
    'repos.copy.none': 'Aucune URL repo.json.', 'repos.copy.ok': 'Lien repo.json copié.',
    'repos.feed.label': 'Flux agrégé — tous les dépôts listés dans un seul repo.json', 'repos.feed.copied': 'URL du flux copiée.', 'repos.feed.open': 'Ouvrir',
    'repos.empty.t': 'Aucun dépôt listé pour le moment', 'repos.empty.s': 'Les dépôts publics vérifiés apparaîtront ici.',
    'repos.nomatch.t': 'Aucun résultat', 'repos.nomatch.s': 'Essaie une autre recherche ou efface les filtres.',
    'repos.one': 'dépôt', 'repos.many': 'dépôts', 'repos.featured': 'Mis en avant', 'repos.verified': 'Vérifié',
    'repos.online': 'En ligne', 'repos.offline': 'Hors ligne', 'repos.openbmm': 'Ouvrir dans BMM', 'repos.copyjson': 'Copier repo.json',
    'repos.source': 'Source', 'repos.website': 'Site web', 'repos.changelog': 'Journal',
    'repos.hosted': 'Hébergé', 'repos.listed': 'Listé', 'repos.unlisted': 'Non listé', 'repos.pending': 'En attente de revue', 'repos.unverified': 'Non vérifié',
    'repos.push.ok': 'Poussé — revérifié & vérifié.', 'repos.push.bad': 'Poussé — le contenu n’est pas un repo.json valide (non vérifié).', 'repos.failed': 'Échec.',
    'repos.listed.ok': 'Listé & vérifié — désormais public.', 'repos.unlisted.ok': 'Retiré de la liste.',
    'repos.sha.invalid': 'repo.json / SHA invalide — gardé privé. Envoie ou corrige un repo.json valide, puis réessaie.',
    'repos.del.title': 'Supprimer le dépôt', 'repos.del.msg': 'Supprimer « {name} » ?', 'repos.del.ok': 'Supprimer', 'repos.deleted': 'Supprimé.',
    'repos.check.onver': 'En ligne & vérifié.', 'repos.check.onunver': 'En ligne mais non vérifié.', 'repos.check.off': 'Hors ligne ({reason}).',
    'repos.unreachable': 'injoignable', 'repos.check.failed': 'Échec de la vérification.',
    'repos.tomulti.ok': 'Passé en multi — un pool de stockage a été créé (gratuit).', 'repos.tosingle.ok': 'Repassé en dépôt unique.',
    'repos.pool.hasmulti': 'Retire d’abord les autres dépôts du pool.', 'repos.switch.failed': 'Échec du changement.',
    'repos.mine': 'Mes dépôts serveur', 'repos.add': 'Ajouter un dépôt', 'repos.featureduntil': 'Mis en avant jusqu’au',
    'repos.cap': 'max', 'repos.pool': 'Pool',
    'repos.push': 'Pousser', 'repos.check': 'Vérifier', 'repos.copylink': 'Copier le lien', 'repos.unlist': 'Retirer', 'repos.listpublicly': 'Lister publiquement',
    'repos.manage': 'Gérer', 'repos.files': 'Fichiers', 'repos.freeswitch': 'Changement gratuit', 'repos.tosingle': 'En unique', 'repos.tomulti': 'En multi',
    'repos.addtopool': 'Ajouter au pool', 'repos.extendboost': 'Prolonger le boost', 'repos.boost': 'Booster', 'repos.edit': 'Modifier',
    'repos.mine.empty.t': 'Aucun dépôt pour le moment', 'repos.mine.empty.s': 'Ajoute un dépôt pour le lister publiquement, ou héberge-en un depuis la page Hébergement.',
    'repos.mng.capped': 'Enregistré — envoi plafonné à {n} Mbps par le bac à sable.', 'repos.mng.saved': 'Paramètres enregistrés.', 'repos.mng.savefail': 'Échec de l’enregistrement.',
    'repos.tab.access': 'Accès', 'repos.tab.bans': 'Bannis', 'repos.tab.limits': 'Limites',
    'repos.mng.title': 'Gérer « {name} »', 'repos.savesettings': 'Enregistrer',
    'repos.sandboxed': 'Bac à sable — tes réglages ne peuvent jamais dépasser les limites strictes de ce dépôt.',
    'repos.wl': 'Accès en liste blanche uniquement (seuls les IP/clés autorisées peuvent synchroniser)',
    'repos.allowedips': 'IP autorisées', 'repos.none': 'Aucune', 'repos.allowedkeys': 'Clés autorisées',
    'repos.bannedips': 'IP bannies', 'repos.nonebanned': 'Aucun banni',
    'repos.bansnote': 'Les IP et clés bannies ne peuvent pas synchroniser ce dépôt, quelle que soit la liste blanche.',
    'repos.uploadlimit': 'Limite d’envoi', 'repos.max': 'Max', 'repos.sandboxcap': 'Plafond du bac à sable :', 'repos.effective': 'Effectif :', 'repos.wascapped': '(ta demande a été plafonnée)',
    'repos.storage': 'Stockage', 'repos.cpushare': 'Part de CPU',
    'repos.storupd': 'Stockage mis à jour.', 'repos.poolfull': 'Pool plein — max {n} GB.', 'repos.belowused': 'Sous l’utilisation actuelle.',
    'repos.storinpool': 'Stockage dans le pool', 'repos.usedhere': 'utilisé ici', 'repos.usedothers': 'utilisé par d’autres', 'repos.maxhere': 'max ici', 'repos.apply': 'Appliquer',
    'repos.upgradestorage': 'Besoin de plus de stockage ?', 'repos.upgradeprice': '{price}/mois · même upload/CPU, plus de stockage',
    'repos.upgradefree': 'Encore dans le palier gratuit — aucun frais.', 'repos.currentplan': 'Ton offre actuelle.', 'repos.upgrade': 'Améliorer',
    'repos.upgraded.free': 'Passé à {n} GB — palier gratuit, aucun frais.', 'repos.notupgrade': 'Choisis une taille plus grande que ton quota actuel.',
    'repos.namereq': 'Le nom est requis.', 'repos.pooladded': 'Dépôt « {name} » ajouté au pool.', 'repos.addtopooltitle': 'Ajouter un dépôt à « {name} »',
    'repos.reponame': 'Nom du dépôt', 'repos.freeinpool': '{n} GB libres dans le pool.',
    'repos.boosttitle': 'Booster « {name} »',
    'repos.boost.desc': 'Les dépôts mis en avant remontent en haut de la liste publique. Choisis une durée — à la fin, ton dépôt reprend sa position normale.',
    'repos.boost.fair': 'Les dépôts boostés se partagent le haut de la liste et tournent équitablement à chaque visite — donc plus il y a de dépôts boostés en même temps, plus les positions du haut alternent entre eux. Booster aide toujours, mais l’avantage est le plus fort quand peu d’autres boostent.',
    'repos.days': 'jours', 'repos.total': 'Total',
    'repos.nameshort': 'Nom trop court.', 'repos.saved': 'Enregistré.', 'repos.added': 'Dépôt ajouté.',
    'repos.edit.title': 'Modifier le dépôt', 'repos.add.title': 'Ajouter un dépôt', 'repos.save': 'Enregistrer', 'repos.addshort': 'Ajouter',
    'repos.f.name': 'Nom', 'repos.f.name.ph': 'Mon dépôt de mods', 'repos.f.desc': 'Description', 'repos.f.desc.ph': 'Qu’est-ce qu’il contient ?',
    'repos.f.url': 'URL du dépôt', 'repos.f.url.hint': 'URL directe vers le manifeste repo.json — vérifié & haché automatiquement.',
    'repos.f.tags': 'Tags', 'repos.f.tags.hint': 'Séparés par des virgules.',
    'repos.shanote': 'Le SHA du contenu est calculé automatiquement depuis le repo.json. Un manifeste valide est vérifié et apparaît dans la liste publique ; un invalide reste non vérifié. Tu peux demander à un admin de le revalider.',
    'repos.dlfail': 'Échec du téléchargement.', 'repos.needjson': 'Un repo.json doit d’abord être envoyé.',
    'repos.review': 'Revue du contenu', 'repos.managefiles': 'Gérer les fichiers', 'repos.unpublish': 'Dépublier', 'repos.validate': 'Valider & publier',
    'repos.pub.live': 'Publié — le repo.json est en ligne.',
    'repos.upfiles': 'Envoie des fichiers (incl. un', 'repos.upfolder': 'Envoie un dossier (garde la structure)',
    'repos.upbg': 'Les envois continuent en arrière-plan si tu fermes cette fenêtre — tu recevras une notification à la fin.',
    'repos.nofiles': 'Aucun fichier pour le moment.', 'repos.download': 'Télécharger', 'repos.jsonpreview': 'repo.json (aperçu — jamais exécuté)',
    'repos.filesonline': 'Fichiers & en ligne', 'repos.goonline': 'Mettre en ligne', 'repos.takeoffline': 'Mettre hors ligne',
    'repos.nowonline': 'En ligne — votre repo.json est maintenant public.', 'repos.nowoffline': 'Mis hors ligne.',
    'repos.urlauto': 'L’URL publique est gérée automatiquement',
    'repos.needjsonhint': 'Envoyez un repo.json valide ci-dessous, puis « Mettre en ligne ».',
    'repos.readyonline': 'repo.json valide détecté — prêt à mettre en ligne.',
    'repos.drophere': 'Déposez les fichiers ici', 'repos.orpick': 'ou', 'repos.pickfiles': 'Choisir des fichiers', 'repos.pickfolder': 'Choisir un dossier',
    'repos.includejson': 'Incluez un', 'repos.tomanifest': 'manifest. Le SHA / checksum est calculé automatiquement.',
    'repos.f.urlauto': 'L’URL publique est gérée automatiquement pour les dépôts hébergés — publiez depuis le panneau Fichiers.',
    'repos.opendash': 'Tableau de bord', 'repos.sharedwithme': 'Partagés avec moi',
    'repos.quickfiles': 'Fichiers (rapide)', 'repos.sandbox': 'Réglages du bac à sable', 'repos.editdetails': 'Modifier les infos', 'repos.delete': 'Supprimer le dépôt',
    'repos.downloadall': 'Tout télécharger', 'repos.ziptoobig': 'Trop volumineux pour un zip — téléchargez les fichiers un par un.',
    // Promo codes (user redeem)
    'promo.title': 'Utiliser un code promo', 'promo.desc': 'Un code ? Utilisez-le pour un hébergement gratuit ou un boost. (Les codes de réduction s’entrent au paiement.)',
    'promo.redeem': 'Valider', 'promo.gotHosting': 'Validé ! Un dépôt hébergé gratuit a été créé — voir « Mes dépôts ».', 'promo.gotBoost': 'Validé ! Votre dépôt est maintenant boosté.', 'promo.ok': 'Validé !',
    'promo.invalid': 'Code invalide ou inactif.', 'promo.expired': 'Ce code a expiré.', 'promo.depleted': 'Ce code est épuisé.', 'promo.used': 'Vous avez déjà utilisé ce code.', 'promo.atcheckout': 'C’est un code de réduction — entrez-le au moment d’héberger ou booster.',
    'promo.pickrepo': 'Quel dépôt booster ?', 'promo.norepos': 'Vous n’avez pas encore de dépôt à booster.',
    // Submissions temp margin + per-item catalog.json
    'sub.tempfull': 'Le stockage des soumissions est plein — réessayez quand la modération aura libéré de la place.',
    'sub.nospace': 'Le stockage des soumissions est plein — chaque envoi est retenu pour modération et il n’y a plus de place. Réessaie plus tard, ou auto-héberge et colle une URL ci-dessus à la place.',
    'sub.toomanypending': 'Vous avez déjà {n} soumissions en attente — attendez la modération avant d’en envoyer d’autres.',
    'sub.freetierfull': 'L’hébergement gratuit pour les fichiers du catalogue est complet en ce moment — réessaie plus tard, ou auto-héberge et colle une URL à la place.',
    'sub.freeused': 'Tu as déjà utilisé ton envoi hébergé gratuit (par compte et par identifiant créateur lié) — auto-héberge et colle une URL à la place, ou paye l’hébergement.',
    'item.json.label': 'catalog.json — importez ce {k} individuellement dans BMM',
    'item.json.copied': 'Lien catalog.json copié.', 'item.json.addbmm': 'Ajouter comme source BMM', 'cat.copylink': 'Copier le lien',
    // Dedicated repo dashboard
    'rd.unlocked': 'Déverrouillé.', 'rd.badpw': 'Mauvais mot de passe.', 'rd.unlockfail': 'Déverrouillage impossible.',
    'rd.locked.t': 'Tableau de bord privé', 'rd.locked.s': 'Entrez le mot de passe pour gérer ce dépôt.', 'rd.password': 'Mot de passe', 'rd.unlock': 'Déverrouiller', 'rd.backdash': '← Retour au tableau de bord',
    'rd.noaccess.t': 'Aucun accès', 'rd.noaccess.s': 'Vous devez être le propriétaire, un email autorisé, ou avoir le mot de passe du tableau de bord.', 'rd.signin': 'Se connecter',
    'rd.lvl.owner': 'Propriétaire', 'rd.lvl.collab': 'Collaborateur', 'rd.lvl.password': 'Accès par mot de passe',
    'rd.favorite': 'favori', 'rd.favorites': 'favoris',
    'rd.tab.files': 'Fichiers', 'rd.tab.online': 'En ligne', 'rd.tab.settings': 'Réglages', 'rd.tab.access': 'Accès', 'rd.tab.activity': 'Activité', 'rd.tab.users': 'Utilisateurs',
    'rd.act.upload': 'a envoyé', 'rd.act.delete': 'a supprimé', 'rd.act.publish': 'a mis en ligne', 'rd.act.unpublish': 'a mis hors ligne', 'rd.act.settings': 'a modifié les réglages', 'rd.act.access': 'a modifié les accès', 'rd.act.ban': 'a banni', 'rd.act.unban': 'a débanni', 'rd.act.empty': 'Aucune activité pour le moment.', 'rd.now': 'à l’instant',
    // Users / traffic tab
    'rd.uniqueips': 'Clients uniques', 'rd.connects': 'Connexions', 'rd.downloads': 'Téléchargements', 'rd.connected': 'Clients connectés', 'rd.recentaccess': 'Accès récents',
    'rd.traffic.window': '7 derniers jours. Les clients sont identifiés par IP (et clé d’accès si utilisée). Bannir les bloque immédiatement de la synchro de ce dépôt.',
    'rd.lastseen': 'vu', 'rd.dl': 'dl', 'rd.conn': 'conn', 'rd.ban': 'Bannir', 'rd.unban': 'Débannir', 'rd.banned': 'Banni.', 'rd.unbanned': 'Débanni.', 'rd.bannedbadge': 'Banni',
    'rd.noclients': 'Personne n’a encore synchronisé ce dépôt.', 'rd.downloaded': 'a téléchargé', 'rd.connected2': 's’est connecté',
    'rd.files': 'fichier(s)', 'rd.selfhost': 'Dépôt auto-hébergé (URL) — son contenu est à sa propre URL, pas ici.', 'rd.selfhostonline': 'Les dépôts auto-hébergés sont accessibles à leur propre URL — rien à publier ici.', 'rd.selfhostset': 'Les réglages du bac à sable ne concernent que les dépôts hébergés.',
    'rd.filesearch': 'Filtrer par nom…', 'rd.sort.name': 'Nom', 'rd.sort.sizedesc': 'Plus gros d’abord', 'rd.sort.sizeasc': 'Plus petit d’abord',
    'rd.selectall': 'Tout sélectionner', 'rd.view.list': 'Liste', 'rd.view.tree': 'Arborescence',
    'rd.nomatch': 'Aucun fichier ne correspond.', 'rd.delfile.t': 'Supprimer le fichier', 'rd.delfile.m': '{path} ? Action irréversible.',
    'rd.delsel.t': 'Supprimer les fichiers sélectionnés', 'rd.delsel.m': '{n} fichier(s) ? Action irréversible.', 'rd.delsel.btn': 'Supprimer {n}',
    'rd.dlsel.btn': 'Télécharger {n}', 'rd.zip.toolarge': 'Sélection trop grande — les téléchargements zip sont limités à 2 Go. Sélectionne moins de fichiers.', 'rd.zip.failed': 'Échec du téléchargement.',
    'rd.bannedkeys': 'Clés bannies',
    'rd.authemails': 'Emails autorisés', 'rd.authemails.s': 'Les utilisateurs connectés avec ces emails peuvent ouvrir ce tableau de bord et gérer le dépôt.', 'rd.emails': 'Emails', 'rd.bademail': 'Entrez un email valide.', 'rd.emailssaved': 'Emails autorisés mis à jour.',
    'rd.dashpw': 'Mot de passe du tableau de bord', 'rd.dashpw.s': 'Quiconque a ce mot de passe peut ouvrir le tableau de bord sans compte (accès sans connexion).',
    'rd.changepw': 'Nouveau mot de passe…', 'rd.setpw': 'Définir un mot de passe…', 'rd.change': 'Changer', 'rd.set': 'Définir', 'rd.remove': 'Retirer', 'rd.pwon': 'Défini',
    'rd.pwset': 'Mot de passe du tableau de bord défini.', 'rd.pwcleared': 'Mot de passe retiré.', 'rd.pwshort': 'Mot de passe trop court (min 4).', 'rd.pwclear.t': 'Retirer le mot de passe', 'rd.pwclear.m': 'Toute personne ayant le mot de passe perdra l’accès. Continuer ?',
    'rd.accessnote': 'Vous (le propriétaire) et les admins du site avez toujours un accès complet. Les collaborateurs et détenteurs du mot de passe peuvent gérer fichiers, publication et réglages, mais pas les accès ni la facturation.',

    'bill.nocustomer': 'Rien à gérer pour l’instant — abonne-toi ou booste un dépôt d’abord.', 'bill.portalfail': 'Portail de facturation indisponible.',
    'bill.title': 'Facturation & factures', 'bill.manage': 'Gérer la facturation', 'bill.invoice': 'Facture',
    'bill.empty.t': 'Aucun paiement pour le moment', 'bill.empty.s': 'Booste ou héberge un dépôt — les factures apparaîtront ici.',
    'bill.close': 'Fermer', 'bill.print': 'Imprimer / Enregistrer en PDF', 'bill.billedto': 'Facturé à', 'bill.status': 'Statut :', 'bill.thanks': 'Merci !',
    'bill.subs': 'Hébergement actif', 'bill.expired': 'Expiré', 'bill.renewson': 'Renouvelle/expire', 'bill.renew': 'Renouveler', 'bill.renewed.free': 'Renouvelé — palier gratuit, aucun frais.',

    'sub.presetjson': 'Le preset n’est pas un JSON valide.', 'sub.tmplgen': 'Modèle généré — modifie les valeurs.',
    'sub.namereq': 'Le nom est requis.', 'sub.metajson': 'Les métadonnées doivent être un JSON valide.',
    'sub.checksum.fail': 'Envoyé, mais le plugin a échoué à la vérification du checksum ({reason}). Un modérateur l’examinera.',
    'sub.checksum.ok': 'Checksum vérifié — envoyé aux modérateurs.', 'sub.hostunavail': 'Le paiement de l’hébergement est indisponible pour le moment.',
    'sub.title': 'Soumettre du contenu', 'sub.forreview': 'Soumettre pour revue',
    'sub.project': 'Projet', 'sub.type': 'Type', 'sub.name': 'Nom', 'sub.version': 'Version', 'sub.desc': 'Description',
    'sub.filehint': 'Envoyé directement au stockage — le lien de téléchargement est configuré automatiquement.',
    'sub.quote': 'Héberger ce fichier de {size} MB chez nous est facturé à la taille : {price}. Tu seras redirigé vers le paiement ; il passe ensuite en modération. Tu préfères l’auto-hébergement ? Colle plutôt une URL ci-dessus.',
    'sub.metadata': 'Métadonnées (JSON)', 'sub.gentmpl': 'Générer un modèle',

    'cat.downloading': 'Téléchargement de {n} preset(s)…', 'cat.dlfail': 'Échec du téléchargement.',
    'cat.title': 'Catalogue', 'cat.sub': 'Apps, plugins, thèmes et presets de la communauté.', 'cat.search': 'Rechercher mods, plugins, thèmes & presets…', 'cat.all': 'Tous',
    'cat.sort.recent': 'Plus récents', 'cat.sort.popular': 'Plus populaires', 'cat.sort.month': 'Populaires ce mois', 'cat.sort.views': 'Plus vus',
    'cat.selected': '{n} sélectionné(s)', 'cat.dlsel': 'Télécharger la sélection', 'cat.clear': 'Effacer', 'cat.nodesc': 'Aucune description.',
    'cat.empty.t': 'Rien ici pour le moment', 'cat.empty.s': 'Sois le premier à publier dans ce catalogue.',

    'item.notfound': 'Introuvable', 'item.nourl': 'Aucune URL de téléchargement pour cet élément.',
    'item.verified': 'Plugin vérifié', 'item.verified.d': '— les checksums du paquet et des fichiers correspondent.',
    'item.invalid': 'Checksum invalide', 'item.invalid.d': '— ce .bmmplug a échoué aux contrôles d’intégrité ({reason}). L’installation n’est pas recommandée.',
    'item.views': 'vues', 'item.downloads': 'téléchargements', 'item.download': 'Télécharger', 'item.metadata': 'Métadonnées',
    'item.warn.title': 'Contrôle d’intégrité échoué', 'item.dlanyway': 'Télécharger quand même',
    'item.warn.body1': 'Ce', 'item.warn.body2': 'n’a pas passé la validation',
    'item.warn.body3': 'Ses checksums ne correspondent pas, ce qui signifie que le paquet a pu être altéré ou corrompu.',
    'item.warn.rec': 'Nous recommandons fortement de ne pas l’installer.',

    'blog.title': 'Blog', 'blog.sub': 'Actus et mises à jour de tous les projets.', 'blog.write': 'Écrire un article',
    'blog.untranslated': 'non traduit', 'blog.empty': 'Aucun article pour le moment', 'blog.writefirst': 'Écris le premier.',
    'blog.newpost': 'Nouvel article', 'blog.notfound': 'Article introuvable',

    'prof.intro.title': "Animation d'intro", 'prof.intro.skip': "Passer l'animation d'intro aux prochains chargements (cet appareil uniquement)",
    'prof.photook': 'Photo envoyée — enregistre ton profil.', 'prof.uploadfail': 'Échec de l’envoi.',
    'prof.exported': 'avatars.zip exporté', 'prof.exportfail': 'Échec de l’export.',
    'prof.title': 'Profil', 'prof.sub': 'Gère ton compte, ton avatar et ton mot de passe.', 'prof.godash': 'Aller au tableau de bord',
    'prof.change': 'Changer', 'prof.uploadphoto': 'Envoyer une photo', 'prof.remove': 'Retirer',
    'prof.customphoto': 'Photo personnalisée utilisée — l’avatar généré ci-dessous est masqué tant qu’elle est définie.',
    'prof.style': 'Style', 'prof.presets': 'Préréglages', 'prof.custompalette': 'Palette personnalisée', 'prof.color': 'Couleur',
    'prof.randpalette': 'Palette aléatoire', 'prof.randseed': 'Graine aléatoire', 'prof.exportavatars': 'Exporter les avatars (.zip)',
    'prof.dispname': 'Nom affiché', 'prof.bio': 'Bio', 'prof.bio.ph': 'Un petit mot sur toi…',
    'prof.saveprofile': 'Enregistrer le profil', 'prof.saved': 'Enregistré', 'prof.failed': 'Échec',
    'prof.changepw': 'Changer le mot de passe', 'prof.currentpw': 'Mot de passe actuel', 'prof.newpw': 'Nouveau mot de passe',
    'prof.pw8': '8+ caractères', 'prof.confirmnew': 'Confirme le nouveau', 'prof.repeat': 'répète',
    'prof.updatepw': 'Mettre à jour le mot de passe', 'prof.updated': 'Mis à jour', 'prof.pwwrong': 'Mot de passe actuel incorrect',
    'prof.pwshort': 'Min. 8 caractères', 'prof.pwmismatch': 'Les mots de passe ne correspondent pas',
    'prof.role': 'Rôle :', 'prof.membersince': 'Membre depuis',

    'cl.title': 'Creator IDs',
    'cl.desc': 'Lie ton/tes creator id(s) BMM. Dans BMM, génère un code d’appairage, puis colle-le ici. Un creator id est lié à un seul compte ; les id liés ne peuvent pas être déliés pendant 2 semaines.',
    'cl.linked': 'lié le', 'cl.unlockable': 'déliable le', 'cl.locked2w': 'Verrouillé 2 semaines', 'cl.unlink': 'Délier',
    'cl.ph': 'Code depuis BMM (ex. K7P39QMX)', 'cl.link': 'Lier', 'cl.ok': 'Creator id lié.',
    'cl.taken': 'Ce creator id est déjà lié à un autre compte.', 'cl.bad': 'Code invalide ou expiré.',
    'cl.lockederr': 'Verrouillé — impossible de délier dans les 2 semaines suivant la liaison.', 'cl.error': 'Une erreur est survenue.',

    'disl.desc1': 'Lie ton compte Discord. Sur le serveur, lance',
    'disl.desc2': 'pour obtenir un code, puis colle-le ici — ça débloque les salons réservés et affiche ton compte dans la communauté.',
    'disl.ph': 'Code depuis /link (ex. K7P39QMX)', 'disl.ok': 'Discord lié.', 'disl.taken': 'Ce compte Discord est déjà lié.',

    'dash.delcancelled': 'Suppression annulée.', 'dash.cancelfail': 'Échec de l’annulation.',
    'dash.stripe.hostingok': 'Paiement reçu — ton dépôt est en cours de provisionnement.', 'dash.stripe.hostingcancel': 'Paiement annulé — aucune somme n’a été débitée.',
    'dash.stripe.featureok': 'Paiement reçu — ton dépôt est maintenant mis en avant.', 'dash.stripe.featurecancel': 'Paiement annulé — aucune somme n’a été débitée.',
    'dash.items': 'Éléments', 'dash.published': 'Publiés', 'dash.pending': 'En attente', 'dash.repos': 'Dépôts', 'dash.featured': 'Mis en avant',
    'dash.hostrepo': 'Héberger un dépôt', 'dash.browse': 'Voir le catalogue', 'dash.editprofile': 'Modifier le profil',
    'dash.overview': 'Aperçu', 'dash.myitems': 'Mes éléments', 'dash.myrepos': 'Mes dépôts', 'dash.billing': 'Facturation',
    'dash.hi': 'Salut, {name}', 'dash.sub': 'Gère ton contenu, tes dépôts et ta facturation.', 'dash.new': 'Nouveau',
    'dash.hostedhere': 'hébergé ici', 'dash.verified': 'vérifié', 'dash.invalid': 'invalide', 'dash.deletingin': 'Suppression dans', 'dash.viewedit': 'Voir / modifier',
    'dash.noitems': 'Aucun élément pour le moment', 'dash.noitems.s': 'Soumets ta première app, plugin, thème ou preset.', 'dash.submitted': 'Soumis — en attente de modération.',

    'ie.nopayload': 'Aucun contenu téléchargeable.', 'ie.metajson': 'Les métadonnées doivent être un JSON valide.',
    'ie.savefail': 'Enregistré, mais le nouveau .bmmplug a échoué à la validation ({reason}). Un modérateur vérifiera.',
    'ie.saveverified': 'Enregistré — plugin revérifié. En attente de ré-approbation admin.',
    'ie.savepending': 'Enregistré — les changements sont en attente de ré-approbation admin.', 'ie.savefail2': 'Échec de l’enregistrement.',
    'ie.scheduled': 'Programmé pour suppression dans 72h. Les fichiers sont conservés jusque-là — tu peux annuler à tout moment.', 'ie.delfail': 'Échec de la suppression.',
    'ie.canceldel': 'Annuler la suppression', 'ie.delthis': 'Supprimer cet élément ?', 'ie.yesdelete': 'Oui, supprimer', 'ie.no': 'Non',
    'ie.savereview': 'Enregistrer (envoyer pour re-revue)', 'ie.title': 'Voir / modifier l’élément',
    'ie.notice.del1': 'Programmé pour suppression dans', 'ie.notice.del2': 'Les fichiers sont conservés jusque-là — annule ci-dessous pour garder cet élément.',
    'ie.notice.edit': 'La modification renvoie l’élément en modération. La version en ligne reste inchangée jusqu’à ce qu’un admin approuve tes changements.',
    'ie.pkgok': 'Paquet actuel vérifié — les checksums correspondent.', 'ie.pkgbad': 'Paquet actuel invalide : {reason}', 'ie.noedit': 'Non modifiable',
    'ie.replace': 'Remplacer le .bmmplug', 'ie.replace.hint': 'Optionnel — envoie un nouveau paquet, revérifié avant sa mise en ligne.',
    'ie.replaces': '— remplace le fichier actuel et est revalidé à l’enregistrement.',
    'ie.selfhosted1': 'Ce plugin est auto-hébergé. Pointe', 'ie.selfhosted2': '(ci-dessous) vers un nouveau', 'ie.selfhosted3': '; il est revalidé à l’enregistrement.',
    'ie.replace.hint2': 'Optionnel — envoie un nouveau fichier, revérifié avant sa mise en ligne. Facturé selon la taille au-delà du seuil gratuit.',
    'ie.replacecost': 'Cette taille est facturée : {price}/mois — tu seras redirigé vers le paiement après l’enregistrement.',
    'ie.hostactive': 'Ce fichier est sur un abonnement d’hébergement mensuel récurrent.',
    'ie.cancelhosting': 'Annuler l’hébergement', 'ie.hostcancelq': 'Annuler et masquer cet élément ?', 'ie.yescancel': 'Oui, annuler',
    'ie.hostcancelled': 'Abonnement d’hébergement annulé — l’élément est maintenant masqué.', 'ie.hostcancelfail': 'Échec de l’annulation.',
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

// The site's available languages. Add a locale here (and its DICT block above)
// and the switchers below automatically become a dropdown — no other change.
export const LANGS = [
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'Français' },
];

// Topbar switcher. With exactly two languages it's a fast one-tap toggle; once a
// third language is added it becomes a proper dropdown listing every language.
export function LangToggle() {
  const { lang, setLang } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc); return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  if (LANGS.length <= 2) {
    const other = LANGS.find((l) => l.code !== lang) || LANGS[0];
    return (
      <button className="nav-link" onClick={() => setLang(other.code)} title={`Language — ${other.label}`} aria-label="Language">
        <Languages size={16} /> <span className="text-xs font-semibold uppercase">{lang}</span>
      </button>
    );
  }
  return (
    <div className="relative" ref={ref}>
      <button className="nav-link" onClick={() => setOpen((o) => !o)} title="Language" aria-label="Language" aria-expanded={open}>
        <Languages size={16} /> <span className="text-xs font-semibold uppercase">{lang}</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 w-40 rounded-xl border border-[var(--line-strong)] py-1 z-[60] anim-fade overflow-hidden"
          style={{ background: 'var(--bg-solid)', boxShadow: '0 18px 50px -12px rgba(0,0,0,0.5)' }}>
          {LANGS.map((l) => (
            <button key={l.code} onClick={() => { setLang(l.code); setOpen(false); }}
              className={`w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-[var(--surface-2)] transition ${l.code === lang ? 'text-[var(--primary-2)] font-medium' : 'text-[var(--text)]'}`}>
              {l.label} {l.code === lang && <span className="text-[10px] uppercase tracking-wider">{l.code}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Footer language switcher — a compact native <select> that reads cleanly on
// both desktop and mobile and needs no popover/positioning logic.
export function LangSelect({ className = '' }) {
  const { lang, setLang } = useI18n();
  return (
    <div className={`inline-flex items-center gap-1.5 text-[var(--muted)] ${className}`}>
      <Languages size={14} className="shrink-0" />
      <select value={lang} onChange={(e) => setLang(e.target.value)} aria-label="Language"
        className="bg-transparent text-xs font-medium text-[var(--muted)] hover:text-[var(--text)] outline-none cursor-pointer py-1 pr-1 rounded-md focus:ring-2 focus:ring-[var(--ring)]">
        {LANGS.map((l) => <option key={l.code} value={l.code} className="bg-[var(--bg-solid)] text-[var(--text)]">{l.label}</option>)}
      </select>
    </div>
  );
}

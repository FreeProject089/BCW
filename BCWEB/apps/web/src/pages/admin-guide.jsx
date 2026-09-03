// Admin guide — a reference for the admin dashboard, inside the admin dashboard.
//
// Every other admin screen DOES something; this one explains all of them. New staff (and the
// owner six months later) kept asking "what does this toggle actually change, and who sees
// it" — questions the code answers but the UI does not. So the answers live here, next to the
// screens they describe, grouped exactly like the sidebar.
//
// Content carries its own {en,fr} strings rather than i18n keys: it is documentation that
// lives and changes as one block, and turning ~200 sentences into ~200 dictionary entries
// somewhere else would make it harder to keep true, not easier. Rendered by the active lang,
// the same pattern the site-theme token catalogue uses.
import { useState, useMemo, useEffect } from 'react';
import {
  BookOpen, Search, BellIcon, Inbox, Users, Shield, Settings2, Boxes, Newspaper, BadgeCheck,
  Server, CreditCard, Rocket, Megaphone, Sparkles, Wand2, KeyRound, MessageSquare, Cpu,
  TrendingUp, Sliders, Navigation, Palette, Lock, History, Scale, Gavel, HardDrive,
  Pencil, Plus, Trash2, Save, ChevronUp, ChevronDown, X, FileText, ChevronsDownUp, ChevronsUpDown,
} from 'lucide-react';
import { useI18n } from '../i18n.jsx';
import { useAuth } from './auth.jsx';
import { Card, Input, Button, Spinner, useToast } from '../ui/ui.jsx';
import { api } from '../lib/api.js';
import Markdown from '../ui/md.jsx';
import { MarkdownEditor } from './blog.jsx';

// Icons an admin can pick for a custom section (name → component), so a saved string maps
// back to a glyph. Kept small and relevant to documentation.
const GUIDE_ICONS = { FileText, BookOpen, Server, Shield, Settings2, CreditCard, Megaphone, Sparkles, KeyRound, HardDrive, Users, Boxes, Palette, Navigation };
const iconOf = (name) => GUIDE_ICONS[name] || FileText;

// One documented screen. `points` are the specific controls, rules and traps — the things a
// tooltip is too small to hold.
const G = (id, icon, en_t, fr_t, en_b, fr_b, points) => ({ id, icon, title: { en: en_t, fr: fr_t }, body: { en: en_b, fr: fr_b }, points });

const GUIDE = [
  {
    heading: { en: 'Waiting on you', fr: 'En attente de toi' },
    items: [
      G('needs', BellIcon, 'Needs attention', 'À traiter',
        'A read-only digest of every queue that has work waiting: submissions, reports, messages, sanctions, commissions and performance alerts. It is the first place to look when you sit down.',
        'Un résumé en lecture seule de chaque file qui a du travail en attente : soumissions, signalements, messages, sanctions, commandes et alertes de performance. Le premier endroit où regarder en arrivant.',
        [
          { en: 'It carries no badge of its own on purpose — each queue below has one, and summing them here would count every waiting item twice.', fr: 'Il ne porte pas de pastille propre, exprès — chaque file ci-dessous a la sienne, et les additionner ici compterait chaque élément deux fois.' },
          { en: 'Nothing is actioned here; every row links to the screen where the work is actually done.', fr: 'Rien ne se fait ici ; chaque ligne renvoie à l’écran où le travail se fait vraiment.' },
        ]),
      G('moderation', Inbox, 'Moderation', 'Modération',
        'Submissions, Reports, Messages, Legal and Sanctions. Submissions are new catalogue/repo/project requests awaiting review; approving one creates the page UNPUBLISHED and unlisted — approval is a place in the queue, not going live.',
        'Soumissions, Signalements, Messages, Légal et Sanctions. Les soumissions sont les nouvelles demandes de catalogue/dépôt/projet en attente ; approuver crée la page NON publiée et non listée — l’approbation, c’est une place dans la file, pas la mise en ligne.',
        [
          { en: 'A PAID request has no more rights than a free one — the payment bought a place in the queue, not priority of outcome.', fr: 'Une demande PAYÉE n’a pas plus de droits qu’une gratuite — le paiement a acheté une place dans la file, pas un traitement prioritaire.' },
          { en: 'Reports and Messages are what users send you; Sanctions is where account/content suspensions and their appeals live.', fr: 'Signalements et Messages sont ce que les utilisateurs t’envoient ; Sanctions regroupe les suspensions de compte/contenu et leurs appels.' },
          { en: 'Legal holds takedown and rights claims — the closed-source proof for a submission is checked here before it can go live.', fr: 'Légal regroupe les retraits et revendications de droits — la preuve d’un envoi propriétaire est vérifiée ici avant toute mise en ligne.' },
        ]),
    ],
  },
  {
    heading: { en: 'People', fr: 'Personnes' },
    items: [
      G('users', Users, 'Accounts', 'Comptes',
        'Every account: search, open one to see its roles, linked logins (GitHub/Discord), sanctions and activity, and act on it. "Free vs paid" splits accounts by whether they hold a paid plan.',
        'Tous les comptes : recherche, ouvre-en un pour voir ses rôles, ses connexions liées (GitHub/Discord), ses sanctions et son activité, et agis dessus. « Gratuit vs payant » sépare les comptes selon qu’ils ont une offre payante.',
        [
          { en: 'Roles and permissions can be changed straight from the account panel — you do not have to go to Roles & permissions for a one-off grant.', fr: 'Les rôles et permissions se changent directement depuis la fiche du compte — pas besoin d’aller dans Rôles & permissions pour un ajustement ponctuel.' },
          { en: 'Suspend vs ban: suspend is reversible and time-boxed; both are recorded and appealable.', fr: 'Suspendre vs bannir : suspendre est réversible et limité dans le temps ; les deux sont journalisés et peuvent faire l’objet d’un appel.' },
        ]),
      G('access', Shield, 'Roles & permissions', 'Rôles & permissions',
        'Define who can do what. Built-in tiers (MOD, ADMIN, SUPERADMIN) plus custom roles that bundle individual capabilities (manage_repos, manage_myo, translator roles, …). SUPERADMIN bypasses every check implicitly.',
        'Définis qui peut faire quoi. Des paliers intégrés (MOD, ADMIN, SUPERADMIN) plus des rôles personnalisés qui regroupent des capacités individuelles (manage_repos, manage_myo, rôles de traducteur, …). SUPERADMIN contourne toute vérification, implicitement.',
        [
          { en: 'Capabilities are additive: a user’s effective permissions are the union of every role they hold.', fr: 'Les capacités s’additionnent : les permissions effectives d’un utilisateur sont l’union de tous ses rôles.' },
          { en: 'Editor-level actions require the user to have 2FA on — a safeguard, not a bug.', fr: 'Les actions de niveau éditeur exigent que l’utilisateur ait la 2FA activée — c’est une protection, pas un bug.' },
        ]),
      G('security', Lock, 'Security log & Site history', 'Journal de sécurité & Historique',
        'Two tamper-evident records of "who did what". The security log is an HMAC hash-chain of staff actions (it can be verified for tampering); Site history is the broader edit trail across the site.',
        'Deux registres infalsifiables du « qui a fait quoi ». Le journal de sécurité est une chaîne de hachage HMAC des actions du staff (vérifiable contre toute altération) ; l’Historique est la trace d’édition plus large du site.',
        [
          { en: 'Retention is capped in Settings; the chain’s verify endpoint alerts SUPERADMINs if a link is broken.', fr: 'La rétention est plafonnée dans Réglages ; l’endpoint de vérification alerte les SUPERADMIN si un maillon est rompu.' },
        ]),
    ],
  },
  {
    heading: { en: 'What the site shows', fr: 'Ce que le site montre' },
    items: [
      G('projects', Settings2, 'Projects', 'Projets',
        'Configure each Better* project and each "other" (community) project: its overview, presentation media, timeline, release notes, activity, blog scope and page visibility. This is where a project page is built.',
        'Configure chaque projet Better* et chaque projet « autre » (communautaire) : son aperçu, ses médias de présentation, sa chronologie, ses notes de version, son activité, la portée de son blog et la visibilité de ses pages. C’est ici qu’une page projet se construit.',
        [
          { en: 'Presentation media accepts images, video, rrweb and BMM replay embeds — each with a live preview.', fr: 'Les médias de présentation acceptent images, vidéo, rrweb et replays BMM — chacun avec un aperçu en direct.' },
          { en: 'The timeline can be linked to a GitHub repo (or a dropped .git) so commits, contributors and per-day activity fill in automatically; timeline and release notes render Markdown.', fr: 'La chronologie peut être liée à un dépôt GitHub (ou un .git déposé) pour remplir automatiquement commits, contributeurs et activité par jour ; chronologie et notes de version rendent le Markdown.' },
          { en: 'Page visibility gates who can see each page; a countdown teaser and scheduled content swap are set here too.', fr: 'La visibilité des pages contrôle qui voit chaque page ; le compte à rebours et l’échange de contenu programmé se règlent aussi ici.' },
        ]),
      G('catalogs', Boxes, 'Catalogs', 'Catalogues',
        'Official (curated by you), Community (submitted, unverified), and Downloads & assets (the installers and files the platform hosts). The official catalogue is what BMM reads as trusted.',
        'Officiel (curé par toi), Communauté (soumis, non vérifié), et Téléchargements & assets (les installeurs et fichiers hébergés par la plateforme). Le catalogue officiel est ce que BMM lit comme fiable.',
        [
          { en: 'Community entries are published by their makers and clearly marked unverified — the home page explains the two tracks to visitors.', fr: 'Les entrées communautaires sont publiées par leurs auteurs et clairement marquées non vérifiées — la page d’accueil explique les deux voies aux visiteurs.' },
        ]),
      G('editorial', Newspaper, 'Writing & notices', 'Écriture & avis',
        'Announcements (site + per-project news), FAQ, Newsletter (compose to all / EN / FR / a pick, with a test send), Mail delivery settings and Reviews moderation.',
        'Annonces (actus du site + par projet), FAQ, Newsletter (rédige pour tous / EN / FR / une sélection, avec un envoi de test), réglages d’envoi d’e-mails et modération des avis.',
        [
          { en: 'Publishing a blog post can auto-announce to the newsletter once (guarded so it never double-sends).', fr: 'Publier un article peut annoncer automatiquement à la newsletter une seule fois (protégé pour ne jamais envoyer deux fois).' },
          { en: 'Every user-facing string needs both FR and EN — the newsletter audience picker respects the reader’s language.', fr: 'Chaque texte destiné aux utilisateurs a besoin du FR et de l’EN — le sélecteur d’audience de la newsletter respecte la langue du lecteur.' },
        ]),
      G('badges', BadgeCheck, 'Badges', 'Badges',
        'Create and award the badges that appear on profiles. Admin CRUD; there is a small footer easter-egg tie-in.',
        'Crée et attribue les badges qui apparaissent sur les profils. CRUD admin ; il y a un petit clin d’œil dans le pied de page.',
        []),
    ],
  },
  {
    heading: { en: 'Hosting', fr: 'Hébergement' },
    items: [
      G('repos', Server, 'Repos & pools', 'Dépôts & pools',
        'Server repos (owner-hosted, listed in the index once verified), Storage pools (a purchase provisions an empty pool that can hold repos, catalogs, or nothing yet), Ownership transfers, and Free hosting grants.',
        'Dépôts serveur (hébergés par le propriétaire, listés dans l’index une fois vérifiés), Pools de stockage (un achat provisionne un pool vide qui peut contenir dépôts, catalogues ou rien encore), transferts de propriété, et attributions d’hébergement gratuit.',
        [
          { en: 'A subscription anchors to the POOL, not a single repo, so the whole pool is free to fill; lapses suspend repos and hide catalogs in the pool after a 72h grace.', fr: 'Un abonnement est rattaché au POOL, pas à un dépôt unique, donc tout le pool est libre à remplir ; une échéance suspend les dépôts et masque les catalogues du pool après un délai de grâce de 72 h.' },
          { en: 'Private repos are reached at /r/:id?k=<shareKey> — that query string is a secret; never log a raw request URL.', fr: 'Les dépôts privés se lisent via /r/:id?k=<shareKey> — cette chaîne de requête est un secret ; ne journalise jamais une URL de requête brute.' },
        ]),
      G('plans', CreditCard, 'Hosting plans', 'Offres d’hébergement',
        'The paid hosting plans and their prices. A plan can leave its monthly price empty to inherit the per-MB rate from Hosting settings.',
        'Les offres d’hébergement payantes et leurs prix. Une offre peut laisser son prix mensuel vide pour hériter du tarif au Mo défini dans Réglages d’hébergement.',
        [
          { en: 'Catalogue hosting above the free size is a real recurring Stripe subscription (unlike the prepaid repo term).', fr: 'L’hébergement de catalogue au-delà de la taille gratuite est un vrai abonnement Stripe récurrent (contrairement au terme prépayé des dépôts).' },
        ]),
      G('hostingsettings', HardDrive, 'Hosting settings', 'Réglages d’hébergement',
        'The single place every service cap and the default per-MB rate are set: total capacity, free-tier ceilings, the hosting lifecycle windows, and the search/link-preview (SEO/OG) settings.',
        'L’unique endroit où se règlent chaque plafond de service et le tarif au Mo par défaut : capacité totale, plafonds de l’offre gratuite, les fenêtres du cycle de vie de l’hébergement, et les réglages de recherche/aperçu de lien (SEO/OG).',
        [
          { en: 'Total capacity is what the public status/capacity bars are measured against — change it in one place, everywhere follows. It can never be set above the machine’s REAL free disk, shown right under the field.', fr: 'La capacité totale est la référence des barres de capacité/statut publiques — change-la à un endroit, tout suit. Elle ne peut jamais dépasser l’espace disque RÉEL, affiché juste sous le champ.' },
          { en: 'Free-tier ceilings: the storage/speed a free repo or catalog gets. One free repo AND one free catalog per account (a FreeTierClaim, kept even if the creator id is later unlinked).', fr: 'Plafonds de l’offre gratuite : le stockage/débit d’un dépôt ou catalogue gratuit. Un dépôt gratuit ET un catalogue gratuit par compte (un FreeTierClaim, conservé même si l’id créateur est délié plus tard).' },
          { en: 'Hosting lifecycle — three windows in HOURS. "Grace after a term ends" (a term expired or a sub was cancelled): the content is SUSPENDED, not deleted, for this long — the owner can still download, move it, or renew and have it come straight back. 72 = three days.', fr: 'Cycle de vie — trois fenêtres en HEURES. « Délai après la fin d’un terme » (terme expiré ou abonnement annulé) : le contenu est SUSPENDU, pas supprimé, pendant cette durée — le propriétaire peut encore télécharger, déplacer ou renouveler et tout revient. 72 = trois jours.' },
          { en: '"Grace after a FAILED payment": the same window from the moment Stripe gives up retrying (not the first failure) — cancelling is a decision, an expired card is an accident. "Warn this long before a term ends": keep it ≥ the notice period you want people to act on.', fr: '« Délai après un paiement ÉCHOUÉ » : la même fenêtre à partir du moment où Stripe abandonne les relances (pas du premier échec) — annuler est une décision, une carte expirée un accident. « Prévenir aussi longtemps avant la fin » : garde-le ≥ au délai d’action voulu.' },
          { en: 'Search & discoverability: Google Tag (loads only after Analytics consent), Google/Bing verification tokens, the site description (EN/FR) and the link-preview image (1200×630). The preview card at the top of that section shows the result. Twitter/X/Slack all read the same og:* tags.', fr: 'Recherche & découvrabilité : Google Tag (ne charge qu’après consentement Analytics), jetons de vérification Google/Bing, la description du site (EN/FR) et l’image d’aperçu (1200×630). La carte de preview en haut de cette section montre le rendu. Twitter/X/Slack lisent tous les mêmes balises og:*.' },
          { en: 'Other projects: two switches — accept free listing requests (shows a "Submit your project" form on /projects) and accept PAID listing requests (buys a spot in the review queue and nothing else; a rejected paid request may owe a refund). Both OFF until you turn them on.', fr: 'Autres projets : deux interrupteurs — accepter les demandes de référencement gratuites (affiche un formulaire « Soumettre ton projet » sur /projects) et accepter les demandes PAYANTES (achète une place dans la file de revue, rien d’autre ; une demande payante refusée peut devoir un remboursement). Les deux OFF tant que tu ne les actives pas.' },
        ]),
    ],
  },
  {
    heading: { en: 'Growth & money', fr: 'Croissance & argent' },
    items: [
      G('promotions', Megaphone, 'Promotions & codes', 'Promotions & codes',
        'Promo codes (discount / free hosting / free boost) and promo campaigns with a badge. Grant kinds are tested; Stripe discount coupling is the part to check on a real charge.',
        'Codes promo (réduction / hébergement gratuit / boost gratuit) et campagnes promo avec badge. Les types d’attribution sont testés ; le couplage à la réduction Stripe est la partie à vérifier sur un vrai paiement.',
        [
          { en: 'A "who redeemed" view shows which accounts used a code.', fr: 'Une vue « qui a utilisé » montre quels comptes ont utilisé un code.' },
        ]),
      G('events', Sparkles, 'Events', 'Événements',
        'Time-boxed site events and theming. (The heavier presentation engine was removed; what remains is the campaign/badge-adjacent event tooling.)',
        'Événements de site limités dans le temps et habillage. (Le moteur de présentation plus lourd a été retiré ; il reste l’outillage d’événement proche des campagnes/badges.)',
        []),
      G('myo', Wand2, 'Commissions (Make Your Own)', 'Commandes (Make Your Own)',
        'The paid consultation + commission pipeline: incoming requests, the two-stage Stripe flow (consult fee → approved quote), the per-request thread, and archiving.',
        'Le pipeline consultation payante + commande : demandes entrantes, le flux Stripe en deux temps (frais de consultation → devis accepté), le fil par demande, et l’archivage.',
        [
          { en: 'Building starts only after the client approves and pays the quote; paid reviews are non-refundable and that is stated before payment.', fr: 'La construction ne démarre qu’une fois le devis accepté et payé par le client ; les revues payées ne sont pas remboursables et c’est indiqué avant le paiement.' },
          { en: 'Requests can be archived, and unpaid requests older than a set age can auto-archive.', fr: 'Les demandes peuvent être archivées, et les demandes non payées plus vieilles qu’un âge défini peuvent s’archiver automatiquement.' },
        ]),
      G('kofi', Megaphone, 'Ko-fi & funding', 'Ko-fi & financement',
        'Ko-fi webhook integration: a donor whose Ko-fi email matches a BetterCommunity account gets a one-time hosting discount code. Paste the webhook URL + secret token into Ko-fi.',
        'Intégration webhook Ko-fi : un donateur dont l’e-mail Ko-fi correspond à un compte BetterCommunity reçoit un code de réduction d’hébergement unique. Colle l’URL du webhook + le jeton secret dans Ko-fi.',
        []),
    ],
  },
  {
    heading: { en: 'Integrations', fr: 'Intégrations' },
    items: [
      G('sso', Shield, 'SSO / OAuth', 'SSO / OAuth',
        'The site as an OAuth2 / OpenID Connect provider, plus the GitHub/Discord login providers. Needs real client id/secret in the environment to work live.',
        'Le site comme fournisseur OAuth2 / OpenID Connect, plus les fournisseurs de connexion GitHub/Discord. Nécessite de vrais client id/secret dans l’environnement pour fonctionner en réel.',
        []),
      G('api', KeyRound, 'Public API', 'API publique',
        'API keys and scopes for programs acting against BetterCommunity. The /dev landing and /dev/tools are the developer-facing side of this.',
        'Clés d’API et portées pour les programmes agissant contre BetterCommunity. La landing /dev et /dev/tools en sont la face développeur.',
        []),
      G('bot', MessageSquare, 'Discord bot', 'Bot Discord',
        'The connection-manager bot: which servers it is in, per-server settings, gating, welcome/bye, giveaways, Ko-fi posts, and moderation. Users manage their own server from their user dashboard.',
        'Le bot gestionnaire de connexions : dans quels serveurs il est, réglages par serveur, gating, bienvenue/au revoir, tirages, posts Ko-fi, et modération. Les utilisateurs gèrent leur propre serveur depuis leur tableau de bord.',
        [
          { en: 'The token is set/rotated here (when the bot is disabled); a DISCORD_TOKEN in the environment wins. Privileged intents are required.', fr: 'Le jeton se définit/tourne ici (quand le bot est désactivé) ; un DISCORD_TOKEN dans l’environnement l’emporte. Les intents privilégiés sont requis.' },
          { en: 'A server can be banned (the bot leaves and never rejoins, or all its commands stop there); an /appeal command returns the ban id and a link to the contact page.', fr: 'Un serveur peut être banni (le bot le quitte et n’y revient jamais, ou toutes ses commandes s’y arrêtent) ; une commande /appeal renvoie l’id du ban et un lien vers la page de contact.' },
          { en: 'Welcome/bye images can use a custom background by URL, and are moderatable in case one breaks the rules.', fr: 'Les images de bienvenue/au revoir peuvent utiliser un fond personnalisé par URL, et sont modérables au cas où l’une enfreint les règles.' },
        ]),
    ],
  },
  {
    heading: { en: 'The machine', fr: 'La machine' },
    items: [
      G('serverperf', Cpu, 'Server', 'Serveur',
        'Performance (live probes + alerts), Storage (what the bot activity and hosted content consume), the Status page (write the human account of an incident here), and Advanced.',
        'Performance (sondes en direct + alertes), Stockage (ce que consomment l’activité du bot et le contenu hébergé), la page Statut (écris ici le compte-rendu humain d’un incident), et Avancé.',
        [
          { en: 'The incidents on the public status page are the outages these probes recorded — writing one up is what you do right after looking at what broke.', fr: 'Les incidents de la page de statut publique sont les pannes enregistrées par ces sondes — en rédiger un, c’est ce qu’on fait juste après avoir regardé ce qui a cassé.' },
        ]),
      G('analytics', TrendingUp, 'Analytics', 'Analytics',
        'Traffic (native, first-party: OS/geo/vitals/sparklines), Goals, and Errors. Loopback IPs show empty geo in dev.',
        'Trafic (natif, première partie : OS/géo/vitals/sparklines), Objectifs, et Erreurs. Les IP loopback donnent une géo vide en dev.',
        [
          { en: 'Error events are readable with manage_analytics — which grants no access to private repos, so raw URLs (with share secrets) must never land in an error log.', fr: 'Les événements d’erreur sont lisibles avec manage_analytics — qui ne donne aucun accès aux dépôts privés, donc les URL brutes (avec secrets de partage) ne doivent jamais atterrir dans un journal d’erreurs.' },
        ]),
    ],
  },
  {
    heading: { en: 'How it looks & behaves', fr: 'Apparence & comportement' },
    items: [
      G('settings', Sliders, 'Settings', 'Réglages',
        'Site-wide behaviour: translucent-surfaces preference, undo-window on/off, retention caps, abuse/anti-bot knobs, and other global switches.',
        'Comportement global du site : préférence de surfaces translucides, fenêtre d’annulation on/off, plafonds de rétention, réglages anti-abus/anti-bot, et autres interrupteurs globaux.',
        [
          { en: 'Turning the undo window off makes deferred saves (blog, docs, nav, theme) commit immediately instead of after a grace period.', fr: 'Désactiver la fenêtre d’annulation fait que les enregistrements différés (blog, docs, nav, thème) s’appliquent immédiatement au lieu d’après un délai.' },
        ]),
      G('navui', Navigation, 'Navigation & footer', 'Navigation & pied de page',
        'Topbar (a custom ordered nav with groups, per-item icons and FR/EN names, desktop layout, and the mobile bottom bar), Footer, and Home page. The i18n text editor for all site strings lives here too.',
        'Topbar (une navigation ordonnée personnalisée avec groupes, icônes par item et noms FR/EN, mise en page desktop, et la barre du bas mobile), Pied de page, et Page d’accueil. L’éditeur i18n de tous les textes du site est ici aussi.',
        [
          { en: 'The mobile bottom bar can be icon-only / text-only / both, and can hold a custom set of up to five buttons instead of auto-deriving from the nav.', fr: 'La barre du bas mobile peut être icônes seules / texte seul / les deux, et peut contenir un jeu personnalisé jusqu’à cinq boutons au lieu de dériver automatiquement de la nav.' },
          { en: 'The i18n editor edits every string live (FR, EN and any added language) and can add languages — including right-to-left ones.', fr: 'L’éditeur i18n édite chaque texte en direct (FR, EN et toute langue ajoutée) et peut ajouter des langues — y compris de droite à gauche.' },
        ]),
      G('sitetheme', Palette, 'Site theme', 'Thème du site',
        'The accent every visitor sees, in light and dark. Presets, the accent gradient, per-mode page colours, a full token catalogue, glow-geometry editor, a live preview, and export/import of a whole look. SUPERADMIN only.',
        'L’accent que chaque visiteur voit, en clair et sombre. Presets, dégradé d’accent, couleurs de page par mode, un catalogue de tokens complet, éditeur de géométrie des halos, un aperçu en direct, et export/import d’un thème entier. SUPERADMIN uniquement.',
        [
          { en: 'A preset carries only the accent pair — everything else derives from it, so picking one clears your token overrides (undoably) so it renders as designed.', fr: 'Un preset ne porte que la paire d’accent — tout le reste en dérive, donc en choisir un efface tes surcharges de tokens (annulable) pour qu’il s’affiche comme prévu.' },
          { en: 'Apply writes immediately; Undo is a real second write of the previous value, so closing the toast leaves the new theme in place.', fr: 'Appliquer écrit immédiatement ; Annuler est une vraie seconde écriture de l’ancienne valeur, donc fermer le toast laisse le nouveau thème en place.' },
        ]),
    ],
  },
];

export default function AdminGuide() {
  const { t, lang } = useI18n();
  const { user } = useAuth();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(() => new Set());
  const [expandAll, setExpandAll] = useState(false);
  const [editing, setEditing] = useState(false);
  const [custom, setCustom] = useState(null); // admin-authored Markdown sections
  const L = (o) => (lang === 'fr' ? (o?.fr || o?.en || '') : (o?.en || o?.fr || ''));
  // Only ADMIN/SUPERADMIN reach this screen, but the Edit affordance is theirs specifically.
  const canEdit = !!user && (user.role === 'ADMIN' || user.role === 'SUPERADMIN');

  useEffect(() => {
    api.get('/admin/settings')
      .then((d) => setCustom(Array.isArray(d?.settings?.['guide.custom']) ? d.settings['guide.custom'] : []))
      .catch(() => setCustom([]));
  }, []);

  // Custom sections join the built-in guide as one more group at the end, so a search and the
  // expand-all control cover them too. Each carries Markdown bodies rendered by <Markdown>.
  const merged = useMemo(() => {
    const base = GUIDE.map((g) => ({ ...g, items: g.items.map((it) => ({ ...it, kind: 'builtin' })) }));
    if (custom && custom.length) {
      base.push({
        heading: { en: 'Added by your team', fr: 'Ajouté par ton équipe' },
        items: custom.map((c) => ({ ...c, icon: iconOf(c.icon), kind: 'custom' })),
      });
    }
    return base;
  }, [custom]);

  const query = q.trim().toLowerCase();
  const groups = useMemo(() => {
    if (!query) return merged;
    return merged.map((g) => ({
      ...g,
      items: g.items.filter((it) => {
        const pts = it.kind === 'custom' ? '' : it.points.map((p) => p.en + ' ' + p.fr).join(' ');
        const bodies = it.kind === 'custom' ? `${it.body?.en || ''} ${it.body?.fr || ''}` : `${it.body.en} ${it.body.fr}`;
        const hay = `${it.title.en} ${it.title.fr} ${bodies} ${pts}`.toLowerCase();
        return hay.includes(query);
      }),
    })).filter((g) => g.items.length);
  }, [query, merged]);

  const toggle = (id) => setOpen((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allOpen = query.length > 0 || expandAll; // a search auto-expands what it found

  if (editing) return <GuideEditor initial={custom || []} onClose={() => setEditing(false)} onSaved={(v) => { setCustom(v); setEditing(false); }} />;

  return (
    <div>
      <div className="flex items-start gap-3 flex-wrap mb-1">
        <h2 className="font-semibold flex items-center gap-2 flex-1"><BookOpen size={16} className="text-[var(--primary-2)]" /> {t('ag.title', 'Admin guide')}</h2>
        {canEdit && <Button size="sm" variant="ghost" onClick={() => setEditing(true)}><Pencil size={13} /> {t('ag.edit', 'Edit guide')}</Button>}
      </div>
      <p className="text-sm text-[var(--muted)] mb-4">{t('ag.sub', 'What every admin screen does, who sees the result, and the traps worth knowing — grouped like the sidebar.')}</p>

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--faint)]" />
          <Input className="!ps-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('ag.search', 'Search the guide…')} />
        </div>
        <Button size="sm" variant="ghost" onClick={() => setExpandAll((v) => !v)}>
          {expandAll ? <><ChevronsDownUp size={13} /> {t('ag.collapse', 'Collapse all')}</> : <><ChevronsUpDown size={13} /> {t('ag.expand', 'Expand all')}</>}
        </Button>
      </div>

      {groups.length === 0 && <Card className="p-6 text-sm text-[var(--muted)]">{t('ag.none', 'Nothing matches that.')}</Card>}

      <div className="space-y-5">
        {groups.map((g) => (
          <div key={g.heading.en}>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--faint)] mb-2">{L(g.heading)}</div>
            <div className="space-y-2">
              {g.items.map((it) => {
                const isOpen = allOpen || open.has(it.id);
                const Icon = it.icon;
                const count = it.kind === 'custom' ? 0 : it.points.length;
                return (
                  <Card key={it.id} className="overflow-hidden">
                    <button type="button" onClick={() => toggle(it.id)} aria-expanded={isOpen}
                      className="w-full text-start p-3.5 flex items-start gap-3 hover:bg-[var(--surface-2)]/50 transition">
                      <span className="grid place-items-center w-9 h-9 rounded-lg bg-[var(--surface-2)] text-[var(--primary-2)] shrink-0"><Icon size={17} /></span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="block font-semibold text-sm">{L(it.title)}</span>
                          {it.kind === 'custom' && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--primary)]/10 text-[var(--primary-2)]">{t('ag.customtag', 'custom')}</span>}
                          {count > 0 && !isOpen && <span className="text-[10px] text-[var(--faint)]">· {t('ag.npoints', '{n} points').replace('{n}', count)}</span>}
                        </span>
                        <span className="block text-[13px] text-[var(--muted)] leading-relaxed mt-0.5">{it.kind === 'custom' ? '' : L(it.body)}</span>
                      </span>
                      <ChevronDown size={16} className={`text-[var(--faint)] shrink-0 mt-1 transition-transform ${isOpen ? '' : '-rotate-90'}`} />
                    </button>
                    {isOpen && it.kind === 'builtin' && it.points.length > 0 && (
                      <ul className="px-3.5 pb-3.5 ps-[62px] space-y-1.5">
                        {it.points.map((p, i) => (
                          <li key={i} className="text-[13px] text-[var(--muted)] leading-relaxed list-disc marker:text-[var(--primary-2)]">{L(p)}</li>
                        ))}
                      </ul>
                    )}
                    {isOpen && it.kind === 'custom' && (
                      <div className="px-3.5 pb-3.5 ps-[62px] prose-sm max-w-none text-[13px] text-[var(--muted)] leading-relaxed">
                        <Markdown>{L(it.body) || '*—*'}</Markdown>
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// The editor for custom Markdown sections. Kept in this file (next to what it edits) and only
// reachable by an ADMIN. Bilingual title + body per section, reorderable, saved as one blob to
// AdminSetting 'guide.custom' — the same list the guide reads and the API validates.
function GuideEditor({ initial, onClose, onSaved }) {
  const { t } = useI18n();
  const toast = useToast();
  const [rows, setRows] = useState(() => initial.map((r) => ({ ...r })));
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState('en');

  const set = (i, patch) => setRows(rows.map((r, n) => (n === i ? { ...r, ...patch } : r)));
  const setLoc = (i, field, locpatch) => set(i, { [field]: { ...(rows[i][field] || {}), ...locpatch } });
  const move = (i, d) => { const j = i + d; if (j < 0 || j >= rows.length) return; const n = [...rows]; [n[i], n[j]] = [n[j], n[i]]; setRows(n); };
  const add = () => setRows([...rows, { id: `sec-${Date.now().toString(36)}`, icon: 'FileText', heading: { en: 'Added by your team', fr: 'Ajouté par ton équipe' }, title: { en: '', fr: '' }, body: { en: '', fr: '' } }]);

  const save = async () => {
    // A section with no title is noise in the guide; drop empties rather than store them.
    const clean = rows
      .map((r) => ({ id: String(r.id || `sec-${Math.random().toString(36).slice(2)}`).slice(0, 60), icon: r.icon || 'FileText', heading: r.heading || { en: '', fr: '' }, title: r.title || { en: '', fr: '' }, body: r.body || { en: '', fr: '' } }))
      .filter((r) => (r.title.en || r.title.fr || '').trim());
    setBusy(true);
    try {
      await api.put('/admin/settings/guide.custom', { value: clean });
      toast.success(t('ag.saved', 'Guide saved.'));
      onSaved(clean);
    } catch { toast.error(t('common.failed', 'Failed.')); }
    finally { setBusy(false); }
  };

  return (
    <div>
      <div className="flex items-center gap-3 flex-wrap mb-1">
        <h2 className="font-semibold flex items-center gap-2 flex-1"><Pencil size={16} className="text-[var(--primary-2)]" /> {t('ag.edit.title', 'Edit the admin guide')}</h2>
        <div className="inline-flex rounded-lg border border-[var(--line)] p-0.5 text-xs">
          {[['en', 'EN'], ['fr', 'FR']].map(([k, lbl]) => (
            <button key={k} type="button" onClick={() => setTab(k)} className={`px-2.5 py-1 rounded-md ${tab === k ? 'bg-[var(--surface-2)] text-[var(--text)] font-medium' : 'text-[var(--muted)]'}`}>{lbl}</button>
          ))}
        </div>
        <Button size="sm" variant="ghost" onClick={onClose}><X size={13} /> {t('common.cancel', 'Cancel')}</Button>
        <Button size="sm" disabled={busy} onClick={save}>{busy ? <Spinner /> : <><Save size={13} /> {t('ag.save', 'Save guide')}</>}</Button>
      </div>
      <p className="text-sm text-[var(--muted)] mb-4">{t('ag.edit.sub', 'Extra sections written in Markdown, on top of the built-in guide. They show under “Added by your team”. Both languages — an empty FR falls back to EN.')}</p>

      <div className="space-y-3">
        {rows.map((r, i) => (
          <Card key={i} className="p-3.5">
            <div className="flex items-center gap-2 mb-2.5">
              <span className="grid place-items-center w-8 h-8 rounded-lg bg-[var(--surface-2)] text-[var(--primary-2)] shrink-0">{(() => { const I = iconOf(r.icon); return <I size={15} />; })()}</span>
              <Input className="!w-full flex-1" value={(r.title || {})[tab] || ''} onChange={(e) => setLoc(i, 'title', { [tab]: e.target.value })} placeholder={tab === 'fr' ? 'Titre de la section' : 'Section title'} />
              <div className="flex items-center gap-0.5">
                <button onClick={() => move(i, -1)} disabled={i === 0} className="p-1.5 rounded hover:bg-[var(--surface-2)] disabled:opacity-30"><ChevronUp size={14} /></button>
                <button onClick={() => move(i, 1)} disabled={i === rows.length - 1} className="p-1.5 rounded hover:bg-[var(--surface-2)] disabled:opacity-30"><ChevronDown size={14} /></button>
                <button onClick={() => setRows(rows.filter((_, n) => n !== i))} className="p-1.5 rounded text-error hover:bg-error-bg"><Trash2 size={14} /></button>
              </div>
            </div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[11px] text-[var(--faint)]">{t('ag.icon', 'Icon')}</span>
              <div className="flex flex-wrap gap-1">
                {Object.keys(GUIDE_ICONS).map((name) => { const I = GUIDE_ICONS[name]; return (
                  <button key={name} type="button" onClick={() => set(i, { icon: name })} title={name}
                    className={`p-1.5 rounded-lg border ${r.icon === name ? 'border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--primary-2)]' : 'border-[var(--line)] text-[var(--muted)]'}`}><I size={14} /></button>
                ); })}
              </div>
            </div>
            <MarkdownEditor value={(r.body || {})[tab] || ''} onChange={(v) => setLoc(i, 'body', { [tab]: v })} minHeight={160}
              placeholder={tab === 'fr' ? 'Écris la section en **markdown**…' : 'Write the section in **markdown**…'} />
          </Card>
        ))}
      </div>

      <Button variant="ghost" className="mt-3" onClick={add}><Plus size={14} /> {t('ag.addsection', 'Add a section')}</Button>
    </div>
  );
}

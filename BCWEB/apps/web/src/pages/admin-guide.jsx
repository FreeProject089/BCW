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
import { useState, useMemo, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  RotateCcw,
  BookOpen, Search, BellIcon, Inbox, Users, Shield, Settings2, Boxes, Newspaper, BadgeCheck,
  Server, CreditCard, Rocket, Megaphone, Sparkles, Wand2, KeyRound, MessageSquare, Cpu,
  TrendingUp, Sliders, Navigation, Palette, Lock, History, Scale, Gavel, HardDrive,
  Pencil, Plus, Trash2, Save, ChevronUp, ChevronDown, X, FileText, ChevronsDownUp, ChevronsUpDown, Info, AlertTriangle,
} from 'lucide-react';
import { Bug as BugIcon } from 'lucide-react';
import { useI18n } from '../i18n.jsx';
import { useAuth } from './auth.jsx';
import { Card, Input, Button, Spinner, useToast } from '../ui/ui.jsx';
import { api } from '../lib/api.js';
import Markdown from '../ui/md.jsx';
import { MarkdownEditor } from './blog.jsx';
import { HOSTING_SETTINGS_GROUPS, HOSTING_GROUP_DESC } from '../lib/hosting-settings.js';
import { BOT_DASHBOARD_REF } from '../lib/bot-dashboard-ref.js';
import { ADMIN_SCREENS_REF } from '../lib/admin-screens-ref.js';

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
      G('feedback', BugIcon, 'Feedback & crashes', 'Retours & plantages',
        'What the apps send to the feedback centre: suggestions, bug reports and crash dumps, one inbox per project (BMM, BSM, a showcase). The tiles on top say what is new by kind — crashes first — and how old the oldest untriaged one is. Open a report to read it, download its attachments, answer in the sender’s thread or by mail, and mark it triaged, resolved or ignored.',
        'Ce que les applis envoient au centre de retours : suggestions, rapports de bug et plantages, une boîte par projet (BMM, BSM, une vitrine). Les tuiles du haut disent ce qui est nouveau par genre — les plantages d’abord — et l’âge du plus vieux rapport non trié. Ouvre un rapport pour le lire, télécharger ses pièces jointes, répondre dans le fil de l’expéditeur ou par mail, et le marquer trié, résolu ou ignoré.',
        [
          { en: 'A project accepts nothing until its switch is on (Project settings & limits). Apps get a clean “not enabled” answer meanwhile — BMM keeps the report locally and retries later.', fr: 'Un projet n’accepte rien tant que son interrupteur est éteint (Réglages du projet & limites). Les applis reçoivent une réponse « pas activé » propre — BMM garde le rapport en local et réessaie plus tard.' },
          { en: 'Essentials are on top (kinds, contact rule, thread, mail); caps, crash sampling, version and word filters are under Advanced. The platform-wide API ceilings live on Public API → Limits, attachment retention in Hosting settings → Feedback storage.', fr: 'L’essentiel est en haut (genres, règle de contact, fil, mail) ; plafonds, échantillonnage des plantages, filtres de version et de mots sont sous Avancé. Les plafonds API globaux sont dans API publique → Limites, la rétention des pièces jointes dans Réglages d’hébergement → Stockage des retours.' },
          { en: 'Resolved or ignored closes the sender’s thread with a line saying so; the “Needs attention” digest counts new reports only.', fr: 'Résolu ou ignoré ferme le fil de l’expéditeur avec une ligne qui le dit ; le résumé « À traiter » ne compte que les nouveaux rapports.' },
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
        [
          { en: 'An event has a start and an end; outside that window it is inert, so you can prepare one in advance and let it switch itself on and off.', fr: 'Un événement a un début et une fin ; hors de cette fenêtre il est inerte, donc tu peux en préparer un à l’avance et le laisser s’activer et se désactiver seul.' },
          { en: 'Events sit next to Promotions & campaigns — a promo campaign can carry its own badge; use Promotions for a discount or a badge, Events for a time-boxed change.', fr: 'Les événements côtoient Promotions & campagnes — une campagne promo peut porter son propre badge ; utilise Promotions pour une réduction ou un badge, Événements pour un changement limité dans le temps.' },
        ]),
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
        [
          { en: 'The token you paste into Ko-fi is the shared secret that proves a webhook really came from Ko-fi — a request without it is ignored, so a stranger cannot forge a donation.', fr: 'Le jeton que tu colles dans Ko-fi est le secret partagé qui prouve qu’un webhook vient bien de Ko-fi — une requête sans lui est ignorée, donc un inconnu ne peut pas falsifier un don.' },
          { en: 'A funding goal can be shown on the home page (a progress bar + running total); the bot can also post each new tip to a channel (see the Discord bot’s Ko-fi module).', fr: 'Un objectif de financement peut s’afficher sur l’accueil (barre de progression + total courant) ; le bot peut aussi poster chaque nouveau pourboire dans un salon (voir le module Ko-fi du bot Discord).' },
        ]),
    ],
  },
  {
    heading: { en: 'Integrations', fr: 'Intégrations' },
    items: [
      G('sso', Shield, 'SSO / OAuth', 'SSO / OAuth',
        'The site as an OAuth2 / OpenID Connect provider, plus the GitHub/Discord login providers. Needs real client id/secret in the environment to work live.',
        'Le site comme fournisseur OAuth2 / OpenID Connect, plus les fournisseurs de connexion GitHub/Discord. Nécessite de vrais client id/secret dans l’environnement pour fonctionner en réel.',
        [
          { en: 'Two directions: BetterCommunity as a LOGIN client (a visitor signs in with GitHub/Discord) and BetterCommunity as a PROVIDER (another app signs its users in with a BetterCommunity account). The provider side is where you register client apps and their redirect URIs.', fr: 'Deux directions : BetterCommunity comme CLIENT de connexion (un visiteur se connecte avec GitHub/Discord) et BetterCommunity comme FOURNISSEUR (une autre appli connecte ses utilisateurs avec un compte BetterCommunity). Le côté fournisseur, c’est là que tu enregistres les applis clientes et leurs URI de redirection.' },
          { en: 'Nothing works until the provider’s client id/secret are set in the environment — until then the buttons are present but the flow fails at the provider.', fr: 'Rien ne marche tant que les client id/secret du fournisseur ne sont pas dans l’environnement — d’ici là les boutons sont là mais le flux échoue chez le fournisseur.' },
        ]),
      G('api', KeyRound, 'Public API', 'API publique',
        'API keys and scopes for programs acting against BetterCommunity. The /dev landing and /dev/tools are the developer-facing side of this.',
        'Clés d’API et portées pour les programmes agissant contre BetterCommunity. La landing /dev et /dev/tools en sont la face développeur.',
        [
          { en: 'A key carries scopes — it can do only what its scopes allow, never more than the account that made it. Revoking a key is instant and cannot be undone; issue a new one rather than un-revoking.', fr: 'Une clé porte des portées — elle ne peut faire que ce que ses portées autorisent, jamais plus que le compte qui l’a créée. Révoquer une clé est instantané et irréversible ; émets-en une nouvelle plutôt que d’annuler la révocation.' },
          { en: 'The full endpoint reference lives on /dev/tools; a key is shown ONCE at creation and never again, so it is stored hashed — a lost key is re-issued, not recovered.', fr: 'La référence complète des endpoints est sur /dev/tools ; une clé est montrée UNE fois à la création et jamais après, donc elle est stockée hachée — une clé perdue se réémet, elle ne se récupère pas.' },
        ]),
      G('bot', MessageSquare, 'Discord bot', 'Bot Discord',
        'The connection-manager bot. There are TWO dashboards: this admin one (you, the bot dev — global config across every server), and the user one (a server owner manages the bot on their OWN server, from their dashboard → Discord servers). The admin dashboard is organised as a left module rail — Overview, Announcements, Rules/panels/DMs, Per-server, Members, Limits — one module at a time.',
        'Le bot gestionnaire de connexions. Il y a DEUX tableaux de bord : celui-ci, admin (toi, le dev du bot — config globale sur tous les serveurs), et celui utilisateur (un propriétaire de serveur gère le bot sur SON serveur, depuis son tableau de bord → Serveurs Discord). Le dashboard admin est organisé en un rail de modules à gauche — Vue d’ensemble, Annonces, Règles/panneaux/MP, Par serveur, Membres, Limites — un module à la fois.',
        [
          { en: 'The token is set/rotated here (when the bot is disabled); a DISCORD_TOKEN in the environment wins. Privileged intents are required. "Reconnect bot" drops and re-opens the Discord connection (it does NOT deploy new code).', fr: 'Le jeton se définit/tourne ici (quand le bot est désactivé) ; un DISCORD_TOKEN dans l’environnement l’emporte. Les intents privilégiés sont requis. « Reconnecter » coupe et rouvre la connexion Discord (ça ne déploie PAS de nouveau code).' },
          { en: 'Member storage (Overview) is a global choice of how the bot builds its database: "Per-server" (default — each server opts into a paid pool or moderation-logs-only with its own budget; nothing stored until it opts in), "Free — every server" (store everyone, with a who sub-choice: linked accounts only / active members / everyone), or "Unified per person" (one row per person with their shared servers, not one per server).', fr: 'Le stockage des membres (Vue d’ensemble) est un choix global de comment le bot construit sa base : « Par serveur » (défaut — chaque serveur choisit un pool payant ou logs-de-modération seulement avec son budget ; rien tant qu’il n’active pas), « Gratuit — chaque serveur » (stocke tout le monde, avec un sous-choix : comptes liés / actifs / tous), ou « Unifié par personne » (une ligne par personne avec ses serveurs partagés, pas une par serveur).' },
          { en: 'Per-server config (moderation, welcome/bye, join-to-create voice, gated roles) is set independently for each server via the server picker; a server with no config of its own uses the Global defaults. A server can be banned (the bot leaves and never rejoins, or all its commands stop there); /appeal returns the ban id and a contact link.', fr: 'La config par serveur (modération, bienvenue/au revoir, vocal à la demande, rôles réservés) se règle indépendamment pour chaque serveur via le sélecteur ; un serveur sans config propre utilise les défauts globaux. Un serveur peut être banni (le bot le quitte et n’y revient jamais, ou toutes ses commandes s’y arrêtent) ; /appeal renvoie l’id du ban et un lien de contact.' },
          { en: 'Announcements route by kind (commissions, incidents, legal, "needs attention", events, promos) — each to its own channel with an optional urgent-only ping. Blog posts, alerts, Ko-fi tips and Stripe payments/refunds each post to their configured channels. "Message every member" DMs everyone the bot has seen (slow on purpose — Discord treats DM bursts as spam).', fr: 'Les annonces sont routées par type (commandes, incidents, légal, « à traiter », événements, promos) — chacune vers son salon avec un ping urgent optionnel. Articles de blog, alertes, pourboires Ko-fi et paiements/remboursements Stripe postent chacun vers leurs salons. « Message à chaque membre » envoie un MP à tous ceux que le bot a vus (lent exprès — Discord traite les rafales de MP comme du spam).' },
          { en: 'Users link their Discord in-place from their dashboard (run /link in a server to get a code, paste it), then the servers they own or have Manage Server on appear for them to configure. Welcome/bye images can use a custom uploaded background, and are moderatable. Channels and roles are picked from the live server, not pasted as ids.', fr: 'Les utilisateurs lient leur Discord directement depuis leur tableau de bord (lance /link dans un serveur pour un code, colle-le), puis les serveurs qu’ils possèdent ou gèrent apparaissent à configurer. Les images de bienvenue/au revoir peuvent utiliser un fond téléversé, et sont modérables. Les salons et rôles se choisissent dans le serveur en direct, pas en collant des id.' },
        ]),
      G('economy', Sparkles, 'Levels & economy', 'Niveaux & économie',
        'The XP / levels / points system the bot runs across every server (bot dashboard → Levels & economy). Messages, reactions and voice time earn XP; XP earns levels; levels grant points spent in a shop or a casino. It ONLY accrues for members who linked a BetterCommunity account, so a level always maps to a real profile.',
        'Le système XP / niveaux / points que le bot fait tourner sur chaque serveur (dashboard bot → Niveaux & économie). Messages, réactions et temps en vocal donnent de l’XP ; l’XP donne des niveaux ; les niveaux donnent des points dépensés dans une boutique ou un casino. Ne s’accumule QUE pour les membres ayant lié un compte BetterCommunity, donc un niveau correspond toujours à un vrai profil.',
        [
          { en: 'You configure everything here: the currency name + emoji/image, the XP rates (per message/reaction/voice-minute), the level curve (a higher factor = each level is harder, with a live preview), how many points a level grants, the casino limits, and the shop items.', fr: 'Tu configures tout ici : le nom + emoji/image de la devise, les taux d’XP (par message/réaction/minute-vocal), la courbe de niveaux (facteur plus haut = chaque niveau plus dur, avec un aperçu en direct), combien de points un niveau donne, les limites du casino, et les articles de la boutique.' },
          { en: 'The level is ALWAYS public — it shows on the member’s BetterCommunity profile, in the shared-link OG card, and via the bot’s /profile command. The message/reaction/voice stats follow each member’s own "stats public" toggle.', fr: 'Le niveau est TOUJOURS public — il s’affiche sur le profil BetterCommunity du membre, dans la carte OG des liens partagés, et via la commande /profile du bot. Les stats messages/réactions/vocal suivent le réglage « stats publiques » de chaque membre.' },
          { en: 'Balances & leaderboard (same page) lists every member by level and points, and lets you GIVE or take points from anyone (audited). Members use /level, /profile, /shop and /casino in Discord.', fr: 'Soldes & classement (même page) liste chaque membre par niveau et points, et te permet de DONNER ou retirer des points à n’importe qui (journalisé). Les membres utilisent /level, /profile, /shop et /casino dans Discord.' },
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

// Per-screen depth, beyond the summary + bullet points: a numbered "how to" and the rules and
// traps that bite. Keyed by the entry id above. This is where the explanations that used to
// crowd the screens themselves now live — the screen keeps the control, the guide keeps the
// manual. Every entry has both lists, so no page of the guide is a title and two lines.
const GUIDE_MORE = {
  needs: {
    steps: [
      { en: 'Open it first thing: each row is one queue with a count of what is waiting.', fr: 'Ouvre-le en premier : chaque ligne est une file avec le nombre d’éléments en attente.' },
      { en: 'Click a row — it takes you to the screen where that work is actually done (Submissions, Reports, Sanctions, Commissions, Server → Performance).', fr: 'Clique une ligne — elle t’amène à l’écran où ce travail se fait vraiment (Soumissions, Signalements, Sanctions, Commandes, Serveur → Performance).' },
      { en: 'Come back when the counts read zero; that is the definition of “caught up”.', fr: 'Reviens quand les compteurs sont à zéro ; c’est la définition d’« à jour ».' },
    ],
    traps: [
      { en: 'The Discord bot can post this digest to a channel (bot → Announcements → “Needs attention” route) so you hear about a queue without opening the dashboard.', fr: 'Le bot Discord peut poster ce résumé dans un salon (bot → Annonces → route « À traiter ») pour être prévenu sans ouvrir le tableau de bord.' },
    ],
  },
  moderation: {
    steps: [
      { en: 'Submissions: open one, check the payload (size, structure, closed-source proof if claimed), then Approve or Reject with a reason the author will read.', fr: 'Soumissions : ouvre-en une, vérifie la charge (taille, structure, preuve propriétaire si revendiquée), puis Approuve ou Refuse avec une raison que l’auteur lira.' },
      { en: 'Approving creates the page UNPUBLISHED. Go to the catalogue/project and publish when it is ready — two deliberate steps.', fr: 'Approuver crée la page NON publiée. Va dans le catalogue/projet et publie quand c’est prêt — deux étapes volontaires.' },
      { en: 'Reports: read the reported content in context, then dismiss, warn, or open Sanctions to suspend. Messages: reply from the thread; the sender is notified.', fr: 'Signalements : lis le contenu signalé dans son contexte, puis classe, avertis, ou ouvre Sanctions pour suspendre. Messages : réponds depuis le fil ; l’expéditeur est prévenu.' },
      { en: 'Sanctions: every suspension has a duration and an appeal. Review appeals here; lifting one is logged.', fr: 'Sanctions : chaque suspension a une durée et un appel. Traite les appels ici ; lever une sanction est journalisé.' },
    ],
    traps: [
      { en: 'A rejected submission keeps its uploaded file for the “rejected-payload grace” (Hosting settings) so the author can fix and resubmit — after that the sweeper purges it.', fr: 'Une soumission refusée garde son fichier pendant le « délai après refus » (Réglages d’hébergement) pour que l’auteur corrige et renvoie — ensuite le nettoyeur le purge.' },
      { en: 'Moderator rank matters: a MOD cannot sanction an account above their own rank, and staff actions land in the tamper-evident Security log.', fr: 'Le rang compte : un MOD ne peut pas sanctionner un compte d’un rang supérieur au sien, et les actions du staff finissent dans le Journal de sécurité infalsifiable.' },
      { en: 'Legal notices identify their sender. They never leave the dashboard — the bot only posts a heads-up + link, and only if the Legal route has a channel.', fr: 'Les avis légaux identifient leur expéditeur. Ils ne sortent jamais du tableau de bord — le bot ne poste qu’un rappel + lien, et seulement si la route Légal a un salon.' },
    ],
  },
  users: {
    steps: [
      { en: 'Search by pseudo, e-mail or id; open the account panel.', fr: 'Cherche par pseudo, e-mail ou id ; ouvre la fiche du compte.' },
      { en: 'Roles & permissions tab: tick a built-in tier or a custom role, or grant a single capability — it applies on Save and shows in the user’s /me immediately.', fr: 'Onglet Rôles & permissions : coche un palier intégré ou un rôle personnalisé, ou accorde une capacité seule — appliqué à l’enregistrement et visible dans le /me de l’utilisateur aussitôt.' },
      { en: 'Moderate: Suspend (time-boxed, reversible) or Ban (until lifted). Both ask for a reason and are appealable from the user’s side.', fr: 'Modérer : Suspendre (limité dans le temps, réversible) ou Bannir (jusqu’à levée). Les deux demandent une raison et sont contestables côté utilisateur.' },
      { en: 'Linked logins: see GitHub/Discord links; unlink one if the user asks. A Discord unlink also stops the bot crediting them XP.', fr: 'Connexions liées : vois les liens GitHub/Discord ; délie-en un si l’utilisateur le demande. Délier Discord arrête aussi le crédit d’XP par le bot.' },
    ],
    traps: [
      { en: 'Free vs paid is derived from live subscriptions, not a flag you set — a lapsed plan moves the account back to “free” by itself.', fr: '« Gratuit vs payant » découle des abonnements en cours, pas d’un drapeau — une offre échue rebascule le compte en « gratuit » toute seule.' },
      { en: 'Deleting an account cascades: repos, catalogs, badges, economy balance and Discord links go with it. Prefer Ban when in doubt.', fr: 'Supprimer un compte est en cascade : dépôts, catalogues, badges, solde d’économie et liens Discord partent avec. Préfère Bannir en cas de doute.' },
    ],
  },
  access: {
    steps: [
      { en: 'Bans & shield (bottom of this screen): IP addresses and CIDR ranges, User-Agent fragments and BMM creator ids kept out of EVERY service; the shield blocks an address on its own after N rate-limits in ten minutes. Live within 15 s, audited.', fr: 'Bans & bouclier (bas de cet écran) : adresses IP et plages CIDR, fragments de User-Agent et identifiants créateur BMM tenus hors de TOUS les services ; le bouclier bloque seul une adresse après N limitations en dix minutes. Actif sous 15 s, journalisé.' },
      { en: 'Create a custom role: name it, tick the capabilities it bundles (manage_repos, manage_myo, manage_analytics, translator roles…).', fr: 'Crée un rôle personnalisé : nomme-le, coche les capacités qu’il regroupe (manage_repos, manage_myo, manage_analytics, rôles de traducteur…).' },
      { en: 'Assign it from the account panel (Accounts → user → Roles). Effective permissions = the union of every role held.', fr: 'Attribue-le depuis la fiche du compte (Comptes → utilisateur → Rôles). Permissions effectives = l’union de tous les rôles détenus.' },
      { en: 'Per-project grants (Projects → a project → Permissions) scope a capability to ONE project — for a contributor who should edit one blog and nothing else.', fr: 'Les droits par projet (Projets → un projet → Permissions) limitent une capacité à UN projet — pour un contributeur qui doit éditer un blog et rien d’autre.' },
    ],
    traps: [
      { en: 'SUPERADMIN bypasses every check implicitly and is the only tier that can edit the site theme or read the audit chain’s verify report.', fr: 'SUPERADMIN contourne toute vérification implicitement et est le seul palier qui peut éditer le thème du site ou lire le rapport de vérification de la chaîne d’audit.' },
      { en: 'Editor-level actions require 2FA on the acting account — an admin without 2FA gets 403 with “2fa_required”, which is the guard working, not a bug.', fr: 'Les actions de niveau éditeur exigent la 2FA sur le compte qui agit — un admin sans 2FA reçoit 403 « 2fa_required », c’est la protection qui marche, pas un bug.' },
      { en: '“manage_server” is a real capability (admin-only, ungrantable) — it is NOT the gate for the Advanced server tab.', fr: '« manage_server » est une vraie capacité (admin seul, non attribuable) — ce n’est PAS la porte de l’onglet Serveur avancé.' },
    ],
  },
  security: {
    steps: [
      { en: 'Security log: filter by actor, action or date; open an entry to see the full before/after.', fr: 'Journal de sécurité : filtre par acteur, action ou date ; ouvre une entrée pour voir l’avant/après complet.' },
      { en: 'Run Verify chain when something looks off — it recomputes every HMAC link and names the first broken one.', fr: 'Lance Vérifier la chaîne quand quelque chose semble louche — elle recalcule chaque maillon HMAC et nomme le premier rompu.' },
      { en: 'Logins: the recent sign-ins per account, with IP and device, to spot a takeover.', fr: 'Connexions : les dernières connexions par compte, avec IP et appareil, pour repérer une prise de contrôle.' },
    ],
    traps: [
      { en: 'Retention (Hosting settings → Security & audit logs) prunes old entries; that pruning is the only sanctioned deletion — anything else breaks the chain and Verify will say so.', fr: 'La rétention (Réglages d’hébergement → Sécurité & journaux) élague les vieilles entrées ; cet élagage est la seule suppression autorisée — tout autre casse la chaîne et Vérifier le dira.' },
      { en: 'A broken link alerts every SUPERADMIN by notification. Treat it as an incident, not a glitch.', fr: 'Un maillon rompu alerte chaque SUPERADMIN par notification. Traite-le comme un incident, pas un pépin.' },
    ],
  },
  projects: {
    steps: [
      { en: 'Pick a project → Overview: title, tagline, description (EN/FR), hero media.', fr: 'Choisis un projet → Aperçu : titre, accroche, description (EN/FR), média de tête.' },
      { en: 'Presentation: add images, video, rrweb or .bmmreplay embeds — each previews live before you save.', fr: 'Présentation : ajoute images, vidéo, rrweb ou embeds .bmmreplay — chacun se prévisualise en direct avant l’enregistrement.' },
      { en: 'Timeline: paste a GitHub repo URL (or drop a .git) to import commits, contributors and per-day activity; write milestones in Markdown.', fr: 'Chronologie : colle l’URL d’un dépôt GitHub (ou dépose un .git) pour importer commits, contributeurs et activité par jour ; rédige les jalons en Markdown.' },
      { en: 'Visibility: per page (public / signed-in / staff), plus an optional countdown teaser and a scheduled content swap.', fr: 'Visibilité : par page (public / connecté / staff), plus un compte à rebours optionnel et un échange de contenu programmé.' },
    ],
    traps: [
      { en: 'Featured (boosted) projects are ranked by a REAL download counter — not a number you type. Flush the GitHub cache from here if imported stats look stale.', fr: 'Les projets mis en avant (boostés) sont classés par un VRAI compteur de téléchargements — pas un nombre saisi. Vide le cache GitHub d’ici si les stats importées semblent figées.' },
      { en: 'Blog scope: a project blog only shows posts tagged to that project; “home news” is a separate toggle per post.', fr: 'Portée du blog : un blog de projet ne montre que les articles rattachés à ce projet ; « actu d’accueil » est un réglage séparé par article.' },
    ],
  },
  catalogs: {
    steps: [
      { en: 'Official: add an entry (app / plugin / theme / preset), upload or link its payload, set version + changelog, publish. BMM reads this feed as trusted.', fr: 'Officiel : ajoute une entrée (appli / plugin / thème / preset), téléverse ou lie sa charge, fixe version + changelog, publie. BMM lit ce flux comme fiable.' },
      { en: 'Community: entries arrive via Submissions; here you can hide, feature or take one down after publication.', fr: 'Communauté : les entrées arrivent via Soumissions ; ici tu peux masquer, mettre en avant ou retirer une entrée après publication.' },
      { en: 'Downloads & assets: the installers and files the platform hosts (PlatformAsset) — upload a new build and links.json updates for BMM’s auto-update.', fr: 'Téléchargements & assets : les installeurs et fichiers hébergés par la plateforme (PlatformAsset) — téléverse un nouveau build et links.json se met à jour pour l’auto-update de BMM.' },
    ],
    traps: [
      { en: 'Our-hosted payloads above the free size are billed to non-staff submitters as a recurring Stripe subscription — see Hosting settings → Pricing.', fr: 'Les charges hébergées chez nous au-delà de la taille gratuite sont facturées aux soumissionnaires non-staff comme un abonnement Stripe récurrent — voir Réglages d’hébergement → Tarifs.' },
      { en: 'Every catalogue kind can require a signed ed25519 key from the downloader (key-auth). Turning it on hides the catalogue behind an access screen in BMM.', fr: 'Chaque type de catalogue peut exiger une clé ed25519 signée du téléchargeur (key-auth). L’activer masque le catalogue derrière un écran d’accès dans BMM.' },
      { en: 'A private catalogue is shared by link (?k=<shareKey>). That key is a secret — never paste it in a public channel.', fr: 'Un catalogue privé se partage par lien (?k=<shareKey>). Cette clé est un secret — ne la colle jamais dans un salon public.' },
    ],
  },
  editorial: {
    steps: [
      { en: 'Announcements: write once in EN + FR, pick the scope (site or a project), publish. Toggle “home news” to pin it on the landing.', fr: 'Annonces : rédige une fois en EN + FR, choisis la portée (site ou un projet), publie. Active « actu d’accueil » pour l’épingler sur la landing.' },
      { en: 'Newsletter: compose, choose audience (all / EN / FR / hand-picked), SEND A TEST to yourself, then send. Blog posts can auto-announce once.', fr: 'Newsletter : rédige, choisis l’audience (tous / EN / FR / sélection), ENVOIE UN TEST à toi-même, puis envoie. Les articles peuvent s’annoncer automatiquement une fois.' },
      { en: 'FAQ: entries in Markdown with categories; Reviews: approve or hide user reviews before they show on a page.', fr: 'FAQ : entrées en Markdown avec catégories ; Avis : approuve ou masque les avis d’utilisateurs avant qu’ils s’affichent.' },
      { en: 'Mail delivery: SMTP host, sender name, and the “from” address — a wrong sender lands every newsletter in spam.', fr: 'Envoi d’e-mails : hôte SMTP, nom d’expéditeur et adresse « from » — un mauvais expéditeur envoie chaque newsletter en spam.' },
    ],
    traps: [
      { en: 'Blog and docs have size + count caps (Hosting settings → Blog, docs & history) and edit history keeps the last N revisions — an edit that grows a post past the cap is refused.', fr: 'Blog et docs ont des plafonds de taille + nombre (Réglages → Blog, docs & historique) et l’historique garde les N dernières révisions — une édition qui fait dépasser le plafond est refusée.' },
      { en: 'Newsletter recipients are double-opt-in; a subscriber’s language is the one they signed up in, not the site’s current language.', fr: 'Les destinataires de la newsletter sont en double opt-in ; la langue d’un abonné est celle de son inscription, pas la langue actuelle du site.' },
    ],
  },
  badges: {
    steps: [
      { en: 'Create: name, description, icon (a lucide name, a brand slug or an uploaded image), colour, and how it is earned — manual, easter-egg, or an automatic rule.', fr: 'Créer : nom, description, icône (nom lucide, slug de marque ou image téléversée), couleur, et comment il se gagne — manuel, easter-egg, ou règle automatique.' },
      { en: 'Award manually from Accounts → user → Badges, or let the rule do it (every Nth signup, signed up before a date, matched Ko-fi donor).', fr: 'Attribue manuellement depuis Comptes → utilisateur → Badges, ou laisse la règle le faire (chaque Nième inscription, inscrit avant une date, donateur Ko-fi apparié).' },
      { en: 'Priority orders badges next to the name on profiles and in the OG share card; inactive badges stay on holders but stop being awarded.', fr: 'La priorité ordonne les badges à côté du nom sur les profils et dans la carte OG de partage ; un badge inactif reste aux détenteurs mais n’est plus attribué.' },
    ],
    traps: [
      { en: 'The Discord bot shop can SELL a badge for points (bot → Levels & economy → Shop, kind “BCWEB badge”). It awards the real UserBadge — pick the badge, or the item cannot be bought.', fr: 'La boutique du bot Discord peut VENDRE un badge contre des points (bot → Niveaux & économie → Boutique, type « Badge BCWEB »). Elle attribue le vrai UserBadge — choisis le badge, sinon l’article n’est pas achetable.' },
      { en: 'The footer easter-egg (5 clicks) grants its badge once per account; the “earn message” is what that person sees.', fr: 'L’easter-egg du pied de page (5 clics) accorde son badge une fois par compte ; le « message de gain » est ce que la personne voit.' },
    ],
  },
  repos: {
    steps: [
      { en: 'Repos: open one to see its owner, pool, size, verification state and access policy (whitelist / password / key). Verify to list it in the public index.', fr: 'Dépôts : ouvre-en un pour voir propriétaire, pool, taille, état de vérification et politique d’accès (liste blanche / mot de passe / clé). Vérifie pour le lister dans l’index public.' },
      { en: 'Pools: a purchase provisions an EMPTY pool. Assign repos/catalogs into it; merge two pools; grant a free pool from here for a partner.', fr: 'Pools : un achat provisionne un pool VIDE. Affecte-lui dépôts/catalogues ; fusionne deux pools ; accorde un pool gratuit d’ici pour un partenaire.' },
      { en: 'Ownership transfers: the receiver accepts from their dashboard; nothing moves until they do.', fr: 'Transferts de propriété : le receveur accepte depuis son tableau de bord ; rien ne bouge avant.' },
    ],
    traps: [
      { en: 'A lapse SUSPENDS (read-only) for the grace window, never deletes on day one — the owner can still download, move or renew. See Hosting settings → Hosting lifecycle.', fr: 'Une échéance SUSPEND (lecture seule) pendant le délai de grâce, ne supprime jamais le jour même — le propriétaire peut encore télécharger, déplacer ou renouveler. Voir Réglages → Cycle de vie.' },
      { en: 'Global access policy (whitelist/ban by creator id) sits ABOVE per-repo rules and is account-based via X-Creator-ID — BMM sends no extra header.', fr: 'La politique d’accès globale (liste blanche/ban par id créateur) est AU-DESSUS des règles par dépôt et s’appuie sur le compte via X-Creator-ID — BMM n’envoie aucun en-tête en plus.' },
      { en: 'Free tier: one free repo AND one free catalogue per account (a FreeTierClaim that survives unlinking the creator id). The pool caps in Hosting settings can make the free plan “sold out”.', fr: 'Offre gratuite : un dépôt ET un catalogue gratuits par compte (un FreeTierClaim qui survit au déliage de l’id créateur). Les plafonds de pool dans Réglages peuvent rendre l’offre gratuite « épuisée ».' },
    ],
  },
  plans: {
    steps: [
      { en: 'Add a plan: name, storage, upload speed, monthly price (or leave the price empty to inherit the per-GB rate from Hosting settings → Pricing).', fr: 'Ajoute une offre : nom, stockage, débit, prix mensuel (ou laisse le prix vide pour hériter du tarif au Go de Réglages → Tarifs).' },
      { en: 'Order them: the public /hosting page lists plans in this order; mark one as recommended.', fr: 'Ordonne-les : la page publique /hosting les liste dans cet ordre ; marque-en une comme recommandée.' },
      { en: 'Disable rather than delete a plan people still hold — existing subscriptions keep their terms.', fr: 'Désactive plutôt que supprimer une offre encore détenue — les abonnements existants gardent leurs conditions.' },
    ],
    traps: [
      { en: 'Repo hosting is a PREPAID term; catalogue hosting above the free size is a RECURRING Stripe subscription. Renewal and lapse behave differently for the two.', fr: 'L’hébergement de dépôt est un terme PRÉPAYÉ ; l’hébergement de catalogue au-delà du gratuit est un abonnement Stripe RÉCURRENT. Renouvellement et échéance se comportent différemment.' },
      { en: 'Payments off (Feature flags) blocks NEW checkouts only; the Stripe webhook keeps recording renewals and cancellations for the customers you already have.', fr: 'Paiements désactivés (Interrupteurs) bloque seulement les NOUVEAUX paiements ; le webhook Stripe continue d’enregistrer renouvellements et annulations des clients existants.' },
    ],
  },
  promotions: {
    steps: [
      { en: 'Codes: pick a kind (percent off / free months / free hosting GB / free pool / free boost), a code or auto-generated, limits (max uses, per user, expiry), and optionally assign it to specific accounts/e-mails/Discord ids.', fr: 'Codes : choisis un type (% de réduction / mois offerts / Go d’hébergement / pool / boost gratuits), un code ou auto-généré, des limites (usages max, par personne, expiration), et éventuellement assigne-le à des comptes/e-mails/ids Discord.' },
      { en: 'Campaigns: a time window + a badge + a banner shown site-wide; the badge is awarded to everyone who acts during the window.', fr: 'Campagnes : une fenêtre + un badge + une bannière affichée sur tout le site ; le badge est attribué à quiconque agit pendant la fenêtre.' },
      { en: 'Who redeemed: open a code to see the accounts that used it and when.', fr: 'Qui a utilisé : ouvre un code pour voir les comptes qui l’ont utilisé et quand.' },
    ],
    traps: [
      { en: 'Grant kinds (free hosting / pool / boost) are applied by the site itself and are tested. The Stripe DISCOUNT coupling is the part to check on a real charge before a launch.', fr: 'Les types d’attribution (hébergement / pool / boost gratuits) sont appliqués par le site et testés. Le couplage RÉDUCTION Stripe est la partie à vérifier sur un vrai paiement avant un lancement.' },
      { en: 'The bot shop mints single-use promo codes on purchase (pool / boost / hosting items) — they appear here, assigned to the buyer, noted “Shop purchase”.', fr: 'La boutique du bot frappe des codes promo à usage unique à l’achat (articles pool / boost / hébergement) — ils apparaissent ici, assignés à l’acheteur, notés « Shop purchase ».' },
    ],
  },
  events: {
    steps: [
      { en: 'Create an event with a start and end; pick what it changes for the window (a banner, a theme accent, a promo tie-in).', fr: 'Crée un événement avec début et fin ; choisis ce qu’il change pendant la fenêtre (une bannière, un accent de thème, un lien promo).' },
      { en: 'Preview it before the start date; outside the window it is inert, so it can be prepared weeks ahead.', fr: 'Prévisualise-le avant la date de début ; hors fenêtre il est inerte, donc il se prépare des semaines à l’avance.' },
    ],
    traps: [
      { en: 'The heavier presentation/theming engine was removed on purpose after three attempts; what remains is deliberately small. Use Promotions for a discount or a badge, Events only for a time-boxed change.', fr: 'Le moteur de présentation/habillage plus lourd a été retiré exprès après trois tentatives ; ce qui reste est volontairement petit. Utilise Promotions pour une réduction ou un badge, Événements seulement pour un changement limité dans le temps.' },
    ],
  },
  myo: {
    steps: [
      { en: 'A request arrives with a description and the paid consultation fee. Open the thread, ask questions, then send a QUOTE.', fr: 'Une demande arrive avec une description et les frais de consultation payés. Ouvre le fil, pose tes questions, puis envoie un DEVIS.' },
      { en: 'The client approves and pays the quote (second Stripe step). Only then does building start — the status moves to “in progress”.', fr: 'Le client accepte et paie le devis (second passage Stripe). Seulement alors la construction démarre — le statut passe à « en cours ».' },
      { en: 'Deliver from the builder tab (files + notes); the client downloads from their dashboard. Archive when done.', fr: 'Livre depuis l’onglet constructeur (fichiers + notes) ; le client télécharge depuis son tableau de bord. Archive une fois terminé.' },
    ],
    traps: [
      { en: 'Paid reviews are non-refundable and the client is told so before paying; a rejected paid request may still owe a refund of the FEE if you never reviewed it.', fr: 'Les revues payées ne sont pas remboursables et le client en est informé avant de payer ; une demande payante refusée peut quand même devoir le remboursement des FRAIS si tu ne l’as jamais examinée.' },
      { en: 'Unpaid requests older than the configured age auto-archive. The bot can post each new commission to a channel (Announcements → Commissions route).', fr: 'Les demandes non payées plus vieilles que l’âge configuré s’archivent seules. Le bot peut poster chaque nouvelle commande dans un salon (Annonces → route Commandes).' },
    ],
  },
  kofi: {
    steps: [
      { en: 'Copy the webhook URL and the secret token shown here into Ko-fi → Settings → Webhooks.', fr: 'Copie l’URL du webhook et le jeton secret affichés ici dans Ko-fi → Réglages → Webhooks.' },
      { en: 'Set a funding goal (amount + currency) to show the progress widget on the home page; clear it to hide the widget while totals keep accumulating.', fr: 'Fixe un objectif (montant + devise) pour afficher le widget de progression sur l’accueil ; efface-le pour masquer le widget pendant que les totaux continuent.' },
      { en: 'Turn on the bot’s Ko-fi module to thank each tip in a channel with a running total.', fr: 'Active le module Ko-fi du bot pour remercier chaque pourboire dans un salon avec le total courant.' },
    ],
    traps: [
      { en: 'A donor is matched by e-mail to a BetterCommunity account — a different e-mail on Ko-fi means no discount code and no “Ko-fi donor” badge.', fr: 'Un donateur est apparié par e-mail à un compte BetterCommunity — un e-mail différent sur Ko-fi = pas de code de réduction ni de badge « donateur Ko-fi ».' },
      { en: 'Incoming webhooks can be switched off site-wide (Feature flags) — then Ko-fi tips are refused with 503 until it is back on.', fr: 'Les webhooks entrants peuvent être coupés pour tout le site (Interrupteurs) — alors les pourboires Ko-fi sont refusés en 503 jusqu’à réactivation.' },
    ],
  },
  sso: {
    steps: [
      { en: 'Login providers (GitHub / Discord / Google): set each client id + secret in the environment, then enable “Sign in with…” in Feature flags.', fr: 'Fournisseurs de connexion (GitHub / Discord / Google) : mets chaque client id + secret dans l’environnement, puis active « Se connecter avec… » dans Interrupteurs.' },
      { en: 'Provider side: register a client app (name, redirect URIs, scopes). It gets its own id/secret to sign users in with a BetterCommunity account.', fr: 'Côté fournisseur : enregistre une appli cliente (nom, URI de redirection, portées). Elle reçoit son id/secret pour connecter des utilisateurs avec un compte BetterCommunity.' },
      { en: 'A social sign-in whose e-mail already belongs to an account is NOT linked on the spot: the person proves the account is theirs (its password, or the 6-digit code mailed to the address, 15 min) on the sign-in page, then the provider is attached. Signed-in users add providers from Profile → Security → Sign-in methods; the last method can never be unlinked.', fr: 'Une connexion sociale dont l’e-mail appartient déjà à un compte n’est PAS liée d’office : la personne prouve que le compte est à elle (son mot de passe, ou le code à 6 chiffres envoyé à l’adresse, 15 min) sur la page de connexion, puis le fournisseur est rattaché. Un utilisateur connecté ajoute des fournisseurs depuis Profil → Sécurité → Méthodes de connexion ; la dernière méthode ne peut jamais être déliée.' },
      { en: 'An account created through a provider gets a “set a password” mail (24 h link) and an in-app notification right away, so e-mail + password works from day one.', fr: 'Un compte créé via un fournisseur reçoit tout de suite un mail « définir un mot de passe » (lien 24 h) et une notification, pour que e-mail + mot de passe marche dès le premier jour.' },
      { en: 'Test with the /oauth2/authorize URL the row shows; a wrong redirect URI is the usual first failure.', fr: 'Teste avec l’URL /oauth2/authorize affichée sur la ligne ; une mauvaise URI de redirection est l’échec habituel.' },
    ],
    traps: [
      { en: 'Two different switches: “Sign in with GitHub/Discord/Google” is US using them; “Single sign-on (we are the provider)” is other apps using US. Turning one off does not touch the other.', fr: 'Deux interrupteurs différents : « Se connecter avec GitHub/Discord/Google » = NOUS qui les utilisons ; « SSO (nous sommes le fournisseur) » = d’autres applis qui NOUS utilisent. Couper l’un ne touche pas l’autre.' },
      { en: 'Password sign-in is never gated by these — so you can never lock yourself out of the admin by flipping them.', fr: 'La connexion par mot de passe n’est jamais conditionnée par ça — donc tu ne peux jamais te verrouiller hors de l’admin en les basculant.' },
    ],
  },
  api: {
    steps: [
      { en: 'A user creates keys from their dashboard (Developer). Here you see every key, its scopes, last use, and can revoke one.', fr: 'Un utilisateur crée ses clés depuis son tableau de bord (Développeur). Ici tu vois chaque clé, ses portées, sa dernière utilisation, et peux en révoquer une.' },
      { en: 'Scopes are the whole permission model: a key can only do what its scopes allow, never more than its owner.', fr: 'Les portées sont tout le modèle de permission : une clé ne peut faire que ce que ses portées autorisent, jamais plus que son propriétaire.' },
      { en: 'Point developers at /dev/tools — the endpoint reference, a request builder and webhook testers live there.', fr: 'Renvoie les développeurs vers /dev/tools — la référence des endpoints, un constructeur de requête et des testeurs de webhook y sont.' },
    ],
    traps: [
      { en: 'Keys are stored hashed and shown ONCE. A lost key is re-issued, never recovered. Revocation is instant and permanent.', fr: 'Les clés sont stockées hachées et montrées UNE fois. Une clé perdue se réémet, ne se récupère jamais. La révocation est immédiate et définitive.' },
      { en: 'Public API off (Feature flags) makes every /v1 route answer 503, read-only ones included; the website itself is unaffected.', fr: 'API publique désactivée (Interrupteurs) fait répondre 503 à toute route /v1, lecture seule incluse ; le site lui-même n’est pas touché.' },
    ],
  },
  bot: {
    steps: [
      { en: 'Overview: paste the token (bot must be OFF to change it), flip the master switch, Save. It connects within ~20 s; the header pill goes Online.', fr: 'Vue d’ensemble : colle le jeton (le bot doit être OFF pour le changer), bascule l’interrupteur principal, Enregistre. Il se connecte en ~20 s ; la pastille d’en-tête passe En ligne.' },
      { en: 'Choose the member-storage strategy (Per-server / Free / Unified) and, in Limits, the byte cap + linked-account retention rules.', fr: 'Choisis la stratégie de stockage des membres (Par serveur / Gratuit / Unifié) et, dans Limites, le plafond d’octets + les règles de rétention des comptes liés.' },
      { en: 'Announcements: give each route a channel (and an urgent-only role). Turn on Blog / Alerts / Ko-fi / Payments and point each at a channel; “Send test” proves the bot can post there.', fr: 'Annonces : donne un salon à chaque route (et un rôle « urgent » optionnel). Active Blog / Alertes / Ko-fi / Paiements et pointe chacun vers un salon ; « Envoyer un test » prouve que le bot peut y poster.' },
      { en: 'Per-server: pick a server, “Customize this server”, then set Moderation / Welcome / Join-to-create / Gated roles for it alone. Anything left untouched follows Global defaults.', fr: 'Par serveur : choisis un serveur, « Personnaliser ce serveur », puis règle Modération / Bienvenue / Vocal à la demande / Rôles gatés pour lui seul. Ce qui n’est pas touché suit les défauts globaux.' },
      { en: 'Community: rules & role panels (buttons or dropdown), giveaways, and “Message every member”.', fr: 'Communauté : règles & panneaux de rôles (boutons ou menu), giveaways, et « Message à chaque membre ».' },
    ],
    traps: [
      { en: 'A DISCORD_TOKEN in the environment wins over the dashboard token. Privileged intents (members, message content, presence) must be enabled on the Discord developer portal or the bot cannot connect.', fr: 'Un DISCORD_TOKEN dans l’environnement l’emporte sur le jeton du tableau de bord. Les intents privilégiés (membres, contenu des messages, présence) doivent être activés sur le portail développeur Discord sinon le bot ne se connecte pas.' },
      { en: '“Reconnect bot” only re-opens the Discord connection. It does NOT deploy new code — that is a container restart.', fr: '« Reconnecter » ne fait que rouvrir la connexion Discord. Ça ne déploie PAS de nouveau code — c’est un redémarrage de conteneur.' },
      { en: 'Limits → “Never purge linked members” keeps every linked person when the cap is hit (anonymous rows go first); “If purged anyway, unlink” makes sure nobody looks linked to a record that no longer exists; “Force re-link every N days” expires stale links.', fr: 'Limites → « Ne jamais purger les membres liés » garde chaque personne liée quand le plafond est atteint (les lignes anonymes partent d’abord) ; « Si purgé quand même, délier » évite qu’on paraisse lié à une fiche disparue ; « Forcer une reliaison tous les N jours » périme les liens anciens.' },
      { en: 'Storage → “Require a paid pool to store members” OFF lets every server store members for free while keeping per-server byte budgets.', fr: 'Stockage → « Exiger une pool payante » OFF laisse chaque serveur stocker ses membres gratuitement en gardant les budgets d’octets par serveur.' },
      { en: 'Users manage their OWN servers from Dashboard → Discord servers (owner or Manage Server on the guild, proven by the bot’s heartbeat). Their storage pool stays admin-assigned — they cannot self-grant capacity.', fr: 'Les utilisateurs gèrent LEURS serveurs depuis Tableau de bord → Serveurs Discord (propriétaire ou Gérer le serveur, prouvé par le heartbeat du bot). Leur pool de stockage reste attribuée par un admin — ils ne peuvent pas s’auto-accorder de capacité.' },
    ],
  },
  economy: {
    steps: [
      { en: 'Turn the Economy card on. Name the currency and give it an emoji (a Discord custom emoji <:name:id> or a unicode one) or a fallback image.', fr: 'Active la carte Économie. Nomme la devise et donne-lui un emoji (emoji Discord personnalisé <:nom:id> ou unicode) ou une image de repli.' },
      { en: 'Set XP rates (per message / reaction / voice minute) and the level curve; the live “Lv 1 / 5 / 10 / 25 / 50” preview shows how hard each level is before you save.', fr: 'Fixe les taux d’XP (par message / réaction / minute vocale) et la courbe de niveaux ; l’aperçu « Nv 1 / 5 / 10 / 25 / 50 » montre la difficulté de chaque niveau avant enregistrement.' },
      { en: 'Points: how many levels between grants and how many points per grant. This is the only faucet — the shop and casino only move points around.', fr: 'Points : combien de niveaux entre deux dons et combien de points par don. C’est le seul robinet — la boutique et le casino ne font que déplacer des points.' },
      { en: 'Casino: min/max bet and house edge; the payout preview prices each game so you see who wins long term. Shop: add items — BCWEB badge, storage pool, catalog boost, hosting, Discord role, promo code, or a custom reward.', fr: 'Casino : mise min/max et avantage maison ; l’aperçu des gains chiffre chaque jeu pour voir qui gagne sur la durée. Boutique : ajoute des articles — badge BCWEB, pool de stockage, boost de catalogue, hébergement, rôle Discord, code promo, ou récompense personnalisée.' },
      { en: 'Balances & leaderboard: search a member, give or take points with a reason (audited).', fr: 'Soldes & classement : cherche un membre, donne ou retire des points avec une raison (journalisé).' },
    ],
    traps: [
      { en: 'XP only accrues for members who LINKED a BetterCommunity account. Unlinked members earn nothing until they run /link.', fr: 'L’XP ne s’accumule que pour les membres ayant LIÉ un compte BetterCommunity. Les non-liés ne gagnent rien avant d’avoir lancé /link.' },
      { en: 'Badge / pool / boost / hosting shop items are fulfilled BY THE SITE before the points are taken — a badge is awarded directly; a pool/boost/hosting item mints a single-use promo code the buyer redeems. A failed grant never charges.', fr: 'Les articles badge / pool / boost / hébergement sont honorés PAR LE SITE avant le débit — un badge est attribué directement ; un pool/boost/hébergement frappe un code promo à usage unique que l’acheteur utilise. Un échec ne débite jamais.' },
      { en: 'Slots pay 104% before the edge (8× three-of-a-kind, 1.5× a pair). At a low house edge it is player-favourable — read the payout preview before setting 1–3%.', fr: 'La machine à sous rend 104 % avant l’avantage (8× triple, 1,5× paire). Avec un avantage faible elle favorise les joueurs — lis l’aperçu des gains avant de mettre 1–3 %.' },
      { en: 'Levels are always public (profile, OG card, /profile); the message/reaction/voice counts follow each member’s own “stats public” toggle.', fr: 'Les niveaux sont toujours publics (profil, carte OG, /profile) ; les compteurs messages/réactions/vocal suivent le réglage « stats publiques » de chaque membre.' },
    ],
  },
  serverperf: {
    steps: [
      { en: 'Performance: live CPU / RAM / disk / service probes per host, with thresholds you set; a breach becomes an alert (and a Discord post if the Alerts module is on).', fr: 'Performance : sondes CPU / RAM / disque / services en direct par hôte, avec des seuils que tu fixes ; un dépassement devient une alerte (et un message Discord si le module Alertes est actif).' },
      { en: 'Storage: what hosted content, uploads, analytics/replays and the bot’s member database each consume against the caps in Hosting settings.', fr: 'Stockage : ce que consomment le contenu hébergé, les uploads, analytics/replays et la base de membres du bot par rapport aux plafonds des Réglages.' },
      { en: 'Status page: incidents the probes recorded appear here — write the human account (what broke, what you did) so the public status page tells the story.', fr: 'Page Statut : les incidents enregistrés par les sondes apparaissent ici — rédige le récit humain (ce qui a cassé, ce que tu as fait) pour que la page publique raconte l’histoire.' },
      { en: 'Advanced: graceful restart, dependency versions, and the elevated actions that need a fresh 2FA code.', fr: 'Avancé : redémarrage propre, versions des dépendances, et les actions élevées qui exigent un code 2FA frais.' },
    ],
    traps: [
      { en: 'Acknowledging an alert is what turns the log into a queue — the tab badge counts unacknowledged alerts, not all of them.', fr: 'Acquitter une alerte est ce qui transforme le journal en file — la pastille de l’onglet compte les alertes non acquittées, pas toutes.' },
      { en: 'The API host port moves on every compose restart (3000–3009). If every page renders its offline fallback in dev, that is the proxy pointing at the old port, not broken code.', fr: 'Le port hôte de l’API bouge à chaque redémarrage compose (3000–3009). Si chaque page affiche son repli hors-ligne en dev, c’est le proxy qui vise l’ancien port, pas du code cassé.' },
    ],
  },
  analytics: {
    steps: [
      { en: 'Traffic: pageviews, sessions, OS/browser split, geo (region/city + flag map), Web Vitals and sparklines — all first-party, no third-party script.', fr: 'Trafic : pages vues, sessions, répartition OS/navigateur, géo (région/ville + carte à drapeaux), Web Vitals et sparklines — tout en première partie, sans script tiers.' },
      { en: 'Goals: define a conversion (a route, a click event) and watch its funnel.', fr: 'Objectifs : définis une conversion (une route, un événement de clic) et suis son entonnoir.' },
      { en: 'Replays: session recordings, with a size cap and retention (Hosting settings → Capacity → Analytics & replay storage cap). Errors: client-side exceptions with stack + route.', fr: 'Replays : enregistrements de session, avec plafond de taille et rétention (Réglages → Capacité → plafond Analytics & replays). Erreurs : exceptions côté client avec pile + route.' },
    ],
    traps: [
      { en: 'Loopback IPs (dev) produce empty geo — not a bug. The Google Tag (if enabled) still loads only after the visitor accepts the Analytics cookie category.', fr: 'Les IP loopback (dev) donnent une géo vide — ce n’est pas un bug. Le Google Tag (si activé) ne se charge qu’après acceptation de la catégorie de cookies Analytics.' },
      { en: 'Error events are readable with manage_analytics, which grants NO access to private repos — so raw request URLs (with ?k= share secrets) must never be logged.', fr: 'Les événements d’erreur sont lisibles avec manage_analytics, qui ne donne AUCUN accès aux dépôts privés — donc les URL brutes (avec secrets ?k=) ne doivent jamais être journalisées.' },
    ],
  },
  settings: {
    steps: [
      { en: 'Undo window: on = deferred saves (blog, docs, nav, theme) commit after a grace period with an Undo toast; off = they commit immediately.', fr: 'Fenêtre d’annulation : activée = les enregistrements différés (blog, docs, nav, thème) s’appliquent après un délai avec un toast Annuler ; désactivée = ils s’appliquent immédiatement.' },
      { en: 'Translucent surfaces: the site-wide glass look. Popups stay opaque regardless so text never sits over a card behind it.', fr: 'Surfaces translucides : le rendu verre de tout le site. Les popups restent opaques quoi qu’il arrive pour que le texte ne soit jamais sur une carte derrière.' },
      { en: 'Anti-abuse: proof-of-work on forms, rate limits, and the edge (Caddy) anti-bot rules — tune when something is hammering the site.', fr: 'Anti-abus : preuve de travail sur les formulaires, limites de débit, et règles anti-bot du bord (Caddy) — ajuste quand quelque chose martèle le site.' },
      { en: 'Runtime locales: add a language (RTL included) and translate it in the i18n editor; missing keys fall back to English.', fr: 'Langues d’exécution : ajoute une langue (RTL inclus) et traduis-la dans l’éditeur i18n ; les clés manquantes retombent sur l’anglais.' },
    ],
    traps: [
      { en: 'Capacity, retention and pricing caps are NOT here — they live in Hosting settings, one screen for every cap.', fr: 'Capacité, rétention et tarifs ne sont PAS ici — ils sont dans Réglages d’hébergement, un seul écran pour tous les plafonds.' },
    ],
  },
  navui: {
    steps: [
      { en: 'Menu: add links and dropdown groups, each with EN/FR labels and an icon; drag to reorder; fold an item to its header when you are not editing it. Start from the built-in navigation if the list is empty.', fr: 'Menu : ajoute liens et groupes déroulants, chacun avec libellés EN/FR et icône ; glisse pour réordonner ; replie un item sur son en-tête quand tu ne l’édites pas. Pars de la navigation intégrée si la liste est vide.' },
      { en: 'Buttons: show/hide and reorder the built-in topbar utilities (search, language, theme, notifications, account).', fr: 'Boutons : affiche/masque et réordonne les utilitaires intégrés de la barre (recherche, langue, thème, notifications, compte).' },
      { en: 'Layout: alignment, density, labels (icon / text / both), and the mobile bottom bar — on/off, display mode, up to five custom buttons.', fr: 'Mise en page : alignement, densité, libellés (icône / texte / les deux), et la barre du bas mobile — on/off, mode d’affichage, jusqu’à cinq boutons personnalisés.' },
      { en: 'Footer: load the built-in footer, edit its columns/links/brand/bottom row, Save. “Back to built-in” discards the custom one and follows future built-in changes.', fr: 'Pied de page : charge le pied intégré, édite colonnes/liens/marque/ligne du bas, Enregistre. « Revenir à l’intégré » abandonne le personnalisé et suit les futures évolutions.' },
      { en: 'Home page: per-section on/off and wording (EN/FR), the products grid, pinned poll, custom Markdown sections, and a live preview.', fr: 'Page d’accueil : par section on/off et textes (EN/FR), la grille produits, le sondage épinglé, des sections Markdown personnalisées, et un aperçu en direct.' },
    ],
    traps: [
      { en: 'Pinned showcase projects show in the topbar inline or as one “Projects” dropdown — the preview here renders them exactly as the live bar will.', fr: 'Les projets épinglés apparaissent dans la barre en ligne ou dans un seul menu « Projets » — l’aperçu ici les rend exactement comme la vraie barre.' },
      { en: 'An empty dropdown group is dropped on save; a link must start with /.', fr: 'Un groupe déroulant vide est supprimé à l’enregistrement ; un lien doit commencer par /.' },
    ],
  },
  sitetheme: {
    steps: [
      { en: 'Pick a preset or set the accent pair (light + dark); everything else derives from it.', fr: 'Choisis un preset ou fixe la paire d’accent (clair + sombre) ; tout le reste en dérive.' },
      { en: 'Fine-tune per-mode page colours and the token catalogue; the glow-geometry editor shapes the hero backdrop.', fr: 'Affine les couleurs de page par mode et le catalogue de tokens ; l’éditeur de géométrie des halos façonne l’arrière-plan du hero.' },
      { en: 'Watch the live preview, Apply, and export the whole look as a file you can re-import later or on another install.', fr: 'Regarde l’aperçu en direct, Applique, et exporte tout le thème en fichier réimportable plus tard ou sur une autre installation.' },
    ],
    traps: [
      { en: 'Picking a preset CLEARS your token overrides (undoably) so the preset renders as designed. Apply writes immediately; Undo is a second real write.', fr: 'Choisir un preset EFFACE tes surcharges de tokens (annulable) pour que le preset s’affiche comme prévu. Appliquer écrit immédiatement ; Annuler est une seconde vraie écriture.' },
      { en: 'SUPERADMIN only — an ADMIN sees the screen read-only.', fr: 'SUPERADMIN uniquement — un ADMIN voit l’écran en lecture seule.' },
    ],
  },
  hostingsettings: {
    steps: [
      { en: 'Each group folds — open only the one you came to change. Every control has a Save of its own; nothing else on the screen is touched.', fr: 'Chaque groupe se replie — ouvre seulement celui que tu viens changer. Chaque contrôle a son propre Enregistrer ; rien d’autre n’est touché.' },
      { en: 'Sizes accept MB / GB / TB in the unit picker — the stored value stays in its native unit.', fr: 'Les tailles acceptent Mo / Go / To dans le sélecteur d’unité — la valeur stockée reste dans son unité native.' },
      { en: 'Link previews: pick a platform once (Discord / X / Facebook / Google) and both the whole-site card and every per-page override render in it; add an override by page type or custom path.', fr: 'Aperçus de liens : choisis une plateforme une fois (Discord / X / Facebook / Google) et la carte du site entier comme chaque surcharge par page s’y affichent ; ajoute une surcharge par type de page ou chemin.' },
    ],
    traps: [
      { en: 'Total capacity can never exceed the machine’s real free disk (shown under the field). Free-tier pool caps make the free plan “sold out” — paid plans never count against them.', fr: 'La capacité totale ne peut jamais dépasser l’espace disque réel (affiché sous le champ). Les plafonds de pool gratuite rendent l’offre gratuite « épuisée » — les offres payantes n’y comptent jamais.' },
      { en: 'The full text of every control is in the reference just below — the cards on the Hosting screen show two lines and link here.', fr: 'Le texte complet de chaque contrôle est dans la référence juste en dessous — les cartes de l’écran Hébergement affichent deux lignes et renvoient ici.' },
    ],
  },
};

// Every other screen: its sections and controls, from lib/admin-screens-ref.js.
function ScreenReference({ sections }) {
  const { t, lang } = useI18n();
  const L = (o) => (lang === 'fr' ? (o?.fr || o?.en || '') : (o?.en || o?.fr || ''));
  if (!sections?.length) return null;
  return (
    <div className="mt-5 pt-4 border-t border-[var(--line)]">
      <div className="text-[13px] font-bold mb-1">{t('ag.screen.ref', 'On this screen')}</div>
      <p className="text-[12px] text-[var(--muted)] mb-3">{t('ag.screen.refsub', 'Section by section: what each control does, and what it does not.')}</p>
      <div className="space-y-2">
        {sections.map((m) => (
          <div key={m.id} className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)]/30 p-3">
            <div className="text-[13px] font-semibold text-[var(--text)]">{L(m.name)}</div>
            <p className="text-[12.5px] text-[var(--muted)] leading-relaxed mt-0.5">{L(m.what)}</p>
            {m.controls.length > 0 && (
              <ul className="mt-2 space-y-1.5">
                {m.controls.map((ctl, i) => (
                  <li key={i} className="text-[12px] leading-relaxed"><b className="text-[var(--text)]">{L(ctl.label)}</b> <span className="text-[var(--muted)]">— {L(ctl.what)}</span></li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// The Discord bot dashboard, page by page, module by module, control by control — the same
// idea as the hosting reference: the screens keep their controls terse, THIS is the manual.
function BotDashboardReference({ only }) {
  const { t, lang } = useI18n();
  const L = (o) => (lang === 'fr' ? (o?.fr || o?.en || '') : (o?.en || o?.fr || ''));
  const pages = only ? BOT_DASHBOARD_REF.filter((p) => only.includes(p.id)) : BOT_DASHBOARD_REF;
  return (
    <div className="mt-5 pt-4 border-t border-[var(--line)]">
      <div className="text-[13px] font-bold mb-1">{t('ag.bot.ref', 'Every page of the bot dashboard, in full')}</div>
      <p className="text-[12px] text-[var(--muted)] mb-4">{t('ag.bot.refsub', 'Page by page, module by module: what each control does and what it does not.')}</p>
      <div className="space-y-5">
        {pages.map((pg) => (
          <div key={pg.id}>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[#5865F2] mb-2">{L(pg.page)}</div>
            <div className="space-y-2">
              {pg.modules.map((m) => (
                <div key={m.id} className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)]/30 p-3">
                  <div className="text-[13px] font-semibold text-[var(--text)]">{L(m.name)}</div>
                  <p className="text-[12.5px] text-[var(--muted)] leading-relaxed mt-0.5">{L(m.what)}</p>
                  {m.controls.length > 0 && (
                    <ul className="mt-2 space-y-1.5">
                      {m.controls.map((ctl, i) => (
                        <li key={i} className="text-[12px] leading-relaxed"><b className="text-[var(--text)]">{L(ctl.label)}</b> <span className="text-[var(--muted)]">— {L(ctl.what)}</span></li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// The complete hosting-settings reference — every group, every control, spelled out in full
// from the SAME catalog the live screen renders (lib/hosting-settings.js), so it is complete
// by construction and can't fall behind the controls. A "Learn more →" carries the setting key
// (?k=), which scrolls this list to that control and rings it.
const HS_KIND_LABEL = { gbmb: 'size', number: 'number', bool: 'on / off', text: 'text' };
function HostingSettingsReference({ highlight }) {
  const { t } = useI18n();
  const ref = useRef(null);
  useEffect(() => {
    if (!highlight) return;
    const el = document.getElementById(`hs-${highlight}`);
    if (el) { const id = setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), 120); return () => clearTimeout(id); }
  }, [highlight]);
  return (
    <div ref={ref} className="mt-5 pt-4 border-t border-[var(--line)]">
      <div className="text-[13px] font-bold mb-1">{t('ag.hs.ref', 'Every hosting setting, in full')}</div>
      <p className="text-[12px] text-[var(--muted)] mb-4">{t('ag.hs.refsub', 'One entry per control on the Hosting screen — the same text the “Learn more” links point at, never truncated.')}</p>
      <div className="space-y-5">
        {HOSTING_SETTINGS_GROUPS.map((g) => (
          <div key={g.gk}>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--primary-2)] mb-1">{t(`hs.g.${g.gk}`, g.title)}</div>
            <div className="text-[11.5px] text-[var(--faint)] mb-2.5 leading-snug">{t(`hs.gd.${g.gk}`, HOSTING_GROUP_DESC[g.title] || '')}</div>
            <div className="space-y-2">
              {g.keys.map(([key, label, desc, kind]) => {
                const on = highlight === key;
                return (
                  <div key={key} id={`hs-${key}`}
                    className={`rounded-lg border p-3 transition ${on ? 'border-[var(--primary)] bg-[var(--primary)]/5 ring-2 ring-[var(--primary)]/30' : 'border-[var(--line)] bg-[var(--surface-2)]/30'}`}>
                    <div className="flex items-baseline gap-2 flex-wrap mb-1">
                      <span className="text-[13px] font-semibold text-[var(--text)]">{t(`hs.l.${key}`, label)}</span>
                      <span className="text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-[var(--surface-3,var(--line))] text-[var(--faint)]">{HS_KIND_LABEL[kind] || kind}</span>
                      <code className="text-[10px] text-[var(--faint)] ms-auto">{key}</code>
                    </div>
                    <p className="text-[12.5px] text-[var(--muted)] leading-relaxed">{t(`hs.d.${key}`, desc)}</p>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AdminGuide() {
  const { t, lang } = useI18n();
  const { user } = useAuth();
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(false);
  const [custom, setCustom] = useState(null); // admin-authored Markdown sections
  const [overrides, setOverrides] = useState({}); // edits on the built-in entries (guide.overrides)
  const [active, setActive] = useState(null);  // the entry shown in the reading pane (docs layout)
  const [sp] = useSearchParams();
  const deep = sp.get('g'); // a "Learn more →" link deep-links to one entry by id
  const kParam = sp.get('k'); // …and may name the exact setting it came from, to highlight it
  const paneRef = useRef(null);
  const L = (o) => (lang === 'fr' ? (o?.fr || o?.en || '') : (o?.en || o?.fr || ''));
  // Only ADMIN/SUPERADMIN reach this screen, but the Edit affordance is theirs specifically.
  const canEdit = !!user && (user.role === 'ADMIN' || user.role === 'SUPERADMIN');

  useEffect(() => {
    api.get('/admin/settings')
      .then((d) => {
        setCustom(Array.isArray(d?.settings?.['guide.custom']) ? d.settings['guide.custom'] : []);
        const ov = d?.settings?.['guide.overrides'];
        setOverrides(ov && typeof ov === 'object' && !Array.isArray(ov) ? ov : {});
      })
      .catch(() => setCustom([]));
  }, []);

  // Deep link: a "Learn more →" from another screen arrives as ?g=<entry id>. Open that entry
  // and scroll it into view (the timeout lets the accordion paint first). Highlighted below.
  // A "Learn more →" deep link (?g=<id>) selects that entry in the reading pane.
  useEffect(() => { if (deep) setActive(deep); }, [deep]);
  // On a deep link, bring the reading pane into view (the index can be tall on desktop, and on
  // phones the page sits below the chip rail). Timeout lets the pane paint first.
  useEffect(() => {
    if (!deep && !kParam) return;
    const id = setTimeout(() => paneRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
    return () => clearTimeout(id);
  }, [deep, kParam]);

  // Custom sections join the built-in guide as one more group at the end, so a search and the
  // expand-all control cover them too. Each carries Markdown bodies rendered by <Markdown>.
  const merged = useMemo(() => {
    // A built-in entry with an override: the admin's title / body replace the built-in ones
    // per language (an empty language keeps the original), `extra` is a B.MD section rendered
    // under it, `hidden` drops the entry from the index. The built-in text is never lost —
    // "Reset" in the editor is one click.
    const mergeLoc = (base, over) => ({ en: (over?.en || '').trim() || base?.en || '', fr: (over?.fr || '').trim() || base?.fr || '' });
    const base = GUIDE.map((g) => ({
      ...g,
      items: g.items
        .filter((it) => !overrides[it.id]?.hidden)
        .map((it) => {
          const o = overrides[it.id];
          if (!o) return { ...it, kind: 'builtin' };
          return { ...it, kind: 'builtin', title: mergeLoc(it.title, o.title), body: mergeLoc(it.body, o.body), bodyIsMd: !!((o.body?.en || '').trim() || (o.body?.fr || '').trim()), extra: o.extra || null, hideMore: !!o.hideMore, edited: true };
        }),
    })).filter((g) => g.items.length);
    if (custom && custom.length) {
      base.push({
        heading: { en: 'Added by your team', fr: 'Ajouté par ton équipe' },
        items: custom.map((c) => ({ ...c, icon: iconOf(c.icon), kind: 'custom' })),
      });
    }
    return base;
  }, [custom, overrides]);

  const query = q.trim().toLowerCase();
  const groups = useMemo(() => {
    if (!query) return merged;
    return merged.map((g) => ({
      ...g,
      items: g.items.filter((it) => {
        const pts = it.kind === 'custom' ? '' : it.points.map((p) => p.en + ' ' + p.fr).join(' ');
        const bodies = it.kind === 'custom' ? `${it.body?.en || ''} ${it.body?.fr || ''}` : `${it.body.en} ${it.body.fr} ${it.extra?.en || ''} ${it.extra?.fr || ''}`;
        const hay = `${it.title.en} ${it.title.fr} ${bodies} ${pts}`.toLowerCase();
        return hay.includes(query);
      }),
    })).filter((g) => g.items.length);
  }, [query, merged]);

  // Flat list of every visible entry (for the reading pane + resolving the active one).
  const flat = useMemo(() => groups.flatMap((g) => g.items.map((it) => ({ ...it, _heading: g.heading }))), [groups]);
  const activeItem = flat.find((it) => it.id === active) || flat[0] || null;

  if (editing) return <GuideEditor initial={custom || []} overrides={overrides} onClose={() => setEditing(false)} onSaved={(v, ov) => { setCustom(v); setOverrides(ov); setEditing(false); }} />;

  return (
    <div>
      <div className="flex items-start gap-3 flex-wrap mb-1">
        <h2 className="font-semibold flex items-center gap-2 flex-1"><BookOpen size={16} className="text-[var(--primary-2)]" /> {t('ag.title', 'Admin guide')}</h2>
        {canEdit && <Button size="sm" variant="ghost" onClick={() => setEditing(true)}><Pencil size={13} /> {t('ag.edit', 'Edit guide')}</Button>}
      </div>
      <p className="text-sm text-[var(--muted)] mb-4">{t('ag.sub', 'What every admin screen does, who sees the result, and the traps worth knowing — grouped like the sidebar.')}</p>

      {/* A docs layout, not an FAQ: a section index on the left, one page open on the right.
          On mobile the index becomes a scrolling strip above the page. */}
      <div className="lg:grid lg:grid-cols-[250px_minmax(0,1fr)] lg:gap-6 lg:items-start">
        <div className="lg:sticky lg:top-4 mb-4 lg:mb-0">
          <div className="relative mb-3">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--faint)]" />
            <Input className="!ps-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('ag.search', 'Search the guide…')} />
          </div>
          {/* The index. A horizontal chip rail on phones, a vertical list on desktop. */}
          <nav className="flex lg:flex-col gap-1 overflow-x-auto lg:overflow-visible no-scrollbar lg:max-h-[70vh] lg:overflow-y-auto pb-1 lg:pb-0 lg:pe-1">
            {groups.length === 0 && <span className="text-xs text-[var(--faint)] px-1">{t('ag.none', 'Nothing matches that.')}</span>}
            {groups.map((g) => (
              <div key={g.heading.en} className="shrink-0 lg:shrink lg:mb-1">
                <div className="hidden lg:block text-[10px] font-semibold uppercase tracking-wider text-[var(--faint)] px-2 mt-2 mb-1">{L(g.heading)}</div>
                <div className="flex lg:flex-col gap-1">
                  {g.items.map((it) => {
                    const on = activeItem?.id === it.id;
                    const Icon = it.icon;
                    return (
                      <button key={it.id} type="button" onClick={() => setActive(it.id)}
                        className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-start whitespace-nowrap lg:whitespace-normal shrink-0 transition text-[13px] ${on ? 'bg-[var(--primary)]/10 text-[var(--text)] font-medium' : 'text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]/60'}`}>
                        <Icon size={14} className={`shrink-0 ${on ? 'text-[var(--primary-2)]' : 'text-[var(--faint)]'}`} />
                        <span className="truncate">{L(it.title)}</span>
                        {it.kind === 'custom' && <span className="hidden lg:inline text-[9px] px-1 py-0.5 rounded-full bg-[var(--primary)]/10 text-[var(--primary-2)] ms-auto">{t('ag.customtag', 'custom')}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>
        </div>

        {/* The reading pane — one entry, fully open, like a docs page. */}
        <div className="min-w-0" ref={paneRef}>
          {!activeItem ? (
            <Card className="p-6 text-sm text-[var(--muted)]">{t('ag.none', 'Nothing matches that.')}</Card>
          ) : (
            <Card className="p-5 lg:p-6">
              <div className="flex items-start gap-3 mb-3 pb-3 border-b border-[var(--line)]">
                <span className="grid place-items-center w-11 h-11 rounded-xl bg-[var(--surface-2)] text-[var(--primary-2)] shrink-0">{(() => { const I = activeItem.icon; return <I size={20} />; })()}</span>
                <div className="min-w-0">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--faint)]">{L(activeItem._heading)}</div>
                  <h3 className="text-lg font-bold leading-tight flex items-center gap-2 flex-wrap">{L(activeItem.title)}
                    {activeItem.kind === 'custom' && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--primary)]/10 text-[var(--primary-2)] font-medium">{t('ag.customtag', 'custom')}</span>}
                  </h3>
                </div>
              </div>
              {/* Arrived from a specific "Learn more →" on a settings card: name the exact
                  control the admin came from, so the guide answers the question they clicked
                  with, not just the section it lives in. */}
              {kParam && activeItem.id === deep && (
                <div className="mb-3 rounded-lg border border-[var(--primary)]/40 bg-[var(--primary)]/5 px-3 py-2 flex items-center gap-2 animate-[pulse_1.2s_ease-in-out_2]">
                  <Info size={14} className="text-[var(--primary-2)] shrink-0" />
                  <span className="text-[13px] text-[var(--muted)]">{t('ag.jumpfrom', 'You opened this from the')} <b className="text-[var(--text)]">{kParam}</b> {t('ag.jumpfrom2', 'setting.')}</span>
                </div>
              )}
              {activeItem.kind === 'builtin' && (
                <>
                  {activeItem.bodyIsMd
                    ? <div className="text-sm text-[var(--muted)] leading-relaxed mb-3 break-words"><Markdown>{L(activeItem.body) || '*—*'}</Markdown></div>
                    : <p className="text-sm text-[var(--muted)] leading-relaxed mb-3">{L(activeItem.body)}</p>}
                  {activeItem.points.length > 0 && (
                    <ul className="space-y-2">
                      {activeItem.points.map((p, i) => (
                        <li key={i} className="text-[13.5px] text-[var(--muted)] leading-relaxed list-disc ms-5 marker:text-[var(--primary-2)]">{L(p)}</li>
                      ))}
                    </ul>
                  )}
                  {/* Depth: a numbered how-to and the rules/traps for this screen. */}
                  {GUIDE_MORE[activeItem.id] && !activeItem.hideMore && (
                    <div className="grid md:grid-cols-2 gap-4 mt-5 pt-4 border-t border-[var(--line)]">
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--primary-2)] mb-2">{t('ag.steps', 'Step by step')}</div>
                        <ol className="space-y-2">
                          {GUIDE_MORE[activeItem.id].steps.map((s, i) => (
                            <li key={i} className="flex gap-2.5 text-[13px] text-[var(--muted)] leading-relaxed">
                              <span className="grid place-items-center w-5 h-5 rounded shrink-0 mt-0.5 bg-[var(--primary)]/10 text-[var(--primary-2)] text-[10px] font-bold">{i + 1}</span>
                              <span>{L(s)}</span>
                            </li>
                          ))}
                        </ol>
                      </div>
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-wider text-warning mb-2">{t('ag.traps', 'Rules & traps')}</div>
                        <ul className="space-y-2">
                          {GUIDE_MORE[activeItem.id].traps.map((p, i) => (
                            <li key={i} className="flex gap-2.5 text-[13px] text-[var(--muted)] leading-relaxed">
                              <AlertTriangle size={13} className="text-warning shrink-0 mt-1" />
                              <span>{L(p)}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}
                  {/* The hosting screen keeps its cards terse and links here; THIS is where every
                      setting is spelled out in full — one entry per control, nothing clamped. */}
                  {activeItem.id === 'hostingsettings' && <HostingSettingsReference highlight={kParam} />}
                  {activeItem.id === 'bot' && <BotDashboardReference />}
                  {activeItem.id === 'economy' && <BotDashboardReference only={['economy', 'members']} />}
                  {ADMIN_SCREENS_REF[activeItem.id] && <ScreenReference sections={ADMIN_SCREENS_REF[activeItem.id]} />}
                  {/* What the team added under the built-in text — B.MD, so a callout, a
                      checklist or a table of the house rules reads like the rest of the site. */}
                  {activeItem.extra && (L(activeItem.extra) || '').trim() && (
                    <div className="mt-5 pt-4 border-t border-[var(--line)]">
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--primary-2)] mb-2">{t('ag.extra', 'Added by your team')}</div>
                      <div className="text-sm text-[var(--muted)] leading-relaxed break-words"><Markdown>{L(activeItem.extra)}</Markdown></div>
                    </div>
                  )}
                </>
              )}
              {activeItem.kind === 'custom' && (
                <div className="prose-sm max-w-none text-sm text-[var(--muted)] leading-relaxed break-words">
                  <Markdown>{L(activeItem.body) || '*—*'}</Markdown>
                </div>
              )}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

// The editor for custom Markdown sections. Kept in this file (next to what it edits) and only
// reachable by an ADMIN. Bilingual title + body per section, reorderable, saved as one blob to
// AdminSetting 'guide.custom' — the same list the guide reads and the API validates.
function GuideEditor({ initial, overrides: initialOverrides, onClose, onSaved }) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const [rows, setRows] = useState(() => initial.map((r) => ({ ...r })));
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState('en');
  // Which half is being edited: the built-in entries (retitle, rewrite, add a B.MD section,
  // hide) or the team's own sections. Both save together.
  const [part, setPart] = useState('builtin');
  const [ov, setOv] = useState(() => ({ ...(initialOverrides || {}) }));
  const [sel, setSel] = useState(() => GUIDE[0]?.items?.[0]?.id || null);
  const [bq, setBq] = useState('');
  const L = (o) => (lang === 'fr' ? (o?.fr || o?.en || '') : (o?.en || o?.fr || ''));
  const entries = useMemo(() => GUIDE.flatMap((g) => g.items.map((it) => ({ ...it, heading: g.heading }))), []);
  const bqn = bq.trim().toLowerCase();
  const shown = entries.filter((it) => !bqn || `${it.title.en} ${it.title.fr}`.toLowerCase().includes(bqn));
  const cur = entries.find((it) => it.id === sel) || null;
  const curOv = (sel && ov[sel]) || {};
  const setOvField = (field, patch) => setOv((o) => ({ ...o, [sel]: { ...(o[sel] || {}), [field]: { ...((o[sel] || {})[field] || {}), ...patch } } }));
  const setOvFlag = (k, v) => setOv((o) => ({ ...o, [sel]: { ...(o[sel] || {}), [k]: v } }));
  const resetOv = () => setOv((o) => { const n = { ...o }; delete n[sel]; return n; });
  const isEdited = (id) => { const o = ov[id]; return !!(o && (o.hidden || o.hideMore || ['title', 'body', 'extra'].some((k) => (o[k]?.en || o[k]?.fr || '').trim()))); };
  // "Edit what is there" rather than "write it again": the built-in paragraph is copied into
  // the field, and the built-in steps and traps can be pulled in as B.MD under it — in which
  // case the built-in ones are hidden, so nothing shows twice.
  const startFromBody = () => setOvField('body', { [tab]: cur.body[tab] || cur.body.en || '' });
  const pullMore = () => {
    const more = GUIDE_MORE[cur.id]; if (!more) return;
    const pick = (o) => (tab === 'fr' ? (o.fr || o.en || '') : (o.en || o.fr || ''));
    const steps = (more.steps || []).map((st, i) => `:::step[${i + 1}]\n${pick(st)}\n:::`).join('\n');
    const traps = (more.traps || []).map((tr) => `- ${pick(tr)}`).join('\n');
    const md = [
      steps ? `::::steps[${tab === 'fr' ? 'Pas à pas' : 'Step by step'}]\n${steps}\n::::` : '',
      traps ? `:::warning[${tab === 'fr' ? 'Règles & pièges' : 'Rules & traps'}]\n${traps}\n:::` : '',
    ].filter(Boolean).join('\n\n');
    const curExtra = ((curOv.extra || {})[tab] || '').trim();
    setOvField('extra', { [tab]: curExtra ? `${curExtra}\n\n${md}` : md });
    setOvFlag('hideMore', true);
  };
  const editedCount = entries.filter((it) => isEdited(it.id)).length;

  const set = (i, patch) => setRows(rows.map((r, n) => (n === i ? { ...r, ...patch } : r)));
  const setLoc = (i, field, locpatch) => set(i, { [field]: { ...(rows[i][field] || {}), ...locpatch } });
  const move = (i, d) => { const j = i + d; if (j < 0 || j >= rows.length) return; const n = [...rows]; [n[i], n[j]] = [n[j], n[i]]; setRows(n); };
  const add = () => setRows([...rows, { id: `sec-${Date.now().toString(36)}`, icon: 'FileText', heading: { en: 'Added by your team', fr: 'Ajouté par ton équipe' }, title: { en: '', fr: '' }, body: { en: '', fr: '' } }]);

  const save = async () => {
    // A section with no title is noise in the guide; drop empties rather than store them.
    const clean = rows
      .map((r) => ({ id: String(r.id || `sec-${Math.random().toString(36).slice(2)}`).slice(0, 60), icon: r.icon || 'FileText', heading: r.heading || { en: '', fr: '' }, title: r.title || { en: '', fr: '' }, body: r.body || { en: '', fr: '' } }))
      .filter((r) => (r.title.en || r.title.fr || '').trim());
    // Overrides carry only what changed — an untouched entry has no row at all.
    const cleanOv = Object.fromEntries(Object.entries(ov).filter(([id]) => isEdited(id)).map(([id, o]) => [id, {
      ...(o.title ? { title: { en: o.title.en || '', fr: o.title.fr || '' } } : {}),
      ...(o.body ? { body: { en: o.body.en || '', fr: o.body.fr || '' } } : {}),
      ...(o.extra ? { extra: { en: o.extra.en || '', fr: o.extra.fr || '' } } : {}),
      ...(o.hidden ? { hidden: true } : {}),
      ...(o.hideMore ? { hideMore: true } : {}),
    }]));
    setBusy(true);
    try {
      await Promise.all([
        api.put('/admin/settings/guide.custom', { value: clean }),
        api.put('/admin/settings/guide.overrides', { value: cleanOv }),
      ]);
      toast.success(t('ag.saved', 'Guide saved.'));
      onSaved(clean, cleanOv);
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
      <p className="text-sm text-[var(--muted)] mb-3">{t('ag.edit.sub2', 'Every built-in entry can be retitled, rewritten or hidden, and given a section of your own under it; your own sections go under “Added by your team”. Bodies and sections are B.MD — callouts, checklists, cards, tabs, everything the blog and the docs use. Both languages, shown to admins by their language setting.')}</p>
      <div className="inline-flex rounded-lg border border-[var(--line)] p-0.5 text-xs mb-4">
        {[['builtin', t('ag.edit.builtin', 'Built-in entries'), editedCount], ['custom', t('ag.edit.custom', 'Your sections'), rows.length]].map(([k, lbl, n]) => (
          <button key={k} type="button" onClick={() => setPart(k)} className={`px-3 py-1.5 rounded-md ${part === k ? 'bg-[var(--surface-2)] text-[var(--text)] font-medium' : 'text-[var(--muted)]'}`}>{lbl}{n ? <span className="ms-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--primary)]/10 text-[var(--primary-2)]">{n}</span> : null}</button>
        ))}
      </div>

      {part === 'builtin' && (
        <div className="lg:grid lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-5 lg:items-start">
          <div className="mb-4 lg:mb-0">
            <div className="relative mb-2"><Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--faint)]" /><Input className="!ps-8 !py-1.5 !text-sm" value={bq} onChange={(e) => setBq(e.target.value)} placeholder={t('ag.edit.find', 'Find an entry…')} /></div>
            <nav className="flex lg:flex-col gap-1 overflow-x-auto lg:overflow-visible lg:max-h-[62vh] lg:overflow-y-auto no-scrollbar">
              {shown.map((it) => { const Icon = it.icon; const on = sel === it.id; const ed = isEdited(it.id); const hid = !!ov[it.id]?.hidden; return (
                <button key={it.id} type="button" onClick={() => setSel(it.id)} className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-start whitespace-nowrap lg:whitespace-normal shrink-0 text-[13px] ${on ? 'bg-[var(--primary)]/10 text-[var(--text)]' : 'text-[var(--muted)] hover:bg-[var(--surface-2)]'} ${hid ? 'line-through opacity-60' : ''}`}>
                  <Icon size={14} className={`shrink-0 ${on ? 'text-[var(--primary-2)]' : 'text-[var(--faint)]'}`} />
                  <span className="flex-1 min-w-0 truncate">{L(it.title)}</span>
                  {ed && <span className="w-1.5 h-1.5 rounded-full bg-[var(--primary)] shrink-0" title={t('ag.edit.edited', 'edited')} />}
                </button>
              ); })}
            </nav>
          </div>
          {cur ? (
            <Card className="p-4">
              <div className="flex items-center gap-2 flex-wrap mb-3">
                <span className="text-[11px] uppercase tracking-wider text-[var(--faint)]">{L(cur.heading)}</span>
                <span className="text-sm font-semibold">{L(cur.title)}</span>
                <span className="text-[11px] text-[var(--faint)]">· {cur.id}</span>
                <div className="ms-auto flex items-center gap-2">
                  <label className="flex items-center gap-1.5 text-xs cursor-pointer"><input type="checkbox" checked={!!curOv.hidden} onChange={(e) => setOvFlag('hidden', e.target.checked)} /> {t('ag.edit.hide', 'Hide this entry')}</label>
                  {isEdited(cur.id) && <Button size="sm" variant="ghost" onClick={resetOv}><RotateCcw size={13} /> {t('ag.edit.reset', 'Back to built-in')}</Button>}
                </div>
              </div>
              <div className="space-y-3">
                <div>
                  <div className="text-[11px] text-[var(--faint)] mb-1">{t('ag.edit.title.l', 'Title')} <span className="opacity-70">({tab.toUpperCase()})</span></div>
                  <Input value={(curOv.title || {})[tab] || ''} onChange={(e) => setOvField('title', { [tab]: e.target.value })} placeholder={cur.title[tab] || cur.title.en} />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <div className="text-[11px] text-[var(--faint)]">{t('ag.edit.body.l', 'Body — replaces the built-in paragraph (B.MD)')} <span className="opacity-70">({tab.toUpperCase()})</span></div>
                    {!((curOv.body || {})[tab] || '').trim() && <button type="button" onClick={startFromBody} className="text-[11px] px-2 py-0.5 rounded-full border border-[var(--line)] text-[var(--primary-2)] hover:border-[var(--primary)]">{t('ag.edit.startfrom', 'Start from the built-in text')}</button>}
                  </div>
                  <MarkdownEditor value={(curOv.body || {})[tab] || ''} onChange={(v) => setOvField('body', { [tab]: v })} minHeight={110} placeholder={cur.body[tab] || cur.body.en} />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <div className="text-[11px] text-[var(--faint)]">{t('ag.edit.extra.l', 'Your section under it — house rules, who to ask, a checklist (B.MD)')} <span className="opacity-70">({tab.toUpperCase()})</span></div>
                    {GUIDE_MORE[cur.id] && !curOv.hideMore && <button type="button" onClick={pullMore} className="text-[11px] px-2 py-0.5 rounded-full border border-[var(--line)] text-[var(--primary-2)] hover:border-[var(--primary)]">{t('ag.edit.pullmore', 'Pull the built-in steps & traps in here to edit them')}</button>}
                    {curOv.hideMore && <span className="text-[11px] text-[var(--faint)]">{t('ag.edit.morehidden', 'Built-in steps & traps hidden — yours replace them')}</span>}
                  </div>
                  <MarkdownEditor value={(curOv.extra || {})[tab] || ''} onChange={(v) => setOvField('extra', { [tab]: v })} minHeight={160} placeholder={tab === 'fr' ? ':::tip[Chez nous]\nCe que ton équipe doit savoir sur cet écran…\n:::' : ':::tip[Here]\nWhat your team should know about this screen…\n:::'} />
                </div>
                <div className="text-[11px] text-[var(--faint)]">{t('ag.edit.builtin.h', 'An empty field keeps the built-in text for that language. The built-in bullet points, step-by-step and traps stay under your text; “Back to built-in” drops every change on this entry.')}</div>
              </div>
            </Card>
          ) : <div className="text-sm text-[var(--faint)]">{t('ag.none', 'Nothing matches that.')}</div>}
        </div>
      )}

      {part === 'custom' && (<>
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
      </>)}
    </div>
  );
}

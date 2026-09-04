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
  BookOpen, Search, BellIcon, Inbox, Users, Shield, Settings2, Boxes, Newspaper, BadgeCheck,
  Server, CreditCard, Rocket, Megaphone, Sparkles, Wand2, KeyRound, MessageSquare, Cpu,
  TrendingUp, Sliders, Navigation, Palette, Lock, History, Scale, Gavel, HardDrive,
  Pencil, Plus, Trash2, Save, ChevronUp, ChevronDown, X, FileText, ChevronsDownUp, ChevronsUpDown, Info,
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

export default function AdminGuide() {
  const { t, lang } = useI18n();
  const { user } = useAuth();
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(false);
  const [custom, setCustom] = useState(null); // admin-authored Markdown sections
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
      .then((d) => setCustom(Array.isArray(d?.settings?.['guide.custom']) ? d.settings['guide.custom'] : []))
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

  // Flat list of every visible entry (for the reading pane + resolving the active one).
  const flat = useMemo(() => groups.flatMap((g) => g.items.map((it) => ({ ...it, _heading: g.heading }))), [groups]);
  const activeItem = flat.find((it) => it.id === active) || flat[0] || null;

  if (editing) return <GuideEditor initial={custom || []} onClose={() => setEditing(false)} onSaved={(v) => { setCustom(v); setEditing(false); }} />;

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
                  <p className="text-sm text-[var(--muted)] leading-relaxed mb-3">{L(activeItem.body)}</p>
                  {activeItem.points.length > 0 && (
                    <ul className="space-y-2">
                      {activeItem.points.map((p, i) => (
                        <li key={i} className="text-[13.5px] text-[var(--muted)] leading-relaxed list-disc ms-5 marker:text-[var(--primary-2)]">{L(p)}</li>
                      ))}
                    </ul>
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

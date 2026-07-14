# BCWEB — Fonctionnalités

> Un tour fonctionnalité par fonctionnalité de **BetterCommunity Web** côté
> produit/utilisateur. Pour la vue technique voir **Technical_Analysis_FR.md**. Non
> commité — document vivant.

## Comptes & connexion
- Inscription/connexion **email + mot de passe** (argon2id), reset par jeton.
- **Continuer avec GitHub / Discord** (OAuth2) — boutons visibles seulement si configuré.
- **Double authentification (TOTP)** — QR + clé manuelle, 8 codes de récupération à
  usage unique (`.txt` téléchargeable), activation/désactivation en self-service.
  Obligatoire pour tous les niveaux admin.
- **2FA optionnelle à l'inscription** — les nouveaux comptes (y compris via
  GitHub/Discord) se voient proposer une étape de configuration 2FA ; tout compte
  connecté sans 2FA voit une invite dismissible sur le dashboard.
- **Profil** — avatar (généré), bio, changement de mot de passe, section Infos
  personnelles cachée par défaut, liaison des **ids créateur** BMM et **Discord**, lien
  rapide vers les Réglages.
- **Unique BC id** — chaque compte a un id de support stable `BC-XXXX-XXXX`.

## Parcourir & catalogue
- **Catalogue** d'apps / plugins / thèmes / presets — barre de filtres nette : switcher de
  projet (Tous / BMM / BSM), tri, recherche, pills de type à icônes. Une bande **Catalogues
  communautaires** sous la grille officielle liste les catalogues hébergés par les membres
  (bien séparés visuellement des items officiels de confiance).
- **Pages d'item** avec détails, versions, téléchargements (plusieurs options en dropdown),
  et un lien `catalog.json` copiable (flux consommable par BMM).
- **Wizard de soumission** (`/submit`) — flux pleine page à deux chemins :
  1. **Proposer au catalogue officiel** (gratuit, modéré) : dépose un `.bmmplug`, un `.json`
     de thème/preset, ou un `catalog.json` entier → **analyse automatique** qui préremplit
     le formulaire ; un fichier catalogue bascule en **mode masse** (une proposition par
     entrée). Un panneau « Avancé » garde l'éditeur JSON brut. Envois jusqu'à 100 Mo ; les
     fichiers plus gros passent par la page contact. PoW + toast d'annulation + modération
     conservés.
  2. **Héberger ton propre catalogue** : **raw** (dépose ton `catalog.json`, téléchargements
     self-hosted — gratuit) ou **managed** (items + fichiers chez nous, puisés dans un pool).
- **Catalogues communautaires** — tu héberges ton propre catalogue d'apps/plugins/thèmes.
  Public ou **privé** (sur invitation) : un catalogue privé n'est jamais listé et son flux +
  téléchargements sont protégés par une liste d'accès — **IP, creator id, BC id, e-mail ou
  Discord** (même modèle que les Server-Repos), plus des **bans** sur 3 couches (site +
  owner + catalogue). Chaque catalogue a une page `/c/:slug` avec des deep-links **« Ajouter
  à BMM »** par type + une URL de flux copiable. Les admins les modèrent (suspendre /
  délister) dans l'onglet *Catalogues communautaires*.
- **Item privé par défaut** (comme les Server-Repos) : un item n'apparaît dans le catalogue
  public + le flux `catalog.json` qu'une fois validé par un admin. Avant ça il reste
  **privé** mais accessible via son **lien de partage** (`?k=…`) ; ce lien marche aussi
  une fois public. **Suspendre** (admin) est plus fort qu'un rejet : l'owner ne peut plus
  resoumettre (rejet → il corrige et resoumet ; suspension → contacter le support).

## Hébergement (pools de stockage)
- **Achète de l'espace, utilise-le librement** — un achat provisionne un **pool de
  stockage** (pas un repo fixe). Remplis-le comme tu veux : un repo, plusieurs repos, des
  catalogues, ou un mélange — repos et catalogues partagent les mêmes octets du pool, et
  libérer l'un rend la place à l'autre. Un pool fraîchement acheté et vide apparaît dans
  *Mes Repos* comme une carte actionnable (« Ajouter un dépôt » / « Ajouter un catalogue »).
  Plans (5/10/25/50 Go + custom) et un free-tier à 0 $.
- **La facturation est rattachée au pool** — la souscription (terme prépayé ou auto-renew)
  est sur le pool ; un achat peut donc contenir des repos, des catalogues, ou rien encore.
  À l'expiration, tout le pool (ses repos **et** catalogues) est suspendu avec la grâce de
  suppression habituelle de 72h ; le renouvellement (auto ou manuel) restaure tout.
- **Héberger un repo** (payant ou free-tier), **auto-publication** par l'owner, URL auto.
- **Niveaux de confiance** — badges Communauté / Partenaire / Officiel (officiel + partenaire
  remontent en tête de la liste publique) ; filtrables sur /repos et dans la liste admin.
- **Suspendu = totalement figé** — un repo suspendu est en lecture seule partout : aucun
  ajout/suppression de fichier, ni publication, ni changement de réglages/accès/état
  (client + serveur). Le dashboard reste consultable ; contacter le support pour lever.
- **Dashboard par repo** — gestionnaire de fichiers, téléchargement groupé en zip,
  graphe de trafic/usage, backup/rollback façon git, favoris (étoile + compteur visible
  par l'owner), contrôle d'accès (owner / email / mot de passe), et un **BC id**
  d'élément par repo (`BCR-…`).
- **Flux publics** — index agrégé `/repos.json`, `repo.json` par repo.
- **Free tier** — 1 repo gratuit + 1 item catalogue gratuit par compte & par id créateur
  (survit au unlink/relink), avec affichage en unités MB/GB et plafonds optionnels.

## Communauté & contenu
- **Blogs** — "Latest news" de la home (la plus récente d'abord, puis cascade) + blogs
  par projet, attributions de droits de blog granulaires.
- **Projets** — pages projet riches (BMM/BSM/BetterInstaller) avec onglets,
  téléchargements, notes de version, communauté, légal.
- **Other projects** — les admins mettent en avant N'IMPORTE quel projet avec le même
  style de page, sans code (géré depuis le dashboard admin) ; chacun obtient
  `/project/<slug>` + une carte.
- **Annonces de projet** — teaser à compte à rebours avant lancement, épinglage en
  topbar, bascule auto vers la vraie page à l'heure de révélation ; barrière de
  visibilité par page.
- **Mises à jour planifiées** — préparer du contenu de projet pour publication à une
  date/heure future (paresseux, sans cron), annulable.
- **Bot Discord** — accès multi-rôles avec exigences par rôle + `/refreshroles`,
  annonces de tips Ko-fi, alertes server-perf, modération, bienvenue, join-to-create
  vocal, annonces de blog. Chaque message est un embed.
- **Ko-fi** — un widget d'objectif de financement épinglé en bas de la home, discount
  d'hébergement de 25% lié aux dons.

## Back-office admin
- **File de modération** — recherche / filtre (dont par statut : en attente / rejeté /
  suspendu / publié) / tag / commentaire ; approuver, rejeter (l'owner corrige et
  resoumet) ou **suspendre** (l'owner ne peut plus resoumettre).
- **Utilisateurs** — recherche par id / nom / email / id créateur / Discord /
  **Unique BC id** ; le modal utilisateur montre le BC id + l'id d'élément de chaque
  repo/item, les rôles, les liens, les paiements.
- **Modération de compte** — **suspendre ou bannir** un compte (temporaire avec compte à
  rebours, ou permanent), avec une raison affichée à la connexion, envoyée par e-mail et
  en notification ; le compte est déconnecté sous ~15s et bloqué à la reconnexion jusqu'à
  la levée (permanent → contacter le support). Staff/soi-même protégés.
- **Rôles & accès** (SUPERADMIN) — réassigner les rôles ; politique whitelist/ban
  globale ; accorder la permission server-control. Des **capacités granulaires** permettent
  d'accorder à un MOD/USER une seule zone admin (`manage_users` / `manage_repos` /
  `manage_analytics` / `manage_newsletter` / `manage_faq` / `manage_catalogs`) — le
  dashboard n'affiche alors que ses sections et l'API vérifie chaque action ; les grants
  prennent effet sans reconnexion et une permission manquante s'affiche en toast explicite.
- **Catalogues communautaires** (cap `manage_catalogs`) — modérer les catalogues hébergés
  par les membres : recherche, **suspendre** (masqué à tous), **délister** (retiré du
  navigateur public, l'URL marche encore), et l'inverse.
- **Repos & hosting** — server repos (expiration, statut de paiement, annulation),
  hébergement gratuit, codes promo (discount / hébergement gratuit / boost gratuit),
  stockage (tous les consommateurs).
- **Contenu** — catalogues, config projets, other projects, **avis** (témoignages
  d'accueil gérés par l'admin : texte EN + FR, note, bascule par avis + section entière),
  **events** (Nouvel An / fête nationale / custom : **aperçu** des feux d'artifice à la
  demande, **quantité + taille + taux d'apparition du drapeau** configurables, feux calmes
  cantonnés au ciel, badge fête nationale avec le drapeau du pays et un lien cliquable au
  choix ; désactivables par l'utilisateur dans les Réglages), annonces (bannière site +
  notifications typées, limite de taille de corps, icônes par type).
- **Serveur** — dashboard perf en direct (totaux CPU/RAM/disque/uptime + valeurs au
  survol + alertes Discord) ; Advanced server management (DB viewer avec journal
  d'audit, gestionnaire de fichiers, Docker, redémarrage/power) derrière un droit
  server-control + step-up 2FA.
- **Journal de sécurité** — tentatives de connexion, IPs connectées, actions admin ;
  les lectures du DB viewer sont journalisées et les tables d'audit protégées.
- **Bot & analytics**, **Réglages** (leviers de prix, plafonds d'hébergement, limites
  free-tier).

## Aspect & ressenti
- **Orbe héro Three.js** — se construit à partir de ses éclats à l'intro, spirale au
  scroll (voyage proportionnel à la longueur de page), particules en orbite,
  survol/clic éclate & recompose, plongée de transition de page optionnelle (off par
  défaut).
- **Apparitions progressives au scroll** sur toute la home (robustes au scroll rapide).
- **Thèmes** (clair/sombre), réglage **surfaces translucides** (cartes + modals, %),
  **bascule d'intro**, **langue / thème par défaut**, choix cookies/vie privée — tout
  dans les **Réglages**.
- **i18n** EN/FR partout ; le sélecteur de langue est une bascule à 2 langues et un
  dropdown automatique au-delà, plus un sélecteur dans le footer (desktop + mobile).
- **Légal** — Confidentialité, CGU, Cookies, **À propos**, **Paiements & Remboursements**
  (EN/FR).

## Abus & sûreté
- Anti-bot / anti-DDoS en edge (Caddy + Fastify), proof-of-work à l'inscription & au
  contact, vérifications de secrets à temps constant, fetches sortants gardés contre le
  SSRF, contenu hébergé en sandbox (jamais exécuté ; téléchargement seul ;
  bans/whitelist/bande passante appliqués au service).

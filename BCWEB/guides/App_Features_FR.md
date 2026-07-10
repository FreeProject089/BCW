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
- **Catalogue** d'apps / plugins / thèmes / presets, filtre par projet / type / recherche.
- **Pages d'item** avec détails, versions, téléchargements (plusieurs options de
  téléchargement en dropdown), et un lien `catalog.json` copiable (flux consommable par BMM).
- **Soumettre** un item ou proposer une mise à jour → file de modération ; les presets et
  paquets de plugins sont validés (intégrité + checksums).

## Hébergement Server-Repo
- **Héberger un repo** (payant ou free-tier), **auto-publication** par l'owner, URL auto.
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
- **File de modération** — recherche / filtre / tag / commentaire sur les soumissions.
- **Utilisateurs** — recherche par id / nom / email / id créateur / Discord /
  **Unique BC id** ; le modal utilisateur montre le BC id + l'id d'élément de chaque
  repo/item, les rôles, les liens, les paiements.
- **Rôles & accès** (SUPERADMIN) — réassigner les rôles ; politique whitelist/ban
  globale ; accorder la permission server-control.
- **Repos & hosting** — server repos (expiration, statut de paiement, annulation),
  hébergement gratuit, codes promo (discount / hébergement gratuit / boost gratuit),
  stockage (tous les consommateurs).
- **Contenu** — catalogues, config projets, other projects, annonces (bannière site +
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

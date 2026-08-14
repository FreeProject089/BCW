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

- **Fermer ton compte** — planifiée à 30 jours et annulable pendant tout ce mois, depuis un
  lien qui fonctionne déconnecté (celui qui arrête une suppression est souvent sur un
  téléphone où il ne s’est jamais connecté). Le mail emporte toutes tes factures : après, il
  n’y a plus de compte pour aller les chercher. Ce qui se produit au terme est une
  anonymisation, pas une suppression de ligne : factures et dossier de modération survivent,
  tout ce qui est personnel est effacé. Un hachage à sens unique de l’adresse est conservé
  pour que t’inscrire à nouveau avec elle rattache ton historique — y compris un éventuel
  dossier de modération. Une autre adresse repart vraiment de zéro.
- **Transferts de propriété** — passe un dépôt ou un élément de catalogue à quelqu’un par
  e-mail. La personne peut refuser, rien ne bouge avant qu’elle accepte, et l’offre expire en
  14 jours. Un dépôt hébergé avec un abonnement actif est refusé, un dépôt en offre gratuite
  aussi : le gratuit c’est un par compte, donc le céder consommerait un droit que la personne
  n’a jamais demandé.
- **Sondages** — réponds sur `/polls`. Changer d’avis remplace ta réponse au lieu d’être
  refusé, et tu peux la retirer entièrement.

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
- **Gestion des pools** — les pools sont **repliables** et chacun prend sa propre **couleur**
  dans le dashboard. **Fusionne** plusieurs pools en un (multi-sélection → fusionner, avec un
  undo de 6 s ; repos, catalogues **et** abonnements suivent ensemble) ; les admins peuvent
  **défusionner** un pool. Un pool fusionné portant plusieurs abos récurrents payants affiche
  un **devis d'économies de consolidation** et peut les consolider en un seul plan plus grand
  via Stripe (remise réglable par l'admin ; seuls les abos récurrents, donc un terme prépayé
  n'est jamais perdu).
- **Partager un repo non listé** — chaque repo a une page publique `/r/<id>` avec un deeplink
  « Ouvrir dans BMM » ; un repo *non listé* peut quand même être partagé via un lien généré
  par l'owner `/r/<id>?k=<clé>` (comme les liens `?k=` des catalogues privés).
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
- **Sondages** (`manage_polls`) — pose une question, choisis qui peut répondre (membres
  seulement, une voix chacun et c’est exact ; ou tout le monde, dédoublonné par une
  empreinte d’appareil propre au sondage) et quand le décompte devient visible (après avoir
  répondu par défaut — un total affiché avant oriente la réponse). Les options se figent dès
  qu’une réponse existe : les modifier après laisse un décompte qui tombe juste et ne veut
  plus rien dire. Chaque résultat est reporté séparé connectés / anonymes, et la part
  anonyme est présentée comme une estimation : deux personnes derrière une même box comptent
  pour une, une personne sur deux appareils compte double.
- **API publique** (`manage_api`) — à quoi sert chaque clé. Deux jeux de données tenus à
  part volontairement : un COMPTEUR quotidien d’appels et d’erreurs, exact et conservé, et
  un ÉCHANTILLON de courte durée d’appels individuels pour expliquer un incident. La liste
  d’appels le dit en tête, là où l’on se mettrait sinon à compter les lignes. Révoquer une
  clé prévient son propriétaire : une clé qui meurt sans explication, c’est un ticket de
  support qui part d’une fausse piste.
- **SSO — Personnes** — à côté du registre des applications, qui a réellement autorisé quoi :
  la personne, l’application, le nombre de sessions actives, et un bouton pour couper.
  Couper révoque les jetons dans le même geste (retirer le consentement seul laisse
  l’application fonctionner jusqu’à leur expiration) et prévient la personne, pour que la
  redemande d’autorisation ne passe pas pour un bug de cette application. Les deux moitiés du
  mot « SSO » sont étiquetées et jamais fondues : se connecter ICI avec GitHub, contre se
  connecter à une application externe avec ce compte.
- **Fermeture de compte, côté équipe** — la fiche utilisateur s’ouvre sur l’état de
  fermeture, parce qu’une fermeture en cours change le sens de toutes les autres actions de
  cet écran. L’équipe peut en planifier une avec un motif obligatoire ; la personne reçoit le
  motif, la date et un lien pour nous contacter — pas un bouton d’annulation, car une
  fermeture décidée par l’équipe ne s’annule pas de son côté.

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

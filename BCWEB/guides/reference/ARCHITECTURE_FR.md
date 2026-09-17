# BetterCommunity Web (BCWEB) — Architecture

*🇬🇧 [English version](ARCHITECTURE_EN.md).*

Le hub qui unit **BMM** (Better Mods Manager), **BSM** (Better Sound Maker),
**BetterInstaller** et les futurs projets Better* : un site, un système de comptes, des
blogs & catalogues par projet, un back-office admin, un bot Discord, et l'hébergement
payant de Server-Repos.

> Objectifs de conception (du brief) : **scalable**, **sécurisé**, **simple à déployer avec
> Docker**. Carte blanche sur le *comment* — ce document est le *comment*.

> Ce document décrit la **forme** du système : les services, les frontières entre eux, et
> le raisonnement. Il est volontairement court. Le détail au niveau des fichiers est dans
> [Technical_Analysis_FR.md](Technical_Analysis_FR.md), et les vues générées (donc
> impossibles à périmer) des routes, du schéma et du graphe de dépendances sont les cartes
> de code admin décrites dans [CODEBASE_MAPS_FR.md](CODEBASE_MAPS_FR.md).

---

## 1. Stack (choisie pour la cohérence + l'auto-hébergement facile)

Le telemetry-dashboard existant est en Node + Docker, donc on reste dans ce monde.

| Couche | Techno | Pourquoi |
|---|---|---|
| **API** | Node 22 + **Fastify 5** + **Zod** (validation) | rapide, typé, validé par schéma ; un conteneur |
| **BD** | **PostgreSQL 16** + **Prisma** (migrations + client typé) | les données relationnelles collent aux catalogues/facturation ; migrations |
| **Cache** | **Redis 7** | buckets de rate-limit partagés entre réplicas d'API, le cache à deux niveaux des lectures publiques, l'état perf/monitor. Chaque consommateur se dégrade en mode in-process si Redis est absent |
| **Stockage objet** | **Compatible S3** (**MinIO** en auto-hébergé, ou AWS S3) | assets de catalogue, fichiers de preset, données de repo — jamais dans Postgres/git |
| **Web** | **React 18 + Vite + Tailwind** (colle à l'écosystème) | SPA ; un bundle statique servi par nginx derrière le proxy |
| **Proxy / TLS** | **Caddy 2** | HTTPS automatique, routage, une seule config |
| **Paiements** | **Stripe** (Checkout + Billing + webhooks) | tarification par paliers + usage, PCI géré par Stripe |
| **Helpers natifs** | **Rust** via napi-rs (`native/`) | zip, zstd, BLAKE3 et redimensionnement d'image sur un thread worker plutôt que sur la boucle d'événements ; un repli JS garde un build sans l'addon fonctionnel |
| **Runtime d'hébergement repo** | service provisioner (Node) | alloue une zone de stockage par Server-Repo hébergé et publie son URL |

Tout tourne depuis un seul **`docker compose up`** (voir `infra/compose/docker-compose.yml`).

---

## 2. Layout du monorepo

```
BCWEB/
  apps/
    api/            # API Fastify (auth, catalogues, soumissions, hébergement, facturation,
                    #   admin, la surface appelée par le bot) : 71 modules de routes,
                    #   109 modules lib
    web/            # Front React/Vite/Tailwind : le site public, tous les dashboards, les éditeurs
    bot/            # Bot Discord (discord.js) : gating, économie, modération, logs, panneaux
    provisioner/    # met les Server-Repos hébergés en ligne (zone de stockage + URL publiée)
  packages/
    db/             # schéma Prisma (schema.prisma) + migrations, partagé api + bot
    bmd/            # @bettercommunity/bmd, le renderer de blocs markdown B.MD
    bmd-editor/     # @bettercommunity/bmd-editor, l'éditeur bâti sur ce renderer
  bmm/
    telemetry-dashboard/   # l'app de télémétrie BMM live (servie sur sa propre origine)
  native/           # bcweb-native : helpers Rust/napi (zip, zstd, BLAKE3, redim. d'image)
  infra/
    caddy/          # Caddyfile (routage + TLS)
    compose/        # docker-compose.yml
    backup/         # backup.sh
                    # plus les scripts deploy/rollback/zéro-downtime/rotation de secrets
                    #   et env-spec.txt, posés directement dans infra/
  guides/
    reference/      # ce fichier, la référence API, les cartes de code, le tour produit
    run/            # déploiement, env, setup, commandes
    use/            # guides utilisateur, hôte et modérateur
    audits/         # audits tech, perf et sécurité
    check-links.mjs, check-claims.mjs   # les deux vérifications que la CI passe sur les guides
  loadtest/         # harnais de benchmark + stress (run.mjs, BENCHMARK.md)
  scripts/          # migrate-and-mirror.ps1 (le miroir des deux clients Prisma)
```

Il n'y a pas de package de types partagés (une version antérieure de ce document en
promettait un) ni de répertoire BSM : BSM est une **clé de projet** semée, avec une page,
un blog et un catalogue, pas un dossier à part.

---

## 3. Domaines & fonctionnalités

### 3.1 BetterCommunity (le site principal)
- Landing + **blog unifié** : actus agrégées de chaque projet (BMM, BSM…), filtrables par
  projet. Articles rédigés depuis le dashboard admin.

### 3.2 Section BMM
- **Blog**, page **Téléchargement** (récupère la dernière release GitHub / update.json).
- **Liste des Server-Repos** (parcourir les repos publics + statut : en ligne, taille, mods).
- **Catalogues** : **Apps**, **Plugins**, **Thèmes** — chacun parcourable + cherchable.
  - Les utilisateurs peuvent **soumettre** leur propre app/plugin/thème à un catalogue →
    **file de modération** → un admin/mod **approuve** (publie) ou **rejette** (notifie l'utilisateur).

### 3.3 Section BSM (périmètre initial)
- **Blog**.
- **Presets communautaires** : un `.json` = un preset. Le preset porte toujours ses
  métadonnées (`name`, `color`, `version`, `UpdateNumber`, `date`, `assetPaths[]`…). Les
  utilisateurs peuvent **demander** à poster un preset → même flux de modération.

### 3.4 Comptes & dashboard utilisateur
- Comptes e-mail+mot de passe (argon2id), vérification e-mail, plus OAuth GitHub/Discord.
  Une session est un cookie signé qui porte l'id d'une ligne `Session`, donc un appareil
  peut être révoqué depuis le panneau des sessions sans attendre l'expiration du token.
- Un compte est **requis pour soumettre** à tout catalogue officiel.
- **Dashboard utilisateur** : gère tes items de catalogue téléversés (apps/plugins/thèmes/
  presets) → **propose des mises à jour**, vois le statut de modération, gère tes Server-Repos
  hébergés (ci-dessous).

### 3.5 Dashboard admin
- Modère chaque catalogue (BMM + BSM) : **approuver / rejeter** les soumissions, avec une
  raison de rejet → **notification** à l'utilisateur.
- Accède au **dashboard de télémétrie BMM** (embarqué / lien SSO).
- Vois & gère les **Server-Repos** (statut, en ajouter un facilement).
- **Définis les limites de la plateforme** : capacité d'hébergement globale, quotas par palier,
  boutons de tarification (voir §3.6), tout éditable depuis l'UI admin, stocké en lignes
  clé/valeur dans le modèle `AdminSetting` (aucun mappage de nom de table : c'est le nom
  par défaut de Prisma qui sert).

### 3.6 Hébergement de Server-Repo (payant)
Un utilisateur peut payer pour faire héberger l'un de ses Server-Repos par nous ; il obtient
un dashboard pour celui-ci.
- **Paliers de stockage** : le seed livre Free (1 Go, 0 $) plus Pool 5 / 10 / 25 / 50 Go ;
  les plans sont des lignes de `HostingPlan`, donc un opérateur peut les éditer ou en ajouter.
- **Garde-fou de capacité globale** : l'admin définit le stockage total disponible ; un achat
  est **refusé s'il laisserait l'hôte sous sa marge libre réservée** (l'hôte doit toujours
  garder ≥ X Go/Mo libres). Appliqué au checkout + par le provisioner.
- **On définit la limite d'upload par repo** (la limite qu'un auteur de repo configure dans BMM
  est ignorée pour les repos hébergés — la nôtre gagne).
- **Tarification flexible** : le prix est une fonction des Go de stockage + limite d'upload +
  part CPU, donc il évolue avec ce que le repo nous coûte réellement. Facturé via **Stripe**.

### 3.7 Bot Discord (`apps/bot`)

Un service livré, pas un accessoire : c'est la présence du site à l'intérieur d'un serveur
communautaire. Il ne détient **aucun accès à la base** : chaque lecture et chaque écriture
passe par la surface `/bot/*` de l'API avec un secret partagé, et c'est ce qui en fait un
conteneur séparé.

`index.mjs` est un gestionnaire de connexion plutôt qu'un simple démarrage : il se connecte
quand un token existe et que le bot est activé, se reconnecte quand le token change, et se
déconnecte quand il est désactivé, si bien qu'un admin peut définir ou faire tourner le
token depuis le dashboard sans redémarrer le conteneur. Autour de lui, huit autres modules
de premier niveau : `config.mjs` (la config éditée par l'admin, refetchée toutes les 30 s,
le `DISCORD_TOKEN` de l'env l'emportant), `api.mjs`, `commands.mjs` (commandes slash +
routage des interactions), `ui.mjs`, `i18n.mjs`, `store.mjs`, `logbuffer.mjs`, et deux
ajoutés tout récemment :

- **`nav.mjs`**, le bouton Retour unique. Une interaction de composant ne transporte qu'un
  custom id, donc un écran ouvert depuis un autre écran était une impasse. L'origine voyage
  désormais **dans le custom id** du bouton qui ouvre l'écran suivant, et la destination en
  tire un seul bouton Retour cohérent, au lieu d'un Retour câblé à la main par écran qui
  pointe au mauvais endroit six écrans plus loin.
- **`help.mjs`**, la source unique de l'explication longue d'une fonctionnalité, lue de deux
  façons : le bouton « Learn more » sur la carte de la fonctionnalité (répondu en éphémère,
  donc le salon n'est pas touché) et `/help`. Aucune des deux ne possède le texte, elles ne
  peuvent donc pas diverger.

`features/` contient 28 modules, dont le gating (multi-rôles, exigences par rôle,
re-vérification périodique), l'économie et ses saisons, le casino live et ses lobbies, les
giveaways, l'automod, la modération et la file de modération que le site lui transmet, les
logs (une table de routage par serveur), les panneaux de rôles, l'onboarding, les annonces,
les posts de paiement et Ko-fi, les salons vocaux join-to-create, les scans de membres et
les icônes en emojis d'application.

Chaque message est un **conteneur Discord Components V2** construit par `ui.mjs` : pas de
`content`, pas d'`embeds`, au plus 40 composants et 4000 caractères. Nécessite les intents
privilégiés **Server Members** et **Message Content**.

---

## 4. Modèle de données (Postgres / Prisma — entités principales)

`packages/db/schema.prisma` déclare **162 modèles**. Ceux qui suivent sont la colonne
vertébrale à laquelle le reste s'accroche ; tout le reste (économie, sondages, docs,
équipes, tâches, MYO, OIDC, charité, mentions légales, analytics…) est joignable depuis
eux. La vue générée et vivante du schéma entier (modèles les plus larges, les plus
dépendus, dérive d'index) est la carte de schéma décrite dans
[CODEBASE_MAPS_FR.md](CODEBASE_MAPS_FR.md) ; préfère-la à toute liste écrite ici, parce
qu'elle lit le schéma au lieu de s'en souvenir.

```
User(id, email, passwordHash?, displayName, role[USER|MOD|ADMIN|SUPERADMIN],
     permissions[], customRoleIds[], emailVerified, stripeCustomerId?, createdAt)
Session(id, userId, ip?, userAgent?, device?, browser?, os?, country?, region?, city?,
        createdAt, lastSeenAt, revokedAt?)
Project(id, key, name, showOnHomeNews, showBlogTab, visibility, scheduledAt?)
BlogPost(id, projectId?, showcaseProjectId?, authorId, title, slug, excerpt, body,
         titleFr?/excerptFr?/bodyFr?, status[DRAFT|PUBLISHED], publishedAt?, version)

CatalogItem(id, projectId, kind[APP|PLUGIN|THEME|PRESET|MODPACK|TUTORIAL|LIST], ownerId,
            name, slug, description, tags[], version,
            status[PENDING|PUBLISHED|REJECTED|HIDDEN|SUSPENDED],
            payloadKey/*S3*/, payloadSize, meta jsonb, views, downloads,
            deleteAt?, createdAt, updatedAt)
Submission(id, itemId, ownerId, type[NEW|UPDATE], status, reviewerId?, reason?, tags[],
           createdAt)
Notification(id, userId, kind, body, bodyFr?, href?, readAt?, createdAt)

ServerRepo(id, ownerId, name, hosted bool, freePlan, status, region, publicUrl,
           storageQuotaBytes, storageUsedBytes, uploadLimitKbps, cpuShare,
           seed, sha, listed, verified, groupId?, teamId?, deleteAt?, createdAt)
HostingPlan(id, name, storageGB, uploadLimitKbps, cpuShare, priceMonthlyCents, active,
            boostsPerPeriod, boostPeriodMonths, boostDays)
Subscription(id, userId, serverRepoId?, hostingGroupId?, poolContribBytes, planId,
             stripeSubId?, status, currentPeriodEnd?, createdAt)
Payment(id, userId, serverRepoId?, hostingGroupId?, kind[FEATURE|HOSTING|MYO_*|…],
        description, amountCents, currency, days?, stripeSessionId?, status, createdAt)

AdminSetting(key, value jsonb)            # cap d'hébergement global, marge libre réservée,
                                          # boutons de prix (prix/Go, upload, cpu)…
```

Il n'existe pas de modèle `Invoice` : un paiement abouti est une ligne `Payment`, et c'est
Stripe qui conserve la facture elle-même. Un abonnement pointe soit sur un unique
`ServerRepo` (l'ancienne forme), soit sur un pool de stockage `HostingGroup` (la forme
actuelle), d'où deux ids nullables.

Le stockage objet (S3/MinIO) contient les octets lourds (payloads de catalogue, `.json` de
preset, données de repo) ; Postgres contient les métadonnées + pointeurs (`payloadKey`).

---

## 5. Sécurité

- **AuthN** : hachage argon2id, vérification e-mail, sessions en cookies signés adossés à
  une ligne `Session` révocable ; 2FA TOTP **obligatoire** pour MOD/ADMIN/SUPERADMIN.
- **AuthZ** : middleware par rôle (USER / MOD / ADMIN / SUPERADMIN), plus des droits fins
  par capacité et des rôles personnalisés créés par un SUPERADMIN qui se superposent ; les
  propriétaires ne touchent que leurs propres items ; les soumissions ne changent d'état
  que via mod/admin.
- **Entrée** : chaque route valide le body/query avec **Zod** ; plafonds de taille sur les uploads.
- **Uploads** : les uploads client vont vers S3 via des **URLs pré-signées** (ne jamais faire
  transiter des Go par l'API) ; le serveur enregistre les métadonnées après une étape de vérif.
- **Payloads de catalogue** vérifiés en forme (schéma JSON de preset ; manifeste de plugin)
  avant PUBLISHED. Servis en lecture seule.
- **Repos hébergés** : chacun reçoit sa propre zone de stockage, avec le quota de stockage
  et le plafond d'upload du plan appliqués au moment de servir. L'isolation par conteneur
  et par repo est un point d'extension explicitement balisé dans le provisioner
  (`spinUpRepoContainer()`), pas quelque chose qu'il fait aujourd'hui.
- **Rate limiting** (buckets Redis) sur auth + soumission + API.
- **Stripe** gère les données de carte (PCI hors périmètre) ; les webhooks sont vérifiés par signature.
- **Secrets** seulement via env / Docker secrets — jamais commités (`.gitignore`).

---

## 6. Scalabilité

- **L'API ne porte aucun état de process qui compte** (le budget de rate-limit et le cache
  des lectures publiques chaudes vivent dans Redis quand il est configuré) → scale
  horizontalement derrière Caddy. **PgBouncer** est fourni en profil compose opt-in pour ce
  cas.
- **Postgres** comme source de vérité ; réplicas de lecture plus tard si besoin.
- **Le stockage objet** scale indépendamment (S3) + peut se placer derrière un CDN pour les
  téléchargements de catalogue.
- **Le travail de fond** tourne en workers in-process lancés par `server.mjs`, pas dans une
  file de jobs : `sweeper.mjs` (balayages d'expiration des repos, soumissions, suppressions
  planifiées, octroi des boosts inclus) et `monitor.mjs` (échantillonnage perf + alertes).
- **Le provisioner** est son propre service → la charge d'hébergement est isolée de l'API web.

---

## 7. Déploiement (simple, Docker)

```
cd BCWEB/infra/compose
cp .env.example .env        # mets le mot de passe BD, secret JWT, clés Stripe, creds S3…
docker compose up -d        # db, redis, minio, api, web, bot, provisioner,
                            # telemetry + telemetry-db, caddy
                            # (pgbouncer seulement avec --profile pgbouncer)
```
Caddy termine le TLS et route, sur le bloc du site principal : `/api/*` → api (le préfixe
`/api` est retiré), `/hosting/*`, `/repos.json`, `/catalog.json`, `/sitemap.xml`,
`/robots.txt`, `/og/*`, `/oauth2/*` et les documents OIDC `.well-known` → api, et tout le
reste → web (nginx servant la SPA buildée). Le dashboard de télémétrie est un **bloc de
site séparé** sur son propre domaine, pas un chemin. Le contenu des repos hébergés est
servi par l'API sous `/hosting/*` ; le domaine personnalisé d'un repo est admis par le TLS
à la demande de Caddy, qui demande à l'API (`/domains/ask`) si un hostname est autorisé.

Le déploiement complet est détaillé dans [DEPLOY_FR.md](../run/DEPLOY_FR.md).

---

## 8. Ce que le plan d'origine est devenu

Les sept phases autour desquelles ce document a été écrit (fondation, comptes + blog +
navigation catalogue, soumissions + modération, presets, liste Server-Repo puis
provisioner, hébergement Stripe, réglages admin + SSO télémétrie) ont toutes été livrées,
et la plateforme est allée bien au-delà (bot Discord, économie, sondages, docs, équipes,
tableau de tâches, MYO, un fournisseur OIDC, cagnottes caritatives, une surface légale
propre à l'instance).

Lis les sections 1 à 7 comme la forme du système, pas comme un plan. Pour ce que le produit
fait réellement aujourd'hui, va voir **[App_Features_FR.md](App_Features_FR.md)** ; pour le
câblage au niveau du code, **[Technical_Analysis_FR.md](Technical_Analysis_FR.md)**.

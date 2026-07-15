# BetterCommunity Web (BCWEB) — Architecture

*🇬🇧 [English version](ARCHITECTURE_EN.md).*

Le hub qui unit **BMM** (Better Mods Manager), **BSM** (Better Sound Maker) et les futurs
projets Better* : un site, un système de comptes, des blogs & catalogues par projet, un
back-office admin, et l'hébergement payant de Server-Repos.

> Objectifs de conception (du brief) : **scalable**, **sécurisé**, **simple à déployer avec
> Docker**. Carte blanche sur le *comment* — ce document est le *comment*.

---

## 1. Stack (choisie pour la cohérence + l'auto-hébergement facile)

Le telemetry-dashboard existant est en Node + Docker, donc on reste dans ce monde.

| Couche | Techno | Pourquoi |
|---|---|---|
| **API** | Node 20 + **Fastify** + **Zod** (validation) | rapide, typé, validé par schéma ; un conteneur |
| **BD** | **PostgreSQL 16** + **Prisma** (migrations + client typé) | les données relationnelles collent aux catalogues/facturation ; migrations |
| **Cache / file** | **Redis** | sessions, buckets de rate-limit, jobs en tâche de fond (BullMQ) |
| **Stockage objet** | **Compatible S3** (**MinIO** en auto-hébergé, ou AWS S3) | assets de catalogue, fichiers de preset, données de repo — jamais dans Postgres/git |
| **Web** | **React + Vite + Tailwind** (colle à l'écosystème) | SPA + landing SSR-léger ; un bundle statique servi par le proxy |
| **Proxy / TLS** | **Caddy** | HTTPS automatique, routage, une seule config |
| **Paiements** | **Stripe** (Checkout + Billing + webhooks) | tarification par paliers + usage, PCI géré par Stripe |
| **Runtime d'hébergement repo** | Docker (service provisioner) | chaque Server-Repo hébergé = un conteneur isolé + volume sous quota |

Tout tourne depuis un seul **`docker compose up`** (voir `docker-compose.yml`).

---

## 2. Layout du monorepo

```
BCWEB/
  apps/
    api/            # API Fastify (auth, catalogues, soumissions, hébergement, facturation, admin)
    web/            # Front React/Vite/Tailwind (BetterCommunity + BMM + BSM + dashboards)
    provisioner/    # service qui démarre / applique les quotas aux Server-Repos hébergés
  packages/
    db/             # schéma Prisma + migrations + client
    shared/         # types partagés, schémas zod, constantes (paliers de prix, rôles)
  bmm/
    telemetry-dashboard/   # déplacé ici (l'app de télémétrie BMM live)
    asset/                 # assets statiques BMM (logos, captures)
    official-server-repo/  # le contenu/config du Server-Repo « officiel » de seed
    other/
  bsm/                     # assets spécifiques BSM / presets de seed
  infra/
    caddy/          # Caddyfile (routage + TLS)
    compose/        # docker-compose.yml, .env.example
  ARCHITECTURE.md
```

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
- Comptes e-mail+mot de passe (argon2), vérification e-mail, sessions dans Redis.
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
  boutons de tarification (voir §3.6) — tout éditable depuis l'UI admin (stocké dans
  `admin_settings`).

### 3.6 Hébergement de Server-Repo (payant)
Un utilisateur peut payer pour faire héberger l'un de ses Server-Repos par nous ; il obtient
un dashboard pour celui-ci.
- **Paliers de stockage** : 5 / 10 / 25 / 50 Go (configurable).
- **Garde-fou de capacité globale** : l'admin définit le stockage total disponible ; un achat
  est **refusé s'il laisserait l'hôte sous sa marge libre réservée** (l'hôte doit toujours
  garder ≥ X Go/Mo libres). Appliqué au checkout + par le provisioner.
- **On définit la limite d'upload par repo** (la limite qu'un auteur de repo configure dans BMM
  est ignorée pour les repos hébergés — la nôtre gagne).
- **Tarification flexible** : le prix est une fonction des Go de stockage + limite d'upload +
  part CPU, donc il évolue avec ce que le repo nous coûte réellement. Facturé via **Stripe**.
- **Règle de mise à jour** : pour pousser une mise à jour vers un repo hébergé, la seule
  exigence est un **SHA valide** (intégrité) — rien d'autre.

---

## 4. Modèle de données (Postgres / Prisma — entités principales)

```
User(id, email, passwordHash, displayName, role[USER|MOD|ADMIN], emailVerified, createdAt)
Session(id, userId, expiresAt)            # aussi mirroré dans Redis
Project(id, key[bmm|bsm|community], name)
BlogPost(id, projectId, authorId, title, slug, body, status[DRAFT|PUBLISHED], publishedAt)

CatalogItem(id, projectId, kind[APP|PLUGIN|THEME|PRESET], ownerId, name, slug,
            description, tags[], version, status[PENDING|PUBLISHED|REJECTED|HIDDEN],
            payloadKey/*S3*/, meta jsonb, createdAt, updatedAt)
Submission(id, itemId, ownerId, type[NEW|UPDATE], status, reviewerId, reason, createdAt)
Notification(id, userId, kind, body, readAt, createdAt)

ServerRepo(id, ownerId, name, hosted bool, status, region, publicUrl,
           storageQuotaBytes, storageUsedBytes, uploadLimitKbps, cpuShare,
           seed, createdAt)
HostingPlan(id, name, storageGB, uploadLimitKbps, cpuShare, priceMonthlyCents)
Subscription(id, userId, serverRepoId, stripeSubId, planId, status, currentPeriodEnd)
Invoice(id, subscriptionId, stripeInvoiceId, amountCents, status, createdAt)

AdminSetting(key, value jsonb)            # cap d'hébergement global, marge libre réservée,
                                          # boutons de prix (prix/Go, upload, cpu)…
```

Le stockage objet (S3/MinIO) contient les octets lourds (payloads de catalogue, `.json` de
preset, données de repo) ; Postgres contient les métadonnées + pointeurs (`payloadKey`).

---

## 5. Sécurité

- **AuthN** : hachage argon2id, vérification e-mail, sessions dans Redis avec rotation ; 2FA
  TOTP optionnelle pour les admins.
- **AuthZ** : middleware par rôle (USER / MOD / ADMIN) ; les propriétaires ne touchent que
  leurs propres items ; les soumissions ne changent d'état que via mod/admin.
- **Entrée** : chaque route valide le body/query avec **Zod** ; plafonds de taille sur les uploads.
- **Uploads** : les uploads client vont vers S3 via des **URLs pré-signées** (ne jamais faire
  transiter des Go par l'API) ; le serveur enregistre les métadonnées après une étape de vérif.
- **Payloads de catalogue** vérifiés en forme (schéma JSON de preset ; manifeste de plugin)
  avant PUBLISHED. Servis en lecture seule.
- **Repos hébergés** isolés (un conteneur + volume sous quota chacun) ; le provisioner applique
  les caps stockage + upload + CPU ; les mises à jour exigent un **SHA valide**.
- **Rate limiting** (buckets Redis) sur auth + soumission + API.
- **Stripe** gère les données de carte (PCI hors périmètre) ; les webhooks sont vérifiés par signature.
- **Secrets** seulement via env / Docker secrets — jamais commités (`.gitignore`).

---

## 6. Scalabilité

- **L'API est sans état** (sessions/cache dans Redis) → scale horizontalement derrière Caddy.
- **Postgres** comme source de vérité ; réplicas de lecture plus tard si besoin.
- **Le stockage objet** scale indépendamment (S3) + peut se placer derrière un CDN pour les
  téléchargements de catalogue.
- **Jobs en tâche de fond** (BullMQ sur Redis) : notifications de modération, provisioning/
  teardown de repo, comptage d'usage, réconciliation Stripe — découplés de la latence des requêtes.
- **Le provisioner** est son propre service → la charge d'hébergement est isolée de l'API web.

---

## 7. Déploiement (simple, Docker)

```
cd BCWEB/infra/compose
cp .env.example .env        # mets le mot de passe BD, secret JWT, clés Stripe, creds S3…
docker compose up -d        # api + web + postgres + redis + minio + caddy
```
Caddy termine le TLS et route :
`/` → web, `/api` → api, `/telemetry` → telemetry-dashboard BMM,
repos hébergés → conteneurs gérés par le provisioner (sous-domaines).

---

## 8. Roadmap par phases

1. **Fondation** (ce commit) : squelette du monorepo, docker-compose, schéma BD, l'API boote
   (`/health`, scaffold d'auth), coquille web. ← on est ici
2. **Comptes + Blog + Navigation catalogue** (chemins de lecture + landing).
3. **Soumissions + modération** (dashboard utilisateur, file admin, notifications).
4. **Presets BSM** (upload `.json`, validation par schéma, navigation).
5. **Liste Server-Repo + statut** (lecture), puis **provisioner**.
6. **Hébergement Stripe** (plans, checkout, webhooks, application quota/capacité).
7. **Réglages admin** (limites + boutons de prix), SSO télémétrie.

Chaque phase est livrable indépendamment et Dockerisée.

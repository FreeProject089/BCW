# BCWEB — Analyse technique (plongée développeur)

> Une explication de zéro de **BetterCommunity Web** : comment tout est câblé,
> comment l'héberger, et comment fonctionne chaque sous-système. Voir
> [ARCHITECTURE.md](ARCHITECTURE_FR.md) pour le *pourquoi* de la stack ; ce document est
> le *comment* au niveau du code. Compagnon : **App_Features_FR.md** (tour des
> fonctionnalités).
>
> **Ce que ce document fait, et ne fait pas.** C'est une **carte**, pas un inventaire. Le
> code, c'est 71 modules de routes API, 109 modules lib API, 162 modèles Prisma et 194
> fichiers source web ; un paragraphe par fichier serait faux en une semaine, et personne
> ne le lirait. Donc chaque sous-système est nommé et situé, et les réponses fichier par
> fichier, celles qui ne peuvent pas se périmer, viennent des **cartes de code** générées
> dans Admin → Modération, documentées dans [CODEBASE_MAPS_FR.md](CODEBASE_MAPS_FR.md) :
> quelle garde protège quelle route, le schéma et sa dérive d'index, l'historique des
> migrations, les graphes d'endpoints et de flux de données, la carte d'infra. Quand ce
> document et une carte divergent, c'est la carte qui a raison.

---

## 1. Ce qu'est BCWEB

BCWEB est le hub qui réunit **BMM** (Better Mods Manager), **BSM** (Better Sound
Maker) et les futurs projets Better\* : un seul système de comptes, des blogs &
catalogues par projet, un back-office admin complet, de l'hébergement payant de
**Server-Repo**, un bot Discord, et un site vitrine (SPA React avec une orbe 3D
Three.js). C'est un **monorepo de petits services** collés par Docker Compose derrière
un unique reverse proxy Caddy.

```
apps/
  api/          API HTTP Fastify (le cerveau : auth, données, admin, hosting, billing)
  web/          SPA React 18 + Vite (tout le site public + dashboards + éditeurs)
  bot/          Bot discord.js (gating, économie, modération, logs, panneaux)
  provisioner/  met les repos hébergés EN LIGNE ; l'isolation par conteneur est
                un point d'extension
packages/
  db/           Schéma Prisma (schema.prisma) + migrations, partagé api+bot
  bmd/          @bettercommunity/bmd, le renderer de blocs markdown B.MD
  bmd-editor/   @bettercommunity/bmd-editor, l'éditeur bâti dessus
native/         bcweb-native : helpers Rust/napi (zip, zstd, BLAKE3, redim. d'image)
infra/
  compose/      docker-compose.yml + .env(.example)  — le déploiement
  caddy/        Caddyfile — reverse proxy edge, en-têtes de sécurité, anti-bot
  backup/       backup.sh ; les scripts deploy/rollback/ZDD/rotation sont dans infra/
guides/         ces docs, plus check-links.mjs et check-claims.mjs (les deux en CI)
loadtest/       harnais de benchmark + stress (BENCHMARK.md, run.mjs)
bmm/            telemetry-dashboard uniquement
```

Il n'y a pas de répertoire BSM ni de package de types partagés : BSM est une clé de
projet semée.

---

## 2. Topologie d'exécution (le trajet d'une requête)

Tout passe par **Caddy** sur les ports 80/443. Il route selon l'**en-tête Host** :

- `localhost` / `SITE_DOMAIN` (et `TUNNEL_DOMAIN`) → le bloc de site principal.
  - `handle_path /api/*` → retire `/api` → `reverse_proxy api:3000` (Fastify).
  - `/hosting/*`, `/sitemap.xml`, `/robots.txt`, `/repos.json`, `/catalog.json`,
    `/og/*`, `/oauth2/*` et les documents OIDC `.well-known` → api.
  - tout le reste → `reverse_proxy web:80` (nginx servant la SPA buildée).
  - les deux upstreams passent par un résolveur `dynamic a`, donc un conteneur rebuildé
    qui revient sur une nouvelle IP est repris au lieu d'être mis en cache jusqu'au
    prochain rechargement de Caddy.
- `telemetry.localhost` / `TELEMETRY_DOMAIN` → le dashboard télémétrie BMM (origine propre).
- Le domaine personnalisé d'un repo est admis par le TLS à la demande, qui interroge
  `http://api:3000/domains/ask` pour savoir si un hostname est autorisé avant d'émettre
  un certificat.

> **Piège lors des tests curl :** le bloc matche `Host: localhost`. Une requête avec
> `Host: 127.0.0.1` ou `Host: caddy` ne matche aucun site et reçoit le 200 vide par
> défaut de Caddy. Toujours tester avec `curl -H "Host: localhost" http://127.0.0.1/…`
> ou `curl http://localhost/…`.

Services Docker (`infra/compose/docker-compose.yml`) :

| Service | Image / build | Rôle |
|---|---|---|
| `caddy` | caddy:2-alpine | reverse proxy, TLS, en-têtes sécurité, anti-bot edge (le Caddyfile est monté → `docker compose restart caddy` recharge) |
| `web` | build apps/web → nginx:alpine | sert le bundle Vite statique (`apps/web/nginx.conf`) |
| `api` | build apps/api (Node 22, avec une étape `rust:1-alpine` qui compile bcweb-native) | API Fastify, port 3000 (interne) |
| `bot` | build apps/bot (Node 22) | bot Discord (aucun port exposé) |
| `provisioner` | build apps/provisioner (Node 22) | worker de mise en ligne des repos |
| `db` | postgres:16-alpine | datastore principal |
| `redis` | redis:7-alpine | buckets de rate-limit, le cache de lecture L2 partagé, l'état du monitor |
| `pgbouncer` | edoburu/pgbouncer | **opt-in** : ne démarre qu'avec `--profile pgbouncer`. Partage un petit pool de vraies connexions Postgres entre les réplicas d'API. On pointe l'API dessus avec `DB_HOST=pgbouncer DB_PORT=6432 DB_URL_PARAMS=?pgbouncer=true` ; `DIRECT_DATABASE_URL` reste sur `db:5432` pour que les migrations gardent une connexion directe |
| `minio` | minio/minio | stockage objet S3 pour les uploads (ports 9000/9001) |
| `telemetry` + `telemetry-db` | dashboard BMM + postgres:16-alpine | analytics BMM sur origine séparée |

**Discipline de config :** toute nouvelle variable d'env API doit être **explicitement
listée** dans le bloc `environment:` du service `api` du docker-compose.yml, sinon le
conteneur ne la verra pas même si elle est dans `.env`.

---

## 3. Comment l'héberger (déploiement)

```bash
cd infra/compose
cp .env.example .env          # définir POSTGRES_PASSWORD, JWT_SECRET (openssl rand -hex 32), clés S3
docker compose up -d          # monte toute la stack
docker compose exec api npm run seed        # projets, plans d'hébergement, un SUPERADMIN
docker compose exec api npm run seed:demo   # DEV UNIQUEMENT : un catalogue de démo réaliste
curl http://localhost/api/health       # { ok:true, db:true }
```

Le guide opérateur complet (compte admin, 2FA, rôles, OAuth, bot Discord, Stripe,
checklist production) est dans **[SETUP_GUIDE.md](../run/SETUP_GUIDE_FR.md)**. Rebuild/redéploie
un service après un changement de code :

```bash
docker compose -f infra/compose/docker-compose.yml build web api
docker compose -f infra/compose/docker-compose.yml up -d web api
# changements Caddyfile : docker compose restart caddy  (monté, pas de rebuild)
```

`server.mjs` **refuse de démarrer en production** avec le `JWT_SECRET` par défaut —
un garde-fou pour qu'un déploiement mal configuré ne parte pas avec une clé devinable.

---

## 4. Modèle de données (`packages/db/schema.prisma`)

Postgres via Prisma : **162 modèles**. Les porteurs, la colonne vertébrale à laquelle
tout le reste s'accroche :

- **User** — email, `passwordHash` (argon2id, *nullable* pour les comptes OAuth-only),
  `role` (USER/MOD/ADMIN/SUPERADMIN), `totpSecret`/`totpEnabled`/`totpRecoveryCodes`,
  `canControlServer` (droit server-control), `kofiDonorAt` (garde du discount unique).
- **OAuthAccount** — identité *auth* GitHub/Discord (distincte de DiscordLink).
- **CreatorLink** / **DiscordLink** — ids créateur BMM / ids Discord liés à un compte
  (gating + télémétrie + free-tier). Verrou de dé-liaison de 2 semaines.
- **CatalogItem** — app/plugin/theme/preset : owner, projet, kind, slug, `payloadKey`
  (S3), statut, vues/téléchargements, `deleteAt` (grâce 72h).
- **Submission** / **SubmissionComment** — la file de modération.
- **Project** / **BlogPost** / **BlogPermission** — projets, blogs par projet, droits
  de blog granulaires. **ShowcaseProject** — les "Other projects" gérés par l'admin.
- **ServerRepo** / **RepoFile** / **RepoFavorite** / **RepoAuditLog** /
  **RepoAccessEvent** — repos hébergés, fichiers, favoris, audit + trafic.
- **HostingPlan** / **HostingGroup** / **Subscription** / **Payment** /
  **PromoCode** / **PromoRedemption** / **FreeTierClaim** — billing + free tier.
- **GlobalAccessPolicy** (singleton) / **UserAccessPolicy** — whitelist/ban par-dessus
  les réglages par repo.
- **LoginAttempt** / **AuditLogEntry** / **ServerMetricSample** / **ServerAlertLog** —
  sécurité + télémétrie ops. **KofiDonation**, **Announcement**, **AdminSetting**,
  **ContactMessage**, **AnalyticsEvent**, **PasswordReset**.

Les ~125 modèles restants appartiennent chacun à un sous-système, et connaître le nom de
la famille suffit à les retrouver dans le schéma :

| Famille | Modèles |
|---|---|
| Discord | `DiscordActivity`, `BotGuild`, `BotAction`, `BotWarn`, `BotAnnouncement`, `DiscordEconomy`, `ModerationLog` |
| Économie & jeux | `UserEconomy`, `EconomyPurchase`, `EconomyLedger`, `GameScore`, `GameAward` |
| Sondages | `Poll`, `PollQuestion`, `PollChoice`, `PollOption`, `PollVote`, `PollAnswer` |
| Blog & docs | `BlogComment`, `BlogRevision`, `BlogReaction`, `DocPage`, `DocRevision`, `DocComment`, `CommentRevision` |
| Équipes & tableau de tâches | `Team`, `TeamMember`, `TeamInvite`, `StaffTeam`, `StaffTeamMember`, `AdminTask`, `AdminTaskEvent` |
| Contact, signalements, retours | `ContactThread`, `ContactThreadMessage`, `ContactTicket`, `ContactReply`, `Report`, `ReportMessage`, `Feedback` |
| Commerce hors hébergement | `MyoProduct`/`MyoRequest`/`MyoQuote`/`MyoDeliverable`, `ProjectProduct`, `MarketplaceSeller`, `PendingCart`, `PendingCheckout`, `FeatureSubscription`, `BoostCredit` |
| Fournisseur OIDC | `OidcKey`, `OAuthClient`, `OAuthCode`, `OAuthConsent`, `OAuthRefreshToken`, `OAuthPairwiseSub` |
| Légal & droits | `LegalVersion`, `LegalCategory`, `LegalPage`, `LegalSection`, `RightsNotice`, `ProtectedWork`, `BlockedUrl` |
| Charité | `CharityPot`, `CharityContribution` |
| Analytics & statut | `AnalyticsDaily`, `AnalyticsGoal`, `WebVital`, `InteractionEvent`, `ErrorEvent`, `ServiceOutage`, `IncidentNote`, `StatusSubscriber`, `SessionReplay` |
| API publique | `ApiKey`, `ApiUsageDay`, `ApiRequest` |
| Domaines & agents de repo | `CustomDomain`, `RepoAgent`, `ChangeEvent` |
| Sécurité des médias | `MediaHash`, `MediaFlag`, `ExpiringFile` |
| Langues à l'exécution | `SiteLocale` |

La **carte de schéma** (Admin → Modération) dessine tout cela en direct depuis
`schema.prisma`, y compris la dérive d'index : un index créé en SQL brut et jamais déclaré
dans le schéma, que la prochaine migration générée proposerait de supprimer. Fais-lui
confiance plutôt qu'à ce tableau.

---

## 5. Couche API (`apps/api/src`)

Trois choses vivent directement dans `apps/api/src` : `server.mjs`, les scripts de seed et
de maintenance (`seed.mjs`, `seed-content.mjs`, `seed-docs.mjs`, `seed-faq.mjs`,
`seed-site-guide.mjs`, `seed-demo.mjs`, `setup.mjs`, `boot-migrate.mjs` et une poignée de
scripts ponctuels de correction de données), et les deux répertoires ci-dessous :
`routes/` (71 modules) et `lib/` (109 modules).

`server.mjs` démarre Fastify, enregistre les plugins (cookies, rate-limit, multipart),
monte chaque module de route, lance les workers de fond (`lib/sweeper.mjs`,
`lib/monitor.mjs`)
et applique le garde-fou du secret de production. `lib/lib.mjs` contient les helpers
partagés : `db()` (singleton Prisma), `requireRole(...)` (exige aussi `totpEnabled`
pour MOD/ADMIN/SUPERADMIN — la surface admin protégée par 2FA, avec bypass implicite
SUPERADMIN), `requireElevated()` (step-up server-control), `logAudit()`, `slugify()`,
et `safeEqual()` (sha256 → `crypto.timingSafeEqual`, comparaison à temps constant).

### Modules de routes (`apps/api/src/routes/`)

Les 71, groupés par sous-système. Le but du tableau est de te faire ouvrir le bon
fichier, pas de redire ce qu'il contient ; **quelle garde protège quelle route** est une
question à laquelle répond en direct la carte RBAC (Admin → Modération), qui lit les
fichiers de routes eux-mêmes.

| Sous-système | Fichiers |
|---|---|
| **Comptes & identité** (14) | `auth.mjs` (register/login/logout, reset mot de passe, proof-of-work, l'étape TOTP, `oauth_only_account`), `oauth.mjs` (OAuth2 GitHub/Discord, `state` signé HMAC, email vérifié par le provider uniquement), `misc.mjs` (`/me`, recherche + détail utilisateur admin dont le **BC id**), `roles.mjs`, `admin-search.mjs`, `connections.mjs`, `links.mjs` (appairage creator/Discord), `avatar.mjs`, `social.mjs`, `api-keys.mjs`, `oidc-provider.mjs`, `transfers.mjs` (transfert de propriété), `closure.mjs` (fermeture de compte + questionnaire), `rights.mjs` |
| **Contenu & site** (15) | `blog.mjs`, `docs.mjs`, `faq.mjs`, `projects.mjs`, `showcase.mjs`, `showcase-requests.mjs`, `og.mjs` (images OG/Twitter rendues), `locales.mjs` (surcouche de langues à l'exécution), `studio.mjs`, `polls.mjs`, `campaigns.mjs`, `events.mjs`, `newsletter.mjs`, `announcements.mjs`, `status.mjs` |
| **Catalogue & uploads** (7) | `catalog.mjs` (parcourir/soumettre, le flux `catalog.json`, téléchargements), `catalogs.mjs` (catalogues communautaires), `uploads.mjs` (PUT S3 pré-signé, direct vers MinIO, taille/type plafonnés), `files.mjs`, `marketplace.mjs`, `media-flags.mjs`, `platform-assets.mjs` |
| **Repos & hébergement** (7) | `repos.mjs` (liste publique + **fingerprint**), `repo-dashboard.mjs` (dashboard owner, fichiers, favoris), `repo-agent.mjs` (gérer un repo sur le serveur du propriétaire), `hosting.mjs` (plans, capacité, prix), `hosting-content.mjs` (sandbox au service : bans, whitelist, bande passante), `domains.mjs` (domaine personnalisé + l'endpoint `ask` de Caddy), `boosts.mjs` |
| **Facturation** (6) | `stripe-webhook.mjs`, `payments-admin.mjs`, `promo.mjs`, `kofi.mjs` (webhook à token comparé en temps constant, flag donateur, stats d'objectif), `charity.mjs`, `myo.mjs` |
| **Modération & sécurité** (6) | `reports.mjs`, `sanctions.mjs`, `site-bans.mjs`, `access-policy.mjs` (whitelist/ban global + par utilisateur), `feedback.mjs`, `threads.mjs` |
| **Ops & contrôle serveur** (10) | `server-perf.mjs`, `server-control.mjs` (DB viewer / gestionnaire de fichiers / Docker / power, derrière un preHandler DANGEROUS = session + `canControlServer` + step-up 2FA, tables d'audit en lecture seule), `devtools.mjs`, `content-backup.mjs`, `my-backup.mjs`, `history.mjs`, `telemetry.mjs`, `analytics.mjs` (first-party), `webhooks.mjs`, `code-webhook.mjs` |
| **Discord & jeu** (4) | `bot.mjs` (la surface appelée par le bot, `x-bot-secret` en temps constant), `bot-emoji.mjs`, `economy-admin.mjs`, `game.mjs` |
| **Équipes & tâches** (2) | `teams.mjs`, `tasks.mjs` |

### Modules hors-route (`apps/api/src/lib/`)

Les 109, même traitement. `lib.mjs` est le module de helpers partagés décrit plus haut ;
le reste :

| Groupe | Modules |
|---|---|
| **Plomberie des requêtes** (14) | `lib.mjs`, `cache.mjs`, `redis.mjs`, `net.mjs`, `abuse.mjs`, `flags.mjs`, `boot-guard.mjs`, `boundedmap.mjs`, `errorlog.mjs`, `apiusage.mjs`, `geo.mjs`, `locales.mjs`, `thresholds.mjs`, `native.mjs` |
| **Stockage & fichiers** (14) | `storage.mjs`, `zip-path.mjs`, `expiring-files.mjs`, `media-hash.mjs`, `phash.mjs`, `plugin.mjs`, `bmm-formats.mjs`, `bmm-signature.mjs`, `bmmpa.mjs`, `snapshots.mjs`, `gitbackup.mjs`, `gitsource.mjs`, `seed-export.mjs`, `shred.mjs` |
| **Identité, accès, vie privée** (19) | `totp.mjs`, `signing.mjs`, `keyauth.mjs`, `creator-proof.mjs`, `identity-attestation.mjs`, `repofingerprint.mjs`, `siteban.mjs`, `sanctions.mjs`, `warns.mjs`, `urlblock.mjs`, `reserved-names.mjs`, `bot-guild-access.mjs`, `oidc.mjs`, `retention.mjs`, `erasure-log.mjs`, `user-erase.mjs`, `user-export.mjs`, `rights-match.mjs`, `staff-notes.mjs` |
| **Facturation & hébergement** (9) | `boostcredit.mjs`, `pending-checkout.mjs`, `stripe-reconcile.mjs`, `promo-rules.mjs`, `domain.mjs`, `repokind.mjs`, `charity.mjs`, `goal-stats.mjs`, `gift.mjs` |
| **Contenu, projets, communication** (18) | `project-config.mjs`, `project-keys.mjs`, `project-link.mjs`, `config-diff.mjs`, `config-schemas.mjs`, `catalog-kinds.mjs`, `changelog.mjs`, `studio-components.mjs`, `recipe-check.mjs`, `legal-freshness.mjs`, `contact-triage.mjs`, `mail.mjs`, `mail-samples.mjs`, `status-page.mjs`, `status-notify.mjs`, `threadbus.mjs`, `tasks.mjs`, `teams.mjs` |
| **Sondages** (5) | `poll-answer.mjs`, `poll-edit.mjs`, `poll-stats.mjs`, `poll-view.mjs`, `poll-visibility.mjs` |
| **Économie & jeux** (8) | `economy-curve.mjs`, `economy-season.mjs`, `economy-shop.mjs`, `game-season.mjs`, `casino-gif.mjs`, `casino-race.mjs`, `casino-rules.mjs`, `leaderboard-card.mjs` |
| **Discord** (2) | `bot-emoji.mjs`, `discord-storage.mjs` |
| **Images générées** (3) | `avatar-image.mjs`, `brand-logo-data.mjs`, `og-banner-data.mjs` |
| **Ops** (6) | `monitor.mjs`, `sweeper.mjs`, `metrics-compare.mjs`, `git-activity.mjs`, `webhooks.mjs`, `attention.mjs` |
| **Les cartes de code** (11) | `rbac-map.mjs`, `schema-map.mjs`, `migration-map.mjs`, `endpoint-graph.mjs`, `code-graph.mjs`, `code-flow.mjs`, `data-flow.mjs`, `infra-map.mjs`, `compose-map.mjs`, `stack-detect.mjs`, `secrets-map.mjs` |

Ceux qu'il faut avoir lus avant de toucher à quoi que ce soit à côté :

- **`storage.mjs`** : stockage compatible S3, MinIO par défaut ; endpoint et région sont
  pilotés par l'env, donc la bascule vers Cloudflare R2 est de la config pure.
- **`net.mjs`** : `safeFetch`, la garde SSRF : résolution DNS, blocage des plages privées,
  loopback, link-local, CGNAT et metadata, et re-vérification à chaque redirection.
- **`gitbackup.mjs`** : backup fichiers/DB façon git via `execFile('git', …)` : sans
  shell, et protégé contre la traversée de chemin.
- **`native.mjs`** : l'enveloppe autour de l'addon Rust (zip, zstd, BLAKE3, redimen-
  sionnement d'image) avec un repli JS, pour qu'un build sans l'addon marche quand même.
- **`repofingerprint.mjs`** : le système de **BC id** (§8).
- **`abuse.mjs`**, **`monitor.mjs`**, **`sweeper.mjs`**, **`totp.mjs`** : gardes anti-bot,
  échantillonnage perf et alertes, balayages d'expiration, RFC 6238.

`seed.mjs` n'est **pas** dans `lib/` : lui et les autres scripts de seed sont un niveau
au-dessus, dans `apps/api/src/`, parce que ce sont des points d'entrée lancés par
`npm run seed`, pas des imports.

### Couche performance (`cache.mjs`, `redis.mjs`)

- **`redis.mjs`** — un client ioredis partagé, paresseux (depuis `REDIS_URL`) ; tout ce
  qui l'utilise se dégrade proprement en mode « in-process » si Redis est absent/down.
- **`cache.mjs`** — cache TTL à deux niveaux pour les lectures publiques chaudes
  indépendantes du visiteur : L1 Map par process + L2 Redis (partagé entre les réplicas
  d'api), avec coalescing des requêtes (les miss concurrents partagent UN appel
  producteur — pas de ruée sur la DB à l'expiration). Utilisé par `GET /kofi/stats`
  (15 s, invalidé à chaque tip) et `GET /showcase` (10 s, invalidé aux éditions admin).
  `/projects` n'est volontairement PAS caché (visibilité par visiteur + effet de bord
  de swap programmé).
- **Rate limiter** — `@fastify/rate-limit`, 600/min par vraie IP client ; adossé à
  Redis quand `REDIS_URL` est défini, donc budget partagé entre réplicas. `/health` est
  exempté (probe Docker) et ses logs silencieux. Les rejets répondent 429 via le
  gestionnaire d'erreurs central, sans log de niveau erreur.
- **Cache prêt CDN** — nginx et Caddy marquent les `/assets/*` hashés immutables ; les
  téléchargements de fichiers hébergés ont `Cache-Control: max-age=300` + un `ETag`
  (sha256) ; `repo.json` 60 s. Un CDN Cloudflare gratuit devant délestera donc
  l'essentiel du trafic de lecture sans changer de code. PgBouncer est fourni en profil
  compose opt-in pour le multi-réplicas (le `directUrl` Prisma garde les migrations en
  connexion directe). Benchmarks + dimensionnement : `loadtest/BENCHMARK_FR.md`.

---

## 6. SPA Web (`apps/web/src`)

React 18 + Vite + Tailwind, un bundle servi par nginx. Seuls quatre fichiers sont à la
racine de `apps/web/src` : `main.jsx` (démarre l'app, applique thème + translucidité avant
le paint pour éviter les flashs), `App.jsx` (routeur, nav du haut, footer, et le point de
montage du fond permanent `Hero3D`), `i18n.jsx` (les dictionnaires EN/FR plus
`LangToggle`/`LangSelect` : une bascule à ≤2 langues, un **dropdown automatique à >2**) et
`index.css`. Tout le reste est dans cinq répertoires :

| Répertoire | Contenu |
|---|---|
| `pages/` (80) | un fichier par zone de route. `home.jsx` + `home-sections.jsx` + `home-variants.jsx`, `catalog.jsx`/`catalogpage.jsx`/`submit.jsx`, `auth.jsx`/`signin.jsx`/`twofa.jsx`, `dashboard.jsx`, `profile.jsx`/`publicprofile.jsx`, `repos.jsx`/`repo-dashboard.jsx`/`repopublic.jsx`/`repos-admin.jsx`, `project.jsx`, `blog.jsx`, `docs.jsx`, `faq.jsx`, `polls.jsx`, `teams.jsx`, `threads.jsx`, `studio.jsx`, `hosting.jsx`, `charity.jsx`, `myo*.jsx`, `legal.jsx`, `status*.jsx`, les dashboards bot `discord-*.jsx` et les outils `dev-*.jsx` |
| `lib/` (46) | la logique non visuelle : `api.js` (le wrapper fetch), `prefs.js`, `pow.js`/`pow-worker.js` (proof-of-work client), `analytics.js` + `gtm.js` (Google Tag Manager sous consentement), `consent.js`, `roles.js`, `seo.js`, `money.js`, `format.js`, `merge3.js`, `zip-read.js`, `navLayout.js`, `lazy-chunk.js` |
| `ui/` (43) | les composants partagés : `ui.jsx`, `md.jsx` (markdown), `theme.jsx` + les fichiers `theme-*.js` de tokens/presets, `brand.jsx`, `Avatar.jsx`, `CookieConsent.jsx`, `ErrorBoundary.jsx`, `command-palette.jsx`, `IntroContext.jsx`, les visualiseurs `*-map.jsx` des cartes de code |
| `editor/` (14) | les surfaces d'édition, que la version précédente de ce document omettait entièrement : `markdown-editor.jsx` (l'hôte de l'éditeur B.MD), `project-config-editor.jsx`, `canvas-studio.jsx` + `studio-dock.jsx` + `studio-shortcuts.jsx`, `table-builder.jsx`, `icon-picker.jsx`, `kbd-picker.jsx`, `history-modal.jsx`, `diff-merge-modal.jsx`, `comments-modal.jsx`, `selection-toolbar.jsx`, `site-theme-cards.jsx` |
| `hero/` (9) | `Hero3D.jsx` et les autres surfaces Three.js (`HeroShowcase.jsx`, `ProjectShowcase.jsx`, `ScenePreview.jsx`, `scene-shapes.js`, `scene-events.js`), plus `RrwebPreview.jsx` |

`auth.jsx` (le contexte d'auth : `{ user, loading, login, loginWith2fa, register,
logout }`) vit dans `pages/`, à côté des écrans qui s'en servent.

Deux corrections à dire franchement, parce que l'ancien texte envoyait le lecteur dans le
mauvais fichier : **le dashboard Admin n'est pas dans `pages.jsx`.** C'est
`pages/admin.jsx`, environ 24 000 lignes, et c'est là que `AdminUsers` et
`UserDetailModal` sont définis ; dix-huit autres écrans admin ont été sortis dans
`pages/admin-*.jsx`. `pages/pages.jsx` fait environ 640 lignes et ne contient que quelques
morceaux de page partagés.

Le **renderer markdown** n'est plus local non plus : le blog, les docs et les pages projet
passent par `@bettercommunity/bmd` depuis `packages/bmd`, avec `ui/md.jsx` comme fine
enveloppe côté app et `packages/bmd-editor` derrière l'UI d'édition. Voir
[CUSTOM_MARKDOWN.md](CUSTOM_MARKDOWN.md) pour le jeu de directives.

### L'orbe héro (`Hero3D.jsx`, `IntroContext.jsx`)

Un unique canvas Three.js qui est À LA FOIS le loader d'intro ET le fond permanent :

- **Intro :** l'orbe **se construit à partir de ses éclats** — démarre entièrement
  fracturée (`fractureState=1`, re-seedée), s'assemble en orbe entière (`→0`) en
  grandissant, puis glisse vers son coin de fond. Skippable ; gardée uniquement sur le
  flag localStorage explicite `bcweb_skip_intro` (PAS `prefers-reduced-motion`, que
  Windows active en douce et qui tuerait l'intro).
- **Scroll :** une **spirale** de descente randomisée à chaque chargement ; sa longueur
  (tours + descente) dépend de la hauteur de page via un facteur `pageSpan` (page
  longue = voyage plus long). Expose `--reveal-x` pour que les apparitions de la home
  dérivent depuis le côté de l'orbe.
- **Fracture :** survol/clic raycast l'orbe → elle éclate en vrais fragments
  triangulaires et se recompose (`fractureState` tweené GSAP → uniform `uFracture`).
- **Transition de page optionnelle** (off par défaut, préf `bcw_orb_page_transition`) :
  à la navigation le routeur émet `bcweb:orb-transition` ; l'orbe éclate, la caméra
  plonge vers un fragment aléatoire (offset appliqué en additif par-dessus la parallaxe
  pour ne pas se battre), puis se recompose.

Apparitions de la home : `useScrollReveal` utilise un IntersectionObserver +
MutationObserver (contenu async). Fix scroll-rapide : si une apparition se déclenche
alors que l'élément est déjà bien dans/au-dessus du viewport, il apparaît d'un coup
(`reveal-instant`) au lieu de jouer le long rise+blur à l'écran. Le délai de stagger
est plafonné pour que les grilles ne traînent pas derrière le scroll.

---

## 7. Bot Discord (`apps/bot/src`)

Dix modules de premier niveau et 28 fonctionnalités. Le bot ne détient **aucun accès à la
base** : tout passe par la surface `/bot/*` de l'API avec le `x-bot-secret` partagé, et
c'est ce qui lui permet d'être un conteneur séparé.

`index.mjs` est un **gestionnaire de connexion**, pas un simple démarrage : il se connecte
quand un token existe et que le bot est activé, se reconnecte quand le token change, et se
déconnecte quand il est désactivé, si bien que le token peut être défini ou tourné depuis
le dashboard sans redémarrage. Il enregistre aussi les handlers d'événements de la
gateway, une ligne par événement.

| Module | Ce que c'est |
|---|---|
| `config.mjs` | la config éditée par l'admin, refetchée toutes les 30 s ; le `DISCORD_TOKEN` de l'env l'emporte |
| `api.mjs` | le client BCWEB minimal (secret partagé, `SITE_URL`) |
| `commands.mjs` | commandes slash + routage des interactions |
| `ui.mjs` | le builder Components V2 par lequel passe chaque message |
| `i18n.mjs` | surcharges admin → dictionnaire intégré → anglais ; langue du serveur, sinon locale Discord du membre |
| `store.mjs` | état d'exécution en mémoire (salons vocaux temporaires, throttles, compteurs de modération) |
| `logbuffer.mjs` | ring buffer de la sortie console du bot, envoyé dans le heartbeat et affiché en direct dans l'onglet admin |
| `nav.mjs` | **ajouté tout récemment.** Une interaction de composant ne transporte qu'un custom id, donc un écran ouvert depuis un autre écran était une impasse. L'origine voyage désormais dans le custom id du bouton qui ouvre l'écran suivant (`eco:shop:lvl` = « ouvre la boutique, tu viens de la carte de niveau »), et la destination en tire un seul bouton Retour cohérent, au lieu d'un Retour câblé à la main par écran qui pointe au mauvais endroit six écrans plus loin |
| `help.mjs` | **ajouté tout récemment.** La source unique de l'explication longue d'une fonctionnalité, lue de deux façons : le bouton « Learn more » sur la carte de la fonctionnalité (répondu en éphémère, donc le salon n'est pas touché) et `/help`. Aucune des deux ne possède le texte, elles ne peuvent donc pas diverger |

`features/` (28), par domaine :

- **Accès & onboarding** : `gating.mjs` (accès multi-rôles, exigences par rôle,
  re-vérification périodique, `/refreshroles`), `onboarding.mjs` (la carte qu'un serveur
  voit à l'arrivée du bot et sur `/setup`), `configure.mjs`, `rolepanel.mjs`,
  `welcome.mjs`, `scanMembers.mjs` (pousse le roster complet, pour que la base de membres
  admin ne se limite pas à ceux qui ont parlé), `links.mjs` (draine promptement le buffer
  de liaisons Discord en attente).
- **Modération & logs** : `moderation.mjs`, `automod.mjs` (règles data-driven, décisions
  déterministes dans des fonctions pures, Discord tenu à distance), `modqueue.mjs` (la
  modération demandée depuis le site, puisque le site ne peut pas joindre Discord),
  `logs.mjs` (une table de routage par serveur, posts de forum avec tags, batching, une
  file par destination qui respecte les rate limits), `logevents.mjs`, `logcmd.mjs`.
- **Économie & jeux** : `economy.mjs` (bufferise messages, réactions et secondes de voix,
  flush vers l'API une fois par minute ; seuls les comptes liés gagnent), `season.mjs`,
  `casino-live.mjs`, `casino-lobbies.mjs` (volontairement sans Discord, pour qu'un simple
  test node puisse le piloter), `giveaways.mjs`.
- **Poster pour le compte du site** : `announce.mjs` + `announce-route.mjs` (où va une
  annonce et qui est pingué), `blog.mjs`, `kofi.mjs`, `payments.mjs` (paiements et
  remboursements), `alerts.mjs` (alertes server-perf), `dm.mjs` (DM admin en file),
  `panel.mjs`, `icons.mjs` (téléverse les PNG d'icônes du site en emojis d'application),
  `joinToCreate.mjs` (salons vocaux temporaires).

Chaque message est un **conteneur Discord Components V2** construit par `ui.mjs`, pas un
embed : pas de `content`, pas d'`embeds`, au plus 40 composants et 4000 caractères, et le
flag ne peut pas changer à l'édition, donc un message envoyé en V2 s'édite en V2.
Nécessite les intents privilégiés **Server Members** et **Message Content** (les intents
réactions, modération, expressions et webhooks qu'il demande aussi ne sont pas
privilégiés).

---

## 8. Le système de BC id (`repofingerprint.mjs`)

Références opaques et stables de support/modération. Tous sont
`HMAC-SHA256(JWT_SECRET, matériel)` tronqués à 8 caractères base32 (alphabet
`ABCDEFGHJKLMNPQRSTVWXYZ23456789` — sans voyelles/ambigus), formatés `PREFIX-XXXX-XXXX` :

- `userBcId(userId)` → **`BC-XXXX-XXXX`** — niveau compte, depuis l'id de compte
  immuable (stable + cherchable). Affiché sur les cartes/modals utilisateur admin.
- `repoFingerprint({repoId, ownerId, creatorIds, discordIds, kofi})` → **`BCR-…`**.
- `itemFingerprint({itemId, ownerId, creatorIds})` → **`BCI-…`**.
- `findUserIdByBcId(p, code)` — résout un `BC-…` collé vers un utilisateur en le
  recalculant sur tous les comptes (admin uniquement). `bcIdBody`/`looksLikeBcId`
  tolèrent casse/espaces/préfixe manquant : `bc 7k2m9xq4`, `BC-7K2M-9XQ4`,
  `BCQQEHCQAF` matchent tous.

Ils ne révèlent rien seuls et ne sont pas des secrets.

---

## 9. Modèle de sécurité

- **Auth** : argon2id, cookies/2FA/step-up signés HMAC, TOTP 2FA requise pour les
  niveaux admin, élévation step-up pour server-control, CSRF OAuth via `state` signé.
- Comparaisons de secrets **à temps constant** partout (`safeEqual`) : token Ko-fi,
  secret bot, HMAC PoW, state OAuth.
- **Injection** : Prisma paramétré ; le SQL brut du DB-viewer valide les noms de
  table/colonne contre `pg_class`/`information_schema` avant interpolation ; git via
  `execFile` (sans shell).
- **SSRF** : `safeFetch` bloque les plages privées + re-vérifie les redirections.
- **Traversal/zip-slip** : `safePath()` confine le gestionnaire de fichiers server-control
  à sa racine ; chaque nom écrit dans un zip que nous distribuons passe par
  `zipEntryName()` dans `lib/zip-path.mjs`, qui supprime les segments `.` et `..`,
  normalise les antislashs et retire un préfixe de lecteur Windows, pour que l'archive ne
  puisse pas ordonner à un extracteur d'écrire hors du répertoire cible.
- **Edge** : CSP + en-têtes sécurité + blocages bad-UA/scan-paths (Caddy) + anti-bot
  Fastify + proof-of-work sur signup/contact.
- Les tables d'audit (`AuditLogEntry`/`LoginAttempt`/`RepoAuditLog`) sont en lecture
  seule dans le DB viewer.

---

## 10. Aide-mémoire workflow dev

```bash
# dev frontend (proxifie /api → :3000)
cd apps/web && npm run dev
# rebuild + redéploiement après édition
docker compose -f infra/compose/docker-compose.yml build web api && \
  docker compose -f infra/compose/docker-compose.yml up -d web api
# valider les configs
docker compose exec web nginx -t
docker compose exec caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
# test de charge/stress
node loadtest/run.mjs   # voir loadtest/BENCHMARK.md
# les guides : chaque lien relatif résout, et chaque service/script/variable/chemin
# nommé par un guide existe vraiment (les deux tournent en CI)
node guides/check-links.mjs
node guides/check-claims.mjs
```

Annuler le dernier commit en gardant les changements indexés : `git reset --soft HEAD~1`.

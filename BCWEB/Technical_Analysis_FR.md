# BCWEB — Analyse technique (plongée développeur)

> Une explication de zéro de **BetterCommunity Web** : comment tout est câblé,
> comment l'héberger, ce que fait chaque fichier, et comment fonctionne chaque
> sous-système. Voir [ARCHITECTURE.md](./ARCHITECTURE.md) pour le *pourquoi* de la
> stack ; ce document est le *comment* au niveau du code. Compagnon :
> **App_Features_FR.md** (tour des fonctionnalités).
>
> Ce fichier n'est volontairement **pas commité** — c'est une référence technique vivante.

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
  api/          API HTTP Fastify (le cerveau — auth, données, admin, hosting, billing)
  web/          SPA React 18 + Vite (tout le site public + les dashboards)
  bot/          Bot Discord.js (gating, Ko-fi, alertes, modération, panneaux)
  provisioner/  met les repos hébergés EN LIGNE, gère isolation/quota (point d'extension)
packages/
  db/           Schéma Prisma (schema.prisma) + client généré, partagé api+bot
infra/
  compose/      docker-compose.yml + .env(.example)  — le déploiement
  caddy/        Caddyfile — reverse proxy edge, en-têtes de sécurité, anti-bot
loadtest/       harnais de benchmark + stress (BENCHMARK.md, run.mjs)
bmm/, bsm/      assets par projet, dashboard télémétrie, presets de seed
```

---

## 2. Topologie d'exécution (le trajet d'une requête)

Tout passe par **Caddy** sur les ports 80/443. Il route selon l'**en-tête Host** :

- `localhost` / `SITE_DOMAIN` → le bloc de site principal.
  - `handle_path /api/*` → retire `/api` → `reverse_proxy api:3000` (Fastify).
  - `/hosting/*`, `/sitemap.xml`, `/robots.txt`, `/repos.json`, `/catalog.json` → api.
  - tout le reste → `reverse_proxy web:80` (nginx servant la SPA buildée).
- `telemetry.localhost` / `TELEMETRY_DOMAIN` → le dashboard télémétrie BMM (origine propre).

> **Piège lors des tests curl :** le bloc matche `Host: localhost`. Une requête avec
> `Host: 127.0.0.1` ou `Host: caddy` ne matche aucun site et reçoit le 200 vide par
> défaut de Caddy. Toujours tester avec `curl -H "Host: localhost" http://127.0.0.1/…`
> ou `curl http://localhost/…`.

Services Docker (`infra/compose/docker-compose.yml`) :

| Service | Image / build | Rôle |
|---|---|---|
| `caddy` | caddy:2-alpine | reverse proxy, TLS, en-têtes sécurité, anti-bot edge (le Caddyfile est monté → `docker compose restart caddy` recharge) |
| `web` | build apps/web → nginx:alpine | sert le bundle Vite statique (`apps/web/nginx.conf`) |
| `api` | build apps/api (Node 20) | API Fastify, port 3000 (interne) |
| `bot` | build apps/bot | bot Discord (aucun port exposé) |
| `provisioner` | build apps/provisioner | worker de mise en ligne des repos |
| `db` | postgres:16 | datastore principal |
| `redis` | redis | sessions/rate-limit/jobs |
| `minio` | minio | stockage objet S3 pour les uploads (ports 9000/9001) |
| `telemetry` + `telemetry-db` | dashboard BMM | analytics BMM sur origine séparée |

**Discipline de config :** toute nouvelle variable d'env API doit être **explicitement
listée** dans le bloc `environment:` du service `api` du docker-compose.yml, sinon le
conteneur ne la verra pas même si elle est dans `.env`.

---

## 3. Comment l'héberger (déploiement)

```bash
cd infra/compose
cp .env.example .env          # définir POSTGRES_PASSWORD, JWT_SECRET (openssl rand -hex 32), clés S3
docker compose up -d          # monte toute la stack
docker compose exec api npm run seed   # projets, plans d'hébergement, un SUPERADMIN
curl http://localhost/api/health       # { ok:true, db:true }
```

Le guide opérateur complet (compte admin, 2FA, rôles, OAuth, bot Discord, Stripe,
checklist production) est dans **[SETUP_GUIDE.md](./SETUP_GUIDE.md)**. Rebuild/redéploie
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

Postgres via Prisma. Les modèles porteurs :

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

---

## 5. Couche API (`apps/api/src`)

`server.mjs` démarre Fastify, enregistre les plugins (cookies, rate-limit, multipart),
monte chaque module de route, lance les workers de fond (`sweeper.mjs`, `monitor.mjs`)
et applique le garde-fou du secret de production. `lib.mjs` contient les helpers
partagés : `db()` (singleton Prisma), `requireRole(...)` (exige aussi `totpEnabled`
pour MOD/ADMIN/SUPERADMIN — la surface admin protégée par 2FA, avec bypass implicite
SUPERADMIN), `requireElevated()` (step-up server-control), `logAudit()`, `slugify()`,
et `safeEqual()` (sha256 → `crypto.timingSafeEqual`, comparaison à temps constant).

### Modules de routes (`apps/api/src/routes/`)

| Fichier | Gère |
|---|---|
| `auth.mjs` | register/login/logout, reset mot de passe, proof-of-work (`/auth/pow`), étape TOTP (`/auth/login/2fa`) ; gestion `oauth_only_account` |
| `oauth.mjs` | login/signup OAuth2 GitHub/Discord — `state` signé HMAC, email vérifié par le provider uniquement, sonde `/auth/oauth/providers` |
| `misc.mjs` | `/me`, **recherche + détail utilisateur** admin (recherche par creator/Discord/**BC id**), rôles, liste billing |
| `catalog.mjs` | parcourir/soumettre des items, flux `catalog.json`, téléchargements |
| `uploads.mjs` | PUT S3 pré-signé (direct-vers-MinIO, taille/type plafonnés) |
| `blog.mjs` | CRUD blog par projet + Latest-news de la home |
| `projects.mjs` / `showcase.mjs` | config projets fixes + showcase "Other projects", mises à jour planifiées, annonces/visibilité |
| `repos.mjs` / `repo-dashboard.mjs` | liste publique des Server-Repos (+ **fingerprint**), dashboard owner, fichiers, favoris, lookup admin |
| `hosting.mjs` / `hosting-content.mjs` / `stripe-webhook.mjs` | plans, capacité, prix, Stripe checkout/portal/webhook, sandbox au service (bans/whitelist/bande passante) |
| `announcements.mjs` | bannière site + notifications |
| `access-policy.mjs` | whitelist/ban global + par-utilisateur |
| `server-perf.mjs` / `server-control.mjs` | dashboard perf ; DB viewer/gestionnaire de fichiers/Docker/power (preHandler DANGEROUS = session + `canControlServer` + step-up 2FA ; tables d'audit en lecture seule) |
| `kofi.mjs` | webhook Ko-fi (token temps constant), flag donateur, stats d'objectif |
| `bot.mjs` | surface API appelée par le bot Discord (`x-bot-secret` temps constant) |
| `promo.mjs` / `links.mjs` / `analytics.mjs` | codes promo, appairage creator/Discord, analytics first-party |

### Modules hors-route

`storage.mjs` (S3/MinIO + usage par préfixe), `net.mjs` (`safeFetch` — garde SSRF :
résolution DNS + blocage des plages privées/loopback/link-local/CGNAT/metadata,
re-vérif de chaque redirection), `abuse.mjs` (gardes anti-bot/anti-DDoS Fastify),
`gitbackup.mjs` (backup fichiers/DB façon git via `execFile('git', …)`, sans shell),
`plugin.mjs` (validation d'intégrité de plugin), `monitor.mjs` (échantillonnage perf +
alertes), `sweeper.mjs` (balayages d'expiration : repos, submissions, deleteAt),
`totp.mjs` (RFC 6238), `repofingerprint.mjs` (le système de **BC id**, §8), `seed.mjs`
(bootstrap idempotent).

---

## 6. SPA Web (`apps/web/src`)

React 18 + Vite + Tailwind, un bundle servi par nginx. `main.jsx` démarre l'app
(applique thème + translucidité avant le paint pour éviter les flashs). `App.jsx`
contient le routeur, la nav du haut, le footer, et monte le fond permanent `Hero3D`.
`api.js` est le wrapper fetch ; `auth.jsx` le contexte d'auth (`{ user, loading,
login, loginWith2fa, register, logout }`).

Fichiers clés : `pages.jsx` (le gros — Home, Catalog, Auth, Dashboard, Settings,
Contact, et tout le dashboard **Admin** dont `AdminUsers`/`UserDetailModal`),
`profile.jsx`, `repos.jsx` + `repo-dashboard.jsx`, `project.jsx` (pages projet +
"Other projects" + showcase + compte à rebours d'annonce), `blog.jsx`, `uploads.jsx`,
`i18n.jsx` (dictionnaires EN/FR + `LangToggle`/`LangSelect` — bascule à ≤2 langues,
**dropdown auto à >2**), `theme.jsx`, `prefs.js` (préfs translucidité + transition
d'orbe), `pow.js`/`pow-worker.js` (proof-of-work client), `md.jsx` (markdown),
`ui.jsx` (composants partagés), `brand.jsx` (logos), `CookieConsent.jsx`,
`analytics.js` + `gtm.js` (Google Tag Manager sous consentement).

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

`index.mjs` démarre discord.js ; `config.mjs` fusionne la config DB (dashboard) avec
l'env (`DISCORD_TOKEN` gagne) ; `api.mjs` appelle l'API BCWEB avec le `x-bot-secret`
partagé ; `store.mjs` l'état local. Fonctionnalités dans `features/` : `gating.mjs`
(accès multi-rôles avec exigences par rôle + re-vérif périodique + `/refreshroles`),
`kofi.mjs` (embeds de tips Ko-fi), `alerts.mjs` (alertes server-perf), `moderation.mjs`,
`welcome.mjs`, `joinToCreate.mjs` (voix), `blog.mjs` (annonces de posts), `panel.mjs`
(panneaux embed). Chaque message du bot est un embed. Nécessite les intents privilégiés
**Server Members** + **Message Content**.

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

## 9. Modèle de sécurité (résumé — audit complet dans SECURITY_AUDIT.md)

- **Auth** : argon2id, cookies/2FA/step-up signés HMAC, TOTP 2FA requise pour les
  niveaux admin, élévation step-up pour server-control, CSRF OAuth via `state` signé.
- Comparaisons de secrets **à temps constant** partout (`safeEqual`) : token Ko-fi,
  secret bot, HMAC PoW, state OAuth.
- **Injection** : Prisma paramétré ; le SQL brut du DB-viewer valide les noms de
  table/colonne contre `pg_class`/`information_schema` avant interpolation ; git via
  `execFile` (sans shell).
- **SSRF** : `safeFetch` bloque les plages privées + re-vérifie les redirections.
- **Traversal/zip-slip** : confinement `safePath()` ; extraction d'archives via
  `enclosed_name()`.
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
```

Annuler le dernier commit en gardant les changements indexés : `git reset --soft HEAD~1`.

# BCWEB — Les variables `.env` expliquées (FR)

> Le vrai `.env` vit dans `infra/compose/.env` (copié depuis `.env.example`). Il n'est
> **jamais commité** (il contient tes secrets). Ce document explique chaque variable.
> 🇬🇧 [ENV_EN.md](ENV_EN.md) · déploiement complet : [DEPLOY_FR.md](DEPLOY_FR.md) · add-ons : [ADDONS_FR.md](ADDONS_FR.md)

**Générer les secrets** : `openssl rand -hex 32` pour les clés (`JWT_SECRET`, etc.).

---

## 1. Base de données (obligatoire)
| Variable | Rôle |
|---|---|
| `POSTGRES_USER` | utilisateur Postgres (défaut `bcweb`) |
| `POSTGRES_PASSWORD` | **mot de passe DB — mets-en un fort** |
| `POSTGRES_DB` | nom de la base (défaut `bcweb`) |

## 2. Sécurité (obligatoire)
| Variable | Rôle |
|---|---|
| `JWT_SECRET` | signe les sessions/cookies. **Chaîne aléatoire longue** (`openssl rand -hex 32`). En prod l'API refuse de démarrer avec la valeur d'exemple. |
| `LINK_LOOKUP_SECRET` | signe le lookup de liaison BMM↔BCWEB et le handoff SSO télémétrie (le service télémétrie vérifie la même valeur sous le nom `BC_LINK_SECRET`). Il a un fallback — mais c'est `dev-link-secret`, commité dans ce repo : mets-en un vrai. `openssl rand -hex 32`. |
| `BOT_SHARED_SECRET` | l'identifiant du bot Discord auprès de l'API. Non défini, compose donne **à la fois** à l'api et au bot la valeur de `LINK_LOOKUP_SECRET` : ils sont donc d'accord — ne le pose que pour donner au bot son propre secret. Exception : le bot lancé **hors** compose ne lit que celle-ci. |
| `AUDIT_SECRET` | clé HMAC de la chaîne d'audit inviolable. Non défini → retombe sur `JWT_SECRET` (ça va). ⚠️ **La changer alors que des entrées existent invalide la vérification de toutes les précédentes** — pose-la une fois, avant la mise en ligne. |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | Le premier compte SUPERADMIN, créé par `npm run setup`. **Règle les deux avant le premier lancement** : le compte n'est créé que s'il n'existe pas déjà, donc les changer ensuite ne fait rien. Non définis, chaque installation part avec le même mot de passe publié par défaut (`admin@bettercommunity.local` / `change-me-now`). |

## 3. Domaine & HTTPS (obligatoire en prod)
| Variable | Rôle |
|---|---|
| `SITE_DOMAIN` | ton **domaine nu** (ex. `community.example.com`) — Caddy s'y attache et provisionne le HTTPS. (Local : `http://localhost:5176`) |
| `SITE_URL` | l'**URL publique complète** (ex. `https://community.example.com`) — utilisée dans les emails, redirections Stripe, liens du bot, l'issuer OIDC. |
| `COOKIE_DOMAIN` | `.ton-domaine.com` (point initial) pour que le cookie de session atteigne aussi les sous-domaines (télémétrie). Local : `localhost`. |

## 4. Stockage objet — MinIO / S3 (obligatoire)
| Variable | Rôle |
|---|---|
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | identifiants du stockage objet (MinIO par défaut). |
| `S3_BUCKET` | nom du bucket (défaut `bcweb`). |
| `S3_ENDPOINT` | endpoint S3 (défaut MinIO interne `http://minio:9000`). |
| `S3_REGION` | région (`us-east-1` en local, `auto` pour Cloudflare R2). |
| `S3_PUBLIC_ENDPOINT` | l'URL **publique** du stockage (les navigateurs y accèdent via des URLs pré-signées). |
| `REPO_EXPORT_MAX_MB` | plafond (Mo) sur l'endpoint admin « télécharger tout le dépôt en un zip ». L'export est *streamé*, donc ça borne la taille de transfert, pas la mémoire. Défaut `250` ; au-delà, l'admin récupère les fichiers un par un. |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW` | budget de requêtes par IP. Défauts `600` / `1 minute` — généreux pour un humain (~10 req/s) et c'est ce qui protège la DB en cas d'abus, donc **garde le défaut en production**. À monter uniquement pour benchmarker la capacité brute d'une route (`loadtest/`) : depuis une seule IP, le limiter déleste sinon tout le flood et chaque chiffre n'est qu'un 429. |

*(Pour migrer vers Cloudflare R2 : ne change que ces 5 variables — voir [ADDONS_FR.md](ADDONS_FR.md) §4.)*

## 5. Paiements — Stripe (optionnel)
| Variable | Rôle |
|---|---|
| `STRIPE_SECRET_KEY` | clé secrète Stripe (hébergement/boosts payants). |
| `STRIPE_WEBHOOK_SECRET` | secret du webhook (`whsec_…`). **Sans lui, le webhook renvoie 503** → aucun paiement enregistré. |

## 6. Connexion OAuth (optionnel — « se connecter avec … »)
| Variable | Rôle |
|---|---|
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | login GitHub. |
| `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` | login Discord. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | login Google. |

Callback à déclarer chez chaque fournisseur : `<SITE_URL>/api/auth/oauth/<provider>/callback`.

## 7. Bot Discord (optionnel)
| Variable | Rôle |
|---|---|
| `DISCORD_TOKEN` | token du bot. Vide = bot inactif (tu peux aussi le mettre depuis l'admin). |

## 8. Télémétrie BMM (optionnel)
| Variable | Rôle |
|---|---|
| `TELEMETRY_DOMAIN` | sous-domaine du dashboard télémétrie (ex. `https://telemetry.ton-domaine.com`). |
| `TELEMETRY_PUBLIC_URL` | URL du bouton « ouvrir la télémétrie » — garde égal à `TELEMETRY_DOMAIN`. |
| `TELEMETRY_ADMIN_KEY` | clé admin serveur-à-serveur pour piloter les limites de la télémétrie. |
| `TELEMETRY_API_KEY` | clé d'ingestion de la télémétrie. |

## 9. Email transactionnel (optionnel — confirmation + reset mot de passe)
| Variable | Rôle |
|---|---|
| `EMAIL_ENABLED` | `true` pour activer l'envoi. **Off par défaut** → le reset renvoie le token dans la réponse (dev), aucun email envoyé. |
| `SMTP_HOST` | serveur SMTP (ex. `mail.infomaniak.com`). |
| `SMTP_PORT` | `587` (STARTTLS) ou `465` (TLS implicite). |
| `SMTP_USER` | login SMTP = **une vraie boîte mail** (pas un alias). |
| `SMTP_PASS` | mot de passe de cette boîte. **Secret.** ⚠️ un `$` dans le mot de passe doit être **doublé** `$$` dans le `.env` (interpolation Docker Compose). |
| `SMTP_FROM` | l'expéditeur affiché, ex. `BetterCommunity <noreply@ton-domaine.com>` (peut être un alias de la boîte authentifiée). |

## 10. Redis (optionnel)
| Variable | Rôle |
|---|---|
| `REDIS_PASSWORD` | mot de passe Redis (AUTH interne). Le défaut suffit pour une machine unique ; mets-en un fort en prod quand même. |

## 11. Base sur un serveur séparé / PgBouncer (avancé — voir [ADDONS_FR.md](ADDONS_FR.md))
| Variable | Rôle |
|---|---|
| `DATABASE_URL` | override URL complète → pointe la stack vers un **Postgres managé / 2ᵉ VPS** (endpoint poolé). Vide = Postgres local. |
| `DIRECT_DATABASE_URL` | URL directe (non poolée) — pour les migrations. |
| `DB_HOST` / `DB_PORT` / `DB_URL_PARAMS` | pour router l'API via **PgBouncer** (`pgbouncer` / `6432` / `?pgbouncer=true`). |
| `PGBOUNCER_UPSTREAM_HOST` / `PGBOUNCER_UPSTREAM_PORT` | pour que PgBouncer poole une base managée/distante au lieu du `db` local. |

## 12. Divers
| Variable | Rôle |
|---|---|
| `VITE_GTM_ID` | ID Google Tag Manager (analytics front, optionnel). Injecté au build. |
| `NODE_OPTIONS` | flags V8 pour l'API. L'image pose déjà `--max-old-space-size=384` : V8 dimensionne son heap sur la RAM de **l'hôte** et ne lit *pas* la limite cgroup — dans un conteneur limité en mémoire, un heap non borné dépasse la limite et se fait OOM-kill au lieu de collecter. À monter en même temps que la limite mémoire du conteneur. |
| `KOFI_WEBHOOK_TOKEN` | token de vérification du webhook Ko-fi. Posé ici, il **prime** sur le token défini en admin et le verrouille dans le dashboard (même logique que `DISCORD_TOKEN`). Vide = géré depuis l'UI admin. |
| `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET` | **connexion de profil** Twitch (pas le login). Enregistre `<SITE_URL>/api/auth/connect/twitch/callback`. |
| `STEAM_API_KEY` | connexion de profil Steam (OpenID — pas de secret). [steamcommunity.com/dev/apikey](https://steamcommunity.com/dev/apikey). |
| `MINIO_API_CORS_ALLOW_ORIGIN` | origine CORS pour laquelle MinIO répond aux uploads pré-signés du navigateur. Défaut `*` — correct avec la stack fournie ; à restreindre à ton `SITE_URL` si tu exposes MinIO publiquement. |

> **Une variable ne marche que si compose la transmet.** L'API lit `process.env`, mais dans
> Docker elle ne voit que ce que `infra/compose/docker-compose.yml` passe au service `api`.
> Ajouter une variable au `.env` que compose ne transmet pas ne fait **rien** — le code
> retombe silencieusement sur son défaut. Si tu en ajoutes une, ajoute-la aux deux endroits
> (ça nous est arrivé : `RATE_LIMIT_MAX`, `REPO_EXPORT_MAX_MB` et `AUDIT_SECRET` étaient
> documentées ici alors que compose les laissait tomber). Vérifie avec `docker compose config`
> — il affiche ce que chaque service recevra réellement.

*(Variables internes avec des défauts sûrs, rarement à toucher : `TELEMETRY_INTERNAL_URL`,
`TELEMETRY_DATABASE_URL`, `DISCORD_CONTACT_WEBHOOK`. Le **SSO OpenID Connect** ne nécessite
aucune variable — la clé est auto-générée et l'issuer = `SITE_URL`.)*

---

### Le strict minimum pour démarrer en prod
`POSTGRES_PASSWORD`, `JWT_SECRET`, `SITE_DOMAIN`, `SITE_URL`, `COOKIE_DOMAIN`,
`S3_ACCESS_KEY`, `S3_SECRET_KEY`. Tout le reste est optionnel et s'active au besoin.

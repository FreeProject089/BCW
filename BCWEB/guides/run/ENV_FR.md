# BCWEB — Les variables `.env` expliquées (FR)

> Le vrai `.env` vit dans `infra/compose/.env` (copié depuis `.env.example`). Il n'est
> **jamais commité** (il contient tes secrets). Ce document explique chaque variable.
> 🇬🇧 [ENV_EN.md](ENV_EN.md) · déploiement complet : [DEPLOY_FR.md](DEPLOY_FR.md) · add-ons : [ADDONS_FR.md](ADDONS_FR.md)

**Tu n'es pas obligé de l'écrire à la main.** `infra/configure-env.sh` (ou `configure-env.ps1`
sous Windows) demande chaque valeur, l'explique, génère les secrets et refuse les combinaisons
qui ne peuvent pas marcher — voir
[DEPLOY_SCRIPTS_FR.md](DEPLOY_SCRIPTS_FR.md#configure-envsh--construire-le-env-toi-même). Cette
page est la référence de ce que chaque réponse veut dire, et pour modifier un .env que tu as
déjà.

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
| `BOT_SHARED_SECRET` | l'identifiant du bot Discord auprès de l'API. Non défini, compose donne **à la fois** à l'api et au bot la valeur de `LINK_LOOKUP_SECRET` : ils sont donc d'accord — **pose-le en production** : le code de l'API ne lit plus que celle-ci depuis septembre 2026 (plus de repli sur `LINK_LOOKUP_SECRET`, SECURITY_SUMMARY §9 n° 4), et c'est le repli propre à compose sur le secret de liaison qui fait encore marcher une valeur non définie — les deux services ne doivent pas partager un secret. |
| `AUDIT_SECRET` | clé HMAC de la chaîne d'audit inviolable. Non défini → retombe sur `JWT_SECRET` (ça va). ⚠️ **La changer alors que des entrées existent invalide la vérification de toutes les précédentes** — pose-la une fois, avant la mise en ligne. |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | Le premier compte SUPERADMIN, créé par `npm run setup`. **Règle les deux avant le premier lancement** : le compte n'est créé que s'il n'existe pas déjà, donc les changer ensuite ne fait rien. Non définis, chaque installation part avec le même mot de passe publié par défaut (`admin@bettercommunity.local` / `change-me-now`). |

## 3. Domaine & HTTPS (obligatoire en prod)
| Variable | Rôle |
|---|---|
| `SITE_DOMAIN` | ton **domaine nu** (ex. `community.example.com`) — Caddy s'y attache et provisionne le HTTPS. (Local : `http://localhost:5176`) |
| `SITE_URL` | l'**URL publique complète** (ex. `https://community.example.com`) — utilisée dans les emails, redirections Stripe, liens du bot, l'issuer OIDC. |
| `COOKIE_DOMAIN` | `.ton-domaine.com` (point initial) pour que le cookie de session atteigne aussi les sous-domaines (télémétrie). Local : `localhost`. |

## 4. Stockage objet — S3 (obligatoire)
| Variable | Rôle |
|---|---|
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | identifiants du stockage objet. Le service `storage` fourni (versitygw) les prend **comme** identifiants racine : rien n'est stocké dans les données, et les changer demande de recréer `storage`, `api` et `provisioner` ensemble. **En prod (`NODE_ENV=production`) l'API refuse de démarrer** si `S3_SECRET_KEY` est vide, vaut l'un des `change-me…` de `.env.example`, ou fait moins de 24 caractères : avec le stockage public sur `S3_DOMAIN`, la valeur d'exemple permettrait à quiconque a lu ce fichier de signer des requêtes comme la racine du stockage. `openssl rand -hex 32` ; `infra/gen-secrets.ps1`, `infra/bootstrap.sh` et `node infra/rotate-secrets.mjs` en écrivent tous une longue. Le développement (`npm run dev`, sans `NODE_ENV=production`) n'est pas vérifié. |
| `S3_BUCKET` | nom du bucket (défaut `bcweb`). |
| `S3_ENDPOINT` | endpoint S3 (défaut le service interne `storage`, `http://storage:9000`). Un vieux `.env` qui dit encore `http://minio:9000` vise un service qui n'existe plus : retire la ligne. |
| `S3_REGION` | région (`us-east-1` en local, `auto` pour Cloudflare R2). Compose passe la même valeur au `storage` fourni, qui vérifie les signatures avec. |
| `S3_HOST_PORT` | port de l'hôte sur lequel `storage` est publié, `127.0.0.1` seulement (défaut `9000`). À changer seulement si 9000 est pris sur la machine, et `S3_PUBLIC_ENDPOINT` doit alors dire le même port. |
| `S3_CORS_ALLOW_ORIGIN` | origine CORS pour laquelle le `storage` fourni répond aux uploads pré-signés du navigateur. Défaut `*` — correct avec la stack fournie ; à restreindre à ton `SITE_URL` une fois le stockage public sur `S3_DOMAIN`. Une seule origine. Remplace `MINIO_API_CORS_ALLOW_ORIGIN`, qui ne fait plus rien. |
| `S3_PUBLIC_ENDPOINT` | l'URL **publique** du stockage (les navigateurs y accèdent via des URLs pré-signées). |
| `S3_DOMAIN` | le nom d'hôte que **Caddy** sert pour le stockage objet (ex. `s3.ton-domaine.com`). Non renseigné, le bloc Caddy porte un nom que personne ne peut demander et le stockage reste sur `:9000` — voulu en local. Va par paire avec `S3_PUBLIC_ENDPOINT` : l'un dit ce que Caddy écoute, l'autre ce qui est écrit dans l'URL signée. |
| `CUSTOM_DOMAIN_MATCHER` | mettre `https://` pour servir les propriétaires payants sur **leur propre nom d'hôte**. Non défini, ce bloc Caddy est lié à un nom que personne ne peut demander : une stack qui n'a pas activé la fonctionnalité ne paie rien. Le certificat de chaque nom client est obtenu à la demande, à la première poignée de main — il n'y a aucune liste de domaines dans la config, parce que la liste est en base. |
| `DOMAIN_ASK_KEY` | un secret partagé entre Caddy et l'API pour la question du certificat (`/domains/ask`). Sans lui, quiconque atteint cet endpoint apprend si un nom d'hôte qu'il cite est hébergé ici ; l'edge bloque de toute façon le chemin public, et ceci couvre le cas où l'API est joignable autrement. N'importe quelle longue chaîne aléatoire. Compose la passe **à la fois** à `api` et à `caddy` ; à définir en production. |
| `CSP_CONNECT_SRC_EXTRA` | des origines supplémentaires que le navigateur peut interroger, séparées par des espaces, ajoutées par Caddy au `connect-src` de la CSP du site. Vide par défaut : le site, l'origine du stockage (`S3_PUBLIC_ENDPOINT`, `S3_DOMAIN`) et une liste fixe (GitHub raw, les CDN d'icônes, Google Analytics après consentement, les tuiles de carte). Un hôte qu'un admin ajoute à la liste des blocs live (Admin > Réglages) ou la source d'un nombre live de projet sur un autre hôte doit aussi figurer ici, sinon le navigateur refuse la requête. Redémarrer `caddy` après un changement. |
| `REPO_PUBLIC_BASE` | base publique des dépôts hébergés (ex. `https://ton-domaine.com/repos`). Cette valeur part **dans** les adresses remises à BMM : laissée sur localhost en prod, chaque dépôt distribué pointe vers la machine du visiteur. |
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
| `TELEMETRY_RETENTION_DAYS` | au-delà de combien de jours les événements de télémétrie sont purgés. |
| `TELEMETRY_DELETE_DELAY_H` | délai (heures) avant qu'une demande de suppression de données soit exécutée — la fenêtre pendant laquelle elle reste annulable. |

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
| `COMPOSE_PROFILES` | quels **profils** compose sont actifs (aujourd'hui : `pgbouncer`). À mettre ici plutôt qu'en flag `--profile` : un flag ne vaut que pour sa commande, et `infra/deploy.sh` lance un `up -d` nu qui arrêterait le pooler alors que `DB_HOST` y envoie l'API. |
| `PGBOUNCER_UPSTREAM_HOST` / `PGBOUNCER_UPSTREAM_PORT` | pour que PgBouncer poole une base managée/distante au lieu du `db` local. |
| `API_REPLICAS` | nombre de conteneurs `api` (défaut `1`). À monter seulement quand un seul sature, et en activant PgBouncer en même temps. À préférer à `--scale api=N` : le flag ne survit pas au prochain `docker compose up -d`, et `deploy.sh` fait exactement ça. |

## 12. Divers
| Variable | Rôle |
|---|---|
| `VITE_GTM_ID` | Id Google Tag / GA4 (`GTM-XXXXXXX` ou `G-XXXXXXXXXX`). Se règle aussi dans le dashboard (Réglages d’hébergement → Recherche & visibilité → Santé SEO → « Tag Manager & jetons de propriété ») sans rebuild. Celle-ci est figée au build (argument de build compose) et **l’emporte** sur le dashboard ; la carte Santé SEO affiche « Depuis le build » dans ce cas. Soumise au consentement dans les deux cas. Publique, pas un secret. |
| `GOOGLE_SITE_VERIFICATION` | Jeton de propriété Google Search Console (le `content` de sa balise meta `google-site-verification` ; la balise entière est acceptée et réduite à son contenu). Lu par **l’API à l’exécution** et servi dans cette balise, donc un changement demande un redémarrage de l’API, pas un rebuild. **L’emporte** sur le jeton enregistré dans le dashboard ; la carte Santé SEO affiche « Depuis l’environnement » dans ce cas. Public, pas un secret. |
| `NODE_OPTIONS` | flags V8 pour l'API. L'image pose déjà `--max-old-space-size=384` : V8 dimensionne son heap sur la RAM de **l'hôte** et ne lit *pas* la limite cgroup — dans un conteneur limité en mémoire, un heap non borné dépasse la limite et se fait OOM-kill au lieu de collecter. À monter en même temps que la limite mémoire du conteneur. |
| `KOFI_WEBHOOK_TOKEN` | token de vérification du webhook Ko-fi. Posé ici, il **prime** sur le token défini en admin et le verrouille dans le dashboard (même logique que `DISCORD_TOKEN`). Vide = géré depuis l'UI admin. |
| `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET` | **connexion de profil** Twitch (pas le login). Enregistre `<SITE_URL>/api/auth/connect/twitch/callback`. |
| `STEAM_API_KEY` | connexion de profil Steam (OpenID — pas de secret). [steamcommunity.com/dev/apikey](https://steamcommunity.com/dev/apikey). |

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
`S3_ACCESS_KEY`, `S3_SECRET_KEY` (24 caractères ou plus, pas la valeur d'exemple). Tout le reste est optionnel et s'active au besoin.

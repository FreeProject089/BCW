# BCWEB — Guide de déploiement en production (FR)

> 🇬🇧 English version: [DEPLOY_EN.md](DEPLOY_EN.md)

Comment déployer toute la stack BetterCommunity Web (SPA + API Fastify + Postgres +
Redis + MinIO + bot Discord + télémétrie + Caddy) sur un vrai serveur, avec HTTPS
automatique. Tout tourne dans Docker Compose derrière Caddy.

---

## 1. Ce qu'il te faut

- Un serveur Linux (VPS ou box) avec **Docker + Docker Compose v2** et une **IP publique**.
- **Ports 80 et 443 ouverts** sur Internet (80 est requis pour le challenge ACME de
  Let's Encrypt, 443 sert le HTTPS).
- Un **domaine** que tu contrôles (ex. `community.example.com`) — et éventuellement un
  sous-domaine `telemetry.example.com`.
- Des clés Stripe (test ou live) si tu veux l'hébergement/boosts payants.

## 2. Cloner & configurer

```bash
git clone --recurse-submodules <ton-repo> bcweb
cd bcweb/BCW/BCWEB           # (le compose est sous infra/compose)
cp infra/compose/.env.example infra/compose/.env
```

Édite `infra/compose/.env` — les clés importantes :

| Clé | Rôle |
|---|---|
| `SITE_URL` | URL publique, ex. `https://community.example.com` (mails, redirections Stripe, liens du bot) |
| `CADDY_DOMAIN` | Le domaine servi par Caddy, dont il provisionne le TLS |
| `POSTGRES_PASSWORD` | Un mot de passe DB solide |
| `JWT_SECRET` | Une longue chaîne aléatoire (`openssl rand -hex 32`) |
| `BOT_SHARED_SECRET` | Longue chaîne aléatoire — le secret partagé API↔bot |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Depuis le dashboard Stripe (voir §6) |
| `DISCORD_TOKEN` | Optionnel — sinon défini depuis le dashboard admin |
| `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` | Identifiants du stockage objet |

> **Ne commit jamais `.env`.** Il contient des secrets réels et est gitignore. Seul
> `.env.example` est versionné.

## 3. Pointer le DNS vers le serveur

Chez ton fournisseur DNS :

| Type | Nom | Valeur |
|---|---|---|
| `A` | `community.example.com` | IPv4 du serveur |
| `AAAA` (optionnel) | `community.example.com` | IPv6 du serveur |
| `A` (optionnel) | `telemetry.example.com` | IPv4 du serveur |

Attends la propagation : `nslookup community.example.com` doit renvoyer ton IP.

## 4. Lancer la stack

```bash
cd infra/compose
docker compose up -d --build
docker compose ps            # chaque service doit être "healthy"/"running"
docker compose logs -f caddy # regarde le certificat TLS s'émettre
```

Caddy provisionne et renouvelle automatiquement un certificat Let's Encrypt pour
`CADDY_DOMAIN` — **aucune gestion manuelle de certificat**. La première émission prend
quelques secondes une fois le DNS résolu.

L'API applique les migrations au démarrage (`prisma db push`), le schéma est donc créé
automatiquement. Va sur `https://community.example.com` — l'app doit s'afficher en HTTPS.

## 5. Premier admin

1. Crée le premier compte via l'interface.
2. Passe-le admin en base (une seule fois) :
   ```bash
   docker compose exec db psql -U bcweb -d bcweb -c \
     "UPDATE \"User\" SET role='SUPERADMIN' WHERE email='toi@example.com';"
   ```
3. Recharge — la zone **Admin** est disponible (modération, quotas d'hébergement, bot,
   analytics, réglages).

## 6. Stripe (paiements)

1. Dans le dashboard Stripe, récupère ta **clé secrète** → `STRIPE_SECRET_KEY`.
2. Crée un endpoint webhook vers
   `https://community.example.com/hosting/webhook` (un alias `/webhook` marche aussi).
   Abonne au minimum : `checkout.session.completed`, `invoice.paid`,
   `invoice.payment_failed`, `customer.subscription.deleted`, `charge.refunded`.
3. Copie le **secret de signature** de l'endpoint (`whsec_…`) → `STRIPE_WEBHOOK_SECRET`.
4. `docker compose up -d api` pour recharger.

> **Sans `STRIPE_WEBHOOK_SECRET`, le webhook renvoie 503** — aucun paiement n'est
> enregistré ni provisionné. L'onglet admin **Discord bot → Payments** affiche un
> diagnostic ✓/✗ pour la clé Stripe + le secret webhook.
>
> **Test local :** `stripe listen --forward-to http://localhost:3000/hosting/webhook`
> et utilise le `whsec_…` affiché comme `STRIPE_WEBHOOK_SECRET`. Le conteneur API est
> sur **:3000** (pas le `:4242` d'exemple de Stripe).

## 7. Bot Discord (optionnel)

Soit tu définis `DISCORD_TOKEN` dans `.env`, soit tu le laisses vide et tu colles le
token dans l'onglet admin **Discord bot** (il se connecte sous ~20s, sans redémarrage).
L'app Discord doit avoir les intents privilégiés **Server Members + Message Content**
activés dans le Developer Portal.

## 8. Télémétrie (optionnel)

Le dashboard de télémétrie BMM tourne dans son propre service (`telemetry` +
`telemetry-db`). Pointe `telemetry.example.com` vers le serveur et définis
`TELEMETRY_INTERNAL_URL` + `TELEMETRY_ADMIN_KEY` dans `.env` pour gérer ses limites
depuis l'admin BCWEB.

## 9. Mise à jour

```bash
git pull --recurse-submodules
cd infra/compose
docker compose up -d --build      # reconstruit les images modifiées, db push au boot
```

## 10. Sauvegardes

- **Postgres :** `docker compose exec db pg_dump -U bcweb bcweb | gzip > bcweb-$(date +%F).sql.gz`
- **MinIO (uploads / dépôts hébergés) :** sauvegarde le volume `minio-data` (ou
  réplique le bucket avec `mc mirror`).
- **Ne fais jamais** `docker compose down -v` en prod — `-v` supprime les volumes
  (base de données + stockage objet).

## 11. Santé & supervision

- `GET /health` sur l'API renvoie 200 quand elle est vivante.
- L'onglet admin **Server perf** montre CPU/RAM/disque, la santé des dépendances,
  l'historique de downtime et les alertes récentes (dédupliquées, copiables).
- Test de charge : `cd loadtest && npm install && BASE=https://community.example.com node run.mjs`.

## Performance & montée en charge

**Déjà en place** (voir `loadtest/BENCHMARK.md`) :
- Les lectures publiques chaudes (`/kofi/stats`, `/showcase`) sont cachées dans **Redis**
  (partagé entre les réplicas d'API) avec coalescing des requêtes.
- Le rate limiter par IP est **adossé à Redis** quand `REDIS_URL` est défini — le budget
  600/min est donc partagé entre les réplicas.
- **En-têtes prêts pour un CDN** : Caddy met `Cache-Control: immutable` sur `/assets/*`
  (bundles hashés de Vite), et les téléchargements de fichiers hébergés ont `max-age=300`
  + un ETag.

**La seule étape externe — mettre un CDN (Cloudflare) devant :**
1. Ajoute ton domaine à Cloudflare, mets les enregistrements DNS en **proxied** (nuage orange).
2. Mode SSL/TLS **Full (strict)** — Caddy termine quand même le vrai TLS à l'origine.
3. C'est tout : les `/assets/*` hashés et les téléchargements répétés sont servis depuis
   l'edge avec ~0 hit à l'origine ; le shell HTML reste non caché donc les déploiements
   sont instantanés.

**Quand un seul conteneur API ne suffit plus :**
- Lance 2–4 réplicas `api` derrière Caddy (`docker compose up -d --scale api=3` + une
  liste d'upstreams Caddy) — le cache/limiter Redis rendent déjà ça sûr.
- Active le pooler **PgBouncer** : `docker compose --profile pgbouncer up -d`, puis dans
  `.env` mets `DB_HOST=pgbouncer DB_PORT=6432 DB_URL_PARAMS=?pgbouncer=true`
  (`DIRECT_DATABASE_URL` reste sur `db:5432` pour les migrations, géré automatiquement).

## Stockage objet — MinIO maintenant, R2 plus tard

**Ne confonds pas les deux produits Cloudflare :** le **CDN est gratuit** (section
précédente — active-le quand tu veux) ; **R2** est leur *stockage objet payant à
l'usage* qui remplacerait le MinIO embarqué. Tu n'as **pas besoin de R2** pour profiter
du CDN.

**Démarre (et reste longtemps) sur MinIO** — gratuit, les fichiers sont sur le disque de
ton serveur, et nginx + MinIO servent confortablement une petite/moyenne communauté
(voir `loadtest/BENCHMARK_FR.md`).

**Passe à R2 quand** l'une de ces choses devient vraie :
- le stockage des dépôts hébergés déborde du disque du serveur (ou plombe tes sauvegardes),
- l'egress des téléchargements sature ton lien / ton hébergeur facture le trafic,
- tu veux que les fichiers survivent indépendamment du VPS.

**Comment (env uniquement, zéro code — l'app parle l'API S3) :**
1. Crée un bucket R2 + un token API (Access Key ID / Secret) dans le dash Cloudflare.
2. Dans `infra/compose/.env` :
   ```
   S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
   S3_REGION=auto
   S3_PUBLIC_ENDPOINT=https://<ton-domaine-public-R2-ou-custom>
   S3_BUCKET=<bucket>  S3_ACCESS_KEY=<clé>  S3_SECRET_KEY=<secret>
   ```
3. Copie une fois les objets existants :
   `rclone sync minio:bcweb r2:bcweb` (ou `mc mirror`).
4. `docker compose up -d api provisioner`, vérifie upload/download, puis retire le
   service `minio` + son volume.

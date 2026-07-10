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

## Notes de montée en charge

- Mets un **CDN (Cloudflare)** devant pour le shell statique + les assets — il absorbe
  l'essentiel du trafic de lecture et le palier 100k+ gratuitement.
- Le rate limiter par IP de l'API est généreux pour les humains et peu coûteux face à
  l'abus ; garde-le.
- Pour >1k sockets API concurrents en continu, lance 2–4 réplicas d'API derrière Caddy
  et un pooler de connexions Postgres. Voir `loadtest/BENCHMARK.md`.

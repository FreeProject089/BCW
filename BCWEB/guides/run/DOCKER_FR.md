# BCWEB — Les fichiers Docker expliqués (FR)

> 🇬🇧 English version : [DOCKER_EN.md](DOCKER_EN.md)

Ce que fait chaque pièce Docker de la stack, où elle vit, et comment la mettre à jour
pour la production. Tout est piloté par **un seul** fichier compose :
`infra/compose/docker-compose.yml` + son `.env` (copié depuis `.env.example`).

---

## 1. Les services (docker-compose.yml)

| Service | Image / build | Rôle | Exposé |
|---|---|---|---|
| `db` | `postgres:16-alpine` | Base de données principale (Prisma) | interne uniquement |
| `redis` | `redis:7-alpine` | Cache partagé + état du rate limiter | interne uniquement |
| `minio` | `minio/minio` | Stockage objet compatible S3 (uploads, dépôts hébergés) | `9000` (S3), `9001` (console) |
| `api` | build `apps/api/Dockerfile` | API Fastify — comptes, catalogues, hébergement, facturation… | `3000` |
| `provisioner` | build `apps/provisioner/Dockerfile` | Worker qui provisionne les dépôts hébergés | — |
| `web` | build `apps/web/Dockerfile` | SPA React compilée et servie par **nginx** | via caddy |
| `bot` | build `apps/bot/Dockerfile` | Bot Discord (connection manager) | — |
| `telemetry-db` | `postgres:16-alpine` | Postgres séparé pour la télémétrie BMM | interne uniquement |
| `telemetry` | build `bmm/telemetry-dashboard/Dockerfile` | Ingest + dashboard télémétrie (Rust + React) | via caddy |
| `caddy` | `caddy:2-alpine` | Proxy inverse de bord — HTTPS, en-têtes sécurité, anti-bot | `80`, `443`, `5176` |
| `pgbouncer` | `edoburu/pgbouncer` | Pooler de connexions Postgres **opt-in** (profil `pgbouncer`) | interne uniquement |

L'**ordre de dépendance** est géré par `depends_on` + healthchecks : `db` doit être
healthy avant que `api`/`provisioner` démarrent ; `caddy` est devant tout.

## 2. Les Dockerfiles

- **`apps/api/Dockerfile`** — `node:20-alpine` + `openssl` (Prisma), `git` (le système
  de backup fichiers/DB de l'admin utilise le vrai git), polices (bannière de
  bienvenue). Le build lance `prisma generate` ; **au démarrage du conteneur** il lance
  `node src/boot-migrate.mjs` puis `node src/server.mjs`. `boot-migrate.mjs` applique les
  migrations commitées via `prisma migrate deploy` — et **pas** `db push`, qui peut
  supprimer une colonne ou une table sans prévenir lors d'un renommage. Il gère les trois
  états possibles de la base sans intervention : neuve (applique la baseline), déjà
  synchronisée avec un ancien `db push` (la baseline pour que deploy ne recrée rien), ou
  déjà migrée (applique les migrations en attente). C'est pour ça qu'une DB neuve
  « marche toute seule ».
- **`apps/web/Dockerfile`** — multi-étapes : étape 1 compile le bundle Vite, étape 2 =
  **nginx** qui sert `dist/` avec `apps/web/nginx.conf` (cache immutable sur les
  `/assets/*` hashés, no-cache sur `index.html`, fallback SPA). ⚠️ Les variables
  `VITE_*` sont **figées au build** — changer `VITE_GTM_ID` exige un rebuild, pas un
  simple restart.
- **`apps/bot/Dockerfile`** — `node:20-alpine`, deps prod uniquement, polices pour la
  bannière. Tourne au ralenti proprement sans token.
- **`apps/provisioner/Dockerfile`** — petit worker Node + client Prisma.
- **`bmm/telemetry-dashboard/Dockerfile`** — 3 étapes : build React → build Rust
  (Axum) release → runtime **distroless/cc** (pas de shell, surface CVE minimale).

## 3. Les volumes (les données qui doivent survivre)

| Volume | Contient | Le perdre = |
|---|---|---|
| `db-data` | toute la base principale | comptes, dépôts, facturation — tout |
| `minio-data` | tous les fichiers uploadés/hébergés | tous les dépôts + payloads catalogue |
| `telemetry-data` | la DB télémétrie | l'historique télémétrie BMM |
| `redis-data` | état cache/limiter | sans gravité (reconstruit tout seul) |
| `caddy-data` / `caddy-config` | certificats TLS | ré-émis automatiquement |
| `audit-anchor` | l'ancre d'inviolabilité du journal d'audit | la vérification de la chaîne d'audit |

> **Ne lance jamais `docker compose down -v` en production** — le `-v` supprime ces
> volumes. `docker compose down` (sans `-v`) est toujours sûr.

## 4. Commandes du quotidien

```bash
cd infra/compose
docker compose up -d                  # démarrer (build si jamais construit)
docker compose up -d --build api      # rebuild UN service après un changement de code
docker compose ps                     # statut + santé
docker compose logs -f api bot        # suivre les logs
docker compose restart api            # redémarrer sans rebuild (⚠️ ne relit pas .env)
docker compose down                   # tout arrêter (volumes conservés)
```

Règle simple : **changement de code → `--build`**, **changement de `.env` → `up -d`**
(recrée les conteneurs avec le nouvel env ; un simple `restart` ne relit PAS `.env`).

## 5. Mettre à jour en production

1. `infra/deploy.sh` — sauvegarde, récupère, reconstruit, attend /ready, remet le code en
   arrière s’il ne répond jamais. Voir DEPLOY_FR.md section 9. À la main :
2. `git pull`
3. `cd infra/compose && docker compose up -d --build`
   - Seules les images modifiées se reconstruisent (cache de couches Docker).
   - L'api lance `boot-migrate.mjs` au boot → `prisma migrate deploy` applique les
     migrations **commitées**. Conséquence à retenir : si tu changes le schéma, sa
     migration doit être commitée dans `packages/db/migrations/` **avant** le rebuild,
     sinon elle ne s'applique pas (la base garde l'ancien schéma, sans erreur au boot).
   - nginx sert les nouveaux assets hashés ; `index.html` est en no-cache donc les
     clients prennent le nouveau build immédiatement (pas besoin de Ctrl+Shift+R en prod).
3. Vérifie `docker compose ps` (healthy) et l'onglet admin **Server perf**.

**Quasi zéro downtime :** l'ordre importe peu — Caddy continue de servir pendant qu'un
service se recrée (coupure de quelques secondes sur ce service seulement). Pour l'api :
`docker compose up -d --build --no-deps api` pour ne toucher à rien d'autre.

## 6. Réglages spécifiques prod (rappel)

- `.env` : vrais `POSTGRES_PASSWORD`, `JWT_SECRET`, clés S3, `SITE_DOMAIN`/`SITE_URL`
  (https), `COOKIE_DOMAIN=.ton-domaine.com`, clés Stripe + secret webhook.
- Ports : en prod tu peux retirer les ports publiés `3000` (api) et `9001` (console
  MinIO) du compose si tu n'en as pas besoin de l'extérieur — Caddy route en interne.
- Montée en charge : `docker compose up -d --scale api=3` + profil `pgbouncer`
  (voir guide DEPLOY §Performance) quand le trafic le justifie.
- Sauvegardes : `pg_dump` pour `db`, miroir de `minio-data` (guide DEPLOY §10).

## 7. Pièges classiques

| Symptôme | Cause |
|---|---|
| un changement d'env ne fait rien | `restart` au lieu de `up -d` (l'env s'applique à la création du conteneur) |
| GTM id / VITE_* sans effet | figé au build → `up -d --build web` |
| paiements jamais enregistrés | `STRIPE_WEBHOOK_SECRET` manquant → le webhook 503 (voir diagnostic admin bot → Payments) |
| bot hors ligne | pas de token (env ou dashboard) ou intents privilégiés désactivés dans le portail Discord |
| tout a disparu après `down -v` | le `-v` a supprimé les volumes — restaure depuis les sauvegardes |

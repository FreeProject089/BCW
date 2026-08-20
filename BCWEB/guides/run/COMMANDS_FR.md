# BCWEB — toutes les commandes, et quand tu les veux

Une page pour « qu'est-ce que je tape ». Regroupée par objectif plutôt que par outil, parce
qu'au moment où tu cherches une commande, tu connais le but, pas le paquet.

Les chemins sont relatifs à `BCWEB/` sauf mention contraire. Tout ici est tiré des vrais
scripts `package.json`, de `infra/` et de `.github/workflows/ci.yml`.

---

## Au quotidien, en production

```bash
infra/deploy.sh                 # sauvegarde, récupère, reconstruit, vérifie, revient en arrière si ça échoue
infra/deploy.sh --dry-run       # affiche chaque étape sans rien changer
infra/backup/backup.sh          # un dump tout de suite, sans déployer
```

`deploy.sh` est celle à utiliser. Elle refuse de tourner avec des modifications non commitées,
attend `/ready` plutôt que l'existence d'un conteneur, et remet le commit précédent si le site
ne répond jamais. Elle ne remet **pas** la base en arrière — voir [Déploiement §9](DEPLOY_FR.md).

### Si tu préfères à la main

```bash
git pull
cd infra/compose
docker compose up -d --build
```

---

## Docker

Toutes ces commandes prennent `-f infra/compose/docker-compose.yml`, ou se lancent depuis
`infra/compose/`.

```bash
docker compose up -d                    # tout démarrer
docker compose up -d api                # démarrer/remplacer un seul service
docker compose build api                # reconstruire une image sans la démarrer
docker compose ps                       # ce qui tourne, et son état de santé
docker compose logs -f api              # suivre les logs d'un service
docker compose logs --tail=100 api      # les 100 dernières lignes puis rendre la main
docker compose restart api              # redémarre SANS relire .env
docker compose up -d --force-recreate api   # redémarre ET relit .env
docker compose down                     # tout arrêter, garder les volumes
docker compose exec api sh              # un shell dans le conteneur API
docker compose exec db psql -U bcweb -d bcweb   # une invite psql
```

!!! warning "`restart` ne relit pas `.env`"
    Changer une variable puis faire `restart` laisse l'ancienne valeur en place. Utilise
    `up -d --force-recreate` dès que tu touches à l'environnement.

### Les services

`db` · `redis` · `pgbouncer` · `minio` · `api` · `provisioner` · `web` · `bot` ·
`telemetry-db` · `telemetry` · `caddy`

---

## Reconstruire et monter en charge

```bash
docker compose up -d --build              # reconstruire ce qui a changé, remplacer, garder les volumes
docker compose build --no-cache api       # ignorer le cache Docker (dépendance qui ne se met pas à jour)
docker compose up -d --force-recreate api # relire .env sans reconstruire
```

Pour plusieurs répliques d'API, mets `API_REPLICAS=3` dans `.env` puis la commande normale :

```bash
docker compose --profile pgbouncer up -d --build
```

Les répliques sont remplacées **une par une** (le drain SIGTERM est déjà en place), donc un
build sur une pile scalée est un rollout sans coupure.

`--scale api=3` en ligne de commande marche aussi, mais **ne dure pas** : le prochain
`docker compose up -d` ramène à une seule réplique — et `infra/deploy.sh` fait exactement ça.
Sur une pile scalée, le déploiement de routine te ferait donc perdre les deux tiers de la
capacité sans un mot dans les logs. `API_REPLICAS` survit aux déploiements ; préfère-le.

Vérifier que la montée a pris :

```bash
docker compose ps api                     # une ligne par réplique, ports hôte 3000, 3001, 3002…
docker compose logs api | grep "incoming request"   # toutes les répliques servent
```

---

## Préparer une base

```bash
cd apps/api
npm run setup                   # migrations + seed principal + docs + FAQ
npm run setup -- --demo         # ... et les fixtures de démo (dépôts, catalogues, comptes)
npm run setup -- --skip-migrate # seulement les seeds
```

Chaque étape est idempotente : la relancer sur une base existante est sans risque. Préfère-la
aux seeds lancés à la main — ils ont un ordre, et se tromper laisse une base à moitié
remplie qui échoue plus tard, ailleurs, sans rapport apparent.

### Les seeds individuels, si tu en veux un seul

```bash
npm run seed            # projets, comptes, offres, badges, réglages, articles
npm run seed:demo       # du contenu d'exemple pour cliquer dedans
npm run seed:content    # éléments de catalogue et dépôts
npm run seed:docs       # les pages de documentation
npm run seed:faq        # les entrées de FAQ
npm run seed:site       # le guide intégré au site
npm run gen             # données relationnelles générées
```

---

## Migrations

```bash
cd apps/api
npm run migrate                 # applique les migrations en attente (ce que fait le conteneur au boot)
```

En créer une, depuis `BCWEB/` :

```bash
npx prisma migrate dev --name ce_qui_change --schema packages/db/schema.prisma
npx prisma validate --schema packages/db/schema.prisma
npx prisma migrate diff \
  --from-schema-datasource packages/db/schema.prisma \
  --to-schema-datamodel  packages/db/schema.prisma --exit-code   # 0 = aucune dérive
```

`--exit-code` est ce qu'utilise la CI : un changement de schéma sans migration correspondante
y échoue, parce que `migrate deploy` le sauterait en silence en production.

!!! danger "Deux clients Prisma"
    `prisma generate` résout sa sortie depuis l'emplacement du schéma et atterrit dans le
    `node_modules` du dépôt PARENT, alors que l'API charge
    `apps/api/node_modules/.prisma/client`. Les deux existent et divergent. Après génération,
    recopie — et arrête d'abord l'API, qui garde le moteur de requêtes ouvert :

    ```bash
    docker compose stop api
    npx prisma generate --schema packages/db/schema.prisma
    cp -r ../../node_modules/.prisma/client/. apps/api/node_modules/.prisma/client/
    docker compose up -d api
    ```

    Le symptôme quand on se trompe : un 500 instantané sur une route manifestement correcte,
    parce que `p.someModel` valait `undefined` et a levé avant d'atteindre Postgres.

---

## Tests et vérifications

### API

```bash
cd apps/api
npm test                        # 751 tests
npm run test:e2e
```

!!! warning "Trois façons dont ça te ment"
    - **Sans `DATABASE_URL`** → ~19 tests sont SAUTÉS en silence et le résultat dit « pass ».
    - **Avec `REDIS_URL`** → `cache.test.mjs` échoue pour des raisons étrangères à ton changement.
    - **Conteneur API en marche** → son sweeper écrit un réglage que `rollup.test.mjs` veut absent.

    Fais comme la CI : arrête l'API, définis `DATABASE_URL`, laisse `REDIS_URL` vide, attends
    751/751 avec **0 sauté**.

    ```bash
    docker compose stop api
    DATABASE_URL="postgresql://bcweb:MOTDEPASSE@127.0.0.1:5432/bcweb" npm test
    docker compose start api
    ```

### Web

```bash
cd apps/web
npm run lint
npm run i18n:check              # --strict : échoue sur toute clé utilisée sans entrée FR
npm run legal:check             # échoue si le texte légal a changé sans sa date
npm run css:check
npm run budget                  # taille du bundle contre son plafond
npm run i18n:untranslated       # entrées FR encore identiques à l'anglais
npm run build
```

Il n'y a **aucun `package.json` à la racine de BCWEB**. Lancer `npm run i18n:check` depuis là
répond `Missing script` et sort en 1 — passé dans `--silent`, ça n'affiche rien, ce qui
ressemble exactement à un succès. Toujours `cd` dans l'espace de travail.

---

## Le faire tourner en local

```bash
cd apps/api && npm run dev      # API avec --watch
cd apps/web && npm run dev      # Vite sur :5176, proxy /api vers :3000
```

Ou toute la stack en Docker, en ne reconstruisant que ce que tu as changé :

```bash
npm --prefix apps/web run build
docker cp apps/web/dist/. bcweb-web-1:/usr/share/nginx/html/     # web, sans rebuild
docker compose build api && docker compose up -d api             # api
```

---

## Le montrer à quelqu'un

```bash
node infra/tunnel.mjs
```

Ouvre un tunnel Cloudflare devant la stack locale et dit à Caddy de répondre sur le nom
d'hôte distribué. Ctrl-C y met fin et remet la configuration.

```bash
node infra/tunnel.mjs --restore   # réparer sans rouvrir de tunnel
```

À lancer si un tunnel a été coupé autrement que par Ctrl-C — fenêtre fermée, process tué,
machine redémarrée. Le script écrit la configuration d'origine dans un fichier **avant** de la
modifier, donc la réparation ne dépend pas de la façon dont le run précédent s'est terminé.
Sans crumb à traiter, la commande ne fait rien et le dit.

!!! danger "Une sortie sale casse la connexion, en silence"
    `.env` reste alors sur un tunnel mort. Le site se charge encore, mais le cookie de session
    est rattaché à un nom d'hôte qui n'existe plus : le navigateur le jette sans un mot, la
    connexion répond « bienvenue » et la requête suivante repart anonyme.

    Le lancement normal répare aussi tout seul avant d'ouvrir le nouveau tunnel.

!!! warning "La partie nom d'hôte n'est pas optionnelle"
    Caddy associe les sites par `Host`. Une requête arrivant en `quelquechose.trycloudflare.com`
    ne correspond pas au site `localhost` et Caddy répond **200 avec un corps vide** — pas un
    404. Sans `TUNNEL_DOMAIN`, le tunnel se connecte, la page est blanche, et rien ne dit
    pourquoi.

    C'est aussi pour ça que `curl http://127.0.0.1:5176/…` peut sembler cassé alors que le
    site va bien. Teste la périphérie avec `-H "Host: localhost"`.

---

## Secrets

```bash
node infra/rotate-secrets.mjs
```

`.env.example` est commité dans un dépôt public avec des valeurs `change-me…` littérales. Tant
que tout écoute sur localhost c'est théorique ; dès qu'un tunnel ou un domaine est ouvert, ça
ne l'est plus.

---

## Nettoyer

```bash
cd apps/api
npm run clear-content            # SIMULATION — affiche ce qu'elle supprimerait, ne supprime rien
npm run clear-content -- --yes   # supprime réellement dépôts et éléments de catalogue, garde les comptes
npm run nuke                     # simulation de l'effacement complet
npm run nuke -- --yes            # efface tout, COMPTES COMPRIS
npm run fix:drift                # réparation idempotente des dérives connues
```

`clear-content` efface **tout** le contenu utilisateur, pas seulement le tien. Sur une base de
développement partagée, c'est l'après-midi de quelqu'un d'autre.

---

## Ce que fait la CI

`.github/workflows/ci.yml` fait autorité sur « est-ce vert ». Elle vérifie et ne déploie
délibérément **pas**.

| Job | Ce qu'il fait |
|---|---|
| `web-build` | lint, i18n:check, css:check, legal:check, vite build, budget |
| `api-check` | `node --check` sur chaque `.mjs`, prisma generate/validate/migrate deploy, contrôle de dérive, `npm test` |
| `native` | `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test`, build napi |
| `secret-scan` | cherche des identifiants commités |

La reproduire en local, ce sont les quatre blocs ci-dessus. Un piège au passage : après
`cmd | tail`, `$?` est le statut de **tail** et vaut presque toujours 0. Utilise
`${PIPESTATUS[0]}` pour le vrai.

---

## Où sont les choses

| | |
|---|---|
| Fichier compose | `infra/compose/docker-compose.yml` |
| Environnement | `infra/compose/.env` (depuis `.env.example`) |
| Caddy | `infra/caddy/Caddyfile` |
| Schéma + migrations | `packages/db/` |
| Sauvegardes | `/var/backups/bcweb` par défaut |

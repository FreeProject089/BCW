# Benchmark de charge BCWEB (FR)

> 🇬🇧 English version : [BENCHMARK.md](BENCHMARK.md)

Stack testée : Caddy → nginx (SPA) / API Fastify → Postgres, le tout dans Docker
Desktop sur la machine de dev, charge générée avec autocannon depuis la même machine
(loopback). Ce sont donc des chiffres **pessimistes d'une seule boîte en loopback**.

## Le harnais (réécrit le 2026-07-15)

`run.mjs` est désormais une échelle de stress multi-**scénarios** à **niveaux** nommés
(du calme à l'extrême) qui capture toute la queue de latence et écrit un rapport pensé pour
être lu **par un humain ou une IA**. Relancer (`cd loadtest && npm install && node run.mjs`,
stack up) :

```
BASE=http://localhost:3000 node run.mjs     # direct sur le conteneur API
BASE=http://localhost      node run.mjs     # via Caddy (ajoute /api automatiquement)
QUICK=1 node run.mjs                         # 2 niveaux bas, 5s chacun (smoke)
DURATION=15 LEVELS=chill,normal,busy node run.mjs
CONNS=10,100,1000 node run.mjs               # échelle numérique personnalisée
SCENARIOS=cached,feed node run.mjs           # sous-ensemble de mixes d'endpoints
RPM_PER_USER=6 node run.mjs                  # ajuste le modèle utilisateur du min-spec
```

- **Niveaux** (concurrence, calme → extrême) : `chill` (10) · `normal` (50) · `busy` (200) ·
  `heavy` (1 000) · `extreme` (5 000). `QUICK=1` lance les deux plus bas ; override via `CONNS=`.
- **Scénarios** (mixes d'endpoints = différentes formes/coûts de données) :
  - `cached` — lectures caches/liveness bon marché (`/health`, `/kofi/stats`) : chemin cache + event loop.
  - `db-read` — requêtes listes DB (`/projects`, `/showcase`, `/catalog`).
  - `feed` — le rendu public le plus lourd, le feed `catalog.json` (top 500).
  - `mixed` — un mélange réaliste pondéré lecture (c'est là-dessus qu'est calé le min-spec).
- **Par niveau on enregistre** le débit (req/s + 2xx/s réellement *servies*), la queue de
  latence **p50 / p90 / p99 / p99.9**, `non-2xx` / erreurs / timeouts, et une **sonde ping
  `/health` live** émise *pendant* le flood — si son p99 explose, l'event loop Node est
  affamé CPU (le signal de goulot le plus utile).
- **Il écrit** (tout git-ignoré, régénéré à chaque run) :
  - `report.md` — rapport humain+IA : tables par scénario, un **coude** de saturation, un
    **diagnostic de goulot** en clair, une table **spécifications-serveur-minimum** extrapolée
    (utilisateurs → vCPU/RAM), et une note Core Web Vitals.
  - `report.json` — les mêmes données, lisibles machine (à differ entre runs ; le coude qui
    monte = la condition de victoire).

Les entrées historiques ci-dessous précèdent ce harnais mais le tableau tient : sur une seule
boîte loopback, les signaux honnêtes sont les req/s servies, la queue p99/p99.9, et où
apparaissent les premières erreurs/timeouts — les niveaux hauts sont surtout le rate limiter
qui déleste *par design*.

Le runner a **deux phases** :
- **Phase 1 — latence réelle** : quelques requêtes à 1 connexion, qui restent sous la
  fenêtre fraîche du rate limiter par IP → de vraies réponses 2xx. C'est ce qu'un
  utilisateur ressent réellement.
- **Phase 2 — échelle de stress** : montée en charge pour voir comment le serveur se
  comporte sous une avalanche (surtout le rate limiter qui déleste la charge).

---

## Phase 1 — latence réelle (ce que ressent l'utilisateur)

| Endpoint | p50 | p99 | moy |
|---|---|---|---|
| `/health` | 0 ms | 6 ms | 0,9 ms |
| `GET /projects` (DB + visibilité) | 2 ms | 7 ms | 2,8 ms |
| `GET /showcase` (liste DB) | 3 ms | 9 ms | 3,3 ms |
| `GET /kofi/stats` (agrégat DB) | 1 ms | 6 ms | 1,6 ms |

**Chaque endpoint répond en 1–9 ms.** Les requêtes Postgres ne sont pas un goulot.

## Phase 2 — sous avalanche

- `/health` (exempté du rate limiter) : **~8k req/s tout en 2xx** à p99 10 ms (50 conns),
  qui se dégrade jusqu'à p99 ~460 ms à 1 000 conns — c'est le plafond brut de traitement
  d'une seule boîte de dev (Docker Desktop, loopback).
- Endpoints DB : **~0 servi en 2xx, ~70–80k rejetés/fenêtre** — le rate limiter par IP
  (600/min) déleste l'avalanche avec **0 erreur, 0 timeout, latence basse**. Posture
  anti-DoS voulue : une seule IP ne peut pas atteindre la base en masse.

## Stress test (jusqu'à 5 000 connexions concurrentes)

Échelle 100 → 1 000 → 5 000 conns, 10 s chacune. **Résultat clé : le serveur survit à
5 000 connexions concurrentes avec 0 erreur et 0 timeout** — la latence se dégrade
proprement (backpressure) mais rien ne s'effondre.

| Endpoint | 100 conns | 1 000 conns | 5 000 conns |
|---|---|---|---|
| `/health` (illimité) | 5,4k rq/s · p99 28 ms | 4,7k · p99 1,1 s | 3,3k · p99 6,2 s |
| `/projects` (rate-limité) | 9,0k rq/s · p99 27 ms | 10,3k · p99 88 ms | 6,1k · p99 5,3 s |
| `/showcase` | 7,9k · p99 25 ms | 8,2k · p99 536 ms | 4,2k · p99 9,5 s |
| `/kofi/stats` | 9,3k · p99 21 ms | 7,1k · p99 1,6 s | 4,5k · p99 8,9 s |

`err` et `timeout` étaient **à 0 à tous les niveaux** — la dégradation est purement de
la latence de queue, pas des échecs. Sur du vrai matériel derrière un CDN + plusieurs
réplicas d'API, chaque nœud ne voit qu'une fraction de cette concurrence.

## Ce qu'il faut optimiser (par priorité)

1. **Mettre un CDN devant (Cloudflare/R2).** Le plus gros gain : le shell SPA + les
   assets + les téléchargements de dépôts hébergés quittent quasi entièrement l'origine.
   Absorbe le palier 100k+ gratuitement.
2. **Pooler de connexions Postgres (PgBouncer)** dès que tu fais tourner plus d'un
   réplica d'API — les requêtes font 1–3 ms, donc la limite est le nombre de connexions,
   pas le temps de requête.
3. **Cache Redis optionnel** sur les lectures publiques chaudes (`/projects`,
   `/showcase`, `/kofi/stats`) avec un TTL court — pas nécessaire pour l'instant
   (1–3 ms), utile seulement si aucun CDN ne les sert et que le trafic grimpe.
4. **Garder le rate limit par IP** (600/min est généreux pour un humain à ~10 req/s) —
   peu coûteux et c'est ce qui protège la base sous abus.
5. Stockage objet (fichiers hébergés) : servir les téléchargements via le CDN / un edge
   compatible S3 plutôt que directement depuis MinIO dès que le volume est réel.

## Dimensionnement serveur (estimations — stack = api + web + postgres + redis + minio + caddy + bot + télémétrie)

| Palier | Utilisateurs | vCPU | RAM | Disque | Notes |
|---|---|---|---|---|---|
| **Minimum** | jusqu'à ~1k inscrits / quelques centaines simultanés | **2** | **4 Go** | 40 Go SSD + quota d'hébergement | VPS unique, tout dans un compose. 2 Go marche mais serré avec MinIO+PG+Redis+bot. |
| **Confortable** | quelques milliers | 4 | 8 Go | 80 Go SSD + quota | CDN pour le statique ; PgBouncer si réplicas d'API. |
| **Montée en charge** | 10k+ simultanés | 8+ (réparti) | 16 Go+ | managé | CDN + 2–4 réplicas d'API derrière Caddy + Postgres managé (réplica lecture) + S3/R2 pour les fichiers. |

**Base de l'estimation :** un utilisateur qui navigue ne fait que quelques requêtes par
minute, chacune de 1–9 ms de temps serveur. Une seule boîte **2 vCPU / 4 Go** sert donc
**des milliers d'utilisateurs simultanés** confortablement ; les vrais plafonds
(gestion des connexions à très haute concurrence et le Postgres unique) se règlent avec
un CDN + des réplicas bien avant que le CPU/RAM soit la limite. Le disque est dicté
presque entièrement par le stockage de dépôts hébergés que tu vends, pas par l'app
(~5–10 Go de base).

## Optimisation appliquée — micro-cache sur les lectures publiques chaudes (avant → après)

Ajout d'un petit cache TTL en mémoire (`apps/api/src/cache.mjs`, avec coalescing des
requêtes) sur les deux lectures publiques indépendantes du visiteur, plus des en-têtes
`Cache-Control` pour qu'un CDN les garde aussi :
- `GET /kofi/stats` — TTL 15 s (invalidé à chaque nouveau tip)
- `GET /showcase` — TTL 10 s (invalidé aux éditions admin)

`/projects` n'est **pas** caché : il est propre à chaque visiteur (whitelist de
visibilité) et a un effet de bord de swap programmé — le cacher risquerait une
visibilité périmée/fuitée.

**Sonde de latence réelle, avant vs après (moy) :**

| Endpoint | Avant | Après | Δ |
|---|---|---|---|
| `GET /showcase` | 3,34 ms | **0,50 ms** | −85 % |
| `GET /kofi/stats` | 1,59 ms | **0,34 ms** | −79 % |
| `GET /projects` (non caché) | 2,75 ms | 1,75 ms | (variance) |

Le **gain le plus important**, côté production, n'apparaît pas dans un benchmark
mono-IP (le rate limiter plafonne déjà les hits DB par IP) : sous du vrai trafic
multi-IP, ces endpoints frappent Postgres **une fois par fenêtre de TTL** au lieu d'une
fois par requête, et le coalescing fait qu'une expiration de cache sous charge est une
seule requête DB, pas une ruée. Le Cache-Control permet aussi aux navigateurs/CDN de
servir les répétitions sans toucher l'origine.

# BCWEB — Audit de performance & plan des bottlenecks (juillet 2026)

*Un regard ciblé sur où BCWEB dépense du temps et des octets, ce qui a été corrigé dans
cette passe, et un plan priorisé pour le reste. Complète l'[audit technique](TECH_AUDIT_FR.md).
🇬🇧 [English version](PERF_AUDIT_EN.md).*

## Méthode

- **Frontend** : `vite build` de production, mesure de la taille des chunks émis.
- **Backend** : lecture des chemins de requête chauds (browse catalogue, feed BMM
  `/catalog.json`, agrégations analytics), recoupement de leurs `where`/`orderBy` avec la
  couverture d'index Prisma (`@@index`), et scan des `findMany` non bornés et des boucles
  de requête par élément.
- **Montée en charge** : repérage de l'état in-process qui épingle l'app à une seule instance.

---

## Constats & état

### 1. 🔴 Frontend : un bundle JS géant — **corrigé (première passe)**
Chaque visiteur téléchargeait toute l'app en un seul chunk `index` de **2,34 Mo**, y compris
le back-office admin de ~7,3k lignes, les outils dépôts et les éditeurs qu'un visiteur normal
n'ouvre jamais.

**Fait** — découpage par route de la SPA (`React.lazy` + une frontière `Suspense`) : toutes
les routes hors atterrissage se chargent à la demande. Chunk principal **2,34 Mo → 1,38 Mo
(−41 %)** ; le bundle admin est son propre chunk de **504 Ko** récupéré seulement quand un
admin ouvre `/admin` ; 32 chunks à la demande.

**Fait (deuxième passe)** — extraction de la carte `NOTIF` dans un petit `ui/notif.js` pour que
la cloche de nav n'épingle plus `dashboard.jsx` au chunk principal (le dashboard se découpe
maintenant), et lazy-load de l'orbe Hero3D pour que `three` (~460 Ko) charge après le premier
rendu. Chunk principal **1,38 Mo → 1,23 Mo** (soit **−47 %** vs les 2,34 Mo d'origine).

**Garde ajoutée** — `scripts/bundle-budget.mjs` (CI `npm run budget`) échoue si le chunk d'entrée
gzippé dépasse 430 Ko (actuellement ~372 Ko), pour qu'une régression du type import eager d'une
route lourde ne puisse plus repasser en douce.

**Reste** : les chunks carte (`maplibre-gl` 1 Mo) / `rrweb` / `jszip` sont déjà séparés —
vérifier que chacun ne charge que sur sa route.

### 2. 🟠 BD : index des chemins chauds sur `CatalogItem` — **corrigé**
Le browse public `/catalog` (filtre par `status`, tri par `downloads`/`views`/`updatedAt`) et
le feed BMM `/catalog.json` (filtre `status`+`projectId`+`kind`, tri par `downloads`) filtraient
et triaient sur des colonnes **non indexées** — un scan séquentiel + tri en mémoire qui se
dégrade quand le catalogue grossit.

**Fait** — ajout des index composites `(status,updatedAt)`, `(status,downloads)`,
`(status,views)` et `(projectId,kind,status)` sur `CatalogItem` (migration
`catalog_hot_path_indexes`) ; et un index couvrant `(listed,verified,pendingReview,createdAt)`
sur `ServerRepo` pour la liste publique `/repos` (migration `repos_list_index`). Le browse des
catalogues communautaires avait déjà `(status,listed)`.

**Reste** : les grosses tables admin (analytics, journal d'audit) — priorité moindre car
admin-only, hors des chemins chauds visiteur.

### 3. 🟠 Le feed `/catalog.json` était non borné — **corrigé**
Le feed natif BMM faisait `findMany` **sans `take:`** plus une jointure owner, donc son coût de
requête et sa charge utile croissaient avec tout le catalogue publié — et il est interrogé par
chaque client desktop, donc un cache HTTP froid laissait tous les clients frapper Postgres en
même temps.

**Fait** — plafonné à `take: 500` (top par téléchargements) et enveloppé dans le cache deux-tiers
existant (TTL 60s : L1 par-process + L2 Redis + coalescence des requêtes), donc les cache-miss
concurrents partagent un seul appel producteur. Le contrôle d'accès tourne toujours par-requête
avant le cache. Couvert par `test/cache.test.mjs`.

### 4. 🟠 L'état mono-processus bloquait la montée en charge — **fait**
Le feed SSE, les caches, les compteurs de rate-limit et les sweepers étaient tous in-process.
Les quatre sont désormais adossés à Redis derrière `REDIS_URL`, avec un fallback in-process pour
que le déploiement mono-conteneur ne soit pas affecté :
- **Rate-limit** → store Redis partagé (option `redis` de `@fastify/rate-limit`). *(déjà en place)*
- **Lectures publiques chaudes** → cache deux-tiers (`lib/cache.mjs`) : L1 par-process + L2 Redis +
  coalescence des requêtes. *(déjà en place ; utilisé aussi par `/catalog.json` maintenant)*
- **Feed admin en direct (SSE)** → chaque événement ingéré est publié sur un canal Redis ; chaque
  instance fait tourner un abonné qui ré-émet les événements des autres réplicas sur son bus local
  (tagué avec un id par-process pour ignorer son propre écho). **Fait cette passe.**
- **Sweeper** → un verrou `SET NX PX` élit un seul runner par tick entre réplicas (expire tout
  seul ; une erreur Redis échoue en sécurité). **Fait cette passe.**

Vérifié contre un vrai Postgres + Redis : abonné `NUMSUB=1`, l'ingestion publie sur le canal du
feed, et le chemin de fallback reste 39/39 vert sans Redis.

### 5. 🟡 Les agrégations analytics sont des scans plein-fenêtre
Les tableaux de bord admin lancent du SQL brut `GROUP BY` / `count(DISTINCT …)` sur
`AnalyticsEvent` pour la fenêtre choisie. La rétention borne maintenant la table (audit §3.6),
mais une fenêtre large sur un site actif reste un scan lourd à chaque chargement de dashboard.

**Plan** : pré-agréger dans une table de rollup quotidien (un job sweeper nocturne) et lire les
rollups pour les vues à granularité jour, en retombant sur le brut seulement pour le zoom
horaire ; ajouter des index couvrants pour les requêtes brutes restantes.

*Note :* le dashboard lance ~17 agrégations en parallèle sur la fenêtre (série, top pages,
répartitions device/browser/os/géo…), donc un rollup de la seule série temporelle n'accélère
que 1 sur 17 pendant que le reste scanne — un rollup utile doit couvrir la plupart des
dimensions, ce qui est un schéma + producteur conséquent. La rétention bornant maintenant la
table, c'est réellement moins prioritaire qu'il n'y paraissait ; à faire si/quand une fenêtre
large sur un site actif traîne vraiment.

### 6. 🟡 Pas de SSR / prérendu pour le premier rendu & l'indexation
C'est une SPA rendue côté client : le navigateur télécharge le JS, boote React, puis va chercher
les données — donc le first-contentful-paint et l'indexation moteur traînent. L'unfurl OG pour
crawlers est déjà couvert (audit §3.8), ce qui gère le partage social mais pas l'indexation/TTFB.

**Plan** : c'est le plus gros chantier. Options, du moins cher au plus cher — (a) prérendre une
poignée de routes statiques à forte valeur au build ; (b) un cache edge du shell type-OG pour
les crawlers ; (c) SSR complet (Vite SSR / un meta-framework) seulement si le SEO devient une
priorité.

### 7. 🟡 Images & médias — en partie fait
Les avatars sont générés (Boring-avatars, peu coûteux) et cachés un jour. Les covers/icônes
uploadées passent par le proxy `/media/*` ; chaque clé porte un `randomUUID()`, donc les octets
d'une URL ne changent jamais — **servies maintenant en `immutable, max-age=1an`** (contre 1 jour),
donc le navigateur/CDN ne revalide jamais.

**Endpoint de resize ajouté** — `/media/*?w=<largeur>` (parmi 64…768) réduit les images raster en
webp via `@napi-rs/canvas`, chaque variante redimensionnée une fois dans un petit LRU et servie
immutable (une source 800px → 256px pèse ~78 % de moins). Le décodage sur le main thread JS est un
candidat worker Rust (voir le [plan workers Rust](RUST_WORKERS_PLAN_FR.md) §P3).

**Reste** : les cartes de liste front-end doivent réellement demander `?w=` pour concrétiser le
gain — idéalement via un composant cover/`<img>` partagé qui l'ajoute pour les URLs `/media`. À
plus long terme, servir `/media` directement depuis le stockage objet / un CDN sortirait
complètement le proxy d'octets de l'API Node.

---

## Plan priorisé

| P | Action | Gain | État |
|---|---|---|---|
| **P1** | Découpage par route de la SPA | −41 % de JS initial pour chaque visiteur | ✅ fait |
| **P1** | Index des chemins chauds `CatalogItem` | browse + feed restent rapides quand le catalogue grossit | ✅ fait |
| **P1** | Plafonner / cacher le feed `/catalog.json` | borne l'endpoint le plus interrogé | ✅ fait |
| **P2** | Finir le découpage frontend (extraire `NOTIF`, lazy hero `three`) | chunk principal 1,38 → 1,23 Mo (−47 % total) ; budget bundle encore ▢ | ✅ fait |
| **P2** | Indexer les endpoints de liste publics (dépôts, catalogues communautaires) | supprimer les scans séquentiels ; tables admin encore ▢ | ✅ fait |
| **P2** | Redis pub/sub + store rate-limit + verrous sweeper (derrière `REDIS_URL`) | débloque la montée en charge horizontale | ✅ fait |
| **P3** | Rollups quotidiens analytics | dashboards rapides à toute fenêtre | ▢ |
| **P3** | Prérendu/SSR pour les routes publiques | premier rendu + indexation moteur | ▢ |
| **P3** | En-têtes de cache images (fait : /media immutable) / variantes responsives (▢) | pages de liste plus légères | ◑ partiel |

## Verdict

Les deux gains au meilleur rapport gain/risque sont livrés et vérifiés : **−41 % de JS initial**
pour chaque visiteur et **des lectures catalogue indexées**. Le reste est une échelle claire :
borner le seul endpoint chaud non borné, finir le découpage frontend, puis le travail Redis qui
débloque le fait de tourner sur plus d'une instance. Rien ici n'est un incendie ; ce sont les
choses qui mordraient à mesure que le trafic et le catalogue grandissent, traitées par ordre de
gain.

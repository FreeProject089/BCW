# BCWEB — Plan workers Rust (déport du CPU lourd)

*Un plan pour déplacer le travail CPU-bound qui bloque l'event loop de l'API Node vers un
module natif Rust. Ancré dans les vrais call sites de `apps/api`. 🇬🇧 [English version](RUST_WORKERS_PLAN_EN.md).
Complète l'[audit de performance](PERF_AUDIT_FR.md).*

## Pourquoi

Node est mono-thread pour le JS. Aujourd'hui plusieurs chemins chauds font du **travail
CPU-bound synchrone sur l'event loop**, donc pendant qu'ils tournent *rien d'autre n'est
servi sur cette instance* :

- **`adm-zip` est totalement synchrone.** `new AdmZip(buf)` parse toute l'archive en un
  appel bloquant. Ça tourne à **chaque** validation d'upload et repackage :
  - `lib/plugin.mjs` — `validatePlugin` (ouvre le zip du plugin uploadé, parcourt les entrées).
  - `routes/catalog.mjs` — validation + extraction d'une entrée + repackage à la soumission/édition.
  - `routes/catalogs.mjs`, `routes/hosting-content.mjs` — gestion des fichiers catalogue/dépôt.
  Un zip de plusieurs Mo d'un seul uploadeur bloque toute l'API le temps du parse.
- **Hashing** — ~70 sites `createHash('sha256')` : intégrité des payloads catalogue,
  empreintes de dépôt (`repofingerprint.mjs`), hash externe des plugins. SHA-256 en JS va
  bien pour de petites entrées mais s'accumule sur de gros payloads.
- **Compression / archivage** — `archiver` streame les zips pour les exports dépôt/catalogue ;
  gzip sur diverses réponses.
- **Scans du système de fichiers** — `lib/gitbackup.mjs` parcourt les arbres récursivement
  (`repoSizeBytes`, `snapshotTree`), et lance `git gc`.

Le patron est déjà établi : l'API embarque **déjà des addons natifs** — `argon2` (hash de
mots de passe) et `@napi-rs/canvas` (génération d'images). Et l'**app desktop BMM est déjà
en Rust** (Tauri v2), donc un crate partagé est réaliste.

## La surface du worker

En miroir de la cible que tu as esquissée, un module Rust expose :

```
Worker Rust  (module natif napi-rs, async → hors de l'event loop JS)
 ├─ BLAKE3        hash(bytes) / hash_file(path)      → remplace sha256 quand on maîtrise les deux bouts
 ├─ zstd          compress(bytes,level) / decompress → remplace gzip pour les artefacts internes
 ├─ scan fs       walk(root) → [{path,size,mtime,hash?}]  → remplace les walks readdir récursifs
 ├─ ZIP           read_entries / extract_one / repackage → remplace adm-zip (hors-thread)
 └─ manifest      build_manifest(root|zip) → {files, hashes, sizes, total}
```

- **BLAKE3** est bien plus rapide que SHA-256 et se parallélise en interne. À utiliser pour
  l'intégrité **interne** (dédup de payloads, manifests de backup, clés de cache) où BCWEB
  est producteur ET consommateur. Garder **SHA-256 sur le contrat d'API public** (le feed
  `catalog.json` annonce `sha256`, et les clients le vérifient) — ne pas casser ça ; hasher
  les deux si besoin.
- **zstd** pour les artefacts internes (snapshots de backup, payloads temporaires). Le format
  de download public reste ce que les clients attendent.
- Tout est exposé en **fonctions napi-rs async** pour que le travail tourne sur un thread
  worker Rust/libuv, jamais sur l'event loop JS.

## Architecture — recommandé : module natif napi-rs

| Option | Verdict |
|---|---|
| **Addon natif napi-rs** (`.node`) | **Recommandé.** Même modèle que les deps existantes `argon2` / `@napi-rs/canvas` ; in-process, zéro IPC, `Buffer`↔`&[u8]` zéro-copie ; les tâches async tournent hors event loop. |
| Binaire sidecar + IPC (stdin/stdout ou socket) | Plus de pièces mobiles (gestion de process, sérialisation, backpressure). Seulement si on veut une isolation dure ou une frontière de langage. |
| WASM | Pas de threads/filesystem sans shims supplémentaires ; plus lent que le natif ici. Pas rentable. |

Un seul crate `native/` compilé avec napi-rs, publié en package interne du workspace
(`@bcweb/native`), importé par `apps/api`. Partager la logique cœur avec l'app Tauri BMM via
un crate Rust pur dont dépendent le wrapper napi et Tauri.

## Build & déploiement

- **Dev local** : `napi build` produit un `.node` par plateforme ; prebuilds par plateforme
  pour que les contributeurs n'aient pas besoin d'une toolchain Rust (napi-rs le fait nativement).
- **Docker (prod Linux)** : builder le `.node` dans une étape Rust du Dockerfile API, le
  copier dans l'image runtime (multi-stage). Cibles : `x86_64-unknown-linux-gnu` (ou `-musl`
  pour Alpine). Cible dev Windows `x86_64-pc-windows-msvc`.
- **Garder un fallback JS** pour chaque fonction (adm-zip / crypto / readdir) sélectionné au
  chargement si le module natif manque — pour qu'un build sans l'addon tourne quand même, en
  dégradé. Comme `getRedis()` dégrade en in-process.

## Découpage

| Phase | Déplacer | Pourquoi d'abord / risque |
|---|---|---|
| **P1 ✅ fait** | **ZIP hors event loop** — le crate `native/` expose des `zipReadAll`/`zipEntries` async (+ `blake3Hex`) ; `lib/native.mjs` les enveloppe avec un fallback adm-zip, et `validatePlugin` parse à travers (le sha256 reste en JS). Compilé + vérifié sous Windows ET dans Docker (rust:1-alpine → node:20-alpine musl, `hasNative=true` dans le conteneur) ; `native.test.mjs` prouve la parité octet-à-octet avec adm-zip. Câblé dans `apps/api/Dockerfile` en build deux-étapes — tourne en production. | Le plus gros gain event-loop : un gros upload ne bloque plus l'instance. Comportement préservé (test de parité octets). |
| **P1** | **`scan fs` + `blake3` pour les backups** — walk + hash de `repoSizeBytes` / `snapshotTree` en Rust. | Interne uniquement (pas de contrat public), pur CPU/IO, tailles/hashes faciles à vérifier. |
| **P2** | **zstd pour les artefacts internes** (snapshots de backup, payloads temp) + **builder de manifest**. | Empreinte plus petite, décision de format à prendre mais pas de contrat externe. |
| **P2** | **BLAKE3 pour l'intégrité interne** (clés de dédup, clés de cache) — garder SHA-256 sur le feed public. | Attention à ne pas toucher au `sha256` côté client. |
| **P3** | **Redimensionnement d'images** (l'item vignettes de l'audit perf) — un resize Rust `image`/`libvips` au lieu de `@napi-rs/canvas` sur le main thread. | Rattache le travail vignettes au même worker ; à faire une fois le pipeline en place. |

## Risques & garde-fous

- **Build natif en CI/Docker** — ajouter une étape de build Rust ; cacher le registre cargo ;
  les jobs `secret-scan` / tests existants ne sont pas affectés. Livrer des prebuilds pour
  qu'un `npm ci` sur un poste dev n'exige pas Rust.
- **Le contrat public `sha256`** — le feed `catalog.json` et les clients en dépendent. BLAKE3
  est pour l'usage interne uniquement ; là où une valeur franchit la frontière d'API, garder SHA-256.
- **Mémoire** — passer les `Buffer` par référence (zéro-copie napi-rs) ; streamer les gros
  zips plutôt que de les matérialiser, comme aujourd'hui.
- **Parité du fallback** — le fallback JS et le chemin Rust doivent produire des résultats
  identiques ; ajouter un test qui passe un zip/hash de fixture par les deux et vérifie l'égalité.
- **Ne pas sur-étendre** — les petits hashes (tokens de session, une empreinte de 32 octets)
  restent en `crypto` Node ; le gain n'est que pour les gros payloads bloquants ci-dessus.

## Gain attendu

- L'API arrête de caler sur les parses de zips multi-Mo (le pic de latence le plus clair
  aujourd'hui).
- Hashing/compression plus rapides sur les gros payloads, hors event loop.
- Un cœur Rust partagé avec l'app Tauri BMM — une seule implémentation de scan/hash/zip/manifest
  pour le client desktop ET le serveur.

## Verdict

Commencer par **P1 : ZIP + scan/hash fs des backups hors event loop** derrière napi-rs async,
avec un fallback JS et un test « les deux chemins concordent ». C'est la tranche au meilleur
rapport valeur/risque-de-contrat, réutilise le patron d'addon natif déjà présent, et pose le
crate sur lequel les phases suivantes (zstd, manifest, resize d'images) et l'app BMM pourront
toutes s'appuyer.

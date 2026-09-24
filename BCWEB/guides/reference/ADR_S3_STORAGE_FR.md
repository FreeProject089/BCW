# ADR — Le stockage objet après MinIO

**Statut :** décidé le 2026-09-24. **Décision :** le stockage objet fourni avec la stack est le
[Versity S3 Gateway](https://github.com/versity/versitygw) (`versity/versitygw:v1.8.0`, Apache-2.0)
avec son backend POSIX. Version anglaise : [ADR_S3_STORAGE_EN.md](ADR_S3_STORAGE_EN.md).

## Pourquoi il fallait décider

La stack tournait sur `minio/minio:RELEASE.2025-09-07T16-13-09Z`. MinIO a cessé de publier des
images communautaires en octobre 2025, a retiré `minio/minio` de Docker Hub le 2026-09-11, et
quay.io refuse les pulls anonymes. Une machine qui avait l’image en cache continuait de marcher ;
une **machine neuve ne pouvait plus déployer BCWEB du tout**. Changer de tag n’y pouvait rien : il
fallait changer de serveur.

## Ce que BCWEB demande vraiment à S3

Lu dans le code, pas supposé (`apps/api/src/lib/storage.mjs` est le seul client S3 de l’API ;
`apps/provisioner/src/index.mjs` en a un second, plus petit) :

| Utilisé | Où |
| --- | --- |
| `HeadBucket`, `CreateBucket` | `ensureBucket()` au démarrage de l’API, le provisioner, la sonde d’état |
| `PutObject` (côté serveur) | pièces jointes des retours, fichiers des conversations, fichiers de la marketplace, `.keep` du provisioner |
| `GetObject` (en flux) | proxy des médias du blog, fichiers des dépôts hébergés, avatars, sauvegardes, empreintes d’images |
| `DeleteObject` | balayeur, fermetures, modération, retrait de catalogue |
| `ListObjectsV2` avec préfixe + jeton de continuation | tableau du stockage (`prefixUsage`), rattrapage des empreintes |
| **PUT** et **GET** présignés (SigV4 en query string) | chaque envoi et téléchargement du navigateur va directement au stockage |
| **CORS** sur l’origine du stockage | le navigateur fait ses PUT/GET en cross-origin (site sur `:5176` ou le domaine, stockage sur `:9000` ou le domaine `s3.`) |
| Adressage path-style (`forcePathStyle: true`) | un seul nom d’hôte dans Caddy, pas de DNS joker |
| Pas de checksums par défaut du SDK (`WHEN_REQUIRED`) | les URL présignées ne doivent pas porter de `x-amz-checksum-*` |

**Utilisé nulle part :** envoi multipart, `CopyObject`, `DeleteObjects`, politiques de bucket ou
lecture anonyme, versionnage, règles de cycle de vie, verrouillage d’objet, l’API d’admin ou la
console de MinIO, le client `mc`. L’unique bucket est privé ; tout octet public passe par une URL
présignée ou par l’API.

## Candidats

| | versitygw v1.8.0 | Garage v2.4.1 | SeaweedFS 4.47 | RustFS 1.0.0 |
| --- | --- | --- | --- | --- |
| Licence | Apache-2.0 | **AGPL-3.0** | Apache-2.0 | Apache-2.0 |
| Image (Docker Hub, anonyme) | `versity/versitygw`, ~31 Mo | `dxflrs/garage`, ~27 Mo | `chrislusf/seaweedfs`, ~92 Mo | `rustfs/rustfs`, ~110 Mo |
| Rythme de versions (2026) | environ mensuel, v1.1 → v1.8 | v2.2 en janvier, v2.3 en avril, v2.4 en septembre | hebdomadaire | 1.0.0 finale le 2026-09-16, RC avant |
| Tout ce que BCWEB utilise | oui, **mesuré** (plus bas) | oui selon sa table de compatibilité | oui selon sa doc, non mesuré | oui selon sa doc, non mesuré |
| Identifiants | n’importe quelle chaîne, depuis l’environnement | ids de clé `GK` + 24 hex, secret 64 hex ; importés par sa CLI | fichier JSON d’identités | environnement, façon MinIO |
| Amorçage | aucun (l’API crée le bucket) | layout du nœud (assign + apply), import de clé, droits sur le bucket, secret RPC, token admin | master + volume + filer + S3 dans un processus, fichiers de config | aucun |
| CORS global | `--cors-allow-origin` (comme celui de MinIO) | par bucket seulement | non vérifié | non vérifié |
| Données sur disque | **fichiers ordinaires**, un par objet | magasin de blocs + base de métadonnées | ses propres fichiers de volume | son propre format |
| Sauvegarde du volume | un simple `tar` est complet et lisible | demande son instantané de métadonnées, un tar à chaud est risqué | son propre outillage | son propre outillage |

L’AGPL n’est pas bloquante pour Garage : BCWEB le ferait tourner sans modification, et la clause
réseau de l’AGPL ne s’applique qu’à une version *modifiée* offerte sur le réseau. Garage a perdu sur
l’exploitation, pas sur la licence : des ids de clé au format imposé (tout `S3_ACCESS_KEY` existant
change), un layout de cluster à initialiser même pour un nœud, le CORS à régler bucket par bucket,
et un répertoire de données qu’un `tar` ne peut pas copier sans risque pendant qu’il tourne.
SeaweedFS est le plus lourd à exploiter pour un seul bucket. RustFS est le remplaçant le plus
proche de MinIO, mais sortait de release candidate depuis huit jours le jour de la décision ; c’est
le second choix naturel si versitygw venait à s’arrêter.

## Pourquoi versitygw

- **Rien à amorcer.** La clé d’accès et le secret racine viennent de l’environnement, n’importe
  quelle chaîne : les `S3_ACCESS_KEY` / `S3_SECRET_KEY` existants restent valables et rien n’est
  écrit dans les données. Le `ensureBucket()` de l’API crée le bucket exactement comme avec MinIO.
  Pas de `mc`, pas de job d’initialisation.
- **Même contrat réseau.** Port 9000, path-style, région `us-east-1` (transmise depuis
  `S3_REGION`), une seule origine CORS globale. `S3_ENDPOINT` passe de `http://minio:9000` à
  `http://storage:9000` ; `S3_PUBLIC_ENDPOINT`, vu par le navigateur, et le bloc Caddy `S3_DOMAIN`
  ne changent pas.
- **Des données lisibles.** Chaque objet est le fichier `/data/buckets/<bucket>/<clé>` ; son
  Content-Type et son ETag sont de petits fichiers sous `/data/meta` (le *sidecar*, préféré aux
  xattrs parce que le `tar` busybox de `infra/backup/backup.sh` perd les xattrs). Une sauvegarde est
  une archive tar ordinaire qui se restaure sans que le serveur tourne.
- **Petit et non-root.** Image Alpine d’environ 31 Mo, avec `wget` pour le healthcheck et un point
  `--health` ; il tourne en uid 1000 dans compose (l’image seule démarre en root).

## Mesuré avant de décider (2026-09-24)

Un script a piloté le vrai `storage.mjs` contre versitygw v1.8.0 et, comme témoin, contre la
version de MinIO en cache, chacun dans un conteneur jetable : création et HEAD du bucket, PUT
présigné façon navigateur avec preflight CORS, GET présigné, put côté serveur et get en flux
(octets, type, longueur), un objet vide, 1 005 clés listées sur deux pages, usage par préfixe,
suppression, suppression d’une clé absente, le client du provisioner, mauvais identifiants refusés,
signature altérée refusée, GET anonyme refusé. **20 sur 20 sur les deux serveurs.** Puis un
`rclone copy` MinIO → versitygw d’un bucket d’exemple (objets de 12 Mio, de 0 octet et imbriqués,
sept types de contenu) : `rclone check`, `rclone check --download` et une comparaison des
Content-Type, tous identiques.

Deux différences, toutes deux franches :

1. **Une clé ne peut pas être à la fois un fichier et un dossier.** `a` et `a/b` ne peuvent pas
   coexister sur un backend POSIX : versitygw répond `409` au second PUT (`ObjectParentIsFile` /
   `ExistingObjectIsDirectory`). MinIO stockait les deux, puis n’en listait qu’un. Le seul endroit
   où un utilisateur choisit une clé complète est le chemin d’un fichier de dépôt hébergé :
   `presignRepoFile` refuse maintenant le conflit lui-même, en `409 path_conflict`
   (`apps/api/test/repo-file-path-conflict.test.mjs`).
2. **Plus de console d’admin.** La console `:9001` de MinIO disparaît ; la WebUI optionnelle de
   versitygw n’est pas activée. Le stockage s’administre par l’API S3 (rclone, l’AWS CLI) ou par
   les fichiers.

Trouvé en chemin, **vrai aussi avec MinIO** : le PUT présigné ne signe que l’en-tête `host`, donc
le stockage n’impose ni le Content-Type ni la taille que l’API a vérifiés en délivrant l’URL. Les
commentaires qui affirmaient le contraire (`Caddyfile`, `uploads.mjs`) le disent maintenant.

## Conséquences

- Service compose `minio` → `storage`, volume `minio-data` → `s3-data`, variable
  `MINIO_API_CORS_ALLOW_ORIGIN` → `S3_CORS_ALLOW_ORIGIN`, nouvelle variable optionnelle `S3_HOST_PORT`.
- Une installation existante déplace ses données une fois avec rclone :
  [DEPLOY_FR.md → Quitter MinIO](../run/DEPLOY_FR.md#quitter-minio). L’ancien volume n’est plus
  déclaré et compose ne le supprime jamais.
- Les sauvegardes archivent `s3-data` en `s3-<ts>.tar.gz` ([BACKUP_FR.md](../run/BACKUP_FR.md)).
- Quitter le stockage fourni pour Cloudflare R2 reste une affaire de `.env`, comme avant.

# BCWEB — Sauvegarde & Restauration

Tout l'état de BCWEB tient en **trois endroits** : la base Postgres, le stockage objet
MinIO (uploads / médias du blog / fichiers des dépôts hébergés) et l'ancre d'audit
inviolable. `infra/backup/backup.sh` capture les trois ; ce guide couvre son exécution, la
copie hors-site et — surtout — la **restauration**.

## Ce qui est sauvegardé

| Source | Comment | Fichier |
|---|---|---|
| **Postgres** (toutes les données) | dump logique `pg_dump` (cohérent, sûr sur une base live) → gzip | `pg-bcweb-<ts>.sql.gz` |
| Stockage objet **MinIO** | tar du volume Docker `<projet>_minio-data` | `minio-<ts>.tar.gz` |
| **Ancre d'audit** (racine de la chaîne HMAC) | tar du volume `<projet>_audit-anchor` | `audit-anchor-<ts>.tar.gz` |

> Postgres est dumpé avec `pg_dump`, **pas** en tarrant le volume sous un serveur en marche
> — une copie de fichiers à chaud est incohérente et peut restaurer un état corrompu.

## Exécution

```bash
# Ponctuel, cible par défaut (/var/backups/bcweb) :
infra/backup/backup.sh

# Cible personnalisée :
BACKUP_DIR=/mnt/backups infra/backup/backup.sh
```

Config via env (défauts dans le script) : `BACKUP_DIR`, `RETENTION_DAYS` (défaut 14 — les
sauvegardes locales plus vieilles sont supprimées), `POSTGRES_USER`/`POSTGRES_DB` (défaut
`bcweb`), `COMPOSE_DIR`, `COMPOSE_PROJECT_NAME` (préfixe des noms de volumes).

## Planification (cron sur le VPS)

```cron
# Chaque jour à 03h30, avec log :
30 3 * * * BACKUP_DIR=/mnt/backups /opt/bcweb/BCW/BCWEB/infra/backup/backup.sh >> /var/log/bcweb-backup.log 2>&1
```

## Copie hors-site (fortement recommandé)

Une sauvegarde sur la même machine n'en est pas une. Pointe `BACKUP_REMOTE` vers un remote
[rclone](https://rclone.org) (config une fois avec `rclone config` — Backblaze B2 / S3 /
Cloudflare R2 / Google Drive) :

```bash
BACKUP_REMOTE=b2:mon-bucket/bcweb infra/backup/backup.sh
```

Le script lance `rclone copy` après chaque sauvegarde. Donne au remote sa propre
**versioning/rétention** (ex. 30–90 jours) pour qu'une mauvaise exécution locale n'efface
pas l'historique hors-site.

## Restauration

À lancer depuis `infra/compose/`. **La restauration écrase les données actuelles — refais
une sauvegarde d'abord si elles comptent encore.**

### 1. Postgres

```bash
cd infra/compose
# (optionnel) repartir d'un schéma propre :
#   docker compose exec -T db psql -U bcweb -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
gunzip -c /var/backups/bcweb/pg-bcweb-<ts>.sql.gz | docker compose exec -T db psql -U bcweb bcweb
docker compose restart api
```

### 2. Stockage objet MinIO

```bash
cd infra/compose
docker compose stop api web
docker run --rm -v bcweb_minio-data:/data -v /var/backups/bcweb:/backup alpine \
  sh -c 'rm -rf /data/* && tar xzf /backup/minio-<ts>.tar.gz -C /data'
docker compose start api web
```

(Remplace le préfixe `bcweb_` par ton `COMPOSE_PROJECT_NAME` si différent.)

### 3. Ancre d'audit (uniquement si tu restaures la base du même point)

```bash
docker run --rm -v bcweb_audit-anchor:/data -v /var/backups/bcweb:/backup alpine \
  sh -c 'rm -rf /data/* && tar xzf /backup/audit-anchor-<ts>.tar.gz -C /data'
```

Garde la base et l'ancre d'audit de la **même** exécution pour que la chaîne HMAC se
vérifie encore (`/admin/security` → vérifier la chaîne).

## Les sauvegardes dans l’app sont autre chose

« Gestion serveur avancée → Stockage des sauvegardes » a ses propres outils, et ils ne
remplacent **rien** de ce qui précède. Confondre les deux est l’erreur dangereuse, donc
clairement :

| | `infra/backup/backup.sh` | Snapshots dans l’app |
|---|---|---|
| Données Postgres (comptes, dépôts, catalogues, paiements) | **Oui** | **Non** |
| Objets MinIO (fichiers envoyés, octets des dépôts hébergés) | **Oui** | **Non** |
| Historique d’édition des fichiers touchés via le gestionnaire | Non | **Oui** |
| Historique d’édition des lignes touchées via le visualiseur BDD | Non | **Oui** |
| Survit à la perte de la machine | Oui, une fois copié hors site | Seulement si téléchargé |

Un snapshot applicatif est un **bundle git de cet historique d’édition**, figé avec sa
taille, un sha256 et une signature Ed25519. Il répond à « remets ce fichier ». Il ne répond
pas à « le serveur a disparu » — c’est le rôle du script ci-dessus.

### Prendre, conserver, lire

- **Sauvegarder maintenant** en prend une tout de suite (fichiers, lignes BDD, ou les deux).
  L’historique fichiers est rafraîchi d’abord, donc le snapshot inclut ce qui vient d’être
  modifié.
- **Garder N** fait la rotation par type — dix snapshots fichiers quotidiens ne peuvent pas
  évincer tous les snapshots BDD d’un budget commun. `0` désactive la rotation, et le veut
  dire : rien n’est supprimé.
- Le balayage quotidien en prend un et fait la rotation aussi : la rétention est une règle,
  pas un pense-bête pour appuyer sur un bouton.
- **Examiner** lance `git bundle verify` et liste les commits de tête, puis vérifie
  séparément le sha256 enregistré contre le fichier sur disque. Les deux répondent à des
  questions différentes : git dit que le fichier est un bundle cohérent, l’empreinte dit que
  c’est bien *notre* fichier.
- **Importer** accepte un `.bundle` sorti de cette machine ou venu d’un autre serveur. Il est
  vérifié avant d’être stocké : la liste ne contient jamais quelque chose d’irrestaurable.

### Revenir en arrière

Uniquement depuis l’examen, et seulement après avoir tapé `CONFIRM`. Une sauvegarde de
sécurité de l’état actuel est prise d’abord et le retour arrière est **refusé** si elle
échoue — un rollback sans retour possible est une restauration pleine d’espoir.

Cocher « écrire aussi ces fichiers par-dessus le dossier de l’application » est la moitié
irréversible. Cela recopie l’arbre restauré **par-dessus** l’existant ; cela ne supprime pas
les fichiers créés depuis, parce que ce dossier est l’application en service et qu’effacer
les chemins inconnus effacerait les envois et les caches. Ce qui reste est listé ensuite :
le résultat est une fusion que tu vois, pas un rollback que tu supposes.

## Vérifie tes sauvegardes

Une sauvegarde jamais restaurée est un espoir, pas un plan. Régulièrement : restaure le
dernier `pg-*.sql.gz` dans un Postgres jetable et vérifie que les comptages de lignes sont
cohérents. `gzip -t pg-*.sql.gz` vérifie au moins que l'archive n'est pas tronquée.

## Checklist

- [ ] `backup.sh` planifié dans cron.
- [ ] `BACKUP_REMOTE` défini → copies hors-site.
- [ ] Bucket hors-site avec versioning/rétention.
- [ ] Une restauration testée au moins une fois.
- [ ] `RETENTION_DAYS` cohérent avec ta fenêtre de récupération.

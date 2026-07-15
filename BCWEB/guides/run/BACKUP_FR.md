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

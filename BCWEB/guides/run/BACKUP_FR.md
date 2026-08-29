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

## Chiffrer le dump (recommandé avant toute copie hors site)

`pg_dump` écrit **toute la base en clair** — chaque adresse, chaque profil, chaque session.
rclone copie ensuite ce fichier vers un stockage exploité par quelqu'un d'autre. Chiffrez-le
d'abord :

```bash
# age (le plus simple). Générez la clé HORS du serveur, et gardez-y la moitié privée.
age-keygen -o backup.key            # sur votre machine
grep 'public key' backup.key        # -> age1...
BACKUP_AGE_RECIPIENT=age1... infra/backup/backup.sh

# ou gpg, si c'est ce que vous utilisez déjà
BACKUP_GPG_RECIPIENT=vous@exemple.com infra/backup/backup.sh
```

Une clé **publique**, à dessein. Une phrase de passe devrait vivre sur la machine qui prend
les sauvegardes — donc la machine la plus exposée serait celle qui peut lire toutes les
sauvegardes qu'elle a jamais prises. Avec une clé destinataire, le serveur ne peut qu'écrire ;
lire exige la moitié privée, qui ne le touche jamais.

Si l'outil nommé est absent, le script **s'arrête** au lieu d'écrire du clair sous un nom qui
prétend le contraire. Restauration : `age -d -i backup.key pg-*.sql.gz.age | gunzip | psql …`
(ou `gpg -d`).

## Ce qu'une demande d'effacement atteint, et ce qu'elle n'atteint pas

Deux choses différentes s'appellent ici « sauvegarde », et une seule peut être effacée :

| | Ce que c'est | Effacement |
|---|---|---|
| **Historique lignes & fichiers** (dans l'app, Gestion serveur avancée) | Un instantané de la ligne avant chaque modification, committé dans git | **Oui.** Les instantanés de chaque utilisateur sont chiffrés avec sa propre clé ; effacer le compte détruit la clé, donc ses instantanés deviennent illisibles — y compris dans les copies déjà synchronisées ailleurs — pendant que ceux des autres se restaurent toujours. |
| **Dumps de `backup.sh`** | Un `pg_dump` complet, pour la reprise après sinistre | **Non.** Un dump est une copie figée de toute la base ; une personne effacée aujourd'hui est encore dans celui d'hier. |

Cette seconde ligne n'est pas un défaut à cacher, c'est le fonctionnement d'un dump — et la
réponse admise n'est pas de le réécrire. C'est :

1. **Une durée de conservation courte et documentée.** `RETENTION_DAYS` (14 par défaut) est
   la durée pendant laquelle une personne effacée peut encore figurer dans un dump. Écrivez
   ce nombre dans votre politique de confidentialité.
2. **Rejouer les effacements après toute restauration.** Un dump antérieur à un effacement
   ramène la personne. Avant que la pile ne resserve du trafic, rejouez les effacements
   enregistrés depuis la prise du dump — le journal d'audit les contient (`user.erased`).

Restaurer un vieux dump sans l'étape 2 annule chaque effacement fait depuis. Mettez-la dans
la procédure de restauration, pas dans la mémoire de quelqu'un.

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

« Gestion serveur avancée » a deux outils à elle, et aucun ne **remplace** ce qui précède.
Trois choses s’appellent « sauvegarde » ici ; les confondre est l’erreur dangereuse, donc
clairement :

| | `infra/backup/backup.sh` | Snapshots dans l’app | Export du contenu |
|---|---|---|---|
| Données Postgres (comptes, dépôts, catalogues, paiements) | **Oui** | Non | En partie — en JSON lisible, voir plus bas |
| Objets MinIO (fichiers envoyés, octets des dépôts hébergés) | **Oui** | Non | Non |
| Historique d’édition des fichiers touchés via le gestionnaire | Non | **Oui** | Non |
| Historique d’édition des lignes touchées via le visualiseur BDD | Non | **Oui** | Non |
| Peut être restauré dans BCWEB | **Oui** | **Oui** | **Six sections sur neuf** — voir plus bas |
| Lisible sans BCWEB | Non | Non | **Oui** — du JSON brut dans un zip |
| Survit à la perte de la machine | Oui, une fois copié hors site | Seulement si téléchargé | Seulement si téléchargé |

### Export du contenu

« Gestion serveur avancée → Export du contenu » télécharge le contenu **écrit** — docs,
blog, FAQ, versions des pages légales, réglages du site, avis et fiches de comptes — sous
forme d’un fichier JSON par section dans un zip. Chaque section affiche son nombre de lignes
avant le téléchargement : tu fais un choix, pas une supposition.

Il existe pour les questions auxquelles les deux autres répondent mal : *que disait cette
page le mois dernier*, *je déménage vers une autre installation*, *je veux lire ce qu’il y a
dedans sans base de données*.

Trois choses à son sujet sont délibérées et à connaître avant de compter dessus :

- **Ça se relît — en partie.** Six sections s’importent : docs, blog, FAQ, versions légales,
  réglages du site, et avis/sondages. Les trois autres s’exportent et ne se réimportent pas,
  chacune pour sa raison. Les comptes ne portent aucune donnée d’identification : les
  restaurer créerait des coquilles où personne ne peut se connecter et écraserait le rôle et
  le statut de gens qui existent. Les lignes de catalogues et de dépôts pointent vers des
  fichiers MinIO que le zip ne transporte pas. L’écran marque ces trois-là « export seul »
  avant que tu choisisses, plutôt que de les sauter en cours de route.

  Un import remplace les entrées de même id et laisse tranquille tout ce dont le zip n’a
  jamais entendu parler — « remets ça », pas « rends le site identique à ce zip », qui
  détruirait tout ce qui a été écrit depuis l’export. Ce que disait le site avant est d’abord
  commité dans un historique git : l’Annuler du toast et la liste de rollback sont le même acte.

  Ce n’est toujours pas un point de reprise après sinistre. Pour « le serveur a disparu »,
  utilise le script en haut de cette page.
- **Les comptes ne sont que des fiches** — id, e-mail, nom affiché, rôle, statut, bio,
  avatar. Aucun hash de mot de passe, aucun secret 2FA, aucun token. C’est ce qui rend le zip
  sûr à garder sur un portable, et c’est pourquoi restaurer les gens veut dire les réinviter.
- **Catalogues et dépôts sont désactivés par défaut.** Leurs lignes sont des métadonnées qui
  pointent vers des fichiers MinIO que le zip ne contient pas. Activés par défaut, l’archive
  paraîtrait plus complète qu’elle ne l’est — c’est le pire défaut d’une sauvegarde, parce
  qu’on s’en aperçoit au moment où on en a besoin.

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

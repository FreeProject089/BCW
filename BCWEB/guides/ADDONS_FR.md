# BCWEB — Activer les composants optionnels (FR)

> 🇬🇧 [ADDONS_EN.md](ADDONS_EN.md) · Vue d'ensemble du déploiement : [DEPLOY_FR.md](DEPLOY_FR.md)

Le mode d'emploi de chaque brique **optionnelle** (CDN, pooler, réplicas, R2, DB séparée,
backup hors-site). Chacune suit le même plan : **Quand l'ajouter · Comment · Après (à
vérifier)**.

> 🟢 **Règle d'or :** n'ajoute une brique que **quand une limite se manifeste** (regarde
> l'onglet admin **Server perf** : CPU/RAM/disque/latence). Rien n'est obligatoire au départ —
> tout le reste tourne déjà gratuitement sur ton VPS.

---

## 1. CDN Cloudflare (gratuit)

**Quand l'ajouter :** dès que tu as un domaine. Gain immédiat, aucun inconvénient.

**Comment :**
1. Cloudflare → **Add a site** → ton domaine.
2. Mets les **nameservers** donnés chez ton registrar (là où tu as acheté le domaine).
3. **DNS :** l'enregistrement `A` (ton IP VPS) en mode **Proxied** (nuage orange 🟠).
4. **SSL/TLS → Full (strict)** (Caddy garde le vrai TLS à l'origine).

**Après (à vérifier) :**
- Recharge le site → l'en-tête `cf-cache-status: HIT` doit apparaître sur `/assets/*`
  (DevTools → Network). Le shell HTML reste `DYNAMIC` (voulu : déploiements instantanés).
- Rien à changer dans l'app : les en-têtes de cache sont déjà bons.

---

## 2. PgBouncer — pooler de connexions (gratuit)

**Quand l'ajouter :** **uniquement** quand tu fais tourner **≥ 2 réplicas d'API** (§3).
Avec un seul conteneur API, ça n'apporte rien.

**Comment :**
```bash
docker compose --profile pgbouncer up -d
```
Puis dans `infra/compose/.env` :
```ini
DB_HOST=pgbouncer
DB_PORT=6432
DB_URL_PARAMS=?pgbouncer=true
```
`docker compose up -d api` pour recharger.

**Après (à vérifier) :**
- L'API démarre et répond (`/ready` = 200).
- Les **migrations** passent toujours en direct via `DIRECT_DATABASE_URL` (géré
  automatiquement — PgBouncer ne peut pas les exécuter).

---

## 3. Réplicas d'API (gratuit)

**Quand l'ajouter :** quand **un seul conteneur API sature** (CPU élevé / latence qui monte
sous charge). Active **PgBouncer (§2) d'abord**.

**Comment :**
```bash
docker compose up -d --scale api=3
```
Puis liste les 3 upstreams côté Caddy (le cache + rate-limiter Redis rendent déjà ça sûr :
budget partagé entre réplicas).

**Après (à vérifier) :**
- Les requêtes se répartissent (logs des 3 conteneurs).
- Un `docker compose up -d --build` remplace les réplicas **un par un** → rollout invisible
  (grâce à l'arrêt gracieux SIGTERM déjà en place).

---

## 4. R2 — stockage objet Cloudflare (payant à l'usage)

**Quand l'ajouter :** quand le **disque du VPS se remplit** de fichiers hébergés, ou que
l'**egress de téléchargement** sature ton uplink / est facturé. (Le CDN gratuit est une
chose séparée — R2 ≠ CDN.)

**Comment (env-only, aucun code) :**
1. Crée un bucket R2 + un token (Access Key / Secret) dans le dashboard Cloudflare.
2. Dans `infra/compose/.env` :
   ```ini
   S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
   S3_REGION=auto
   S3_PUBLIC_ENDPOINT=https://<domaine-public-ou-custom-R2>
   S3_BUCKET=<bucket>  S3_ACCESS_KEY=<key>  S3_SECRET_KEY=<secret>
   ```
3. Copie les objets existants une fois : `rclone sync minio:bcweb r2:bcweb`.
4. `docker compose up -d api provisioner`.

**Après (à vérifier) :**
- Un upload + un téléchargement fonctionnent depuis l'UI.
- Puis seulement, retire le service `minio` + son volume.

---

## 5. Postgres sur un serveur séparé (2ᵉ VPS à toi, ou managé)

**Quand l'ajouter :** quand la **DB a besoin de ressources dédiées** (CPU/RAM/IO), ou que tu
veux la séparer de l'app. Tant qu'un seul VPS tient les deux confortablement → **agrandis-le
verticalement**, c'est plus simple. (Pas de K8s pour ça.)

**Comment (bascule pure `.env`) :**
```ini
DATABASE_URL=postgresql://user:pass@hote-db:5432/bcweb?sslmode=require        # endpoint poolé
DIRECT_DATABASE_URL=postgresql://user:pass@hote-db:5432/bcweb?sslmode=require # direct (migrations)
```
```bash
docker compose up -d api provisioner
docker compose stop db     # la DB vit maintenant sur l'autre serveur (volume local conservé)
```

**Sécurité (2ᵉ VPS auto-hébergé) — obligatoire :**
- **Réseau privé** entre les 2 VPS (réseau privé du provider ou tunnel WireGuard).
- **Jamais** le port `5432` exposé sur Internet — pare-feu vers la seule IP du VPS app.
- **Même région/datacenter** (chaque requête fait un aller-retour → latence critique).
- `?sslmode=require` (ou `verify-full`) sauf LAN privé de confiance.

**Après (à vérifier) :**
- `/ready` = 200 (DB joignable). Les migrations passent (via l'endpoint direct).
- Reconfigure les **backups** : le dump Postgres se fera désormais sur le **VPS db**.

---

## 6. Backup hors-site (gratuit)

**Quand l'ajouter :** **dès la mise en prod** — c'est le filet de sécurité, à faire d'emblée.

**Comment :**
1. `rclone config` une fois → un remote gratuit (**Google Drive** 15 Go / **Mega** 20 Go).
2. Ajoute-le à la ligne cron du backup :
   ```
   30 3 * * * BACKUP_REMOTE=gdrive:bcweb BACKUP_DIR=/mnt/backups /chemin/.../infra/backup/backup.sh >> /var/log/bcweb-backup.log 2>&1
   ```

**Après (à vérifier) :**
- Un fichier apparaît bien sur le remote après un run manuel.
- **Teste une restauration** au moins une fois (commandes dans [DEPLOY_FR.md §10](DEPLOY_FR.md)) —
  un backup jamais testé n'en est pas un.
- Astuce taille : les dumps DB sont minuscules (~130 Ko) → off-site sans souci ; l'archive
  MinIO est la grosse → baisse sa rétention ou mirror incrémental si besoin.

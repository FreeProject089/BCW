# BCWEB — Démarrage rapide production (FR)

> 🇬🇧 [QUICKSTART_EN.md](QUICKSTART_EN.md) · Détails complets & le *pourquoi* de chaque
> étape : [DEPLOY_FR.md](DEPLOY_FR.md)

Le chemin court d'une machine vierge à un site en HTTPS. **Prérequis :** un VPS Linux avec
accès SSH/root + Docker & Compose v2, et un domaine que tu contrôles. Tout est gratuit et
auto-hébergé.

---

### 1. Récupère le code
```bash
git clone --recurse-submodules <ton-repo> bcweb
cd bcweb/BCW/BCWEB
```

### 2. Remplis les secrets
```bash
cp infra/compose/.env.example infra/compose/.env
nano infra/compose/.env
```
Minimum pour la production :
```ini
SITE_DOMAIN=community.example.com          # domaine nu → Caddy provisionne le HTTPS
SITE_URL=https://community.example.com
COOKIE_DOMAIN=.example.com                  # point initial (cookie partagé avec les sous-domaines)
POSTGRES_PASSWORD=<fort>
JWT_SECRET=<openssl rand -hex 32>
BOT_SHARED_SECRET=<fort>
S3_ACCESS_KEY=<user-minio>   S3_SECRET_KEY=<pass-minio>
# Clés Stripe seulement si tu actives l'hébergement payant — voir DEPLOY_FR.md §6
```
> Ne commit jamais `.env` — il est gitignoré (seul `.env.example` est suivi).

### 3. Pointe le DNS (tu gères le domaine)
| Type | Nom | Valeur |
|---|---|---|
| `A` | `community.example.com` | l'IPv4 de ton VPS |
| `A` *(optionnel)* | `telemetry.example.com` | même IP |

### 4. Lance
```bash
cd infra/compose
docker compose up -d --build
docker compose ps                 # chaque service healthy/running
docker compose logs -f caddy      # regarde le certificat TLS s'émettre
```
→ ouvre **https://community.example.com**. (Le schéma est créé automatiquement au boot.)

### 5. Passe ton compte admin
Inscris ton compte via l'UI d'abord, puis :
```bash
docker compose exec db psql -U bcweb -d bcweb -c \
  "UPDATE \"User\" SET role='SUPERADMIN' WHERE email='toi@example.com';"
```

### 6. Pare-feu (seul Caddy est exposé)
```bash
ufw allow 22 && ufw allow 80 && ufw allow 443 && ufw enable
```

### 7. CDN — Cloudflare (gratuit, recommandé)
1. Cloudflare → **Add a site** → ton domaine → mets les **nameservers** donnés chez ton registrar.
2. **DNS :** l'enregistrement `A` en mode **Proxied** (nuage orange 🟠).
3. **SSL/TLS → Full (strict)** (Caddy garde le vrai TLS à l'origine).

### 8. Sauvegardes (cron + hors-site gratuit)
```bash
crontab -e
# tous les jours 03:30 :
30 3 * * * BACKUP_DIR=/mnt/backups /chemin/BCW/BCWEB/infra/backup/backup.sh >> /var/log/bcweb-backup.log 2>&1
```
Hors-site gratuit : `rclone config` (Google Drive 15 Go / Mega 20 Go), puis ajoute
`BACKUP_REMOTE=gdrive:bcweb-backups` devant la commande. **Teste une restauration une fois**
([DEPLOY_FR.md §10](DEPLOY_FR.md)).

---

**Fini — en ligne, sécurisé, sauvegardé, pour 0 €.**
Ensuite (optionnel) : paiements Stripe (§6), bot Discord (§7), télémétrie (§8), montée en
charge — tout est dans [DEPLOY_FR.md](DEPLOY_FR.md).
